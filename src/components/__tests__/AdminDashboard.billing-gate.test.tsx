import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';

/**
 * THE-83 — the client owner gate and the admin roster.
 *
 * The server's `requireOwner` (src/lib/api-auth.ts) admits THREE identities for
 * every /api/billing/* route: the buyer by `tenants/{id}.ownerId`, an
 * owner-by-roster from `tenant_private.adminEmails`, and the super admin. The
 * client gated the Billing & Payments menu item on `ownerId` alone, so a roster
 * admin was authorised for every billing route and could not see the door that
 * reaches them. The entitlement existed; only the way in was hidden.
 *
 * The roster is server-only (`tenant_private` is `allow read, write: if false`),
 * so it is an ASYNC answer where `ownerId` was a synchronous field read. That
 * substitution is precisely what THE-64 cost: a lookup defaulting to `false`
 * reads as a settled "no", and the UI renders a denial on data it does not
 * have. The invariant these tests hold is therefore twofold —
 *
 *   1. all three server-authorised identities can reach Billing, and
 *   2. while the roster is unresolved, Billing is NEVER rendered as absent.
 *
 * Items are addressed by their visible label, never by position.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT_ID = 'bumb';
const UID = 'user-1';
const MY_EMAIL = 'bumb@theharvest.app';
/** Another admin on the same tenant's roster. Must never reach the client. */
const OTHER_ADMIN_EMAIL = 'other-admin@theharvest.app';

const BILLING_LABEL = 'Billing & Payments';

const navigate = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: {} as { section?: string } }));
const checkRosterAdminStatus = vi.hoisted(() => vi.fn());
const isSuperAdminMock = vi.hoisted(() => vi.fn(() => false));
const hasPlatformOverrideMock = vi.hoisted(() => vi.fn(() => false));
const authFetchMock = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({
  current: { tenantPlan: 'max' as string | null, currentTenantId: 'bumb' as string | null, isAuthReady: true },
}));
const currentUser = vi.hoisted(() => ({ current: { uid: 'user-1' } as { uid: string } | null }));
const userQuery = vi.hoisted(() => ({ current: { data: undefined as unknown, isLoading: false } }));
/** The tenant doc as the dashboard sees it — `ownerId` is the buyer's uid. */
const tenantDoc = vi.hoisted(() => ({
  current: { data: { name: 'Bumb Ministry', ownerId: 'someone-else' } as Record<string, unknown> },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => params.current,
}));
vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdminStatus }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: authFetchMock }));
vi.mock('../../utils/tenant-scope', () => ({
  isSuperAdmin: isSuperAdminMock,
  hasPlatformOverride: hasPlatformOverrideMock,
  getTenantScope: async () => TENANT_ID,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store.current }));
vi.mock('../../hooks/queries/useUserQueries', () => ({ useCurrentUser: () => userQuery.current }));
vi.mock('../../hooks/queries/useTenantQueries', () => ({
  useTenant: () => tenantDoc.current,
}));
vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => ({ branding: null, isLoading: false, tenantPlan: 'max' }),
}));
vi.mock('../../firebase', () => ({
  db: {},
  get auth() { return { get currentUser() { return currentUser.current; } }; },
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(async () => {}) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: () => ({}),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  getDocs: async () => ({ docs: [] }),
  deleteDoc: async () => {},
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  onSnapshot: () => () => {},
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get' },
  handleFirestoreError: () => {},
}));
vi.mock('../AnalyticsAndRoles', () => ({ normalizePermissions: (raw: unknown) => raw }));
// The mobile header also mounts a MyAccountMenu; stubbing it leaves exactly one
// account menu in the tree so "the Billing item" is unambiguous.
vi.mock('../AdminScreenHeader', async () => {
  const React = await import('react');
  return {
    AdminScreenHeader: () => null,
    AdminHeaderContext: React.createContext({
      setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderHidden: () => {},
    }),
  };
});

