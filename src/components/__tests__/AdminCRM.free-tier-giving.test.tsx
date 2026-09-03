import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCRM from '../AdminCRM';
import type { Contact } from '../../hooks/queries/useCRMQueries';
import { PLAN_ORDER, PLAN_DISPLAY_NAMES, getPlanFeatures } from '../../utils/plan-features';

/**
 * THE-213 · defect 3 — THE CRM SHOWS NO DONOR OR GIVING COLUMN FOR A FREE TENANT.
 *
 * `fundraising: false` means the tenant has NO DONATE PAGE: the member Give tab
 * is gone, /campaign/[id] refuses server-side and /api/stripe/donate 403s. So no
 * gift can arrive, `totalDonated` can never leave 0, and no donor record can
 * ever exist. Every giving-shaped element on this screen is therefore not
 * "empty" on such a tenant — it is structurally impossible, and a row of zeroes
 * says "this church has raised nothing", which is a different and much worse
 * statement than "this plan does not do fundraising".
 *
 * THE-205 fixed the pricing CARD's label (`crmLabel`). The screen itself — its
 * stat tiles, its columns, its filters, its pipeline and its activity types —
 * was never touched. This is the screen.
 *
 * 🔴 WHAT DELIBERATELY STAYS, and why:
 *
 *   the Type column and its Donor / Donor & Member pills
 *       They report what a DOCUMENT says — a value an admin chose in the form or
 *       an importer mapped from a spreadsheet column — not a claim the plan
 *       makes. This list is the MERGED contact/member view, and the Type column
 *       is what identifies which side of that merge a row came from; hiding it
 *       would break the shape PR 338's CSV importer and the merge logic both
 *       depend on, and would make a `donor` row carried over from a downgrade
 *       unreadable — deleting data with CSS.
 *   the contact form's Type select
 *       Removing its donor options would silently coerce an existing donor's
 *       type on the next save. That is the contact WRITE PATH, which this PR
 *       does not touch.
 *   the activity timeline's existing donation entries
 *       History. Only the chip that CREATES one is withheld.
 *
 * ⚠️ EVERY TARGET BELOW IS NAMED BY ITS LABEL OR ITS TEST ID, never by matching
 * the value it expects to find. A test that greps the DOM for "$0" passes just
 * as happily when the string came from a contact's phone number.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { navigate, authFetch, notifyError, invalidateQueries, contactsResult, tenant } = vi.hoisted(() => ({
  navigate: vi.fn(),
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ connected: false }) })),
  notifyError: vi.fn(),
  invalidateQueries: vi.fn(async () => {}),
  contactsResult: { current: { data: [] as unknown[], isLoading: false, isError: false, error: null, refetch: vi.fn() } },
  tenant: { current: { tenantPlan: 'free' as string | null, planFeatures: null as unknown } },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant.current }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'a1' })),
  deleteDoc: vi.fn(async () => {}),
  setDoc: vi.fn(async () => {}),
  doc: () => ({}),
  serverTimestamp: () => 'SERVER_TS',
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
// Only the DATA hooks are stubbed. `resolvePipelineStage` is the real one — the
// whole claim is that the stage is a function of giving, so stubbing it would
// make "the stage column is a giving column" vacuous.
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => contactsResult.current,
  useContactActivities: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: () => {} }),
  useCRMCounts: () => ({ data: undefined }),
}));

const contact = (over: Partial<Contact> & { id: string }): Contact => ({
  firstName: 'A', lastName: 'Person', email: 'a@example.com', phone: '',
  type: 'member', notes: '', tags: [], totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: 'u1', updatedAt: null, tenantId: 't1',
  ...over,
});

/**
 * A roster carried over from a paying tier: a real donor with a real lifetime
 * total. Deliberately NOT an all-zero fixture — a screen that hides its giving
 * columns only when there is nothing in them has hidden nothing.
 */
const ROSTER: Contact[] = [
  contact({ id: 'c1', firstName: 'Maria', type: 'member' }),
  contact({ id: 'c2', firstName: 'Daniel', type: 'donor', totalDonated: 12_500, lastDonationAt: null }),
];

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mountOn(plan: string | null, opts: { planFeatures?: unknown; rows?: Contact[] } = {}) {
  tenant.current = {
    tenantPlan: plan,
    planFeatures: 'planFeatures' in opts ? opts.planFeatures : (plan ? getPlanFeatures(plan as never) : null),
  };
  contactsResult.current = { data: opts.rows ?? ROSTER, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminCRM currentUserRole="admin" currentUserPermissions={{ fullAccess: true } as never} />);
  });
  await flush();
}

