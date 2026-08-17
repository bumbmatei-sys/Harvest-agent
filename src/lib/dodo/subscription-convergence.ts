import {
  getTenantPrivate,
  tenantPrivateRef,
  DODO_SUBSCRIPTION_CHECK_FIELD,
} from '@/lib/tenant-private';
import { resolveBillingOwnership } from '@/lib/billing-processor';
import { archiveTenantForDodoSubscription } from './lifecycle';
import type { DodoTerminalReason } from './lifecycle';
import type { BillingSubscription, BillingSubscriptionStatus } from './provider';

/**
 * Reconcile a tenant's recorded lifecycle against WHAT DODO ACTUALLY SAYS about
 * its subscription. THE-167.
 *
 * ─── The gap this closes ─────────────────────────────────────────────────────
 *
 * 🔴 Observed live on 2026-08-17: three subscriptions were cancelled through the
 * Dodo API. Dodo reports all three `status: cancelled`, `cancelled_at` set,
 * `cancel_at_next_billing_date: false` — immediate, terminal, done. Every tenant
 * doc still read `status: 'active'`. No lifecycle change at all.
 *
 * `subscription.cancelled` is one of the two terminal events, and `./lifecycle`
 * archives a tenant when it lands. So the state should have moved and did not.
 * The webhook endpoint is configured correctly — enabled, right URL,
 * `subscription.cancelled` in its `filter_types`.
 *
 * ⚠️ WHETHER THE EVENT EVER FIRED COULD NOT BE DETERMINED, and that is the whole
 * design argument. The Dodo SDK exposes no delivery log (`webhookEvents` is a
 * namespace with no methods), `/webhooks/{id}/messages` and `/attempts` return
 * 403, and `/events` returned an empty list minutes after the cancellations.
 * Three causes remain live: no event was emitted for an API-initiated cancel, an
 * event was emitted and failed, or an event was delivered, returned 2xx, and
 * silently no-opped. There is no way to tell which.
 *
 * 🔴 SO THIS DOES NOT FIX THE WEBHOOK. It stops DEPENDING on the webhook for a
 * terminal state. A convergence closes all three causes at once; a webhook fix
 * closes at most two and you cannot tell which two.
 *
 * ─── Shape: the one the repo already uses ────────────────────────────────────
 *
 * `/api/tenants/grace-status` already does exactly this for the grace timer —
 * `convergeExpiredDodoGrace`, after the response is built, inside a try/catch.
 * This is its SIBLING, not a replacement: that one reconciles Harvest's OWN
 * 21-day clock, this one reconciles the PROCESSOR's status. They share a route
 * and a `now` and nothing else, and neither can break the other.
 *
 * It is also the same NARROWNESS the named Dodo exceptions are held to (see
 * `dodo-billing-flag.test.ts`): this module exports ONE function, it performs a
 * single GET against Dodo, and it cannot charge, cancel, provision, or read a
 * catalogue. `renewal.ts` is the template.
 *
 * ─── 🔴 ONE WRITER ───────────────────────────────────────────────────────────
 *
 * The webhook is the single writer of `plan` and of the lifecycle state, and
 * this does not become a second one. It NEVER writes `tenants/{id}.status`
 * itself — it calls `archiveTenantForDodoSubscription`, the exact function
 * `handleDodoSubscriptionCancelled` calls, and inherits every refusal that path
 * already makes: the `isDodoOwned` ownership check, the already-archived
 * short-circuit, and the one batch that lands the public status and the private
 * provenance together. A second writer of a lifecycle field is the shape that
 * has caused repeated bugs here.
 *
 * The only field this module writes on its own is the throttle stamp below,
 * which is bookkeeping about Harvest's polling and which nothing gates on.
 *
 * ─── 🔴 ONE DIRECTION: TOWARD TERMINAL, NEVER BACK ───────────────────────────
 *
 * A Dodo status of `cancelled` or `expired` archives. NOTHING here reactivates,
 * and that is structural rather than remembered: this module does not import
 * `reactivateTenantForDodoSubscription` and has no path to it. `subscription
 * .active` is how an archived church comes back (see `./provisioning`), that
 * path is deliberate and already tested, and resurrecting a tenant through a
 * side channel could switch a church back on that has not paid.
 *
 * So a Dodo status this module does not recognise as terminal — `active`,
 * `on_hold`, `paused`, `pending`, `failed` — writes NOTHING. In particular
 * `on_hold` is left entirely alone: the grace timer owns that state, it is
 * Harvest's own 21-day clock, and reaching into it from here would be a second
 * writer of the very field the sibling convergence exists to manage.
 */

