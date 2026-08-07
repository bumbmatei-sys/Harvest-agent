import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * AFFILIATE_PROGRAM_ENABLED — the admin-side surfaces.
 *
 * The affiliate programme pays 15% of subscription revenue for 12 months, and
 * subscription billing is mid-migration from Stripe to Dodo Payments (a merchant
 * of record), which changes the payout rail end to end. Until that lands, no
 * user-facing surface may invite anyone to join the programme or show them a
 * dashboard — while every backend route, lib and webhook branch keeps running,
 * because commission is still accruing on existing referrals.
 *
 * Both directions are tested, against the SAME mounts:
 *   · flag OFF — no nav entry and no section, for a tenant admin, an admin whose
 *     only grant is `manageAffiliate`, AND a super admin. `/admin/affiliate`
 *     typed or bookmarked renders no dashboard.
 *   · flag ON  — every one of those comes back, unchanged.
 *
 * The second half is the reversibility proof: hiding this feature is only
 * defensible because one boolean brings it back in full.
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
vi.mock('../AnalyticsAndRoles', () => ({ normalizePermissions: (raw: unknown) => raw }));
vi.mock('../AdminScreenHeader', async () => {
  const React = await import('react');
  return {
    AdminScreenHeader: () => null,
    AdminHeaderContext: React.createContext({
      setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderHidden: () => {},
    }),
  };
});

// The one screen this file is about gets a detectable stub; every other admin
// screen is a leaf.
vi.mock('../AffiliateSection', () => ({
  default: () => <div data-testid="affiliate-section" />,
}));
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

/**
 * Load AdminDashboard with AFFILIATE_PROGRAM_ENABLED forced to `enabled`.
 *
 * The rest of plan-features comes through `importActual`, so the plan matrix,
 * pricing and every other accessor stay real — only the one boolean moves.
 * That is what makes the ON half a genuine reversibility proof rather than a
 * differently-configured app.
 */
async function loadDashboard(enabled: boolean) {
  vi.resetModules();
  vi.doMock('../../utils/plan-features', async () => {
    const actual = await vi.importActual<typeof import('../../utils/plan-features')>(
      '../../utils/plan-features'
    );
    return { ...actual, AFFILIATE_PROGRAM_ENABLED: enabled };
  });
  return (await import('../AdminDashboard')).default;
}

/** Is there a nav button labelled exactly "Affiliate"? */
function hasAffiliateNavEntry(): boolean {
  return Array.from(container.querySelectorAll('button')).some(
    (b) => (b.textContent?.trim() ?? '') === 'Affiliate'
  );
}

const hasAffiliateSection = () => !!container.querySelector('[data-testid="affiliate-section"]');

type Who = { role?: string; permissions?: Record<string, boolean>; superAdmin?: boolean };

/** The three admins who can currently reach the affiliate entry at all. */
const WHOS: { name: string; who: Who }[] = [
  { name: 'a tenant admin with full access', who: { role: 'user', permissions: { fullAccess: true } } },
  { name: 'an admin whose only grant is manageAffiliate', who: { role: 'admin', permissions: { manageAffiliate: true } } },
  { name: 'a super admin', who: { role: 'user', permissions: {}, superAdmin: true } },
];

async function mount(enabled: boolean, who: Who, opts: { section?: string } = {}) {
  isSuperAdminMock.mockReturnValue(!!who.superAdmin);
  params.current = opts.section ? { section: opts.section } : {};
  userQuery.current = {
    data: { role: who.role ?? 'user', permissions: who.permissions ?? {}, displayName: 'B', email: 'bumb@theharvest.app' },
    isLoading: false,
  };
  const AdminDashboard = await loadDashboard(enabled);
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminDashboard onNavigate={() => {}} />);
  });
  mounted = true;
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  store.current = { tenantPlan: 'max', currentTenantId: TENANT_ID, isAuthReady: true };
  currentUser.current = { uid: UID };
  isSuperAdminMock.mockReturnValue(false);
  hasPlatformOverrideMock.mockReturnValue(false);
  // Settled 'admin' so nobody in this file is stuck behind the roster skeleton.
  checkRosterAdminStatus.mockResolvedValue('admin');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (mounted) { mounted = false; await act(async () => { root.unmount(); }); }
  container.remove();
  vi.doUnmock('../../utils/plan-features');
});

describe('AFFILIATE_PROGRAM_ENABLED === false — nothing invites anyone into the programme', () => {
  for (const { name, who } of WHOS) {
    it(`shows no Affiliate nav entry to ${name}`, async () => {
      await mount(false, who);
      expect(hasAffiliateNavEntry()).toBe(false);
    });

    it(`renders no affiliate section at /admin/affiliate for ${name}`, async () => {
      await mount(false, who, { section: 'affiliate' });
      expect(hasAffiliateSection()).toBe(false);
      // The dashboard's own copy — referral link, earnings, "Set Up Payouts
      // with Stripe" — must be nowhere on the page either.
      expect(container.textContent).not.toMatch(/referral link|Set Up Payouts|commission/i);
    });
  }

  it('still renders the rest of the nav — this hides one entry, not the dashboard', async () => {
    await mount(false, { role: 'user', permissions: { fullAccess: true } });
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels).toContain('Dashboard');
    expect(labels).toContain('Settings');
  });
});

describe('AFFILIATE_PROGRAM_ENABLED === true — every hidden surface comes back', () => {
  for (const { name, who } of WHOS) {
    it(`restores the Affiliate nav entry for ${name}`, async () => {
      await mount(true, who);
      expect(hasAffiliateNavEntry()).toBe(true);
    });

    it(`restores the affiliate section at /admin/affiliate for ${name}`, async () => {
      await mount(true, who, { section: 'affiliate' });
      expect(hasAffiliateSection()).toBe(true);
    });
  }

  it('leaves the permission gate behind the flag intact — an admin with neither grant still gets nothing', async () => {
    // No roster grant either, so `hasFullAccess` is genuinely false: the only
    // thing that could surface the entry is `manageAffiliate`, and it is unset.
    checkRosterAdminStatus.mockResolvedValue('not-admin');
    await mount(true, { role: 'user', permissions: { writeArticles: true } });
    expect(hasAffiliateNavEntry()).toBe(false);
    // Sanity: this admin IS entitled to something, so the nav really rendered.
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels).toContain('Blog');
  });
});
