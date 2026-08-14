/**
 * `maxAdmins` — the tenant's admin-seat allowance (2 / 5 / 15).
 *
 * Shaped deliberately after `course-adoption.ts`'s cap helpers
 * (resolveCourseLimit / isAtCourseLimit / courseLimitMessage) so the two plan
 * caps this app enforces read the same way and can only drift together.
 *
 * ⚠️ THE CAP HERE IS CLIENT-SIDE ONLY.
 *
 * The Roles screen disables its "Add Admin" entry point and refuses a save that
 * would spend a seat the tenant does not have. Nothing server-side or in
 * firestore.rules counts documents — rules cannot count across a collection —
 * so an admin who already holds `manageAdmins` can still promote someone with a
 * direct SDK write from devtools. This is exactly the honest limitation
 * `maxCourses` carries on its creation path today (see course-adoption.ts).
 *
 * Where real enforcement belongs: role changes are followed by
 * POST /api/auth/set-claims, which is the one server hop every promotion makes.
 * A count there (Admin SDK: read tenants/{id}.plan, count users where tenantId
 * == t and role == 'admin', refuse to mint the admin claim past the cap) would
 * make the cap real. That is an AUTH route and is deliberately NOT touched here.
 *
 * ⚠️ BLOCKS NEW PROMOTIONS ONLY. A tenant already over its cap — after a
 * downgrade, or because the cap never existed until now — keeps every existing
 * admin. Nothing in this module demotes, hides, or removes anyone.
 */

import { getEffectiveFeatures, toTenantPlan } from './plan-features';
import { isSuperAdminEmail } from './super-admins';
import type { TenantAddons } from '../types/tenant.types';

/** Unlimited sentinel used by plan-features' maxAdmins. */
export const UNLIMITED = -1;

/** The minimum an admin row needs to expose for seat accounting. */
export interface SeatCandidate {
  role: string;
  email: string;
}

/**
 * The tenant's admin allowance, INCLUDING any Admin Seat add-ons it owns.
 *
 * Fails closed to 'plus' (2) when the plan is unknown or still loading — the
 * same fallback AdminCourses uses for maxCourses and AdminChurches for
 * maxChurches. A super admin browsing a tenant subdomain is gated by that
 * tenant's real plan, matching TenantContext's rule that on a tenant subdomain
 * EVERYONE is gated by the tenant's plan.
 *
 * `addons` is OPTIONAL and defaults to owning nothing (REP-5a) — the same shape
 * and the same reasoning as `resolveContactLimit`: the default is exactly a
 * tenant's answer before REP-5b threads the add-on set through to the screens,
 * and it can only under-state the allowance, never over-state it. One seat
 * add-on unit raises this by one.
 */
export function resolveAdminLimit(
  plan: string | null | undefined,
  addons?: TenantAddons | null,
): number {
  return getEffectiveFeatures(toTenantPlan(plan), addons).maxAdmins;
}

/**
 * Does this row spend one of the tenant's purchased admin seats?
 *
 * 🔴 SUPER ADMINS DO NOT. They are Harvest platform staff, not a seat the
 * church bought, and they appear inside tenant user lists — counting them would
 * charge a customer for Harvest's own access to their instance.
 *
 * Both legs of "is a super admin" are checked, matching isSuperAdmin() in
 * firestore.rules and the claim minting in set-custom-claims.ts: the `role`
 * field AND the email allow-list. The email leg matters because the Roles list
 * upgrades a row's displayed role from the FIRST super-admin email only
 * (tenant-scope's positional `SUPER_ADMIN_EMAILS[0]` re-export), so a second
 * listed platform owner carrying `role: 'admin'` renders as an ordinary admin.
 * Counting that row would bill the tenant for it. `isSuperAdminEmail` covers
 * the whole frozen list.
 *
 * 🔴 AN ADMIN WITH NO PERMISSIONS ASSIGNED DOES COUNT. `role: 'admin'` is what
 * mints the `admin: true` custom claim (set-custom-claims.ts) and what
 * firestore.rules' isTenantAdmin() keys off — the permissions map narrows what
 * an admin may do, it does not decide whether they are one. Exempting them
 * would also make the cap trivially sidesteppable: create N permissionless
 * admins while "under" the cap, then grant permissions in a later edit, which
 * is not a promotion and is never blocked.
 *
 * 🔴 THE PLAN OWNER DOES COUNT. The owner is created with `role: 'admin'` by
 * the Stripe webhook and is structurally an ordinary tenant admin; the plan
 * matrix bills the cell as "Admin Accounts", and the owner has one. So
 * Individual's 2 means a solo pastor plus one volunteer, not plus two. It also
 * keeps the count honest under failure: the Roles screen loads
 * tenants/{id}.ownerId best-effort and degrades to null when that read fails,
 * so an owner exemption would silently RAISE the cap by one whenever that read
 * broke — a limit that loosens on error is worse than no limit.
 */
export function isBillableAdminSeat(row: SeatCandidate): boolean {
  if (row.role === 'super_admin') return false;
  if (isSuperAdminEmail(row.email)) return false;
  return row.role === 'admin';
}

/** How many of the tenant's admin seats are currently spent. */
export function countAdminSeats(rows: ReadonlyArray<SeatCandidate>): number {
  return rows.filter(isBillableAdminSeat).length;
}

/**
 * Whether the tenant has spent its admin allowance.
 *
 * `>=`, not `>`: at exactly the cap there is no seat left to give away.
 * A tenant ALREADY over the cap is simply at-limit — see the module header;
 * being over it blocks the next promotion and nothing else.
 */
export function isAtAdminLimit(seatCount: number, maxAdmins: number): boolean {
  if (maxAdmins === UNLIMITED) return false;
  return seatCount >= maxAdmins;
}

/**
 * The user-facing cap message.
 *
 * ⚠️ NAMES NO PRICE AND OFFERS NO ADD-ON. Extra admin seats are a decided but
 * UNBUILT product; advertising a purchase that does not exist is the failure
 * mode this codebase has already shipped four times (#33, #29, THE-13, #227).
 * "Upgrade your plan" points at something that does exist. If a seat add-on
 * ever ships, change this string then — not before.
 */
export function adminLimitMessage(maxAdmins: number): string {
  return `Your plan includes up to ${maxAdmins} admin${maxAdmins === 1 ? '' : 's'} (the plan owner counts as one). Upgrade your plan to add more.`;
}

/**
 * Would saving `targetId` spend a NEW seat?
 *
 * False for anyone already counted — editing an existing admin's permissions is
 * not a promotion and must never be blocked, including when they are edited
 * through the "Add Admin" form. This is what keeps an over-cap tenant fully
 * manageable instead of frozen.
 */
export function wouldSpendNewSeat(
  rows: ReadonlyArray<SeatCandidate & { id: string }>,
  targetId: string,
): boolean {
  return !rows.some((r) => r.id === targetId && isBillableAdminSeat(r));
}
