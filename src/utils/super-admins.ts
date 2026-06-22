/**
 * Super admin emails — platform owners who get ALL features unlocked
 * regardless of their tenant's plan.
 *
 * These users are the Harvest platform owners, not regular tenants.
 * They must never be plan-gated.
 */
export const SUPER_ADMIN_EMAILS: string[] = [
  'bumbmatei@proton.me',
  'bumbmatei@zohomail.eu',
];

// Also check env var for runtime overrides (comma-separated)
const envEmails = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS;
if (envEmails) {
  const parsed = envEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const email of parsed) {
    if (!SUPER_ADMIN_EMAILS.includes(email)) {
      SUPER_ADMIN_EMAILS.push(email);
    }
  }
}

/**
 * Check if an email belongs to a super admin.
 */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}
