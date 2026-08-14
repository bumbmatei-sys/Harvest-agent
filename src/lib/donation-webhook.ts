import type Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { issueDonationReceipt } from '@/lib/donation-receipt';

/**
 * Everything a completed donation writes down: the recipient tenant's CRM, the
 * donor's own account, the `donation_receipt` tax line, and the campaign
 * progress bar.
 *
 * 🔴 WHY THIS IS A MODULE AND NOT PART OF A ROUTE. Donations are DIRECT charges
 * on the church's connected account (THE-145), so their Stripe events —
 * `checkout.session.completed`, `payment_intent.succeeded`,
 * `invoice.payment_succeeded` — are delivered to the CONNECT endpoint
 * (`/api/stripe/connect/webhook`), not the platform one. Two endpoints now need
 * the same writes, and two copies of the code that credits `totalDonated` and
 * issues a tax receipt is the duplicated-fact shape this project keeps paying
 * for. It lives here once; both routes import it.
 *
 * ⚠️ NOTHING IN THIS MODULE TALKS TO STRIPE. Every function takes objects the
 * caller already has (from the signature-verified event, or from a retrieve the
 * caller scoped itself) and writes only to Firestore. That is deliberate: on a
 * direct charge the Charge, the Session, the PaymentIntent and the Subscription
 * all live on the CONNECTED account, so a platform-scoped read 404s — silently,
 * if it is inside a `try`. Keeping the Stripe reads in the routes keeps the
 * scoping decision at the one place that knows which account the event came
 * from, instead of hiding an unscoped `retrieve` in shared code.
 *
 * UNITS — the two families of write are deliberately in DIFFERENT units, and
 * every function here preserves that:
 *   • `tenants/{t}/invoices` donation receipts are CENTS — the accounting
 *     subsystem (giving-statements + QuickBooks) reads `amount` as cents;
 *   • CRM `totalDonated` / activity `amount` / campaign `raised` are DOLLARS
 *     (BUG 2), so a $50 gift reads as $50 and not $5,000.
 */

/**
 * Has a `donation_receipt` already been written for this payment?
 *
 * The `webhook_events/{event.id}` marker both routes keep is NOT enough on its
 * own — it is deliberately DELETED when a handler throws, so any failure after
 * a receipt has landed sends the same money event back around and the CRM
 * writes below (`FieldValue.increment`) would double-count `totalDonated` and
 * duplicate the tax line. Every recorder therefore also gates on the payment's
 * own identity, which is stable across every redelivery.
 *
 * `relatedId` is the id that means "this payment" on the calling path — the
 * PaymentIntent for a one-time gift, the subscription for a monthly partner's
 * opening month, the invoice for each renewal. The three namespaces never
 * collide, so one payment is one receipt.
 *
 * Single equality filter so no composite index is needed (the giving-statements
 * reader avoids composite queries too); `type` is filtered in memory.
 */
