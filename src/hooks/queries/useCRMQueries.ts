import { useQuery } from '@tanstack/react-query';
import {
  collection, query, where, getDocs, getDoc, doc, limit, getCountFromServer,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { DateLike } from '../../utils/format-date';
import { sortByString } from '../../utils/query-helpers';
import { PLATFORM_TENANT_ID, getTenantScope, isSuperAdmin } from '../../utils/tenant-scope';
import { authFetch } from '../../utils/auth-fetch';
import { captureHandledError } from '../../lib/money-path-sentry';

/**
 * CRM pipeline stages — DERIVED from giving, never stored.
 *
 * The five previous stages ('new' / 'connected' / 'active' / 'giving' /
 * 'champion') were all set by an admin clicking a button: no donation, check-in
 * or registration path ever wrote one. So a contact who had given $10,000 sat in
 * "New" forever unless somebody remembered to move them, and the Champions stat
 * on the dashboard counted button presses rather than donors.
 *
 * 'new', 'connected' and 'active' are gone because nothing in the app produces a
 * signal for them — they could only ever be manual. The three that remain are a
 * pure function of `totalDonated`, which the donation webhook and the CRM's own
 * manual donation-activity add both already maintain.
 */
export type PipelineStage =
  | 'member'      // No donations recorded
  | 'giving'      // Has given anything at all
  | 'champion';   // Has given at or above CHAMPION_THRESHOLD_DOLLARS

/**
 * DOLLARS. `totalDonated` is stored in dollars everywhere (see the field doc on
 * `Contact` and the BUG 2 units fix) — Stripe's cent amounts are converted before
 * they ever reach it — so this threshold is $10,000, NOT 1,000,000 cents.
 */
export const CHAMPION_THRESHOLD_DOLLARS = 10000;

/**
 * The ONE place a pipeline stage is decided. Every badge, column, chip and metric
 * calls this; nothing compares `totalDonated` to a threshold inline, and nothing
 * reads a stored `stage` field.
 *
 * Deriving rather than storing is deliberate: a stored stage is a second copy of
 * a fact `totalDonated` already holds, and duplicated facts drift. It also means
 * no backfill — a contact document whose legacy `stage` still says 'champion'
 * with nothing given renders as Member the moment this ships.
 *
 * Missing / null / NaN totals mean "no donations recorded", which is Member.
 */
export const resolvePipelineStage = (totalDonated?: number | null): PipelineStage => {
  const given = Number(totalDonated);
  if (!Number.isFinite(given) || given <= 0) return 'member';
  // >= , not > : exactly $10,000 IS a champion.
  return given >= CHAMPION_THRESHOLD_DOLLARS ? 'champion' : 'giving';
};

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  type: 'donor' | 'member' | 'both';
  // NOTE: there is deliberately no `stage` field. The pipeline stage is derived
  // from `totalDonated` by resolvePipelineStage() at read time. Legacy documents
  // may still carry a stored `stage` string; it is ignored, never written, and
  // must not be re-added here — see the PipelineStage doc above.
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  notes: string;
  /** Free-form labels shown as chips on the contact card and round-tripped by
   *  the edit form. Optional: contacts created before tagging have no field,
   *  which is why every read site guards with `tags && tags.length`. */
  tags?: string[];
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
  /**
   * DERIVED, never stored. Set by `mergeContactsWithUsers` on every row backed
   * by a `users` document — both users-only members and `contacts` rows that
   * folded one in — and left undefined on donor-only rows (someone who gave via
   * the public donate page and never signed up).
   *
   * So `account !== undefined` IS "this person holds an account", which is what
   * the `maxContacts` cap prices (src/utils/contact-capacity.ts): the cap counts
   * accounts, donors are visible and free. It carries the two `users` fields the
   * cap needs and nothing else — `role` and `email` are both legs of the
   * super-admin exemption, and the `users` email is the authoritative one (a
   * folded `contacts` row may differ from it by casing or whitespace).
   *
   * NOT part of any write payload. AdminCRM's save builds its document from the
   * form fields explicitly, so this never reaches Firestore.
   */
  account?: { role: string; email: string };
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

/**
 * Thrown when the CRM is asked to read contacts with no tenant in context and no
 * super-admin standing to justify a platform-wide scan. Named so the UI (and the
 * tests) can tell "we could not work out who you are" apart from a Firestore
 * failure.
 */
export const NO_TENANT_SCOPE_MESSAGE =
  'Could not determine which church to load contacts for. Reload the page, and if this keeps happening sign out and back in.';

/**
 * How many documents the CRM loads from EACH of the two collections it merges
 * (`contacts` and `users`).
 *
 * ONE constant for both collections and both scoping paths, because the numbers
 * it replaces were not only low but INVERTED: the scoped tenant read stopped at
 * 500 while the unscoped super-admin read stopped at 1,000, so a church's own
 * admin saw LESS of their church than a platform operator did. A single ceiling
 * makes that class of drift impossible to reintroduce silently.
 *
 * Why a ceiling at all, and why this number. Firestore bills per document read
 * and this list opens on every CRM visit, so an uncapped read is an uncapped
 * bill. 1,000 per collection puts the worst case at ~2,000 document reads per
 * cold open (plus 2 aggregation reads for the counts below), which is the read
 * budget this list is allowed. React Query's 5-minute `staleTime` means repeat
 * opens inside that window cost nothing.
 *
 * This ceiling is NOT the fix for truncation on its own — it is the fix for the
 * inversion, plus a doubling of the tenant path. What makes the remaining
 * truncation survivable is that it is now VISIBLE: `useCRMCounts` reports the
 * true totals via a server-side aggregate, and the CRM says so on screen when
 * the loaded list is short of them. Silent truncation is the bug; a ceiling the
 * admin can SEE is a limit.
 *
 * Raising this further is not free and not correct on its own — see the
 * `useCRMCounts` doc for why real pagination needs a data-model change first.
 */
export const CRM_FETCH_LIMIT = 1000;

/**
 * Fetch the CRM `contacts` rows for the caller, applying the tenant scoping that
 * BOTH contact hooks share.
 *
 * Extracted into one module-local helper (the #192 shared-leaf-module precedent)
 * because the two hooks previously carried this branch verbatim and could drift.
 *
 * The unscoped scan is gated on ACTUAL super-admin standing, not on a `tenantId`
 * proxy. That distinction is the whole bug: `tenantId` arrives null both for a
 * super admin on the apex domain (for whom the scan is correct) and for a tenant
 * admin whose tenant never resolved (for whom it is a guaranteed
 * permission-denied). Firestore rules gate `contacts` reads on
 * `isTenantAdmin(resource.data.tenantId)`, and rules are not filters: a list
 * query that constrains nothing about `resource.data.tenantId` proves nothing,
 * so the WHOLE query is rejected. That rejection then rendered as "this church
 * has no contacts" — the same shape that hid the empty activity timeline for
 * weeks (#236).
 *
 * So there are exactly three outcomes, and a tenant admin can no longer fall
 * into the first:
 *   1. genuine super admin, no (or platform) tenant → unscoped platform scan
 *   2. any real tenant id                           → scoped query, unchanged
 *   3. no tenant and no super-admin standing        → THROW; this is a fault,
 *      not an empty state, and must reach react-query so the UI can say so
 *
 * `isSuperAdmin()` reads `auth.currentUser`, which is safe here: both hooks are
 * `enabled` only once `isAuthReady` is true, i.e. after `onAuthStateChanged` has
 * fired. The same assumption already backs `getTenantScope()` below and
 * `getWriteTenantScope()` in tenant-scope.ts.
 */
const fetchContactRows = async (tenantId: string | null | undefined): Promise<Contact[]> => {
  if ((!tenantId || tenantId === PLATFORM_TENANT_ID) && isSuperAdmin()) {
    // Platform / super-admin CRM. The platform's own contacts can carry
    // tenantId: 'harvest', null, '', OR no tenantId field at all (legacy rows
    // written before multi-tenancy). Firestore can't match a missing field and
    // an equality query can't union all those, so — as a super admin who may
    // read the whole collection — fetch and keep only the platform-owned rows,
    // dropping any that belong to a *named* tenant (no cross-tenant leakage).
    // NOTE: at larger scale, replace this scan with a one-time migration that
    // stamps every legacy/null contact with tenantId 'harvest'.
    const snap = await getDocs(query(collection(db, 'contacts'), limit(CRM_FETCH_LIMIT)));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }) as Contact)
      .filter(c => c.tenantId == null || c.tenantId === '' || c.tenantId === PLATFORM_TENANT_ID);
  }

  // Not a super admin and no tenant to scope by. Falling through to the scan
  // would be rejected wholesale; returning [] would report that rejection as an
  // empty CRM. Neither. Fail loudly.
  if (!tenantId) throw new Error(NO_TENANT_SCOPE_MESSAGE);

  // Scoped read. Note a non-super-admin whose tenant genuinely IS the platform
  // tenant lands here rather than on the scan: the equality constraint is what
  // the rule needs, and it is the only query they are allowed to run.
  const snap = await getDocs(
    query(collection(db, 'contacts'), where('tenantId', '==', tenantId), limit(CRM_FETCH_LIMIT)),
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Contact);
};

