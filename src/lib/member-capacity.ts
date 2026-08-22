/**
 * THE-201 — the hard, server-side member-signup cap.
 *
 * WHAT IS COUNTED: `users` documents whose `tenantId` field equals the tenant
 * id. Nothing else. A **member** holds a Firebase Auth account scoped to the
 * tenant; that `users/{uid}` row is the row this cap counts, and the only one.
 * Standalone `contacts` rows — donors who gave through the public donate page
 * without ever signing up — are FREE, stay fully visible, and are never counted
 * (see the module header of `../utils/contact-capacity.ts` for why).
 *
 * The number counted is compared against **`maxContacts`**, read through
 * `getEffectiveFeatures` so a church that bought Contacts +500 or Unlimited
 * Contacts gets what it paid for. `getPlanFeatures` reports the TIER's published
 * allowance and must never be used here.
 *
 * 🔴 SILENT-FAILURE RULE (AGENTS.md). A thrown Firestore/Auth error inside these
 * functions **propagates**. There is no `catch → allowed:true`, no `?? 0`, no
 * default that turns a failed count into "zero members". The route turns a throw
 * into a 500 through `captureHandledError`. A cap that opens when a read fails is
 * exactly the "limit that loosens on error" this codebase already argues against
 * (`contact-capacity.ts`).
 *
 * 🔴 NOTHING IS EVER REMOVED. No branch here deletes, disables, detaches or
 * demotes anybody. The gate withholds a claim from a NEW applicant; every member
 * already signed up keeps everything.
 */

import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { assertConcreteScope } from '@/lib/member-deletion';
import {
  UNLIMITED_CAP,
  getEffectiveFeatures,
  readTenantAddons,
  toTenantPlan,
} from '@/utils/plan-features';

/**
 * How recently the Auth account must have been created for its holder to be
 * treated as a NEW applicant. See CHALLENGE C2. 10 minutes.
 *
 * Why this exists: a `tenantId` custom claim is the primary "already a member"
 * signal, but it is not present on every existing member —
 * `/api/auth/migrate-claims` exists solely to back-fill claims onto users who
 * never had them, and `setCustomClaims` only writes when the claims actually
 * changed. A member whose claim write ever failed carries a `users` doc with a
 * `tenantId` and an Auth record with no claim at all. On an over-cap tenant,
 * classifying that person as NEW would lock an EXISTING member out permanently.
 * Their Auth account's own `metadata.creationTime` settles it: a genuine new
 * signup's account is seconds old, a legacy member's is days-to-years old. Both
 * facts come from the Admin SDK; neither is client-supplied.
 */
export const NEW_ACCOUNT_WINDOW_MS = 10 * 60 * 1000;

/** Why the gate did or did not fire. Every branch is nameable — no silent path. */
export type MemberCapDecision =
  | { allowed: true; reason: 'no_tenant' }
  | { allowed: true; reason: 'existing_member' }
  | { allowed: true; reason: 'unlimited_addon' }
  | { allowed: true; reason: 'unlimited_sentinel' }
  | { allowed: true; reason: 'under_cap'; othersCount: number; cap: number }
  | {
      allowed: false;
      reason: 'at_cap';
      othersCount: number;
      cap: number;
      ministryName: string | null;
    };

/** The tenant's effective member allowance. Reads tenants/{id} with the Admin SDK. */
export async function resolveMemberCap(tenantId: string): Promise<{
  cap: number;
  unlimited: boolean;
  ministryName: string | null;
}> {
  const snap = await adminDb
    .collection('tenants')
    .doc(assertConcreteScope(tenantId, 'tenantId'))
    .get();
  const data = (snap.exists ? snap.data() : undefined) as
    | { plan?: unknown; addons?: unknown; name?: unknown }
    | undefined;

  // `toTenantPlan` and `readTenantAddons` are the repo's own coercions for these
  // two untrusted Firestore fields; they fail closed to 'plus' / "owns nothing"
  // rather than throwing on a render. A MISSING tenant doc is a different
  // question and is answered by the caller, not papered over here.
  const effective = getEffectiveFeatures(
    toTenantPlan(typeof data?.plan === 'string' ? data.plan : null),
    readTenantAddons(data?.addons),
  );

  const rawName = typeof data?.name === 'string' ? data.name.trim() : '';

  return {
    cap: effective.maxContacts,
    unlimited: effective.unlimitedContacts === true,
    ministryName: rawName === '' ? null : rawName,
  };
}

/**
 * Does `tenants/{id}` exist at all? Only the pre-flight asks: a signup against a
 * tenant with no doc is answered "allowed" (spec §5.1) rather than measured
 * against the fallback tier's cap.
 */
export async function tenantDocExists(tenantId: string): Promise<boolean> {
  const snap = await adminDb
    .collection('tenants')
    .doc(assertConcreteScope(tenantId, 'tenantId'))
    .get();
  return snap.exists === true;
}

/**
 * Count `users` where tenantId == <tenantId>. Single-field where, automatic
 * index, NO composite. Throws (never defaults) on a non-concrete id.
 *
 * `assertConcreteScope` is the repo's existing guard (`@/lib/member-deletion`)
 * and it throws on `''` / `null` / a non-string: a scope silently dropped from a
 * query builder matches EVERYTHING, which here would count every user on the
 * platform against one church. Precedent: `countCollection` in
 * `/api/tenants/delete/route.ts`.
 */
