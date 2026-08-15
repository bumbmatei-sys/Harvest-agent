import type Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import QRCode from 'qrcode';
import { captureMoneyPathError } from '@/lib/money-path-sentry';

/**
 * Everything a paid event ticket writes down once its Checkout payment
 * completes: the seat flip to `confirmed`, the discount-usage increment, the QR
 * confirmation email, and the CRM timeline entry — plus the oversold refund
 * when the event sold out while the payer was in Checkout.
 *
 * 🔴 WHY THIS IS A MODULE AND NOT PART OF A ROUTE. Paid tickets are now DIRECT
 * charges on the church's connected account (THE-154), so their
 * `checkout.session.completed` is delivered to the CONNECT endpoint
 * (`/api/stripe/connect/webhook`), not the platform one. The platform endpoint
 * still needs the same handler for tickets that were IN FLIGHT as destination
 * charges when this shipped, so two endpoints need identical bookkeeping. Same
 * shape `donation-webhook.ts` took for THE-145: it lives here once, both routes
 * import it. A second copy of the code that confirms a paid seat and issues a
 * ticket code is the duplicated-fact shape this project keeps paying for.
 *
 * ⚠️ THE ONE STRIPE CALL IN HERE IS SCOPED BY THE CALLER. On a direct charge
 * the Session, the PaymentIntent and the Charge all live on the CONNECTED
 * account, so a platform-scoped `refunds.create` 404s — silently, if it is
 * inside a `try`. `requestOptions` is a REQUIRED parameter precisely so no call
 * site can forget to state its scope: the Connect route passes
 * `{ stripeAccount: event.account }`, the platform route passes `undefined`
 * (an in-flight destination charge's PaymentIntent really is on the platform).
 * Everything else here reads from the signature-verified event object or from
 * Firestore, so there is nothing else that can be pointed at the wrong account.
 *
 * ⚠️ AMOUNTS ARE MINOR UNITS. `session.amount_total` and the registration's
 * `amount` are CENTS, exactly as the submit route wrote them; only the rendered
 * email divides by 100.
 */

/** The account scope every Stripe call in this module is made under. */
export type EventRegistrationScope = Stripe.RequestOptions | undefined;

/**
 * Finalize a PAID event-ticket registration after its Stripe Checkout payment
 * completes. This is the ONLY place a paid ticket becomes `confirmed` — the
 * submit route only ever writes `pending_payment` for paid tickets, so a seat
 * cannot be confirmed without a completed payment.
 *
 * Idempotency: the caller's `webhook_events/{event.id}` marker already blocks a
 * redelivered event from re-entering here. As defense-in-depth this also no-ops
 * unless the registration is still `pending_payment`, so a double delivery can
 * never double-confirm, double-increment the discount, double-email, or (on the
 * oversold path) double-refund. That second guard is what carries the weight now
 * that a ticket's events arrive on the Connect endpoint: the marker keys on the
 * EVENT id, and a direct charge emits more than one event for the same money.
 *
 * Oversell: a seat is only held once CONFIRMED. If the event sold out while the
 * payer was in Checkout, we NEVER keep their money — the payment is refunded and
 * the registration cancelled. (A residual race remains if two final webhooks for
 * the last seat are processed truly concurrently; the count is not transactional.
 * The loser is refunded on its next delivery once the winner is confirmed.)
 */
