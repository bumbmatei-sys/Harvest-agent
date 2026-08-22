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
 * 🔴 HOW THIS MODULE BEHAVES: SOFT, AND ADMIN-ONLY.
 *
 * ⚠️ POLICY REVERSED BY THE-201 — READ THIS BEFORE QUOTING THE PARAGRAPH THAT
 * USED TO BE HERE. This header previously stated, as a design principle, that
 * "IT NEVER BLOCKS SIGNUP" and that member self-signup ALWAYS works. That is no
 * longer true of the product. Since THE-201 there IS a hard, server-side member
 * signup cap: `src/lib/member-capacity.ts` counts `users` documents scoped to
 * the tenant and `POST /api/auth/set-claims` withholds the `tenantId` custom
 * claim — a 409 — when a NEW applicant would put the tenant past its effective
 * `maxContacts`.
 *
 * WHY IT REVERSED: the original reasoning (a refused visitor cannot fix it,
 * cannot upgrade the plan, and never finds out why) was sound when every tenant
 * was paying. The Forever Free tier changed the arithmetic: an unbounded member
 * count on a tier nobody pays for is an existential cost problem, not a pricing
 * nicety. So the block was accepted and the objection was answered in the COPY
 * instead — `src/utils/member-cap-copy.ts` names the ministry, points the
 * person at whoever invited them, says it is not their fault, and promises the
 * same email will work once room is made. Nobody is left guessing.
 *
 * WHAT DID NOT CHANGE, AND WHY THIS MODULE IS STILL SOFT: this file is the
 * ADMIN CRM's contact cap — a different cap, over different rows, for a
 * different audience. It gates the admin's manual "Add contact" form and
 * nothing else. Nothing in this module is reachable from the signup path and it
 * must stay that way; the signup gate lives in `lib/member-capacity.ts`, is
 * server-side, and shares no code with this one.
 *
 *   | over the cap                       | behaviour                          |
 *   |------------------------------------|------------------------------------|
 *   | a member signs up                  | refused by THE-201, server-side,   |
 *   |                                    | via /api/auth/set-claims — NOT here|
 *   | an admin adds a contact manually   | blocked here, with a reason        |
 *   | the admin                          | told clearly, once — not nagged    |
 *
 * The principle that survives: THIS module gates only what the ADMIN controls.
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
 * Where real enforcement lives — and it now EXISTS, for the member count:
 * THE-201 built it. The one server hop every new account makes is
 * POST /api/auth/set-claims, so that is where the member cap is enforced
 * (`src/lib/member-capacity.ts` counts `users where tenantId == t` with the
 * Admin SDK; the route returns 409 and withholds the `tenantId` claim). The
 * paragraph that used to stand here said such a gate "must not refuse the
 * account" — that constraint was lifted by THE-201, see the policy note above.
 *
 * What is still NOT enforced server-side is THIS module's cap: the admin's
 * manual contact add is a direct client `addDoc` with no server hop at all.
 * Making that one real would mean introducing POST /api/crm/contacts and
 * tightening `contacts` creation in firestore.rules to server-only. That is a
 * rules change and is deliberately NOT done here.
 *
 * ⚠️ BLOCKS NEW MANUAL ADDS ONLY. A tenant already over its cap — after a
 * downgrade, or because the cap never existed until now — keeps every contact
 * and every account it has. Nothing in this module deletes, hides, disables or
 * demotes anyone, and every existing row stays editable.
 */

import { getEffectiveFeatures, readTenantAddons, toTenantPlan } from './plan-features';
import { isSuperAdminEmail } from './super-admins';
import type { TenantAddons } from '../types/tenant.types';

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
 * The tenant's contact allowance, INCLUDING any Contacts +500 packs it owns.
 *
 * Fails closed to 'plus' (150) when the plan is unknown or still loading — the
 * same fallback AdminCourses uses for maxCourses, AnalyticsAndRoles for
 * maxAdmins and AdminChurches for maxChurches. A super admin browsing a tenant
 * subdomain is gated by that tenant's real plan, matching TenantContext's rule
 * that on a tenant subdomain EVERYONE is gated by the tenant's plan.
 *
 * `addons` is OPTIONAL and defaults to owning nothing (REP-5a). That default is
 * the honest one: it is exactly a tenant's answer before REP-5b threads the
 * add-on set through to the screens, and it can only ever UNDER-state capacity,
 * never over-state it. Passing a set raises the number by
 * `CONTACTS_PER_PACK` per pack.
 *
 * 🔴 ALWAYS FINITE. Unlimited Contacts does NOT come back through this number —
 * it is a separate boolean, and `isAtContactLimit` is where the two meet. See
 * `getEffectiveFeatures` for why a numeric "unlimited" is a zero-capacity bug
 * waiting for its first `>=`.
 */
export function resolveContactLimit(
  plan: string | null | undefined,
  addons?: TenantAddons | null,
): number {
  return getEffectiveFeatures(toTenantPlan(plan), addons).maxContacts;
}

/**
 * Does this tenant hold the Unlimited Contacts add-on?
 *
 * The companion to `resolveContactLimit` — the two answers a cap check needs,
 * asked separately because one is a number and the other is not. Plan-free by
 * construction: no tier grants unlimited contacts, only the add-on does.
 */
export function hasUnlimitedContacts(addons?: TenantAddons | null): boolean {
  return readTenantAddons(addons).unlimitedContacts;
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
 * 🔴 THE QUESTION IS "UNLIMITED, OR UNDER THE NUMBER?" — in that order.
 * `unlimited` is the Unlimited Contacts add-on (REP-5a) and it is asked FIRST,
 * because there is no number that can carry "unlimited" safely: `Infinity` does
 * not survive Firestore, and a `-1` reaching a `>=` somewhere reads as zero
 * capacity — the most expensive add-on Harvest sells, silently inverted. So the
 * count stays a real number and the unlimited fact travels beside it.
 *
 * It defaults to `false`, which keeps every existing two-argument call site
 * behaving exactly as it did. `hasUnlimitedContacts(tenant.addons)` is what
 * fills it once a caller holds the tenant's add-on set.
 *
 * `>=`, not `>`: at exactly the cap there is no slot left to fill.
 * A tenant ALREADY over the cap is simply at-limit — see the module header;
 * being over it blocks the next manual add and nothing else.
 */
export function isAtContactLimit(
  accountCount: number,
  maxContacts: number,
  unlimited: boolean = false,
): boolean {
  if (unlimited) return false;
  // The matrix's own sentinel, kept for any tier that ever carries it. Not the
  // add-on's route to unlimited — that is the flag above.
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
