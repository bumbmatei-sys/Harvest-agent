import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCRM from '../AdminCRM';
import type { Contact } from '../../hooks/queries/useCRMQueries';

/**
 * THE-41 — the CRM pipeline stage is DERIVED from giving, not clicked.
 *
 * All five previous stages were manual: the only writers were the kanban
 * stage-mover and the detail-view chips. Nothing in the donation webhook,
 * check-in or event registration ever set one, so a contact who had given
 * $10,000 sat in "New" until an admin remembered to move them — and the
 * dashboard's "Champions" stat reported how often a button had been pressed.
 *
 * Three stages now, each a pure function of `totalDonated`:
 *   member   — nothing given
 *   giving   — anything above zero
 *   champion — $10,000 or more
 *
 * `totalDonated` is DOLLARS (BUG 2 — the donation webhook divides Stripe's cents
 * before writing it), so the threshold below is 10000 dollars, NOT 1,000,000
 * cents. Every number in this file is a dollar figure.
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
// AdminCRM reads the tenant plan for the maxContacts cap (contact-capacity.ts).
// `undefined` is the loading/unknown plan, which fails closed to 'plus' (150) —
// no test here is near that number, so the cap stays inert.
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenantPlan: undefined }) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'a1' })),
  deleteDoc: vi.fn(async () => {}),
  setDoc: vi.fn(async () => {}),
  doc: () => ({}),
  serverTimestamp: () => 'SERVER_TS',
  // THE-74 added a batched import write. Mocked modules must export every
  // binding the component imports, so this is required even where unused.
  writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) })),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false }),
}));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
  HeaderActionButton: () => null,
}));
vi.mock('../AdminRoles', () => ({ default: () => null }));
// Only the data hooks are stubbed — resolvePipelineStage, the helper under test,
// is the REAL one. Stubbing it here would make every assertion below vacuous.
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => contactsResult.current,
  useContactActivities: () => ({
    data: [], isLoading: false, isError: false, error: null, refetch: () => {},
  }),
  // Undefined data = counts not in yet, so the coverage line stays out of the
  // DOM and the stage/kanban assertions below match on exactly what they did
  // before. Coverage has its own test file.
  useCRMCounts: () => ({ data: undefined }),
}));

// Imported AFTER the mock factory above so it resolves through it (and therefore
// through importOriginal) — same module instance AdminCRM is using.
const { resolvePipelineStage, CHAMPION_THRESHOLD_DOLLARS } =
  await import('../../hooks/queries/useCRMQueries');

/** A contact row shaped like the merged list AdminCRM actually receives. */
const contact = (over: Partial<Contact> & { id: string }): Contact => ({
  firstName: 'A', lastName: 'Person', email: 'a@example.com', phone: '',
  type: 'member', notes: '', tags: [], totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: 'u1', updatedAt: null, tenantId: 't1',
  ...over,
});

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mountCRM(props: { initialContactId?: string } = {}) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AdminCRM
        currentUserRole="admin"
        currentUserPermissions={{ fullAccess: true } as never}
        {...props}
      />,
    );
  });
  await flush();
}

const buttonByText = (text: string) =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text);

/** Switch the contacts list into the kanban ("Pipeline") view. */
async function openPipeline() {
  await act(async () => { buttonByText('Pipeline')!.click(); });
  await flush();
}

/** The kanban column headers, in left→right order, with their counts. */
function kanbanColumns() {
  // Each column is a fixed-width flex child of the horizontally scrolling board.
  return [...container.querySelectorAll('div.w-\\[220px\\]')].map(col => {
    const label = col.querySelector('span.text-xs.font-bold')?.textContent?.trim() || '';
    const count = col.querySelector('span.rounded-full')?.textContent?.trim() || '';
    return { label, count: Number(count), names: [...col.querySelectorAll('p.text-xs.font-bold')].map(p => p.textContent?.trim()) };
  });
}

/**
 * The stage labels actually rendered in the desktop table's "Stage" column, in
 * row order. Deliberately narrow: asserting on `container.textContent` would
 * match the "Champions" stat-card label and any contact whose NAME contains a
 * stage word, so it could pass while the badge was wrong.
 */
function renderedStageBadges(): string[] {
  return [...container.querySelectorAll('td span.inline-flex.items-center.gap-1\\.5')]
    .map(s => s.textContent?.trim() || '');
}