export const useContacts = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    queryKey: ['contacts', tenantId],
    queryFn: async (): Promise<Contact[]> =>
      sortByString(await fetchContactRows(tenantId), 'lastName', 'asc'),
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
    account: accountOf(u),
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
 * `account` (the folded `users` doc's role + email). That flag is the only way a
 * consumer can tell "this person holds an account" from "this person only ever
 * gave money", which the `maxContacts` cap depends on — see `Contact.account`
 * and src/utils/contact-capacity.ts. Contact rows are COPIED rather than
 * mutated so stamping it never writes through to react-query's cached array.
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
      // 1) Real CRM contacts — the shared, super-admin-gated scoping helper.
      const contactRows = await fetchContactRows(tenantId);

      // 2) App members from `users`, scoped like the Analytics tab.
      //
      // NOT swallowed. This used to `catch { console.error }` and leave `userDocs`
      // empty, so a rejected or failed members read produced a merged list that
      // was simply SHORTER — indistinguishable from a church whose members happen
      // not to be in the app. An admin cannot see that half their people are
      // missing, which is the same silent-truncation class as the empty timeline
      // (#236). A partial list is worse than a visible error: let it through to
      // react-query.
      let userDocs: Awaited<ReturnType<typeof getDocs>>['docs'];
      try {
        const scope = await getTenantScope();
        const usersQ = scope
          ? query(collection(db, 'users'), where('tenantId', '==', scope), limit(CRM_FETCH_LIMIT))
          : query(collection(db, 'users'), limit(CRM_FETCH_LIMIT));
        userDocs = (await getDocs(usersQ)).docs;
      } catch (e) {
        console.error('[CRM] failed to load app members from users:', e);
        throw e;
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

/**
 * The TRUE size of the two collections behind the CRM list, counted server-side.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `contacts.length` from the merged list cannot answer "how many people are
 * there", because that array stops at CRM_FETCH_LIMIT per collection. Taking a
 * total from it reports the ceiling as the answer — which is how the list came
 * to end silently at 500. `getCountFromServer()` runs an aggregation in
 * Firestore and returns a number WITHOUT loading the documents: it bills one
 * read per 1,000 index entries matched, so counting a 2,000-contact church
 * costs 2 reads rather than 2,000. That is what makes an honest total
 * affordable on every CRM open, and it is the figure the `maxContacts` cap will
 * consume (`memberAccounts` — the cap counts `users` docs only).
 *
 * ── The two numbers are reported SEPARATELY, and that is deliberate ───────────
 * Do NOT add them together and call the sum "people". The list is a MERGE:
 * `mergeContactsWithUsers` folds a person who has both a `contacts` row and a
 * `users` row into ONE row. So the true head-count is somewhere between
 * max(contactRecords, memberAccounts) and their sum, and nothing short of
 * loading both collections can say where — the overlap is only discoverable by
 * comparing `userId` links and emails document by document. Presenting the sum
 * as a head-count would replace an undercount with an overcount. Each number is
 * exact about its own collection; the UI states them as such.
 *
 * ── Truncation is DERIVED from the counts, not plumbed through the list ───────
 * `contactsTruncated` / `usersTruncated` are `count > CRM_FETCH_LIMIT`, which is
 * exactly equivalent to "that read stopped at the ceiling": both the list read
 * and the count run the same scoping constraint, so if more documents match
 * than the ceiling allows, the list read hit it. Deriving it here keeps
 * `useContactsWithUsers` returning a plain `Contact[]` — no consumer has to
 * change shape to learn that its data is partial.
 *
 * ── Why this is not pagination, and what blocks pagination ───────────────────
 * Paginating the merged list is not implementable against the CURRENT data
 * model, for two independent reasons:
 *
 *   1. DEDUPLICATION NEEDS THE WHOLE `contacts` SET. A `users` row is folded in
 *      when some contact matches it on `contact.userId` or on email. To know a
 *      `users` row is NOT a duplicate you must have seen EVERY contact. Load
 *      contacts a page at a time and a member whose contact row sits on an
 *      unloaded page surfaces a second time under their `users` id — with an
 *      empty timeline, because activities are keyed to the contact id. That is
 *      precisely the dual-id bug `mergeContactsWithUsers` was written to fix.
 *
 *   2. THE TWO COLLECTIONS HAVE NO COMMON SORT KEY. The list is ordered by
 *      `lastName`, which only `contacts` stores; `users` carries a single
 *      `displayName` that is split into first/last at read time. Firestore
 *      cannot order `users` by a field the documents do not have (and would
 *      drop every such document from an `orderBy('lastName')` result), so
 *      "page N of the merged list, sorted by last name" is not expressible as a
 *      pair of server queries.
 *
 * Fixing either one is a data-model change — a `lastName` (or a `contactId`
 * back-link) written onto every `users` doc, plus a backfill and a write-path
 * change — not a query change. Until then the honest move is the one taken
 * here: load a bounded prefix, merge it whole so deduplication still holds
 * across everything loaded, and TELL the admin the total they are not seeing.
 */
export interface CRMCounts {
  /** Exact number of `contacts` documents in scope. */
  contactRecords: number;
  /**
   * Exact number of `users` documents in scope — people with an app account.
   * This is the figure the `maxContacts` cap consumes: the cap counts accounts,
   * and donors who exist only in `contacts` stay visible but uncounted.
   */
  memberAccounts: number;
  /**
   * True on the unscoped super-admin path, where `contactRecords` counts EVERY
   * church's contacts. The list itself shows only platform-owned rows (the scan
   * filters them client-side), so on this path the count is an upper bound on
   * what is displayed, not a target it should reach. The UI must label it.
   */
  platformWide: boolean;
  /** More `contacts` documents match than the list read can load. */
  contactsTruncated: boolean;
  /** More `users` documents match than the list read can load. */
  usersTruncated: boolean;
}

/** Run an aggregation and unwrap the count. */
const countOf = async (q: ReturnType<typeof query>): Promise<number> =>
  (await getCountFromServer(q)).data().count;

/**
 * Scoped exactly like the two list reads it describes — `contacts` by the
 * caller's tenant (or unscoped for a super admin on the apex), `users` by
 * `getTenantScope()`. If the scoping ever drifts apart from `fetchContactRows`
 * and the members query, the counts stop describing the list.
 */
const fetchCRMCounts = async (tenantId: string | null | undefined): Promise<CRMCounts> => {
  const platformWide = (!tenantId || tenantId === PLATFORM_TENANT_ID) && isSuperAdmin();

  // Same fault as the list read: no tenant and no super-admin standing is a
  // fault, not a zero. Reporting 0 here would render as "this church has no
  // contacts" on a screen whose entire job is to stop saying that.
  if (!platformWide && !tenantId) throw new Error(NO_TENANT_SCOPE_MESSAGE);

  const contactsQ = platformWide
    ? query(collection(db, 'contacts'))
    : query(collection(db, 'contacts'), where('tenantId', '==', tenantId));

  const scope = await getTenantScope();
  const usersQ = scope
    ? query(collection(db, 'users'), where('tenantId', '==', scope))
    : query(collection(db, 'users'));

  const [contactRecords, memberAccounts] = await Promise.all([
    countOf(contactsQ),
    countOf(usersQ),
  ]);

  return {
    contactRecords,
    memberAccounts,
    platformWide,
    contactsTruncated: contactRecords > CRM_FETCH_LIMIT,
    usersTruncated: memberAccounts > CRM_FETCH_LIMIT,
  };
};

export const useCRMCounts = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    queryKey: ['crmCounts', tenantId],
    queryFn: (): Promise<CRMCounts> => fetchCRMCounts(tenantId),
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

/**
 * Contact timeline. Reads go through /api/crm/contact-activities (Admin SDK),
 * NOT Firestore directly.
 *
 * The obvious client query — `where('contactId','==',id)` plus an in-memory
 * tenant filter, the house single-field pattern — is rejected outright by the
 * top-level `contactActivities` rule, which gates reads on
 * `isTenantAdmin(resource.data.tenantId)`. Rules are not filters: for a `list`
 * Firestore evaluates the rule against the query's POTENTIAL result set, and a
 * query that constrains only `contactId` proves nothing about
 * `resource.data.tenantId`, so the whole query fails with permission-denied.
 * The timeline was empty for weeks because that rejection was indistinguishable
 * from "no activities". See tests/rules/crm-activities.rules.test.ts.
 *
 * `tenantId` is kept in the query KEY only — the route resolves the real tenant
 * from the caller's token, never from the client. Failures are NOT swallowed:
 * this throws so React Query reports `isError` and the UI can say so.
 */
export const useContactActivities = (
  tenantId: string | null | undefined,
  contactId: string | null | undefined,
) =>
  useQuery({
    queryKey: ['contactActivities', tenantId, contactId],
    queryFn: async (): Promise<ContactActivity[]> => {
      if (!contactId) return [];
      try {
        const res = await authFetch(
          `/api/crm/contact-activities?contactId=${encodeURIComponent(contactId)}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(
            (body as { error?: string } | null)?.error || `Failed to load activities (${res.status})`,
          );
        }
        const body = (await res.json()) as { activities?: ContactActivity[] };
        return body.activities ?? [];
      } catch (e) {
        captureHandledError(e, {
          step: 'crm-contact-activities-load',
          tenantId,
          ids: { contactId },
        });
        throw e;
      }
    },
    enabled: !!contactId,
    staleTime: 1000 * 60 * 2,
  });