// Every admin screen is a leaf here. MyAccountMenu is deliberately NOT stubbed —
// it is the surface under test.
const stub = vi.hoisted(() => () => ({ default: () => null }));
vi.mock('../AdminBlog', stub);
vi.mock('../PlatformInbox', stub);
vi.mock('../AdminChurches', stub);
vi.mock('../AdminCourses', stub);
vi.mock('../AdminRAG', stub);
vi.mock('../AdminTenants', stub);
vi.mock('../AdminLibraryCourses', stub);
vi.mock('../AdminSettings', stub);
vi.mock('../AdminUpgradePage', stub);
vi.mock('../AdminBranding', stub);
vi.mock('../AdminDashboardHome', stub);
vi.mock('../AffiliateSection', stub);
vi.mock('../NewsletterEditor', stub);
vi.mock('../NewsletterCampaigns', stub);
vi.mock('../CanvasList', stub);
vi.mock('../CanvasEditor', stub);
vi.mock('../AdminNavCustomizer', stub);
vi.mock('../FocusScreen', stub);
vi.mock('../AdminFundraising', stub);
vi.mock('../AdminCRM', stub);
vi.mock('../AdminDocs', stub);
vi.mock('../AdminCommunity', stub);
vi.mock('../AdminAccounting', stub);
vi.mock('../AdminForms', stub);
vi.mock('../AdminCheckin', stub);
vi.mock('../AdminLivestream', stub);
vi.mock('../AdminSms', stub);
vi.mock('../AdminEvents', stub);
vi.mock('../PlanUpgradeScreen', stub);
vi.mock('../Profile', stub);
vi.mock('../BillingAndPayments', stub);

let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
};

/** A promise the test resolves by hand, to hold the roster lookup open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Open the account menu (the avatar dropdown that carries the Billing item). */
async function openAccountMenu() {
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="My account"]');
  expect(trigger, 'the account menu trigger should be rendered').not.toBeNull();
  await act(async () => { trigger!.click(); });
  await flush();
}

/**
 * The account-menu item carrying `label`, found BY ITS LABEL — never by
 * position, so re-ordering the menu cannot silently retarget these tests.
 */
function menuItemByLabel(label: string): HTMLElement | null {
  const menu = container.querySelector('[role="menu"]');
  if (!menu) return null;
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  return items.find((el) => (el.textContent ?? '').trim().startsWith(label)) ?? null;
}

type Who = { role?: string; permissions?: Record<string, boolean> };

async function mount(who: Who) {
  params.current = {};
  userQuery.current = {
    data: { role: who.role ?? 'user', permissions: who.permissions ?? {}, displayName: 'B', email: MY_EMAIL },
    isLoading: false,
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminDashboard onNavigate={() => {}} />);
  });
  mounted = true;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.current = { tenantPlan: 'max', currentTenantId: TENANT_ID, isAuthReady: true };
  currentUser.current = { uid: UID };
  tenantDoc.current = { data: { name: 'Bumb Ministry', ownerId: 'someone-else' } };
  isSuperAdminMock.mockReturnValue(false);
  hasPlatformOverrideMock.mockReturnValue(false);
  checkRosterAdminStatus.mockResolvedValue('not-admin');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (mounted) { mounted = false; await act(async () => { root.unmount(); }); }
  container.remove();
});

