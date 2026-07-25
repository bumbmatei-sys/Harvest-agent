import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateAccessCode } from '@/lib/ai-utils';
import { PLAN_PRICES, getPlanFromPriceId } from '@/lib/stripe-config';
import { setCustomClaims } from '@/lib/set-custom-claims';
import { issueDonationReceipt } from '@/lib/donation-receipt';
import { affiliateSweepIdempotencyKey } from '@/lib/affiliate-payout';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { NON_TENANT_SUBDOMAINS } from '@/utils/non-tenant-subdomains';
import { Resend } from 'resend';
import QRCode from 'qrcode';

export const dynamic = 'force-dynamic';

/**
 * Flat affiliate/referral commission rate — 15% for every plan, every referrer,
 * always. Intentionally replaces the old per-plan ladder (ultra 20% / max 15% /
 * pro 10% / plus 10%): the rate no longer depends on the purchased plan, the
 * referrer's own plan, or whether the referrer is an affiliate vs a church admin.
 * Commission still stops when the referred tenant cancels — that is driven by
 * whether Stripe charges an invoice at all, not by any rate lookup here.
 */
const AFFILIATE_RATE = 0.15;

/**
 * Pay-out the one-time ("initial") affiliate commission for a paid signup/upgrade.
 * Shared by the existing-tenant plan-change path and the build-on-payment new-tenant
 * path. Guards against self-referral and double-paying the same subscription.
 *
 * Order is the money-path invariant: the commission row is written FIRST and the
 * transfer is keyed off its doc id (affiliateSweepIdempotencyKey), so this path,
 * the account.updated sweep and the hourly retry cron all present Stripe ONE key
 * per commission. Two double-pay guards therefore stack:
 *   1. the `stripeSubscriptionId` + type:'initial' guard below, which makes a
 *      redelivered webhook skip the whole block once the row exists; and
 *   2. the shared idempotency key, which collapses any attempt that gets past (1)
 *      — the sweep and the cron legitimately do — onto the original transfer.
 */
async function processInitialAffiliateCommission(opts: {
  stripe: Stripe;
  referrerId: string;
  ownerId: string | null | undefined;
  tenantId: string;
  plan: string;
  amountTotal: number;
  subscriptionId: string;
}): Promise<void> {
  const { stripe, referrerId, ownerId, tenantId, plan, amountTotal, subscriptionId } = opts;

  // No real charge yet (7-day trial signup, or any $0/free checkout): don't pay,
  // don't write a $0 commission doc, and don't inflate affiliateReferralCount. The
  // retry cron re-attempts any lingering $0 doc forever, and an abandoned trial
  // would otherwise leave a phantom referral behind. When the trial converts, the
  // first paid invoice (billing_reason 'subscription_cycle') fires
  // invoice.payment_succeeded → the recurring commission path, which creates the
  // commission and pays the affiliate on the real amount. So this only skips the
  // $0 initial event — never the real conversion.
  if (!amountTotal || amountTotal <= 0) {
    console.log(`⏭️  Skipping initial affiliate commission for ${referrerId}: $0 (trial or free) — will fire on first paid invoice`);
    return;
  }

  if (ownerId && referrerId === ownerId) {
    console.log('⚠️ Self-referral blocked for tenant', tenantId);
    return;
  }

  const existingCommissionSnap = await adminDb.collection('affiliate_commissions')
    .where('stripeSubscriptionId', '==', subscriptionId)
    .limit(10)
    .get();
  const hasInitialCommission = existingCommissionSnap.docs.some(d => d.data().type === 'initial');
  if (hasInitialCommission) {
    console.log('⚠️ Commission already exists for subscription', subscriptionId);
    return;
  }

  const commissionAmount = Math.round((amountTotal || 0) * AFFILIATE_RATE);
  const referrerRef = adminDb.collection('users').doc(referrerId);

  // ── Step 1: RECORD, then pay. ───────────────────────────────────────────────
  // The commission row is created BEFORE any money moves, and the transfer is
  // keyed off that row's id via affiliateSweepIdempotencyKey — the SAME key the
  // account.updated sweep and the hourly retry cron derive. There is deliberately
  // no separate "initial" key any more: a divergent key was the double-pay bug
  // (transfer succeeds → status write fails → row lands `pending` → the sweep
  // re-sends it under `aff_sweep_*`, which Stripe reads as a brand-new request).
  // Every attempt on this commission — webhook redelivery, cron, sweep — now
  // presents one key, so Stripe returns the ORIGINAL transfer instead of a second.
  //
  // The row is created `pending` and the referrer's counters are bumped in the
  // SAME batch, so the two can never desync: a `pending` row always has matching
  // `affiliatePendingPayouts`, which is what makes the sweep's later
  // `increment(-commission)` land on a balance that actually contains it (an
  // un-bumped counter would go negative). `affiliateEarnings` counts the
  // commission once here, at earn time, and is never touched again — sweeping
  // pending→paid moves already-earned money, it is not new earnings.
  const commissionRef = adminDb.collection('affiliate_commissions').doc();
  const recordBatch = adminDb.batch();
  recordBatch.set(commissionRef, {
    referrerId, tenantId, plan,
    amount: amountTotal || 0,
    commission: commissionAmount,
    status: 'pending',
    type: 'initial',
    stripeSubscriptionId: subscriptionId,
    createdAt: new Date().toISOString(),
  });
  recordBatch.update(referrerRef, {
    affiliateEarnings: FieldValue.increment(commissionAmount),
    affiliatePendingPayouts: FieldValue.increment(commissionAmount),
    affiliateReferralCount: FieldValue.increment(1),
    updatedAt: new Date().toISOString(),
  });
  // Deliberately NOT caught: nothing has been paid yet and the batch is atomic, so
  // a failure here leaves zero trace and the redelivered event re-runs it cleanly.
  await recordBatch.commit();

  // ── Step 2: pay it. ─────────────────────────────────────────────────────────
  let commissionStatus = 'pending';
  try {
    const referrerDoc = await referrerRef.get();
    const connectAccountId = referrerDoc.data()?.affiliateStripeAccountId;
    const connectStatus = referrerDoc.data()?.affiliateConnectStatus;
    if (connectAccountId && connectStatus === 'active' && commissionAmount > 0) {
      const transfer = await stripe.transfers.create({
        amount: commissionAmount,
        currency: 'usd',
        destination: connectAccountId,
        metadata: { referrerId, tenantId, plan, type: 'affiliate_commission' },
      }, {
        idempotencyKey: affiliateSweepIdempotencyKey(commissionRef.id),
      });

      // Flip to `paid` and take the amount back out of the pending counter in ONE
      // batch — the same pairing the sweep commits, so the row's status and the
      // counter can never disagree. If this write fails the row stays `pending`
      // with its counter intact, and the sweep re-attempts under the identical
      // idempotency key: Stripe hands back THIS transfer, the flip happens then,
      // and the affiliate is paid exactly once.
      const payBatch = adminDb.batch();
      payBatch.update(commissionRef, {
        status: 'paid',
        stripeTransferId: transfer.id,
        paidAt: new Date().toISOString(),
      });
      payBatch.update(referrerRef, {
        affiliatePendingPayouts: FieldValue.increment(-commissionAmount),
        updatedAt: new Date().toISOString(),
      });
      await payBatch.commit();
      // Assigned only AFTER the write that records it, so the log line (and any
      // future reader of this variable) reflects what is actually in Firestore.
      commissionStatus = 'paid';
    }
    // No `else`: Connect isn't active yet, so there is nowhere to pay to. The row
    // is already banked `pending` above and the sweep pays it at activation —
    // unchanged behaviour, minus the duplicated write.
  } catch (transferErr) {
    console.error('Affiliate transfer failed (will remain pending):', transferErr);
    // `warning`, not `error`: the old "either unpaid or double-paid" ambiguity is
    // gone. The commission row is durable BEFORE the transfer and every retry path
    // keys off its id, so landing here means the payout is merely late — the sweep
    // or the hourly cron re-attempts it under the same key with no double-pay risk.
    captureMoneyPathError(transferErr, {
      step: 'initial-affiliate-transfer',
      level: 'warning',
      tenantId,
      ids: { subscriptionId, referrerId, plan, commissionId: commissionRef.id },
    });
  }
  console.log(`💰 Affiliate commission ${commissionStatus} for referrer ${referrerId}: $${(commissionAmount / 100).toFixed(2)}`);
}

/**
 * The Ministry (ultra) plan includes ONE AI Assistant for the plan owner. It is
 * not a separate subscription — the entitlement rides with the plan
 * (`aiAssistantSource: 'plan'`, no `aiAssistantSubscriptionItemId`).
 *
 * If the owner had separately PURCHASED the add-on before upgrading, their
 * purchased subscription is cancelled here so they aren't double-charged, and
 * the entitlement is converted to plan-included. The doc is marked
 * `aiAssistantSource: 'plan'` BEFORE the cancel so the resulting
 * customer.subscription.deleted event sees a plan-included entitlement and
 * doesn't revoke it; the subscription pointer is cleared only after the cancel
 * succeeds so a failed cancel is retried on webhook redelivery.
 * Never touches an existing Telegram link (aiAssistantConnected/telegramChatId).
 */