/** The value rendered under a named stat card on the contacts list. */
function statValue(label: string): string | undefined {
  const card = [...container.querySelectorAll('div.rounded-brand-lg')]
    .find(d => d.querySelector('p')?.textContent?.trim() === label);
  return card?.querySelectorAll('p')[1]?.textContent?.trim();
}

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
 * TEST 1 — the resolver and, above all, its boundary.
 *
 * MUTATION GUARD: changing `>=` to `>` in resolvePipelineStage fails the
 * "exactly $10,000 is a Champion" case below by name. That single character is
 * the difference between a $10,000 donor being celebrated and being invisible.
 */
describe('resolvePipelineStage', () => {
  it('no donations → member', () => {
    expect(resolvePipelineStage(0)).toBe('member');
  });

  it('any donation at all → giving', () => {
    expect(resolvePipelineStage(0.01)).toBe('giving');
    expect(resolvePipelineStage(1)).toBe('giving');
    expect(resolvePipelineStage(9999.99)).toBe('giving');
  });

  it('exactly $10,000 is a Champion (>= not >)', () => {
    expect(CHAMPION_THRESHOLD_DOLLARS).toBe(10000);
    expect(resolvePipelineStage(10000)).toBe('champion');
    // The dollar either side of the line, pinned so an off-by-one is unambiguous.
    expect(resolvePipelineStage(9999)).toBe('giving');
    expect(resolvePipelineStage(10001)).toBe('champion');
  });

  it('well past the threshold → champion', () => {
    expect(resolvePipelineStage(50000)).toBe('champion');
  });

  /**
   * The threshold is in DOLLARS. 10000 CENTS is $100 — a Giving donor, not a
   * Champion. This is the 100× unit error that has shipped here before; it fails
   * the moment someone "fixes" the threshold to 1_000_000.
   */
  it('reads the threshold in dollars, not cents', () => {
    expect(resolvePipelineStage(100)).toBe('giving');
    expect(resolvePipelineStage(9999)).not.toBe('champion');
  });
});

/** TEST 2 — a missing total is "no donations", never a crash. */
describe('resolvePipelineStage with no usable total', () => {
  it('undefined / null / NaN / negative all resolve to member without throwing', () => {
    expect(resolvePipelineStage(undefined)).toBe('member');
    expect(resolvePipelineStage(null)).toBe('member');
    expect(resolvePipelineStage(NaN)).toBe('member');
    expect(resolvePipelineStage(-5)).toBe('member');
  });

  it('a contact document with no totalDonated field renders as Member', async () => {
    const noTotal = contact({ id: 'c1', firstName: 'Nope', lastName: 'Nothing' });
    delete (noTotal as Partial<Contact>).totalDonated;
    contactsResult.current = { ...contactsResult.current, data: [noTotal] };
    await mountCRM();

    expect(renderedStageBadges()).toEqual(['Member']);
  });
});

/**
 * TEST 3 — the stored field is ignored, which is what makes a backfill
 * unnecessary.
 *
 * MUTATION GUARD: reverting the resolver (or any badge) to read `c.stage` fails
 * this test. The fixture is written as a raw Firestore document — `stage` is not
 * on the Contact type any more, precisely because nothing may read it.
 */
describe('a stored stage field is ignored', () => {
  it('stored stage "champion" with $0 given renders as Member', async () => {
    const legacy = { ...contact({ id: 'c1', firstName: 'Stale', lastName: 'Record' }), stage: 'champion' };
    contactsResult.current = { ...contactsResult.current, data: [legacy] };
    await mountCRM();

    expect(renderedStageBadges()).toEqual(['Member']);
    expect(statValue('Champions')).toBe('0');
  });

  it('stored stage "new" with $12,000 given renders as Champion', async () => {
    const legacy = { ...contact({ id: 'c1', firstName: 'Real', lastName: 'Giver', totalDonated: 12000 }), stage: 'new' };
    contactsResult.current = { ...contactsResult.current, data: [legacy] };
    await mountCRM();

    expect(renderedStageBadges()).toEqual(['Champion']);
    expect(statValue('Champions')).toBe('1');
  });
});

/** TEST 4 — the metric counts dollars given, not stored stages. */
describe('the Champions stat', () => {
  it('counts contacts at or above $10,000, ignoring any stored stage', async () => {
    contactsResult.current = {
      ...contactsResult.current,
      data: [
        { ...contact({ id: 'a', totalDonated: 10000 }), stage: 'new' },       // counts (boundary)
        contact({ id: 'b', totalDonated: 25000 }),                            // counts
        { ...contact({ id: 'c', totalDonated: 0 }), stage: 'champion' },      // must NOT count
        contact({ id: 'd', totalDonated: 9999.99 }),                          // must NOT count
      ],
    };
    await mountCRM();

    expect(statValue('Champions')).toBe('2');
  });
});

