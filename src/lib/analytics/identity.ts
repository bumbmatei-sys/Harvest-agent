/**
 * THE-36 — who an event belongs to, and which church it counts towards.
 *
 * ─── 🔴 Identify by uid, never by email ──────────────────────────────────────
 *
 * PostHog's `distinct_id` is the primary key of a person profile: it is shown
 * on every event, it is searchable, and it is what an export contains. An email
 * address there is the identifier a donor would be recognised by, sitting in a
 * third-party product, permanently — `reset()` starts a new profile, it does
 * not delete the old one. So the id is the Firebase `uid`, which is opaque
 * outside this app's own Firestore.
 *
 * The email is still READ here, locally, to answer "is this a platform admin?"
 * — the same check `App.tsx` already makes with `isSuperAdminEmail`. Reading it
 * and sending it are different things; nothing below ever puts it in a
 * property.
 *
 * ─── ⚠️ The super-admin trap (the class that has produced ten bugs) ──────────
 *
 * `getTenantScope()` returns the tenant of the SUBDOMAIN you are on, for
 * everyone, super admin included — that is its whole point as a data boundary:
 * on `nations.theharvest.app` a super admin reads `nations`' data, and must.
 *
 * Reused as an analytics group, that same correctness becomes a reporting bug.
 * The platform owner opening five churches in a morning would be counted as an
 * active user of each — five churches' engagement numbers inflated by the
 * person who sells to them, and the number that looks best is the tenant most
 * likely to be in trouble.
 *
 * ⚠️ `isPlatformContext()` / `hasPlatformOverride()` do NOT solve this: both
 * return FALSE for a super admin on a tenant subdomain, by design, because they
 * answer "should this user be plan-gated as this tenant?". The question here is
 * a different one — "whose usage is this?" — and it is answered by the account,
 * never by the host. So this module asks `isSuperAdminEmail` directly.
 *
 * The result: a platform admin is identified (their uid, so their own usage is
 * visible) and belongs to NO tenant group, carrying `account_kind:
 * 'platform_admin'` so they can be excluded from any product metric with one
 * filter. Nobody else's numbers move.
 */

import { isSuperAdminEmail } from '../../utils/super-admins';
import { getTenantScope } from '../../utils/tenant-scope';

/** The account kinds analytics distinguishes. Not a role — a filter. */
export const ACCOUNT_KIND_PLATFORM_ADMIN = 'platform_admin';
export const ACCOUNT_KIND_TENANT_USER = 'tenant_user';

export type AccountKind =
  | typeof ACCOUNT_KIND_PLATFORM_ADMIN
  | typeof ACCOUNT_KIND_TENANT_USER;

/** The minimum of a Firebase user this module needs. Keeps it testable. */
export interface AnalyticsUser {
  uid: string;
  email: string | null;
}

export interface AnalyticsIdentity {
  /** 🔴 The Firebase uid. Never an email address. */
  distinctId: string;
  /**
   * The tenant slug this session's usage counts towards, or `null` when it must
   * count towards nobody — a platform admin, or a signed-in user whose tenant
   * cannot be resolved. `null` means "do not call posthog.group()", not
   * "group under null".
   */
  tenantGroupKey: string | null;
  /** Person properties. Closed vocabulary — see ALLOWED_PERSON_PROPERTY_KEYS. */
  personProperties: { account_kind: AccountKind };
  /** True when the tenant group must be actively cleared, not merely skipped. */
  isPlatformAdmin: boolean;
}

/**
 * Resolve the identity for a signed-in user.
 *
 * Returns `null` for a signed-out session: there is nobody to identify, and an
 * anonymous visitor stays anonymous (`person_profiles: 'identified_only'`).
 */
export async function resolveAnalyticsIdentity(
  user: AnalyticsUser | null,
): Promise<AnalyticsIdentity | null> {
  if (!user?.uid) return null;

  const isPlatformAdmin = isSuperAdminEmail(user.email);

  // 🔴 The trap, closed. getTenantScope() is not even CALLED for a platform
  // admin: it would answer with whichever church they are currently looking at,
  // and an accidental use of that answer downstream is the bug this module
  // exists to prevent. No call, no value, nothing to misuse.
  const tenantGroupKey = isPlatformAdmin ? null : await getTenantScope();

  return {
    distinctId: user.uid,
    tenantGroupKey,
    personProperties: {
      account_kind: isPlatformAdmin ? ACCOUNT_KIND_PLATFORM_ADMIN : ACCOUNT_KIND_TENANT_USER,
    },
    isPlatformAdmin,
  };
}

/**
 * The route family an event happened on — 'admin' or 'member'.
 *
 * Deliberately coarse. `$current_url` already carries the path (query stripped,
 * see config.ts); this exists so a metric can be split by surface without
 * grouping on a path that contains a document id. Pre-auth paths never reach
 * here — AnalyticsBridge does not capture on them at all.
 */
export function resolveAppSurface(pathname: string): 'admin' | 'member' {
  return pathname.toLowerCase().startsWith('/admin') ? 'admin' : 'member';
}
