import { adminDb } from '@/lib/firebase-admin';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { resolveBillingOwnership } from '@/lib/billing-processor';
import { getTenantPrivate, tenantPrivateRef, TENANT_PRIVATE_COLLECTION } from '@/lib/tenant-private';
import { TENANT_STATUS_ACTIVE, TENANT_STATUS_ARCHIVED } from '@/lib/tenant-lifecycle';
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
 * subscription sits in `on_hold` forever. That is a reactive mechanism and it is
 * the remainder of REP-4 part 3; this file handles the two TERMINAL events and
 * nothing else. `on_hold` keeps its empty handler.
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

/** Which terminal event archived the tenant. Provenance only — never a gate. */
export type DodoTerminalReason = 'cancelled' | 'expired';

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
  /** Not archived — the normal `subscription.active` case. Nothing written. */
  | { readonly outcome: 'not-archived'; readonly tenantId: string }
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
 * Writes only when the tenant IS archived, so the overwhelmingly common
 * `subscription.active` (a brand-new signup, or a redelivery of one) costs one
 * read and no write.
 */
export async function reactivateTenantForDodoSubscription(
  tenantId: string,
): Promise<DodoReactivationOutcome> {
  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  const tenantSnap = await tenantRef.get();
  if (!tenantSnap.exists || tenantSnap.data()?.status !== TENANT_STATUS_ARCHIVED) {
    return { outcome: 'not-archived', tenantId };
  }

  if (!isDodoOwned(await getTenantPrivate(tenantId))) {
    return { outcome: 'not-dodo-owned', tenantId };
  }

  const now = new Date().toISOString();
  const batch = adminDb.batch();
  batch.update(tenantRef, { status: TENANT_STATUS_ACTIVE, updatedAt: now });
  batch.set(
    tenantPrivateRef(tenantId),
    { dodoSubscriptionStatus: TENANT_STATUS_ACTIVE, archivedAt: null, updatedAt: now },
    { merge: true },
  );
  await batch.commit();

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
