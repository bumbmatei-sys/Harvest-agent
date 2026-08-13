import { adminDb } from '@/lib/firebase-admin';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { resolveBillingOwnership } from '@/lib/billing-processor';
import { getTenantPrivate, tenantPrivateRef } from '@/lib/tenant-private';
import type { TenantPlan } from '@/types/tenant.types';
import { resolvePlanFromProductId } from './catalogue';
import type { BillingPeriod } from './provider';
import type { DodoWebhookEvent } from './events';
import { findTenantForDodoSubscription } from './lifecycle';

/**
 * The `subscription.plan_changed` handler — the ONE writer of a Dodo tenant's
 * plan after a plan change.
 *
 * ─── Why the webhook writes the plan, and the route does not ─────────────────
 *
 * `/api/dodo/change-plan` calls Dodo and then writes NOTHING. Two reasons:
 *
 *  1. A plan change does not only originate in this app. Dodo's dashboard can
 *     change a plan (a support action), and its customer portal will be able to
 *     once the products join a Product Collection. Only the webhook sees those,
 *     so only the webhook can be the writer that covers every origin.
 *  2. Two writers is how the tenant's recorded tier and the processor's billed
 *     tier drift apart: whichever writes second wins, and with
 *     `on_payment_failure: 'prevent_change'` the route cannot even know whether
 *     the change it requested actually took — Dodo decides after the payment.
 *     The event IS the confirmation that money moved, so the event moves the
 *     plan.
 *
 * ─── What is written, and what deliberately is not ───────────────────────────
 *
 * The same field set the Stripe plan-change path writes, minus what does not
 * apply:
 *
 *   • `tenants/{id}.plan` — the tier every entitlement check reads.
 *   • `tenant_private.dodoProductId` — kept current so the NEXT plan change can
 *     tell what the tenant is on, and so `already-applied` below is decidable.
 *   • `users/{uid}.plan` for every member — the per-user copy of the tier, same
 *     fanout as the Stripe webhook, so members' feature gates move with the
 *     church's.
 *   • `status` is NOT touched. A plan change is not a lifecycle event: an
 *     archived or on-hold tenant that somehow changes plan stays archived or
 *     on hold, and the lifecycle handlers keep sole ownership of `status`.
 *
 * ─── Idempotency, on the handler's own terms ─────────────────────────────────
 *
 * The webhook-id reservation covers a redelivery of one delivery. It does not
 * cover the same CHANGE arriving as two first deliveries (Dodo fires
 * `subscription.updated` alongside, and a support redo in the dashboard is a
 * new event). So the handler checks its own work: if the tenant's plan and
 * stored product id already match the payload, it writes nothing and reports
 * `already-applied`.
 *
 * ─── Refusals ────────────────────────────────────────────────────────────────
 *
 * Same rules as every other Dodo handler: an unknown product is NEVER defaulted
 * to a tier (a wrong default silently under- or over-serves a paying church),
 * and a tenant `resolveBillingOwnership` does not resolve to Dodo is never
 * written — a conflicted tenant is precisely the double-billed fingerprint and
 * a Dodo event must not touch it.
 */

/** Fields this module reads off a `subscription.plan_changed` payload. */
export interface DodoPlanChangePayload {
  subscription_id?: unknown;
  product_id?: unknown;
}

/** What applying a plan change decided. */
export type DodoPlanChangeOutcome =
  /** The tenant's plan (and every member's copy) moved. */
  | {
      readonly outcome: 'plan-moved';
      readonly tenantId: string;
      readonly plan: TenantPlan;
      readonly period: BillingPeriod;
    }
  /** The tenant is already on this plan and product. Nothing written. */
  | { readonly outcome: 'already-applied'; readonly tenantId: string }
  /** 🔴 A product this build does not sell. Never defaulted; reported. */
  | { readonly outcome: 'unknown-product'; readonly productId: string }
  /** No tenant carries this subscription id. Nothing to do. */
  | { readonly outcome: 'no-tenant'; readonly subscriptionId: string }
  /** The payload carried no subscription id, so no tenant could be found. */
  | { readonly outcome: 'no-subscription-id' }
  /** 🔴 The tenant's subscription belongs to another processor. Refused. */
  | { readonly outcome: 'not-dodo-owned'; readonly tenantId: string };

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Apply a `subscription.plan_changed` payload to the tenant that owns the
 * subscription.
 *
 * Never throws for a state it can reason about — `plan_changed` is a
 * BEST-EFFORT event (the route has answered 2xx before this runs), so a
 * rejection would be an unhandled rejection nobody sees. Everything declined is
 * reported through the return value, and the failures that matter are captured
 * to Sentry as money-path errors: a tenant billed for a tier it is not being
 * served is exactly the class of silent wrongness this system exists to refuse.
 */
