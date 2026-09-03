import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';

/**
 * THE-64 — the admin nav and the tenant admin roster.
 *
 * A tenant admin whose access comes ONLY from the tenant's admin roster (their
 * `role` is not an admin role and `permissions` is empty) was locked out of
 * every admin tab in production. The roster moved off the public tenant doc to
 * an async API in #262, and the new lookup defaulted to plain `false` — which
 * the nav could not tell apart from a settled "no". So for the width of one
 * fetch the dashboard rendered as if the user were entitled to nothing, and the
 * "unknown tab → first allowed tab" redirect fired on that empty nav and threw
 * them back to /admin.
 *
 * The invariant these tests hold: while the roster is unresolved AND the answer
 * could change what the user sees, the nav is not rendered at all. It is never
 * rendered partially, and a resolved answer is never taken back.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT_ID = 'bumb';
const UID = 'user-1';

const navigate = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: {} as { section?: string; itemId?: string } }));
const checkRosterAdminStatus = vi.hoisted(() => vi.fn());
const isSuperAdminMock = vi.hoisted(() => vi.fn(() => false));
const hasPlatformOverrideMock = vi.hoisted(() => vi.fn(() => false));
const store = vi.hoisted(() => ({
  current: { tenantPlan: 'max' as string | null, currentTenantId: 'bumb' as string | null, isAuthReady: true },
}));
const currentUser = vi.hoisted(() => ({ current: { uid: 'user-1' } as { uid: string } | null }));
const userQuery = vi.hoisted(() => ({
  current: { data: undefined as unknown, isLoading: false },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => params.current,
}));
vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdminStatus }));
vi.mock('../../utils/tenant-scope', () => ({
  isSuperAdmin: isSuperAdminMock,
  hasPlatformOverride: hasPlatformOverrideMock,
  getTenantScope: async () => TENANT_ID,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store.current }));
vi.mock('../../hooks/queries/useUserQueries', () => ({ useCurrentUser: () => userQuery.current }));
vi.mock('../../hooks/queries/useTenantQueries', () => ({
  useTenant: () => ({ data: { name: 'Bumb Ministry', ownerId: 'someone-else' } }),
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
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  onSnapshot: () => () => {},
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get' },
  handleFirestoreError: () => {},
}));
// normalizePermissions is a pure shape-normaliser; the tests already pass
// normalised permission objects, so a passthrough is faithful here.
vi.mock('../AdminRoles', () => ({ normalizePermissions: (raw: unknown) => raw }));
vi.mock('../AdminScreenHeader', async () => {
  const React = await import('react');
  return {
    AdminScreenHeader: () => null,
    AdminHeaderContext: React.createContext({
      setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderHidden: () => {},
    }),
  };
});

// Every admin screen is a leaf here — only the active tab's screen mounts, and
// none of them are what this file is about.
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
vi.mock('../MyAccountMenu', stub);
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

/** Every tab label currently reachable in the nav (mobile bar ∪ desktop sidebar). */
const ALL_TAB_LABELS = [
  'Dashboard', 'Church', 'Church List', 'Courses', 'Blog', 'AI Knowledge', 'Newsletter',
  'Fundraising', 'Events', 'Notes', 'CRM', 'Signups', 'Accounting', 'Forms', 'Check-In', 'Livestream',
  'SMS', 'Community', 'Library', 'Tenants', 'Affiliate', 'Branding', 'Settings', 'More',
];
function navLabels(): Set<string> {
  const found = new Set<string>();
  container.querySelectorAll('button').forEach((b) => {
    const text = b.textContent?.trim() ?? '';
    if (ALL_TAB_LABELS.includes(text)) found.add(text);
  });
  return found;
}

/** True while the dashboard is showing its loading skeleton (no nav rendered). */
const isSkeleton = () => container.querySelector('.animate-spin') !== null;

type Who = { role?: string; permissions?: Record<string, boolean> };