export async function countTenantMembers(tenantId: string): Promise<number> {
  const scope = assertConcreteScope(tenantId, 'tenantId');
  const agg = await adminDb.collection('users').where('tenantId', '==', scope).count().get();
  const count = agg.data().count;
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    // Not a `?? 0`: an aggregate that came back without a number is a broken
    // read, and a broken read must not render as "this tenant has no members".
    throw new Error(
      `Member count aggregation for tenant ${scope} returned a non-numeric count (${JSON.stringify(count)}).`,
    );
  }
  return count;
}

/**
 * Pure. Exposed so the off-by-one (D4) is testable without Firestore.
 *
 * At `set-claims` time the applicant's own `users/{uid}` doc ALREADY exists —
 * `AuthPage` writes it and only then calls the route — so the raw count includes
 * the applicant and one must be subtracted. Clamped at 0 so a race that deletes
 * the applicant's doc mid-flight cannot produce -1.
 */
export function othersExcludingSelf(total: number, selfIsInTenant: boolean): number {
  const others = selfIsInTenant ? total - 1 : total;
  return others > 0 ? others : 0;
}

/** Pure. `>=` — at exactly the cap there is no slot left. */
export function isAtMemberCap(othersCount: number, cap: number, unlimited: boolean): boolean {
  if (unlimited) return false;
  // The matrix's own unlimited sentinel is a NEGATIVE number, so it must be
  // checked before any `>=` comparison — `othersCount >= -1` is true forever.
  if (cap === UNLIMITED_CAP) return false;
  return othersCount >= cap;
}

/**
 * THE ENFORCEMENT DECISION, used by /api/auth/set-claims.
 * Reads the users doc, the Auth record and the tenant doc; makes no writes.
 *
 * Order of checks is not negotiable — see the spec §3.2.
 */
export async function decideMemberAdmission(uid: string): Promise<MemberCapDecision> {
  // 1 — No tenant, no cap. Super admins (`tenantId: null`) and main-site
  //     accounts leave here and NO count query runs. An unscoped count is never
  //     acceptable, so "no concrete tenant" means "the cap does not apply",
  //     never "count everything".
  const userSnap = await adminDb.collection('users').doc(assertConcreteScope(uid, 'uid')).get();
  const rawTenantId = userSnap.exists
    ? (userSnap.data() as { tenantId?: unknown } | undefined)?.tenantId
    : undefined;
  if (typeof rawTenantId !== 'string' || rawTenantId.trim() === '') {
    return { allowed: true, reason: 'no_tenant' };
  }
  const tenantId = rawTenantId.trim();

  // 2 — Already carries this tenant's claim → an existing member signing in.
  const authUser = await adminAuth.getUser(uid);
  if ((authUser.customClaims as { tenantId?: unknown } | undefined)?.tenantId === tenantId) {
    return { allowed: true, reason: 'existing_member' };
  }

  // 3 — No claim, but the Auth account is older than the new-account window →
  //     also an existing member (the claim-migration case, C2).
  const createdAt = Date.parse(authUser.metadata?.creationTime ?? '');
  if (Number.isFinite(createdAt) && Date.now() - createdAt > NEW_ACCOUNT_WINDOW_MS) {
    return { allowed: true, reason: 'existing_member' };
  }

  // 4 — Unlimited, in either form, BEFORE any numeric comparison.
  const { cap, unlimited, ministryName } = await resolveMemberCap(tenantId);
  if (unlimited) return { allowed: true, reason: 'unlimited_addon' };
  if (cap === UNLIMITED_CAP) return { allowed: true, reason: 'unlimited_sentinel' };

  // 5 — Count, exclude self, compare.
  const total = await countTenantMembers(tenantId);
  const othersCount = othersExcludingSelf(total, true);
  if (isAtMemberCap(othersCount, cap, unlimited)) {
    return { allowed: false, reason: 'at_cap', othersCount, cap, ministryName };
  }
  return { allowed: true, reason: 'under_cap', othersCount, cap };
}

/**
 * THE PRE-FLIGHT DECISION, used by /api/tenants/member-capacity. No uid: nobody
 * exists yet. Answers "could this tenant accept one more member right now?"
 *
 * Same predicate as the enforcement path, different self-term: the applicant has
 * no `users` doc yet, so `selfIsInTenant` is false and the raw total is compared.
 */
export async function canTenantAcceptMember(tenantId: string): Promise<MemberCapDecision> {
  const scope = assertConcreteScope(tenantId, 'tenantId');

  // A tenant with no doc at all is not an over-cap tenant; it is a host nobody
  // has provisioned. The pre-flight says nothing and lets the signup proceed —
  // the enforcement path is still there one hop later.
  if (!(await tenantDocExists(scope))) {
    return { allowed: true, reason: 'no_tenant' };
  }

  const { cap, unlimited, ministryName } = await resolveMemberCap(scope);
  if (unlimited) return { allowed: true, reason: 'unlimited_addon' };
  if (cap === UNLIMITED_CAP) return { allowed: true, reason: 'unlimited_sentinel' };

  const total = await countTenantMembers(scope);
  const othersCount = othersExcludingSelf(total, false);
  if (isAtMemberCap(othersCount, cap, unlimited)) {
    return { allowed: false, reason: 'at_cap', othersCount, cap, ministryName };
  }
  return { allowed: true, reason: 'under_cap', othersCount, cap };
}
