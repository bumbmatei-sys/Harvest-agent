import { adminDb } from '@/lib/firebase-admin';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { resolveBillingOwnership } from '@/lib/billing-processor';
import {
  getTenantPrivate,
  tenantPrivateRef,
  TENANT_PRIVATE_COLLECTION,
  DODO_ON_HOLD_FIELD,
} from '@/lib/tenant-private';
import {
  DODO_GRACE_PERIOD_DAYS,
  DODO_GRACE_PERIOD_MS,
  resolveTenantGraceState,
  TENANT_STATUS_ACTIVE,
  TENANT_STATUS_ARCHIVED,
} from '@/lib/tenant-lifecycle';
import type { DodoWebhookEvent } from './events';

/**
 * The far end of the Dodo subscription lifecycle: `cancelled` and `expired`.
 *
 * ─── The gap this closes ─────────────────────────────────────────────────────
 *
 * 🔴 Both events were RECOGNISED by the dispatcher and had NO handler. A church
 * cancelled through Dodo's hosted portal, Dodo stopped billing them, and Harvest
 * left the tenant `active` with full entitlements, indefinitely. Note the
 * direction: that gives the product away rather than taking it away. Not
 * customer harm — revenue loss — but it also meant the entire recorded lifecycle
 * was unenforced for anyone on Dodo.
 *
 * ─── What this handler does, and what it refuses to do ───────────────────────
 *
 * DOWNGRADE, NEVER LOCK OUT. The tenant moves to the recorded lifecycle state —
 * not to deleted, not to disabled:
 *
 *   • `tenants/{id}.status` → 'archived'. One field, the one the app now reads
 *     lifecycle entitlement from (`@/lib/tenant-lifecycle`).
 *   • `tenants/{id}.plan` is NOT TOUCHED. Two reasons, and both matter.
 *     Reactivation must be total, and `plan` is the record of WHICH TIER to
 *     restore — overwrite it and the church comes back on the wrong product.
 *     And a rewrite to the entry tier (which is what the Stripe path does on
 *     `customer.subscription.deleted`: `plan: 'plus'`) does not stop anything;
 *     it hands the church a working paid tier, donate page included.
 *   • ⚠️ Admins keep full login and full read access, and 🔴 EVERY export keeps
 *     working. Enforced by `NEVER_GATED` in `@/lib/tenant-lifecycle`, not by
 *     this module remembering not to.
 *   • `users/{uid}.plan` is NOT rewritten either — same reason, plus it is a
 *     per-user copy of the tier and stripping it would survive reactivation as
 *     a set of members quietly on the wrong plan.
 *
 * ─── `cancelled` and `expired` land in the SAME state. Why. ──────────────────
 *
 * They are not the same event: `expired` is end-of-term, `cancelled` is a
 * decision. But a lifecycle state is not a reason code, it is an answer to "what
 * may this tenant do now" — and the answer is identical, because both are
 * TERMINAL. Neither has retries behind it, neither has dunning ahead of it, and
 * neither is recoverable except by a new subscription, which arrives as
 * `subscription.active` and restores the tenant wholesale (see below). A second
 * state whose capability table was a copy of this one would be a second source
 * of entitlement truth bought for nothing.
 *
 * The distinction is not thrown away: WHICH event archived the tenant is written
 * to `tenant_private.dodoSubscriptionStatus`, a server-only provenance field
 * that no entitlement check reads.
 *
 * ─── ⚠️ Voluntary cancellation skips grace, and Dodo already handled "at
 *     period end" ───────────────────────────────────────────────────────────
 *
 * A failed card gets 21 days because it is probably an accident; a cancellation
 * is a decision, so there is no grace period here — the tenant archives when the
 * event lands.
 *
 * That is correct AND honours "at period end, not immediately — they paid for
 * the period", because the deferral happens at the PROCESSOR, not here. Both
 * cancellation surfaces ask Dodo to stop at the end of the paid period —
 * `dodoBillingProvider.cancelSubscription` sends `cancel_at_next_billing_date`
 * for `atPeriodEnd`, and Dodo's hosted portal offers the same choice — and Dodo
 * emits `subscription.cancelled` when the subscription ACTUALLY reaches
 * cancelled, not when the request was made. So the event arriving IS period end.
 *
 * 🔴 This is deliberately NOT a timer. `subscription.on_hold` is the one that
 * needs a timer Harvest owns, because Dodo runs the retries and dunning but
 * never cancels — at the end of the recovery window retries stop and the
 * subscription sits in `on_hold` forever.
 *
 * ─── THE `on_hold` TIMER, added here ─────────────────────────────────────────
 *
 * That timer now lives in this file too, below the terminal handlers. It is
 * REACTIVE BY DESIGN and that is a constraint, not a shortcut: `functions/` does
 * not deploy on merge and has silently no-opped behind a green "Deploy
 * complete!", so a scheduled job is not a mechanism this repo actually has. So
 * nothing counts down in the background. Instead:
 *
 *   RECORD     `subscription.on_hold` writes ONE timestamp to the private doc.
 *              Nothing is gated yet — the church keeps everything.
 *   DERIVE     Every read that matters resolves that timestamp against `now`
 *              (`resolveEffectiveTenantStatus` in `@/lib/tenant-lifecycle`), so
 *              the deadline is enforced the instant it is consulted rather than
 *              whenever a cron happened to run.
 *   CONVERGE   The first consultation AFTER the window closes archives the
 *              tenant for real, through `archiveTenantForDodoSubscription` —
 *              the same guarded path the terminal events use — so the recorded
 *              state catches up with the enforced one instead of leaving a
 *              tenant permanently `active`-but-refused.
 *
 * ⚠️ The order matters: enforcement never waits on convergence. The gate refuses
 * from the derived answer, and the write is best-effort afterwards. A tenant
 * whose convergence write failed is still refused, every time, on every request.
 *
 * ─── Idempotency, beyond the webhook-id guard ────────────────────────────────
 *
 * #290's `webhook-id` reservation covers a REDELIVERY of one event. It does not
 * cover two DIFFERENT events describing the same ending, which is the normal
 * case: Dodo fires `subscription.cancelled` and then `subscription.expired` for
 * one subscription, each with its own webhook-id, and both are first deliveries.
 * So the handler is idempotent on its own terms — if the tenant is already
 * archived it writes NOTHING and returns `already-archived`. Applying twice
 * would not corrupt the state, but the check is what makes "applies once" an
 * observable property rather than a coincidence of the write being the same.
 */