/** TEST 5 — three columns, each contact in its derived one. */
describe('the kanban board', () => {
  beforeEach(() => {
    contactsResult.current = {
      ...contactsResult.current,
      data: [
        contact({ id: 'a', firstName: 'Never', lastName: 'Gave' }),
        contact({ id: 'b', firstName: 'Small', lastName: 'Gift', totalDonated: 25 }),
        contact({ id: 'c', firstName: 'Big', lastName: 'Giver', totalDonated: 10000 }),
      ],
    };
  });

  it('renders exactly three columns: Member, Giving, Champion', async () => {
    await mountCRM();
    await openPipeline();

    expect(kanbanColumns().map(c => c.label)).toEqual(['Member', 'Giving', 'Champion']);
  });

  it('places each contact in the column its giving derives', async () => {
    await mountCRM();
    await openPipeline();

    const cols = kanbanColumns();
    expect(cols[0].names).toEqual(['Never Gave']);
    expect(cols[1].names).toEqual(['Small Gift']);
    expect(cols[2].names).toEqual(['Big Giver']);
    expect(cols.map(c => c.count)).toEqual([1, 1, 1]);
  });

  it('has no deleted stage left to render — "New", "Connected" and "Active" are gone', async () => {
    await mountCRM();
    await openPipeline();

    const labels = kanbanColumns().map(c => c.label);
    expect(labels).not.toContain('New');
    expect(labels).not.toContain('Connected');
    expect(labels).not.toContain('Active');
  });
});

/**
 * TEST 6 — no stage-mutation control survives anywhere.
 *
 * A button that silently does nothing is worse than no button, so this asserts
 * absence structurally rather than trusting the diff: nothing in the CRM may
 * write a stage, and the prop that used to carry the handler is gone from the
 * component's source.
 */
describe('no manual stage control remains', () => {
  it('the kanban card footer has no stage-mover dots', async () => {
    contactsResult.current = {
      ...contactsResult.current,
      data: [contact({ id: 'a', firstName: 'Never', lastName: 'Gave' })],
    };
    await mountCRM();
    await openPipeline();

    // The mover was the only <button> inside a kanban card (the card itself is a
    // clickable div). Any button in a column now is a stage control that escaped.
    const columnButtons = [...container.querySelectorAll('div.w-\\[220px\\] button')];
    expect(columnButtons).toHaveLength(0);
  });

  it('the detail view shows the derived stage as a badge, not as clickable chips', async () => {
    contactsResult.current = {
      ...contactsResult.current,
      data: [contact({ id: 'c1', firstName: 'Big', lastName: 'Giver', totalDonated: 10000 })],
    };
    await mountCRM({ initialContactId: 'c1' });

    expect(container.textContent).toContain('Champion');
    // Not one of the three stage names may be rendered as a button anywhere.
    for (const label of ['Member', 'Giving', 'Champion']) {
      expect(buttonByText(label)).toBeUndefined();
    }
  });

  it('the KanbanBoard interface no longer declares onStageChange, and no stage writer exists', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/components/AdminCRM.tsx', 'utf8');

    // Booleans, not toContain: a failed toContain on a 1,200-line file dumps the
    // whole file into the report and buries the actual assertion.
    expect(src.includes('onStageChange')).toBe(false);
    expect(src.includes('handleStageChange')).toBe(false);
    // The write itself: no payload in this file may carry a `stage` key.
    expect(/\bstage:\s*(newStage|form\.stage|s\.id|'[a-z]+')/.test(src)).toBe(false);
  });
});

/**
 * TEST 7 — `type` is a different field and was not touched.
 *
 * The `donor` TYPE and the `Giving` STAGE are separate facts: a donor who has
 * not given through this app is still type `donor`, and a member who gives is
 * still type `member`/`both`. Conflating them would quietly rewrite two stats.
 */
describe('contact type is untouched by the stage change', () => {
  it('Members and Donors still count by type, independent of giving', async () => {
    contactsResult.current = {
      ...contactsResult.current,
      data: [
        contact({ id: 'a', type: 'member', totalDonated: 0 }),      // member, stage Member
        contact({ id: 'b', type: 'member', totalDonated: 500 }),    // member, stage Giving
        contact({ id: 'c', type: 'donor', totalDonated: 0 }),       // donor, stage Member
        contact({ id: 'd', type: 'both', totalDonated: 20000 }),    // both, stage Champion
      ],
    };
    await mountCRM();

    // member + both
    expect(statValue('Members')).toBe('3');
    // donor + both
    expect(statValue('Donors')).toBe('2');
    // …while the derived stage of the same four rows is something else entirely.
    expect(statValue('Champions')).toBe('1');
  });
});
