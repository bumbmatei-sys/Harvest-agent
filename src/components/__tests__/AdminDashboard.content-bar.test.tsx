import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';

/**
 * The desktop content bar is wired in AdminDashboard, not in AdminContentBar.
 * Home is the only route with no section. Every other route crumbs its sidebar
 * group. A screen that publishes Back keeps its own title beside that control.
 *
 * These render the dashboard. A unit test of sectionForTab stays green if the
 * two lines that pass section and title into the bar are swapped or dropped.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT_ID = 'bumb';

const navigate = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: {} as { section?: string } }));
const headerProbe = vi.hoisted(() => ({
  current: null as null | { title: string; onBack: () => void },
}));
const store = vi.hoisted(() => ({
  current: { tenantPlan: 'max' as string | null, currentTenantId: 'bumb' as string | null, isAuthReady: true },
}));
const currentUser = vi.hoisted(() => ({ current: { uid: 'user-1' } as { uid: string } | null }));
const userQuery = vi.hoisted(() => ({ current: { data: undefined as unknown, isLoading: false } }));
const tenantDoc = vi.hoisted(() => ({
  current: { data: { name: 'Bumb Ministry', ownerId: 'user-1' } as Record<string, unknown> },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => params.current,
}));
vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdminStatus: vi.fn(async () => 'not-admin') }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: vi.fn() }));
vi.mock('../../utils/tenant-scope', () => ({
  isSuperAdmin: () => false,
  hasPlatformOverride: () => false,
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
vi.mock('../AdminRoles', () => ({ normalizePermissions: (raw: unknown) => raw }));
vi.mock('../inbox/TenantInbox', async () => {
  const React = await import('react');
  return { TenantInbox: () => React.createElement('div', { 'data-tenant-inbox': '' }) };
});
vi.mock('../AdminCRM', async () => {
  const React = await import('react');
  const { useAdminHeader } = await import('../AdminScreenHeader');
  return {
    default: function CrmHeaderProbe() {
      const { setHeaderOverride } = useAdminHeader();
      React.useEffect(() => {
        setHeaderOverride(headerProbe.current);
        return () => setHeaderOverride(null);
      }, [setHeaderOverride]);
      return React.createElement('div', { 'data-crm-probe': '' });
    },
  };
});

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
vi.mock('../admin-shell/AdminHome', () => ({ AdminHome: () => null }));
vi.mock('../AffiliateSection', stub);
vi.mock('../NewsletterEditor', stub);
vi.mock('../NewsletterCampaigns', stub);
vi.mock('../CanvasList', stub);
vi.mock('../CanvasEditor', stub);
vi.mock('../AdminNavCustomizer', stub);
vi.mock('../FocusScreen', stub);
vi.mock('../AdminFundraising', stub);
vi.mock('../AdminDonations', stub);
vi.mock('../AdminSignups', stub);
vi.mock('../AdminDocs', stub);
vi.mock('../AdminCommunity', stub);
vi.mock('../AdminAccounting', stub);
vi.mock('../AdminForms', stub);
vi.mock('../AdminCheckin', stub);
vi.mock('../AdminLivestream', stub);
vi.mock('../AdminSms', stub);
vi.mock('../AdminEvents', stub);
vi.mock('../AdminServices', stub);
vi.mock('../admin/social/SocialScheduler', () => ({ SocialScheduler: () => null }));
vi.mock('../PlanUpgradeScreen', stub);
vi.mock('../Profile', stub);
vi.mock('../BillingAndPayments', stub);

let container: HTMLDivElement;
let root: Root;

function installMedia(lg: boolean) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: lg ? 1280 : 390 });
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width: 1024px') ? lg : query.includes('max-width') ? !lg : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

async function mount(section?: string) {
  params.current = section ? { section } : {};
  userQuery.current = {
    data: { role: 'church_admin', permissions: { fullAccess: true }, displayName: 'B', email: 'bumb@theharvest.app' },
    isLoading: false,
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminDashboard onNavigate={() => {}} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function bar(): HTMLElement {
  const found = container.querySelector<HTMLElement>('[data-admin-content-bar]');
  expect(found, 'the desktop content bar is not mounted').not.toBeNull();
  return found!;
}

function crumbItems(): string[] {
  return [...bar().querySelectorAll('[data-slot="breadcrumb-item"]')].map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
}

beforeEach(() => {
  vi.clearAllMocks();
  headerProbe.current = null;
  installMedia(true);
  store.current = { tenantPlan: 'max', currentTenantId: TENANT_ID, isAuthReady: true };
  currentUser.current = { uid: 'user-1' };
  tenantDoc.current = { data: { name: 'Bumb Ministry', ownerId: 'user-1' } };
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('AdminDashboard content bar wiring', () => {
  it('shows only Home on the dashboard, with no section and no separator', async () => {
    await mount();
    expect(crumbItems()).toEqual(['Home']);
    expect(bar().querySelectorAll('[data-slot="breadcrumb-separator"]')).toHaveLength(0);
    expect(bar().querySelector('[aria-label="Back"]')).toBeNull();
  });

  it('crumbs CRM as People, then CRM', async () => {
    await mount('crm');
    expect(crumbItems()).toEqual(['People', 'CRM']);
    expect(bar().querySelectorAll('[data-slot="breadcrumb-separator"]')).toHaveLength(1);
    const page = bar().querySelector('[data-slot="breadcrumb-page"]');
    expect(page?.textContent).toBe('CRM');
  });

  it('turns a published Back into a clickable parent crumb, with the screen title as the current page and no Back button', async () => {
    const onBack = vi.fn();
    headerProbe.current = { title: 'New Course', onBack };
    await mount('crm');
    expect(bar().querySelector('[aria-label="Back"]'), 'a Back button is back').toBeNull();
    expect(crumbItems()).toEqual(['People', 'CRM', 'New Course']);
    expect(bar().querySelector('[data-slot="breadcrumb-page"]')?.textContent).toBe('New Course');
    const parent = [...bar().querySelectorAll('nav[aria-label="breadcrumb"] button')].find((b) => b.textContent === 'CRM') as HTMLElement | undefined;
    expect(parent, 'the parent crumb is not a link').toBeTruthy();
    await act(async () => { parent!.click(); });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does not mount the desktop bar on a phone, so the payments inbox is not fetched twice', async () => {
    installMedia(false);
    await mount();
    expect(container.querySelector('[data-admin-content-bar]')).toBeNull();
    expect(container.querySelectorAll('[data-tenant-inbox]')).toHaveLength(1);
  });

  it('puts the search pill immediately left of the Community menu, which replaces Open member app', async () => {
    await mount();
    const found = bar();
    const pill = found.querySelector('[data-admin-search-pill]');
    expect(pill, 'the search pill is missing from the content bar').toBeTruthy();
    const menu = found.querySelector('[data-community-menu]');
    expect(menu, 'the Community menu is missing').toBeTruthy();
    expect(pill!.nextElementSibling, 'the pill is not immediately left of the Community menu').toBe(menu);
    expect(found.textContent).not.toContain('Open member app');
    const sidebar = container.querySelector('[data-sidebar="sidebar"]');
    expect(sidebar, 'the desktop sidebar did not mount').toBeTruthy();
    expect(sidebar!.querySelector('button[aria-label="Search"]')).toBeNull();
  });
});