/** Fields this module reads off a Dodo subscription payload. */
export interface DodoLifecyclePayload {
  subscription_id?: unknown;
  status?: unknown;
  customer?: { customer_id?: unknown } | null;
  metadata?: unknown;
}

/**
 * Why the tenant was archived. Provenance only — never a gate.
 *
 * ⚠️ `grace-expired` is NOT an event Dodo sends; it is Harvest's own timer
 * firing, and it is recorded distinctly precisely because a human reading
 * `tenant_private` later needs to tell "they cancelled" from "their card failed
 * and nobody fixed it in 21 days". The capability answer is identical for all
 * three, which is why this stays provenance and never becomes a status.
 */
export type DodoTerminalReason = 'cancelled' | 'expired' | 'grace-expired';

/** What an archive attempt decided. */
export type DodoLifecycleOutcome =
  /** The tenant moved out of `active` into the archived state. */
  | { readonly outcome: 'archived'; readonly tenantId: string; readonly reason: DodoTerminalReason }
  /** Already archived by the sibling terminal event. Nothing written. */
  | { readonly outcome: 'already-archived'; readonly tenantId: string }
  /** No tenant carries this subscription id. Nothing to do. */
  | { readonly outcome: 'no-tenant'; readonly subscriptionId: string }
  /** The payload carried no subscription id, so no tenant could be found. */
  | { readonly outcome: 'no-subscription-id' }
  /** 🔴 The tenant's subscription belongs to another processor. Refused. */
  | { readonly outcome: 'not-dodo-owned'; readonly tenantId: string };

/** What a reactivation attempt decided. */
export type DodoReactivationOutcome =
  | { readonly outcome: 'reactivated'; readonly tenantId: string }
  /**
   * 🔴 The tenant was NOT archived but was inside its grace window, and the hold
   * has been cleared. This is a church that paid before the timer ran out, and
   * it is the single most important outcome in this file — see the note on
   * `reactivateTenantForDodoSubscription`.
   */
  | { readonly outcome: 'hold-cleared'; readonly tenantId: string }
  /** Not archived, no hold — the normal `subscription.active` case. Nothing written. */
  | { readonly outcome: 'not-archived'; readonly tenantId: string }
  | { readonly outcome: 'not-dodo-owned'; readonly tenantId: string };

