import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireOwner } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { getTenantPrivate, DODO_ON_HOLD_FIELD } from '@/lib/tenant-private';
import { billingActionUnavailable, resolveBillingOwnership } from '@/lib/billing-processor';
import { resolveTenantGraceState, DODO_GRACE_PERIOD_MS } from '@/lib/tenant-lifecycle';
import { resolvePlanFromProductId } from '@/lib/dodo/catalogue';
import {
  describeDodoAddons,
  executeDodoPlanChange,
  isDodoSubscriptionInTrial,
  planDodoAddonCarryOver,
  previewDodoPlanChange,
  retrieveDodoSubscription,
  type DodoAddonCarryOver,
  type DodoNamedAddon,
  type DodoSubscriptionLike,
} from '@/lib/dodo/dodo-provider';
import type { BillingPeriod } from '@/lib/dodo/provider';
import { PLAN_ORDER } from '@/utils/plan-features';
import type { TenantPlan } from '@/types/tenant.types';

/**
 * POST /api/dodo/change-plan — the existing-tenant plan change, on Dodo (THE-89).
 *
 * The Dodo counterpart of the plan-change branch in `/api/stripe/checkout`,
 * which refuses Dodo-owned tenants (correctly — a Stripe checkout for a Dodo
 * tenant is the double-billing bug). This route is where those tenants go
 * instead. It lives under `app/api/dodo/` rather than inside the Stripe route
 * because `dodo-billing-flag.test.ts` holds every file outside the Dodo module
 * to a no-Dodo-imports rule with three hard-won exceptions, and the recorded
 * rule is that the third was the signal to build a seam, not to add a fourth.
 * The client picks this route from the `processor` it already receives from
 * `/api/billing/invoices`; a stale bundle that posts a Dodo tenant to the
 * Stripe route still gets the 409 there, so the guard never depends on the
 * client choosing correctly.
 *
 * ─── Two-phase: preview, then confirm ────────────────────────────────────────
 *
 * Without `confirm: true` the route only PREVIEWS: it returns what Dodo would
 * charge now (`previewChangePlan`), and nothing is billed. With `confirm: true`
 * it performs the change. The client shows the preview and asks; a church never
 * commits to a proration it has not seen.
 *
 * The preview also names the ADD-ONS the change would remove (THE-132). A Dodo
 * add-on is attached to specific products, so a downgrade can land on a plan
 * that does not offer one the church holds; that add-on goes, and it is said in
 * words before the confirm, not discovered on the next invoice.
 *
 * ─── What this route deliberately does NOT do ────────────────────────────────
 *
 *  • It never writes `tenants/{id}.plan`. The `subscription.plan_changed`
 *    webhook is the single writer — see `@/lib/dodo/plan-change` for why.
 *  • It never touches Stripe. No import, no call, no customer creation.
 *  • It refuses during the 14-day trial. Every Dodo proration mode ends a trial
 *    (the immediate ones charge right away), so a day-3 upgrade would silently
 *    take days 4–14 the church was promised. An honest refusal is recoverable;
 *    an early charge is not (Harvest issues no refunds).
 *  • It refuses a tenant whose renewal failed, IN ITS OWN WORDS (THE-128). The
 *    change was already blocked for that church — `on_payment_failure:
 *    'prevent_change'` sees to that — but the refusal reached them as a generic
 *    failure, which reads as "Harvest is broken" rather than "your card
 *    bounced". It offers no payment surface of its own; see the guard.
 *  • It refuses a monthly↔annual switch. Annual products are separate Dodo
 *    products, so the same API call would do it — but annual billing is THE-88,
 *    a separate decision, and this route does not make it by accident.
 *  • It does NOT read `DODO_BILLING_ENABLED`. The flag gates whether NEW
 *    checkouts are created; a tenant already billed by Dodo must be able to
 *    manage what it pays even after a rollback, same as the portal (THE-79).
 *    The gate here is ownership: only a Dodo-owned tenant passes.
 */

export const dynamic = 'force-dynamic';

function readPlan(raw: unknown): TenantPlan | null {
  return typeof raw === 'string' && (PLAN_ORDER as readonly string[]).includes(raw)
    ? (raw as TenantPlan)
    : null;
}