async function mount(who: Who, opts: { section?: string } = {}) {
  params.current = opts.section ? { section: opts.section } : {};
  userQuery.current = {
    data: { role: who.role ?? 'user', permissions: who.permissions ?? {}, displayName: 'B', email: 'bumb@theharvest.app' },
    isLoading: false,
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminDashboard onNavigate={() => {}} />);
  });
  mounted = true;
}

/** Re-render in place, so a store change is seen by the mounted component. */
async function rerender() {
  await act(async () => { root.render(<AdminDashboard onNavigate={() => {}} />); });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  store.current = { tenantPlan: 'max', currentTenantId: TENANT_ID, isAuthReady: true };
  currentUser.current = { uid: UID };
  isSuperAdminMock.mockReturnValue(false);
  hasPlatformOverrideMock.mockReturnValue(false);
  checkRosterAdminStatus.mockResolvedValue('not-admin');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (mounted) { mounted = false; await act(async () => { root.unmount(); }); }
  container.remove();
  vi.useRealTimers();
});

describe('AdminDashboard — roster-only tenant admin (THE-64)', () => {
  // ── 1. The end-to-end regression ──────────────────────────────────────────
  it('gives a roster-only admin the full entitled nav and keeps them on the tab they opened', async () => {
    checkRosterAdminStatus.mockResolvedValue('admin');
    // No admin role, no permissions, not a super admin — access is the roster only.
    await mount({ role: 'user', permissions: {} }, { section: 'crm' });
    await flush();

    const labels = navLabels();
    for (const tab of ['Dashboard', 'CRM', 'Blog', 'Courses', 'Community', 'Settings']) {
      expect(labels.has(tab), `expected "${tab}" in the nav`).toBe(true);
    }
    // The bounce: /admin/crm must not be rewritten back to /admin.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lets a roster-only admin open every entitled tab without being redirected', async () => {
    checkRosterAdminStatus.mockResolvedValue('admin');
    for (const section of ['crm', 'blog', 'courses', 'community']) {
      navigate.mockClear();
      await mount({ role: 'user', permissions: {} }, { section });
      await flush();
      expect(navigate, `/admin/${section} bounced`).not.toHaveBeenCalled();
      mounted = false;
      await act(async () => { root.unmount(); });
    }
  });

  // ── 2. The precise defect: the intermediate state ─────────────────────────
  it('renders no nav at all while the roster is unresolved, never a partial tab set', async () => {
    const gate = deferred<string>();
    checkRosterAdminStatus.mockReturnValue(gate.promise);

    await mount({ role: 'user', permissions: {} }, { section: 'crm' });
    await flush();

    // Mid-flight. This is the window the production bug rendered a one-tab nav in.
    expect(isSkeleton()).toBe(true);
    expect(navLabels().size).toBe(0);
    // And crucially: no redirect fired off the not-yet-known entitlement.
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => { gate.resolve('admin'); });
    await flush();

    // Settled: the full nav appears in one step, still on /admin/crm.
    expect(isSkeleton()).toBe(false);
    expect(navLabels().has('CRM')).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  // ── 3. A resolved answer is never revoked ─────────────────────────────────
  it('keeps a resolved roster grant when tenantId or currentUser blips falsy', async () => {
    checkRosterAdminStatus.mockResolvedValue('admin');
    await mount({ role: 'user', permissions: {} });
    await flush();
    expect(navLabels().has('CRM')).toBe(true);

    // Navigation blip: the store's tenant id is momentarily null.
    store.current = { ...store.current, currentTenantId: null };
    await rerender();
    expect(navLabels().has('CRM'), 'nav collapsed on a transient falsy tenantId').toBe(true);

    store.current = { ...store.current, currentTenantId: TENANT_ID };
    await rerender();
    expect(navLabels().has('CRM')).toBe(true);

    // Same again for a momentarily absent auth.currentUser.
    currentUser.current = null;
    await rerender();
    expect(navLabels().has('CRM'), 'nav collapsed on a transient falsy currentUser').toBe(true);

    currentUser.current = { uid: UID };
    await rerender();
    expect(navLabels().has('CRM')).toBe(true);
  });

  // ── 4. Admins who do not need the roster are never delayed ────────────────
  it('renders a super admin immediately without waiting on the roster lookup', async () => {
    // A lookup that never answers — if the gate were unconditional this hangs.
    checkRosterAdminStatus.mockReturnValue(new Promise(() => {}));
    isSuperAdminMock.mockReturnValue(true);

    await mount({ role: 'user', permissions: {} }, { section: 'crm' });
    await flush();

    expect(isSkeleton()).toBe(false);
    expect(navLabels().has('CRM')).toBe(true);
    expect(navLabels().has('Tenants')).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders a role-based admin immediately without waiting on the roster lookup', async () => {
    checkRosterAdminStatus.mockReturnValue(new Promise(() => {}));

    await mount({ role: 'church_admin', permissions: {} }, { section: 'crm' });
    await flush();

    expect(isSkeleton()).toBe(false);
    expect(navLabels().has('CRM')).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders a fullAccess-permission admin immediately without waiting on the roster lookup', async () => {
    checkRosterAdminStatus.mockReturnValue(new Promise(() => {}));

    await mount({ role: 'user', permissions: { fullAccess: true } }, { section: 'crm' });
    await flush();

    expect(isSkeleton()).toBe(false);
    expect(navLabels().has('CRM')).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  // ── 5. A genuine non-admin gains nothing ──────────────────────────────────
  it('still gives a genuine non-admin no admin tabs', async () => {
    checkRosterAdminStatus.mockResolvedValue('not-admin');
    await mount({ role: 'user', permissions: {} });
    await flush();

    const labels = navLabels();
    expect(labels.has('Dashboard')).toBe(true);
    for (const tab of ['CRM', 'Blog', 'Courses', 'Community', 'Settings', 'Tenants']) {
      expect(labels.has(tab), `"${tab}" must not be offered to a non-admin`).toBe(false);
    }
  });

  it('does not let a partial-permission admin gain tabs the roster did not grant', async () => {
    checkRosterAdminStatus.mockResolvedValue('not-admin');
    await mount({ role: 'user', permissions: { writeArticles: true } });
    await flush();

    const labels = navLabels();
    expect(labels.has('Blog')).toBe(true);
    expect(labels.has('CRM')).toBe(false);
  });

  // ── 6. A failed lookup: fails closed, and says so ─────────────────────────
  it('fails closed and warns when the roster lookup errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    checkRosterAdminStatus.mockResolvedValue('error');

    await mount({ role: 'user', permissions: { writeArticles: true } });
    await flush();

    // Fails closed: the user keeps exactly their permission-derived access, and
    // gains nothing from a roster that could not be read.
    expect(isSkeleton()).toBe(false);
    expect(navLabels().has('Blog')).toBe(true);
    expect(navLabels().has('CRM')).toBe(false);
    // And it is no longer invisible.
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some(([m]) => String(m).includes('roster lookup'))).toBe(true);
    warn.mockRestore();
  });

  it('degrades to a reduced nav rather than a permanent skeleton when the lookup hangs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    checkRosterAdminStatus.mockReturnValue(new Promise(() => {}));

    await mount({ role: 'user', permissions: { writeArticles: true } });
    await act(async () => { await Promise.resolve(); });
    expect(isSkeleton()).toBe(true);

    await act(async () => { vi.advanceTimersByTime(6001); });

    expect(isSkeleton()).toBe(false);
    expect(navLabels().has('Blog')).toBe(true);
    expect(warn.mock.calls.some(([m]) => String(m).includes('timed out'))).toBe(true);
    warn.mockRestore();
    vi.useRealTimers();
  });
});