export async function applyDodoPlanChange(
  sub: DodoPlanChangePayload,
): Promise<DodoPlanChangeOutcome> {
  const subscriptionId = str(sub.subscription_id);
  if (!subscriptionId) {
    captureMoneyPathError(
      new Error('[dodo] subscription.plan_changed carried no subscription_id; no tenant plan could be moved'),
      { step: 'dodo-plan-changed-missing-subscription-id', level: 'error' },
    );
    return { outcome: 'no-subscription-id' };
  }

  const productId = str(sub.product_id);
  const resolved = productId ? resolvePlanFromProductId(productId) : null;
  if (!resolved) {
    // 🔴 NO DEFAULT, EVER — the same rule as provisioning. An unknown product
    // means the running build and the Dodo account disagree about what was
    // sold; guessing a tier would silently serve the wrong one and bill the
    // right one.
    captureMoneyPathError(
      new Error(
        `[dodo] subscription.plan_changed for ${subscriptionId} names product "${productId}", ` +
          'which is not in this build\'s catalogue. The tenant\'s plan was NOT moved.',
      ),
      { step: 'dodo-plan-changed-unknown-product', level: 'error', ids: { subscriptionId, productId } },
    );
    return { outcome: 'unknown-product', productId };
  }

  const tenantId = await findTenantForDodoSubscription(subscriptionId);
  if (!tenantId) {
    // Normal: a dashboard-made subscription that never provisioned a tenant can
    // still change plan.
    console.log(`[dodo] subscription.plan_changed for ${subscriptionId}: no tenant carries it; nothing to move`);
    return { outcome: 'no-tenant', subscriptionId };
  }

  const priv = await getTenantPrivate(tenantId);
  if (resolveBillingOwnership(priv).processor !== 'dodo') {
    // 🔴 Same refusal as every other handler: a conflicted tenant (the
    // double-billed fingerprint) or a Stripe-owned one is never written by a
    // Dodo event.
    console.warn(
      `[dodo] Refusing to move plan for tenant ${tenantId}: its subscription is not owned by Dodo ` +
        `(resolved ${resolveBillingOwnership(priv).reason}).`,
    );
    captureMoneyPathError(
      new Error(`[dodo] subscription.plan_changed matched tenant ${tenantId}, which Dodo does not own`),
      { step: 'dodo-plan-changed-ownership-refused', level: 'warning', tenantId, ids: { subscriptionId } },
    );
    return { outcome: 'not-dodo-owned', tenantId };
  }

  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  const tenantSnap = await tenantRef.get();
  const currentPlan = tenantSnap.exists ? tenantSnap.data()?.plan : undefined;
  if (currentPlan === resolved.plan && priv?.dodoProductId === productId) {
    // The change is already recorded — a sibling event (or a same-content
    // redelivery under a fresh webhook-id) got here first. Applies ONCE.
    console.log(`⏭️ [dodo] Tenant ${tenantId} is already on ${resolved.plan} (${productId}); nothing to move`);
    return { outcome: 'already-applied', tenantId };
  }

  const now = new Date().toISOString();

  // ONE batch: the public tier and the private product record land together, or
  // neither does — a tenant on the new plan whose stored product still names the
  // old one would refuse its NEXT plan change as "already on this plan".
  const batch = adminDb.batch();
  batch.update(tenantRef, { plan: resolved.plan, updatedAt: now });
  batch.set(
    tenantPrivateRef(tenantId),
    { dodoProductId: productId, updatedAt: now },
    { merge: true },
  );
  await batch.commit();

  // The per-user tier copies, same fanout as the Stripe plan-change path. After
  // the tenant writes: a fanout failure leaves members' copies one tier stale
  // (self-healing on the next change), whereas the reverse order could leave
  // the CHURCH on the wrong tier.
  const usersSnap = await adminDb.collection('users').where('tenantId', '==', tenantId).get();
  const userBatch = adminDb.batch();
  usersSnap.docs.forEach((doc) => userBatch.update(doc.ref, { plan: resolved.plan }));
  await userBatch.commit();

  console.log(
    `✅ [dodo] Tenant ${tenantId} moved to ${resolved.plan}/${resolved.period} ` +
      `(subscription ${subscriptionId}, product ${productId})`,
  );
  return { outcome: 'plan-moved', tenantId, plan: resolved.plan, period: resolved.period };
}

/** The `subscription.plan_changed` handler — up/downgrades land here. */
export async function handleDodoSubscriptionPlanChanged(
  event: DodoWebhookEvent,
): Promise<DodoPlanChangeOutcome> {
  const payload = (event.data || {}) as unknown as DodoPlanChangePayload;
  return applyDodoPlanChange(payload);
}
