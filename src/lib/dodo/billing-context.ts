import { NextResponse } from 'next/server';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { getTenantPrivate, DODO_ON_HOLD_FIELD } from '@/lib/tenant-private';
import { billingActionUnavailable, resolveBillingOwnership } from '@/lib/billing-processor';
import { resolveTenantGraceState, DODO_GRACE_PERIOD_MS } from '@/lib/tenant-lifecycle';
import type { PricedPlan } from '@/types/tenant.types';
import { resolvePlanFromProductId } from './catalogue';
import type { BillingPeriod } from './provider';

/**
 * The guards every Dodo subscription-modifying route runs before it touches
 * money — extracted so there is ONE of each (REP-5b).
 *
 * `/api/dodo/change-plan` (THE-89, THE-128, THE-132) grew these one at a time.
 * `/api/dodo/addons` needs the same five, for the same reasons, on the same
 * subscription — and a second hand-written copy of a money-path guard is how the
 * two drift: one route learns about a new refusal state and the other keeps
 * charging through it. So the guards moved here whole, with their reasoning, and
 * both routes ask the same function.
 *
 * 🔴 WHAT THIS DELIBERATELY DOES NOT DO: authenticate. `requireOwner` stays at
 * the top of each route, called first, because the ORDER matters — an
 * unauthenticated caller must be refused before any tenant state is read or any
 * refusal reveals whether a tenant exists. Passing an already-authorised
 * `tenantId` in is what keeps that ordering visible at the call site rather than
 * buried in here.
 *
 * ⚠️ ONE PRIVATE-DOC READ, and the caller gets the document back. Both the
 * ownership check and the failed-renewal guard are answered from that single
 * copy; `dodo-change-plan-route.test.ts` pins the read COUNT absolutely, so a
 * second `getTenantPrivate` anywhere in this path fails that test rather than
 * quietly doubling every plan change's Firestore cost.
 */

/** A Dodo-owned, in-good-standing subscription, resolved to what it is on. */
export interface DodoSubscriptionContext {
  /** The Dodo subscription this tenant's billing runs on. Never empty. */
  readonly subscriptionId: string;
  /** The tier the tenant is on RIGHT NOW, resolved from its recorded product. */
  /**
   * The tier the tenant is on RIGHT NOW, resolved from its recorded product.
   *
   * 🔴 `PricedPlan`. This context only exists for a tenant with a live Dodo
   * subscription, and it is resolved FROM a Dodo product id — so it is
   * structurally impossible for it to be the Forever Free tier, which has no
   * product. Saying so in the type is what lets the add-on and change-plan
   * routes hand this straight to `requireProductId` without a narrowing check
   * that could only ever be dead code.
   */
  readonly plan: PricedPlan;
  /**
   * The billing period the tenant is on RIGHT NOW.
   *
   * 🔴 The value an add-on purchase must send back unchanged. Dodo's change-plan
   * call takes a product, and the monthly and annual products are DIFFERENT
   * products — so sending the other period's product while "only" adding an
   * add-on would silently switch the church's billing period. `change-plan`
   * refuses a cross-period request outright (THE-88); the add-on route never
   * forms one, because it reads the period from here rather than from the body.
   */
  readonly period: BillingPeriod;
  /**
   * The Dodo product the tenant is on RIGHT NOW — the id `plan` and `period`
   * were resolved FROM, carried out rather than re-derived.
   *
   * 🔴 THE ONLY THING THAT CAN ANSWER "MAY THIS CHURCH BUY THIS ADD-ON"
   * (THE-133). Dodo puts add-on availability on the PRODUCT — "Contacts +500"
   * is attached to Small Team and Ministry and not to Individual, "Unlimited
   * Contacts" to Ministry alone — so the set a tenant may be offered is an
   * intersection with THIS product's own `addons` array. That restriction lives
   * in the payment processor precisely so a Harvest bug cannot sell Unlimited
   * Contacts to a $49 plan, and reading it from here is what keeps the answer
   * derived instead of written down.
   *
   * Already proven to name a plan and a period by the lookup below, so a caller
   * re-deriving it would be a second answer to a settled question.
   */
  readonly productId: string;
  /** The private doc already read for the checks above. No second read. */
  readonly privateData: Record<string, any>;
}