describe('AdminDashboard — who can reach Billing & Payments (THE-83)', () => {
  // ── The three identities the server already authorises ────────────────────

  it('shows Billing to the tenant owner by ownerId', async () => {
    tenantDoc.current = { data: { name: 'Bumb Ministry', ownerId: UID } };
    // The roster says no: this owner's access comes from ownerId alone.
    checkRosterAdminStatus.mockResolvedValue('not-admin');
    await mount({ role: 'church_admin', permissions: { fullAccess: true } });
    await flush();
    await openAccountMenu();

    const item = menuItemByLabel(BILLING_LABEL);
    expect(item, `expected "${BILLING_LABEL}" in the account menu`).not.toBeNull();
    expect(item!.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('shows Billing to a roster admin who is not the ownerId', async () => {
    // 🔴 The regression test for THE-83. Someone else bought the plan, so
    // `ownerId` is not this user — their owner rights come from the tenant's
    // admin roster, exactly as `requireOwner` grants them server-side.
    tenantDoc.current = { data: { name: 'Bumb Ministry', ownerId: 'someone-else' } };
    checkRosterAdminStatus.mockResolvedValue('admin');
    await mount({ role: 'user', permissions: {} });
    await flush();
    await openAccountMenu();

    const item = menuItemByLabel(BILLING_LABEL);
    expect(item, `a roster admin must be able to reach "${BILLING_LABEL}"`).not.toBeNull();
    expect(item!.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('shows Billing to a super admin', async () => {
    isSuperAdminMock.mockReturnValue(true);
    tenantDoc.current = { data: { name: 'Bumb Ministry', ownerId: 'someone-else' } };
    checkRosterAdminStatus.mockResolvedValue('not-admin');
    await mount({ role: 'super_admin', permissions: { fullAccess: true } });
    await flush();
    await openAccountMenu();

    const item = menuItemByLabel(BILLING_LABEL);
    expect(item, `a super admin must be able to reach "${BILLING_LABEL}"`).not.toBeNull();
    expect(item!.getAttribute('aria-disabled')).not.toBe('true');
  });

  // ── The identity the server refuses ───────────────────────────────────────

  it('hides Billing from an ordinary tenant admin who is neither', async () => {
    // A volunteer with the admin role: not the buyer, not on the roster. The
    // server would 403 them on every /api/billing/* route, so the item is a
    // settled absence — not a placeholder, not a disabled row.
    tenantDoc.current = { data: { name: 'Bumb Ministry', ownerId: 'someone-else' } };
    checkRosterAdminStatus.mockResolvedValue('not-admin');
    await mount({ role: 'admin', permissions: { manageSettings: true } });
    await flush();
    await openAccountMenu();

    expect(container.querySelector('[role="menu"]'), 'the menu should be open').not.toBeNull();
    // Addressed by label: some other item is still expected to be there.
    expect(menuItemByLabel('My Profile')).not.toBeNull();
    expect(menuItemByLabel(BILLING_LABEL)).toBeNull();
  });

  // ── The unknown window (THE-64) ───────────────────────────────────────────

  it('does not render Billing as unavailable while the roster answer is pending', async () => {
    // 🔴 The THE-64 test, and the one worth more than the rest.
    //
    // This admin holds `fullAccess`, so their NAV does not wait on the roster —
    // it is identical whichever way the roster answers. Their Billing row is
    // not: the roster can still turn it on. So the dashboard renders in full
    // with the roster answer still in flight, which is exactly the window in
    // which a `false` default would render a denial the client cannot back.
    const gate = deferred<string>();
    checkRosterAdminStatus.mockReturnValue(gate.promise);
    tenantDoc.current = { data: { name: 'Bumb Ministry', ownerId: 'someone-else' } };
    await mount({ role: 'church_admin', permissions: { fullAccess: true } });
    await flush();
    await openAccountMenu();

    // The roster has NOT answered yet.
    const pending = menuItemByLabel(BILLING_LABEL);
    expect(
      pending,
      `"${BILLING_LABEL}" must not be rendered as absent while the roster is unresolved`,
    ).not.toBeNull();
    // …and it is rendered as an unresolved affordance, not an actionable row:
    // an unknown answer must not open billing either.
    expect(pending!.getAttribute('aria-busy')).toBe('true');
    expect(pending!.getAttribute('aria-disabled')).toBe('true');

    // Now the roster answers "yes" — the placeholder becomes the real item.
    await act(async () => { gate.resolve('admin'); });
    await flush();
    const settled = menuItemByLabel(BILLING_LABEL);
    expect(settled).not.toBeNull();
    expect(settled!.getAttribute('aria-busy')).not.toBe('true');
    expect(settled!.getAttribute('aria-disabled')).not.toBe('true');
  });

  // ── The roster stays server-side ──────────────────────────────────────────

  it("never exposes another admin's email to the client", async () => {
    checkRosterAdminStatus.mockResolvedValue('admin');
    await mount({ role: 'user', permissions: {} });
    await flush();
    await openAccountMenu();

    // The client asks only "am I on it?", scoped to one tenant id. It never
    // sends, receives, or renders anybody else's identity.
    expect(checkRosterAdminStatus).toHaveBeenCalledWith(TENANT_ID);
    for (const call of checkRosterAdminStatus.mock.calls) {
      expect(call).toEqual([TENANT_ID]);
    }
    const text = container.textContent ?? '';
    expect(text).not.toContain(OTHER_ADMIN_EMAIL);
    // Nothing that looks like a foreign address leaked in either — the only
    // address the admin dashboard may show is the signed-in admin's own. Take
    // that one out first (textContent concatenates adjacent nodes, so a raw
    // match would otherwise catch it glued to its neighbours) and nothing
    // address-shaped may remain.
    const withoutOwnEmail = text.split(MY_EMAIL).join(' ');
    expect(withoutOwnEmail.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? []).toEqual([]);
  });

  it('reduces the roster response to a boolean about the caller alone', async () => {
    // The gate's data source, unmocked: even if /api/tenants/roster-status ever
    // answered with more than it should, the client helper keeps only the
    // caller's own yes/no. The roster itself has no path into the UI.
    const { checkRosterAdminStatus: real } = await vi.importActual<
      typeof import('../../utils/tenant.utils')
    >('../../utils/tenant.utils');
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ isRosterAdmin: true, adminEmails: [OTHER_ADMIN_EMAIL] }),
    });

    const status = await real(TENANT_ID);

    expect(status).toBe('admin');
    expect(JSON.stringify(status)).not.toContain(OTHER_ADMIN_EMAIL);
  });
});