export async function donationReceiptAlreadyRecorded(
  tenantId: string,
  relatedId: string,
): Promise<boolean> {
  if (!tenantId || !relatedId) return false;
  const existingSnap = await adminDb.collection('tenants').doc(tenantId)
    .collection('invoices')
    .where('relatedId', '==', relatedId)
    .limit(10)
    .get();
  return existingSnap.docs.some(d => d.data()?.type === 'donation_receipt');
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
export async function linkDonationToCRM(opts: {
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
 * IDEMPOTENCY: the `webhook_events/{event.id}` marker is NOT enough on its own —
 * it is deliberately deleted when the handler throws, so any failure *after* this
 * function has already incremented sends the same money event back around and a
 * bare `FieldValue.increment` credits the campaign twice. (The live path: the
 * renewal caller runs `recordPartnershipRenewalDonation` immediately after this;
 * that throwing 500s the request with the increment already applied.) So, mirroring
 * `recordPartnershipRenewalDonation`'s `relatedId` gate, every credit is keyed to
 * the PAYMENT that produced it — `campaigns/{id}/credits/{paymentId}` — and the
 * marker is written in the SAME batch as the increment, so the two can never
 * disagree: no double-credit on a redelivery, and no silent under-credit from a
 * marker that outlived a failed increment. Callers pass the id that identifies
 * "this payment" for their path: the checkout session for a subscription's first
 * gift, the invoice for a renewal, the payment intent for a one-time gift. Without
 * one there is nothing to dedup on, so — again like the renewal recorder — we
 * record nothing rather than risk crediting twice.
 *
 * The one place two DISTINCT events cover the same money — a monthly
 * subscription's `checkout.session.completed` and its first
 * `invoice.payment_succeeded` — carries two different payment ids, so it is still
 * the invoice caller's `billing_reason === 'subscription_create'` skip that keeps
 * the opening month from counting twice.
 *
 * Safety: a missing/stray/cross-tenant `campaignId` logs and returns instead of
 * throwing, so a real gift is never lost to a 500 (which would make Stripe
 * redeliver the money event). Campaigns are a top-level collection keyed by id
 * with a `tenantId` field (see /api/campaigns/active), so we update
 * `campaigns/{id}` directly and refuse to credit a campaign that belongs to a
 * different tenant than the one that received the money.
 */
export async function incrementCampaignRaised(opts: {
  campaignId: string | undefined;
  tenantId: string | undefined;
  amountDollars: number;
  paymentId: string | undefined;
}): Promise<void> {
  const { campaignId, tenantId, amountDollars, paymentId } = opts;
  if (!campaignId || !(amountDollars > 0)) return;

  // No payment id → no dedup key → a bare increment, which is the double-credit this
  // exists to stop. Skip rather than credit blind (same call the renewal recorder
  // makes when an invoice has no id).
  if (!paymentId) {
    console.warn(`campaign raised: campaign ${campaignId} — no payment id to dedup on; skipping increment`);
    return;
  }

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

  // Per-payment idempotency gate. Checked AFTER the two guards above so a missing
  // campaign and a cross-tenant id still short-circuit before any extra read.
  const creditRef = campaignRef.collection('credits').doc(paymentId);
  const creditSnap = await creditRef.get();
  if (creditSnap.exists) {
    console.log(`⚠️ Campaign ${campaignId} already credited for payment ${paymentId} — skipping increment`);
    return;
  }

  // The increment and its dedup marker are ONE atomic batch. Marker-first would turn
  // a failed increment into a permanent silent under-credit; increment-first would
  // leave a failed marker write open to the double-credit on redelivery. Neither is
  // possible when both land or neither does.
  const batch = adminDb.batch();
  batch.update(campaignRef, {
    raised: FieldValue.increment(amountDollars),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(creditRef, {
    paymentId,
    amountDollars,
    tenantId: tenantId || null,
    creditedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  console.log(`📈 Campaign ${campaignId} raised += $${amountDollars.toFixed(2)} (tenant ${tenantId || 'unknown'}, payment ${paymentId})`);
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
 * real subscription.
 *
 * IDEMPOTENCY: the caller's `webhook_events/{event.id}` marker dedups an identical
 * redelivery, but it is deliberately UNDONE when the handler throws — so a failure
 * later in the request re-enters here, and `linkDonationToCRM` uses
 * `FieldValue.increment`. The `relatedId` gate below (the SUBSCRIPTION id — this
 * opening month's payment identity) is what makes the second pass a no-op instead
 * of a doubled `totalDonated` and a duplicate tax line.
 *
 * NOTE: this covers only the FIRST payment. Every later month arrives as
 * invoice.payment_succeeded and is recorded by recordPartnershipRenewalDonation
 * below, which mirrors the receipt + CRM writes here.
 */
export async function finalizePartnershipSubscription(
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

  // Per-payment idempotency gate, read BEFORE any write. Keyed on the
  // subscription id, which is what "this payment" means on this path: one
  // completed checkout is one opening gift. Renewals key off invoice ids, so the
  // two namespaces never collide and a month-two receipt can never be mistaken
  // for this one.
  //
  // 🔴 IT GATES THE NON-REPEATABLE WRITES ONLY — the `FieldValue.increment` on
  // `totalDonated` and the tax receipt. It deliberately does NOT short-circuit
  // the whole function: the campaign credit at the bottom carries its OWN atomic
  // per-payment guard, so re-running it is free, and SKIPPING it is not. A gift
  // whose campaign credit failed after the receipt landed would otherwise be
  // lost from the progress bar permanently, turning a retryable failure into a
  // silent under-credit.
  const alreadyRecorded = await donationReceiptAlreadyRecorded(tenantId, subscriptionId);
  if (alreadyRecorded) {
    console.log(`⚠️ Partnership subscription ${subscriptionId} already recorded — skipping receipt + totalDonated credit`);
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

  // ── The once-only writes. Both are guarded by `alreadyRecorded` above. ──
  if (!alreadyRecorded) {
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
  }

  // Credit this FIRST monthly payment to the campaign's progress bar when the gift
  // is campaign-designated. Renewals are credited from invoice.payment_succeeded,
  // which skips billing_reason 'subscription_create' so this opening month is not
  // double-counted. No-op when meta.campaignId is absent (general partnership).
  //
  // Dedup key = the CHECKOUT SESSION id. That is what "this payment" means on this
  // path: one completed checkout is one opening gift, and the id is stable across
  // every redelivery of the event. The subscription id would be wrong (it names the
  // whole subscription, not this month) and the first invoice id is not on the
  // session object we are handed. Renewals key off invoice ids, so the two
  // namespaces never collide.
  await incrementCampaignRaised({
    campaignId: meta.campaignId,
    tenantId,
    amountDollars,
    paymentId: session.id,
  });
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
export async function recordPartnershipRenewalDonation(opts: {
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

  // Idempotency gate for the whole block, through the shared helper every recorder
  // in this module uses — one implementation of "has this payment been receipted",
  // not three that can drift.
  if (await donationReceiptAlreadyRecorded(tenantId, invoiceId)) {
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

/**
 * Record a ONE-TIME gift — the `payment_intent.succeeded` path.
 *
 * Lifted verbatim out of the platform webhook's `payment_intent.succeeded` case so
 * the Connect endpoint records a direct-charge gift exactly as the platform
 * endpoint recorded a destination-charge one: CRM donor linkage, the
 * `donation_receipt` tax line + PDF, and the campaign credit.
 *
 * 🔴 ONE-TIME GIFTS ARE RECORDED HERE AND NOWHERE ELSE. A one-time donation also
 * emits `checkout.session.completed`, and on a direct charge BOTH events now land
 * on the same (Connect) endpoint — two DISTINCT event ids, so the
 * `webhook_events` marker cannot dedup across them. Neither route records a
 * one-time gift from the session: the session's own metadata deliberately carries
 * no `type: 'partnership'`, and only the PaymentIntent's does. The `relatedId`
 * gate below (the PaymentIntent id) makes that structural rather than incidental.
 *
 * Takes the PaymentIntent from the signature-verified event — no Stripe read, so
 * nothing here can 404 against the wrong account.
 */
export async function recordOneTimeDonation(pi: Stripe.PaymentIntent): Promise<void> {
  const meta = (pi.metadata || {}) as Record<string, string>;
  if (meta.type !== 'partnership' || !meta.tenantId) return;

  const tenantId = meta.tenantId;

  // Per-payment idempotency gate: for a one-time gift the PaymentIntent *is* the
  // payment. Read before any write, so a redelivery that gets past the event
  // marker (which is undone whenever the handler throws) cannot double
  // `totalDonated` or issue a second receipt.
  //
  // 🔴 Same shape as the monthly path: it guards the non-repeatable writes only,
  // never the campaign credit at the bottom — that one has its own atomic
  // per-payment guard, and skipping it would permanently lose a credit whose
  // first attempt failed after the receipt had landed.
  const alreadyRecorded = pi.id ? await donationReceiptAlreadyRecorded(tenantId, pi.id) : false;
  if (alreadyRecorded) {
    console.log(`⚠️ One-time donation ${pi.id} already recorded — skipping receipt + totalDonated credit`);
  }

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

  // ── The once-only writes. Both are guarded by `alreadyRecorded` above. ──
  if (!alreadyRecorded) {
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
  }

  // Credit a campaign-designated one-time gift to its progress bar. No-op
  // when the gift isn't tied to a campaign (general partnership) or the
  // campaign doc is gone — never throws, so the donation is never lost.
  //
  // Dedup key = the PAYMENT INTENT id: for a one-time gift the PI *is* the
  // payment. This site is the least exposed of the three — nothing after it
  // can throw before the 200 — but a write that lands while the response is
  // lost still comes back as a redelivery, and keying it means a future line
  // added below can't quietly reopen the hole.
  await incrementCampaignRaised({
    campaignId: meta.campaignId,
    tenantId,
    amountDollars,
    paymentId: pi.id,
  });
}