export async function finalizeEventRegistration(opts: {
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  /**
   * 🔴 Required, never defaulted. See the module note: the refund below is the
   * one call that can land on the wrong account, and a default would make
   * forgetting the scope silent.
   */
  requestOptions: EventRegistrationScope;
}): Promise<void> {
  const { stripe, session, requestOptions } = opts;
  const meta = session.metadata || {};
  const tenantId = meta.tenantId;
  const eventId = meta.eventId;
  const ticketTypeId = meta.ticketTypeId;
  const registrationId = meta.registrationId;
  const discountCode = meta.discountCode || '';

  if (!tenantId || !eventId || !ticketTypeId || !registrationId) {
    console.error('event_registration webhook: missing metadata', meta);
    return;
  }

  const regRef = adminDb.collection('tenants').doc(tenantId).collection('registrations').doc(registrationId);
  const regSnap = await regRef.get();
  if (!regSnap.exists) {
    console.error(`event_registration webhook: pending registration ${registrationId} not found (tenant ${tenantId})`);
    return;
  }
  const reg = regSnap.data() || {};
  if (reg.status !== 'pending_payment') {
    // Already finalized (confirmed / cancelled / expired) — idempotent no-op.
    console.log(`event_registration webhook: registration ${registrationId} already '${reg.status}'; skipping`);
    return;
  }

  const paymentIntentId = (session.payment_intent as string) || null;
  const amountPaid = session.amount_total ?? reg.amount ?? 0;

  const eventRef = adminDb.collection('tenants').doc(tenantId).collection('events').doc(eventId);
  const eventSnap = await eventRef.get();
  const eventData = eventSnap.data() || {};
  const ticketTypes: Array<{ id: string; name: string; capacity: number | null }> =
    Array.isArray(eventData.ticketTypes) ? eventData.ticketTypes : [];
  const ticketType = ticketTypes.find((t) => t.id === ticketTypeId) || null;

  // This registration's seat count — a couple/family holds `quantity` seats (BUG 5).
  const regQuantity = Number(reg.quantity) || 1;

  // ── Oversell re-check at confirmation ──
  if (ticketType && ticketType.capacity != null) {
    const regsSnap = await adminDb
      .collection('tenants').doc(tenantId).collection('registrations')
      .where('eventId', '==', eventId)
      .limit(5000)
      .get();
    // Count SEATS already confirmed (sum of quantities), not registrations.
    const confirmedForType = regsSnap.docs.reduce((sum, d) => {
      const r = d.data();
      return r.ticketTypeId === ticketTypeId && r.status === 'confirmed'
        ? sum + (Number(r.quantity) || 1)
        : sum;
    }, 0);

    // Refund unless ALL of this party's seats still fit.
    if (confirmedForType + regQuantity > ticketType.capacity) {
      // Sold out while this payer was in Checkout. Never keep money for a seat
      // they can't have: refund (idempotent so a retry can't double-refund) and
      // cancel. Do NOT confirm, do NOT consume the discount.
      if (paymentIntentId) {
        // 🔴 SCOPED. On a direct charge this PaymentIntent belongs to the church,
        // not to Harvest — a platform-scoped refund 404s and the payer silently
        // keeps neither their seat nor their money. The idempotency key rides in
        // the SAME options object, so the scope can't be dropped by adding one.
        await stripe.refunds.create(
          { payment_intent: paymentIntentId },
          { ...requestOptions, idempotencyKey: `evt_reg_refund_${registrationId}` },
        );
      }
      await regRef.update({
        status: 'cancelled',
        refunded: true,
        refundReason: 'sold_out',
        stripePaymentIntentId: paymentIntentId,
        amountPaid,
        updatedAt: new Date().toISOString(),
      });

      // Best-effort "sold out — you've been refunded" email.
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey && reg.email) {
        try {
          const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
          const tenantName = tenantSnap.data()?.name || tenantSnap.data()?.displayName || 'Harvest';
          const resend = new Resend(resendKey);
          await resend.emails.send({
            from: 'Harvest <noreply@theharvest.app>',
            to: reg.email,
            subject: `Refund for ${eventData.title || 'your registration'}`,
            html: `<p>Hi ${reg.firstName || 'there'}, unfortunately <strong>${eventData.title || 'the event'}</strong> sold out before your payment completed.</p>` +
              `<p>You have <strong>not</strong> been charged — a full refund of $${(amountPaid / 100).toFixed(2)} is on its way back to your card.</p>` +
              `<br><p>— ${tenantName}</p>`,
          });
        } catch (e) {
          console.warn('event_registration webhook: oversold refund email failed:', e);
        }
      }

      console.log(`↩︎ event_registration ${registrationId} refunded (sold out) for tenant ${tenantId}`);
      return;
    }
  }

  // ── Confirm the seat. This flip is the money-critical write; everything after
  // it is best-effort, so a transient failure there won't un-confirm a paid seat
  // (and a redelivery no-ops on the status guard above). ──
  // Retain the logged-in user's uid on the confirmed reg so it shows in their
  // in-app "My Events". The pending doc already carries it (submit stamps the
  // verified uid), and .update() leaves it intact — but we also restore it from
  // the Checkout metadata as a belt-and-suspenders. '' metadata = logged-out.
  const linkedUserId = reg.userId || meta.userId || null;
  await regRef.update({
    status: 'confirmed',
    waitlisted: false,
    stripePaymentIntentId: paymentIntentId,
    amountPaid,
    ...(linkedUserId ? { userId: linkedUserId } : {}),
    confirmedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Increment discount usage now (read-modify-write the array, same as the free
  // path does at submit time). Best-effort, mirroring the submit route.
  if (discountCode) {
    try {
      const codes: Array<{ code: string; usedCount?: number }> =
        Array.isArray(eventData.discountCodes) ? eventData.discountCodes : [];
      const nextCodes = codes.map((d) =>
        d.code?.toUpperCase() === discountCode.toUpperCase()
          ? { ...d, usedCount: (d.usedCount || 0) + 1 }
          : d,
      );
      await eventRef.set({ discountCodes: nextCodes }, { merge: true });
    } catch (e) {
      console.warn('event_registration webhook: discount increment failed:', e);
      // A capped discount code that never records this use can be redeemed past
      // its limit — revenue leakage, and nothing re-attempts the increment.
      captureMoneyPathError(e, {
        step: 'event-registration-discount-increment',
        level: 'warning',
        tenantId,
        ids: { eventId, registrationId, ticketTypeId },
      });
    }
  }

  // QR confirmation email (best-effort) — mirrors the free-path submit email.
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey && reg.email) {
    try {
      const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
      const tenantName = tenantSnap.data()?.name || tenantSnap.data()?.displayName || 'Harvest';
      const qrDataUrl = await QRCode.toDataURL(reg.ticketCode || registrationId, { width: 240, margin: 1 });
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: 'Harvest <noreply@theharvest.app>',
        to: reg.email,
        subject: `Your registration for ${eventData.title}`,
        html: `<p>Hi ${reg.firstName || 'there'}, you're registered for <strong>${eventData.title}</strong>. Your ticket code is <strong>${reg.ticketCode}</strong>.</p>` +
          `<p>Present this QR code at the door:</p><p><img src="${qrDataUrl}" alt="Ticket QR" width="200" height="200" /></p>` +
          `<br><p>— ${tenantName}</p>`,
      });
    } catch (e) {
      console.warn('event_registration webhook: confirmation email failed:', e);
    }
  }

  // CRM activity (best-effort) — mirrors the free-path submit log.
  try {
    if (reg.email) {
      const matchSnap = await adminDb.collection('contacts').where('email', '==', reg.email).limit(20).get();
      const match = matchSnap.docs.find((d) => (d.data().tenantId || null) === tenantId);
      if (match) {
        await adminDb.collection('contactActivities').add({
          contactId: match.id,
          tenantId,
          type: 'meeting',
          description: `Registered: ${eventData.title}`,
          amount: null,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'event-registration',
        });
      }
    }
  } catch (e) {
    console.warn('event_registration webhook: CRM activity log failed:', e);
    // The seat is paid and confirmed, but the tenant's CRM timeline never learns
    // about it — CRM state diverging from a real, completed transaction.
    captureMoneyPathError(e, {
      step: 'event-registration-crm-activity',
      level: 'warning',
      tenantId,
      ids: { eventId, registrationId },
    });
  }

  console.log(`✅ event_registration ${registrationId} confirmed for tenant ${tenantId} ($${(amountPaid / 100).toFixed(2)})`);
}

/**
 * A paid-ticket Checkout the payer abandoned (or that timed out). The pending
 * registration holds no capacity and no discount, so this is only housekeeping:
 * mark it expired so it doesn't linger. Only ever touches a still-pending doc —
 * a confirmed seat is never affected, which is also what makes a redelivery a
 * no-op.
 *
 * No Stripe call at all, so there is no account to scope. Shared for the same
 * reason as the confirm path: both endpoints can receive it.
 */
export async function expireEventRegistration(session: Stripe.Checkout.Session): Promise<void> {
  const { tenantId, registrationId } = (session.metadata || {}) as Record<string, string>;
  if (!tenantId || !registrationId) return;

  const regRef = adminDb
    .collection('tenants').doc(tenantId).collection('registrations').doc(registrationId);
  const snap = await regRef.get();
  if (snap.exists && snap.data()?.status === 'pending_payment') {
    await regRef.update({ status: 'expired', updatedAt: new Date().toISOString() });
    console.log(`⌛ event_registration ${registrationId} expired (checkout abandoned) for tenant ${tenantId}`);
  }
}
