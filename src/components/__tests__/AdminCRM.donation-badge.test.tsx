import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCRM from '../AdminCRM';
import type { Contact } from '../../hooks/queries/useCRMQueries';

/**
 * THE-149 + THE-150 — the CRM must not contradict itself, and a pill must not
 * be blank.
 *
 * THE-149. "$100 total given" and "No donations yet" rendered side by side on
 * the same card, about the same person. The total reads `totalDonated`; the
 * badge read `lastDonationAt`. Two fields describing one fact, and the badge
 * read the one that is only ever about TIMING — so a row whose date was missing
 * was reported as never having given. Whether someone has given is now derived
 * through `resolvePipelineStage`, the same single source the pipeline stage
 * uses, so the badge and the stage cannot drift apart. The date stays
 * `lastDonationAt` and is allowed to be absent, which the card says out loud
 * rather than turning into a denial.
 *
 * THE-150. `TYPE_COLORS` / `TYPE_LABELS` are `Record<Contact['type'], …>`, which
 * is a claim about the TypeScript type and not about the documents — every row
 * is cast off Firestore unvalidated. A row with no `type`, or with one outside
 * the union, indexed both maps to `undefined`: no class, no text, a blank grey
 * pill. Both lookups are now total.
 *
 * The neutral label is deliberately NOT "Member". A new contact defaults to
 * member, but that is a decision about a record being CREATED; saying "Member"
 * about a row whose type could not be read would assert something nobody
 * recorded — the same unearned claim the derived pipeline stage exists to stop.
 *
 * Every assertion below names its target by a stable label or test id (the
 * column header, the badge's testid), never by matching the value it expects to
 * find — a test that greps the DOM for "Donor" passes just as happily when the
 * string came from a contact's surname.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { navigate, authFetch, notifyError, invalidateQueries, contactsResult } = vi.hoisted(() => ({
  navigate: vi.fn(),
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ connected: false }) })),
  notifyError: vi.fn(),
  invalidateQueries: vi.fn(async () => {}),
  contactsResult: { current: { data: [] as unknown[], isLoading: false, isError: false, error: null, refetch: vi.fn() } },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
// The tenant plan drives the maxContacts cap only. `undefined` is the unknown
// plan, which fails closed to 'plus' (150) — no fixture here is near that, so
// the cap stays inert and never gates the add button or the list.
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenantPlan: undefined }) }));
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
// Only the DATA hooks are stubbed. `resolvePipelineStage` — which the giving
// badge now derives through — is the real one; stubbing it would make the
// agreement between the badge and the stage vacuous.
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => contactsResult.current,
  useContactActivities: () => ({
    data: [], isLoading: false, isError: false, error: null, refetch: () => {},
  }),
  // Counts absent = the coverage line stays out of the DOM, so the row-level
  // assertions below match on exactly the rows under test. Coverage has its own
  // file (AdminCRM.coverage.test.tsx).
  useCRMCounts: () => ({ data: undefined }),
}));

// Resolved through the mock factory above (and therefore through
// importOriginal), so this is the same module instance AdminCRM uses.
const { mergeContactsWithUsers } = await import('../../hooks/queries/useCRMQueries');

/** A row shaped like the merged list AdminCRM actually receives. */
const contact = (over: Partial<Contact> & { id: string }): Contact => ({
  firstName: 'A', lastName: 'Person', email: 'a@example.com', phone: '',
  type: 'member', notes: '', tags: [], totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: 'u1', updatedAt: null, tenantId: 't1',
  ...over,
});

/**
 * A row whose stored `type` is absent or outside the union. Firestore documents
 * are cast with `as Contact` on read and are not validated, so this cast
 * reproduces the real read path rather than inventing an impossible value —
 * `Contact['type']` itself is untouched (it is used well beyond this file).
 */
const untypedRow = (over: Partial<Contact> & { id: string }): Contact => {
  const c: Record<string, unknown> = { ...contact(over) };
  delete c.type;
  return c as unknown as Contact;
};
const unrecognisedTypeRow = (over: Partial<Contact> & { id: string }): Contact =>
  ({ ...contact(over), type: 'volunteer' as unknown as Contact['type'] });

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mountCRM() {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AdminCRM
        currentUserRole="admin"
        currentUserPermissions={{ fullAccess: true } as never}
      />,
    );
  });
  await flush();
}

