/**
 * THE-201 — the hard, server-side member-signup cap.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS COUNTED: `users` documents whose `tenantId` equals the tenant.
 *
 * That is a Firebase Auth account scoped to a ministry — a person who signed up
 * to be discipled. Standalone `contacts` rows (donors who gave through the
 * public donate page without ever making an account) are NOT counted, are free,
 * and stay fully visible: they are what giving statements and year-end tax
 * receipts are built from. See the module header of `@/utils/contact-capacity`
 * for the full reasoning, which this module deliberately does not restate.
 *
 * The number counted is compared against **`maxContacts`**, read through
 * `getEffectiveFeatures` (plan-features.ts:927) so a church that bought
 * Contacts +500 or Unlimited Contacts gets what it paid for. `getPlanFeatures`
 * reports the TIER's published allowance and must never be used here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 SILENT-FAILURE RULE (AGENTS.md), applied to a cap.
 *
 * A capacity check can fail for reasons that have nothing to do with capacity:
 * a Firestore quota, a transient error, missing credentials. Both obvious
 * defaults are bugs:
 *
 *   catch → allow   the cap silently stops existing; free is unbounded again
 *                   and nothing tells anyone.
 *   catch → refuse  a real new believer is told the ministry is full when it is
 *                   not, over an infrastructure blip.
 *
 * So a failure is neither. It is a THIRD named outcome — `unavailable` — which
 * the routes answer with 503 and copy that does not claim the ministry is full.
 * There is no `catch`-to-boolean anywhere in this module.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 NOTHING IS EVER REMOVED. No branch here deletes, disables, detaches or
 * demotes anybody. The gate withholds a claim from a NEW applicant; every
 * member already signed up keeps everything, on every tier, forever.
 */

import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import type { TenantAddons, TenantPlan } from '@/types/tenant.types';
import {
  UNLIMITED_CAP,
  getEffectiveFeatures,
  readTenantAddons,
  toTenantPlan,
} from '@/utils/plan-features';

/** Why the gate did or did not fire. Every branch is named; there is no boolean. */
export type MemberCapOutcome =
  | { status: 'allowed'; cap: number; othersCount: number }
  | { status: 'refused'; cap: number; othersCount: number; ministryName: string | null }
  /** No cap applies: unlimited add-on, UNLIMITED_CAP sentinel, no tenant (D7),
   *  or the applicant already holds this tenant's claim (D3). */
  | { status: 'skipped'; reason: MemberCapSkipReason }
  /** C3: the count or the tenant read failed. NOT an allow, NOT a refusal. */
  | { status: 'unavailable'; reason: string };

export type MemberCapSkipReason =
  | 'no-tenant' // D7 — tenantId null/absent on the applicant's users doc
  | 'existing-member' // D3 — adminAuth claim already carries this tenantId
  | 'unlimited-addon' // D6 — effective.unlimitedContacts === true
  | 'unlimited-sentinel'; // D6 — effective.maxContacts === UNLIMITED_CAP (-1)

/**
 * Guard for a value that will be used as a Firestore query scope.
 *
 * A scope silently dropped from a query builder matches EVERYTHING: a count
 * with a null tenant would count every user on the platform against one church.
 * So this throws rather than defaulting. Mirrors `assertConcreteScope`
 * (`@/lib/member-deletion`), kept local so this module has no dependency on the
 * deletion path — nothing here deletes anything.
 */
function assertConcreteTenantId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `${label} must be a concrete non-empty string; got ${JSON.stringify(value)}. ` +
        'An unscoped member count would count the entire platform.',
    );
  }
  return value.trim();
}

/**
 * The tenant's effective member allowance.
 *
 * Reads `plan` and `addons` off `tenants/{tenantId}` with the Admin SDK and runs
 * them through `toTenantPlan()` / `readTenantAddons()` into
 * `getEffectiveFeatures()` — NOT `getPlanFeatures`, or a church holding
 * Contacts +500 stays blocked (D6).
 *
 * 🔴 THROWS when the tenant doc is missing or the read fails (C4). Callers map
 * that to `unavailable`, never to a default cap. This distinction is
 * load-bearing: `toTenantPlan()` fails closed to `'plus'`, and after THE-200 a
 * **free** tenant's cap is 500 while `'plus'` is 150 — so a free tenant whose
 * `plan` field failed to READ would be gated at 150 and 350 entitled people
 * would be refused. A doc that EXISTS with an absent/garbage `plan` still goes
 * through `toTenantPlan()` → `'plus'`, and that is intentional.
 *
 * `ministryName` is returned alongside the allowance so the refusal copy can
 * name the ministry without a second read of the same document (spec §5).
 */
