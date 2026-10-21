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
 * undone by a duplicate. `suppressed` is the server's own opt-out record, which
 * outlives the CRM person it came from. Duplicates otherwise resolve toward the
 * person who opted in: a newer record that never did cannot hide an older one
 * that did, and a filter matches if any subscribed record of the address does.
 */
export function resolveAudience(
  contacts: readonly EmailContact[],
  filters: readonly AudienceFilter[],
  suppressed: ReadonlySet<string> = new Set(),
): AudienceResult {
  const byAddress = new Map<string, EmailContact[]>();
  for (const contact of contacts) {
    const email = normalizeEmail(contact.email);
    if (!email) continue;
    byAddress.set(email, [...(byAddress.get(email) ?? []), contact]);
  }
  const recipients: EmailContact[] = [];
  let suppressedCount = 0;
  let notOptedIn = 0;
  for (const [email, records] of byAddress) {
    if (suppressed.has(email) || records.some((c) => isSuppressed(c.status))) { suppressedCount += 1; continue; }
    const optedIn = records.filter((c) => c.status === 'subscribed');
    if (optedIn.length === 0) { notOptedIn += 1; continue; }
    const hit = optedIn.find((c) => filters.every((f) => matches(c, f)));
    if (hit) recipients.push({ ...hit, email });
  }
  return { recipients, skipped: { suppressed: suppressedCount, notOptedIn } };
}
