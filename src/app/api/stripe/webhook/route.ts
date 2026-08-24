import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateAccessCode } from '@/lib/ai-utils';
import { PLAN_PRICES, getPlanFromPriceId } from '@/lib/billing';
import { setCustomClaims } from '@/lib/set-custom-claims';
import { PROVISIONED_TENANT_OWNER_ROLE, ROLE_STANDALONE_AI_USER } from '@/lib/roles';
// Donation bookkeeping — the CRM linkage, the `donation_receipt` tax line and the
// campaign credit — moved to a shared module in THE-145. Donations are now DIRECT
// charges on the church's connected account, so their events are delivered to the
// CONNECT endpoint; both routes call the SAME writers rather than keeping two
// copies of the code that credits `totalDonated`.
import {
  finalizePartnershipSubscription,
  incrementCampaignRaised,
  recordOneTimeDonation,
  recordPartnershipRenewalDonation,
} from '@/lib/donation-webhook';
import { affiliateSweepIdempotencyKey } from '@/lib/affiliate-payout';
import {
  AFFILIATE_COMMISSION_WINDOW_MONTHS,
  affiliateWindowEndIso,
  evaluateAffiliateCommissionWindow,
} from '@/lib/affiliate-commission-window';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { isRetryableWebhookError, isValidFirestoreDocId } from '@/lib/webhook-retry';
import { tenantPrivateRef, getTenantPrivate } from '@/lib/tenant-private';
import { NON_TENANT_SUBDOMAINS } from '@/utils/non-tenant-subdomains';
import { Resend } from 'resend';
import {
  expireEventRegistration,
  finalizeEventRegistration,
} from '@/lib/event-registration-webhook';

export const dynamic = 'force-dynamic';

