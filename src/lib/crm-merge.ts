/**
 * Pure CRM merge. No Firebase client SDK — the admin export route imports
 * this from a server handler, and `useCRMQueries.ts` (which does import the
 * client SDK) re-exports the two names existing tests and guards look up.
 */
import type { DateLike } from '../utils/format-date';
import type { Contact } from '../hooks/queries/useCRMQueries';
import {
  NEWSLETTER_OPT_IN_AT_FIELD,
  NEWSLETTER_OPT_IN_FIELD,
  NEWSLETTER_OPT_IN_SOURCE_FIELD,
  type NewsletterAccountProfile,
} from './newsletter-consent';

/**
 * Same fallback `PLATFORM_TENANT_ID` uses in tenant-scope.ts. Inlined so this
 * module does not import the client Firebase SDK (tenant-scope.ts does). The
 * export route passes the real constant in as `fallbackTenantId`; this is
 * only the last resort inside the merge.
 */
const PLATFORM_TENANT_FALLBACK = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';

/**
 * ISO instant, or null when the value has no readable one.
 *
 * Accepts an ISO string, a Date, a Firestore client/admin Timestamp (`toDate()`),
 * and a `{seconds}` object. Anything else — including the legacy shapes this
 * helper does not name — is null, not a guessed epoch.
 */
export function isoTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (value && typeof value === 'object') {
    const stamp = value as { toDate?: () => Date; seconds?: unknown; nanoseconds?: unknown };
    if (typeof stamp.toDate === 'function') {
      const date = stamp.toDate();
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
      return date.toISOString();
    }
    if (typeof stamp.seconds === 'number' && Number.isFinite(stamp.seconds)) {
      const nanos = typeof stamp.nanoseconds === 'number' && Number.isFinite(stamp.nanoseconds)
        ? stamp.nanoseconds
        : 0;
      const date = new Date(stamp.seconds * 1000 + Math.floor(nanos / 1e6));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
  }
  return null;
}

/**
 * Consent and signup time off a `users` doc.
 *
 * The legacy `newsletter` boolean is deliberately not read. Sign-in used to
 * overwrite it with the default true, so it is not consent.
 */
function accountProfileOf(u: Record<string, any>): NewsletterAccountProfile {
  const optIn = u[NEWSLETTER_OPT_IN_FIELD];
  const source = u[NEWSLETTER_OPT_IN_SOURCE_FIELD];
  return {
    createdAt: isoTimestamp(u.createdAt),
    newsletterOptIn: optIn === true || optIn === false ? optIn : null,
    newsletterOptInAt: isoTimestamp(u[NEWSLETTER_OPT_IN_AT_FIELD]),
    newsletterOptInSource: typeof source === 'string' ? source : null,
  };
}

/** Turn an app `users` doc into a synthetic Member-type Contact for the CRM. */
export const userDocToMemberContact = (
  id: string,
  u: Record<string, any>,
  fallbackTenantId: string | null | undefined,
): Contact => {
  const fullName = String(u.displayName || u.name || '').trim();
  const parts = fullName ? fullName.split(/\s+/) : [];
  // A member who has donated (their users doc was stamped by the donation webhook)
  // surfaces here as Donor & Member with their real total — no duplicate contact row.
  const totalDonated = Number(u.totalDonated) || 0;
  return {
    id,
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
    email: u.email || '',
    phone: u.phone || '',
    photoURL: u.photoURL || undefined,
    type: totalDonated > 0 ? 'both' : 'member',
    address: {
      city: u.city || undefined,
      country: u.country || undefined,
    },
    notes: '',
    tags: [],
    totalDonated,
    // Carried THROUGH from the users doc, not hardcoded to null (THE-149). The
    // donation webhook stamps `lastDonationAt` on the donor's `users` document in
    // the same write that increments `totalDonated` there (linkDonationToCRM), so
    // dropping it here handed the CRM a row whose total said "$100 given" and
    // whose date said "never" — the same fact, split, with one half thrown away
    // on read. `DateLike` already covers the webhook's ISO string, and every
    // reader goes through toSafeDate, so no shape conversion belongs here.
    lastDonationAt: (u.lastDonationAt ?? null) as DateLike,
    memberSince: null,
    createdAt: null,
    createdBy: id,
    updatedAt: null,
    tenantId: (u.tenantId ?? fallbackTenantId ?? PLATFORM_TENANT_FALLBACK) as string,
    account: accountOf(u),
    accountProfile: accountProfileOf(u),
    // THE-362 — stamped HERE and nowhere else, so it is true exactly when
    // this row was built from a `users` doc with no contact behind it. See
    // `Contact.accountOnly`.
    accountOnly: true,
  };
};