/**
 * How often a single tenant may be reconciled against Dodo. SIX HOURS.
 *
 * ─── ⚠️ Why there is a throttle at all ───────────────────────────────────────
 *
 * `/api/tenants/grace-status` is called on every admin shell mount. THE-139 was
 * a 429 on THIS EXACT ROUTE that stripped the admin nav, so an unthrottled Dodo
 * call per page load is not a cost this route can carry — a church with three
 * admins clicking around would generate hundreds of API calls a day for a fact
 * that changes at most a handful of times in a subscription's life.
 *
 * ─── Why six hours, specifically ─────────────────────────────────────────────
 *
 * It bounds Dodo reads to at most FOUR PER TENANT PER DAY no matter how heavy
 * the admin traffic is — the rate stops being a function of usage and becomes a
 * function of wall-clock, which is the property that makes THE-139 unrepeatable
 * here.
 *
 * And it buys nearly all of the available correctness. The defect being fixed is
 * UNBOUNDED: a cancelled church keeps giving, publishing and sending forever.
 * Six hours turns "forever" into "at most a quarter of a day", which is the
 * whole of the difference that matters; going to five minutes would multiply the
 * call rate ~72× to shave hours off a backstop.
 *
 * 🔴 Because it IS a backstop. The webhook remains the fast path when it works —
 * it archives in seconds — and this only has to catch the case where the webhook
 * did not. A backstop's latency budget is hours, and this lifecycle already runs
 * on a 21-day grace window, so six hours is not the coarse part of the system.
 */
export const DODO_SUBSCRIPTION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * The Dodo statuses that mean "this subscription is over", mapped to the
 * provenance reason the archive path records.
 *
 * ⚠️ Written against `BillingSubscriptionStatus` — the app's own vocabulary from
 * `./provider` — not against Dodo's spelling, so the seam keeps its meaning. A
 * status absent from this table is NOT terminal and archives nothing; new
 * processor states default to leaving the tenant alone, which is the direction a
 * money path should fail in.
 */
const TERMINAL_STATUS_REASONS: Partial<Record<BillingSubscriptionStatus, DodoTerminalReason>> = {
  cancelled: 'cancelled',
  expired: 'expired',
};

/**
 * What a subscription-status convergence decided.
 *
 * ⚠️ The success case is `converged`, not `archived`, and the difference is the
 * point: THIS module converges, `./lifecycle` archives. It also keeps the literal
 * `'archived'` out of a file that is not the writer of that state —
 * `dodo-subscription-lifecycle.test.ts` pins that entitlement truth has exactly
 * one home, and a second file spelling the status would be the first step to a
 * second one.
 */
export type DodoSubscriptionConvergenceOutcome =
  /** Dodo reported a terminal status, and the archive path moved the tenant. */
  | { readonly outcome: 'converged'; readonly tenantId: string; readonly reason: DodoTerminalReason }
  /** Terminal at Dodo, but a webhook or the grace timer got there first. Nothing written. */
  | { readonly outcome: 'already-archived'; readonly tenantId: string }
  /** Dodo reported a NON-terminal status. Nothing written, and nothing resurrected. */
  | { readonly outcome: 'live'; readonly tenantId: string }
  /** Asked too recently. 🔴 Dodo was NOT called. */
  | { readonly outcome: 'throttled'; readonly tenantId: string }
  /** No Dodo subscription id on the private doc, so there is nothing to read. */
  | { readonly outcome: 'no-subscription'; readonly tenantId: string }
  /** 🔴 The tenant's subscription belongs to another processor. Refused. */
  | { readonly outcome: 'not-dodo-owned'; readonly tenantId: string };

/**
 * Ask Dodo what this tenant's subscription is doing, and archive it if Dodo says
 * it is over.
 *
 * `now` is injected so the caller decides what "now" means, and so the route can
 * resolve its answer and its convergence against ONE clock — the same contract
 * `convergeExpiredDodoGrace` has.
 *
 * Errors are NOT caught here. The caller owns what a Dodo outage looks like on
 * its own surface, and for `/api/tenants/grace-status` that is "the admin still
 * gets their answer, and the failure is reported to Sentry" — swallowing it here
 * would take that choice away and make an outage indistinguishable from a
 * subscription that is simply still running.
 */