async function grantPlanIncludedAssistant(stripe: Stripe, ownerId: string | null | undefined): Promise<void> {
  if (!ownerId) return;
  const ownerRef = adminDb.collection('users').doc(ownerId);
  const ownerSnap = await ownerRef.get();
  const owner = ownerSnap.exists ? ownerSnap.data() : undefined;
  const purchasedSubId = owner?.aiAssistantSubscriptionItemId;

  if (owner?.hasAIAssistant && owner?.aiAssistantSource === 'plan' && !purchasedSubId) {
    return; // already plan-included (webhook redelivery / repeated plan sync)
  }

  await ownerRef.set({
    hasAIAssistant: true,
    aiAssistantSource: 'plan',
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  if (purchasedSubId) {
    try {
      await stripe.subscriptions.cancel(purchasedSubId);
      console.log(`🔄 Cancelled owner ${ownerId}'s purchased AI Assistant subscription ${purchasedSubId} (now included with ultra plan)`);
    } catch (cancelErr: any) {
      // Already cancelled / gone → fine, just clear the pointer below. Anything
      // else (network, 5xx) must bubble so Stripe redelivers and we retry.
      if (cancelErr?.type !== 'StripeInvalidRequestError' && cancelErr?.code !== 'resource_missing') {
        throw cancelErr;
      }
      console.log(`↩︎ Purchased AI Assistant subscription ${purchasedSubId} already cancelled`);
    }
    await ownerRef.set({
      aiAssistantSubscriptionItemId: null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }
  console.log(`✅ Plan-included AI Assistant granted to ultra owner ${ownerId}`);
}

/**
 * Revoke a PLAN-INCLUDED assistant when the tenant's plan leaves ultra
 * (downgrade or plan-subscription cancellation). A separately purchased
 * assistant (`aiAssistantSubscriptionItemId` set) has its own subscription and
 * is left untouched. Legacy ultra grants that predate `aiAssistantSource`
 * (hasAIAssistant with no subscription id) are treated as plan-included.
 */
async function revokePlanIncludedAssistant(ownerId: string | null | undefined): Promise<void> {
  if (!ownerId) return;
  const ownerRef = adminDb.collection('users').doc(ownerId);
  const ownerSnap = await ownerRef.get();
  if (!ownerSnap.exists) return;
  const owner = ownerSnap.data();
  if (!owner?.hasAIAssistant) return;
  const planIncluded = owner.aiAssistantSource === 'plan'
    || (!owner.aiAssistantSource && !owner.aiAssistantSubscriptionItemId);
  if (!planIncluded) return;
  await ownerRef.update({
    hasAIAssistant: false,
    aiAssistantConnected: false,
    telegramUsername: null,
    telegramChatId: null,
    aiAssistantSource: null,
    updatedAt: new Date().toISOString(),
  });
  console.log(`❌ Plan-included AI Assistant revoked for owner ${ownerId} (plan left ultra)`);
}

/**
 * Build-on-payment: turn a ministry name into a unique, free tenant subdomain.
 * Lowercases, keeps [a-z0-9-], collapses whitespace to '-', then appends a short
 * random suffix until no tenant doc exists at that id (and avoids reserved labels).
 */
async function generateUniqueSubdomain(ministryName: string): Promise<string> {
  // Derived from the shared NON_TENANT_SUBDOMAINS (www/app/admin/affiliate) plus
  // the platform-reserved labels, so a non-tenant subdomain is never auto-assigned.
  const RESERVED = new Set([...NON_TENANT_SUBDOMAINS, 'api', 'harvest', 'nations', 'platform']);
  const base = (ministryName || 'ministry')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'ministry';

  let candidate = base;
  for (let i = 0; i < 10; i++) {
    const exists = (await adminDb.collection('tenants').doc(candidate).get()).exists;
    if (!RESERVED.has(candidate) && !exists) return candidate;
    const suffix = Math.random().toString(36).slice(2, 6); // 4 random alphanumerics
    candidate = `${base}-${suffix}`.slice(0, 40);
  }
  return candidate;
}

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
 * oversold path) double-refund.
 *
 * Oversell: a seat is only held once CONFIRMED. If the event sold out while the
 * payer was in Checkout, we NEVER keep their money — the payment is refunded and
 * the registration cancelled. (A residual race remains if two final webhooks for
 * the last seat are processed truly concurrently; the count is not transactional.
 * The loser is refunded on its next delivery once the winner is confirmed.)
 */
async function finalizeEventRegistration(stripe: Stripe, session: Stripe.Checkout.Session): Promise<void> {
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
        await stripe.refunds.create(
          { payment_intent: paymentIntentId },
          { idempotencyKey: `evt_reg_refund_${registrationId}` },
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
 * Link a completed donation to the recipient tenant's CRM. Shared by one-time
 * gifts (payment_intent.succeeded) and monthly partnership first payments
 * (checkout.session.completed, subscription mode) so both behave identically:
 *  - upgrade an existing donor contact (member → both) or create a fresh one,
 *  - stamp the member's OWN users doc (so their profile + the CRM synthetic row
 *    show donor status), only for an app member of THIS tenant (no cross-tenant leak),
 *  - log a 'donation' timeline activity (tenantId is required for it to show).
 *
 * `amountDollars` is DOLLARS (BUG 2) — every totalDonated / activity amount write
 * here is in dollars so a $50 gift reads as $50, not $5,000. `donorUserId` /
 * `donorEmail` come from the signature-verified event metadata, never a client field.
 * Returns the donor's display name for the caller's receipt.
 */
async function linkDonationToCRM(opts: {
  tenantId: string;
  donorUserId: string;
  donorEmail: string;
  donorName: string;
  amountDollars: number;
  nowIso: string;
}): Promise<{ donorDisplayName: string; donorIsTenantMember: boolean }> {
  const { tenantId, donorUserId, donorEmail, donorName, amountDollars, nowIso } = opts;

  // Is the donor a logged-in app member of THIS tenant? Cross-church and anonymous
  // donors are not — they get a donor contact but never a users-doc stamp, so a gift
  // to another church never lands in the donor's own tenant CRM.
  let donorIsTenantMember = false;
  let donorDisplayName = '';
  if (donorUserId) {
    const donorUserSnap = await adminDb.collection('users').doc(donorUserId).get();
    if (donorUserSnap.exists) {
      const du = donorUserSnap.data() || {};
      donorIsTenantMember = (du.tenantId || null) === tenantId;
      donorDisplayName = du.displayName || du.name || '';
    }
  }

  if (donorUserId || donorEmail) {
    // Find an existing CRM contact for this donor, scoped to the recipient tenant.
    // Prefer userId (stable across email changes), fall back to email.
    let candidateDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    if (donorUserId) {
      candidateDocs = (await adminDb.collection('contacts')
        .where('userId', '==', donorUserId).limit(20).get()).docs;
    }
    let existingContactDoc = candidateDocs.find(d => (d.data().tenantId || null) === tenantId);
    if (!existingContactDoc && donorEmail) {
      const byEmail = (await adminDb.collection('contacts')
        .where('email', '==', donorEmail).limit(20).get()).docs;
      existingContactDoc = byEmail.find(d => (d.data().tenantId || null) === tenantId);
    }

    let contactId: string | null = null;
    if (existingContactDoc) {
      const cd = existingContactDoc.data();
      const newType = cd.type === 'member' ? 'both' : (cd.type || 'donor');
      await existingContactDoc.ref.update({
        type: newType,
        totalDonated: FieldValue.increment(amountDollars),
        lastDonationAt: nowIso,
        updatedAt: nowIso,
        // Backfill the uid link so later gifts match by userId even if email differs.
        ...(donorUserId && !cd.userId ? { userId: donorUserId } : {}),
      });
      contactId = existingContactDoc.id;
    } else if (donorIsTenantMember) {
      // App member of this tenant with no manual contact: the CRM synthesizes their
      // row from `users`, so DON'T create a duplicate contact. The users-doc stamp
      // below turns that synthetic row into Donor & Member. Activities attach to the
      // synthetic contact id, which is the user's uid.
      contactId = donorUserId;
    } else if (donorEmail) {
      // Anonymous or cross-church donor: a fresh donor contact in the recipient tenant.
      const nameParts = (donorName || '').trim().split(/\s+/).filter(Boolean);
      const ref = await adminDb.collection('contacts').add({
        firstName: nameParts[0] || '', lastName: nameParts.slice(1).join(' '),
        email: donorEmail, phone: '',
        type: 'donor', userId: donorUserId || '', tenantId,
        totalDonated: amountDollars, lastDonationAt: nowIso,
        memberSince: null, notes: '', tags: [],
        createdAt: nowIso, createdBy: 'system',
      });
      contactId = ref.id;
    }

    // Reflect donor status on the member's own account so the CRM synthetic row AND
    // their in-app profile both show Donor/Partner + total given.
    if (donorIsTenantMember) {
      await adminDb.collection('users').doc(donorUserId).update({
        totalDonated: FieldValue.increment(amountDollars),
        lastDonationAt: nowIso,
        updatedAt: nowIso,
      });
    }

    // CRM timeline entry. tenantId is REQUIRED — useContactActivities filters by it.
    if (contactId) {
      await adminDb.collection('contactActivities').add({
        contactId, tenantId, type: 'donation',
        description: 'Partnership donation via Stripe',
        amount: amountDollars, createdAt: nowIso, createdBy: 'system',
      });
    }
  }

  return { donorDisplayName, donorIsTenantMember };
}

/**
 * Credit a completed donation toward a fundraising campaign's running `raised`
 * total. Nothing wrote `raised` before this, so every campaign's progress bar
 * (`raised / goal`) sat at 0% forever — this is the single writer.
 *
 * Unit: DOLLARS. `goal` is stored in dollars (the create form writes
 * `Number(form.goal)`) and every surface renders `raised`/`goal` through an Intl
 * currency formatter, so `raised` must be dollars too. Callers pass
 * `amountDollars = cents / 100` — a $50 gift moves the bar by $50, never $5,000
 * (raw cents) or $0.50.
 *
 * Idempotency: every caller runs inside the `webhook_events/{event.id}` marker,
 * so a redelivered event never re-enters here and can't double-count. The one
 * place two DISTINCT events cover the same money — a monthly subscription's
 * `checkout.session.completed` and its first `invoice.payment_succeeded` — is
 * de-duplicated by the invoice caller skipping `billing_reason === 'subscription_create'`.
 *
 * Safety: a missing/stray/cross-tenant `campaignId` logs and returns instead of
 * throwing, so a real gift is never lost to a 500 (which would make Stripe
 * redeliver the money event). Campaigns are a top-level collection keyed by id
 * with a `tenantId` field (see /api/campaigns/active), so we update
 * `campaigns/{id}` directly and refuse to credit a campaign that belongs to a
 * different tenant than the one that received the money.
 */
async function incrementCampaignRaised(opts: {
  campaignId: string | undefined;
  tenantId: string | undefined;
  amountDollars: number;
}): Promise<void> {
  const { campaignId, tenantId, amountDollars } = opts;
  if (!campaignId || !(amountDollars > 0)) return;

  const campaignRef = adminDb.collection('campaigns').doc(campaignId);
  const snap = await campaignRef.get();
  if (!snap.exists) {
    console.warn(`campaign raised: campaign ${campaignId} not found; skipping increment`);
    return;
  }

  // The campaignId rode in on client-supplied donate metadata, so only credit it
  // when the campaign actually belongs to the tenant that received the money — a
  // mismatched id must never inflate another tenant's campaign.
  const campaignTenantId = snap.data()?.tenantId || null;
  if (tenantId && campaignTenantId && campaignTenantId !== tenantId) {
    console.warn(`campaign raised: campaign ${campaignId} belongs to tenant ${campaignTenantId}, not ${tenantId}; skipping increment`);
    return;
  }

  await campaignRef.update({
    raised: FieldValue.increment(amountDollars),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`📈 Campaign ${campaignId} raised += $${amountDollars.toFixed(2)} (tenant ${tenantId || 'unknown'})`);
}

/**
 * Finalize a MONTHLY partnership donation — a Stripe *subscription* created by
 * /api/stripe/donate's monthly branch (metadata.type === 'partnership').
 *
 * payment_intent.succeeded (which handles one-time gifts) never fires with
 * partnership metadata for a subscription, so without this a monthly partner's
 * users doc never got `donationSubscriptionId`: Profile showed "no active
 * partnership" (BUG 3) and cancel-partnership always returned "no subscription
 * found" (BUG 4). This writes the partnership pointer to the donor's own users doc
 * (identified by the VERIFIED donorUserId from the signature-verified event) and
 * runs the same CRM donor-linkage as a one-time gift for this FIRST payment.
 *
 * MUST be invoked before the plan-change logic in checkout.session.completed: the
 * donation metadata carries the tenant's own `plan` (for the fee tier), which that
 * path would otherwise mistake for a plan change and cancel + replace the tenant's
 * real subscription. Idempotent via the caller's webhook_events marker.
 *
 * NOTE: this covers only the FIRST payment. Every later month arrives as
 * invoice.payment_succeeded and is recorded by recordPartnershipRenewalDonation
 * below, which mirrors the receipt + CRM writes here.
 */
async function finalizePartnershipSubscription(
  session: Stripe.Checkout.Session,
  sub: Stripe.Subscription | null,
  meta: Record<string, string>,
): Promise<void> {
  const tenantId = meta.tenantId;
  const subscriptionId = (session.subscription as string) || sub?.id || '';
  if (!tenantId || !subscriptionId) {
    console.error('partnership subscription: missing tenantId/subscriptionId', meta);
    return;
  }

  const donorUserId = meta.donorUserId || '';
  const donorEmail = (meta.donorEmail || session.customer_details?.email || session.customer_email || '').trim();
  const nowIso = new Date().toISOString();

  // Monthly amount. Prefer the subscription's price (authoritative), fall back to the
  // checkout total; both are CENTS. Store DOLLARS to match Profile/CRM (BUG 2/3).
  const amountCents = sub?.items?.data?.[0]?.price?.unit_amount ?? session.amount_total ?? 0;
  const amountDollars = amountCents / 100;

  // Church name for the donor's Profile partnership card.
  const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
  const churchName = tenantSnap.data()?.name || tenantSnap.data()?.displayName || meta.donationChurchName || '';

  // Partnership pointer on the donor's OWN users doc → Profile shows an ACTIVE
  // partnership (amount + church) and cancel-partnership can find the subscription.
  if (donorUserId) {
    await adminDb.collection('users').doc(donorUserId).update({
      donationSubscriptionId: subscriptionId,
      donationAmount: amountDollars,   // DOLLARS (BUG 2/3) — Profile shows it directly
      donationChurchId: tenantId,
      donationChurchName: churchName,
      updatedAt: nowIso,
    });
    console.log(`🤝 Partnership subscription ${subscriptionId} linked to donor ${donorUserId} ($${amountDollars}/mo → ${churchName})`);
  } else {
    console.warn(`partnership subscription ${subscriptionId}: no donorUserId in metadata — no partnership pointer written`);
  }

  // Same CRM donor-linkage a one-time gift gets, for this first payment.
  const { donorDisplayName } = await linkDonationToCRM({
    tenantId, donorUserId, donorEmail, donorName: meta.donorName || '',
    amountDollars, nowIso,
  });

  // Donation receipt (CENTS — accounting subsystem), addressed by email.
  if (donorEmail) {
    const recipientName = (meta.donorName || '').trim() || donorDisplayName || donorEmail;
    const receiptNumber = `R-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const invoiceRef = await adminDb.collection('tenants').doc(tenantId).collection('invoices').add({
      type: 'donation_receipt', recipientName, recipientEmail: donorEmail,
      amount: amountCents, currency: sub?.currency || 'usd', description: 'Monthly partnership donation',
      relatedId: subscriptionId, receiptNumber, issuedAt: nowIso,
      tenantName: churchName, pdfUrl: null, status: 'pending',
    });
    // Best-effort thank-you + PDF receipt (never throws — see issueDonationReceipt).
    await issueDonationReceipt({
      tenantId, recipientName, donorEmail, amountCents, currency: sub?.currency || 'usd',
      receiptNumber, tenantName: churchName, issuedAt: nowIso,
      description: 'Monthly partnership donation', invoiceRef,
    });
  }

  // Credit this FIRST monthly payment to the campaign's progress bar when the gift
  // is campaign-designated. Renewals are credited from invoice.payment_succeeded,
  // which skips billing_reason 'subscription_create' so this opening month is not
  // double-counted. No-op when meta.campaignId is absent (general partnership).
  await incrementCampaignRaised({ campaignId: meta.campaignId, tenantId, amountDollars });
}

/**
 * Record a monthly-partnership RENEWAL as a real donation.
 *
 * `finalizePartnershipSubscription` above only runs from checkout.session.completed —
 * the FIRST payment of a subscription. Every later month arrives as
 * invoice.payment_succeeded with billing_reason 'subscription_cycle', which used to
 * write only the affiliate commission and the campaign credit. So a $50/mo partner's
 * annual giving statement — which aggregates `tenants/{t}/invoices` where
 * `type === 'donation_receipt'` and carries the ministry's EIN — showed $50 instead of
 * $600, their `totalDonated` froze after month one, and their CRM timeline held a
 * single entry. This closes that gap (the "roadmap 4a" note above).
 *
 * UNITS — the two writes below are DELIBERATELY in different units, same as the
 * one-time-gift path:
 *   • the `invoices` donation receipt stays in CENTS (`invoice.amount_paid`) — the
 *     accounting subsystem (giving-statements + QuickBooks) reads `amount` as cents;
 *   • `linkDonationToCRM` takes DOLLARS (`invoice.amount_paid / 100`) — totalDonated
 *     and the activity amount are canonically dollars (BUG 2), so $50 reads as $50.
 *   A $50 renewal therefore writes `amount: 5000` and increments totalDonated by `50`.
 *
 * Donor identity comes ONLY from the signature-verified SUBSCRIPTION metadata — the
 * same `donorUserId` / `donorEmail` / `donorName` keys finalizePartnershipSubscription
 * reads — never from the invoice's customer fields. Without a donor email we log and
 * return rather than guess who gave (and a receipt has no one to be addressed to).
 *
 * IDEMPOTENCY: `webhook_events/{event.id}` dedups an identical redelivery, but it is
 * deliberately UNDONE when the handler throws, so a failure later in the request
 * re-enters here — and `linkDonationToCRM` uses `FieldValue.increment`, so re-entry
 * would double-count `totalDonated` and duplicate the tax line. Mirroring the
 * affiliate block's `stripeInvoiceId` dedup, we look for a `donation_receipt` already
 * carrying this invoice id in `relatedId` and skip the WHOLE block — receipt, CRM
 * link, activity — when one exists. The receipt is written FIRST so it *is* that
 * marker: if a later step fails, the retry skips (an undercount at worst) instead of
 * crediting the donor twice.
 */
async function recordPartnershipRenewalDonation(opts: {
  invoice: Stripe.Invoice;
  subMeta: Record<string, string>;
  tenantId: string;
}): Promise<void> {
  const { invoice, subMeta, tenantId } = opts;
  const invoiceId = invoice.id;
  if (!invoiceId) {
    console.warn('partnership renewal: invoice has no id — cannot dedup, not recording');
    return;
  }

  // VERIFIED subscription metadata only. donorEmail is required: it addresses the
  // receipt AND is the key giving-statements aggregates donors by, and the receipt
  // doubles as this block's idempotency marker — without it there is nothing to
  // dedup against on a retry, so we record nothing rather than risk double-counting.
  const donorUserId = subMeta.donorUserId || '';
  const donorEmail = (subMeta.donorEmail || '').trim();
  if (!donorEmail) {
    console.warn(`partnership renewal ${invoiceId}: subscription metadata carries no donorEmail — not recording (refusing to guess the donor)`);
    return;
  }

  const amountCents = invoice.amount_paid || 0;
  if (!(amountCents > 0)) {
    console.log(`partnership renewal ${invoiceId}: $0 invoice — nothing to record`);
    return;
  }

  const invoicesColl = adminDb.collection('tenants').doc(tenantId).collection('invoices');

  // Idempotency gate for the whole block. Single equality filter so no composite
  // index is needed (the giving-statements reader avoids composite queries too);
  // `type` is filtered in memory.
  const existingSnap = await invoicesColl.where('relatedId', '==', invoiceId).limit(10).get();
  if (existingSnap.docs.some(d => d.data()?.type === 'donation_receipt')) {
    console.log(`⚠️ Renewal invoice ${invoiceId} already recorded — skipping receipt + totalDonated credit`);
    return;
  }

  const currency = invoice.currency || 'usd';
  const nowIso = new Date().toISOString();

  const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
  const churchName = tenantSnap.data()?.name
    || tenantSnap.data()?.displayName
    || subMeta.donationChurchName
    || '';

  // Receipt name, resolved exactly as the first payment resolves it: metadata name →
  // the donor's own users-doc displayName → their email.
  let donorDisplayName = '';
  if (donorUserId) {
    const donorUserSnap = await adminDb.collection('users').doc(donorUserId).get();
    const du = donorUserSnap.data() || {};
    donorDisplayName = du.displayName || du.name || '';
  }
  const recipientName = (subMeta.donorName || '').trim() || donorDisplayName || donorEmail;

  // ── Tax line: CENTS. Written first — it is the idempotency marker. `relatedId` is
  // the INVOICE id (not the subscription id) so each month is its own distinct,
  // dedup-able receipt; statements aggregate per-doc `amount`, so twelve monthly
  // receipts total $600 for the year. ──
  const receiptNumber = `R-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const invoiceRef = await invoicesColl.add({
    type: 'donation_receipt', recipientName, recipientEmail: donorEmail,
    amount: amountCents, currency, description: 'Monthly partnership donation',
    relatedId: invoiceId, receiptNumber, issuedAt: nowIso,
    tenantName: churchName, pdfUrl: null, status: 'pending',
  });

  // ── CRM: DOLLARS. Same helper the first payment and one-time gifts use — donor
  // contact upsert, totalDonated increment, lastDonationAt, 'donation' activity.
  // Runs immediately after the marker so a mid-request death can't strand it. ──
  await linkDonationToCRM({
    tenantId, donorUserId, donorEmail, donorName: subMeta.donorName || '',
    amountDollars: amountCents / 100, nowIso,
  });

  // Best-effort thank-you + PDF receipt (never throws — see issueDonationReceipt).
  await issueDonationReceipt({
    tenantId, recipientName, donorEmail, amountCents, currency,
    receiptNumber, tenantName: churchName, issuedAt: nowIso,
    description: 'Monthly partnership donation', invoiceRef,
  });

  console.log(`🧾 Partnership renewal recorded for ${donorEmail}: receipt ${receiptNumber} ($${(amountCents / 100).toFixed(2)}, invoice ${invoiceId})`);
}

export async function POST(request: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    console.error('Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey);

  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency marker + whether THIS invocation wrote it. On failure we undo only
  // a marker of our own — never one left by an earlier successful run (e.g. Stripe
  // redelivers a completed event and the dedup read fails transiently: deleting that
  // marker would let the retry double-process a money event).
  const eventRef = adminDb.collection('webhook_events').doc(event.id);
  let markerWritten = false;

  try {
    const eventDoc = await eventRef.get();
    if (eventDoc.exists) {
      console.log(`⏭️ Skipping duplicate webhook event ${event.id}`);
      return NextResponse.json({ received: true, duplicate: true });
    }
    markerWritten = true; // flipped before the write so an ambiguous set() failure still gets undone
    await eventRef.set({ type: event.type, processedAt: new Date().toISOString() });

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = session.subscription as string | null;

        // Paid event ticket → confirm the pending registration after payment.
        // This is a one-time payment (no subscription) and must not fall through
        // to the plan/donation logic below.
        if (session.metadata?.type === 'event_registration') {
          await finalizeEventRegistration(stripe, session);
          break;
        }

        let meta: Record<string, string> = {};
        let subObj: Stripe.Subscription | null = null;
        if (subscriptionId) {
          try {
            subObj = await stripe.subscriptions.retrieve(subscriptionId);
            meta = (subObj.metadata || {}) as Record<string, string>;
          } catch (subErr) {
            console.error('Failed to retrieve subscription metadata:', subErr);
            // Captured even though this path already 503s for a retry: a paying
            // signup is stalled until a redelivery succeeds, and a persistent
            // failure means no new ministry can be provisioned at all. Retries of
            // the same event land in this one issue rather than opening new ones.
            captureMoneyPathError(subErr, {
              step: 'subscription-metadata-load',
              level: 'warning',
              eventId: event.id,
              eventType: event.type,
              ids: { subscriptionId },
            });
            // Without metadata we can't tell a new-ministry signup from an upgrade,
            // and would silently strand a paying customer (no tenant created). Undo
            // the idempotency marker and 5xx so Stripe redelivers this event.
            await eventRef.delete().catch(() => { /* best effort */ });
            return NextResponse.json({ error: 'Could not load subscription metadata; will retry' }, { status: 503 });
          }
        }

        const tenantId = meta.tenantId;
        const userId = meta.userId;

        // Monthly partnership donation (a Stripe subscription). MUST be handled
        // BEFORE the plan-change logic below — the donation metadata carries the
        // tenant's own `plan` (for the fee tier), which that path would otherwise
        // mistake for a plan change and cancel + replace the tenant's real plan
        // subscription. This writes the donor's partnership pointer (BUG 3/4).
        if (meta.type === 'partnership' && subscriptionId) {
          await finalizePartnershipSubscription(session, subObj, meta);
          break;
        }

        // Handle standalone AI Assistant purchase (from theharvest.site)
        if (meta.type === 'standalone_ai_assistant' && subscriptionId) {
          const standaloneEmail = meta.email;
          if (!standaloneEmail) {
            console.error('Standalone AI checkout: No email in metadata');
            break;
          }

          let standaloneUid: string;
          try {
            const existingUser = await adminAuth.getUserByEmail(standaloneEmail);
            standaloneUid = existingUser.uid;
          } catch {
            const newUser = await adminAuth.createUser({ email: standaloneEmail, emailVerified: true });
            standaloneUid = newUser.uid;
          }

          const platformTenantId = process.env.PLATFORM_TENANT_ID || 'platform';
          const userRef = adminDb.collection('users').doc(standaloneUid);
          const standaloneUserDoc = await userRef.get();
          if (!standaloneUserDoc.exists) {
            await userRef.set({
              email: standaloneEmail,
              hasAIAssistant: true,
              role: 'standalone_ai_user',
              tenantId: platformTenantId,
              aiAssistantConnected: false,
              telegramChatId: null,
              telegramUsername: null,
              aiAssistantSubscriptionItemId: subscriptionId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          } else {
            await userRef.update({
              hasAIAssistant: true,
              aiAssistantSubscriptionItemId: subscriptionId,
              updatedAt: new Date().toISOString(),
            });
          }

          const customToken = await adminAuth.createCustomToken(standaloneUid);
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
          const magicLink = `${baseUrl}/ai-assistant?token=${customToken}`;

          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey) {
            const resend = new Resend(resendKey);
            await resend.emails.send({
              from: 'Harvest <noreply@theharvest.app>',
              to: standaloneEmail,
              subject: 'Welcome to your Harvest AI Assistant',
              html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="color:#d4a017;font-size:24px;margin-bottom:8px">Welcome to Harvest AI Assistant</h2><p style="color:#555;margin-bottom:24px">Your subscription is confirmed! Click below to connect your personal AI assistant to Telegram.</p><a href="${magicLink}" style="display:inline-block;background:#d4a017;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Activate My AI Assistant</a><p style="color:#999;font-size:12px;margin-top:24px">This link expires in 1 hour. You can request a new one at <a href="${baseUrl}/ai-assistant" style="color:#d4a017">${baseUrl}/ai-assistant</a></p></div>`,
            });
          }

          console.log(`✅ Standalone AI Assistant activated for ${standaloneEmail}`);
          break;
        }

        // ── Build-on-payment: CREATE the tenant for a brand-new ministry. ─────
        // Clients can no longer create tenants (firestore.rules); the paying
        // signup arrives here with `newTenant: 'true'` and no tenantId, so the
        // Admin SDK builds the account, makes the payer its admin, and mints
        // their claim. Plan changes on an existing tenant carry `tenantId` and
        // fall through to the block below — unchanged.
        if (meta.newTenant === 'true' && !tenantId && subscriptionId && meta.userId && meta.plan) {
          // Idempotency / safety: if this user already has a tenant (a prior
          // checkout already built one, or they belong to an org), don't build a
          // second one and overwrite their account. The webhook_events dedup
          // covers redelivery of the SAME event; this covers a distinct second
          // paid session for the same user.
          const existingUserSnap = await adminDb.collection('users').doc(meta.userId).get();
          if (existingUserSnap.exists && existingUserSnap.data()?.tenantId) {
            console.log(`⏭️ User ${meta.userId} already has tenant ${existingUserSnap.data()?.tenantId}; skipping new-tenant build`);
            break;
          }

          const newTenantId = await generateUniqueSubdomain(meta.ministryName || '');

          // Paying user's email — from Firebase Auth, falling back to the customer.
          let userEmail = '';
          try {
            const u = await adminAuth.getUser(meta.userId);
            userEmail = u.email || '';
          } catch (userErr) {
            console.error('new-tenant: failed to load paying user:', userErr);
            // No email → the new tenant is created with an empty `adminEmails`,
            // which is what finish-setup authorizes the owner against. The Stripe
            // customer fallback below may still fill it in, hence `warning`.
            captureMoneyPathError(userErr, {
              step: 'new-tenant-load-paying-user',
              level: 'warning',
              eventId: event.id,
              eventType: event.type,
              ids: { subscriptionId, userId: meta.userId, newTenantId },
            });
          }
          if (!userEmail && session.customer) {
            try {
              const cust = await stripe.customers.retrieve(session.customer as string);
              if (cust && !(cust as any).deleted) userEmail = (cust as Stripe.Customer).email || '';
            } catch (custErr) {
              /* best effort */
              // Silent until now. Both email sources having failed leaves the new
              // tenant with no `adminEmails` entry for its own paying owner.
              captureMoneyPathError(custErr, {
                step: 'new-tenant-load-stripe-customer-email',
                level: 'warning',
                eventId: event.id,
                eventType: event.type,
                ids: {
                  subscriptionId,
                  userId: meta.userId,
                  newTenantId,
                  stripeCustomerId: session.customer as string,
                },
              });
            }
          }

          const now = new Date().toISOString();
          await adminDb.collection('tenants').doc(newTenantId).set({
            name: meta.ministryName || 'My Ministry',
            subdomain: newTenantId,
            plan: meta.plan,
            status: 'active',
            config: {},
            adminEmails: userEmail ? [userEmail] : [],
            ownerId: meta.userId,
            createdBy: meta.userId,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: meta.billing === 'yearly'
              ? getYearlyPriceId(meta.plan)
              : getMonthlyPriceId(meta.plan),
            setupCompleted: false, // gates the first-run "Finish setup" screen
            createdAt: now,
            updatedAt: now,
          });

          // Tag the subscription with the new tenant id so later lifecycle
          // events (subscription.updated/deleted, invoice.*) resolve to it — the
          // subscription was created before the tenant existed, so it had none.
          // Stripe metadata updates REPLACE the whole object, so spread the
          // existing metadata (already retrieved above as `meta`) rather than
          // dropping it. Critically this preserves `referrerId` — the recurring-
          // commission path reads it to decide whether to pay the affiliate at
          // all, so replacing metadata here would silently kill the affiliate's
          // recurring stream at the first renewal — plus `plan`/`billing`, which
          // stay useful for reporting.
          try {
            await stripe.subscriptions.update(subscriptionId, { metadata: { ...meta, tenantId: newTenantId } });
          } catch (metaErr) {
            console.error('new-tenant: failed to tag subscription with tenantId:', metaErr);
            // Permanent and unretried: an untagged subscription means every later
            // lifecycle event (subscription.updated/deleted, invoice.*) fails to
            // resolve this tenant — no downgrade on cancellation, no reactivation
            // on payment, and no recurring affiliate commission.
            captureMoneyPathError(metaErr, {
              step: 'new-tenant-tag-subscription',
              level: 'error',
              tenantId: newTenantId,
              eventId: event.id,
              eventType: event.type,
              ids: { subscriptionId, referrerId: meta.referrerId },
            });
          }

          // Assign the paying user as admin and mint their claim.
          await adminDb.collection('users').doc(meta.userId).update({
            tenantId: newTenantId,
            role: 'admin',
            plan: meta.plan,
            onboardingCompleted: true,
            signupInProgress: false,
            updatedAt: now,
          });
          await setCustomClaims(meta.userId);

          // Ministry plan includes one AI Assistant for the plan owner.
          if (meta.plan === 'ultra') {
            await grantPlanIncludedAssistant(stripe, meta.userId);
          }

          // Affiliate commission for this paid signup (owner = the paying user).
          if (meta.referrerId) {
            await processInitialAffiliateCommission({
              stripe,
              referrerId: meta.referrerId,
              ownerId: meta.userId,
              tenantId: newTenantId,
              plan: meta.plan,
              amountTotal: session.amount_total || 0,
              subscriptionId,
            });
          }

          console.log(`✅ Created tenant ${newTenantId} for new ministry "${meta.ministryName}" (admin ${meta.userId})`);
          break;
        }

        if (tenantId && subscriptionId) {
          if (meta.addOn === 'ai-assistant') {
            const accessCode = generateAccessCode();
            await adminDb.collection('tenants').doc(tenantId).update({
              addOnAiAssistant: subscriptionId,
              addOnAiAssistantCode: accessCode,
              updatedAt: new Date().toISOString(),
            });
            // Update per-user hasAIAssistant flag. The add-on bills the buyer's
            // OWN Stripe customer (not the tenant's) — store it so the buyer's
            // billing portal (/api/ai-assistant/portal) can open it later.
            if (userId) {
              await adminDb.collection('users').doc(userId).update({
                hasAIAssistant: true,
                aiAssistantSubscriptionItemId: subscriptionId,
                ...(session.customer ? { aiAssistantCustomerId: session.customer as string } : {}),
                updatedAt: new Date().toISOString(),
              });
            }
            console.log(`✅ Tenant ${tenantId} added AI Assistant add-on (code: ${accessCode})`);
          } else {
            const plan = meta.plan;
            if (plan) {
              const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
              const oldSubId = tenantDoc.data()?.stripeSubscriptionId;
              if (oldSubId && oldSubId !== subscriptionId) {
                try {
                  await stripe.subscriptions.cancel(oldSubId);
                  console.log(`🔄 Cancelled old subscription ${oldSubId} for tenant ${tenantId}`);
                } catch (cancelErr) {
                  console.error(`Failed to cancel old subscription ${oldSubId}:`, cancelErr);
                  // The tenant now has TWO live subscriptions and is being billed
                  // for both. Nothing retries this — the tenant doc has already
                  // moved to the new subscription id.
                  captureMoneyPathError(cancelErr, {
                    step: 'plan-change-cancel-old-subscription',
                    level: 'error',
                    tenantId,
                    eventId: event.id,
                    eventType: event.type,
                    ids: { oldSubscriptionId: oldSubId, newSubscriptionId: subscriptionId, plan },
                  });
                }
              }

              const updateData: Record<string, any> = {
                plan,
                status: 'active',
                stripeSubscriptionId: subscriptionId,
                stripeCustomerId: session.customer as string,
                stripePriceId: meta.billing === 'yearly'
                  ? getYearlyPriceId(plan)
                  : getMonthlyPriceId(plan),
                updatedAt: new Date().toISOString(),
              };

              if (plan === 'ultra' && !tenantDoc.data()?.addOnAiAssistantCode) {
                updateData.addOnAiAssistantCode = generateAccessCode();
              }

              await adminDb.collection('tenants').doc(tenantId).update(updateData);

              const referrerId = meta.referrerId;
              if (referrerId) {
                const tenantOwner = tenantDoc.data()?.ownerId || tenantDoc.data()?.createdBy;
                await processInitialAffiliateCommission({
                  stripe,
                  referrerId,
                  ownerId: tenantOwner,
                  tenantId,
                  plan,
                  amountTotal: session.amount_total || 0,
                  subscriptionId,
                });
              }

              const usersSnap = await adminDb.collection('users')
                .where('tenantId', '==', tenantId)
                .get();
              const batch = adminDb.batch();
              usersSnap.docs.forEach(doc => {
                batch.update(doc.ref, { plan });
              });
              await batch.commit();

              // Ministry plan includes one AI Assistant for the plan owner:
              // grant it on arrival at ultra, revoke a plan-included one when
              // the plan moves anywhere else (a purchased one survives).
              const planOwnerId = tenantDoc.data()?.ownerId || tenantDoc.data()?.createdBy;
              if (plan === 'ultra') {
                await grantPlanIncludedAssistant(stripe, planOwnerId);
              } else {
                await revokePlanIncludedAssistant(planOwnerId);
              }

              console.log(`✅ Tenant ${tenantId} upgraded to ${plan}`);
            }
          }
        }
        break;
      }

      case 'checkout.session.expired': {
        // A paid-ticket Checkout the payer abandoned (or that timed out). The
        // pending registration holds no capacity and no discount, so this is only
        // housekeeping: mark it expired so it doesn't linger. Only ever touches a
        // still-pending doc — a confirmed seat is never affected.
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.type === 'event_registration') {
          const { tenantId, registrationId } = session.metadata;
          if (tenantId && registrationId) {
            const regRef = adminDb
              .collection('tenants').doc(tenantId).collection('registrations').doc(registrationId);
            const snap = await regRef.get();
            if (snap.exists && snap.data()?.status === 'pending_payment') {
              await regRef.update({ status: 'expired', updatedAt: new Date().toISOString() });
              console.log(`⌛ event_registration ${registrationId} expired (checkout abandoned) for tenant ${tenantId}`);
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenantId;

        // The per-admin AI Assistant add-on carries tenantId metadata too, but it
        // must never drive tenant plan/status. Updates (e.g. cancel_at_period_end
        // set in the buyer's portal) need no state change — entitlement is revoked
        // by customer.subscription.deleted when the cancellation takes effect.
        if (subscription.metadata?.addOn === 'ai-assistant') {
          console.log(`📝 AI Assistant add-on subscription ${subscription.id} updated (status: ${subscription.status}) — no tenant change`);
          break;
        }

        if (tenantId) {
          // Ignore updates for a stale subscription (e.g. the old plan being cancelled
          // during an upgrade) — only the tenant's current subscription drives state.
          const updTenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
          const updCurrentSubId = updTenantSnap.data()?.stripeSubscriptionId;
          if (updCurrentSubId && updCurrentSubId !== subscription.id) {
            console.log(`↩︎ Ignoring stale subscription update ${subscription.id} for tenant ${tenantId} (current ${updCurrentSubId})`);
            break;
          }
          const updateData: Record<string, unknown> = {
            stripeSubscriptionId: subscription.id,
            updatedAt: new Date().toISOString(),
          };

          let plan = subscription.metadata?.plan || null;
          if (!plan && subscription.items?.data?.[0]?.price?.id) {
            plan = getPlanFromPriceId(subscription.items.data[0].price.id);
          }
          if (plan) updateData.plan = plan;

          if (subscription.status === 'active') updateData.status = 'active';
          else if (subscription.status === 'past_due') updateData.status = 'past_due';
          else if (subscription.status === 'canceled') updateData.status = 'cancelled';

          await adminDb.collection('tenants').doc(tenantId).update(updateData);

          if (plan) {
            const usersSnap = await adminDb.collection('users')
              .where('tenantId', '==', tenantId)
              .get();
            const batch = adminDb.batch();
            usersSnap.docs.forEach(doc => {
              batch.update(doc.ref, { plan });
            });
            await batch.commit();

            // Keep the owner's plan-included AI Assistant in sync with the plan.
            const updOwnerId = updTenantSnap.data()?.ownerId || updTenantSnap.data()?.createdBy;
            if (plan === 'ultra') {
              await grantPlanIncludedAssistant(stripe, updOwnerId);
            } else {
              await revokePlanIncludedAssistant(updOwnerId);
            }
          }

          console.log(`📝 Subscription updated for tenant ${tenantId}`, plan ? `→ ${plan}` : '');
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenantId;
        const addOn = subscription.metadata?.addOn;
        const delUserId = subscription.metadata?.userId;
        const subType = subscription.metadata?.type;

        // Handle standalone AI Assistant cancellation
        if (subType === 'standalone_ai_assistant') {
          const standaloneEmail = subscription.metadata?.email;
          if (standaloneEmail) {
            try {
              const standaloneUser = await adminAuth.getUserByEmail(standaloneEmail);
              await adminDb.collection('users').doc(standaloneUser.uid).update({
                hasAIAssistant: false,
                aiAssistantConnected: false,
                telegramChatId: null,
                aiAssistantSubscriptionItemId: null,
                updatedAt: new Date().toISOString(),
              });
              console.log(`❌ Standalone AI Assistant cancelled for ${standaloneEmail}`);
            } catch (standaloneErr) {
              console.error('Failed to revoke standalone AI Assistant:', standaloneErr);
              // The subscription is gone but the entitlement isn't: the customer
              // keeps a paid AI Assistant they no longer pay for, and nothing
              // re-attempts the revocation.
              captureMoneyPathError(standaloneErr, {
                step: 'standalone-assistant-revoke',
                level: 'error',
                eventId: event.id,
                eventType: event.type,
                ids: { subscriptionId: subscription.id },
              });
            }
          }
          break;
        }

        // Handle AI Assistant add-on cancellation (fired when the buyer cancels
        // in their Stripe portal, or when we cancel a purchased sub on upgrade
        // to ultra). This must never fall through to the tenant-downgrade logic
        // below — that path is only for the plan subscription.
        if (addOn === 'ai-assistant') {
          const revokeFields = {
            hasAIAssistant: false,
            aiAssistantConnected: false,
            telegramUsername: null,
            telegramChatId: null,
            aiAssistantSubscriptionItemId: null,
            updatedAt: new Date().toISOString(),
          };
          if (delUserId) {
            const buyerRef = adminDb.collection('users').doc(delUserId);
            const buyerSnap = await buyerRef.get();
            const buyer = buyerSnap.exists ? buyerSnap.data() : undefined;
            // Skip if the entitlement no longer rides on this subscription: it
            // became plan-included (owner upgraded to ultra — the purchased sub
            // was cancelled deliberately), or the user re-purchased under a
            // newer subscription id.
            const planIncluded = buyer?.aiAssistantSource === 'plan';
            const stale = buyer?.aiAssistantSubscriptionItemId
              && buyer.aiAssistantSubscriptionItemId !== subscription.id;
            if (planIncluded || stale) {
              console.log(`↩︎ Skipping AI Assistant revocation for ${delUserId}: entitlement is ${planIncluded ? 'plan-included' : 'on a newer subscription'}`);
              break;
            }
            await buyerRef.update(revokeFields);
          } else {
            const affectedSnap = await adminDb.collection('users')
              .where('aiAssistantSubscriptionItemId', '==', subscription.id)
              .limit(10).get();
            if (!affectedSnap.empty) {
              const b = adminDb.batch();
              affectedSnap.docs.forEach(d => b.update(d.ref, revokeFields));
              await b.commit();
            }
          }

          // Legacy access-code flow: clear the tenant-level add-on state only if
          // it belongs to THIS subscription — another admin's add-on (or an
          // ultra plan's included code) must survive one buyer's cancellation.
          if (tenantId) {
            const addOnTenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
            if (addOnTenantSnap.exists && addOnTenantSnap.data()?.addOnAiAssistant === subscription.id) {
              const bindingsSnap = await adminDb.collection('ai_assistant_bindings')
                .where('tenantId', '==', tenantId).get();
              if (!bindingsSnap.empty) {
                const b2 = adminDb.batch();
                bindingsSnap.docs.forEach(d => b2.delete(d.ref));
                await b2.commit();
              }
              await adminDb.collection('tenants').doc(tenantId).update({
                addOnAiAssistant: null,
                addOnAiAssistantCode: null,
                updatedAt: new Date().toISOString(),
              });
            }
          }
          console.log(`❌ AI Assistant add-on cancelled (user: ${delUserId || 'unknown'}, tenant: ${tenantId || 'none'})`);
          break;
        }

        if (tenantId) {
          // Only the tenant's CURRENT subscription ending should downgrade them.
          // During an upgrade we deliberately cancel the OLD subscription after moving
          // the tenant to the new one — that stale cancellation must NOT reset the plan.
          const delTenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
          const delCurrentSubId = delTenantSnap.data()?.stripeSubscriptionId;
          if (delCurrentSubId && delCurrentSubId !== subscription.id) {
            console.log(`↩︎ Ignoring stale subscription deletion ${subscription.id} for tenant ${tenantId} (current ${delCurrentSubId})`);
            break;
          }
          await adminDb.collection('tenants').doc(tenantId).update({
            plan: 'plus',
            status: 'cancelled',
            stripeSubscriptionId: null,
            updatedAt: new Date().toISOString(),
          });

          const usersSnap = await adminDb.collection('users')
            .where('tenantId', '==', tenantId)
            .get();
          const batch = adminDb.batch();
          usersSnap.docs.forEach(doc => {
            batch.update(doc.ref, { plan: 'plus' });
          });
          await batch.commit();

          // Cancelling the plan cancels the plan-included assistant with it
          // (a separately purchased one keeps its own subscription).
          await revokePlanIncludedAssistant(
            delTenantSnap.data()?.ownerId || delTenantSnap.data()?.createdBy,
          );

          console.log(`❌ Tenant ${tenantId} subscription cancelled, downgraded to plus`);

          // Mark any pending affiliate commissions for this subscription as inactive
          try {
            const referrerId = subscription.metadata?.referrerId;
            if (referrerId) {
              await adminDb.collection('users').doc(referrerId).update({
                // Decrement active referral count if it's tracked separately in future
                // For now, add a cancellation record for the dashboard
                updatedAt: new Date().toISOString(),
              });
              await adminDb.collection('affiliate_commissions').add({
                referrerId,
                tenantId,
                plan: subscription.metadata?.plan || 'unknown',
                amount: 0,
                commission: 0,
                status: 'cancelled',
                type: 'cancellation',
                stripeSubscriptionId: subscription.id,
                createdAt: new Date().toISOString(),
              });
              console.log(`📭 Affiliate commission stream ended for referrer ${referrerId} (tenant ${tenantId} cancelled)`);
            }
          } catch (cancelCommissionErr) {
            console.error('Failed to record commission cancellation:', cancelCommissionErr);
            // No money moves here — the affiliate's dashboard just keeps showing a
            // commission stream that has actually ended.
            captureMoneyPathError(cancelCommissionErr, {
              step: 'affiliate-commission-cancellation-record',
              level: 'warning',
              tenantId,
              eventId: event.id,
              eventType: event.type,
              ids: {
                subscriptionId: subscription.id,
                referrerId: subscription.metadata?.referrerId,
              },
            });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const invSubId = invoice.subscription as string | null;
        if (invSubId) {
          try {
            const sub = await stripe.subscriptions.retrieve(invSubId);
            const tenantId = sub.metadata?.tenantId;
            if (tenantId) {
              await adminDb.collection('tenants').doc(tenantId).update({
                status: 'suspended',
                updatedAt: new Date().toISOString(),
              });
              console.log(`⚠️ Payment failed for tenant ${tenantId}`);
            }
          } catch (subErr) {
            console.error('Failed to retrieve subscription for invoice.payment_failed:', subErr);
            // The tenant is NOT suspended despite a failed payment, so they keep
            // full access while unpaid. `warning`: Stripe fires this event again on
            // each dunning attempt, and the terminal state still arrives as
            // customer.subscription.deleted.
            captureMoneyPathError(subErr, {
              step: 'invoice-payment-failed-subscription-load',
              level: 'warning',
              eventId: event.id,
              eventType: event.type,
              ids: { subscriptionId: invSubId, invoiceId: invoice.id },
            });
          }
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceSubId = invoice.subscription as string | null;
        let tenantId: string | null = null;
        let subMeta: Record<string, string> = {};
        if (invoiceSubId) {
          try {
            const sub = await stripe.subscriptions.retrieve(invoiceSubId);
            subMeta = (sub.metadata || {}) as Record<string, string>;
            tenantId = subMeta.tenantId || null;
          } catch (subErr) {
            console.error('Failed to retrieve subscription for invoice.payment_succeeded:', subErr);
            // `tenantId` stays null, so EVERYTHING this event should have done is
            // skipped — reactivation from suspended, the recurring affiliate
            // commission, the renewal donation receipt, the campaign credit — and
            // the handler still returns 200, so Stripe never redelivers it.
            captureMoneyPathError(subErr, {
              step: 'invoice-payment-succeeded-subscription-load',
              level: 'error',
              eventId: event.id,
              eventType: event.type,
              ids: { subscriptionId: invoiceSubId, invoiceId: invoice.id },
            });
          }
        }
        if (tenantId) {
          const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
          if (!!tenantDoc.exists && tenantDoc.data()?.status === 'suspended') {
            await adminDb.collection('tenants').doc(tenantId).update({
              status: 'active',
              updatedAt: new Date().toISOString(),
            });
            console.log(`✅ Tenant ${tenantId} reactivated after successful payment`);
          }

          const billingReason = (invoice as any).billing_reason;
          if (invoiceSubId && billingReason !== 'subscription_create') {
            try {
              const subscription = await stripe.subscriptions.retrieve(invoiceSubId);
              const referrerId = subscription.metadata?.referrerId;
              if (referrerId) {
                const existingCommission = await adminDb.collection('affiliate_commissions')
                  .where('stripeInvoiceId', '==', invoice.id)
                  .limit(1)
                  .get();
                if (!existingCommission.empty) {
                  console.log('⚠️ Commission already exists for invoice', invoice.id);
                } else {
                  const commissionAmount = Math.round((invoice.amount_paid || 0) * AFFILIATE_RATE);
                  let commissionStatus = 'pending';
                  let stripeTransferId: string | undefined;
                  try {
                    const referrerDoc = await adminDb.collection('users').doc(referrerId).get();
                    const connectAccountId = referrerDoc.data()?.affiliateStripeAccountId;
                    const connectStatus = referrerDoc.data()?.affiliateConnectStatus;
                    if (connectAccountId && connectStatus === 'active' && commissionAmount > 0) {
                      const transfer = await stripe.transfers.create({
                        amount: commissionAmount,
                        currency: 'usd',
                        destination: connectAccountId,
                        metadata: { referrerId, tenantId, plan: subscription.metadata?.plan || 'unknown', type: 'affiliate_commission_recurring' },
                      });
                      commissionStatus = 'paid';
                      stripeTransferId = transfer.id;
                    }
                  } catch (transferErr) {
                    console.error('Affiliate recurring transfer failed:', transferErr);
                    // `error`, not `warning`: this transfer carries NO idempotency
                    // key, so a caught error (a timeout in particular) does not
                    // reliably mean the money stayed put — the commission is
                    // recorded `pending` either way and the keyed retry sweep would
                    // then send a second, differently-keyed transfer.
                    captureMoneyPathError(transferErr, {
                      step: 'recurring-affiliate-transfer',
                      level: 'error',
                      tenantId,
                      eventId: event.id,
                      eventType: event.type,
                      ids: {
                        subscriptionId: invoiceSubId,
                        invoiceId: invoice.id,
                        referrerId,
                      },
                    });
                  }
                  await adminDb.collection('affiliate_commissions').add({
                    referrerId, tenantId,
                    plan: subscription.metadata?.plan || 'unknown',
                    amount: invoice.amount_paid || 0,
                    commission: commissionAmount,
                    status: commissionStatus,
                    type: 'recurring',
                    stripeSubscriptionId: invoiceSubId,
                    stripeInvoiceId: invoice.id,
                    ...(stripeTransferId ? { stripeTransferId } : {}),
                    createdAt: new Date().toISOString(),
                  });
                  await adminDb.collection('users').doc(referrerId).update({
                    affiliateEarnings: FieldValue.increment(commissionAmount),
                    affiliatePendingPayouts: commissionStatus === 'paid'
                      ? FieldValue.increment(0)
                      : FieldValue.increment(commissionAmount),
                    updatedAt: new Date().toISOString(),
                  });
                  console.log(`💰 Recurring affiliate commission ${commissionStatus} for referrer ${referrerId}: $${(commissionAmount / 100).toFixed(2)}`);
                }
              }
            } catch (subErr) {
              console.error('Failed to check subscription for affiliate commission:', subErr);
              // Wraps the whole recurring-commission block, transfer included: the
              // affiliate may have been PAID above and then had the commission-doc
              // write or the earnings-counter update fail, leaving money moved with
              // no record of it. Returns 200, so nothing retries.
              captureMoneyPathError(subErr, {
                step: 'recurring-affiliate-commission',
                level: 'error',
                tenantId,
                eventId: event.id,
                eventType: event.type,
                ids: { subscriptionId: invoiceSubId, invoiceId: invoice.id },
              });
            }
          }

          // Recurring monthly-partnership gift toward a fundraising campaign: credit
          // each RENEWAL to the campaign's running total. The FIRST payment
          // (billing_reason 'subscription_create') is already credited by
          // checkout.session.completed's finalizePartnershipSubscription, so skip it
          // here — the two are DISTINCT events (different event.id), so the
          // webhook_events marker cannot dedup across them; this guard is what stops
          // the opening month from counting twice.
          const isPartnershipRenewal =
            subMeta.type === 'partnership' &&
            (invoice as any).billing_reason !== 'subscription_create';

          if (isPartnershipRenewal && subMeta.campaignId) {
            await incrementCampaignRaised({
              campaignId: subMeta.campaignId,
              tenantId: subMeta.tenantId,
              amountDollars: (invoice.amount_paid || 0) / 100,
            });
          }

          // Record the renewal as an actual donation: the `donation_receipt` tax line
          // (CENTS) plus the donor's totalDonated / timeline entry (DOLLARS). Same
          // renewal gate as the campaign credit above — partnership subscriptions
          // only, opening month excluded — but deliberately NOT narrowed to
          // campaign-designated gifts: a general monthly partnership (campaignId '')
          // belongs on the annual giving statement just as much as a campaign one,
          // and it is the common case. A church's own plan-renewal invoice carries no
          // `type: 'partnership'` metadata, so it never reaches here.
          if (isPartnershipRenewal) {
            await recordPartnershipRenewalDonation({ invoice, subMeta, tenantId });
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        let tenantId = charge.metadata?.tenantId;
        if (!tenantId && charge.customer) {
          const tenantSnap = await adminDb.collection('tenants')
            .where('stripeCustomerId', '==', charge.customer as string)
            .limit(1).get();
          if (!tenantSnap.empty) tenantId = tenantSnap.docs[0].id;
        }
        if (tenantId) {
          await adminDb.collection('tenants').doc(tenantId).update({
            lastRefund: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          console.log(`💰 Refund processed for tenant ${tenantId}`);
        }
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        let tenantId = dispute.metadata?.tenantId;
        if (!tenantId && (dispute as any).charge) {
          try {
            const charge = await stripe.charges.retrieve((dispute as any).charge as string);
            if (charge.customer) {
              const tenantSnap = await adminDb.collection('tenants')
                .where('stripeCustomerId', '==', charge.customer as string)
                .limit(1).get();
              if (!tenantSnap.empty) tenantId = tenantSnap.docs[0].id;
            }
          } catch (e) {
            /* charge lookup failed */
            // Was completely silent — no log, so invisible even in Vercel logs. The
            // tenant is never marked `disputed`, so a chargeback against them goes
            // unrecorded and the handler still returns 200.
            captureMoneyPathError(e, {
              step: 'dispute-charge-lookup',
              level: 'error',
              eventId: event.id,
              eventType: event.type,
              ids: { disputeId: dispute.id, chargeId: (dispute as any).charge as string },
            });
          }
        }
        if (tenantId) {
          await adminDb.collection('tenants').doc(tenantId).update({
            status: 'disputed',
            lastDispute: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          console.log(`⚠️ Dispute created for tenant ${tenantId}`);
        }
        break;
      }

      case 'transfer.failed': {
        const transfer = event.data.object as Stripe.Transfer;
        const referrerId = transfer.metadata?.referrerId;
        if (referrerId) {
          try {
            const commissionsSnap = await adminDb.collection('affiliate_commissions')
              .where('stripeTransferId', '==', transfer.id)
              .limit(1).get();
            if (!commissionsSnap.empty) {
              await commissionsSnap.docs[0].ref.update({ status: 'failed' });
            }
            const commissionAmount = transfer.amount || 0;
            await adminDb.collection('users').doc(referrerId).update({
              affiliatePendingPayouts: FieldValue.increment(-commissionAmount),
              updatedAt: new Date().toISOString(),
            });
            console.log(`❌ Transfer failed for referrer ${referrerId}: $${(commissionAmount / 100).toFixed(2)}`);
          } catch (err) {
            console.error('Error handling transfer.failed:', err);
            // A payout bounced and the ledger never learned: the commission can
            // still read `paid` and `affiliatePendingPayouts` stays inflated for
            // money that never arrived. Returns 200, so nothing retries.
            captureMoneyPathError(err, {
              step: 'transfer-failed-reconcile',
              level: 'error',
              eventId: event.id,
              eventType: event.type,
              ids: { transferId: transfer.id, referrerId },
            });
          }
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const meta = pi.metadata || {};

        if (meta.type === 'partnership' && meta.tenantId) {
          const tenantId = meta.tenantId;
          const amount = pi.amount_received || pi.amount || 0;
          // `amount` is CENTS (Stripe). The CRM/user donation fields are canonically
          // DOLLARS (BUG 2): the CRM `fmt()`, the manual activity-add, and Profile
          // all treat totalDonated / activity amount as dollars. Store dollars so a
          // $50 gift reads as $50 everywhere instead of $5,000. NOTE: the accounting
          // `invoices` donation receipt below deliberately stays in CENTS — that is a
          // separate subsystem (giving-statements + QuickBooks read it as cents).
          const amountDollars = amount / 100;
          const donorUserId = meta.donorUserId || '';
          // Prefer the email captured at checkout (metadata) over receipt_email: Stripe
          // does NOT copy customer_email into receipt_email, so the old code — which
          // keyed off receipt_email alone — skipped ALL CRM linkage whenever it was null.
          const donorEmail = (meta.donorEmail || pi.receipt_email || '').trim();
          const nowIso = new Date().toISOString();

          // Shared CRM donor-linkage (member→both, users stamp, timeline activity).
          const { donorDisplayName } = await linkDonationToCRM({
            tenantId, donorUserId, donorEmail, donorName: meta.donorName || '',
            amountDollars, nowIso,
          });

          // Donation receipt (needs an email to address it to). CENTS — the accounting
          // invoices subsystem (giving-statements + QuickBooks) reads amounts as cents.
          if (donorEmail) {
            const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
            const tenantName = tenantDoc.data()?.name || tenantDoc.data()?.displayName || '';
            const recipientName = (meta.donorName || '').trim() || donorDisplayName || donorEmail;
            const receiptNumber = `R-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
            const invoiceRef = await adminDb.collection('tenants').doc(tenantId).collection('invoices').add({
              type: 'donation_receipt', recipientName, recipientEmail: donorEmail,
              amount, currency: pi.currency || 'usd', description: 'Partnership donation',
              relatedId: pi.id, receiptNumber, issuedAt: nowIso,
              tenantName, pdfUrl: null, status: 'pending',
            });
            // Best-effort thank-you + PDF receipt (never throws — see issueDonationReceipt).
            await issueDonationReceipt({
              tenantId, recipientName, donorEmail, amountCents: amount, currency: pi.currency || 'usd',
              receiptNumber, tenantName, issuedAt: nowIso,
              description: 'Partnership donation', invoiceRef,
            });
          }

          // Credit a campaign-designated one-time gift to its progress bar. No-op
          // when the gift isn't tied to a campaign (general partnership) or the
          // campaign doc is gone — never throws, so the donation is never lost.
          await incrementCampaignRaised({ campaignId: meta.campaignId, tenantId, amountDollars });
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Webhook handler error:', error?.message || error);
    // Stripe retries on the 500 below, but a webhook that keeps failing is exactly
    // what should page someone — and this is the only report for the whole
    // uninstrumented middle of the handler (receipt/invoice writes, CRM linkage,
    // campaign credits, tenant provisioning), all of which throw straight to here.
    // Grouping is left to the default stack-trace fingerprint, so a redelivered
    // event adds events to one issue instead of opening a new one per retry.
    captureMoneyPathError(error, {
      step: 'stripe-webhook-handler',
      level: 'error',
      eventId: event.id,
      eventType: event.type,
    });
    if (markerWritten) {
      // Undo the idempotency marker so Stripe's retry re-processes this event.
      // Without this, a mid-processing failure leaves the event marked "done" and
      // the redelivery is skipped as a duplicate — silently losing the event.
      await eventRef.delete().catch(() => { /* best effort */ });
    }
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

function getMonthlyPriceId(plan: string): string {
  return PLAN_PRICES[plan]?.monthly || '';
}
function getYearlyPriceId(plan: string): string {
  return PLAN_PRICES[plan]?.yearly || '';
}