/** What recording a hold decided. */
export type DodoOnHoldOutcome =
  /** The clock STARTED. `graceEndsAt` is when giving stops. */
  | {
      readonly outcome: 'on-hold-recorded';
      readonly tenantId: string;
      readonly onHoldAt: string;
      readonly graceEndsAt: string;
    }
  /** 🔴 A hold was already recorded. The clock was NOT restarted. */
  | { readonly outcome: 'already-on-hold'; readonly tenantId: string; readonly onHoldAt: string }
  /** A repeat hold arrived after the window closed, so the tenant was archived. */
  | { readonly outcome: 'grace-expired'; readonly tenantId: string }
  /** Already archived — a terminal event got there first. Nothing written. */
  | { readonly outcome: 'already-archived'; readonly tenantId: string }
  | { readonly outcome: 'no-tenant'; readonly subscriptionId: string }
  | { readonly outcome: 'no-subscription-id' }
  | { readonly outcome: 'not-dodo-owned'; readonly tenantId: string };

/** What a convergence check decided. */
export type DodoGraceConvergenceOutcome =
  /** The window had closed; the tenant is now archived for real. */
  | { readonly outcome: 'archived'; readonly tenantId: string; readonly reason: DodoTerminalReason }
  /** Inside the window. Full entitlements, nothing written. */
  | { readonly outcome: 'in-grace'; readonly tenantId: string }
  /** No hold recorded at all. Nothing to converge. */
  | { readonly outcome: 'no-hold'; readonly tenantId: string }
  | { readonly outcome: 'already-archived'; readonly tenantId: string }
  | { readonly outcome: 'not-dodo-owned'; readonly tenantId: string };

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The tenant carrying this Dodo subscription id, or null.
 *
 * Deliberately the SAME lookup `provisioning.ts` uses to decide a subscription
 * has already built a tenant. One subscription id, one way to find its tenant —
 * if the two ever disagreed, provisioning would create a second church for a
 * subscription this module had already archived.
 */