function readPeriod(raw: unknown): BillingPeriod | null {
  return raw === 'monthly' || raw === 'yearly' ? raw : null;
}

/**
 * The grace deadline in words a church reads, rather than an ISO string.
 *
 * Locale and time zone are both PINNED. The rest of this route's copy is
 * English, and `timeZone: 'UTC'` keeps the day named here the same day
 * `/api/tenants/grace-status` counts down to — a server in UTC-7 formatting the
 * same instant in local time would name the day before, and the two surfaces
 * would quote different deadlines for one window.
 */
function formatGraceDeadline(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenantId, plan: rawPlan, billing: rawBilling, confirm } = body ?? {};

    if (!tenantId || typeof tenantId !== 'string') {
      return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
    }

    // 🔴 THE GATE, from THE-80: the owner, the roster admin, and the super
    // admin — the same three identities the Stripe plan-change branch admits,
    // via the same helper. Changing what an organisation pays is an owner act;
    // a tenant admin who is none of those gets 403 here exactly as they do
    // there.
    const ownerOrErr = await requireOwner(request, { tenantId });
    if (ownerOrErr instanceof NextResponse) return ownerOrErr;

    const plan = readPlan(rawPlan);
    const period = readPeriod(rawBilling);
    if (!plan || !period) {
      return NextResponse.json(
        { error: `Invalid plan/billing: ${rawPlan}/${rawBilling}` },
        { status: 400 },
      );
    }

    // ── 🔴 ONLY THE PROCESSOR THAT OWNS THE SUBSCRIPTION MAY CHANGE IT. ──────
    // The mirror image of the guard in /api/stripe/checkout: that route refuses
    // Dodo-owned tenants; this one refuses everything that is not Dodo-owned.
    // A conflicted tenant — identifiers from both processors, the fingerprint
    // of the double-billing bug — is refused on BOTH routes, with the same
    // wording, from the same helper.
    const privateData = await getTenantPrivate(ownerOrErr.tenantId);
    const ownership = resolveBillingOwnership(privateData);
    if (ownership.reason === 'conflict') {
      return billingActionUnavailable('changing your plan', ownership);
    }
    if (ownership.processor !== 'dodo') {
      return NextResponse.json(
        {
          error:
            'This organization is not billed through Dodo Payments, so this endpoint cannot change its plan. Please use the standard plan change instead.',
          code: 'billing-action-unavailable',
          processor: ownership.processor,
          reason: ownership.reason,
        },
        { status: 409 },
      );
    }

    // ── 🔴 A FAILED RENEWAL IS NAMED, NOT LEFT AS A GENERIC FAILURE (THE-128). ─
    //
    // Nothing below would have charged this church twice or moved it to a tier
    // it has not paid for: `on_payment_failure: 'prevent_change'` is explicit on
    // both Dodo calls, so the failed charge blocks the change. That guarantee
    // was never the defect. THE MESSAGE WAS. The refusal arrived from further
    // down as "Failed to change plan", and a church one failed payment into a
    // 21-day countdown reads that as Harvest being broken rather than as its
    // card having bounced — at the exact moment the one useful sentence is
    // "update your card". This says that sentence.
    //
    // COSTS NO ADDITIONAL READ. `dodoOnHoldAt` is on the private doc fetched
    // above for the ownership check, and `resolveTenantGraceState` is the same
    // pure resolver the donate gate and `/api/tenants/grace-status` ask. The
    // deadline quoted here and the day giving actually stops are therefore one
    // answer derived once, not two that can drift.
    //
    // 🔴 BEFORE THE TRIAL CHECK AND BEFORE EVERY DODO CALL, deliberately. The
    // trial check reaches Dodo and answers 503 when it cannot — and a church
    // whose card just failed is precisely when "We could not verify your
    // billing status just now" is most likely to be what they see, which is the
    // generic error this exists to remove. The one fact worth having is already
    // in hand. It also means a subscription that is somehow both in trial and
    // on hold hears about the card first: the trial refusal tells them to wait,
    // which is wrong advice for a payment that has already failed.
    //
    // ⚠️ NO PAYMENT SURFACE HERE, and none behind it. The way out is
    // `/api/stripe/portal` — the existing "Manage subscription" path, which
    // routes a Dodo-owned tenant to Dodo's hosted portal, and the same
    // destination the dunning email's "Update payment method" link already
    // points at. A retry button on this route would be a second way to be
    // charged for one subscription.
    const now = Date.now();
    const onHoldAt = privateData[DODO_ON_HOLD_FIELD];
    const graceState = resolveTenantGraceState({ onHoldAt, now });
    if (graceState !== 'none') {
      // `in-grace` is the only state with time left to report, exactly as
      // `/api/tenants/grace-status` treats it. The 21 is not re-derived here —
      // the window has one definition and this reads it; `onHoldAt` parsed
      // cleanly or the resolver would have answered 'none'.
      const graceEndsAt =
        graceState === 'in-grace'
          ? new Date(Date.parse(onHoldAt as string) + DODO_GRACE_PERIOD_MS).toISOString()
          : undefined;

      return NextResponse.json(
        {
          error: graceEndsAt
            ? `Your last payment did not go through, so your plan cannot be changed yet. Update the card on file under Manage subscription and then change your plan. Online giving stops on ${formatGraceDeadline(graceEndsAt)} if the payment is not completed.`
            : 'Your last payment did not go through, so online giving has been paused and your plan cannot be changed. Update the card on file under Manage subscription to restore your account, and then change your plan.',
          // Its own code, distinct from the trial and ownership refusals, so the
          // client branches on the reason rather than on the prose.
          code: 'plan-change-unavailable-payment-failed',
          state: graceState,
          ...(graceEndsAt ? { graceEndsAt } : {}),
          // The existing portal path — a place to fix the card, never a charge.
          manageBillingPath: '/api/stripe/portal',
        },
        { status: 409 },
      );
    }

    const subscriptionId: string =
      typeof privateData.dodoSubscriptionId === 'string' ? privateData.dodoSubscriptionId : '';
    if (!subscriptionId) {
      return NextResponse.json(
        { error: 'No active subscription was found for this organization, so changing your plan is not available.' },
        { status: 409 },
      );
    }

    // The tenant's current product decides what a "change" even is. Written at
    // provisioning and kept current by the plan_changed webhook.
    const currentProductId: string =
      typeof privateData.dodoProductId === 'string' ? privateData.dodoProductId : '';
    const current = currentProductId ? resolvePlanFromProductId(currentProductId) : null;
    if (!current) {
      // A product outside this build's catalogue (or none recorded at all). The
      // same never-guess rule as everywhere else: without knowing what they are
      // on, "change" could double for "sell them something else".
      captureMoneyPathError(
        new Error(`[dodo] change-plan: tenant ${ownerOrErr.tenantId} has unresolvable product "${currentProductId}"`),
        { step: 'dodo-change-plan-unknown-current-product', level: 'error', tenantId: ownerOrErr.tenantId },
      );
      return NextResponse.json(
        { error: 'We could not determine your current plan. Please contact support and we will make the change for you.' },
        { status: 409 },
      );
    }

    if (period !== current.period) {
      // Annual products are separate Dodo products, so this call COULD switch
      // billing period — but that is THE-88, its own decision, not a side door.
      return NextResponse.json(
        { error: 'Switching between monthly and annual billing is not available yet. Please contact support.' },
        { status: 400 },
      );
    }

    if (plan === current.plan) {
      return NextResponse.json(
        { error: 'Your organization is already on this plan.' },
        { status: 400 },
      );
    }

    // ── 🔴 NO PLAN CHANGES DURING THE TRIAL. ─────────────────────────────────
    // Checked on the preview AND re-checked on the confirm — the confirm is the
    // one that charges. See `isDodoSubscriptionInTrial` for the two detections.
    // A failure to determine trial status refuses too: uncertainty about
    // whether a church will be charged early is resolved by not charging.
    let subscription: DodoSubscriptionLike;
    let inTrial: boolean;
    try {
      // Retrieved ONCE and used twice: the trial check reads its dates, the
      // add-on carry-over below reads what it holds. The confirm path therefore
      // grows no subscription read at all.
      subscription = await retrieveDodoSubscription(subscriptionId);
      inTrial = await isDodoSubscriptionInTrial(subscriptionId, subscription);
    } catch (trialErr) {
      captureMoneyPathError(trialErr, {
        step: 'dodo-change-plan-trial-check',
        level: 'error',
        tenantId: ownerOrErr.tenantId,
        ids: { subscriptionId },
      });
      return NextResponse.json(
        { error: 'We could not verify your billing status just now. Please try again in a few minutes.' },
        { status: 503 },
      );
    }
    if (inTrial) {
      return NextResponse.json(
        {
          error:
            'Your free trial is still running. Changing plans now would end the trial early and charge you today, so plan changes are disabled until the trial ends. You can pick any plan then — or contact support if you need to switch sooner.',
          code: 'plan-change-unavailable-during-trial',
        },
        { status: 409 },
      );
    }

    // ── 🔴 ADD-ONS: WHAT SURVIVES THE CHANGE, AND WHAT THE CHURCH LOSES. ─────
    // A Dodo add-on is attached to specific products, so a downgrade can land
    // on a plan that does not offer something the church is paying for. That
    // add-on is removed — and named in the preview, so the loss is read BEFORE
    // the confirm rather than discovered on the next invoice.
    //
    // Computed ONCE here, for the preview and the confirm alike: the confirm
    // sends exactly the set the quoted amount was calculated from.
    //
    // 🔴 A FAILURE TO READ REFUSES. "No add-ons" and "could not determine the
    // add-ons" are different facts, and sending `[]` for the second would
    // delete something a church pays for on the strength of a network error.
    let carryOver: DodoAddonCarryOver;
    let addOnsCarried: DodoNamedAddon[] = [];
    let addOnsRemoved: DodoNamedAddon[] = [];
    try {
      carryOver = await planDodoAddonCarryOver(subscription, plan, period);
      if (confirm !== true) {
        // Names cost a call each and are only ever shown, so they are fetched
        // on the preview and never on the confirm.
        [addOnsCarried, addOnsRemoved] = await Promise.all([
          describeDodoAddons(carryOver.carried),
          describeDodoAddons(carryOver.removed),
        ]);
      }
    } catch (addonErr) {
      captureMoneyPathError(addonErr, {
        step: 'dodo-change-plan-addons',
        level: 'error',
        tenantId: ownerOrErr.tenantId,
        ids: { subscriptionId },
      });
      return NextResponse.json(
        { error: 'We could not check the add-ons on your subscription just now, so your plan was left unchanged. Please try again in a few minutes.' },
        { status: 503 },
      );
    }

    if (confirm !== true) {
      // Preview only. Nothing has been charged and nothing has changed.
      const preview = await previewDodoPlanChange(subscriptionId, plan, period, carryOver.carried);
      return NextResponse.json({
        preview: {
          amountDueNow: preview.amountDueNow,
          creditMovement: preview.creditMovement,
          currency: preview.currency,
          plan,
          billing: period,
          // By NAME. `adn_0NlKtwD3VfBLgx2LTw69O` is not a thing a church can
          // weigh a decision against; "Unlimited Contacts" is.
          addOnsCarried,
          addOnsRemoved,
        },
      });
    }

    // The real thing. `on_payment_failure: 'prevent_change'` is set inside —
    // a failed payment leaves the church exactly where it was. The tenant's
    // `plan` is NOT written here: the `subscription.plan_changed` webhook is
    // the single writer, and it fires only when the change actually took.
    await executeDodoPlanChange(subscriptionId, plan, period, carryOver.carried);

    return NextResponse.json({
      ok: true,
      message: 'Your plan change is confirmed. It may take a moment to appear.',
    });
  } catch (error: any) {
    console.error('Dodo change-plan error:', error?.message || error);
    captureMoneyPathError(error, { step: 'dodo-change-plan', level: 'error' });
    return NextResponse.json(
      { error: error?.message || 'Failed to change plan' },
      { status: 500 },
    );
  }
}