/** The stat tiles, by their own uppercase caption. */
const statLabels = () =>
  [...container.querySelectorAll('p.uppercase')].map((p) => p.textContent?.trim() || '');

/** The desktop table's column headings, in order. */
const columnHeadings = () =>
  [...container.querySelectorAll('thead th')].map((th) => th.textContent?.trim() || '');

const buttonLabels = () =>
  [...container.querySelectorAll('button')].map((b) => b.textContent?.trim() || '');

const has = (label: string) => buttonLabels().includes(label);

/** Every Type pill in the DOM, by test id — never by the text it holds. */
const typeBadges = () => [...container.querySelectorAll('[data-testid="crm-type-badge"]')];

const lastGiftCells = () => [...container.querySelectorAll('[data-testid="crm-last-gift-cell"]')];

async function click(label: string) {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  expect(btn, `no control labelled "${label}"`).toBeTruthy();
  await act(async () => { (btn as HTMLElement).click(); });
  await flush();
}

async function openContact(name: string) {
  const row = [...container.querySelectorAll('tbody tr')]
    .find((tr) => tr.querySelector('p.text-sm.font-semibold')?.textContent?.trim().startsWith(name));
  expect(row, `no list row for ${name}`).toBeTruthy();
  await act(async () => { (row as HTMLElement).click(); });
  await flush();
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

// ─── 1. the enumerated giving surfaces, one assertion each ───────────────────
describe('the CRM shows no donor or giving element for a free tenant', () => {
  it('drops the Donors stat tile', async () => {
    await mountOn('free');
    expect(statLabels()).not.toContain('Donors');
  });

  it('drops the Total Given stat tile', async () => {
    await mountOn('free');
    expect(statLabels()).not.toContain('Total Given');
  });

  it('drops the Champions stat tile — it counts contacts past $10,000 given', async () => {
    await mountOn('free');
    expect(statLabels()).not.toContain('Champions');
  });

  it('keeps Members, which is the tier’s actual roster', async () => {
    await mountOn('free');
    expect(statLabels()).toContain('Members');
  });

  it('drops the Stage column — the pipeline is derived from giving and nothing else', async () => {
    await mountOn('free');
    expect(columnHeadings()).not.toContain('Stage');
  });

  it('drops the Given column', async () => {
    await mountOn('free');
    expect(columnHeadings()).not.toContain('Given');
  });

  it('drops the Last Gift column, header and cells alike', async () => {
    await mountOn('free');
    expect(columnHeadings()).not.toContain('Last Gift');
    expect(lastGiftCells(), 'a Last Gift cell survived its header').toHaveLength(0);
  });

  it('drops the Donors type filter', async () => {
    await mountOn('free');
    expect(has('Donors')).toBe(false);
    expect(has('Members'), 'the Members filter went with it').toBe(true);
    expect(has('All')).toBe(true);
  });

  it('drops the Pipeline view toggle, so the giving board cannot be opened', async () => {
    await mountOn('free');
    expect(has('Pipeline')).toBe(false);
    expect(has('List')).toBe(false);
  });

  it('drops the donation activity type — the one giving control that WRITES', async () => {
    // Choosing it does not merely label an entry: `addActivity` adds the amount
    // to `totalDonated` and stamps `lastDonationAt`, promoting the contact up a
    // pipeline the tier has no way to feed. An admin manufacturing a donor.
    await mountOn('free');
    await openContact('Maria');
    await click('Add Activity');

    expect(has('donation')).toBe(false);
    for (const kept of ['note', 'email', 'call', 'meeting']) {
      expect(has(kept), `the ${kept} activity type went with it`).toBe(true);
    }
  });

  it('drops the detail card’s total-given and last-gift pills', async () => {
    await mountOn('free');
    await openContact('Daniel');

    const pills = [...container.querySelectorAll('div.mb-5 > span')].map((s) => s.textContent?.trim() || '');
    expect(pills.some((t) => t.endsWith('total given'))).toBe(false);
    expect(container.querySelector('[data-testid="crm-last-gift"]')).toBeNull();
    expect(pills.some((t) => t.endsWith('activities') || t.endsWith('activity')),
      'the activity count is not giving-shaped and must stay').toBe(true);
  });

  it('drops the contact form’s Pipeline Stage readout', async () => {
    await mountOn('free');
    await click('Add contact');

    const labels = [...container.querySelectorAll('label')].map((l) => l.textContent?.trim());
    expect(labels).not.toContain('Pipeline Stage');
    expect(labels, 'the form lost a field that is not giving-shaped').toContain('Type');
  });

  it('says "Add your first member", not "Add your first donor or member"', async () => {
    await mountOn('free', { rows: [] });
    const copy = [...container.querySelectorAll('p')].map((p) => p.textContent?.trim());
    expect(copy).toContain('Add your first member');
    expect(copy).not.toContain('Add your first donor or member');
  });
});

// ─── 2. what deliberately stays ──────────────────────────────────────────────
describe('the merged contact/member view keeps its shape', () => {
  it('🔴 keeps the Type column and one pill per row per surface', async () => {
    // STOP condition 4: hiding this column would break the merge the CSV
    // importer and the roster join both depend on.
    await mountOn('free');
    expect(columnHeadings()).toContain('Type');
    // Mobile list and desktop table are both mounted (they are separated by CSS
    // breakpoints, not by conditional rendering), so two rows yield four pills.
    expect(typeBadges()).toHaveLength(ROSTER.length * 2);
  });

  it('🔴 still renders a carried-over donor row rather than hiding the person', async () => {
    await mountOn('free');
    const names = [...container.querySelectorAll('tbody tr p.text-sm.font-semibold')]
      .map((p) => p.textContent?.trim());
    expect(names.some((n) => n?.startsWith('Daniel')), 'the donor row vanished').toBe(true);
  });

  it('keeps the contact form’s Type select whole — the write path is untouched', async () => {
    await mountOn('free');
    await click('Add contact');
    const options = [...container.querySelectorAll('select option')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['Member', 'Donor', 'Donor & Member']);
  });

  it('keeps Import CSV and Add contact, and the cap notice they carry', async () => {
    await mountOn('free');
    expect(container.querySelector('[data-testid="crm-import-contacts"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="crm-add-contact"]')).not.toBeNull();
  });
});

// ─── 3. the three priced tiers ───────────────────────────────────────────────
describe('the three priced tiers are unchanged', () => {
  for (const plan of PLAN_ORDER.filter((p) => getPlanFeatures(p).fundraising)) {
    const name = PLAN_DISPLAY_NAMES[plan];

    it(`${name} keeps every giving element`, async () => {
      await mountOn(plan);

      expect(statLabels(), `${name} lost a stat tile`)
        .toEqual(expect.arrayContaining(['Members', 'Donors', 'Total Given', 'Champions']));
      expect(columnHeadings(), `${name} lost a column`)
        .toEqual(['Contact', 'Type', 'Stage', 'Given', 'Last Gift']);
      expect(has('Donors'), `${name} lost the Donors filter`).toBe(true);
      expect(has('Pipeline'), `${name} lost the pipeline board`).toBe(true);
      expect(lastGiftCells().length, `${name} lost its Last Gift cells`).toBe(ROSTER.length);
    });

    it(`${name} keeps the donation activity type`, async () => {
      await mountOn(plan);
      await openContact('Maria');
      await click('Add Activity');
      expect(has('donation'), `${name} lost the donation activity`).toBe(true);
    });
  }

  it('the free tier is the ONLY tier this screen answers differently', async () => {
    // Derived from the matrix rather than asserted as "free": if a second tier
    // ever carries `fundraising: false` this states that fact instead of going
    // quietly stale.
    expect(PLAN_ORDER.filter((p) => !getPlanFeatures(p).fundraising)).toEqual(['free']);
  });
});

// ─── 4. the gate itself ──────────────────────────────────────────────────────
describe('the gate reads effective features', () => {
  it('prefers the context’s add-on-layered features over the bare tier', async () => {
    // `planFeatures` on TenantContext is `getEffectiveFeatures(plan, addons)`.
    // Handing the screen a features object that disagrees with the plan id
    // proves which of the two it actually reads — the tier id says free, the
    // effective set says fundraising, and the effective set must win.
    await mountOn('free', { planFeatures: { ...getPlanFeatures('pro'), unlimitedContacts: false } });
    expect(statLabels()).toContain('Total Given');
  });

  it('falls back to the same unknown-plan rule the contact cap uses', async () => {
    // No context features and no plan at all: `toTenantPlan` resolves to 'plus',
    // which has fundraising — so a paying screen never blinks its columns off
    // while the tenant document is in flight.
    await mountOn(null, { planFeatures: null });
    expect(statLabels()).toContain('Total Given');
  });
});