export async function findTenantForDodoSubscription(subscriptionId: string): Promise<string | null> {
  const snap = await adminDb
    .collection(TENANT_PRIVATE_COLLECTION)
    .where('dodoSubscriptionId', '==', subscriptionId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * Refuse unless this tenant's SUBSCRIPTION is Dodo's.
 *
 * 🔴 Routed through #293's ownership module rather than through "it had a
 * dodoSubscriptionId, so it is Dodo's". A tenant carrying identifiers from both
 * processors resolves to `conflict` — `processor: null` — and this returns
 * false, so a contradictory tenant is never archived by a Dodo event. That is
 * the same refuse-never-guess rule every billing write path already follows, and
 * it is what makes "a Stripe-owned tenant is unaffected" structural instead of
 * incidental.
 */
function isDodoOwned(priv: Record<string, any> | null | undefined): boolean {
  return resolveBillingOwnership(priv).processor === 'dodo';
}

/**
 * Move a tenant to the archived lifecycle state because its Dodo subscription
 * ended.
 *
 * Never throws for a state it can reason about: `cancelled` and `expired` are
 * BEST-EFFORT events (the route has already answered 2xx by the time this runs),
 * so a rejection here would be an unhandled rejection nobody sees rather than a
 * retry. Everything it declines to do is reported through the return value, and
 * a genuine Firestore failure is captured before it propagates.
 */
export async function archiveTenantForDodoSubscription(
  sub: DodoLifecyclePayload,
  reason: DodoTerminalReason,
): Promise<DodoLifecycleOutcome> {
  const subscriptionId = str(sub.subscription_id);
  if (!subscriptionId) {
    // Not a throw: there is no tenant to protect and nothing a retry would fix.
    // Reported, because a terminal event with no subscription id means the
    // payload shape changed and every future cancellation is about to be lost.
    captureMoneyPathError(
      new Error(`[dodo] subscription.${reason} carried no subscription_id; no tenant could be archived`),
      { step: 'dodo-lifecycle-missing-subscription-id', level: 'error', ids: { reason } },
    );
    return { outcome: 'no-subscription-id' };
  }

  const tenantId = await findTenantForDodoSubscription(subscriptionId);
  if (!tenantId) {
    // Normal and harmless: a subscription that never provisioned a tenant (an
    // abandoned trial, a dashboard-made subscription) can still end.
    console.log(`[dodo] subscription.${reason} for ${subscriptionId}: no tenant carries it; nothing to archive`);
    return { outcome: 'no-tenant', subscriptionId };
  }

  const priv = await getTenantPrivate(tenantId);
  if (!isDodoOwned(priv)) {
    console.warn(
      `[dodo] Refusing to archive tenant ${tenantId}: its subscription is not owned by Dodo ` +
        `(resolved ${resolveBillingOwnership(priv).reason}).`,
    );
    captureMoneyPathError(
      new Error(`[dodo] subscription.${reason} matched tenant ${tenantId}, which Dodo does not own`),
      { step: 'dodo-lifecycle-ownership-refused', level: 'warning', tenantId, ids: { subscriptionId, reason } },
    );
    return { outcome: 'not-dodo-owned', tenantId };
  }

  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  const tenantSnap = await tenantRef.get();
  if (tenantSnap.exists && tenantSnap.data()?.status === TENANT_STATUS_ARCHIVED) {
    // The sibling terminal event already did this. `cancelled` then `expired`
    // for one subscription applies ONCE.
    console.log(`⏭️ [dodo] Tenant ${tenantId} is already archived; subscription.${reason} applies nothing`);
    return { outcome: 'already-archived', tenantId };
  }

  const now = new Date().toISOString();

  // ONE batch: the public lifecycle state and the private provenance land
  // together, or neither does. A tenant archived on the public doc with no
  // record of why is a support ticket nobody can answer.
  const batch = adminDb.batch();
  batch.update(tenantRef, {
    // 🔴 The whole handler, in one field. `plan` is deliberately absent — see
    // the module note: it is the tier reactivation restores them to.
    status: TENANT_STATUS_ARCHIVED,
    updatedAt: now,
  });
  batch.set(
    tenantPrivateRef(tenantId),
    {
      // Provenance. WHICH terminal event ended it, kept because the two events
      // mean different things to a human even though they mean the same thing
      // to the capability table. No entitlement check reads this — which is why
      // it is NOT on TENANT_PRIVATE_FIELDS: that list is what must survive a
      // subdomain rename, and losing a reason code there costs nothing, whereas
      // adding a non-identifier to it would blur what the list is for.
      dodoSubscriptionStatus: reason,
      archivedAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
  await batch.commit();

  console.log(`📦 [dodo] Tenant ${tenantId} archived (subscription ${subscriptionId} ${reason})`);
  return { outcome: 'archived', tenantId, reason };
}

/**
 * Bring an archived tenant all the way back.
 *
 * ⚠️ REACTIVATION MUST BE TOTAL: same subdomain, same data, same members. It is
 * total here because archiving took nothing away — the only thing to undo is the
 * one status field, and everything else was never touched. That is the payoff
 * for archiving instead of deleting, and it is why the archive write is one
 * field rather than a cascade.
 *
 * Writes only when there is something to undo, so the overwhelmingly common
 * `subscription.active` (a brand-new signup, or a redelivery of one) costs one
 * read and no write.
 *
 * ─── 🔴 IT ALSO CLEARS THE GRACE HOLD, AND THAT IS THE POINT ─────────────────
 *
 * A tenant inside its grace window is still recorded `active` — the hold is a
 * timestamp on the private doc, not a status. So "reactivate only if archived"
 * would look correct and be catastrophically wrong: a church whose card was
 * fixed on day 3 would come back as `active` (it never left), the hold would
 * still be sitting there, and on day 21 the timer would archive A CHURCH THAT
 * PAID. That is the worst outcome this work can produce — strictly worse than
 * never shipping the timer — so the clear is unconditional on the archived
 * check, not nested inside it.
 */
export async function reactivateTenantForDodoSubscription(
  tenantId: string,
): Promise<DodoReactivationOutcome> {
  // ⚠️ Ownership resolves FIRST now. The old order (archived? then owned?) was
  // safe only because the archived check happened to exclude everything
  // interesting; a hold can sit on a tenant in any status, so the refusal has to
  // come before the decision about what to write.
  const priv = await getTenantPrivate(tenantId);
  if (!isDodoOwned(priv)) {
    return { outcome: 'not-dodo-owned', tenantId };
  }

  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  const tenantSnap = await tenantRef.get();
  const wasArchived = tenantSnap.exists && tenantSnap.data()?.status === TENANT_STATUS_ARCHIVED;
  const hadHold = typeof priv?.[DODO_ON_HOLD_FIELD] === 'string' && priv[DODO_ON_HOLD_FIELD] !== '';

  if (!wasArchived && !hadHold) {
    return { outcome: 'not-archived', tenantId };
  }

  const now = new Date().toISOString();
  const batch = adminDb.batch();

  // 🔴 Always cleared. Recovery from grace and recovery from archived are the
  // same event arriving (`subscription.active`), and neither may leave a live
  // deadline behind.
  const privatePatch: Record<string, unknown> = {
    [DODO_ON_HOLD_FIELD]: null,
    dodoSubscriptionStatus: TENANT_STATUS_ACTIVE,
    updatedAt: now,
  };

  if (wasArchived) {
    // The status only moves when it actually left `active`. A tenant recovering
    // from grace was never archived, so there is nothing to restore and the
    // public doc is not written at all.
    batch.update(tenantRef, { status: TENANT_STATUS_ACTIVE, updatedAt: now });
    privatePatch.archivedAt = null;
  }

  batch.set(tenantPrivateRef(tenantId), privatePatch, { merge: true });
  await batch.commit();

  if (!wasArchived) {
    console.log(`✅ [dodo] Tenant ${tenantId} recovered inside its grace window — hold cleared, nothing was ever gated`);
    return { outcome: 'hold-cleared', tenantId };
  }

  console.log(`✅ [dodo] Tenant ${tenantId} reactivated — subdomain, data and members unchanged`);
  return { outcome: 'reactivated', tenantId };
}

/** The `subscription.cancelled` handler — a DECISION, terminal, no grace. */
export async function handleDodoSubscriptionCancelled(
  event: DodoWebhookEvent,
): Promise<DodoLifecycleOutcome> {
  const payload = (event.data || {}) as unknown as DodoLifecyclePayload;
  return archiveTenantForDodoSubscription(payload, 'cancelled');
}

/** The `subscription.expired` handler — END OF TERM, terminal, same state. */
export async function handleDodoSubscriptionExpired(
  event: DodoWebhookEvent,
): Promise<DodoLifecycleOutcome> {
  const payload = (event.data || {}) as unknown as DodoLifecyclePayload;
  return archiveTenantForDodoSubscription(payload, 'expired');
}

// ─── The `on_hold` timer ─────────────────────────────────────────────────────

/**
 * Archive a tenant whose grace window has closed, if it has.
 *
 * 🔴 CONVERGENCE. The gate refuses from a DERIVED answer the moment the deadline
 * passes; this is what makes the RECORDED state agree with it. Without it a
 * tenant sits `active` in Firestore while every request is refused — which reads
 * as a bug to anyone looking at the document, and leaves the eventual
 * reactivation with nothing to undo.
 *
 * Routed through `archiveTenantForDodoSubscription` rather than writing the
 * status directly, so the timer inherits every refusal the terminal events have:
 * the `isDodoOwned` check, the already-archived short-circuit, and the single
 * batch that lands the public status and the private provenance together. A
 * Stripe-owned or conflict-owned tenant is refused here for exactly the same
 * reason it is refused there, in the same code.
 *
 * `now` is injected so the caller decides what "now" means — the resolver stays
 * pure and this stays testable without fake timers.
 */
export async function convergeExpiredDodoGrace(
  tenantId: string,
  now: number,
): Promise<DodoGraceConvergenceOutcome> {
  const priv = await getTenantPrivate(tenantId);

  if (!isDodoOwned(priv)) {
    return { outcome: 'not-dodo-owned', tenantId };
  }

  const onHoldAt = priv?.[DODO_ON_HOLD_FIELD];
  const graceState = resolveTenantGraceState({ onHoldAt, now });
  if (graceState === 'none') return { outcome: 'no-hold', tenantId };
  if (graceState === 'in-grace') return { outcome: 'in-grace', tenantId };

  const subscriptionId = str(priv?.dodoSubscriptionId);
  if (!subscriptionId) {
    // isDodoOwned resolved 'dodo', so ownership came from `billingProcessor` or
    // from `dodoCustomerId` without a subscription id. There is no subscription
    // to archive against and the terminal path is keyed on that id.
    return { outcome: 'no-hold', tenantId };
  }

  const result = await archiveTenantForDodoSubscription({ subscription_id: subscriptionId }, 'grace-expired');

  if (result.outcome === 'archived') {
    console.log(
      `⏳ [dodo] Tenant ${tenantId}: ${DODO_GRACE_PERIOD_DAYS}-day grace window closed (held ${onHoldAt}); archived`,
    );
    return { outcome: 'archived', tenantId, reason: 'grace-expired' };
  }
  if (result.outcome === 'already-archived') return { outcome: 'already-archived', tenantId };
  if (result.outcome === 'not-dodo-owned') return { outcome: 'not-dodo-owned', tenantId };
  return { outcome: 'no-hold', tenantId };
}

/**
 * Record that a Dodo subscription went on hold, and start the clock ONCE.
 *
 * ⚠️ IDEMPOTENT ON ITS OWN TERMS, and this one is load-bearing in a way the
 * terminal handlers' is not. Dodo emits `subscription.on_hold` on the failed
 * renewal AND can emit it again as its own retries fail, each with its own
 * `webhook-id` — so #290's redelivery guard does not cover it. Rewriting the
 * timestamp on the second one would push the deadline out by however long the
 * retries ran, and a subscription that failed weekly would never reach it: grace
 * would extend indefinitely and the timer would silently never fire. So a hold
 * that already exists is LEFT EXACTLY AS IT IS.
 *
 * A repeat hold that arrives after the window has already closed is the cheapest
 * convergence trigger available — Dodo is still talking to us about a
 * subscription whose grace ran out — so it archives rather than doing nothing.
 *
 * Never throws: `on_hold` is a BEST-EFFORT event, so the route has already
 * answered 2xx and a rejection would be an unhandled rejection nobody sees.
 */
export async function recordDodoSubscriptionOnHold(
  sub: DodoLifecyclePayload,
  now: number,
): Promise<DodoOnHoldOutcome> {
  const subscriptionId = str(sub.subscription_id);
  if (!subscriptionId) {
    captureMoneyPathError(
      new Error('[dodo] subscription.on_hold carried no subscription_id; no grace timer could be started'),
      { step: 'dodo-on-hold-missing-subscription-id', level: 'error' },
    );
    return { outcome: 'no-subscription-id' };
  }

  const tenantId = await findTenantForDodoSubscription(subscriptionId);
  if (!tenantId) {
    console.log(`[dodo] subscription.on_hold for ${subscriptionId}: no tenant carries it; no timer to start`);
    return { outcome: 'no-tenant', subscriptionId };
  }

  const priv = await getTenantPrivate(tenantId);
  if (!isDodoOwned(priv)) {
    // 🔴 Same refusal the terminal handlers make, for the same reason: a tenant
    // carrying both processors' identifiers resolves to `conflict` and is never
    // written by a Dodo event. A grace timer is a write like any other.
    console.warn(
      `[dodo] Refusing to record on_hold for tenant ${tenantId}: its subscription is not owned by Dodo ` +
        `(resolved ${resolveBillingOwnership(priv).reason}).`,
    );
    captureMoneyPathError(
      new Error(`[dodo] subscription.on_hold matched tenant ${tenantId}, which Dodo does not own`),
      { step: 'dodo-on-hold-ownership-refused', level: 'warning', tenantId, ids: { subscriptionId } },
    );
    return { outcome: 'not-dodo-owned', tenantId };
  }

  const existing = priv?.[DODO_ON_HOLD_FIELD];
  if (typeof existing === 'string' && existing !== '') {
    // 🔴 THE GUARD. Do not restart the clock.
    if (resolveTenantGraceState({ onHoldAt: existing, now }) === 'expired') {
      const converged = await convergeExpiredDodoGrace(tenantId, now);
      if (converged.outcome === 'archived') return { outcome: 'grace-expired', tenantId };
      if (converged.outcome === 'already-archived') return { outcome: 'already-archived', tenantId };
    }
    console.log(`⏭️ [dodo] Tenant ${tenantId} is already on hold since ${existing}; the clock is NOT restarted`);
    return { outcome: 'already-on-hold', tenantId, onHoldAt: existing };
  }

  const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
  if (tenantSnap.exists && tenantSnap.data()?.status === TENANT_STATUS_ARCHIVED) {
    // A terminal event already ended this subscription. Starting a grace timer
    // on an archived tenant would record a deadline for entitlements it no
    // longer has.
    return { outcome: 'already-archived', tenantId };
  }

  const onHoldAt = new Date(now).toISOString();
  const graceEndsAt = new Date(now + DODO_GRACE_PERIOD_MS).toISOString();

  // ⚠️ ONE field, on the SERVER-ONLY doc, and the public tenant doc is not
  // touched at all. Nothing is gated yet: the church keeps giving, publishing
  // and sending for the whole window. `status` stays `active` because the tenant
  // IS active — recording trouble is not the same as enforcing it.
  await tenantPrivateRef(tenantId).set(
    { [DODO_ON_HOLD_FIELD]: onHoldAt, dodoSubscriptionStatus: 'on_hold', updatedAt: onHoldAt },
    { merge: true },
  );

  console.log(
    `⏳ [dodo] Tenant ${tenantId} on hold (subscription ${subscriptionId}); ` +
      `${DODO_GRACE_PERIOD_DAYS}-day grace window ends ${graceEndsAt}`,
  );
  return { outcome: 'on-hold-recorded', tenantId, onHoldAt, graceEndsAt };
}

/**
 * The `subscription.on_hold` handler — the failed renewal that starts the clock.
 */
export async function handleDodoSubscriptionOnHold(
  event: DodoWebhookEvent,
): Promise<DodoOnHoldOutcome> {
  const payload = (event.data || {}) as unknown as DodoLifecyclePayload;
  return recordDodoSubscriptionOnHold(payload, Date.now());
}

/**
 * Clear the grace hold because this subscription is paying again.
 *
 * ─── 🔴 WHICH EVENTS MEAN RECOVERY, and why these ────────────────────────────
 *
 * Established from Dodo's own docs, not inferred:
 *
 *   • `subscription.active` — Payment Retries states it outright: "`subscription
 *     .active` | A retry succeeds and the subscription is reactivated", and the
 *     state machine reads `on_hold --> active: Payment method updated / retry
 *     succeeds`. The Subscriptions page adds the manual path: "After successfully
 *     updating the payment method for an `on_hold` subscription, you'll receive
 *     `payment.succeeded` followed by `subscription.active`."
 *
 *   • `subscription.renewed` — a HEDGE, and deliberately so. The docs define it
 *     as "Renewal succeeds", and a successful retry IS a renewal succeeding, so
 *     it is genuinely possible that a recovery emits this alongside (or instead
 *     of) `active`. The asymmetry decides it: clearing on an event that did not
 *     mean recovery costs revenue for one billing cycle, while FAILING to clear
 *     takes a paying church's donate page down on day 21. `renewed` cannot be
 *     emitted for a subscription that has not paid, so the hedge is free.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT CLEARED ON:
 *
 *   • `subscription.updated` — "fires alongside the more specific events above",
 *     on ANY field change. It therefore fires alongside `on_hold` ITSELF, so
 *     clearing on it would race the very write that starts the clock and could
 *     erase the timer the instant it was set. That is not over-clearing, it is
 *     disabling the feature.
 *   • `payment.succeeded` and `dunning.recovered` — both are documented as
 *     STRICTLY PRECEDING or accompanying a `subscription.active` we already
 *     clear on, so neither adds a path; `dunning.recovered` would also mean
 *     recognising a whole new `dunning.*` event family for nothing.
 */
async function clearDodoGraceHoldForSubscription(
  sub: DodoLifecyclePayload,
  recoveryEvent: string,
): Promise<DodoReactivationOutcome | { readonly outcome: 'no-tenant' | 'no-subscription-id' }> {
  const subscriptionId = str(sub.subscription_id);
  if (!subscriptionId) return { outcome: 'no-subscription-id' };

  const tenantId = await findTenantForDodoSubscription(subscriptionId);
  if (!tenantId) return { outcome: 'no-tenant' };

  const result = await reactivateTenantForDodoSubscription(tenantId);
  if (result.outcome === 'hold-cleared') {
    console.log(`✅ [dodo] ${recoveryEvent} cleared tenant ${tenantId}'s grace hold — they paid inside the window`);
  }
  return result;
}

/**
 * The `subscription.renewed` handler — a paid renewal, which clears any hold.
 *
 * For the ordinary case (a healthy subscription renewing on schedule) this reads
 * the private doc, finds no hold, and writes nothing.
 */
export async function handleDodoSubscriptionRenewed(
  event: DodoWebhookEvent,
): Promise<DodoReactivationOutcome | { readonly outcome: 'no-tenant' | 'no-subscription-id' }> {
  const payload = (event.data || {}) as unknown as DodoLifecyclePayload;
  return clearDodoGraceHoldForSubscription(payload, 'subscription.renewed');
}
