import { normalizeEmail } from '@/lib/donation-history';

/**
 * Email status lives ON the CRM contact (`contacts/{id}.emailStatus`). There
 * is no second list. A contact with no `emailStatus` has never opted in, so it
 * is `none` and is never emailed.
 */
export type EmailStatus = 'subscribed' | 'unsubscribed' | 'bounced' | 'complained' | 'none';

export const EMAIL_STATUS_FIELD = 'emailStatus' as const;
export const EMAIL_OPT_IN_AT_FIELD = 'emailOptInAt' as const;
export const EMAIL_OPT_IN_SOURCE_FIELD = 'emailOptInSource' as const;

export type EmailOptInSource = 'import' | 'signup' | 'form' | 'manual';

/** A CRM person, seen through the email list. Derived, never stored. */
export interface EmailContact {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: EmailStatus;
  readonly tags: readonly string[];
  /** CRM people kinds (Members, Donors) plus any `groups` the contact carries. */
  readonly groups: readonly string[];
  readonly source: string;
  readonly joinedAt: string;
}

export type AudienceFilterKind = 'has-tag' | 'no-tag' | 'member-of';

export interface AudienceFilter {
  readonly kind: AudienceFilterKind;
  readonly value: string;
}

export interface AudienceResult {
  readonly recipients: readonly EmailContact[];
  readonly skipped: {
    /** Unsubscribed, bounced or marked spam. Never emailed, whatever the filters say. */
    readonly suppressed: number;
    /** In the CRM but never opted in to email. Reported, not an error. */
    readonly notOptedIn: number;
  };
}

const SUPPRESSED: ReadonlySet<EmailStatus> = new Set(['unsubscribed', 'bounced', 'complained']);

export function isSuppressed(status: EmailStatus): boolean {
  return SUPPRESSED.has(status);
}

export function readEmailStatus(raw: unknown): EmailStatus {
  return raw === 'subscribed' || raw === 'unsubscribed' || raw === 'bounced' || raw === 'complained' ? raw : 'none';
}

function matches(contact: EmailContact, filter: AudienceFilter): boolean {
  const value = filter.value.trim().toLowerCase();
  if (!value) return true;
  if (filter.kind === 'has-tag') return contact.tags.some((t) => t.toLowerCase() === value);
  if (filter.kind === 'no-tag') return !contact.tags.some((t) => t.toLowerCase() === value);
  return contact.groups.some((g) => g.toLowerCase() === value);
}

/**
 * Who a broadcast reaches. Only `subscribed` contacts can be reached, and
 * filters only narrow that set. If one address sits on several CRM records and
 * ANY of them is suppressed, the address is suppressed: an unsubscribe is never
 * undone by a duplicate.
 */
export function resolveAudience(contacts: readonly EmailContact[], filters: readonly AudienceFilter[]): AudienceResult {
  const blocked = new Set<string>();
  for (const c of contacts) {
    if (isSuppressed(c.status)) blocked.add(normalizeEmail(c.email));
  }
  const seen = new Set<string>();
  const recipients: EmailContact[] = [];
  let suppressed = 0;
  let notOptedIn = 0;
  for (const contact of contacts) {
    const email = normalizeEmail(contact.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    if (blocked.has(email)) { suppressed += 1; continue; }
    if (contact.status !== 'subscribed') { notOptedIn += 1; continue; }
    if (filters.every((f) => matches(contact, f))) recipients.push({ ...contact, email });
  }
  return { recipients, skipped: { suppressed, notOptedIn } };
}
