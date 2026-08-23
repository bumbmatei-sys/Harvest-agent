import { adminDb } from '@/lib/firebase-admin';
import { tenantPrivateRef } from '@/lib/tenant-private';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { readTenantAddons } from '@/utils/plan-features';
import type { TenantAddons } from '@/types/tenant.types';
import { requirePlanForProduct, readDodoMetadata, type DodoSubscriptionPayload } from './provisioning';
import { readDodoAddonEntitlements, reportUnrecognisedDodoAddons } from './addons';
import type { BillingPeriod } from './provider';

/**
 * 🔴 THE STRUCTURAL GAP THIS CLOSES. (THE-203)
 *
 * Before Forever Free there was no such thing as a tenant without a
 * subscription, so there was no code path for "existing tenant, no
 * subscription, buys one". Both existing paths refuse it, correctly:
 *
 *   /api/dodo/checkout      refuses when the body carries a `tenantId` — that
 *                           guard is what stops a paying church opening a
 *                           SECOND subscription and being billed twice.
 *   /api/dodo/change-plan   calls Dodo's change-plan API, which needs a
 *                           subscription id to change. A free tenant has none.
 *
 * A free tenant has a tenantId and no subscription, so it falls between them.
 * This is the third path, and it is deliberately the narrowest of the three:
 * it exists ONLY for a tenant that currently has no subscription at all.
 *
 * ⚠️ THE SIGNUP GUARD IS NOT RELAXED. `/api/dodo/checkout` still refuses every
 * request carrying a tenantId, unchanged. The new route's guard is the exact
 * INVERSE — the caller must have a tenant, and that tenant must have no
 * subscription — so the two cannot both accept the same request, and the
 * double-charge that guard prevents stays prevented.
 *
 * ⚠️ THE WEBHOOK REMAINS THE SINGLE WRITER OF `plan`. The route below creates a
 * Dodo Checkout and writes NOTHING. This module runs from
 * `subscription.active`, and it is the only place a first subscription's tier
 * lands on a tenant.
 */

export interface FirstSubscriptionMetadata {
  tenantId: string;
  userId: string;
}

/**
 * The discriminator, deliberately distinct from `newTenant: 'true'`.
 *
 * `readSignupMetadata` keys on `newTenant`, so a first-subscription payload
 * reads as `not-a-signup` there and cannot build a second church for a user who
 * already has one. The two markers are mutually exclusive by construction and a
 * payload carrying both is refused rather than guessed at.
 */
export function readFirstSubscriptionMetadata(raw: unknown): FirstSubscriptionMetadata | null {
  const meta = readDodoMetadata(raw);
  if (meta.firstSubscription !== 'true') return null;
  if (meta.newTenant === 'true') return null; // both markers: refuse, do not guess
  if (!meta.tenantId || !meta.userId) return null;
  return { tenantId: meta.tenantId, userId: meta.userId };
}

