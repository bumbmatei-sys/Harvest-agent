import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireOwner } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { resolveDodoSubscriptionContext } from '@/lib/dodo/billing-context';
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
import { BILLING_TERMS } from '@/utils/plan-features';

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
 *  • It does not sell ADD-ONS. Buying, re-quantifying or dropping one without
 *    moving tier is `/api/dodo/addons` (REP-5b) — a sibling route rather than a
 *    flag on this one, because an add-on purchase is definitionally a same-plan
 *    call and would collide with the `plan === current.plan` refusal below. See
 *    that route's header for the full reasoning and for its own trial decision.
 *    Both routes share one implementation of the guards above.
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

/**
 * Validate the requested term, REFUSING anything unrecognised.
 *
 * Deliberately returns null rather than falling back the way
 * `readSignupBillingPeriod` falls back to monthly: this route changes what an
 * existing subscription is charged, so "we could not read your term" must be a
 * 400 the owner sees, never a silent choice made on their behalf. Reads
 * `BILLING_TERMS` so the accepted set is the priced set.
 */
function readPeriod(raw: unknown): BillingPeriod | null {
  return (BILLING_TERMS as readonly string[]).includes(raw as string) ? (raw as BillingPeriod) : null;
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

    // ── The guards this route shares with `/api/dodo/addons`. ────────────────
    //
    // Ownership (only the processor that owns a subscription may change it), the
    // THE-128 failed-renewal refusal, and the current-product resolution all
    // live in `@/lib/dodo/billing-context` now that a second route needs the
    // same five checks on the same subscription. Their reasoning moved with
    // them; a second hand-written copy of a money-path guard is how two routes
    // drift into disagreeing about when to refuse.
    //
    // ⚠️ STILL ONE `tenant_private` READ, and still AFTER `requireOwner` — the
    // ordering is preserved at this call site rather than buried in the helper.
    const context = await resolveDodoSubscriptionContext({
      tenantId: ownerOrErr.tenantId,
      action: 'changing your plan',
      step: 'dodo-change-plan-unknown-current-product',
      blockedPhrase: 'your plan cannot be changed',
      retryPhrase: 'change your plan',
    });
    if (context instanceof NextResponse) return context;

    const current = { plan: context.plan, period: context.period };
    const subscriptionId = context.subscriptionId;

    if (period !== current.period) {
      // Each term is a separate Dodo product, so this call COULD switch term —
      // but that is THE-88, its own decision, not a side door. Now that there
      // are three terms the message names neither pair: a quarterly church told
      // "monthly and annual" would reasonably think the refusal was not about
      // them.
      return NextResponse.json(
        { error: 'Switching billing terms is not available yet. Please contact support.' },
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
