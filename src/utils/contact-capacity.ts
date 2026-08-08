/**
 * `maxContacts` — the tenant's contact allowance (150 / 500 / 2,000).
 *
 * Shaped deliberately after `admin-seats.ts` (#278), which was itself shaped
 * after `course-adoption.ts`'s cap helpers, so the three plan caps this app
 * enforces read the same way and can only drift together.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 WHAT IT COUNTS: ACCOUNT-HOLDERS ONLY.
 *
 * The cap counts `users` documents scoped to the tenant — people who hold an
 * account. Standalone `contacts` rows (donors who gave without ever signing up)
 * stay FULLY VISIBLE in the CRM and do NOT count.
 *
 * That is not an arbitrary line. The public donate page requires no account, so
 * the donation webhook creates a `contacts` row for anyone who gives
 * (src/app/api/stripe/webhook/route.ts). Those records are what giving
 * statements and year-end tax receipts are built from. Counting them would sell
 * a church capacity its own donors consume without asking; HIDING them past the
 * cap would withhold records a treasurer legally needs in January. Either would
 * break a shipped Ministry feature. So donors are visible and free, and the cap
 * prices the thing the tenant actually administers: accounts.
 *
 * The number itself is NOT counted here. It comes from `useCRMCounts`
 * (`memberAccounts`, THE-67 / #279), which runs a single `getCountFromServer()`
 * aggregation per collection. There is deliberately no second counting path in
 * this module: two counts of one fact is the duplicated-fact shape behind the
 * retention bug, the four-copy over-sell and the stale price table. This module
 * only ADJUSTS that figure (see countContactAccounts) and compares it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 HOW IT BEHAVES: SOFT. IT NEVER BLOCKS SIGNUP.
 *
 * Accounts arrive by member SELF-SIGNUP (AuthPage). A hard block there would
 * reject a visitor who cannot fix it, cannot upgrade the plan, and has no idea
 * why they were turned away — the worst outcome available. Nothing in this
 * module is reachable from the signup path, and it must stay that way.
 *
 *   | over the cap                       | behaviour                          |
 *   |------------------------------------|------------------------------------|
 *   | a member signs up                  | ALWAYS works. Nothing is blocked.  |
 *   | an admin adds a contact manually   | blocked, with a reason             |
 *   | the admin                          | told clearly, once — not nagged    |
 *
 * The principle: gate what the ADMIN controls, never what a VISITOR does.
 *
 * (There is no CSV import anywhere in the app — every CSV path in the codebase
 * is an EXPORT. The manual add form in AdminCRM is the only admin-initiated
 * creation path, so it is the only thing gated. If an importer ever ships it
 * must call these helpers too.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THE CAP HERE IS CLIENT-SIDE ONLY.
 *
 * AdminCRM disables its "Add contact" entry points and refuses a save that
 * would create a new contact past the cap. Nothing server-side or in
 * firestore.rules counts documents — rules CANNOT count across a collection —
 * so an admin who already holds `manageCRM` can still write a contact with a
 * direct SDK call from devtools. This is exactly the honest limitation
 * `maxCourses` (course-adoption.ts) and `maxAdmins` (admin-seats.ts) already
 * carry.
 *
 * Where real enforcement would belong: the count is over `users`, and the one
 * server hop every new account makes is POST /api/auth/set-claims. A count
 * there could make the ACCOUNT figure authoritative — but it must not refuse
 * the account (see "never blocks signup" above), so the only honest server-side
 * gate is on the ADMIN write path, which today has no server hop at all: the
 * manual add is a direct client `addDoc`. Making the cap real therefore means
 * introducing POST /api/crm/contacts (Admin SDK: read tenants/{id}.plan, count
 * `users` where tenantId == t, refuse a NEW contact past the cap) and
 * tightening `contacts` creation in firestore.rules to server-only. That is an
 * auth/rules change and is deliberately NOT done here.
 *
 * ⚠️ BLOCKS NEW MANUAL ADDS ONLY. A tenant already over its cap — after a
 * downgrade, or because the cap never existed until now — keeps every contact
 * and every account it has. Nothing in this module deletes, hides, disables or
 * demotes anyone, and every existing row stays editable.
 */

import { getPlanFeatures, toTenantPlan } from './plan-features';
import { isSuperAdminEmail } from './super-admins';

/** Unlimited sentinel used by plan-features' maxContacts. */
export const UNLIMITED = -1;

/**
 * The `users`-document facts the cap needs about one person.
 *
 * Carried on a merged CRM row as `Contact.account`, and present ONLY for people
 * who actually hold an account — a donor-only `contacts` row has none, which is
 * what keeps donors uncounted without a second query.
 */
export interface AccountHolder {
  /** `role` from the person's `users` doc ('user' / 'admin' / 'super_admin'). */
  role?: string | null;
  /** `email` from the person's `users` doc. */
  email?: string | null;
}

/** The minimum a merged CRM row needs to expose for capacity accounting. */
export interface CapacityCandidate {
  account?: AccountHolder;
}

/**
 * The tenant's contact allowance.
 *
 * Fails closed to 'plus' (150) when the plan is unknown or still loading — the
 * same fallback AdminCourses uses for maxCourses, AnalyticsAndRoles for
 * maxAdmins and AdminChurches for maxChurches. A super admin browsing a tenant
 * subdomain is gated by that tenant's real plan, matching TenantContext's rule
 * that on a tenant subdomain EVERYONE is gated by the tenant's plan.
 */
export function resolveContactLimit(plan: string | null | undefined): number {
  return getPlanFeatures(toTenantPlan(plan)).maxContacts;
}