/** Normalize an email for cross-collection matching: a missing value, casing, or
 *  stray surrounding whitespace must never split one person into two rows. */
const normEmail = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/** The two `users` fields the `maxContacts` cap needs — see `Contact.account`. */
const accountOf = (u: Record<string, any>): { role: string; email: string } => ({
  role: String(u.role ?? ''),
  email: String(u.email ?? ''),
});

/**
 * Merge CRM `contacts` rows with app `users` rows into ONE contact list, keeping
 * each person's id STABLE.
 *
 * A person who exists in BOTH collections must surface as a single row carrying
 * the `contacts` doc id — never the `users` doc id. This is the fix for the
 * dual-id bug: contact activities are keyed by whichever id is selected at write
 * time (manual CRM add) and by the id the donation webhook resolves to (the
 * contact id when a contact exists). If the same person could surface under two
 * ids, activities keyed to one become invisible when the other is selected.
 *
 * A `users` row is folded into an existing contact (i.e. dropped from the member
 * list) when it matches a contact on EITHER:
 *   1. the contact's `userId` link (`contact.userId === users doc id`) — stable
 *      across email changes and immune to casing/whitespace, or
 *   2. the normalized (trim + lowercase) email — a fallback for contacts written
 *      before the `userId` link was populated.
 * The previous email-only, lowercase-but-not-trimmed match missed people whose
 * two docs differed by surrounding whitespace or the `userId` link, which is how
 * a member ended up surfaced under their `users` id with an empty timeline.
 *
 * `users`-only members (no matching contact) are still surfaced, keyed by their
 * `users` id — the same id the webhook writes their activities under.
 *
 * A folded row keeps its `contacts` id and its `contacts` fields, but GAINS
 * `account` (the folded `users` doc's role + email) and `accountProfile`
 * (signup time and newsletter consent, normalised from that same users doc).
 * That flag is the only way a consumer can tell "this person holds an account"
 * from "this person only ever gave money", which the `maxContacts` cap depends
 * on — see `Contact.account` and src/utils/contact-capacity.ts. Contact rows
 * are COPIED rather than mutated so stamping it never writes through to
 * react-query's cached array.
 */
export const mergeContactsWithUsers = (
  contactRows: Contact[],
  userRows: Array<{ id: string; data: Record<string, any> }>,
  fallbackTenantId: string | null | undefined,
): Contact[] => {
  const merged: Contact[] = contactRows.map(c => ({ ...c }));
  // Both fold indexes point AT the row, not at a bare id, so a match can stamp
  // `account` on it. Same two keys and the same precedence as before: the
  // `userId` link first, normalized email as the legacy fallback.
  const byLinkedUserId = new Map<string, Contact>();
  const byEmail = new Map<string, Contact>();
  for (const c of merged) {
    if (c.userId) byLinkedUserId.set(c.userId, c);
    const email = normEmail(c.email);
    // First writer wins, matching the old Set-based membership test: two contact
    // rows sharing an email fold the same single users doc into the first.
    if (email && !byEmail.has(email)) byEmail.set(email, c);
  }
  const userMembers: Contact[] = [];
  for (const d of userRows) {
    const email = normEmail(d.data.email);
    const linked = byLinkedUserId.get(d.id) ?? (email ? byEmail.get(email) : undefined);
    if (linked) {                                 // already a contact (userId link, then email)
      linked.account = accountOf(d.data);
      linked.accountProfile = accountProfileOf(d.data);
      continue;
    }
    const row = userDocToMemberContact(d.id, d.data, fallbackTenantId);
    // Seed the email index with the surfaced member so a SECOND users doc
    // sharing this email dedupes against it, exactly as `seenEmails` did.
    if (email) byEmail.set(email, row);
    userMembers.push(row);
  }
  return [...merged, ...userMembers];
};
