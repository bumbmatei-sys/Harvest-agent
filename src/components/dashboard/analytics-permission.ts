/**
 * THE-276 — who may see the analytics dashboard.
 *
 * ─── Where this permission is already enforced, and why that is the rule ─────
 *
 * ⚠️ `analytics` is a UI-LEVEL permission. It is one of ~25 rows in
 * `AnalyticsAndRoles.tsx`'s catalog — `{ key: "analytics", label: "Analytics",
 * desc: "View registration analytics" }` — and it appears NOWHERE in
 * firestore.rules: grep the rules for "analytics" and there are no hits. So
 * there is no server-side rule to mirror, and the app's own definition of the
 * permission is the one place that already enforces it:
 *
 *     AdminCRM.tsx:489
 *     const canViewAnalytics = currentUserRole === 'super_admin'
 *       || !!currentUserPermissions?.fullAccess
 *       || !!currentUserPermissions?.analytics;
 *
 * 🔴 That expression is reproduced below, term for term, and NOT the generic
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
 * ─── Why this reads its own answer instead of taking a prop ──────────────────
 *
 * AdminCRM takes `currentUserRole` and `currentUserPermissions` as props from
 * the admin shell. The shell is `AdminDashboard.tsx`, which THE-277 owns and
 * this ticket may not open, so the same two props cannot be threaded here —
 * `AdminDashboardHome`'s five existing props carry no permission and no user.
 *
 * That is not a blocker: the shell reads those values off `users/{uid}`, and a
 * client may read its own user document. So this reads the same fields from the
 * same document and applies the same expression. When the shell is editable
 * again these become props and {@link canViewAnalytics} keeps its meaning
 * unchanged — which is why the rule is a pure function, separate from the read.
 */
import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from '../../firebase';
import { ROLE_SUPER_ADMIN } from '../../lib/roles';
import { isSuperAdminEmail } from '../../utils/super-admins';

/** The catalog key, spelled once. Must match AnalyticsAndRoles' `analytics` row. */
export const ANALYTICS_PERMISSION_KEY = 'analytics';

/** Resolved gate state. `pending` is not `denied` — the screen waits, not refuses. */
export type AnalyticsAccess = 'pending' | 'granted' | 'denied';

/**
 * AdminCRM.tsx:489, as a function.
 *
 * Pure and exported so a test can pin the expression itself rather than the
 * Firestore read around it, and so the read below is the only part that has to
 * change when the shell can pass these down.
 */
export function canViewAnalytics(
  role: string | undefined,
  permissions: Record<string, unknown> | null | undefined,
): boolean {
  return role === ROLE_SUPER_ADMIN
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
    return canViewAnalytics(
      typeof data.role === 'string' ? data.role : undefined,
      (data.permissions ?? null) as Record<string, unknown> | null,
    );
  } catch {
    return false;
  }
}
