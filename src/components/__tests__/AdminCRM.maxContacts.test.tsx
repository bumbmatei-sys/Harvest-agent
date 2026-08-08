import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCRM from '../AdminCRM';
import type { Contact, CRMCounts } from '../../hooks/queries/useCRMQueries';
import { SUPER_ADMIN_EMAILS } from '../../utils/super-admins';
import { getPlanFeatures } from '../../utils/plan-features';

/**
 * REP-6 — `maxContacts` enforced as a SOFT cap on the CRM.
 *
 * Soft is the whole design. Accounts arrive by member SELF-SIGNUP, and a visitor
 * who is turned away cannot fix it, cannot upgrade the plan, and has no idea
 * why — so signup is never blocked (pinned separately, in
 * AuthPage.signup-not-capped.test.tsx). What IS gated is the one creation path
 * an admin controls: the manual add form on this screen.
 *
 * The other half is what the cap counts. Donors who gave through the public
 * donate page have a `contacts` row and no account; those rows are what giving
 * statements and tax receipts are built from, so they stay VISIBLE and stay
 * UNCOUNTED. The cap consumes `memberAccounts` — #279's server-side `users`
 * aggregate — and nothing else.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  navigate, authFetch, notifyError, invalidateQueries,
  contactsResult, countsResult, tenantCtx, headerAction, writes,
} = vi.hoisted(() => ({
  navigate: vi.fn(),
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ connected: false }) })),
  notifyError: vi.fn(),
  invalidateQueries: vi.fn(async () => {}),
  contactsResult: { current: { data: [] as unknown[], isLoading: false, isError: false, error: null, refetch: vi.fn() } },
  countsResult: { current: { data: undefined as unknown } },
  tenantCtx: { tenantPlan: undefined as string | undefined },
  headerAction: { node: null as React.ReactNode },
  // Every Firestore write this screen can make. An over-cap tenant must produce
  // NONE of them from the add path — and the cap must never delete anything.
  writes: { added: [] as unknown[], set: [] as unknown[], deleted: [] as unknown[] },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async (_c: unknown, data: unknown) => { writes.added.push(data); return { id: 'a1' }; }),
  deleteDoc: vi.fn(async (ref: unknown) => { writes.deleted.push(ref); }),
  setDoc: vi.fn(async (_r: unknown, data: unknown) => { writes.set.push(data); }),
  doc: () => ({}),
  serverTimestamp: () => 'SERVER_TS',
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false }),
}));
// The header action is a rendered node handed to a context, so capture it and
// render it for real — its disabled state is half of what this PR ships.
vi.mock('../AdminScreenHeader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../AdminScreenHeader')>()),
  useAdminHeader: () => ({
    setHeaderAction: (node: React.ReactNode) => { headerAction.node = node; },
    setHeaderOverride: () => {},
  }),
}));
vi.mock('../AnalyticsAndRoles', () => ({ default: () => null }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenantCtx }));
// Only the data hooks are stubbed. contact-capacity.ts and PLAN_FEATURES stay
// REAL, so the numbers this screen enforces are the numbers the plan matrix
// publishes — a hand-written 150 here would let the two drift apart silently.
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => contactsResult.current,
  useCRMCounts: () => countsResult.current,
  useContactActivities: () => ({
    data: [], isLoading: false, isError: false, error: null, refetch: () => {},
  }),
}));

const base = (over: Partial<Contact> & { id: string }): Contact => ({
  firstName: 'A', lastName: 'Person', email: 'a@example.org', phone: '',
  type: 'member', notes: '', tags: [], totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: 'u1', updatedAt: null, tenantId: 't1',
  ...over,
});

/** A row backed by a `users` doc — someone who holds an account. */
const accountRow = (i: number, over: Partial<Contact> = {}, role = 'user'): Contact => {
  const email = (over.email as string) ?? `member${i}@church.org`;
  return base({
    id: `u${i}`, firstName: 'Member', lastName: `N${i}`, email, type: 'member',
    account: { role, email },
    ...over,
  });
};

/** A donor-only row — gave via the public donate page, never signed up. */
const donorRow = (i: number): Contact =>
  base({
    id: `d${i}`, firstName: 'Donor', lastName: `D${i}`,
    email: `donor${i}@example.org`, type: 'donor', totalDonated: 25,
    // No `account`: mergeContactsWithUsers found no `users` doc for them.
  });

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

