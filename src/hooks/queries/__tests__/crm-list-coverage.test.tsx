import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * THE-67 — the CRM list silently truncates.
 *
 * The bug: the merged CRM list stopped at `limit(500)` on the scoped tenant path
 * and `limit(1000)` on the unscoped super-admin path, with nothing on screen to
 * say so. Past those limits people were simply absent — no warning, no total, no
 * pagination — so a truncated list and a complete one rendered identically. The
 * Ministry tier sells an allowance of 2,000 contacts, so the tier could not
 * display what it sells; and because the SCOPED limit was the lower of the two,
 * a church's own admin saw less of their church than a platform operator did.
 *
 * The contract now:
 *   1. ONE ceiling (CRM_FETCH_LIMIT) for both collections and both scoping
 *      paths, so the scoped path can never load less than the unscoped one.
 *   2. The TRUE totals come from `getCountFromServer()` — a server-side
 *      aggregate that does not load the documents — so the number the CRM
 *      reports is correct above the old ceilings, not clamped to them.
 *   3. The merge still sees every loaded row at once, so deduplication holds
 *      across the whole list rather than within a page.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockGetDocs, mockGetCount, mockIsSuperAdminEmail, authState } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockGetCount: vi.fn(),
  mockIsSuperAdminEmail: vi.fn(),
  authState: { currentUser: null as { uid: string; email: string } | null },
}));

/** Every query built, so a test can assert WHICH query ran, not just its result. */
// THE-342 added `orderBy(documentId())` to every read here: an unordered
// limit(N) is served in `__name__` order over random ids, so the window was an
// arbitrary and unstable N. The built query records the ordering so a test can
// assert it rather than merely tolerate it.
type BuiltQuery = {
  collection: string;
  whereClauses: Array<[string, string, unknown]>;
  limit: number | null;
  orderBy: string | null;
};
const built: BuiltQuery[] = [];

vi.mock('../../../firebase', () => ({
  db: {},
  get auth() { return authState; },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  where: (field: string, op: string, value: unknown) => ({ __where: [field, op, value] as [string, string, unknown] }),
  limit: (n: number) => ({ __limit: n }),
  orderBy: (field: unknown) => ({ __orderBy: field }),
  documentId: () => '__name__',
  getDoc: vi.fn(async () => ({ exists: () => true, data: () => ({ tenantId: 'harvest' }) })),
  doc: vi.fn(),
  query: (base: { __collection: string }, ...constraints: Array<Record<string, unknown>>) => {
    const q: BuiltQuery = {
      collection: base.__collection,
      whereClauses: constraints.filter(c => '__where' in c).map(c => c.__where as [string, string, unknown]),
      limit: (constraints.find(c => '__limit' in c)?.__limit as number) ?? null,
      orderBy: (constraints.find(c => '__orderBy' in c)?.__orderBy as string) ?? null,
    };
    built.push(q);
    return q;
  },
  getDocs: mockGetDocs,
  getCountFromServer: mockGetCount,
}));

vi.mock('../../../utils/super-admins', () => ({
  isSuperAdminEmail: mockIsSuperAdminEmail,
  SUPER_ADMIN_EMAILS: ['super@theharvest.app'],
}));

const { useContactsWithUsers, useCRMCounts, mergeContactsWithUsers, CRM_FETCH_LIMIT } =
  await import('../useCRMQueries');
type Contact = import('../useCRMQueries').Contact;
const { clearTenantCache } = await import('../../../utils/tenant-scope');

/** A Firestore-shaped snapshot from plain rows. */
const snap = (rows: Array<Record<string, unknown> & { id: string }>) => ({
  docs: rows.map(({ id, ...data }) => ({ id, data: () => data })),
});

/** The aggregate shape `getCountFromServer` resolves to. */
const countSnap = (count: number) => ({ data: () => ({ count }) });

/** Generate `n` distinct contact rows, none of which match any users row. */
const manyContacts = (n: number, prefix = 'c') =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    firstName: 'Given',
    lastName: `Name${String(i).padStart(4, '0')}`,
    email: `${prefix}${i}@example.org`,
    tenantId: 'harvest',
  }));

/** A fully-shaped `contacts` row, for the direct merge unit tests below. */
const contactRow = (over: Partial<Contact> & { id: string }): Contact => ({
  firstName: 'A', lastName: 'Person', email: 'a@example.org', phone: '',
  type: 'member', notes: '', tags: [], totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: 'u1', updatedAt: null, tenantId: 'harvest',
  ...over,
});

const contactQueries = () => built.filter(q => q.collection === 'contacts');
const userQueries = () => built.filter(q => q.collection === 'users');
/** Reads carry a limit; count aggregations deliberately do not. */
const readQueries = () => built.filter(q => q.limit !== null);