const buttonByText = (text: string) =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text);

/** Open the detail card for the row whose name matches, by clicking its list row. */
async function openContact(name: string) {
  const row = [...container.querySelectorAll('tbody tr')]
    .find(tr => tr.querySelector('p.text-sm.font-semibold')?.textContent?.trim() === name);
  await act(async () => { (row as HTMLElement).click(); });
  await flush();
}

/** The detail card's giving badge, by its test id — never by its expected text. */
const lastGiftBadgeText = () =>
  container.querySelector('[data-testid="crm-last-gift"]')?.textContent?.trim();

/** The detail card's total-given badge: the one stats-strip chip whose copy is
 *  the running total. Located by its trailing label, not by an amount. */
const totalGivenText = () =>
  [...container.querySelectorAll('div.mb-5 > span')]
    .map(s => s.textContent?.trim() || '')
    .find(t => t.endsWith('total given'));

/** Every LAST GIFT cell in the desktop table, in row order. Located by testid so
 *  the cell is identified by WHAT IT IS, not by the date it happens to hold. */
const lastGiftCells = () =>
  [...container.querySelectorAll('[data-testid="crm-last-gift-cell"]')]
    .map(s => s.textContent?.trim() || '');

/** Every Type pill currently in the DOM, across all rendering surfaces. Both the
 *  mobile card list and the desktop table are always mounted (they are separated
 *  by CSS breakpoints, not by conditional rendering), so a single-row list yields
 *  one pill per surface. */
const typeBadges = () =>
  [...container.querySelectorAll('[data-testid="crm-type-badge"]')];

const typeBadgeTexts = () => typeBadges().map(s => s.textContent?.trim() || '');

/** The stage labels rendered in the desktop table's Stage column, in row order.
 *  Deliberately narrow: `container.textContent` would also match the "Champions"
 *  stat card and any contact whose NAME contains a stage word. */
const stageBadges = () =>
  [...container.querySelectorAll('td span.inline-flex.items-center.gap-1\\.5')]
    .map(s => s.textContent?.trim() || '');