/**
 * The grace deadline in words a church reads, rather than an ISO string.
 *
 * Locale and time zone are both PINNED. The surrounding copy is English, and
 * `timeZone: 'UTC'` keeps the day named here the same day
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

/**
 * Resolve an authorised tenant to the Dodo subscription a route may act on, or
 * return the refusal that stops it.
 *
 * `action` is the phrase that completes "…so this endpoint cannot X" and
 * "your plan cannot be changed yet"-style copy; `step` names the Sentry step for
 * the one case that reports. Everything else is identical between callers by
 * construction.
 */
export async function resolveDodoSubscriptionContext(args: {
  readonly tenantId: string;
  /** e.g. 'changing your plan' — used in the cross-processor refusal copy. */
  readonly action: string;
  /** Sentry step for an unresolvable current product. */
  readonly step: string;
  /**
   * What is blocked, e.g. 'your plan cannot be changed'.
   *
   * ⚠️ The two phrases are separate parameters rather than one sentence because
   * the refusal must never say "try again" or "retry": THE-128 pins the absence
   * of retry language, since a retry affordance on a route that cannot charge
   * would point a church at a dead end while its card is the actual problem.
   */
  readonly blockedPhrase: string;
  /** What they should do AFTER fixing the card, e.g. 'change your plan'. */
  readonly retryPhrase: string;
}): Promise<DodoSubscriptionContext | NextResponse> {
  const { tenantId, action, step, blockedPhrase, retryPhrase } = args;

  // ── 🔴 ONLY THE PROCESSOR THAT OWNS THE SUBSCRIPTION MAY CHANGE IT. ──────
  // The mirror image of the guard in /api/stripe/checkout: that route refuses
  // Dodo-owned tenants; this one refuses everything that is not Dodo-owned.
  // A conflicted tenant — identifiers from both processors, the fingerprint
  // of the double-billing bug — is refused on BOTH routes, with the same
  // wording, from the same helper.
  const privateData = await getTenantPrivate(tenantId);
  const ownership = resolveBillingOwnership(privateData);
  if (ownership.reason === 'conflict') {
    return billingActionUnavailable(action, ownership);
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
  // Nothing below would have charged this church twice or moved it to something
  // it has not paid for: `on_payment_failure: 'prevent_change'` is explicit on
  // every Dodo call, so the failed charge blocks the change. That guarantee was
  // never the defect. THE MESSAGE WAS. The refusal arrived from further down as
  // "Failed to change plan", and a church one failed payment into a 21-day
  // countdown reads that as Harvest being broken rather than as its card having
  // bounced — at the exact moment the one useful sentence is "update your card".
  //
  // COSTS NO ADDITIONAL READ. `dodoOnHoldAt` is on the private doc fetched just
  // above, and `resolveTenantGraceState` is the same pure resolver the donate
  // gate and `/api/tenants/grace-status` ask. The deadline quoted here and the
  // day giving actually stops are therefore one answer derived once.
  //
  // 🔴 BEFORE THE TRIAL CHECK AND BEFORE EVERY DODO CALL, deliberately. The
  // trial check reaches Dodo and answers 503 when it cannot — and a church whose
  // card just failed is precisely when "We could not verify your billing status
  // just now" is most likely to be what they see, which is the generic error
  // this exists to remove.
  //
  // ⚠️ NO PAYMENT SURFACE HERE, and none behind it. The way out is
  // `/api/stripe/portal` — the existing "Manage subscription" path, which routes
  // a Dodo-owned tenant to Dodo's hosted portal. A retry button on either route
  // would be a second way to be charged for one subscription.
  const onHoldAt = privateData[DODO_ON_HOLD_FIELD];
  const graceState = resolveTenantGraceState({ onHoldAt, now: Date.now() });
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
          ? `Your last payment did not go through, so ${blockedPhrase} yet. Update the card on file under Manage subscription and then ${retryPhrase}. Online giving stops on ${formatGraceDeadline(graceEndsAt)} if the payment is not completed.`
          : `Your last payment did not go through, so online giving has been paused and ${blockedPhrase}. Update the card on file under Manage subscription to restore your account, and then ${retryPhrase}.`,
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
      { error: `No active subscription was found for this organization, so ${action} is not available.` },
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
      new Error(`[dodo] ${step}: tenant ${tenantId} has unresolvable product "${currentProductId}"`),
      { step, level: 'error', tenantId },
    );
    return NextResponse.json(
      { error: 'We could not determine your current plan. Please contact support and we will make the change for you.' },
      { status: 409 },
    );
  }

  return {
    subscriptionId,
    plan: current.plan,
    period: current.period,
    productId: currentProductId,
    privateData,
  };
}