export async function readTenantMemberAllowance(tenantId: string): Promise<{
  plan: TenantPlan;
  addons: TenantAddons;
  maxContacts: number;
  unlimitedContacts: boolean;
  ministryName: string | null;
}> {
  const scope = assertConcreteTenantId(tenantId, 'tenantId');
  const snap = await adminDb.collection('tenants').doc(scope).get();

  if (!snap.exists) {
    // Not a default. A tenant we cannot read is a tenant whose cap we do not
    // know, and guessing it is how 350 entitled people get refused (C4).
    throw new Error(`Tenant document tenants/${scope} does not exist; member allowance unknown.`);
  }

  const data = snap.data() as { plan?: unknown; addons?: unknown; name?: unknown } | undefined;

  const plan = toTenantPlan(typeof data?.plan === 'string' ? data.plan : null);
  const addons = readTenantAddons(data?.addons);
  const effective = getEffectiveFeatures(plan, addons);

  const rawName = typeof data?.name === 'string' ? data.name.trim() : '';

  return {
    plan,
    addons,
    maxContacts: effective.maxContacts,
    unlimitedContacts: effective.unlimitedContacts === true,
    ministryName: rawName === '' ? null : rawName,
  };
}

/**
 * How many OTHER members this tenant has — the applicant excluded (D4).
 *
 * `tenantId` must be a concrete non-empty string. Passing '' / null / undefined
 * THROWS rather than querying (see `assertConcreteTenantId`).
 *
 * Single-field `where` → automatic index, no composite, nothing added to
 * `firestore.indexes.json`. That matters more than the money: a missing
 * composite index rejects the query, and a rejected query behind a
 * catch-to-default renders as a wrong answer, silently (AGENTS.md, Traps).
 * Precedent: `/api/courses/adopt/route.ts:118` gates `maxCourses` this way.
 *
 * `excludeSelf` is true only when the applicant's own `users` doc carries this
 * tenantId — at set-claims time that doc already exists, so the raw count
 * includes the applicant. Clamped at 0: a race that removes the applicant's doc
 * mid-flight must not produce -1.
 */
export async function countOtherMembers(tenantId: string, excludeSelf: boolean): Promise<number> {
  const scope = assertConcreteTenantId(tenantId, 'tenantId');

  const agg = await adminDb.collection('users').where('tenantId', '==', scope).count().get();
  const total = agg.data().count;

  if (typeof total !== 'number' || !Number.isFinite(total)) {
    // Not a `?? 0`: an aggregate that came back without a number is a broken
    // read, and a broken read must not render as "this tenant has no members".
    throw new Error(
      `Member count aggregation for tenant ${scope} returned a non-numeric count ` +
        `(${JSON.stringify(total)}).`,
    );
  }

  const others = excludeSelf ? total - 1 : total;
  return others > 0 ? others : 0;
}

/**
 * Pure. `>=`, not `>`: at exactly the cap there is no slot left.
 * Mirrors `isAtContactLimit` (`contact-capacity.ts:245`).
 *
 * The UNLIMITED_CAP sentinel is NEGATIVE, so it is checked before the numeric
 * comparison — `othersCount >= -1` would otherwise be true forever.
 */
export function isOverMemberCap(othersCount: number, cap: number): boolean {
  if (cap === UNLIMITED_CAP) return false;
  return othersCount >= cap;
}

/**
 * The shared tail of both decisions: allowance → unlimited short-circuits →
 * count → compare. Kept in one place so the enforcement path and the pre-flight
 * can never answer the same question differently.
 *
 * Never throws for a capacity reason: a failure becomes `unavailable` (C3)
 * after `captureHandledError`, so the caller answers 503 rather than guessing.
 */