/**
 * Flat affiliate/referral commission rate — 15% for every plan, every referrer,
 * always. Intentionally replaces the old per-plan ladder (ultra 20% / max 15% /
 * pro 10% / plus 10%): the rate no longer depends on the purchased plan, the
 * referrer's own plan, or whether the referrer is an affiliate vs a church admin.
 * Commission still stops when the referred tenant cancels — that is driven by
 * whether Stripe charges an invoice at all, not by any rate lookup here.
 *
 * Commission also stops 12 MONTHS AFTER THE REFERRED CHURCH'S SIGNUP, which IS
 * enforced here — see `@/lib/affiliate-commission-window` for the rule and the
 * recurring-commission block below for the single place it is applied. The rate is
 * unaffected: the window gates whether a commission row is created at all, and
 * never touches a stored `commission` amount.
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
 *
 * THE 12-MONTH WINDOW DOES NOT GATE THIS PATH, deliberately. This commission is
 * created by the checkout that starts the subscription, so its period IS the signup
 * anchor — zero months have elapsed and the window cannot have closed. Adding a
 * gate here would buy nothing and would introduce a way to silently kill the
 * highest-value payout in the system, which is the failure mode the window logic
 * exists to avoid. The row still RECORDS its window (`commissionWindowAnchorAt` /
 * `commissionWindowEndsAt`) so the affiliate can see the clock from day one; those
 * fields are informational, and the gate on the recurring path always re-derives
 * the anchor from Stripe rather than trusting them.
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
  // This checkout IS the referral's signup, so the row's own creation instant is the
  // window anchor — no Stripe round-trip, and nothing that can fail. The recurring
  // path re-derives the anchor from `subscription.start_date`; the two agree to
  // within webhook latency, and only the recurring path's value ever gates anything.
  const createdAtIso = new Date().toISOString();
  const recordBatch = adminDb.batch();
  recordBatch.set(commissionRef, {
    referrerId, tenantId, plan,
    amount: amountTotal || 0,
    commission: commissionAmount,
    status: 'pending',
    type: 'initial',
    stripeSubscriptionId: subscriptionId,
    createdAt: createdAtIso,
    commissionWindowAnchorAt: createdAtIso,
    commissionWindowEndsAt: affiliateWindowEndIso(Date.parse(createdAtIso)),
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
        //
        // ⚠️ KEPT, BUT NO LONGER THE LIVE PATH (THE-154). Paid tickets are now
        // DIRECT charges on the church's connected account, so a ticket bought
        // from today lands on `/api/stripe/connect/webhook` instead. This branch
        // survives for the tickets that were mid-Checkout as destination charges
        // when that shipped — their sessions were created on the platform, so
        // their completion still arrives here. It is dead once those drain.
        //
        // `requestOptions: undefined` is the correct scope for exactly that
        // case: a destination charge's PaymentIntent really does live on the
        // platform account, so the oversold refund must NOT be scoped to the
        // church.
        if (session.metadata?.type === 'event_registration') {
          await finalizeEventRegistration({ stripe, session, requestOptions: undefined });
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
              role: ROLE_STANDALONE_AI_USER,
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
          // The world-readable tenant doc carries only the pre-auth/public
          // fields; the admin roster + Stripe identifiers live exclusively on
          // the server-only tenant_private doc. One batch: both land (or fail)
          // together.
          const newTenantBatch = adminDb.batch();
          newTenantBatch.set(adminDb.collection('tenants').doc(newTenantId), {
            name: meta.ministryName || 'My Ministry',
            subdomain: newTenantId,
            plan: meta.plan,
            status: 'active',
            config: {},
            ownerId: meta.userId,
            createdBy: meta.userId,
            setupCompleted: false, // gates the first-run "Finish setup" screen
            createdAt: now,
            updatedAt: now,
          });
          newTenantBatch.set(tenantPrivateRef(newTenantId), {
            adminEmails: userEmail ? [userEmail] : [],
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: meta.billing === 'yearly'
              ? getYearlyPriceId(meta.plan)
              : getMonthlyPriceId(meta.plan),
            // Who owns this subscription, stated rather than inferred — the
            // counterpart of the `billingProcessor: 'dodo'` the Dodo provisioner
            // writes. Purely additive: `resolveBillingOwnership` already derives
            // 'stripe' from the identifiers above, and every tenant created
            // before this line still does. Written here so the two provisioning
            // paths keep producing the same field set, which is the property
            // dodo-provisioning.test.ts checks key by key.
            billingProcessor: 'stripe',
            createdAt: now,
            updatedAt: now,
          });
          await newTenantBatch.commit();

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
            role: PROVISIONED_TENANT_OWNER_ROLE,
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
              const oldSubId = (await getTenantPrivate(tenantId)).stripeSubscriptionId;
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

              const planChangeNow = new Date().toISOString();
              const updateData: Record<string, any> = {
                plan,
                status: 'active',
                updatedAt: planChangeNow,
              };

              if (plan === 'ultra' && !tenantDoc.data()?.addOnAiAssistantCode) {
                updateData.addOnAiAssistantCode = generateAccessCode();
              }

              const planChangeBatch = adminDb.batch();
              planChangeBatch.update(adminDb.collection('tenants').doc(tenantId), updateData);
              planChangeBatch.set(tenantPrivateRef(tenantId), {
                stripeSubscriptionId: subscriptionId,
                stripeCustomerId: session.customer as string,
                stripePriceId: meta.billing === 'yearly'
                  ? getYearlyPriceId(plan)
                  : getMonthlyPriceId(plan),
                updatedAt: planChangeNow,
              }, { merge: true });
              await planChangeBatch.commit();

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
        // A paid-ticket Checkout the payer abandoned (or that timed out) —
        // housekeeping only; see expireEventRegistration.
        //
        // ⚠️ Same standing as the confirm branch above: a ticket bought from
        // today expires on the CONNECT endpoint, so this only still fires for
        // destination-charge sessions created before THE-154.
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.type === 'event_registration') {
          await expireEventRegistration(session);
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
          // Stale-check against tenant_private (the subscription id's home);
          // the public doc is still read for ownerId/createdBy below.
          const updTenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
          const updCurrentSubId = (await getTenantPrivate(tenantId)).stripeSubscriptionId;
          if (updCurrentSubId && updCurrentSubId !== subscription.id) {
            console.log(`↩︎ Ignoring stale subscription update ${subscription.id} for tenant ${tenantId} (current ${updCurrentSubId})`);
            break;
          }
          const subUpdatedNow = new Date().toISOString();
          const updateData: Record<string, unknown> = {
            updatedAt: subUpdatedNow,
          };

          let plan = subscription.metadata?.plan || null;
          if (!plan && subscription.items?.data?.[0]?.price?.id) {
            plan = getPlanFromPriceId(subscription.items.data[0].price.id);
          }
          if (plan) updateData.plan = plan;

          if (subscription.status === 'active') updateData.status = 'active';
          else if (subscription.status === 'past_due') updateData.status = 'past_due';
          else if (subscription.status === 'canceled') updateData.status = 'cancelled';

          const subUpdatedBatch = adminDb.batch();
          subUpdatedBatch.update(adminDb.collection('tenants').doc(tenantId), updateData);
          subUpdatedBatch.set(tenantPrivateRef(tenantId), {
            stripeSubscriptionId: subscription.id,
            updatedAt: subUpdatedNow,
          }, { merge: true });
          await subUpdatedBatch.commit();

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
          // Stale-check against tenant_private (the subscription id's home);
          // the public doc is still read for ownerId/createdBy below.
          const delTenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
          const delCurrentSubId = (await getTenantPrivate(tenantId)).stripeSubscriptionId;
          if (delCurrentSubId && delCurrentSubId !== subscription.id) {
            console.log(`↩︎ Ignoring stale subscription deletion ${subscription.id} for tenant ${tenantId} (current ${delCurrentSubId})`);
            break;
          }
          const downgradeNow = new Date().toISOString();
          const downgradeBatch = adminDb.batch();
          downgradeBatch.update(adminDb.collection('tenants').doc(tenantId), {
            plan: 'plus',
            status: 'cancelled',
            updatedAt: downgradeNow,
          });
          downgradeBatch.set(tenantPrivateRef(tenantId), {
            stripeSubscriptionId: null,
            updatedAt: downgradeNow,
          }, { merge: true });
          await downgradeBatch.commit();

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
        // `subscription` is no longer on Stripe.Invoice: recent API versions moved
        // it under `parent.subscription_details`. Webhook payload shape follows the
        // endpoint's configured API version, not the SDK, so the flat field can
        // still arrive. Read it off-type rather than restructuring the handler —
        // behaviour is unchanged. See the PR notes on verifying the endpoint version.
        const invSubId = (invoice as unknown as { subscription?: string | null }).subscription ?? null;
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
        // See the note on invoice.payment_failed above — same off-type read, same
        // behaviour, for the same removed-from-types `subscription` field.
        const invoiceSubId = (invoice as unknown as { subscription?: string | null }).subscription ?? null;
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
              if (referrerId && !isValidFirestoreDocId(referrerId)) {
                // TERMINAL by construction, and screened out here so it never
                // reaches the catch below. `adminDb.collection('users').doc(id)`
                // throws synchronously on a malformed id, and metadata is only as
                // well-formed as whatever wrote it. Retrying that would redeliver
                // an event that fails identically every time — and each early
                // return would also re-skip the campaign credit and the renewal
                // receipt below, which are otherwise recorded on this delivery.
                console.error(`Affiliate recurring commission: subscription ${invoiceSubId} carries a malformed referrerId; skipping commission`);
                captureMoneyPathError(new Error('Malformed referrerId in subscription metadata'), {
                  step: 'recurring-affiliate-commission-referrer-id',
                  level: 'error',
                  tenantId,
                  eventId: event.id,
                  eventType: event.type,
                  ids: { subscriptionId: invoiceSubId, invoiceId: invoice.id },
                });
              } else if (referrerId) {
                const existingCommission = await adminDb.collection('affiliate_commissions')
                  .where('stripeInvoiceId', '==', invoice.id)
                  .limit(1)
                  .get();
                if (!existingCommission.empty) {
                  console.log('⚠️ Commission already exists for invoice', invoice.id);
                } else {
                  const plan = subscription.metadata?.plan || 'unknown';

                  // ── Step 0: is this referral still inside its 12-month window? ──
                  // The founder rule is 15% for the first 12 months from the referred
                  // church's SIGNUP, not forever. The whole rule — the anchor, the
                  // calendar-month arithmetic, the boundary, and the fail-safe — lives
                  // in ONE module so this is the only place it is applied and there is
                  // no second copy to drift. See @/lib/affiliate-commission-window.
                  //
                  // It is keyed off the INVOICE PERIOD, never the delivery time: a
                  // month-11 invoice that is dunned, retried or redelivered in month 14
                  // is still a month-11 invoice and still pays.
                  const commissionWindow = evaluateAffiliateCommissionWindow({ subscription, invoice });

                  if (commissionWindow.failSafe) {
                    // We could not prove the referral is inside its window, so we PAID.
                    // That direction is deliberate — see the module header — but it must
                    // never be quiet: a systematically unresolvable anchor means every
                    // referral is being paid past 12 months, and the only way anyone
                    // finds out is this log.
                    console.warn(
                      `⚠️ Affiliate window UNRESOLVED (${commissionWindow.reason}) for invoice ${invoice.id} ` +
                      `(sub ${invoiceSubId}, referrer ${referrerId}, anchor source ${commissionWindow.anchorSource}, ` +
                      `period source ${commissionWindow.periodStartSource}) — PAYING the commission by fail-safe ` +
                      `rather than withholding it. Investigate: this should not be reachable for a ` +
                      `normally-created Stripe subscription.`,
                    );
                    captureMoneyPathError(
                      new Error(`Affiliate 12-month window unresolved: ${commissionWindow.reason}`),
                      {
                        step: 'recurring-affiliate-commission-window-unresolved',
                        level: 'warning',
                        tenantId,
                        eventId: event.id,
                        eventType: event.type,
                        ids: {
                          subscriptionId: invoiceSubId,
                          invoiceId: invoice.id,
                          referrerId,
                          anchorSource: commissionWindow.anchorSource,
                          periodStartSource: commissionWindow.periodStartSource,
                        },
                      },
                    );
                  }

                  if (!commissionWindow.within) {
                    // EXPIRY IS EXPLICIT, NOT INCIDENTAL. #250 twice fixed a path that
                    // decided not to act and then fell through to a bare `return`,
                    // leaving nobody able to tell "we decided no" from "we crashed".
                    // So the skip gets a durable row of its own: zero commission,
                    // `status: 'cancelled'` (the codebase's existing zero-commission
                    // marker status, which keeps it out of the sweep's and the hourly
                    // cron's `pending` queries), and the numbers the decision was made
                    // from. It carries `stripeInvoiceId`, so the dedup guard above
                    // makes a redelivery of this same invoice a no-op — replaying an
                    // out-of-window invoice creates nothing at all.
                    //
                    // `amount` is 0 on purpose. The admin rollup folds `amount` into
                    // revenueBrought/harvestKept, and an uncommissioned invoice is not
                    // affiliate-attributed revenue; the real figure is preserved beside
                    // it as `uncommissionedAmount` for the audit trail.
                    const skippedAtIso = new Date().toISOString();
                    await adminDb.collection('affiliate_commissions').add({
                      referrerId,
                      tenantId,
                      plan,
                      amount: 0,
                      commission: 0,
                      status: 'cancelled',
                      type: 'expired',
                      stripeSubscriptionId: invoiceSubId,
                      stripeInvoiceId: invoice.id,
                      createdAt: skippedAtIso,
                      skippedReason: commissionWindow.reason,
                      uncommissionedAmount: invoice.amount_paid || 0,
                      commissionWindowMonths: AFFILIATE_COMMISSION_WINDOW_MONTHS,
                      commissionWindowAnchorAt: commissionWindow.anchorAt,
                      commissionWindowEndsAt: commissionWindow.windowEndsAt,
                      invoicePeriodStartAt: commissionWindow.periodStartAt,
                    });
                    // Expected, correct behaviour for a referral past 12 months — so no
                    // Sentry. The durable row above plus this line are the record.
                    console.log(
                      `⏳ Affiliate commission SKIPPED for referrer ${referrerId}: referral ${tenantId} ` +
                      `is past its ${AFFILIATE_COMMISSION_WINDOW_MONTHS}-month window ` +
                      `(signup ${commissionWindow.anchorAt}, window ended ${commissionWindow.windowEndsAt}, ` +
                      `invoice period started ${commissionWindow.periodStartAt}). ` +
                      `Invoice ${invoice.id} paid $${((invoice.amount_paid || 0) / 100).toFixed(2)}, commission $0.00.`,
                    );
                  } else {
                  const commissionAmount = Math.round((invoice.amount_paid || 0) * AFFILIATE_RATE);
                  const referrerRef = adminDb.collection('users').doc(referrerId);

                  // ── Step 1: RECORD, then pay. ─────────────────────────────
                  // Same money-path invariant #223 established on the initial
                  // path: the row lands BEFORE any money moves, and the transfer
                  // is keyed off that row's id. Two defects closed at once.
                  //
                  // (a) No idempotency key at all. The transfer used to be sent
                  //     bare, so a request that SUCCEEDED at Stripe and then timed
                  //     out on the response left the catch below banking a
                  //     `pending` row — indistinguishable from a genuinely unpaid
                  //     one — which the sweep re-sent under `aff_sweep_*`. A
                  //     different key is a brand-new request to Stripe: two real
                  //     transfers for one renewal. Now this path, the
                  //     account.updated sweep and the hourly cron all derive the
                  //     SAME affiliateSweepIdempotencyKey from this doc id, so any
                  //     re-attempt gets the ORIGINAL transfer handed back.
                  //
                  // (b) A paid transfer with no record. The row used to be written
                  //     AFTER the transfer, and a failure there threw past this
                  //     block to `catch (subErr)` below — which at the time
                  //     swallowed it and returned 200 with the marker intact.
                  //     Money gone, no commission doc, no counter, nothing to
                  //     retry from.
                  //     Writing first makes an unrecorded payment unreachable: if
                  //     this commit fails, nothing has been paid and the block
                  //     leaves no trace at all.
                  //
                  // The row + the counter bump are ONE batch so they cannot
                  // desync: a `pending` row always has a matching
                  // `affiliatePendingPayouts`, which is what lets the sweep's later
                  // `increment(-commission)` land on a balance that contains it.
                  // `affiliateEarnings` counts the renewal once, here at earn time.
                  // `affiliateReferralCount` is deliberately NOT touched — a
                  // renewal is more money from an existing referral, not a new one.
                  const commissionRef = adminDb.collection('affiliate_commissions').doc();
                  const recordBatch = adminDb.batch();
                  recordBatch.set(commissionRef, {
                    referrerId, tenantId, plan,
                    amount: invoice.amount_paid || 0,
                    commission: commissionAmount,
                    status: 'pending',
                    type: 'recurring',
                    stripeSubscriptionId: invoiceSubId,
                    stripeInvoiceId: invoice.id,
                    createdAt: new Date().toISOString(),
                    // What the window gate actually decided, recorded on the row it
                    // allowed. This is what /api/affiliate/status reports back to the
                    // affiliate, so the clock they see is the clock that was applied —
                    // not a second calculation that could disagree with it. Stripe's
                    // `subscription.start_date` stays the source of truth: the gate
                    // re-derives the anchor on every invoice and never reads these back.
                    commissionWindowMonths: AFFILIATE_COMMISSION_WINDOW_MONTHS,
                    commissionWindowAnchorAt: commissionWindow.anchorAt,
                    commissionWindowEndsAt: commissionWindow.windowEndsAt,
                    invoicePeriodStartAt: commissionWindow.periodStartAt,
                  });
                  recordBatch.update(referrerRef, {
                    affiliateEarnings: FieldValue.increment(commissionAmount),
                    affiliatePendingPayouts: FieldValue.increment(commissionAmount),
                    updatedAt: new Date().toISOString(),
                  });
                  // Deliberately NOT caught here: nothing has been paid yet and the
                  // batch is atomic, so a failure leaves zero trace. It surfaces to
                  // `catch (subErr)` exactly as the old doc-write did — but the
                  // worst case there is now a renewal commission that was never
                  // recorded and never paid, instead of one that was paid and never
                  // recorded, and a transient failure of this commit is retried on
                  // Stripe's redelivery rather than lost.
                  // The `stripeInvoiceId` written here is also what makes the dedup
                  // guard above work on a redelivery: the row is already queryable
                  // before the transfer, so a second delivery skips the whole block.
                  await recordBatch.commit();

                  // ── Step 2: pay it. ───────────────────────────────────────
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
                        metadata: { referrerId, tenantId, plan, type: 'affiliate_commission_recurring' },
                      }, {
                        idempotencyKey: affiliateSweepIdempotencyKey(commissionRef.id),
                      });

                      // Flip to `paid` and take the amount back out of the pending
                      // counter in ONE batch — the same pairing the sweep commits,
                      // so status and counter can never disagree. If this write
                      // fails the row stays `pending` with its counter intact and
                      // the sweep re-attempts under the identical key: Stripe hands
                      // back THIS transfer and the flip happens then.
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
                      // Assigned only AFTER the write that records it, so the log
                      // line below reflects what is actually in Firestore.
                      commissionStatus = 'paid';
                    }
                    // No `else`: Connect isn't active (or the commission is $0), so
                    // there is nowhere to pay to. The row is already banked
                    // `pending` above and the sweep pays it at activation.
                  } catch (transferErr) {
                    console.error('Affiliate recurring transfer failed:', transferErr);
                    // `warning`, not `error`: the old ambiguity is gone. This
                    // transfer used to carry NO idempotency key, so a caught error
                    // — a response timeout in particular — did not reliably mean
                    // the money stayed put, and the keyed retry sweep would then
                    // send a second, differently-keyed transfer. Now the row is
                    // durable before the transfer and every path keys off its id,
                    // so landing here means the payout is merely late: the sweep or
                    // the hourly cron re-attempts under the same key, and if the
                    // money did go out Stripe returns that same transfer.
                    captureMoneyPathError(transferErr, {
                      step: 'recurring-affiliate-transfer',
                      level: 'warning',
                      tenantId,
                      eventId: event.id,
                      eventType: event.type,
                      ids: {
                        subscriptionId: invoiceSubId,
                        invoiceId: invoice.id,
                        referrerId,
                        commissionId: commissionRef.id,
                      },
                    });
                  }
                  console.log(`💰 Recurring affiliate commission ${commissionStatus} for referrer ${referrerId}: $${(commissionAmount / 100).toFixed(2)}`);
                  }
                }
              }
            } catch (subErr) {
              // Nothing has been PAID when we land here: since #224 the transfer
              // and its follow-up write have their own `catch (transferErr)`, so
              // the only failures that reach this catch are the subscription
              // reload, the invoice dedup query, and the record-first batch — all
              // of which happen BEFORE any money moves. The loss is therefore a
              // commission that was never recorded and never paid.
              //
              // That loss used to be permanent: this catch returned 200 with the
              // `webhook_events` marker intact, so even a manual Stripe redelivery
              // was dropped by the duplicate guard. A TRANSIENT failure now undoes
              // the marker and 5xxs — exactly the pattern the outer catch uses —
              // so Stripe redelivers and the commission is recorded on the retry
              // (the invoice-scoped dedup query keeps that to exactly once).
              //
              // A TERMINAL failure deliberately keeps the old 200. Retrying it
              // cannot record the commission, and the early return would re-skip
              // the campaign credit and renewal receipt below on every attempt —
              // so the poison event would cost MORE than the lost commission.
              const retryable = isRetryableWebhookError(subErr);
              console.error(
                `Failed to check subscription for affiliate commission (${retryable ? 'retryable — will 500 for redelivery' : 'terminal — reported, not retried'}):`,
                subErr,
              );
              captureMoneyPathError(subErr, {
                // `warning` when Stripe will redeliver (recoverable), `error` when
                // nothing will retry it and a human has to record the commission —
                // the exact distinction MoneyPathLevel documents.
                step: 'recurring-affiliate-commission',
                level: retryable ? 'warning' : 'error',
                tenantId,
                eventId: event.id,
                eventType: event.type,
                ids: { subscriptionId: invoiceSubId, invoiceId: invoice.id },
              });
              if (retryable) {
                if (markerWritten) {
                  // Load-bearing: without this the redelivery is dropped by the
                  // duplicate guard at the top of the handler and the 500 buys
                  // nothing. Only ever a marker THIS invocation wrote.
                  await eventRef.delete().catch(() => { /* best effort */ });
                }
                // Returning here — rather than finishing the case — keeps the retry
                // clean: nothing below should half-run on a delivery that is about
                // to be redelivered. `incrementCampaignRaised` now carries its own
                // per-invoice dedup (THE-30), so this return is no longer the only
                // thing standing between a redelivery and a double-credited
                // campaign — but the renewal receipt and CRM writes below still
                // belong on the retry, not on this doomed attempt.
                return NextResponse.json(
                  { error: 'Recurring affiliate commission failed; will retry' },
                  { status: 500 },
                );
              }
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

          // Dedup key = the INVOICE id — one renewal invoice is one month's money,
          // the same identity `recordPartnershipRenewalDonation` dedups its receipt
          // on. This is the site with real retry exposure: that recorder runs a few
          // lines below and its Firestore writes can throw, which deletes the
          // `webhook_events` marker and 500s with this increment already applied.
          // #230 only closed the *affiliate* interleaving (that catch returns before
          // reaching here); this one was still open.
          if (isPartnershipRenewal && subMeta.campaignId) {
            await incrementCampaignRaised({
              campaignId: subMeta.campaignId,
              tenantId: subMeta.tenantId,
              amountDollars: (invoice.amount_paid || 0) / 100,
              paymentId: invoice.id,
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
          // stripeCustomerId lives on tenant_private (doc id IS the tenantId).
          const tenantSnap = await adminDb.collection('tenant_private')
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
              // stripeCustomerId lives on tenant_private (doc id IS the tenantId).
              const tenantSnap = await adminDb.collection('tenant_private')
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

      // NOTE: Stripe's current event union has only transfer.created /
      // transfer.reversed / transfer.updated — `transfer.failed` is not a real
      // event type, so this branch has never fired and the reconciliation below
      // (clearing affiliatePendingPayouts for a bounced payout) does not run.
      // The cast keeps the label comparable without widening the switch, which
      // would drop narrowing for every other case. Left in place deliberately:
      // deleting it, or re-pointing it at transfer.reversed, is a money-path
      // behaviour change and needs an owner's call, not a typecheck fix.
      case 'transfer.failed' as Stripe.Event['type']: {
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
        // ⚠️ REACHABLE ONLY FOR DONATIONS STILL IN FLIGHT AS DESTINATION CHARGES.
        // Since THE-145 a donation is a DIRECT charge on the church's connected
        // account, so its PaymentIntent lives there and this event is delivered to
        // the CONNECT endpoint instead. Kept until the last pre-cutover gift has
        // settled; removing it is part 6 cleanup, not this PR.
        //
        // The recorder is the SAME function the Connect endpoint calls — one
        // implementation of the CRM linkage, the receipt and the campaign credit.
        await recordOneTimeDonation(event.data.object as Stripe.PaymentIntent);
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
