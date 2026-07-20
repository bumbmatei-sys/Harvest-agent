import { useQuery } from '@tanstack/react-query';
import { collection, query, where, getDocs, getDoc, doc, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import type { DateLike } from '../../utils/format-date';
import { sortByString, sortByTime } from '../../utils/query-helpers';
import { PLATFORM_TENANT_ID, getTenantScope } from '../../utils/tenant-scope';

/** CRM pipeline stages, from first contact through to deeply-invested leader. */
export type PipelineStage =
  | 'new'         // Just added / first contact
  | 'connected'   // Reached out, in conversation
  | 'active'      // Regular attender / member
  | 'giving'      // Active donor
  | 'champion';   // Deeply invested, volunteer, leader

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  type: 'donor' | 'member' | 'both';
  stage?: PipelineStage; // defaults to 'new' if missing
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  notes: string;
  /** Member contacts synced from a user account carry their profile photo.
   *  Manually-added contacts have none and fall back to an initial. */
  photoURL?: string;
  /** DOLLARS. Written by the donation webhook and the CRM manual-add in the same
   *  unit; formatted directly by `fmt()` (no /100). See BUG 2 units fix. */
  totalDonated: number;
  // Date fields arrive in mixed shapes (Timestamp from client writes, ISO strings
  // from the donation webhook) — DateLike + toSafeDate keep formatting crash-proof.
  lastDonationAt: DateLike;
  memberSince: DateLike;
  createdAt: DateLike;
  createdBy: string;
  updatedAt: DateLike;
  tenantId?: string;
  /** Stable link to the person's `users` doc id, written by the donation webhook
   *  and manual-add. Used to fold a member's `users` row into their existing
   *  contact row so the same person never surfaces under two different ids. */
  userId?: string;
}

export interface ContactActivity {
  id: string;
  contactId: string;
  type: 'note' | 'donation' | 'email' | 'call' | 'meeting';
  description: string;
  /** DOLLARS for donation activities (webhook writes amount/100; manual-add writes
   *  the admin-typed dollar figure). Formatted directly by `fmt()`. See BUG 2. */
  amount: number | null;
  createdAt: DateLike;
  createdBy: string;
  tenantId?: string;
}

export const useContacts = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    queryKey: ['contacts', tenantId],
    queryFn: async (): Promise<Contact[]> => {
      let rows: Contact[];
      // This unscoped/legacy-merge branch is platform-context only: a tenant
      // subdomain passes its own tenantId (never PLATFORM_TENANT_ID), so it always
      // takes the scoped query below — no cross-tenant leakage on a subdomain.
      if (!tenantId || tenantId === PLATFORM_TENANT_ID) {
        // Platform / super-admin CRM. The platform's own contacts can carry
        // tenantId: 'harvest', null, '', OR no tenantId field at all (legacy rows
        // written before multi-tenancy). Firestore can't match a missing field and
        // an equality query can't union all those, so — as a super admin who may
        // read the whole collection — fetch and keep only the platform-owned rows,
        // dropping any that belong to a *named* tenant (no cross-tenant leakage).
        // NOTE: at larger scale, replace this scan with a one-time migration that
        // stamps every legacy/null contact with tenantId 'harvest'.
        const snap = await getDocs(query(collection(db, 'contacts'), limit(1000)));
        rows = snap.docs
          .map(d => ({ id: d.id, stage: 'new', ...d.data() }) as Contact)
          .filter(c => c.tenantId == null || c.tenantId === '' || c.tenantId === PLATFORM_TENANT_ID);
      } else {
        const snap = await getDocs(
          query(collection(db, 'contacts'), where('tenantId', '==', tenantId), limit(500))
        );
        rows = snap.docs.map(d => ({ id: d.id, stage: 'new', ...d.data() }) as Contact);
      }
      return sortByString(rows, 'lastName', 'asc');
    },
    enabled: isAuthReady && tenantId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

/** Turn an app `users` doc into a synthetic Member-type Contact for the CRM. */
const userDocToMemberContact = (
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
    stage: 'new',
    address: {
      city: u.city || undefined,
      country: u.country || undefined,
    },
    notes: '',
    tags: [],
    totalDonated,
    lastDonationAt: null,
    memberSince: null,
    createdAt: null,
    createdBy: id,
    updatedAt: null,
    tenantId: (u.tenantId ?? fallbackTenantId ?? PLATFORM_TENANT_ID) as string,
  };
};

/** Normalize an email for cross-collection matching: a missing value, casing, or
 *  stray surrounding whitespace must never split one person into two rows. */
const normEmail = (s: unknown): string => String(s ?? '').trim().toLowerCase();

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
 */
