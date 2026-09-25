/**
 * Platform newsletter consent, spelled once.
 *
 * Written only when an account is created from a screen that showed the
 * switch (`signup-email` or `signup-google`). Never read the legacy
 * `newsletter` boolean as consent: sign-in used to overwrite it with the
 * default `true`, so a stored `true` proves nothing.
 *
 * This module imports no Firebase SDK. The client passes `serverTimestamp()`
 * in; the server and the CRM only read the resulting shape.
 */

export const NEWSLETTER_OPT_IN_FIELD = 'newsletterOptIn' as const;
export const NEWSLETTER_OPT_IN_AT_FIELD = 'newsletterOptInAt' as const;
export const NEWSLETTER_OPT_IN_SOURCE_FIELD = 'newsletterOptInSource' as const;

export const SIGNUP_EMAIL_SOURCE = 'signup-email' as const;
export const SIGNUP_GOOGLE_SOURCE = 'signup-google' as const;

export const NEWSLETTER_OPT_IN_SOURCES = [SIGNUP_EMAIL_SOURCE, SIGNUP_GOOGLE_SOURCE] as const;
export type NewsletterOptInSource = (typeof NEWSLETTER_OPT_IN_SOURCES)[number];

export const NEWSLETTER_FILTERS = ['all', 'in', 'out', 'unknown'] as const;
export type NewsletterFilter = (typeof NEWSLETTER_FILTERS)[number];

/** Derived consent carried on a CRM row. Never stored, never written back. */
export interface NewsletterAccountProfile {
  /**
   * The ACCOUNT's church: `tenantId` on the users doc. A contact row that folded
   * a users doc keeps the contact's own `tenantId` (a platform contact says
   * `harvest`), so the founder export reads the person's church from here.
   */
  tenantId: string | null;
  createdAt: string | null;
  /** `null` when the users doc has no boolean — the CRM shows that as Unknown. */
  newsletterOptIn: boolean | null;
  newsletterOptInAt: string | null;
  newsletterOptInSource: string | null;
}

export function isNewsletterFilter(value: string | null): value is NewsletterFilter {
  return value === 'all' || value === 'in' || value === 'out' || value === 'unknown';
}

/**
 * The three fields written on an account-create. `at` is the caller's
 * `serverTimestamp()` sentinel — this module does not import the client SDK.
 */
export function newsletterConsentFields(
  optIn: boolean,
  source: NewsletterOptInSource,
  at: unknown,
): Record<string, unknown> {
  return {
    [NEWSLETTER_OPT_IN_FIELD]: optIn,
    [NEWSLETTER_OPT_IN_AT_FIELD]: at,
    [NEWSLETTER_OPT_IN_SOURCE_FIELD]: source,
  };
}

/**
 * Consent for one CRM row.
 *
 * `null` means there is no account (a donor-only contact). Those rows match
 * the All filter and none of the other three. Opted in / out / unknown are
 * read only from `account` + `accountProfile`. A `newsletter` or
 * `newsletterOptIn` field sitting on the contacts document itself is ignored.
 */
export function newsletterStatusOf(contact: {
  account?: unknown;
  accountProfile?: { newsletterOptIn?: boolean | null } | null;
}): 'in' | 'out' | 'unknown' | null {
  if (contact.account == null) return null;
  const value = contact.accountProfile?.newsletterOptIn;
  if (value === true) return 'in';
  if (value === false) return 'out';
  return 'unknown';
}