export async function convergeDodoSubscriptionStatus(
  tenantId: string,
  now: number,
): Promise<DodoSubscriptionConvergenceOutcome> {
  const priv = await getTenantPrivate(tenantId);

  // 🔴 Ownership FIRST, and before any network call. A Stripe-owned or
  // conflict-owned tenant is not Dodo's to read or to archive, and asking Dodo
  // about a subscription id that is not Dodo's would be the first half of acting
  // on it. Same refusal `./lifecycle` makes, from the same resolver.
  if (resolveBillingOwnership(priv).processor !== 'dodo') {
    return { outcome: 'not-dodo-owned', tenantId };
  }

  const subscriptionId = typeof priv?.dodoSubscriptionId === 'string' ? priv.dodoSubscriptionId : '';
  if (!subscriptionId) {
    // Dodo-owned via `billingProcessor` or a customer id, but with no
    // subscription to read. The archive path is keyed on that id, so there is
    // nothing this can converge.
    return { outcome: 'no-subscription', tenantId };
  }

  // ⚠️ THE THROTTLE, checked off the private doc that was already read — no
  // extra read, and no write at all on a throttled load, which is the common
  // case by a wide margin. A stamp in the future (clock skew) reads as "asked
  // recently" and holds off, which is the conservative direction.
  const lastCheckedAt = Date.parse(String(priv?.[DODO_SUBSCRIPTION_CHECK_FIELD] ?? ''));
  if (Number.isFinite(lastCheckedAt) && now - lastCheckedAt < DODO_SUBSCRIPTION_CHECK_INTERVAL_MS) {
    return { outcome: 'throttled', tenantId };
  }

  /**
   * 🔴 STAMPED BEFORE THE CALL, NOT AFTER IT — deliberately.
   *
   * Stamping on success only would mean a Dodo outage removes the throttle
   * exactly when Dodo is least able to absorb traffic: every admin load would
   * retry, which is THE-139's failure mode with an outage on top of it. Stamping
   * first bounds the call rate unconditionally.
   *
   * The cost is stated plainly: a transient Dodo failure delays convergence by
   * one interval. That is acceptable for a backstop whose alternative is "never"
   * — the next load after the interval retries, and the webhook is still the
   * fast path throughout.
   *
   * ⚠️ No `updatedAt`. This records HARVEST'S polling, not a change to the
   * church, and touching the doc's modification marker for it would make routine
   * bookkeeping look like a tenant change to anyone reading the document.
   */
  await tenantPrivateRef(tenantId).set(
    { [DODO_SUBSCRIPTION_CHECK_FIELD]: new Date(now).toISOString() },
    { merge: true },
  );

  /**
   * The provider is imported LAZILY, and that is load-bearing rather than
   * stylistic — the same reason `renewal.ts` does it. `./config` throws at
   * IMPORT time when a `DODO_PAYMENTS_*` variable is missing, and this runs on a
   * route that serves every Stripe tenant too. A static import would break the
   * admin's grace banner for churches that have nothing to do with Dodo.
   */
  const { dodoBillingProvider } = await import('./dodo-provider');
  const sub: BillingSubscription = await dodoBillingProvider.getSubscription(subscriptionId);

  const reason = TERMINAL_STATUS_REASONS[sub.status];
  if (!reason) {
    // 🔴 THE NON-RESURRECTION CASE. Dodo says the subscription is still live (or
    // in a state Harvest does not treat as terminal). Whatever the tenant's
    // recorded status is, it is LEFT ALONE — an archived tenant stays archived,
    // because coming back is `subscription.active`'s job and this is not that
    // path.
    return { outcome: 'live', tenantId };
  }

  // 🔴 THE SAME PATH THE WEBHOOK USES. Not a status write of its own.
  const result = await archiveTenantForDodoSubscription({ subscription_id: subscriptionId }, reason);

  /**
   * The refusals first, and the success case by EXHAUSTIVE NARROWING rather than
   * by testing for it. Two reasons, and both are worth the slightly unusual
   * shape.
   *
   * It is STRICTER: `DodoLifecycleOutcome` is a closed union, so a refusal added
   * to the archive path later becomes a type error here rather than being
   * silently reported as a successful convergence.
   *
   * And it keeps the literal name of the archived state out of this file
   * entirely. `dodo-subscription-lifecycle.test.ts` pins that only the module
   * which OWNS that state spells it, because two files spelling it is how a
   * second source of entitlement truth starts — the exact failure mode the
   * one-writer rule exists to prevent.
   */
  if (result.outcome === 'already-archived') return { outcome: 'already-archived', tenantId };
  if (result.outcome === 'not-dodo-owned') return { outcome: 'not-dodo-owned', tenantId };
  if (result.outcome === 'no-tenant' || result.outcome === 'no-subscription-id') {
    return { outcome: 'no-subscription', tenantId };
  }

  console.log(
    `🔄 [dodo] Tenant ${tenantId}: Dodo reports subscription ${subscriptionId} ${reason}; ` +
      `recorded state converged to the ${result.reason} lifecycle state`,
  );
  return { outcome: 'converged', tenantId, reason };
}