/** Render whatever the screen published into the shared header slot. */
async function mountHeaderAction(): Promise<HTMLElement> {
  const slot = document.createElement('div');
  document.body.appendChild(slot);
  const slotRoot = createRoot(slot);
  await act(async () => { slotRoot.render(<>{headerAction.node}</>); });
  headerSlots.push({ slot, slotRoot });
  return slot;
}
const headerSlots: Array<{ slot: HTMLDivElement; slotRoot: Root }> = [];

const addButton = () =>
  container.querySelector('[data-testid="crm-add-contact"]') as HTMLButtonElement | null;

const limitNotice = () =>
  container.querySelector('[data-testid="crm-contact-limit"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const bodyText = () => (container.textContent ?? '').replace(/\s+/g, ' ');

const click = async (el: HTMLElement) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

/** Fill the add form's only required field and press its save button. */
async function fillAndSave(firstName: string) {
  const input = container.querySelector('input[placeholder="First name"]') as HTMLInputElement
    ?? (container.querySelectorAll('input')[0] as HTMLInputElement);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, firstName);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const save = Array.from(container.querySelectorAll('button'))
    .find(b => /add contact|save changes/i.test(b.textContent ?? '')) as HTMLButtonElement;
  await click(save);
}

beforeEach(() => {
  vi.clearAllMocks();
  contactsResult.current = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  countsResult.current = { data: undefined };
  tenantCtx.tenantPlan = undefined;
  headerAction.node = null;
  writes.added = []; writes.set = []; writes.deleted = [];
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  for (const { slot, slotRoot } of headerSlots.splice(0)) {
    await act(async () => { slotRoot.unmount(); });
    slot.remove();
  }
  container.remove();
});

// ── 2 ── OVER THE CAP: THE ADMIN'S ADD PATH IS CLOSED, AND SAYS WHY ──────────
describe('a tenant over its cap', () => {
  beforeEach(() => {
    // Individual (150). 150 accounts loaded and counted server-side.
    tenantCtx.tenantPlan = 'plus';
    contactsResult.current = {
      data: Array.from({ length: 150 }, (_, i) => accountRow(i)),
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    countsResult.current = { data: counts({ memberAccounts: 150, contactRecords: 0 }) };
  });

  it('disables the manual-add button and explains why on hover', async () => {
    await mountCRM();
    const btn = addButton()!;
    expect(btn).not.toBeNull();
    // Disabled, not HIDDEN. An admin who cannot find the button learns nothing.
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/upgrade your plan/i);
  });

  it('disables the header "Add Contact" action too — both entry points, or neither', async () => {
    await mountCRM();
    const slot = await mountHeaderAction();
    const headerBtn = slot.querySelector('button') as HTMLButtonElement;
    expect(headerBtn.textContent).toContain('Add Contact');
    expect(headerBtn.disabled).toBe(true);
    expect(headerBtn.title).toMatch(/upgrade your plan/i);
  });

  it('refuses to open the form even if the button is clicked', async () => {
    await mountCRM();
    await click(addButton()!);
    // Still on the list: the form's save button never appears. Filling in a form
    // and failing on save is the shape this gate exists to avoid.
    expect(addButton()).not.toBeNull();
    expect(writes.added).toHaveLength(0);
  });

  it('states the limit on screen, once, with the count in use', async () => {
    await mountCRM();
    const notice = limitNotice();
    expect(notice).toMatch(/150 member accounts in use/);
    expect(notice).toMatch(/upgrade your plan/i);
    // Said once — not repeated as a running meter elsewhere on the screen.
    expect(container.querySelectorAll('[data-testid="crm-contact-limit"]')).toHaveLength(1);
  });

  // ── 9 ── NO PRICE, NO ADD-ON ──────────────────────────────────────────────
  it('the at-cap copy names no price and offers no add-on', async () => {
    await mountCRM();
    const notice = limitNotice()!;
    expect(notice).not.toMatch(/\$/);
    expect(notice).not.toMatch(/add-?on|per month|\/mo|\bbuy\b|purchase/i);
    expect(notice).not.toMatch(/\b(20|59)\b/);
    // And nowhere else on the screen either.
    expect(bodyText()).not.toMatch(/\$20|\$59/);
  });

  it('says the people already here keep their place, and that signup still works', async () => {
    await mountCRM();
    const notice = limitNotice()!;
    expect(notice).toMatch(/everyone already here stays/i);
    expect(notice).toMatch(/create their own accounts/i);
    // Nothing is removed to get under the cap.
    expect(writes.deleted).toHaveLength(0);
  });

  it('leaves existing contacts editable — the cap blocks creation, not management', async () => {
    await mountCRM();
    // Open the first person…
    const row = Array.from(container.querySelectorAll('button'))
      .find(b => /Member N0/.test(b.textContent ?? ''))!;
    await click(row as HTMLElement);

    const edit = container.querySelector('[data-testid="crm-edit-contact"]') as HTMLButtonElement;
    expect(edit).not.toBeNull();
    expect(edit.disabled).toBe(false);

    // …and their edit actually saves. An over-cap tenant stays manageable, not
    // frozen: this is the upsert path, and it adds no account.
    await click(edit);
    await fillAndSave('Renamed');
    expect(writes.set).toHaveLength(1);
    expect(writes.set[0]).toMatchObject({ firstName: 'Renamed' });
    expect(writes.added).toHaveLength(0);
    expect(notifyError).not.toHaveBeenCalled();
  });
});