async function decide(tenantId: string, excludeSelf: boolean, step: string): Promise<MemberCapOutcome> {
  let allowance: Awaited<ReturnType<typeof readTenantMemberAllowance>>;
  try {
    allowance = await readTenantMemberAllowance(tenantId);
  } catch (error) {
    captureHandledError(error, { step });
    return { status: 'unavailable', reason: 'tenant-read-failed' };
  }

  // D6 — both unlimited forms are checked BEFORE any numeric comparison and
  // before any count is issued. An unlimited tenant costs zero reads.
  if (allowance.unlimitedContacts) return { status: 'skipped', reason: 'unlimited-addon' };
  if (allowance.maxContacts === UNLIMITED_CAP) {
    return { status: 'skipped', reason: 'unlimited-sentinel' };
  }

  let othersCount: number;
  try {
    othersCount = await countOtherMembers(tenantId, excludeSelf);
  } catch (error) {
    captureHandledError(error, { step });
    return { status: 'unavailable', reason: 'count-failed' };
  }

  const cap = allowance.maxContacts;
  return isOverMemberCap(othersCount, cap)
    ? { status: 'refused', cap, othersCount, ministryName: allowance.ministryName }
    : { status: 'allowed', cap, othersCount };
}

/**
 * The whole decision for ONE applicant, as taken at set-claims time.
 *
 * `existingClaimTenantId` comes from `adminAuth.getUser(uid).customClaims?.tenantId`
 * (D3) — the custom claim, NOT the `users` doc, because `firestore.rules:144`
 * lets any authenticated user write their own `users` doc while a custom claim
 * can only be minted server-side.
 *
 * `applicantTenantId` comes from the applicant's OWN `users` doc (D7) — never
 * from the request body, never from the Host header.
 */
export async function decideMemberCapacity(args: {
  uid: string;
  applicantTenantId: string | null | undefined;
  existingClaimTenantId: string | null | undefined;
}): Promise<MemberCapOutcome> {
  const { applicantTenantId, existingClaimTenantId } = args;

  // D7 — no tenant, no cap. Super admins (`tenantId: null`) and main-site
  // accounts leave here and NO count query runs. "No concrete tenant" means the
  // cap does not apply; it can never mean "count everything".
  if (typeof applicantTenantId !== 'string' || applicantTenantId.trim() === '') {
    return { status: 'skipped', reason: 'no-tenant' };
  }
  const tenantId = applicantTenantId.trim();

  // D3 — already holds THIS tenant's claim → an existing member signing in.
  // No count query runs, which is why an over-cap tenant's daily sign-in
  // traffic costs nothing new, and why "a tenant with 500 members that moves to
  // Individual keeps all 500" is true at runtime.
  //
  // A uid holding another tenant's claim IS gated here — that is a person
  // joining a second ministry, and they are new to this one.
  if (typeof existingClaimTenantId === 'string' && existingClaimTenantId === tenantId) {
    return { status: 'skipped', reason: 'existing-member' };
  }

  // At set-claims time the applicant's own users doc already exists, so the raw
  // count includes them and one must be subtracted (D4).
  return decide(tenantId, true, 'member-cap-count');
}

/**
 * The pre-flight question, asked before any account exists: "can this tenant
 * accept a new member?" No uid, so no self to exclude — `excludeSelf: false`.
 *
 * 🔴 This is a UX affordance, not the enforcement. It exists so a real human
 * never ends up with a half-created account (a Firebase Auth user and a `users`
 * doc, but no claim and no access). A client that skips it is still refused by
 * `decideMemberCapacity` at set-claims time.
 */
export async function canTenantAcceptNewMember(tenantId: string): Promise<MemberCapOutcome> {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    return { status: 'unavailable', reason: 'invalid-tenant-id' };
  }
  return decide(tenantId.trim(), false, 'member-cap-preflight');
}

/**
 * C2 — mark a refused applicant's `users` doc so the ghost is identifiable for
 * the follow-up sweep. Writes `capRefusedAt` (ISO) and `capRefusedTenantId`.
 *
 * Best-effort by design: a failure here is captured and swallowed, because it
 * must never turn a clean 403 into a 500 — the person has already been refused
 * correctly and the stamp is diagnostics, not the decision. This is the one
 * place in the module where a swallow is right, and the reason is that the
 * outcome it could corrupt is already decided and already loud.
 *
 * It deletes nothing, disables nothing, and touches no other document (D8).
 * Nothing reads these fields in this PR.
 */
export async function stampRefusal(uid: string, tenantId: string): Promise<void> {
  try {
    const scopedUid = assertConcreteTenantId(uid, 'uid');
    const scopedTenant = assertConcreteTenantId(tenantId, 'tenantId');
    await adminDb.collection('users').doc(scopedUid).set(
      {
        capRefusedAt: new Date().toISOString(),
        capRefusedTenantId: scopedTenant,
      },
      { merge: true },
    );
  } catch (error) {
    captureHandledError(error, { step: 'member-cap-stamp-refusal' });
  }
}
