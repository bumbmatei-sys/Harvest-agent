/**
 * THE-276 — who may see the analytics dashboard.
 *
 * ─── Where this permission is already enforced, and why that is the rule ─────
 *
 * ⚠️ `analytics` is a UI-LEVEL permission. It is one of ~25 rows in the
 * permission catalog — `{ key: "analytics", label: "Analytics", desc: "View
 * registration analytics" }`, in `AdminRoles.tsx` — and it appears NOWHERE in
 * firestore.rules: grep the rules for "analytics" and there are no hits. So
 * there is no server-side rule to mirror, and the app's own definition of the
 * permission is what already enforces it:
 *
 *     const canViewAnalytics = currentUserRole === 'super_admin'
 *       || !!currentUserPermissions?.fullAccess
 *       || !!currentUserPermissions?.analytics;
 *
 * ⚠️ THAT EXPRESSION HAS MOVED, and the citation is kept current deliberately.
 * It was `AdminCRM.tsx:489` when this was written; THE-277 (#422) split the
 * Analytics sub-view out of the CRM, and the only surviving enforcement of this
 * permission is now the `hasFullAccess || perms.analytics` clause on the
 * dashboard shell's own nav gate. 🔴 That file is THE-277's and this ticket may
 * not open it — its location was established by grep, not by reading it — which
 * is precisely why the rule is reproduced here as a pure function rather than
 * imported: this module cannot depend on a file it is not allowed to read.
 *
 * 🔴 The expression is reproduced below, term for term, and NOT the generic
 * `hasPermission(perm, tenantId)` from firestore.rules. The two differ, and the
 * difference decides real people: the rules helper grants unconditionally to
 * the tenant owner and to every address on `tenant_private.adminEmails`, so
 * mirroring it would grant analytics to every invited admin regardless of the
 * `analytics` checkbox — which would make the checkbox in the permission matrix
 * decorative. `analytics` gates no write and no document, so there is no rule
 * that would refuse such an admin anyway; the matrix IS the whole contract, and
 * an admin whose Analytics row is unchecked must not see this screen.
 *
 * 🔴 Every underlying READ is separately enforced by rules — `users`,
 * `contacts`, `courses` and `invoices` are all `isTenantAdmin` or better — which
 * is what actually keeps a non-admin out of the data. This decides who is shown
 * the SCREEN.
 *
 * ─── THE-302: the fourth term, and why it is the OWNER and not the roster ────
 *
 * 🔴 THE PARAGRAPH ABOVE IS RIGHT ABOUT INVITED ADMINS AND WAS WRONG ABOUT THE
 * OWNER. Reported from production by a founder on a paid Ministry plan: "I
 * bought a ministry plan. I cannot see any of the dashboards. It says I have to
 * contact an admin for it." The tenant document was correct — `plan: 'max'`,
 * `status: 'active'`, `ownerId === createdBy`. The purchase landed; the gate
 * refused anyway.
 *
 * ⚠️ WHY, EXACTLY. All three provisioning paths — `lib/free-provisioning`,
 * `lib/dodo/provisioning` and `api/stripe/webhook` — write the SAME field set
 * onto the buyer's `users/{uid}`:
 *
 *     { tenantId, role: PROVISIONED_TENANT_OWNER_ROLE, plan,
 *       onboardingCompleted: true, signupInProgress: false, updatedAt }
 *
 * 🔴 THERE IS NO `permissions` KEY IN THAT SET, on any of the three. The owner's
 * permission map does not exist — it is not empty, it is absent — so the three
 * terms above evaluate `'admin' === 'super_admin' || undefined || undefined`
 * and the person who paid for the tenant is refused their own analytics. The
 * only thing that ever writes `users/{uid}.permissions` is `AdminRoles`, i.e.
 * another admin ticking boxes. The owner is not someone whose permissions get
 * ticked; they are the person who ticks them.
 *
 * ⚠️ THE REST OF THE APP ALREADY TREATS THEM AS FULL ACCESS, which is what made
 * this a dashboard-only lockout rather than an account-wide one: the shell's
 * `hasFullAccess` is `isSuperAdmin || isChurchAdmin || perms.fullAccess`, and
 * `isChurchAdmin` folds in an admin-roster answer from
 * GET /api/tenants/roster-status. Every other gated tab therefore opens for the
 * owner and only this screen does not.
 *
 * 🔴 THE ROSTER IS NOT WHAT IS MIRRORED HERE, AND THAT IS THE WHOLE POINT.
 * `tenant_private.adminEmails` carries the owner AND every invited admin, so
 * granting on roster membership is exactly the "checkbox becomes decorative"
 * outcome the paragraph above refuses. The term added below is `ownerId`, which
 * identifies exactly ONE uid per tenant:
 *
 *   • `tenants/{id}.ownerId` is written once, at provisioning, by the same three
 *     paths, as the buyer's uid (`ownerId: userId` / `ownerId: meta.userId`).
 *   • firestore.rules makes `tenants/{tenantId}` `allow read: if true`, so the
 *     browser can read it directly — no route, no roster, nothing server-only.
 *   • `api/lib/api-auth.requireOwner` reads the same field first
 *     (`tenantData.ownerId === user.uid`) before it consults the roster, so
 *     "owner" means server-side precisely what it means here.
 *
 * An invited admin is never `ownerId`. Their Analytics row still decides, which
 * is the property `the-302-analytics-owner.test.ts` pins by mounting two admins
 * on ONE tenant whose user documents are identical apart from that uid.
 *
 * ⚠️ THE PLAN CLAUSE IS NOT DUPLICATED HERE and must not be. The shell gates the
 * Signups entry on the plan matrix's CRM cell alongside the permission, and that
 * cell is `true` on all four tiers (free, plus, pro, max — pinned in the same
 * test), so no paid plan is missing it and there is nothing for this module to
 * refuse on plan grounds.
 *
 * ⚠️ The cell is named in prose rather than spelled as a property access, on
 * purpose. The plan-features CRM suite sweeps every production `.ts`/`.tsx`
 * under `src` for readers of that cell, matching the property access itself and
 * reading comments too, and asserts the readers are exactly the two files that
 * make a RENDER decision with it. Writing the expression here — even inside this
 * sentence — would enrol this module as a third, and it makes no plan decision
 * at all. Same reason the shell spells its own retired analytics term in prose.
 *
 * ─── Why this reads its own answer instead of taking a prop ──────────────────
 *
 * Screens that gate on a permission take `currentUserRole` and
 * `currentUserPermissions` as props from the admin shell. The shell is
 * `AdminDashboard.tsx`, which THE-277 owns and this ticket may not open, so the
 * same two props cannot be threaded here —
 * `AdminDashboardHome`'s five existing props carry no permission and no user.
 *
 * That is not a blocker: the shell reads those values off `users/{uid}`, and a
 * client may read its own user document. So this reads the same fields from the
 * same document and applies the same expression. When the shell is editable
 * again these become props and {@link canViewAnalytics} keeps its meaning
 * unchanged — which is why the rule is a pure function, separate from the read.
 *
 * ⚠️ THE TENANT ID COMES FROM THE USER DOCUMENT, NOT FROM THE `tenantId` PROP,
 * for the same reason. `AdminDashboardHome` does hold that prop, but the gate
 * runs from a `useEffect` with an empty dependency list — one answer, on mount —
 * and the prop is `currentTenantId` off the store, which is null for a render or
 * two while the tenant resolves. Reading it there would deny the owner on a
 * timing race and never re-ask. `users/{uid}.tenantId` is written by the same
 * provisioning batch that writes `ownerId`, is already in the document this
 * function reads, and cannot be half-resolved.
 */