export type FirstSubscriptionOutcome =
  | { outcome: 'not-a-first-subscription' }
  | { outcome: 'attached'; tenantId: string; plan: string; period: BillingPeriod }
  | { outcome: 'already-attached'; tenantId: string }
  | { outcome: 'refused'; tenantId: string; reason: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Attach a first subscription to an existing (free) tenant.
 *
 * 🔴 NOBODY IS EVER REMOVED. This writes the tenant's `plan`, its add-on set and
 * its billing identifiers, and the buying user's `plan`. It does not read, touch
 * or count the `users` collection beyond that one document, and it deletes
 * nothing. A free tenant with 500 members that moves to Individual (cap 150)
 * KEEPS ALL 500 — the cap is enforced only at signup, by THE-201's gate, which
 * refuses the 501st and never evicts the existing ones. This is the founder's
 * explicit decision and the most likely thing to get wrong, so it is stated
 * here as well as asserted in the tests.
 */
export async function attachFirstSubscriptionToTenant(
  sub: DodoSubscriptionPayload,
): Promise<FirstSubscriptionOutcome> {
  const meta = readFirstSubscriptionMetadata(sub.metadata);
  if (!meta) return { outcome: 'not-a-first-subscription' };

  const subscriptionId = str(sub.subscription_id);
  const productId = str(sub.product_id);
  if (!subscriptionId) {
    return { outcome: 'refused', tenantId: meta.tenantId, reason: 'missing-subscription-id' };
  }

  // Fail on an unknown product BEFORE writing anything — same order as the
  // provisioning path, for the same reason.
  const { plan, period } = requirePlanForProduct(productId);

  const tenantRef = adminDb.collection('tenants').doc(meta.tenantId);
  const privateRef = tenantPrivateRef(meta.tenantId);
  const [tenantSnap, privateSnap] = await Promise.all([tenantRef.get(), privateRef.get()]);

  if (!tenantSnap.exists) {
    return { outcome: 'refused', tenantId: meta.tenantId, reason: 'tenant-not-found' };
  }
  const priv = privateSnap.exists ? (privateSnap.data() ?? {}) : {};
  const existingSub = str(priv.dodoSubscriptionId);

  // ── Idempotency: this exact subscription already landed. ──────────────────
  // `subscription.active` is durable and Dodo redelivers it. A redelivery must
  // be a no-op, not a second write.
  if (existingSub === subscriptionId) {
    return { outcome: 'already-attached', tenantId: meta.tenantId };
  }

  // ── 🔴 The guard that makes this route safe to exist. ─────────────────────
  //
  // A tenant that ALREADY has a subscription must never gain a second one
  // through this path — that is the double-charge `/api/dodo/checkout`'s
  // tenantId guard exists to prevent, and it would be pointless to close that
  // door and open this one. Checked against BOTH processors: a Stripe-owned
  // church is equally not a free tenant, and attaching a Dodo subscription
  // beside its Stripe one is the same defect wearing a different name.
  if (existingSub || str(priv.stripeSubscriptionId)) {
    return { outcome: 'refused', tenantId: meta.tenantId, reason: 'tenant-already-has-a-subscription' };
  }

  // The tier is checked too, not just the subscription. A tenant on a paid plan
  // with no subscription id is a broken record, not an upgrade candidate, and
  // silently selling it a subscription would paper over whatever broke it.
  const currentPlan = str(tenantSnap.data()?.plan);
  if (currentPlan !== 'free') {
    return { outcome: 'refused', tenantId: meta.tenantId, reason: `tenant-is-on-${currentPlan || 'unknown'}` };
  }

  const entitlements = readDodoAddonEntitlements(sub);
  const addons: TenantAddons = entitlements ? entitlements.addons : readTenantAddons(null);
  if (entitlements) {
    reportUnrecognisedDodoAddons(entitlements.unrecognised, {
      step: 'dodo-first-subscription-unrecognised-addon',
      subscriptionId,
      tenantId: meta.tenantId,
    });
  }

  const now = new Date().toISOString();
  const batch = adminDb.batch();
  batch.update(tenantRef, { plan, addons, updatedAt: now });
  batch.set(
    privateRef,
    {
      dodoCustomerId: str(sub.customer?.customer_id) || null,
      dodoSubscriptionId: subscriptionId,
      dodoProductId: productId,
      // Written in the same batch as the identifiers it describes, so the two
      // can never disagree — the same rule the provisioning path states.
      billingProcessor: 'dodo',
      updatedAt: now,
    },
    { merge: true }, // 🔴 merge: the free tenant's adminEmails roster must survive
  );
  await batch.commit();

  // The buying user's mirrored plan. Their tenantId and role are NOT rewritten
  // — they already have both, and this is a purchase, not a provisioning.
  await adminDb.collection('users').doc(meta.userId).update({ plan, updatedAt: now });

  console.log(
    `✅ [dodo] Attached first subscription ${subscriptionId} to tenant ${meta.tenantId} ` +
      `(free -> ${plan}/${period})`,
  );

  return { outcome: 'attached', tenantId: meta.tenantId, plan, period };
}

/** Report-and-swallow wrapper: a refusal is a real event and must be visible. */
export async function handleFirstSubscriptionAttach(
  sub: DodoSubscriptionPayload,
): Promise<FirstSubscriptionOutcome> {
  const result = await attachFirstSubscriptionToTenant(sub);
  if (result.outcome === 'refused') {
    // A church pressed Upgrade, was charged by Dodo, and did NOT get the tier.
    // That is the top of the money path and must never be silent.
    captureMoneyPathError(
      new Error(`[dodo] First subscription refused for tenant ${result.tenantId}: ${result.reason}`),
      {
        step: 'dodo-first-subscription-refused',
        level: 'error',
        tenantId: result.tenantId,
        ids: { subscriptionId: str(sub.subscription_id) },
      },
    );
  }
  return result;
}