// ── 3 ── UNDER THE CAP: NOTHING CHANGES ─────────────────────────────────────
describe('a tenant under its cap', () => {
  beforeEach(() => {
    tenantCtx.tenantPlan = 'pro'; // Small Team — 500
    contactsResult.current = {
      data: Array.from({ length: 3 }, (_, i) => accountRow(i)),
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    countsResult.current = { data: counts({ memberAccounts: 3 }) };
  });

  it('manual add works unchanged, and writes the contact', async () => {
    await mountCRM();
    expect(addButton()!.disabled).toBe(false);
    expect(limitNotice()).toBeNull();

    await click(addButton()!);
    await fillAndSave('Ruth');

    expect(writes.added).toHaveLength(1);
    expect(writes.added[0]).toMatchObject({ firstName: 'Ruth', tenantId: 't1' });
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('shows no limit notice', async () => {
    await mountCRM();
    expect(limitNotice()).toBeNull();
  });
});

// ── 4 + 5 ── DONORS: UNCOUNTED, BUT VISIBLE ─────────────────────────────────
describe('donors without an account', () => {
  beforeEach(() => {
    // Individual (150). 149 accounts and 500 donor-only rows — UNDER the cap.
    tenantCtx.tenantPlan = 'plus';
    contactsResult.current = {
      data: [
        ...Array.from({ length: 500 }, (_, i) => donorRow(i)),
        ...Array.from({ length: 149 }, (_, i) => accountRow(i)),
      ],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    countsResult.current = {
      data: counts({ memberAccounts: 149, contactRecords: 500 }),
    };
  });

  it('are not counted: 149 accounts + 500 donor rows is under the 150 cap', async () => {
    await mountCRM();
    // The gate is open and nothing on screen claims a limit was reached.
    expect(addButton()!.disabled).toBe(false);
    expect(limitNotice()).toBeNull();
  });

  it('and adding a contact by hand still works there', async () => {
    await mountCRM();
    await click(addButton()!);
    await fillAndSave('Naomi');
    expect(writes.added).toHaveLength(1);
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('are still VISIBLE in the list — giving statements and tax receipts need them', async () => {
    await mountCRM();
    // Not hidden, not filtered out, not greyed: they render like anyone else.
    expect(bodyText()).toContain('Donor D0');
    expect(bodyText()).toContain('donor0@example.org');
    expect(bodyText()).toContain('Donor D499');
  });
});

// ── 6 ── SUPER ADMINS ARE EXCLUDED ──────────────────────────────────────────
describe('a super admin inside the tenant', () => {
  it('does not consume the church’s capacity', async () => {
    tenantCtx.tenantPlan = 'plus'; // 150
    // 150 `users` docs in scope, but one of them is Harvest staff → 149 spent.
    contactsResult.current = {
      data: [
        accountRow(0, { email: SUPER_ADMIN_EMAILS[0], firstName: 'Harvest', lastName: 'Staff' }),
        ...Array.from({ length: 149 }, (_, i) => accountRow(i + 1)),
      ],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    countsResult.current = { data: counts({ memberAccounts: 150 }) };

    await mountCRM();
    expect(addButton()!.disabled).toBe(false);
    expect(limitNotice()).toBeNull();
  });

  it('is still listed — excluded from the COUNT, never from the CRM', async () => {
    tenantCtx.tenantPlan = 'plus';
    contactsResult.current = {
      data: [accountRow(0, { email: SUPER_ADMIN_EMAILS[0], firstName: 'Harvest', lastName: 'Staff' })],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    countsResult.current = { data: counts({ memberAccounts: 1 }) };

    await mountCRM();
    expect(bodyText()).toContain('Harvest Staff');
  });

  it('the second listed platform owner is exempt too, not just the first', async () => {
    tenantCtx.tenantPlan = 'plus';
    contactsResult.current = {
      data: [
        accountRow(0, { email: SUPER_ADMIN_EMAILS[1] }),
        ...Array.from({ length: 149 }, (_, i) => accountRow(i + 1)),
      ],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    countsResult.current = { data: counts({ memberAccounts: 150 }) };

    await mountCRM();
    expect(addButton()!.disabled).toBe(false);
  });
});

// ── 7 ── THE OWNER COUNTS ───────────────────────────────────────────────────
describe('the plan owner', () => {
  it('counts: an Individual tenant whose 150th account is the owner is AT the cap', async () => {
    tenantCtx.tenantPlan = 'plus';
    contactsResult.current = {
      data: [
        accountRow(0, { email: 'pastor@church.org', firstName: 'The', lastName: 'Owner' }, 'admin'),
        ...Array.from({ length: 149 }, (_, i) => accountRow(i + 1)),
      ],
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    countsResult.current = { data: counts({ memberAccounts: 150 }) };

    await mountCRM();
    expect(addButton()!.disabled).toBe(true);
    expect(limitNotice()).toMatch(/150 member accounts in use/);
  });
});

// ── 8 ── THE NUMBER COMES FROM THE PLAN MATRIX ──────────────────────────────
describe('each plan enforces its own published allowance', () => {
  it.each([
    ['plus', 150],
    ['pro', 500],
    ['max', 2_000],
  ] as const)('%s is capped at %i — the PLAN_FEATURES cell, not a literal', async (plan, expected) => {
    expect(getPlanFeatures(plan).maxContacts).toBe(expected);
    tenantCtx.tenantPlan = plan;

    // One under: open.
    countsResult.current = { data: counts({ memberAccounts: expected - 1 }) };
    contactsResult.current = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
    await mountCRM();
    expect(addButton()!.disabled).toBe(false);
    await act(async () => { root.unmount(); });

    // Exactly at it: closed.
    countsResult.current = { data: counts({ memberAccounts: expected }) };
    await mountCRM();
    expect(addButton()!.disabled).toBe(true);
    expect(limitNotice()).toContain(expected.toLocaleString());
  });

  it('an unknown / still-loading plan falls back to Individual (150)', async () => {
    tenantCtx.tenantPlan = undefined;
    countsResult.current = { data: counts({ memberAccounts: 150 }) };
    await mountCRM();
    expect(addButton()!.disabled).toBe(true);
  });
});

// ── THE COUNT'S OWN FAILURE MODES ───────────────────────────────────────────
describe('when the count is missing', () => {
  it('does not block: a failed or still-loading aggregate is not evidence of being over', async () => {
    tenantCtx.tenantPlan = 'plus';
    contactsResult.current = {
      data: Array.from({ length: 400 }, (_, i) => accountRow(i)),
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    };
    countsResult.current = { data: undefined }; // useCRMCounts errored or is pending

    await mountCRM();
    expect(addButton()!.disabled).toBe(false);
    expect(limitNotice()).toBeNull();
  });

  it('does not gate the platform-wide super-admin view, whose counts span every church', async () => {
    // On the apex domain the `users` count is UNSCOPED — it is every church's
    // accounts. A 150 cap against that would lock the platform CRM immediately.
    tenantCtx.tenantPlan = 'plus';
    countsResult.current = { data: counts({ memberAccounts: 40_000, platformWide: true }) };
    await mountCRM();
    expect(addButton()!.disabled).toBe(false);
    expect(limitNotice()).toBeNull();
  });
});