/**
 * Does this account spend one of the tenant's purchased contact slots?
 *
 * 🔴 SUPER ADMINS DO NOT. They are Harvest platform staff, not capacity a
 * church bought, and `bumbmatei@proton.me` appears inside tenant user lists.
 *
 * Both legs of "is a super admin" are checked, matching isBillableAdminSeat()
 * in admin-seats.ts, isSuperAdmin() in firestore.rules and the claim minting in
 * set-custom-claims.ts: the `role` field AND the email allow-list. The email
 * leg matters because tenant-scope re-exports only the POSITIONAL
 * `SUPER_ADMIN_EMAILS[0]`, so a SECOND platform owner carrying `role: 'admin'`
 * (or plain `'user'`) is indistinguishable from an ordinary account to any
 * component reading that re-export — and would silently consume a church's
 * capacity. `isSuperAdminEmail` covers the whole frozen list.
 *
 * 🔴 THE OWNER COUNTS. They hold an account. This is the same reasoning that
 * settled it for admin seats: the owner is only identifiable via
 * `tenants/{id}.ownerId`, which is read best-effort and degrades to `null` when
 * that read fails, so an owner exemption would silently RAISE the cap by one
 * whenever that read broke. A limit that loosens on error is worse than no
 * limit. (`ownerId` is not even loaded on this screen — exempting the owner
 * would mean adding a read purely to weaken the cap.)
 *
 * 🔴 ADMINS COUNT. They hold accounts. A tenant's admin SEATS (`maxAdmins`) and
 * its contact CAPACITY (`maxContacts`) are separate allowances over the same
 * people: an admin consumes one of each, exactly as they would if they were
 * also a donor. Exempting admins here would let a tenant hold `maxAdmins` extra
 * accounts beyond what it bought.
 */
export function isBillableContactAccount(account: AccountHolder): boolean {
  if (account.role === 'super_admin') return false;
  if (isSuperAdminEmail(account.email)) return false;
  return true;
}

/**
 * How many of the LOADED rows are accounts that do not count — i.e. super
 * admins holding a `users` doc in this tenant.
 *
 * This is the one adjustment `memberAccounts` needs and cannot make itself:
 * `getCountFromServer()` returns a bare number, and no aggregation can filter
 * by a client-side email allow-list without a second query and a composite
 * (tenantId + email) index. So the exemption is derived from rows the CRM has
 * ALREADY loaded, at no extra read.
 *
 * `row.account` is the load-bearing part. It is set by
 * `mergeContactsWithUsers` only for people who actually hold a `users` doc —
 * both users-only members and `contacts` rows that folded one in. A super admin
 * who appears in this tenant ONLY as a donor-only `contacts` row (they gave,
 * but have no account here) therefore has no `account` and is NOT subtracted:
 * subtracting them would discount an account that was never in `memberAccounts`
 * to begin with, and quietly raise the cap by one.
 *
 * Bounded by construction: `SUPER_ADMIN_EMAILS` is frozen at two entries, so at
 * most a handful of rows can ever be exempt.
 */
export function countExemptAccounts(
  rows: ReadonlyArray<CapacityCandidate>,
): number {
  return rows.filter((r) => !!r.account && !isBillableContactAccount(r.account)).length;
}

/**
 * The tenant's spent contact capacity.
 *
 * `memberAccounts` is #279's server-side aggregate over `users` — the ONLY
 * count of this fact — minus the super admins among the loaded rows. Donors
 * without an account are not in `memberAccounts` at all (it counts `users`,
 * never `contacts`), so nothing has to exclude them: a tenant with 149 accounts
 * and 500 donor-only rows is at 149, comfortably under Individual's 150.
 *
 * Clamped at 0. The exemption is derived from a BOUNDED prefix of the list
 * (CRM_FETCH_LIMIT rows per collection) while `memberAccounts` is unbounded, so
 * the two can only ever disagree in the safe direction — but a negative
 * capacity would be nonsense on screen either way.
 */
export function countContactAccounts(
  memberAccounts: number,
  rows: ReadonlyArray<CapacityCandidate>,
): number {
  return Math.max(0, memberAccounts - countExemptAccounts(rows));
}

/**
 * Whether the tenant has spent its contact allowance.
 *
 * `>=`, not `>`: at exactly the cap there is no slot left to fill.
 * A tenant ALREADY over the cap is simply at-limit — see the module header;
 * being over it blocks the next manual add and nothing else.
 */
export function isAtContactLimit(accountCount: number, maxContacts: number): boolean {
  if (maxContacts === UNLIMITED) return false;
  return accountCount >= maxContacts;
}

/**
 * The user-facing cap message.
 *
 * ⚠️ NAMES NO PRICE AND OFFERS NO ADD-ON. The +500-contact and unlimited
 * add-ons are DECIDED BUT NOT BUILT; advertising a purchase that does not exist
 * is the failure mode this codebase has already shipped four times (#33, #29,
 * THE-13, #227). "Upgrade your plan" points at something that does exist. If a
 * contact add-on ever ships, change this string then — not before.
 *
 * It also states what does NOT count, because that is the part an admin cannot
 * infer from a number: seeing 900 donors listed under a "500 contacts" plan
 * looks like a bug unless the copy says donors are free.
 */
export function contactLimitMessage(maxContacts: number): string {
  return (
    `Your plan includes up to ${maxContacts.toLocaleString()} member accounts. ` +
    `Donors who gave without creating an account don't count and stay in your list. ` +
    `Upgrade your plan to add more.`
  );
}
