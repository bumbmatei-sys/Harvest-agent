import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCRM from '../AdminCRM';
import type { Contact, CRMCounts } from '../../hooks/queries/useCRMQueries';

/**
 * THE-67 — the CRM must SAY when its list is short.
 *
 * The original failure was silence, and silence is what made it dangerous: past
 * `limit(500)` / `limit(1000)` people were simply absent, and a truncated list
 * rendered byte-for-byte like a complete one. The same class of lie as the empty
 * activity timeline (#236) — a partial answer wearing the costume of a full one.
 *
 * Search is the sharpest edge. The box searches the LOADED rows, so on a
 * truncated list "no results" means "not in the first 1,000", not "not in this
 * church" — and an admin who types a member's name and sees nothing will
 * conclude the member does not exist. A search that quietly covers half the
 * church is worse than a list that admits it is short, because it looks
 * authoritative. So whenever the list is partial the UI has to say so, name the
 * real totals, and warn that search and the filters see only what is loaded.
 *
 * The two counts are never summed into a head-count: the list is a MERGE, so a
 * person with both a `contacts` row and a `users` row is one row. Adding the
 * collections would trade an undercount for an overcount.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { navigate, authFetch, notifyError, invalidateQueries, contactsResult, countsResult } = vi.hoisted(() => ({
  navigate: vi.fn(),
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ connected: false }) })),
  notifyError: vi.fn(),
  invalidateQueries: vi.fn(async () => {}),
  contactsResult: { current: { data: [] as unknown[], isLoading: false, isError: false, error: null, refetch: vi.fn() } },
  countsResult: { current: { data: undefined as unknown } },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'a1' })),
  deleteDoc: vi.fn(async () => {}),
  setDoc: vi.fn(async () => {}),
  doc: () => ({}),
  serverTimestamp: () => 'SERVER_TS',
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false }),
}));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
  HeaderActionButton: () => null,
}));
vi.mock('../AnalyticsAndRoles', () => ({ default: () => null }));
// Only the data hooks are stubbed. CRM_FETCH_LIMIT stays REAL, so the number the
// UI prints as its ceiling is the number the queries actually use — a
// hand-written constant here would let the two drift apart silently.
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => contactsResult.current,
  useCRMCounts: () => countsResult.current,
  useContactActivities: () => ({
    data: [], isLoading: false, isError: false, error: null, refetch: () => {},
  }),
}));

const { CRM_FETCH_LIMIT } = await import('../../hooks/queries/useCRMQueries');

const contact = (over: Partial<Contact> & { id: string }): Contact => ({
  firstName: 'A', lastName: 'Person', email: 'a@example.com', phone: '',
  type: 'member', notes: '', tags: [], totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: 'u1', updatedAt: null, tenantId: 't1',
  ...over,
});

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    contact({ id: `c${i}`, firstName: 'Given', lastName: `Name${i}`, email: `c${i}@example.org` }));

const counts = (over: Partial<CRMCounts> = {}): CRMCounts => ({
  contactRecords: 0, memberAccounts: 0, platformWide: false,
  contactsTruncated: false, usersTruncated: false,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mountCRM() {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AdminCRM currentUserRole="admin" currentUserPermissions={{ fullAccess: true } as never} />,
    );
  });
  await flush();
}

/** The coverage line's text, with runs of whitespace collapsed. */
const coverageText = () =>
  container.querySelector('[data-testid="crm-coverage"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

/** Type into the search box the way an admin would. */
async function typeSearch(value: string) {
  const input = container.querySelector('input[placeholder="Search by name or email…"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  contactsResult.current = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  countsResult.current = { data: undefined };
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('THE-67 — the CRM says how much of the list it is showing', () => {
  // ── 5 ── SEARCH HONESTY ────────────────────────────────────────────────────
  describe('a truncated list announces itself, and says what search covered', () => {
    beforeEach(() => {
      // A Ministry tenant at its 2,000 allowance: the list loaded its ceiling,
      // the church has far more.
      contactsResult.current = { ...contactsResult.current, data: rows(CRM_FETCH_LIMIT) };
      countsResult.current = {
        data: counts({ contactRecords: 2000, memberAccounts: 1500, contactsTruncated: true, usersTruncated: true }),
      };
    });

    it('states that the list is incomplete, with the REAL totals — not the ceiling', async () => {
      await mountCRM();
      const text = coverageText();

      expect(text).toBeTruthy();
      expect(text).toContain('this list is incomplete');
      // The true totals, above both old ceilings. Reporting the loaded length as
      // the total is the bug.
      expect(text).toContain('2,000 contact records');
      expect(text).toContain('1,500 member accounts');
      expect(text).toContain(`${CRM_FETCH_LIMIT.toLocaleString()} of each`);
      // And it is honest that what is on screen is the smaller number.
      expect(text).toContain(`Showing ${CRM_FETCH_LIMIT.toLocaleString()} people`);
    });

    it('warns that SEARCH and the filters cover only the loaded rows', async () => {
      await mountCRM();
      const text = coverageText()!;

      // The whole point: "no results" on a truncated list must not read as
      // "not in this church".
      expect(text).toMatch(/search/i);
      expect(text).toMatch(/only the rows loaded/i);
    });

    it('keeps the warning up while a search is active and matching nothing', async () => {
      await mountCRM();
      await typeSearch('someone-not-in-the-first-thousand');

      // The empty-results state is exactly where the lie would land, so the
      // caveat has to survive it rather than being replaced by "No contacts match".
      expect(container.textContent).toContain('No contacts match');
      const text = coverageText();
      expect(text).toContain('this list is incomplete');
      expect(text).toMatch(/search/i);
    });

    it('never presents contacts + members as a single head-count', async () => {
      await mountCRM();
      // 2,000 + 1,500 = 3,500 would overcount everyone holding both rows.
      expect(coverageText()).not.toContain('3,500');
    });
  });

  // ── 1 ── THE COMPLETE CASE ─────────────────────────────────────────────────
  describe('a complete list', () => {
    it('reports the true total and raises no warning', async () => {
      contactsResult.current = { ...contactsResult.current, data: rows(600) };
      countsResult.current = { data: counts({ contactRecords: 600, memberAccounts: 0 }) };
      await mountCRM();

      const text = coverageText();
      expect(text).toContain('Showing all 600 people');
      expect(text).toContain('600 contact records');
      expect(text).not.toContain('incomplete');
      // No alarm on a list that is telling the truth.
      expect(container.querySelector('[data-testid="crm-coverage"]')!.className).not.toContain('amber');
    });

    it('explains why the two collection counts do not add up to the row count', async () => {
      // 5 contacts + 4 member accounts merging to 6 rows is not an error — three
      // people hold both. Without a word of explanation it reads like one.
      contactsResult.current = { ...contactsResult.current, data: rows(6) };
      countsResult.current = { data: counts({ contactRecords: 5, memberAccounts: 4 }) };
      await mountCRM();

      expect(coverageText()).toMatch(/merged/i);
      expect(coverageText()).toMatch(/counts once/i);
    });
  });

  // ── 6 ── THE SUPER-ADMIN PATH ──────────────────────────────────────────────
  describe('the unscoped super-admin path', () => {
    it('labels its totals as platform-wide rather than implying rows are missing', async () => {
      // The platform scan reads every church's contacts and then keeps only the
      // platform-owned rows, so the count legitimately exceeds what is shown.
      // Presenting that gap as truncation would be a false alarm.
      contactsResult.current = { ...contactsResult.current, data: rows(12) };
      countsResult.current = { data: counts({ contactRecords: 940, memberAccounts: 880, platformWide: true }) };
      await mountCRM();

      const text = coverageText()!;
      expect(text).toContain('Across all churches');
      expect(text).toContain('940 contact records');
      expect(text).not.toContain('incomplete');
      expect(text).not.toContain('Showing all');
    });

    it('still warns when the platform scan itself is truncated', async () => {
      contactsResult.current = { ...contactsResult.current, data: rows(CRM_FETCH_LIMIT) };
      countsResult.current = {
        data: counts({ contactRecords: 4200, memberAccounts: 300, platformWide: true, contactsTruncated: true }),
      };
      await mountCRM();

      const text = coverageText()!;
      expect(text).toContain('this list is incomplete');
      expect(text).toContain('Across all churches');
      expect(text).toContain('4,200 contact records');
    });
  });

  // ── Resilience ─────────────────────────────────────────────────────────────
  describe('when the count itself is unavailable', () => {
    it('renders the list without a coverage line rather than taking the list down', async () => {
      contactsResult.current = { ...contactsResult.current, data: rows(3) };
      countsResult.current = { data: undefined };
      await mountCRM();

      expect(coverageText()).toBeNull();
      // The list is still there — a failed aggregate costs the caveat, not the CRM.
      expect(container.textContent).toContain('Name0');
    });
  });
});
