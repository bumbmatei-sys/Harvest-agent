import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import Stripe from 'stripe';
import QRCode from 'qrcode';
import { Resend } from 'resend';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantPrivate } from '@/lib/tenant-private';
import { verifyAuth } from '@/lib/api-auth';
import { PLATFORM_FEE_MAP } from '@/lib/stripe-connect';
import { sendAutomatedSms } from '@/lib/sms-send';
import { manualConfirmationMode } from '@/lib/paid-events-feature';
import {
  buildPaymentReference,
  PUBLIC_CLAIM_TOKEN_BYTES,
  REFERENCE_BODY_LENGTH,
} from '@/lib/event-payment-claims';
import { randomBytes } from 'node:crypto';
import { captureHandledError, captureMoneyPathError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

interface TicketType {
  id: string;
  name: string;
  description?: string;
  price: number;
  capacity: number | null;
  order: number;
}
interface DiscountCode {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  maxUses: number | null;
  usedCount: number;
}
interface AdditionalAttendee { name: string; email?: string }

/**
 * Public (no-auth) event registration endpoint. Records a registration on the
 * event's ticket type, enforces capacity / waitlist, applies a discount code,
 * emails a confirmation with a QR ticket, and logs a CRM activity when the
 * email matches an existing contact. All writes use the admin SDK.
 */
export async function POST(request: NextRequest) {
  let body: {
    tenantId?: string;
    eventId?: string;
    ticketTypeId?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    additionalAttendees?: AdditionalAttendee[];
    discountCode?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { tenantId, eventId, ticketTypeId } = body;
  const firstName = (body.firstName || '').trim();
  const lastName = (body.lastName || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const phone = (body.phone || '').trim();
  const discountCodeInput = (body.discountCode || '').trim().toUpperCase();
  const additionalAttendees = Array.isArray(body.additionalAttendees)
    ? body.additionalAttendees.filter((a) => a && a.name && a.name.trim()).slice(0, 9)
    : [];

  if (!tenantId || !eventId || !ticketTypeId || !firstName || !lastName || !email) {
    return NextResponse.json(
      { error: 'tenantId, eventId, ticketTypeId, firstName, lastName and email are required' },
      { status: 400 },
    );
  }

  // Optional identity link: when a logged-in app user registers, the client
  // sends their Firebase ID token. We resolve the uid SERVER-SIDE from the
  // verified token — never from a client-supplied field — so this money/identity
  // link can't be spoofed. Logged-out visitors send no token → verifyAuth returns
  // null → userId stays null and the public path is entirely unchanged.
  const authedUser = await verifyAuth(request);
  const userId = authedUser?.uid || null;

  try {
    const eventRef = adminDb.collection('tenants').doc(tenantId).collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    const event = eventSnap.data() || {};

    if (event.status !== 'published' || !event.registrationEnabled) {
      return NextResponse.json({ error: 'Registration is not available for this event.' }, { status: 410 });
    }

    const ticketTypes: TicketType[] = Array.isArray(event.ticketTypes) ? event.ticketTypes : [];
    const ticketType = ticketTypes.find((t) => t.id === ticketTypeId);
    if (!ticketType) {
      return NextResponse.json({ error: 'Selected ticket type is no longer available.' }, { status: 400 });
    }

    // ── Capacity check (single-field query on eventId; filter client-side) ──
    // Only CONFIRMED seats hold capacity. A `pending_payment` registration (a
    // paid ticket whose Checkout hasn't completed) holds nothing — otherwise an
    // abandoned checkout would burn a seat. Capacity is re-checked at webhook
    // confirmation, where the seat is actually claimed.
    const regSnap = await adminDb
      .collection('tenants').doc(tenantId).collection('registrations')
      .where('eventId', '==', eventId)
      .limit(5000)
      .get();
    // Capacity is counted in SEATS, not registrations: a registration for a couple
    // holds `quantity` seats (BUG 5). Legacy rows with no `quantity` field count as 1.
    const soldForType = regSnap.docs.reduce((sum, d) => {
      const r = d.data();
      return r.ticketTypeId === ticketTypeId && r.status === 'confirmed'
        ? sum + (Number(r.quantity) || 1)
        : sum;
    }, 0);

    // Headcount for THIS registration = primary registrant + named additional
    // attendees. Every attendee takes a seat and pays for a ticket.
    const quantity = 1 + additionalAttendees.length;

    let waitlisted = false;
    // The whole party is waitlisted/rejected together — a couple can't take half a seat.
    if (ticketType.capacity != null && soldForType + quantity > ticketType.capacity) {
      if (event.waitlistEnabled) {
        waitlisted = true;
      } else {
        return NextResponse.json({ error: 'This ticket type is sold out' }, { status: 410 });
      }
    }

    // ── Discount code validation ──
    const discountCodes: DiscountCode[] = Array.isArray(event.discountCodes) ? event.discountCodes : [];
    let discountAmount = 0;
    let appliedCode: DiscountCode | null = null;
    if (discountCodeInput) {
      appliedCode = discountCodes.find((d) => d.code.toUpperCase() === discountCodeInput) || null;
      if (!appliedCode) {
        return NextResponse.json({ error: 'Invalid discount code' }, { status: 400 });
      }
      if (appliedCode.maxUses != null && appliedCode.usedCount >= appliedCode.maxUses) {
        return NextResponse.json({ error: 'Discount code has reached its limit' }, { status: 400 });
      }
      discountAmount = appliedCode.type === 'percent'
        ? Math.round((ticketType.price * appliedCode.value) / 100)
        : appliedCode.value;
      discountAmount = Math.min(discountAmount, ticketType.price);
    }

    // Charge = ticket price × headcount − discount (BUG 5). The discount is an
    // order-level reduction computed from a single ticket price (matches
    // apply-discount + the public page's displayed total). Never negative.
    const gross = ticketType.price * quantity;
    const amount = Math.max(0, gross - discountAmount);
    const ticketCode = Math.random().toString(36).slice(2, 10).toUpperCase();

    // A real seat that costs money must be PAID before it is confirmed. A
    // waitlisted entry is free/held (never charged) regardless of ticket price,
    // and a ticket that discounts to $0 is free — both keep the immediate-confirm
    // flow below. Everything else goes through Stripe Checkout and is confirmed
    // only by the webhook after payment succeeds.
    /**
     * THE-351 — 🔴 UNDER MANUAL CONFIRMATION THIS NEVER GOES TO A RAIL.
     *
     * `manualConfirmationMode()` is true while `PAID_EVENTS_ENABLED` is false and
     * `MANUAL_EVENT_PAYMENTS_ENABLED` is true — i.e. a church may price a ticket
     * and collects it ITSELF, through its own PayPal / Revolut / Wise link.
     *
     * ⚠️ WITHOUT THIS CLAUSE THE WHOLE FEATURE IS UNREACHABLE. A priced ticket
     * would compute `requiresPayment`, look for a Connect account that does not
     * exist (the platform account is closed as `rejected.fraud`) and answer the
     * member with "This ministry hasn't set up payments yet" — the exact 400
     * THE-345 gated the price field to avoid. So the founder's instruction —
     * "Registered immediately, marked UNPAID" — is implemented HERE, as a
     * refusal to enter the payment branch at all.
     *
     * 🔴 THE THREE EXISTING BYPASSES ARE UNTOUCHED. `amount > 0` still means a
     * free registration, a waitlist entry and a ticket discounted to $0 never
     * reach this question — a church running a free conference sees nothing this
     * ticket added, and that is Do-not-break 2.
     */
    const requiresPayment = amount > 0 && !waitlisted && !manualConfirmationMode();

    /**
     * 🔴 THE REFERENCE CODE — the string the admin matches against a bank line.
     *
     * Generated for any seat that owes money under manual confirmation, and for
     * nothing else: a free registration has no payment to reference and must not
     * acquire the vocabulary of one.
     *
     * ⚠️ IT IS NOT THE TICKET CODE, and `event-payment-claims.ts` records why in
     * full: the ticket code is what the QR encodes and what gets a person
     * through the door, and this string is written into a payment note — on
     * Venmo, whose transaction feed is PUBLIC BY DEFAULT. Two identifiers, one
     * of which grants nothing.
     */
    const owesManualPayment = amount > 0 && !waitlisted && manualConfirmationMode();

    /**
     * THE-355 — 🔴 THE TOKEN THAT LETS A LOGGED-OUT REGISTRANT SAY THEY PAID.
     *
     * ⚠️ THE NORMAL CASE FOR A CRUSADE HAS NO ACCOUNT. THE-351 built the claim
     * flow against `requireAuth`, which is right for the member app and reaches
     * nobody on the public page — so no public registrant could ever claim, no
     * claim was ever created, and the founder's inbox was empty while two
     * registrations sat unpaid. This is the credential that closes that hole.
     *
     * 🔴 IT IS NOT THE REFERENCE CODE, and `event-payment-claims.ts` records the
     * two independent reasons in full: the reference is WRITTEN INTO A PAYMENT
     * NOTE on Venmo, whose transaction feed is PUBLIC BY DEFAULT, and at ~29.7
     * bits it is a guessing target rather than a secret. THE-324's rota
     * invitation solved this exact shape with a stored 256-bit token and no
     * sign-in; this is that pattern, authorising ONLY the three claim fields.
     *
     * 🔴 MINTED FOR A SEAT THAT OWES MONEY AND FOR NOTHING ELSE. A free
     * registration acquires no credential, because it has nothing to claim —
     * the same rule the reference code already follows one line up.
     */
    const paymentFields = owesManualPayment
      ? {
          paymentStatus: 'unpaid',
          paymentReference: buildPaymentReference(randomBytes(REFERENCE_BODY_LENGTH)),
          paymentClaimToken: randomBytes(PUBLIC_CLAIM_TOKEN_BYTES).toString('base64url'),
        }
      : {};

    if (requiresPayment) {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        return NextResponse.json({ error: 'Payments are not configured' }, { status: 500 });
      }

      // Plan lives on the tenant doc; the Connect account is on the server-only
      // tenant_private doc — the SAME fields donations use (see /api/stripe/
      // donate). Missing account → fail cleanly; NEVER fall back to confirming
      // a paid ticket for free.
      const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
      const tenantData = tenantSnap.data() || {};
      const connectAccountId = (await getTenantPrivate(tenantId)).stripeConnectAccountId;
      const plan = tenantData.plan || 'plus';
      if (!connectAccountId) {
        return NextResponse.json(
          { error: "This ministry hasn't set up payments yet — please contact them to complete your registration." },
          { status: 400 },
        );
      }

      const stripe = new Stripe(stripeKey);
      const feePercent = PLATFORM_FEE_MAP[plan] ?? 0;
      const applicationFeeAmount = Math.round(amount * feePercent);

      // Return to the SAME public event page the browser is on so the tenant
      // resolves by Host (getTenantFromHost). Don't use the platform apex — that
      // would resolve to the wrong tenant (or none).
      const host = request.headers.get('host');
      const proto = request.headers.get('x-forwarded-proto') || 'https';
      const origin = host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app');

      // Persist the registration as pending BEFORE creating the session so the
      // session metadata can carry its id. Pending regs hold no capacity and
      // consume no discount — those happen only at confirmation. `firstName` is
      // stored so the webhook can address the confirmation email.
      const pendingRef = await adminDb.collection('tenants').doc(tenantId).collection('registrations').add({
        eventId,
        tenantId,
        userId,
        name: `${firstName} ${lastName}`,
        firstName,
        lastName,
        email,
        phone: phone || null,
        ticketTypeId,
        ticketTypeName: ticketType.name,
        ticketCode,
        status: 'pending_payment',
        waitlisted: false,
        amount,
        quantity,
        discountCode: appliedCode ? appliedCode.code : null,
        discountAmount: discountAmount || 0,
        additionalAttendees,
        registeredAt: FieldValue.serverTimestamp(),
      });

      // Everything the webhook needs to finalize this registration server-side.
      const metadata: Record<string, string> = {
        type: 'event_registration',
        tenantId,
        eventId,
        ticketTypeId,
        registrationId: pendingRef.id,
        discountCode: appliedCode ? appliedCode.code : '',
        // Carry the verified uid so the webhook can retain it on the confirmed
        // reg even if the pending doc is ever re-created. '' for logged-out.
        userId: userId || '',
      };

      // 🔴 THE CHURCH IS CHARGED, NOT HARVEST — this is a DIRECT charge (THE-154).
      //
      // The session is created AS the connected account (the `Stripe-Account`
      // header, i.e. the `{ stripeAccount }` request option below). Tickets were
      // the LAST destination charge left in the codebase; PR 316 moved donations
      // for exactly these reasons and deliberately left tickets out of scope.
      //
      //   • LIABILITY. Stripe, verbatim: "For connected accounts that use direct
      //     charges, Stripe always attempts to debit disputed amounts from the
      //     connected account's balance." Under the destination charge this
      //     replaces, a disputed TICKET was debited from HARVEST's balance — for
      //     a sale Harvest earns 0% on.
      //   • MERCHANT OF RECORD. On a direct charge the church is the merchant on
      //     the attendee's card statement — its country, its settlement currency,
      //     its fee structure. Harvest was the business of record on ticket sales
      //     for events it has nothing to do with.
      //   • THE MONEY ITSELF. There is no `transfer_data` any more because there
      //     is nothing to transfer: the funds land in the church's balance.
      //
      // ⚠️ THE FEE DOES NOT MOVE. `application_fee_amount` still comes from
      // PLATFORM_FEE_MAP and is still 0 on every tier — Harvest takes no cut of a
      // ticket. Direct charges support application fees exactly as destination
      // charges did; what changed is who is charged, not what Harvest keeps.
      //
      // ⚠️ THE PRICE STAYS INLINE. `price_data` creates the Price and Product on
      // whichever account the session is created on, so nothing has to be
      // provisioned on the church's account first.
      //
      // 🔴 AND THE WEBHOOK MOVED WITH IT. A session created on the connected
      // account emits `checkout.session.completed` to the CONNECT endpoint
      // (`/api/stripe/connect/webhook`), not the platform one. That endpoint
      // confirms the registration in this same change — shipping this half alone
      // would mean every ticket is paid for and no registration is ever
      // confirmed, which is worse than the destination charge it replaces.
      const directCharge = { stripeAccount: connectAccountId };

      try {
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          // Single line item carrying the FULL headcount charge (price × quantity −
          // discount). Keeping quantity:1 with the net unit_amount makes the
          // charge and the platform fee exact even when a discount applies; the
          // headcount is reflected in the amount and the line name.
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: quantity > 1
                    ? `${event.title} — ${ticketType.name} × ${quantity}`
                    : `${event.title} — ${ticketType.name}`,
                },
                unit_amount: amount,
              },
              quantity: 1,
            },
          ],
          payment_intent_data: {
            // Zero on every tier (PLATFORM_FEE_MAP). A direct charge with no
            // application fee leaves the entire ticket price in the church's
            // balance. NO `transfer_data`: the money is already theirs.
            application_fee_amount: applicationFeeAmount,
            metadata,
          },
          success_url: `${origin}/event/${eventId}?registration=success`,
          cancel_url: `${origin}/event/${eventId}?registration=cancel`,
          customer_email: email || undefined,
          metadata,
        }, directCharge);

        return NextResponse.json({ url: session.url });
      } catch (stripeErr) {
        console.error('Event ticket checkout session creation failed:', stripeErr);
        // Someone tried to buy a ticket and couldn't. The ministry never hears
        // about it — the visitor just sees "Could not start checkout".
        captureMoneyPathError(stripeErr, {
          step: 'event-ticket-checkout',
          tenantId,
          ids: { eventId, ticketTypeId, registrationId: pendingRef.id },
        });
        // Roll back the orphaned pending registration so it doesn't linger.
        await pendingRef.delete().catch(() => {});
        return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 });
      }
    }

    // ── Write registration ──
    await adminDb.collection('tenants').doc(tenantId).collection('registrations').add({
      eventId,
      tenantId,
      userId,
      name: `${firstName} ${lastName}`,
      email,
      phone: phone || null,
      ticketTypeId,
      ticketTypeName: ticketType.name,
      ticketCode,
      // 🔴 THE-351 — `status` IS REGISTRATION STATUS AND HAS NEVER MEANT MONEY.
      // A manually-paid seat is `confirmed` the moment it is taken, exactly like
      // a free one, which is what makes the founder's decision — "let them in,
      // flagged" — structural: check-in reads THIS field, and payment lives in
      // the separate `payment*` fields below where no door control looks.
      status: waitlisted ? 'waitlisted' : 'confirmed',
      waitlisted: !!waitlisted,
      amount,
      quantity,
      discountCode: appliedCode ? appliedCode.code : null,
      discountAmount: discountAmount || 0,
      additionalAttendees,
      registeredAt: FieldValue.serverTimestamp(),
      ...paymentFields,
    });

    // ── Increment discount usage (read-modify-write the array) ──
    if (appliedCode) {
      const nextCodes = discountCodes.map((d) =>
        d.code.toUpperCase() === appliedCode!.code.toUpperCase()
          ? { ...d, usedCount: (d.usedCount || 0) + 1 }
          : d,
      );
      // The registration is already CONFIRMED at this point, so a swallowed
      // failure here means usedCount never advances — and a code with maxUses
      // becomes effectively unlimited, silently, for every later registrant.
      await eventRef
        .set({ discountCodes: nextCodes }, { merge: true })
        .catch((e) =>
          captureHandledError(e, {
            step: 'event-discount-usage-increment',
            tenantId,
            ids: { eventId, discountCode: appliedCode!.code },
          }),
        );
    }

    // ── Automated SMS confirmation (best-effort) ──
    // Same convention as checkin/submit and pledge/submit: sendAutomatedSms owns
    // the per-trigger enabled flag, the tenant's template text and the smsLogs
    // record, so there is deliberately NO extra enable check here (that would
    // double-gate the trigger). It never throws, so a Twilio outage can't fail
    // or delay the registration response beyond the call itself.
    // Only for a CONFIRMED seat — the template says "you're registered", which
    // would be false for a waitlist entry. Paid tickets are confirmed by the
    // Stripe webhook, not here, so they don't reach this branch.
    if (phone && !waitlisted) {
      const eventDate = event.startDate?.toDate
        ? event.startDate.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      await sendAutomatedSms(tenantId, 'event_registration', phone, {
        name: firstName,
        event: event.title || 'the event',
        date: eventDate,
      });
    }

    // ── Confirmation email (best-effort) ──
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
        const tenantName = tenantSnap.data()?.name || tenantSnap.data()?.displayName || 'Harvest';
        const qrDataUrl = await QRCode.toDataURL(ticketCode, { width: 240, margin: 1 });
        const resend = new Resend(resendKey);
        /**
         * 🔴 THE-351 — THE PAYMENT INSTRUCTION, FOR THE MEMBER WHO WILL NEVER
         * SEE THE IN-APP TICKET.
         *
         * ⚠️ A LOGGED-OUT REGISTRANT CANNOT PRESS "I'VE PAID" — that route
         * requires a verified identity, because a button that could be pressed
         * for anyone else's ticket is a button that puts strangers in a
         * church's inbox. So for them this email IS the whole instruction: what
         * to pay, where the reference goes, and that the church is who decides.
         * The church can still confirm them from the attendee list, which
         * carries the same flag and the same Confirm.
         *
         * ⚠️ IT IS INLINE HERE RATHER THAN THROUGH `transactional-email.ts`,
         * and that is deliberate rather than a twelfth copy: this is an
         * EXISTING send that THE-340 explicitly left alone ("the nine inline
         * copies are left exactly as they are"), it carries an HTML body with
         * an embedded QR that the funnel's text-only signature cannot express,
         * and rewriting a live registration email is not this ticket's risk to
         * take. THE-351's OWN send — the admin notification — goes through the
         * funnel, which is what test 14c asserts.
         */
        const payNote = owesManualPayment
          ? `<p>This ticket costs $${(amount / 100).toFixed(2)}, and ${tenantName} collects it `
            + `directly — Harvest does not handle this money and cannot see it. Pay them using `
            + `the links on their giving page and put <strong>${paymentFields.paymentReference}</strong> `
            + `in the payment note so they can find it. They will mark it paid themselves once `
            + `they have found it in their own account. Bring this ticket either way — you will `
            + `not be turned away at the door.</p>`
          : '';
        const intro = waitlisted
          ? `You're on the waitlist for <strong>${event.title}</strong>. We'll contact you if a spot opens.`
          : `you're registered for <strong>${event.title}</strong>. Your ticket code is <strong>${ticketCode}</strong>.`;
        await resend.emails.send({
          from: 'Harvest <noreply@theharvest.app>',
          to: email,
          subject: `Your registration for ${event.title}`,
          html: `<p>Hi ${firstName}, ${intro}</p>` +
            (waitlisted ? '' : `<p>Present this QR code at the door:</p><p><img src="${qrDataUrl}" alt="Ticket QR" width="200" height="200" /></p>`) +
            payNote +
            `<br><p>— ${tenantName}</p>`,
        });
      } catch (e) {
        // The seat is held but the attendee never receives their ticket QR. The
        // response carries the ticketCode, so the public page can still show it —
        // hence warning rather than error.
        console.warn('Registration confirmation email failed:', e);
        captureHandledError(e, {
          step: 'event-registration-email',
          level: 'warning',
          tenantId,
          ids: { eventId, ticketTypeId },
        });
      }
    }

    // ── CRM activity (best-effort; single-field email query, filter tenant client-side) ──
    try {
      const matchSnap = await adminDb.collection('contacts').where('email', '==', email).limit(20).get();
      const match = matchSnap.docs.find((d) => (d.data().tenantId || null) === tenantId);
      if (match) {
        await adminDb.collection('contactActivities').add({
          contactId: match.id,
          tenantId,
          type: 'meeting',
          description: `Registered: ${event.title}`,
          amount: null,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'event-registration',
        });
      }
    } catch (e) {
      console.warn('Registration CRM activity log failed:', e);
    }

    // THE-351 — the reference travels back so the public success screen can
    // show it to somebody who will never open the in-app ticket. `null` for a
    // free seat, which has no payment to reference.
    return NextResponse.json({
      success: true,
      ticketCode,
      waitlisted,
      paymentReference: paymentFields.paymentReference ?? null,
      amount: owesManualPayment ? amount : 0,
      // THE-355 — 🔴 HANDED BACK ONCE, TO THE PERSON WHO JUST REGISTERED, AND
      // never read back out of Firestore by any other surface. It is how the
      // public page's "I've paid" proves whose registration it is speaking for.
      paymentClaimToken: paymentFields.paymentClaimToken ?? null,
    });
  } catch (e) {
    console.error('Event registration submit error:', e);
    // A public visitor's registration didn't happen. They see a generic failure
    // and go away; the ministry has no signal that anyone ever tried.
    captureHandledError(e, { step: 'event-registration-submit', tenantId, ids: { eventId, ticketTypeId } });
    return NextResponse.json({ error: 'Failed to register' }, { status: 500 });
  }
}