let container: HTMLDivElement;
let root: Root;

async function renderHook<T>(useHook: () => T): Promise<{ current: T }> {
  const ref: { current: T } = { current: null as unknown as T };
  function Probe() {
    ref.current = useHook();
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return ref;
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function signInAs(kind: 'super' | 'tenant') {
  authState.currentUser = {
    uid: kind === 'super' ? 'super-uid' : 'pastor-uid',
    email: kind === 'super' ? 'super@theharvest.app' : 'pastor@nations.church',
  };
  mockIsSuperAdminEmail.mockImplementation((email?: string | null) => email === 'super@theharvest.app');
  clearTenantCache();
}

/** Resolve the contacts read to `contacts` and the users read to `users`. */
function resolveReads(contacts: Array<Record<string, unknown> & { id: string }>, users: Array<Record<string, unknown> & { id: string }> = []) {
  mockGetDocs.mockImplementation(async (q: BuiltQuery) =>
    q.collection === 'contacts' ? snap(contacts) : snap(users));
}

/** Resolve the two aggregations, in the order the hook issues them. */
function resolveCounts(contactRecords: number, memberAccounts: number) {
  mockGetCount.mockImplementation(async (q: BuiltQuery) =>
    countSnap(q.collection === 'contacts' ? contactRecords : memberAccounts));
}

beforeEach(() => {
  vi.clearAllMocks();
  built.length = 0;
  authState.currentUser = null;
  mockGetDocs.mockResolvedValue(snap([]));
  mockGetCount.mockResolvedValue(countSnap(0));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('THE-67 — CRM list coverage', () => {
  // ── 1 ──────────────────────────────────────────────────────────────────────
  describe('a tenant with more contacts than the old page', () => {
    it('reaches EVERY contact past the old 500 ceiling, and reports the true total', async () => {
      signInAs('tenant');
      // 600 contacts: comfortably past the 500 the scoped path used to stop at,
      // and within the shared ceiling — so all 600 must be present, not 500.
      const rows = manyContacts(600);
      resolveReads(rows);
      resolveCounts(600, 0);

      const list = await renderHook(() => useContactsWithUsers('harvest', true));
      await until(() => list.current.isSuccess, 'list success');
      const counts = await renderHook(() => useCRMCounts('harvest', true));
      await until(() => counts.current.isSuccess, 'counts success');

      expect(list.current.data).toHaveLength(600);
      // Not just the count — every individual contact is actually reachable.
      const ids = new Set(list.current.data!.map(c => c.id));
      for (const r of rows) expect(ids.has(r.id)).toBe(true);

      // The displayed total matches the true count, and nothing is flagged short.
      expect(counts.current.data!.contactRecords).toBe(600);
      expect(counts.current.data!.contactsTruncated).toBe(false);
      expect(list.current.data).toHaveLength(counts.current.data!.contactRecords);
    });
  });

  // ── 2 ── THE REGRESSION TEST FOR THE WHOLE TICKET ──────────────────────────
  describe('the true count above the old 500 / 1,000 ceilings', () => {
    it('reports the real total above the old ceilings and never reads below the shared limit', async () => {
      signInAs('tenant');
      // A Ministry tenant at its 2,000 allowance: past BOTH old ceilings.
      resolveReads(manyContacts(CRM_FETCH_LIMIT));
      resolveCounts(2000, 1500);

      const counts = await renderHook(() => useCRMCounts('harvest', true));
      await until(() => counts.current.isSuccess, 'counts success');
      const list = await renderHook(() => useContactsWithUsers('harvest', true));
      await until(() => list.current.isSuccess, 'list success');

      // The count is the TRUE number — not clamped to 1,000, not to 500, and not
      // taken from the length of a capped read. This is the whole ticket: a
      // total derived from the list can never exceed the ceiling that truncated
      // it, which is exactly how the list came to end silently.
      expect(counts.current.data!.contactRecords).toBe(2000);
      expect(counts.current.data!.memberAccounts).toBe(1500);
      expect(counts.current.data!.contactRecords).toBeGreaterThan(500);
      expect(counts.current.data!.contactRecords).toBeGreaterThan(1000);
      expect(counts.current.data!.memberAccounts).toBeGreaterThan(1000);

      // Being over the ceiling is REPORTED, not hidden — this is what the UI
      // renders its "this list is incomplete" warning from.
      expect(counts.current.data!.contactsTruncated).toBe(true);
      expect(counts.current.data!.usersTruncated).toBe(true);

      // The counts are aggregations: they must not carry a limit, or they would
      // report the ceiling again instead of the truth.
      const aggregations = built.filter(q => q.limit === null);
      expect(aggregations.length).toBeGreaterThan(0);
      expect(mockGetCount).toHaveBeenCalled();

      // And every DOCUMENT read runs to the single shared ceiling. Restoring the
      // old `limit(500)` on the scoped contacts path fails here.
      expect(readQueries().length).toBeGreaterThan(0);
      for (const q of readQueries()) expect(q.limit).toBe(CRM_FETCH_LIMIT);
      expect(contactQueries().some(q => q.limit === 500)).toBe(false);
    });

    it('counts WITHOUT loading the documents — the cost argument for the aggregate', async () => {
      signInAs('tenant');
      resolveCounts(2000, 1500);

      const counts = await renderHook(() => useCRMCounts('harvest', true));
      await until(() => counts.current.isSuccess, 'counts success');

      // A count taken by fetching and measuring would bill one read per document.
      // The aggregate bills roughly one per thousand, which is what makes an
      // honest total affordable on every CRM open.
      expect(mockGetCount).toHaveBeenCalledTimes(2);
      expect(mockGetDocs).not.toHaveBeenCalled();
    });

    it('faults rather than reporting 0 when there is no tenant and no super-admin standing', async () => {
      signInAs('tenant');
      const counts = await renderHook(() => useCRMCounts(null, true));
      await until(() => counts.current.isError, 'counts error');

      // 0 would render as "this church has no contacts" on the very screen whose
      // job is to stop saying that.
      expect(counts.current.data).toBeUndefined();
      expect(mockGetCount).not.toHaveBeenCalled();
    });
  });

  // ── 3 ── THE DEDUPLICATION GUARD ───────────────────────────────────────────
  describe('a member with BOTH a contacts row and a users row', () => {
    it('appears exactly once when the two rows sit at opposite ends of the list', async () => {
      signInAs('tenant');
      // TWO members, each matched by a DIFFERENT half of the dedup key, and each
      // with their `contacts` row at the front of 600 and their `users` row at
      // the back of 400. Under any page size those pairs fall on different pages
      // — the arrangement that resurrects the dual-id bug the moment the merge
      // sees less than the whole loaded set at once.
      //
      // Covering both halves here is deliberate: with only the email-matched
      // case, breaking the `userId` link would still pass because the emails
      // agree, and vice versa. Either half breaking must fail THIS test.
      const linkedByUserId = {
        id: 'contact-linked', firstName: 'Miriam', lastName: 'Bumb',
        email: 'miriam.new@yahoo.com',            // email CHANGED since the users doc
        userId: 'user-linked', tenantId: 'harvest',
      };
      const linkedByEmail = {
        id: 'contact-emailed', firstName: 'Ada', lastName: 'Anders',
        email: '  Ada@Example.org ',              // casing + whitespace differ
        tenantId: 'harvest',                       // no userId link ever written
      };
      const contacts = [linkedByUserId, linkedByEmail, ...manyContacts(598)];
      const users = [
        ...Array.from({ length: 398 }, (_, i) => ({
          id: `u${i}`, displayName: `Member ${i}`, email: `u${i}@example.org`, tenantId: 'harvest',
        })),
        { id: 'user-linked', displayName: 'Miriam Bumb', email: 'miriam.old@yahoo.com', tenantId: 'harvest' },
        { id: 'user-emailed', displayName: 'Ada Anders', email: 'ada@example.org', tenantId: 'harvest' },
      ];
      resolveReads(contacts, users);
      resolveCounts(600, 400);

      const list = await renderHook(() => useContactsWithUsers('harvest', true));
      await until(() => list.current.isSuccess, 'list success');

      const rows = list.current.data!;
      const idsPresent = new Set(rows.map(c => c.id));

      // Each person surfaces once, under their CONTACTS id — the id their
      // activity timeline is keyed to. Surfacing under the `users` id instead
      // is the bug: the same person twice, the second time with an empty timeline.
      expect(idsPresent.has('contact-linked')).toBe(true);
      expect(idsPresent.has('user-linked')).toBe(false);
      expect(idsPresent.has('contact-emailed')).toBe(true);
      expect(idsPresent.has('user-emailed')).toBe(false);

      // 600 contacts + 400 users, minus the two people counted twice.
      expect(rows).toHaveLength(998);
    });

    it('dedupes on the userId link even when the two rows disagree on email', async () => {
      // Breaking the `contact.userId` half of the dedup key fails here.
      const merged = mergeContactsWithUsers(
        [contactRow({ id: 'c1', firstName: 'Ada', lastName: 'Anders', email: 'new@x.com', userId: 'u1' })],
        [{ id: 'u1', data: { displayName: 'Ada Anders', email: 'old@x.com' } }],
        'harvest',
      );
      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('c1');
    });

    it('dedupes on email when no userId link was ever written', async () => {
      // Breaking the email half of the dedup key fails here. Casing and stray
      // whitespace must not split one person into two rows.
      const merged = mergeContactsWithUsers(
        [contactRow({ id: 'c1', firstName: 'Ada', lastName: 'Anders', email: '  Ada@X.com ' })],
        [{ id: 'u1', data: { displayName: 'Ada Anders', email: 'ada@x.com' } }],
        'harvest',
      );
      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('c1');
    });
  });

  // ── 4 ──────────────────────────────────────────────────────────────────────
  describe('donors who exist only in `contacts`', () => {
    it('still appear — giving statements and tax receipts depend on them', async () => {
      signInAs('tenant');
      const donor = {
        id: 'donor-no-account',
        firstName: 'Grace', lastName: 'Okafor',
        email: 'grace@example.org',
        type: 'donor', totalDonated: 12000,
        tenantId: 'harvest',
      };
      resolveReads(
        [donor, ...manyContacts(599)],
        [{ id: 'u1', displayName: 'Someone Else', email: 'else@example.org', tenantId: 'harvest' }],
      );
      resolveCounts(600, 1);

      const list = await renderHook(() => useContactsWithUsers('harvest', true));
      await until(() => list.current.isSuccess, 'list success');

      const found = list.current.data!.filter(c => c.id === 'donor-no-account');
      expect(found).toHaveLength(1);
      expect(found[0].totalDonated).toBe(12000);
    });
  });

  // ── 6 ──────────────────────────────────────────────────────────────────────
  describe('scoped tenant path vs unscoped super-admin path', () => {
    it('returns the same SHAPE from both, and the scoped path never loads less', async () => {
      // Scoped tenant path.
      signInAs('tenant');
      resolveReads(manyContacts(3));
      resolveCounts(3, 2);
      const scopedList = await renderHook(() => useContactsWithUsers('harvest', true));
      await until(() => scopedList.current.isSuccess, 'scoped list');
      const scopedCounts = await renderHook(() => useCRMCounts('harvest', true));
      await until(() => scopedCounts.current.isSuccess, 'scoped counts');

      const scopedReadLimits = readQueries().map(q => q.limit);
      built.length = 0;

      // Unscoped super-admin path.
      signInAs('super');
      resolveReads(manyContacts(3));
      resolveCounts(9, 7);
      const superList = await renderHook(() => useContactsWithUsers(null, true));
      await until(() => superList.current.isSuccess, 'super list');
      const superCounts = await renderHook(() => useCRMCounts(null, true));
      await until(() => superCounts.current.isSuccess, 'super counts');

      const superReadLimits = readQueries().map(q => q.limit);

      // Same shape: an array of contacts, and counts with the same keys.
      expect(Array.isArray(scopedList.current.data)).toBe(true);
      expect(Array.isArray(superList.current.data)).toBe(true);
      expect(Object.keys(scopedCounts.current.data!).sort())
        .toEqual(Object.keys(superCounts.current.data!).sort());

      // Only `platformWide` distinguishes them, and it is honest about which is which.
      expect(scopedCounts.current.data!.platformWide).toBe(false);
      expect(superCounts.current.data!.platformWide).toBe(true);

      // The inversion is gone: the scoped path loads exactly as much as the
      // unscoped one. It used to load half.
      expect(scopedReadLimits.length).toBeGreaterThan(0);
      expect(new Set(scopedReadLimits)).toEqual(new Set([CRM_FETCH_LIMIT]));
      expect(new Set(superReadLimits)).toEqual(new Set([CRM_FETCH_LIMIT]));
      expect(Math.min(...(scopedReadLimits as number[])))
        .toBeGreaterThanOrEqual(Math.min(...(superReadLimits as number[])));
    });

    it('scopes the counts exactly like the reads they describe', async () => {
      signInAs('tenant');
      resolveCounts(5, 4);
      const counts = await renderHook(() => useCRMCounts('harvest', true));
      await until(() => counts.current.isSuccess, 'counts success');

      // A count scoped differently from the read would describe a different
      // population than the list it sits above.
      expect(contactQueries().every(q =>
        q.whereClauses.some(([f, op, v]) => f === 'tenantId' && op === '==' && v === 'harvest'))).toBe(true);
      expect(userQueries().every(q =>
        q.whereClauses.some(([f, op, v]) => f === 'tenantId' && op === '==' && v === 'harvest'))).toBe(true);
    });
  });
});
