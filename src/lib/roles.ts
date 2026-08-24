/**
 * THE-219 — the ONE place a `users/{uid}.role` value may come from.
 *
 * 🔴 WHY THIS FILE EXISTS, AND WHAT IT IS NOT.
 *
 * It exists because of a shape, not because of a bug that was found here. The
 * shape: a role written by one provisioning path and not recognised by another
 * fails SILENTLY — the account is simply shown a smaller product, with no error
 * anywhere. THE-219 was reported as exactly that ("I could only see the
 * dashboard in the bottom bar and a More button with an empty list"), so the
 * role values were audited end to end.
 *
 * ⚠️ THE AUDIT FOUND THE WRITERS ALREADY AGREE. All three provisioning paths —
 * free (`lib/free-provisioning`), Dodo (`lib/dodo/provisioning`) and Stripe
 * (`api/stripe/webhook`) — write `'admin'`, with an identical field set, and
 * `'admin'` is accepted by every reader in `TENANT_ADMIN_ROLES` below. There
 * was no invented value to correct. This module therefore changes NO value and
 * NO permission: it is a lock on an agreement that already holds, so the next
 * provisioning path cannot quietly break it.
 *
 * ⚠️ NOT EVERY ADMIN HAS AN ADMIN ROLE, and nothing here may be read to imply
 * otherwise. An invited admin is granted by ROSTER MEMBERSHIP
 * (`tenant_private.adminEmails`, written by `api/tenants/save`) and carries no
 * role of its own — deliberately, so admin seats are not role writes. Any check
 * that reads a role ALONE and refuses everything else silently refuses them;
 * that is THE-64/THE-83's bug, and the roster arm of those checks stays.
 */

/** An ordinary member. The default for every account that never provisioned. */
export const ROLE_MEMBER = 'user';

/**
 * The tenant owner, as written by every provisioning path.
 *
 * ⚠️ Roster-DEPENDENT for full access by design (see
 * `AdminDashboard.hasRosterIndependentAccess`): this value alone is not a grant,
 * it is an identity. Do not "upgrade" it to skip the roster — that would change
 * what the role is permitted to do, which THE-219 explicitly may not.
 */
export const ROLE_ADMIN = 'admin';

/**
 * The legacy tenant-owner label, from before provisioning settled on
 * `ROLE_ADMIN`. Still held by live accounts, so still accepted everywhere —
 * but it is NOT written by anything any more, which is why it is absent from
 * `PROVISIONED_TENANT_OWNER_ROLE` below.
 */
export const ROLE_CHURCH_ADMIN = 'church_admin';

/** The platform owner. Scoped by email, never granted by provisioning. */
export const ROLE_SUPER_ADMIN = 'super_admin';

/**
 * The buyer of a standalone AI assistant — NOT a church, and NOT a tenant admin.
 *
 * 🔴 FOUND BY THE THE-219 AUDIT, AND DELIBERATELY LEFT AS IT IS. This value is
 * written by the Stripe webhook onto a user doc and is read, as a role, by
 * NOTHING — which is the same shape the founder asked to be guarded against.
 * Here it is harmless and intended: the account buys an assistant on the
 * platform tenant, it was never meant to confer church-admin identity, and
 * every tenant-admin reader correctly answers "no" for it.
 *
 * It is named here rather than corrected because correcting it would change
 * what this account can do, which THE-219 may not. Naming it is what makes the
 * guard total: `provisioning-roles.test.ts` demands that every role any
 * provisioning path writes is a RECOGNISED value, so a genuinely invented one
 * still fails while this deliberate one passes — on the record, with a reason.
 */
export const ROLE_STANDALONE_AI_USER = 'standalone_ai_user';

/**
 * Every role value a tenant-admin reader accepts.
 *
 * 🔴 The set a provisioning path's write is checked AGAINST (see
 * `__tests__/provisioning-roles.test.ts`). Adding a value here without teaching
 * the readers is the exact failure this module exists to prevent — so the
 * readers below import THIS constant rather than repeating its members.
 */
export const TENANT_ADMIN_ROLES = [ROLE_ADMIN, ROLE_CHURCH_ADMIN, ROLE_SUPER_ADMIN] as const;

/**
 * The role a provisioning path assigns the account it just built a tenant for.
 *
 * 🔴 THE SINGLE WRITER'S VALUE. Free, Dodo and Stripe all import this rather
 * than spelling a literal, so a fourth path physically cannot invent a fourth
 * value — it has nothing else to write.
 */
export const PROVISIONED_TENANT_OWNER_ROLE = ROLE_ADMIN;

/** Every role value the app recognises at all. */
export const ALL_ROLES = [ROLE_MEMBER, ROLE_STANDALONE_AI_USER, ...TENANT_ADMIN_ROLES] as const;

export type UserRole = (typeof ALL_ROLES)[number];

/** Does this role, on its own, identify a tenant admin? */
export function isTenantAdminRole(role: unknown): boolean {
  return (TENANT_ADMIN_ROLES as readonly string[]).includes(role as string);
}
