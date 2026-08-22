import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { logReferralCapture, resolveAffiliateReferrer } from '@/lib/affiliate-referrer';
import { dodoBillingProvider } from '@/lib/dodo/dodo-provider';
import type { BillingPeriod } from '@/lib/dodo/provider';
import { BILLING_TERMS, DODO_BILLING_ENABLED, PRICED_PLAN_ORDER } from '@/utils/plan-features';
import type { PricedPlan } from '@/types/tenant.types';

/**
 * POST /api/dodo/checkout — the new-ministry signup checkout, on Dodo.
 *
 * 🔴 THE TOP OF THE MONEY PATH. With `DODO_BILLING_ENABLED` true this is where
 * every new church starts; no session means nobody can become a customer.
 *
 * ─── Scope: NEW-MINISTRY SIGNUP ONLY ─────────────────────────────────────────
 *
 * The Stripe route this replaces carries three flows in one handler: signup, the
 * existing-tenant plan change, and the retired AI add-on. Only the FIRST lives
 * here. An existing tenant changing plan posts to `/api/dodo/change-plan` when
 * Dodo owns its subscription (THE-89), or to `/api/stripe/checkout` when Stripe
 * does. So there is no `tenantId` branch below, and a request carrying one is
 * refused rather than quietly treated as a signup.
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

/**
 * Validate the requested plan, REFUSING anything that is not a tier this
 * endpoint can actually sell.
 *
 * 🔴 VALIDATES AGAINST `PRICED_PLAN_ORDER`, NOT `PLAN_ORDER`, and the
 * difference is a real hole rather than a nicety. This body is untrusted: the
 * request names the plan. `PLAN_ORDER` gained the Forever Free tier, and had
 * this kept reading it, a POST of `{ plan: 'free' }` would have passed
 * validation, been carried into `createPlanCheckout`, and hit
 * `requireProductId('free', …)` — a thrown 500 at best, and at worst (had the
 * catalogue been given a placeholder row) a checkout for a product that must
 * not exist. A free tenant is PROVISIONED, never checked out.
 *
 * ⚠️ EXACTLY THE SHAPE OF THE-199 ONE FUNCTION BELOW, inverted. That bug was a
 * hand-kept term list that went STALE when the union widened, refusing a term
 * the site sold. This is a derived plan list that would have gone TOO WIDE when
 * the union widened, accepting a tier the app cannot sell. Both are "a
 * validator and its union drifted apart", and both typecheck perfectly.
 */
function readPlan(raw: unknown): PricedPlan | null {
  return typeof raw === 'string' && (PRICED_PLAN_ORDER as readonly string[]).includes(raw)
    ? (raw as PricedPlan)
    : null;
}

/**
 * Validate the requested term, REFUSING anything unrecognised.
 *
 * 🔴 THE-199. This compared against the string literals 'monthly' and 'yearly'
 * — a hand-kept copy of the term list that was never updated when quarterly
 * shipped (THE-195). Every quarterly signup therefore resolved to `null`, fell
 * into the `!plan || !period` branch below, and was answered `400 Invalid
 * plan/billing: plus/quarterly`: a church that chose the term the site was
 * selling could not buy it, and never reached a payment page at all.
 *
 * ⚠️ IT TYPECHECKED THROUGHOUT, which is why nothing caught it. `BillingPeriod`
 * is an alias for `BillingTerm`, so widening that union from two members to
 * three made this function's `null` arm more reachable without making it
 * ill-typed — `null` is a valid `BillingPeriod | null` whatever the union holds.
 * Only a test that drives the term list can see the difference; see
 * `dodo-checkout-quarterly-term.test.ts`.
 *
 * Reads `BILLING_TERMS` for the same reason `readPlan` above reads
 * `PRICED_PLAN_ORDER`,
 * and the same reason `provider.ts` aliases `BillingPeriod` to `BillingTerm`
 * rather than restating it: the set of terms a signup may carry IS the set the
 * price table prices. `/api/dodo/change-plan` validates through the same
 * constant, so there is one term list in this repo read from two routes rather
 * than two copies to keep in step, and a fourth term added there cannot go
 * silently unpurchasable here.
 *
 * ⚠️ STILL FAILS CLOSED, and deliberately NOT the way `readSignupBillingPeriod`
 * does. That validator floors an unreadable value to 'monthly' because a signup
 * carrying no period at all is a real and harmless case. This is the last gate
 * before a product lookup and a charge, so an unrecognised value must become the
 * 400 below and must NEVER be substituted with a term — least of all a cheaper
 * one, which would hand a church a term it did not choose at a price nobody
 * agreed to. `null` here is "we could not read it", not "assume the default".
 */
function readPeriod(raw: unknown): BillingPeriod | null {
  return (BILLING_TERMS as readonly string[]).includes(raw as string) ? (raw as BillingPeriod) : null;
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
      // An existing tenant belongs to a plan-change path — /api/dodo/change-plan
      // for a Dodo-owned tenant, /api/stripe/checkout for a Stripe one. Falling
      // through would create a SECOND subscription for a church that already
      // has one, and bill them twice.
      return NextResponse.json(
        { error: 'This endpoint creates new ministries only. Plan changes go through /api/dodo/change-plan or /api/stripe/checkout.' },
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
