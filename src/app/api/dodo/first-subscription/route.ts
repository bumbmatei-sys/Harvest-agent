import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { tenantPrivateRef } from '@/lib/tenant-private';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { dodoBillingProvider } from '@/lib/dodo/dodo-provider';
import { logReferralCapture, resolveAffiliateReferrer } from '@/lib/affiliate-referrer';
import { BILLING_TERMS, DODO_BILLING_ENABLED, PRICED_PLAN_ORDER } from '@/utils/plan-features';
import type { PricedPlan } from '@/types/tenant.types';
import type { BillingPeriod } from '@/lib/dodo/provider';

export const dynamic = 'force-dynamic';

/**
 * A free tenant buys its FIRST subscription. (THE-203)
 *
 * 🔴 THE THIRD PATH. Read `src/lib/dodo/first-subscription.ts` first — it
 * carries the argument for why this route exists rather than a branch in one of
 * the other two.
 *
 * In short: `/api/dodo/checkout` refuses a body carrying a `tenantId`, because
 * that guard is what stops a paying church opening a second subscription;
 * `/api/dodo/change-plan` calls Dodo's change-plan API, which needs a
 * subscription to change. A free tenant has a tenantId and no subscription, so
 * it falls between them, and neither guard may be relaxed to let it through.
 *
 * This route's guard is the exact inverse of the signup route's: the caller
 * MUST have a tenant, and that tenant must have NO subscription. The two can
 * never both accept the same request.
 *
 * ⚠️ IT WRITES NOTHING. It creates a Dodo Checkout and returns the URL. The
 * webhook remains the single writer of `plan`, and the attach happens in
 * `subscription.active`.
 *
 * ⚠️ THE TRIAL. `trialDays` is deliberately not passed, exactly as the signup
 * checkout does not pass it: the trial is configured ON THE DODO PRODUCT, not
 * on the request, so a free tenant upgrading gets whatever that product's trial
 * is — today 14 days. REPORTED, NOT SILENTLY ACCEPTED: this means an evangelist
 * who has been on Forever Free for a year still receives a 14-day trial of the
 * tier they just bought, because Dodo cannot distinguish them from a brand-new
 * church. Suppressing it would need either a second set of no-trial products or
 * a Dodo-side subscription edit after creation; both are a product decision, so
 * neither is invented here. The founder should be told before this ships.
 */

function readPlan(raw: unknown): PricedPlan | null {
  // 🔴 PRICED_PLAN_ORDER, never PLAN_ORDER. The latter contains 'free', and a
  // POST of `{ plan: 'free' }` would reach `requireProductId('free', …)` for a
  // product that must not exist. Same defect class THE-200 closed on the other
  // two Dodo routes; it must not reappear on the third.
  return typeof raw === 'string' && (PRICED_PLAN_ORDER as readonly string[]).includes(raw)
    ? (raw as PricedPlan)
    : null;
}

function readPeriod(raw: unknown): BillingPeriod | null {
  return typeof raw === 'string' && (BILLING_TERMS as readonly string[]).includes(raw)
    ? (raw as BillingPeriod)
    : null;
}

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    if (!DODO_BILLING_ENABLED) {
      return NextResponse.json({ error: 'Dodo billing is not enabled.' }, { status: 503 });
    }

    // ── Must HAVE a tenant. The inverse of the signup route's guard. ─────────
    const tenantId = userOrErr.tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { error: 'This endpoint upgrades an existing ministry. New ministries go through /api/dodo/checkout.' },
        { status: 400 },
      );
    }
    // Buying a subscription is an owner/admin act, not a member one.
    if (!userOrErr.isAdmin && !userOrErr.isSuperAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const plan = readPlan(body?.plan);
    const period = readPeriod(body?.billing);
    if (!plan || !period) {
      return NextResponse.json(
        { error: `Invalid plan/billing: ${body?.plan}/${body?.billing}` },
        { status: 400 },
      );
    }

    // ── The tenant must be free, and must have no subscription. ─────────────
    //
    // Checked HERE as well as in the webhook attach. Not redundant: this is
    // what stops a Dodo Checkout being created at all, so a church that would
    // be refused after payment is never given a page to pay on. The webhook's
    // copy of the check is the one that is authoritative, because state can
    // change between the two.
    const [tenantSnap, privateSnap] = await Promise.all([
      adminDb.collection('tenants').doc(tenantId).get(),
      tenantPrivateRef(tenantId).get(),
    ]);
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Ministry not found.' }, { status: 404 });
    }
    if (tenantSnap.data()?.plan !== 'free') {
      return NextResponse.json(
        { error: 'This ministry already has a paid plan. Plan changes go through /api/dodo/change-plan.' },
        { status: 400 },
      );
    }
    const priv = privateSnap.exists ? (privateSnap.data() ?? {}) : {};
    if (priv.dodoSubscriptionId || priv.stripeSubscriptionId) {
      return NextResponse.json(
        { error: 'This ministry already has a subscription. Plan changes go through /api/dodo/change-plan.' },
        { status: 400 },
      );
    }

    // ── Affiliate attribution. ──────────────────────────────────────────────
    // The referrer is resolved here, not at free signup: a commission is 30% of
    // what a church PAYS, and a Forever Free tenant pays nothing. The stored
    // referrer survives in the browser from the original visit, so an
    // evangelist who arrived through an affiliate link and upgraded months
    // later still attributes.
    const referralContext = { plan, billing: period, processor: 'dodo' };
    const resolved = await resolveAffiliateReferrer(body?.referrerId, referralContext);
    logReferralCapture(resolved, referralContext);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    const origin = request.headers.get('origin') || baseUrl;

    const checkout = await dodoBillingProvider.createPlanCheckout({
      plan,
      period,
      returnUrl: `${origin}/admin?dodo=success`,
      cancelUrl: `${origin}/admin?dodo=cancel`,
      customer: {
        email: userOrErr.email || '',
        name: tenantSnap.data()?.name || userOrErr.email || undefined,
      },
      // 🔴 `firstSubscription`, NOT `newTenant`. The provisioner keys on
      // `newTenant` to build a church; this tenant already exists and must not
      // be built a second time. The two markers are mutually exclusive and a
      // payload carrying both is refused by the reader rather than guessed at.
      metadata: {
        firstSubscription: 'true',
        tenantId,
        userId: userOrErr.uid,
        plan,
        billing: period,
        ...(resolved.referrerId ? { referrerId: resolved.referrerId } : {}),
      },
      // trialDays omitted — see the module note above on what Dodo does here.
    });

    return NextResponse.json({ url: checkout.url, reference: checkout.reference });
  } catch (error: any) {
    console.error('Dodo first-subscription error:', error?.message || error);
    captureMoneyPathError(error, { step: 'dodo-first-subscription', level: 'error' });
    return NextResponse.json(
      { error: error?.message || 'Failed to start checkout' },
      { status: 500 },
    );
  }
}
