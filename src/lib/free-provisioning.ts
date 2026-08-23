import { adminDb } from '@/lib/firebase-admin';
import { setCustomClaims } from '@/lib/set-custom-claims';
import { tenantPrivateRef } from '@/lib/tenant-private';
import { generateUniqueSubdomain } from '@/lib/tenant-subdomain';
import { TENANT_STATUS_ACTIVE } from '@/lib/tenant-lifecycle';
import { NO_ADDONS } from '@/utils/plan-features';

/**
 * Provision a Forever Free tenant. (THE-203)
 *
 * 🔴 THE DIFFERENCE FROM EVERY OTHER SIGNUP PATH: there is no processor.
 *
 * A paid signup writes `signupInProgress: true`, sends the church to a Dodo
 * Checkout, and the WEBHOOK builds the tenant and clears the marker. A free
 * signup has no checkout, so it has no webhook, so nothing would ever clear
 * that marker — and OnboardingGate reads it to decide whether to show
 * "Complete your payment". A free tenant left flagged mid-signup would be shown
 * a payment screen for a plan that cannot be bought, forever.
 *
 * So this runs SERVER-SIDE AND SYNCHRONOUSLY: the tenant, the admin assignment
 * and the marker release all land in the same request that started it. There is
 * no window in which a free signup is "in flight".
 *
 * Deliberately a copy of `provisionTenantFromDodoSubscription`'s write shape
 * rather than a refactor of it. That function is on the money path, its batch is
 * the thing that stops a tenant existing without its private doc, and the two
 * paths differ in what they must NOT write — which is easy to see side by side
 * and easy to lose behind a shared helper with a `plan === 'free'` branch.
 *
 * ⚠️ WHAT IS DELIBERATELY ABSENT FROM THE PRIVATE DOC:
 *
 *   dodoCustomerId / dodoSubscriptionId / dodoProductId — free never touches
 *     Dodo. There is no customer, no subscription and no product, and writing
 *     `null` for them would make a free tenant indistinguishable from a paid
 *     one whose identifiers failed to write.
 *   billingProcessor — the field states WHO OWNS a subscription, and nobody
 *     owns one here. `/api/dodo/first-subscription` writes it, through the
 *     webhook, at the moment a subscription first exists.
 *   stripe* — same as the Dodo path: those belong to the rollback, not here.
 *
 * `addons` IS written, as the empty set, for the reason REP-5a gives on the
 * paid path: an absent field and an empty one read the same to a cap check but
 * not to a person debugging one.
 */

export type FreeProvisioningOutcome =
  | { outcome: 'created'; tenantId: string }
  | { outcome: 'already-provisioned'; tenantId: string };

export class FreeProvisioningError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'FreeProvisioningError';
  }
}

export const FREE_PLAN = 'free' as const;

export async function provisionFreeTenant(params: {
  userId: string;
  ministryName: string;
  userEmail: string | null;
  /**
   * 🔴 THE-214 — the address the evangelist CHOSE, when they chose one.
   *
   * A free signup now picks its subdomain on the signup screen itself rather
   * than in a post-payment first-run step it has no payment to earn. When that
   * happened this carries the choice, and two things follow from it:
   *
   *  - it becomes the BASE for `generateUniqueSubdomain` rather than the
   *    ministry name. Deliberately the base and not the final id: that helper
   *    re-checks the namespace server-side and suffixes a collision instead of
   *    refusing. A refusal here would leave `signupInProgress: true` with no
   *    tenant behind it, which is the stuck free account this whole path is
   *    built to make impossible. Losing the exact string costs a suffix; losing
   *    the tenant costs the account.
   *  - `setupCompleted` lands TRUE, because first-run setup exists to ask for a
   *    subdomain and it has already been answered. Leaving it false would show
   *    the evangelist the very screen this moved off their path.
   *
   * Absent — the pre-THE-214 shape, still reachable from any caller that has
   * only a name — everything behaves exactly as it did: the id is generated
   * from the ministry name and `setupCompleted` is false, so first-run runs.
   */
  requestedSubdomain?: string;
}): Promise<FreeProvisioningOutcome> {
  const { userId, ministryName, userEmail, requestedSubdomain } = params;

  if (!userId) {
    throw new FreeProvisioningError('missing-user', 'No user id: a tenant cannot be provisioned without an owner.');
  }
  const name = ministryName.trim();
  if (name.length < 2) {
    throw new FreeProvisioningError('missing-ministry-name', 'A ministry name is required.');
  }

  // ── Idempotency: this user already has a tenant. ──────────────────────────
  //
  // The same guard, for the same reason, as both paid paths: a second call must
  // not build a second church and detach the user from the first. It matters
  // MORE here than on the paid paths — this route is a plain authenticated POST
  // with no payment step in front of it, so a double-submitted button or a
  // retried request is an ordinary occurrence rather than an exotic one.
  const existingUserSnap = await adminDb.collection('users').doc(userId).get();
  const existingTenantId = existingUserSnap.exists ? existingUserSnap.data()?.tenantId : null;
  if (existingTenantId) {
    return { outcome: 'already-provisioned', tenantId: existingTenantId as string };
  }

  const chosenAddress = (requestedSubdomain || '').trim();
  const newTenantId = await generateUniqueSubdomain(chosenAddress || name);
  const now = new Date().toISOString();

  // ONE batch: both docs land, or neither does. A tenant doc without its
  // private doc is a church whose every admin is locked out.
  const batch = adminDb.batch();
  batch.set(adminDb.collection('tenants').doc(newTenantId), {
    name: name || 'My Ministry',
    subdomain: newTenantId,
    plan: FREE_PLAN,
    addons: NO_ADDONS,
    status: TENANT_STATUS_ACTIVE,
    config: {},
    ownerId: userId,
    createdBy: userId,
    // Gates the first-run "Finish setup" screen — whose only question for a
    // free tenant is the subdomain. THE-214: when that was already answered at
    // signup there is nothing left to ask, so the screen is not owed.
    setupCompleted: chosenAddress !== '',
    createdAt: now,
    updatedAt: now,
  });
  batch.set(tenantPrivateRef(newTenantId), {
    adminEmails: userEmail ? [userEmail] : [],
    // No processor identifiers and no `billingProcessor`. See the module note.
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();

  // Same field set, same order, as both processors' handlers.
  // `signupInProgress: false` is what releases OnboardingGate — and on this
  // path it is released in the same request that set it, because nothing
  // asynchronous is coming to do it later.
  await adminDb.collection('users').doc(userId).update({
    tenantId: newTenantId,
    role: 'admin',
    plan: FREE_PLAN,
    onboardingCompleted: true,
    signupInProgress: false,
    updatedAt: now,
  });
  await setCustomClaims(userId);

  console.log(`✅ [free] Created Forever Free tenant ${newTenantId} for "${name}" (admin ${userId})`);

  return { outcome: 'created', tenantId: newTenantId };
}
