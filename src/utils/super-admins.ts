/**
 * Super admin emails — platform owners who get ALL features unlocked
 * regardless of their tenant's plan.
 *
 * These users are the Harvest platform owners, not regular tenants.
 * They must never be plan-gated.
 *
 * This is the SINGLE SOURCE OF TRUTH for the super-admin email list. It is
 * imported by both client components and server modules (`src/lib/api-auth.ts`,
 * `src/lib/set-custom-claims.ts`, `src/app/api/auth/migrate-claims`), and it must
 * stay identical to the literal list in `firestore.rules`' isSuperAdmin() and in
 * `functions/src/index.ts` (a separate package that cannot import from `src/`).
 *
 * The list is frozen deliberately. It used to be a mutable array that a
 * `NEXT_PUBLIC_SUPER_ADMIN_EMAILS` env var pushed onto at import time, which meant
 * the set of super admins could differ between the client bundle, the API routes
 * and the Firestore rules. Freezing it keeps every surface in agreement and keeps
 * `tenant-scope.ts`'s positional `SUPER_ADMIN_EMAILS[0]` read stable.
 */
export const SUPER_ADMIN_EMAILS: readonly string[] = Object.freeze([
  'bumbmatei@proton.me',
  'bumbmatei@zohomail.eu',
]);

/**
 * Check if an email belongs to a super admin.
 */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}