import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from '../../firebase';
import { ROLE_SUPER_ADMIN } from '../../lib/roles';
import { isSuperAdminEmail } from '../../utils/super-admins';

/** The catalog key, spelled once. Must match the catalog's `analytics` row. */
export const ANALYTICS_PERMISSION_KEY = 'analytics';

/** Resolved gate state. `pending` is not `denied` — the screen waits, not refuses. */
export type AnalyticsAccess = 'pending' | 'granted' | 'denied';

/**
 * AdminCRM.tsx:489, as a function, plus THE-302's owner term.
 *
 * Pure and exported so a test can pin the expression itself rather than the
 * Firestore read around it, and so the read below is the only part that has to
 * change when the shell can pass these down.
 *
 * @param isTenantOwner `tenants/{id}.ownerId === auth.currentUser.uid`, and
 *   NOTHING looser. Defaults to false so every existing call site keeps the
 *   three-term meaning it was written against, and so a caller that cannot
 *   establish ownership fails closed rather than guessing.
 */
export function canViewAnalytics(
  role: string | undefined,
  permissions: Record<string, unknown> | null | undefined,
  isTenantOwner: boolean = false,
): boolean {
  return role === ROLE_SUPER_ADMIN
    || isTenantOwner
    || !!permissions?.fullAccess
    || !!permissions?.[ANALYTICS_PERMISSION_KEY];
}

/**
 * Whether the signed-in account may see the analytics dashboard.
 *
 * Returns `false` on a failed read: a `users/{uid}` document that cannot be read
 * is not evidence of a grant, so this gate fails CLOSED.
 *
 * ⚠️ That is the OPPOSITE of what a data read in this feature does — an
 * unreadable count becomes "unavailable", never zero — and the asymmetry is
 * deliberate. A permission read that opened the screen on its own failure is
 * the shape THE-216 removed from the shell's plan gates; a data read that
 * showed a zero would state a fact nobody established. Both fail towards
 * claiming less.
 *
 * ⚠️ The tenant read is SEPARATELY fail-closed, and separately guarded: a
 * failure to read `tenants/{id}` leaves `isTenantOwner` false, which is the same
 * answer as "you are not the owner". An admin whose Analytics row IS ticked is
 * unaffected by it either way, because the permission terms are evaluated from
 * the user document alone.
 */
export async function hasAnalyticsAccess(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  // The platform owner is scoped by email, never by a stored permission map.
  if (isSuperAdminEmail(user.email)) return true;

  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) return false;
    const data = snap.data() as Record<string, unknown>;
    const role = typeof data.role === 'string' ? data.role : undefined;
    const permissions = (data.permissions ?? null) as Record<string, unknown> | null;

    // Short-circuit: the three original terms need no second read, so an admin
    // who is already granted costs exactly what they cost before.
    if (canViewAnalytics(role, permissions)) return true;

    const tenantId = typeof data.tenantId === 'string' ? data.tenantId : '';
    if (!tenantId) return false;
    return canViewAnalytics(role, permissions, await isTenantOwner(tenantId, user.uid));
  } catch {
    return false;
  }
}

/**
 * Is `uid` the buyer this tenant was provisioned for?
 *
 * ONE uid per tenant, by construction — `ownerId` is a single field written once
 * at provisioning. 🔴 Deliberately does NOT consult the admin roster, and no
 * caller may add it: the roster is every invited admin, and granting on it is
 * what would make the Analytics checkbox decorative.
 */
async function isTenantOwner(tenantId: string, uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'tenants', tenantId));
    if (!snap.exists()) return false;
    return (snap.data() as Record<string, unknown>).ownerId === uid;
  } catch {
    return false;
  }
}
