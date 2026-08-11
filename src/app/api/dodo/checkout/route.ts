import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { logReferralCapture, resolveAffiliateReferrer } from '@/lib/affiliate-referrer';
import { dodoBillingProvider } from '@/lib/dodo/dodo-provider';
import type { BillingPeriod } from '@/lib/dodo/provider';
import { DODO_BILLING_ENABLED, PLAN_ORDER } from '@/utils/plan-features';
import type { TenantPlan } from '@/types/tenant.types';

/**
 * POST /api/dodo/checkout — the new-ministry signup checkout, on Dodo.
 *
 * 🔴 THE TOP OF THE MONEY PATH. With `DODO_BILLING_ENABLED` true this is where
 * every new church starts; no session means nobody can become a customer.
 *
 * ─── Scope: NEW-MINISTRY SIGNUP ONLY ─────────────────────────────────────────
 *
 * The Stripe route this replaces carries three flows in one handler: signup, the
 * existing-tenant plan change, and the retired AI add-on. Only the FIRST moves
 * here. An existing tenant changing plan keeps posting to `/api/stripe/checkout`
 * — it has a Stripe customer and a live Stripe subscription to modify, and
 * moving that is REP-4 PR 6 (retiring the Stripe path), not this change. So
 * there is no `tenantId` branch below, and a request carrying one is refused
 * rather than quietly treated as a signup.
 *
 * ─── Why the flag is checked HERE and not only in the client ─────────────────
 *
 * The client picks the endpoint, but a stale browser tab holding the old bundle
 * would keep posting to whichever route it was built with. Refusing here means
 * turning `DODO_BILLING_ENABLED` off actually closes this path, rather than
 * leaving a half-open one — which is the whole requirement for the rollback
 * being complete rather than partial. The Dodo WEBHOOK deliberately does not do
 * this; see its module note.
 */

export const dynamic = 'force-dynamic';

/** The 14-day trial is configured on the Dodo products; nothing overrides it here. */

function readPlan(raw: unknown): TenantPlan | null {
  return typeof raw === 'string' && (PLAN_ORDER as readonly string[]).includes(raw)
    ? (raw as TenantPlan)
    : null;
}

function readPeriod(raw: unknown): BillingPeriod | null {
  return raw === 'monthly' || raw === 'yearly' ? raw : null;
}

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    if (!DODO_BILLING_ENABLED) {
      return NextResponse.json(
        { error: 'Dodo billing is not enabled.' },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const { plan: rawPlan, billing: rawBilling, ministryName, email, referrerId, tenantId } = body ?? {};

    if (tenantId) {
      // An existing tenant belongs to the Stripe plan-change path (see above).
      // Falling through would create a SECOND subscription on a second processor
      // for a church that already has one, and bill them twice.
      return NextResponse.json(
        { error: 'This endpoint creates new ministries only. Plan changes go through /api/stripe/checkout.' },
        { status: 400 },
      );
    }

    const plan = readPlan(rawPlan);
    const period = readPeriod(rawBilling);
    if (!plan || !period) {
      return NextResponse.json(
        { error: `Invalid plan/billing: ${rawPlan}/${rawBilling}` },
        { status: 400 },
      );
    }

    // A user who already belongs to an organization must NOT self-provision a
    // second tenant. Same guard, same wording, as the Stripe signup path — the
    // webhook would otherwise detach them from their current org. Super admins
    // legitimately have no tenant.
    if (userOrErr.tenantId && !userOrErr.isSuperAdmin) {
      return NextResponse.json({ error: 'You already belong to an organization.' }, { status: 400 });
    }

    // ── Affiliate attribution. ────────────────────────────────────────────────
    // The resolved id goes into the SUBSCRIPTION metadata, which is the only
    // place the webhook can read it from, and #253's 12-month window is measured
    // from the subscription's own creation instant (Stripe: `start_date`; Dodo:
    // `created_at`). A signup that checks out without this stamp is
    // unattributable forever — nothing retries a checkout already created.
    const referralContext = { plan, billing: period, processor: 'dodo' };
    const resolved = await resolveAffiliateReferrer(referrerId, referralContext);
    logReferralCapture(resolved, referralContext);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    // Return the customer to the SAME origin they signed up on, so their Firebase
    // session survives the round trip, and mark it so the first-run gate picks
    // them up. `?dodo=success` mirrors `?stripe=success`; OnboardingGate treats
    // the two identically.
    const origin = request.headers.get('origin') || baseUrl;

    const checkout = await dodoBillingProvider.createPlanCheckout({
      plan,
      period,
      returnUrl: `${origin}/?dodo=success`,
      cancelUrl: `${origin}/?dodo=cancel`,
      customer: {
        email: userOrErr.email || email || '',
        name: ministryName || userOrErr.email || undefined,
      },
      // Everything the webhook needs to build the account. There is no tenant
      // yet, so this metadata IS the link between the payment and the church.
      // `newTenant: 'true'` is the discriminator the provisioner keys on — the
      // same one the Stripe handler uses.
      metadata: {
        plan,
        billing: period,
        ministryName: ministryName || '',
        userId: userOrErr.uid,
        newTenant: 'true',
        ...(resolved.referrerId ? { referrerId: resolved.referrerId } : {}),
      },
      // trialDays deliberately omitted: the product's own configured trial
      // applies. See `catalogue.ts` for why that number is not restated here.
    });

    return NextResponse.json({ url: checkout.url, reference: checkout.reference });
  } catch (error: any) {
    console.error('Dodo checkout error:', error?.message || error);
    // No session means the customer cannot pay at all — the top of the money path.
    captureMoneyPathError(error, { step: 'dodo-checkout', level: 'error' });
    return NextResponse.json(
      { error: error?.message || 'Failed to start checkout' },
      { status: 500 },
    );
  }
}