beforeEach(() => {
  vi.clearAllMocks();
  contactsResult.current = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

/**
 * TEST 1 — THE REGRESSION for THE-149.
 *
 * MUTATION GUARD: restoring the old `selected.lastDonationAt ? … : 'No donations
 * yet'` read fails this by name. The two badges are asserted TOGETHER, because
 * the defect is not either badge alone — it is the contradiction between them.
 */
describe('a contact with a non-zero total is never told it has no donations', () => {
  it('says the gift date is unrecorded rather than denying the gift', async () => {
    contactsResult.current = {
      data: [contact({ id: 'c1', firstName: 'Ada', lastName: 'Gave', totalDonated: 100, lastDonationAt: null })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openContact('Ada Gave');

    expect(totalGivenText()).toBe('$100 total given');
    expect(lastGiftBadgeText()).not.toBe('No donations yet');
    expect(lastGiftBadgeText()).toBe('Last gift date not recorded');
  });

  it('holds for a total recorded without any date, at every size of gift', async () => {
    for (const total of [0.5, 1, 100, 10000]) {
      contactsResult.current = {
        data: [contact({ id: 'c1', firstName: 'Ada', lastName: 'Gave', totalDonated: total, lastDonationAt: null })],
        isLoading: false, isError: false, error: null, refetch: vi.fn(),
      };
      await mountCRM();
      await openContact('Ada Gave');
      expect(lastGiftBadgeText()).not.toBe('No donations yet');
      await act(async () => { root.unmount(); });
      container.innerHTML = '';
    }
  });

  it('still names the date when the row has one', async () => {
    const when = new Date('2026-03-04T12:00:00Z');
    contactsResult.current = {
      data: [contact({ id: 'c1', firstName: 'Ada', lastName: 'Gave', totalDonated: 100, lastDonationAt: when })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openContact('Ada Gave');
    expect(lastGiftBadgeText()).toMatch(/^Last gift /);
    expect(lastGiftBadgeText()).not.toBe('Last gift date not recorded');
  });

  /**
   * The read-path half of THE-149. The donation webhook stamps `lastDonationAt`
   * on the donor's `users` document in the same write that increments
   * `totalDonated` there; the CRM's synthetic member row used to hardcode the
   * date to null, throwing away one half of the fact on read. A church with no
   * contact records and one member account — the exact shape in the report — got
   * a row that said "$100 given" and "never".
   */
  it('carries the gift date a member account already records', () => {
    const [row] = mergeContactsWithUsers(
      [],
      [{ id: 'u9', data: { displayName: 'Ada Gave', email: 'ada@example.com', totalDonated: 100, lastDonationAt: '2026-03-04T12:00:00.000Z' } }],
      't1',
    );
    expect(row.totalDonated).toBe(100);
    expect(row.lastDonationAt).toBe('2026-03-04T12:00:00.000Z');
  });
});

/** TEST 2 — the honest empty state survives the fix. */
describe('a contact with no donations still says so', () => {
  it('reports no donations when nothing has been given', async () => {
    contactsResult.current = {
      data: [contact({ id: 'c1', firstName: 'Bo', lastName: 'New', totalDonated: 0, lastDonationAt: null })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openContact('Bo New');

    expect(totalGivenText()).toBe('$0 total given');
    expect(lastGiftBadgeText()).toBe('No donations yet');
  });

  it('treats a missing or unusable total as no donations, not as a gift', async () => {
    for (const total of [undefined, null, NaN, 0, -5] as unknown[]) {
      contactsResult.current = {
        data: [contact({ id: 'c1', firstName: 'Bo', lastName: 'New', totalDonated: total as number })],
        isLoading: false, isError: false, error: null, refetch: vi.fn(),
      };
      await mountCRM();
      await openContact('Bo New');
      expect(lastGiftBadgeText()).toBe('No donations yet');
      await act(async () => { root.unmount(); });
      container.innerHTML = '';
    }
  });
});

/**
 * TEST 3 — the two surfaces are one fact.
 *
 * The list's em dash means "nothing given", so it must appear in the table
 * exactly when the card says "No donations yet" — never for someone who has
 * given but whose date is missing, which is what the old list did.
 */
describe('the list and the detail card agree about the last gift', () => {
  const rows = [
    contact({ id: 'c1', firstName: 'Ada', lastName: 'Dated', totalDonated: 100, lastDonationAt: new Date('2026-03-04T12:00:00Z') }),
    contact({ id: 'c2', firstName: 'Bea', lastName: 'Undated', totalDonated: 100, lastDonationAt: null }),
    contact({ id: 'c3', firstName: 'Cy', lastName: 'Nogift', totalDonated: 0, lastDonationAt: null }),
  ];

  it('shows the em dash in the list only where the card denies a donation', async () => {
    contactsResult.current = { data: rows, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    await mountCRM();
    const cells = lastGiftCells();
    expect(cells).toHaveLength(3);
    await act(async () => { root.unmount(); });
    container.innerHTML = '';

    // Remounted per row: the detail card is reached by clicking a list row, and
    // there is no in-page control back to the list (the back affordance lives in
    // the shared header, which is stubbed out here).
    for (const [i, row] of rows.entries()) {
      contactsResult.current = { data: rows, isLoading: false, isError: false, error: null, refetch: vi.fn() };
      await mountCRM();
      await openContact(`${row.firstName} ${row.lastName}`);
      const cardDeniesDonation = lastGiftBadgeText() === 'No donations yet';
      expect(cells[i] === '—').toBe(cardDeniesDonation);
      await act(async () => { root.unmount(); });
      container.innerHTML = '';
    }
  });

  it('names the undated gift on both surfaces instead of erasing it', async () => {
    contactsResult.current = { data: rows, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    await mountCRM();
    expect(lastGiftCells()[1]).toBe('Not recorded');
    await openContact('Bea Undated');
    expect(lastGiftBadgeText()).toBe('Last gift date not recorded');
  });
});

/**
 * TEST 4 — THE REGRESSION for THE-150.
 *
 * MUTATION GUARD: restoring the bare `TYPE_LABELS[c.type]` / `TYPE_COLORS[c.type]`
 * lookup fails this by name — both yield `undefined` and the pill renders with no
 * text and no class, which is precisely the blank grey chip in the report.
 */
describe('a row with no type renders a readable label, not an empty pill', () => {
  it('gives the pill both text and a class', async () => {
    contactsResult.current = {
      data: [untypedRow({ id: 'c1', firstName: 'Dee', lastName: 'Untyped' })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();

    const badges = typeBadges();
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      expect(badge.textContent?.trim()).toBeTruthy();
      // `${undefined}` interpolates the literal string "undefined" into the
      // className, so "has some class" is not enough to catch the defect.
      expect(badge.className).not.toContain('undefined');
      expect(badge.textContent?.trim()).not.toBe('undefined');
    }
  });
});

/** TEST 5 — an unrecognised value is the same problem as a missing one. */
describe('a row with an unrecognised type renders the same neutral label', () => {
  it('falls back identically for a value outside the union', async () => {
    contactsResult.current = {
      data: [untypedRow({ id: 'c1', firstName: 'Dee', lastName: 'Untyped' })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    const missing = typeBadgeTexts();
    const missingClass = typeBadges()[0].className;
    await act(async () => { root.unmount(); });
    container.innerHTML = '';

    contactsResult.current = {
      data: [unrecognisedTypeRow({ id: 'c1', firstName: 'Dee', lastName: 'Untyped' })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    expect(typeBadgeTexts()).toEqual(missing);
    expect(typeBadges()[0].className).toBe(missingClass);
  });
});

/**
 * TEST 6 — every surface, not just the one in the screenshot.
 *
 * The desktop table, the mobile card list, the detail card and the kanban card
 * each render their own Type pill. Fixing one leaves the contradiction on the
 * others, so all of them are asserted here. (The ticket named three call sites;
 * the kanban card is a fourth — see the PR body.)
 */
describe('all three type badges behave identically', () => {
  it('renders the same fallback on the list, the detail card and the pipeline', async () => {
    contactsResult.current = {
      data: [untypedRow({ id: 'c1', firstName: 'Dee', lastName: 'Untyped' })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();

    // List view mounts BOTH the mobile card list and the desktop table.
    const listBadges = typeBadges();
    expect(listBadges.length).toBe(2);
    const [label] = new Set(listBadges.map(b => b.textContent?.trim()));
    expect(new Set(listBadges.map(b => b.textContent?.trim())).size).toBe(1);

    // Kanban card.
    await act(async () => { buttonByText('Pipeline')!.click(); });
    await flush();
    const kanbanBadges = typeBadges();
    expect(kanbanBadges.length).toBe(1);
    expect(kanbanBadges[0].textContent?.trim()).toBe(label);

    // Detail card.
    await act(async () => { buttonByText('List')!.click(); });
    await flush();
    await openContact('Dee Untyped');
    const detailBadges = typeBadges();
    expect(detailBadges.length).toBe(1);
    expect(detailBadges[0].textContent?.trim()).toBe(label);
  });
});

/** TEST 7 — the fallback must not swallow the types that DO resolve. */
describe('a known type still renders its own label and colour', () => {
  it('keeps a distinct label and class per known type', async () => {
    const seen = new Map<string, { label: string; className: string }>();
    for (const type of ['donor', 'member', 'both'] as Contact['type'][]) {
      contactsResult.current = {
        data: [contact({ id: 'c1', firstName: 'Eli', lastName: 'Known', type })],
        isLoading: false, isError: false, error: null, refetch: vi.fn(),
      };
      await mountCRM();
      const badge = typeBadges()[0];
      seen.set(type, { label: badge.textContent?.trim() || '', className: badge.className });
      await act(async () => { root.unmount(); });
      container.innerHTML = '';
    }

    const labels = [...seen.values()].map(v => v.label);
    expect(new Set(labels).size).toBe(3);
    expect(labels.every(Boolean)).toBe(true);
    // Each known type keeps its OWN colour — the fallback did not flatten them.
    expect(new Set([...seen.values()].map(v => v.className)).size).toBe(3);
  });
});

/**
 * TEST 8 — the fallback must not GUESS.
 *
 * MUTATION GUARD: defaulting an unknown type to 'member' fails this by name.
 * "Member" is a claim about a person, and the whole point of THE-150 is that
 * this row does not carry one.
 */
describe('no row is labelled Member unless it is one', () => {
  it('never asserts membership about a row whose type could not be read', async () => {
    for (const row of [untypedRow({ id: 'c1', firstName: 'Dee', lastName: 'Untyped' }),
                       unrecognisedTypeRow({ id: 'c1', firstName: 'Dee', lastName: 'Untyped' })]) {
      contactsResult.current = { data: [row], isLoading: false, isError: false, error: null, refetch: vi.fn() };
      await mountCRM();
      for (const text of typeBadgeTexts()) {
        expect(text).not.toBe('Member');
        expect(text).not.toBe('Donor & Member');
        expect(text).not.toBe('Donor');
      }
      await act(async () => { root.unmount(); });
      container.innerHTML = '';
    }
  });

  it('still labels a real member row Member', async () => {
    contactsResult.current = {
      data: [contact({ id: 'c1', firstName: 'Fay', lastName: 'Member', type: 'member' })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    expect(new Set(typeBadgeTexts())).toEqual(new Set(['Member']));
  });
});

/**
 * TEST 9 — neither fix went near the pipeline model.
 *
 * The stage is derived from `totalDonated` and is a badge, not a selector. The
 * giving badge now reads through the SAME resolver, so this pins that reuse:
 * the stage column must still follow giving alone, and must be unmoved by a
 * missing `lastDonationAt` or an unreadable `type`.
 */
describe('the derived pipeline stage is unchanged', () => {
  it('follows giving alone, whatever the date or the type says', async () => {
    contactsResult.current = {
      data: [
        contact({ id: 'c1', firstName: 'A', lastName: 'Aaa', totalDonated: 0, lastDonationAt: null }),
        untypedRow({ id: 'c2', firstName: 'B', lastName: 'Bbb', totalDonated: 100, lastDonationAt: null }),
        contact({ id: 'c3', firstName: 'C', lastName: 'Ccc', totalDonated: 10000, lastDonationAt: null }),
      ],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    expect(stageBadges()).toEqual(['Member', 'Giving', 'Champion']);
  });

  it('offers no control that would move a contact between stages', async () => {
    contactsResult.current = {
      data: [contact({ id: 'c1', firstName: 'A', lastName: 'Aaa', totalDonated: 100 })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openContact('A Aaa');
    for (const label of ['Member', 'Giving', 'Champion']) {
      expect(buttonByText(label)).toBeUndefined();
    }
  });
});

/**
 * TEST 10 — the neutral pill is themed, not painted.
 *
 * A literal hex or rgb() here would look correct in light mode and be unreadable
 * in dark: the neutral ramp is redefined under `.dark` / [data-theme="dark"], and
 * a hardcoded value does not participate. `--surface-chip` exists precisely for
 * opaque pill fills and is defined in BOTH themes, as is `--text-muted`.
 */
describe('no colour is hardcoded', () => {
  it('paints the fallback pill from theme tokens only', async () => {
    contactsResult.current = {
      data: [untypedRow({ id: 'c1', firstName: 'Dee', lastName: 'Untyped' })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();

    for (const badge of typeBadges()) {
      expect(badge.className).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(badge.className).not.toMatch(/\brgba?\(/);
      expect(badge.className).toContain('bg-surface-chip');
      expect(badge.className).toContain('text-muted');
      expect(badge.getAttribute('style')).toBeNull();
    }
  });

  it('adds no inline colour to the giving badge either', async () => {
    contactsResult.current = {
      data: [contact({ id: 'c1', firstName: 'Ada', lastName: 'Gave', totalDonated: 100 })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();
    await openContact('Ada Gave');
    const badge = container.querySelector('[data-testid="crm-last-gift"]')!;
    expect(badge.getAttribute('style')).toBeNull();
    expect(badge.className).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
