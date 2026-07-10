import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import Stripe from 'stripe';
import QRCode from 'qrcode';
import { Resend } from 'resend';
import { adminDb } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/api-auth';
import { PLATFORM_FEE_MAP } from '@/lib/stripe-config';

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
    const requiresPayment = amount > 0 && !waitlisted;

    if (requiresPayment) {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        return NextResponse.json({ error: 'Payments are not configured' }, { status: 500 });
      }

      // Connect account + plan live on the tenant doc — the SAME fields donations
      // use (see /api/stripe/donate). Missing account → fail cleanly; NEVER fall
      // back to confirming a paid ticket for free.
      const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
      const tenantData = tenantSnap.data() || {};
      const connectAccountId = tenantData.stripeConnectAccountId;
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

      try {
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          // Single line item carrying the FULL headcount charge (price × quantity −
          // discount). Keeping quantity:1 with the net unit_amount makes the
          // destination charge and the platform fee exact even when a discount
          // applies; the headcount is reflected in the amount and the line name.
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
            transfer_data: { destination: connectAccountId },
            application_fee_amount: applicationFeeAmount,
            metadata,
          },
          success_url: `${origin}/event/${eventId}?registration=success`,
          cancel_url: `${origin}/event/${eventId}?registration=cancel`,
          customer_email: email || undefined,
          metadata,
        });

        return NextResponse.json({ url: session.url });
      } catch (stripeErr) {
        console.error('Event ticket checkout session creation failed:', stripeErr);
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
      status: waitlisted ? 'waitlisted' : 'confirmed',
      waitlisted: !!waitlisted,
      amount,
      quantity,
      discountCode: appliedCode ? appliedCode.code : null,
      discountAmount: discountAmount || 0,
      additionalAttendees,
      registeredAt: FieldValue.serverTimestamp(),
    });

    // ── Increment discount usage (read-modify-write the array) ──
    if (appliedCode) {
      const nextCodes = discountCodes.map((d) =>
        d.code.toUpperCase() === appliedCode!.code.toUpperCase()
          ? { ...d, usedCount: (d.usedCount || 0) + 1 }
          : d,
      );
      await eventRef.set({ discountCodes: nextCodes }, { merge: true }).catch(() => {});
    }

    // ── Confirmation email (best-effort) ──
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
        const tenantName = tenantSnap.data()?.name || tenantSnap.data()?.displayName || 'Harvest';
        const qrDataUrl = await QRCode.toDataURL(ticketCode, { width: 240, margin: 1 });
        const resend = new Resend(resendKey);
        const intro = waitlisted
          ? `You're on the waitlist for <strong>${event.title}</strong>. We'll contact you if a spot opens.`
          : `you're registered for <strong>${event.title}</strong>. Your ticket code is <strong>${ticketCode}</strong>.`;
        await resend.emails.send({
          from: 'Harvest <noreply@theharvest.app>',
          to: email,
          subject: `Your registration for ${event.title}`,
          html: `<p>Hi ${firstName}, ${intro}</p>` +
            (waitlisted ? '' : `<p>Present this QR code at the door:</p><p><img src="${qrDataUrl}" alt="Ticket QR" width="200" height="200" /></p>`) +
            `<br><p>— ${tenantName}</p>`,
        });
      } catch (e) {
        console.warn('Registration confirmation email failed:', e);
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

    return NextResponse.json({ success: true, ticketCode, waitlisted });
  } catch (e) {
    console.error('Event registration submit error:', e);
    return NextResponse.json({ error: 'Failed to register' }, { status: 500 });
  }
}