export const mergeContactsWithUsers = (
  contactRows: Contact[],
  userRows: Array<{ id: string; data: Record<string, any> }>,
  fallbackTenantId: string | null | undefined,
): Contact[] => {
  const linkedUserIds = new Set(
    contactRows.map(c => c.userId).filter(Boolean) as string[],
  );
  const seenEmails = new Set(
    contactRows.map(c => normEmail(c.email)).filter(Boolean),
  );
  const userMembers: Contact[] = [];
  for (const d of userRows) {
    if (linkedUserIds.has(d.id)) continue;        // already a contact (by userId link)
    const email = normEmail(d.data.email);
    if (email && seenEmails.has(email)) continue; // already a contact (by email)
    if (email) seenEmails.add(email);
    userMembers.push(userDocToMemberContact(d.id, d.data, fallbackTenantId));
  }
  return [...contactRows, ...userMembers];
};

/**
 * CRM contacts list that ALSO surfaces app members from the `users` collection.
 *
 * The CRM `contacts` collection only holds manually-added records, so a tenant's
 * actual app members (who sign up via the app and live in `users`) never appeared
 * in the CRM. This merges both: real contacts first, then every app user that
 * isn't already a contact (matched by email) as a Member-type row. Users are
 * scoped exactly like the Analytics tab (`getTenantScope`) so a platform super
 * admin sees every member — including legacy rows with a null/missing tenantId.
 */
export const useContactsWithUsers = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    // Shares the ['contacts', tenantId] prefix so existing invalidations refresh it.
    queryKey: ['contacts', tenantId, 'with-users'],
    queryFn: async (): Promise<Contact[]> => {
      // 1) Real CRM contacts (same scoping as useContacts).
      let contactRows: Contact[];
      if (!tenantId || tenantId === PLATFORM_TENANT_ID) {
        const snap = await getDocs(query(collection(db, 'contacts'), limit(1000)));
        contactRows = snap.docs
          .map(d => ({ id: d.id, stage: 'new', ...d.data() }) as Contact)
          .filter(c => c.tenantId == null || c.tenantId === '' || c.tenantId === PLATFORM_TENANT_ID);
      } else {
        const snap = await getDocs(
          query(collection(db, 'contacts'), where('tenantId', '==', tenantId), limit(500)),
        );
        contactRows = snap.docs.map(d => ({ id: d.id, stage: 'new', ...d.data() }) as Contact);
      }

      // 2) App members from `users`, scoped like the Analytics tab.
      let userDocs: Awaited<ReturnType<typeof getDocs>>['docs'] = [];
      try {
        const scope = await getTenantScope();
        const usersQ = scope
          ? query(collection(db, 'users'), where('tenantId', '==', scope), limit(1000))
          : query(collection(db, 'users'), limit(1000));
        userDocs = (await getDocs(usersQ)).docs;
      } catch (e) {
        console.error('[CRM] failed to load app members from users:', e);
      }

      // Merge, folding each app member into their existing contact so a person in
      // BOTH collections keeps ONE stable id (the contacts id). See the helper.
      const merged = mergeContactsWithUsers(
        contactRows,
        userDocs.map(d => ({ id: d.id, data: d.data() as Record<string, any> })),
        tenantId,
      );

      return sortByString(merged, 'lastName', 'asc');
    },
    enabled: isAuthReady && tenantId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

export const useContact = (tenantId: string | null | undefined, contactId: string | null | undefined) =>
  useQuery({
    queryKey: ['contact', tenantId, contactId],
    queryFn: async (): Promise<Contact | null> => {
      if (!contactId) return null;
      const snap = await getDoc(doc(db, 'contacts', contactId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as Contact;
    },
    enabled: !!contactId,
    staleTime: 1000 * 60 * 5,
  });

export const useContactActivities = (
  tenantId: string | null | undefined,
  contactId: string | null | undefined,
) =>
  useQuery({
    queryKey: ['contactActivities', tenantId, contactId],
    queryFn: async (): Promise<ContactActivity[]> => {
      if (!contactId) return [];
      const q = query(
        collection(db, 'contactActivities'),
        where('contactId', '==', contactId),
        limit(200),
      );
      const snap = await getDocs(q);
      let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ContactActivity);
      if (tenantId) rows = rows.filter(r => r.tenantId === tenantId);
      return sortByTime(rows, 'createdAt', 'desc');
    },
    enabled: !!contactId,
    staleTime: 1000 * 60 * 2,
  });

export const useContactOnboardingAnswers = (email: string | null | undefined) =>
  useQuery({
    queryKey: ['contactOnboardingAnswers', email],
    queryFn: async (): Promise<Record<string, string> | null> => {
      if (!email) return null;
      const q = query(collection(db, 'users'), where('email', '==', email), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      return (snap.docs[0].data().onboardingAnswers as Record<string, string>) ?? null;
    },
    enabled: !!email,
    staleTime: 1000 * 60 * 10,
  });
