import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROVISIONED_TENANT_OWNER_ROLE,
  ROLE_CHURCH_ADMIN,
  ROLE_MEMBER,
  ROLE_SUPER_ADMIN,
} from '../../lib/roles';

/**
 * THE-219 — a FREE tenant's admin, on its own subdomain, sees the right nav.
 *
 * 🔴 THE POINT OF THIS FILE IS THAT THE ROLE WAS NEVER THE PROBLEM.
 *
 * THE-219 was reported as a free admin seeing only Dashboard and an empty More
 * drawer, and the suspicion was that free provisioning had written a role value
 * (`'admin'`) that the readers did not recognise. It had not: `'admin'` is what
 * ALL THREE provisioning paths write (see `lib/roles.ts` and
 * `lib/__tests__/provisioning-roles.test.ts`), and given the tenant context it
 * was always meant to have, that account's nav is correct.
 *
 * What was wrong was WHERE the account was standing — apex `/admin`, where
 * there is no tenant, so the roster is never asked and `hasFullAccess` is false.
 * That is fixed in App.tsx and pinned by `App.free-signup-landing.test.tsx`.
 * These tests hold the other half: put the same free admin on its own
 * subdomain and the nav is whole.
 *
 * ⚠️ AND THAT NO ROLE'S ENTITLEMENT MOVED. `role: 'admin'` is deliberately
 * roster-DEPENDENT (`AdminDashboard.hasRosterIndependentAccess` names it), and
 * "fixing" THE-219 by promoting it to roster-independent full access would have
 * been a permission change wearing a bug fix's clothes. The table below is the
 * entitlement as it stands, asserted by identity LABEL.
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
  'Fundraising', 'Events', 'Notes', 'CRM', 'Accounting', 'Forms', 'Check-In', 'Livestream',
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

describe('2 — a free admin sees the correct nav on its subdomain', () => {
  it('a free admin sees the correct nav on its subdomain', async () => {
    // The account exactly as free provisioning leaves it: role 'admin', on its
    // own tenant, listed in that tenant's roster (`adminEmails: [userEmail]`).
    store.current = { tenantPlan: 'free', currentTenantId: TENANT_ID, isAuthReady: true };
    checkRosterAdminStatus.mockResolvedValue('admin');

    await mount({ role: PROVISIONED_TENANT_OWNER_ROLE, permissions: {} });
    await flush();

    const labels = navLabels();
    // 🔴 The founder's report, inverted. Not "Dashboard and an empty More".
    for (const tab of ['Dashboard', 'CRM', 'Blog', 'Courses', 'Community', 'Settings']) {
      expect(labels.has(tab), `expected "${tab}" in a free admin's nav`).toBe(true);
    }
    expect(labels.size, 'the nav collapsed to the founder\'s Dashboard-only view').toBeGreaterThan(4);
  });

  it('THE SYMPTOM: the same free admin with no tenant resolved gets the collapsed nav', async () => {
    // Apex `/admin`: no tenant, so the roster lookup never issues and cannot
    // grant. This is what the founder saw — correct for where they stood, which
    // is why the fix is the landing and not this component.
    store.current = { tenantPlan: 'free', currentTenantId: null, isAuthReady: true };
    checkRosterAdminStatus.mockResolvedValue('admin');

    await mount({ role: PROVISIONED_TENANT_OWNER_ROLE, permissions: {} });
    await flush();

    const labels = navLabels();
    expect(labels.has('Dashboard')).toBe(true);
    expect(labels.has('CRM'), 'the apex resolved a tenant it does not have').toBe(false);
    expect(checkRosterAdminStatus, 'the roster was asked about a tenant that is not there').not.toHaveBeenCalled();
  });
});

/* ── 6 ─────────────────────────────────────────────────────────────────────── */

describe("6 — no role's permissions changed", () => {
  /**
   * Every identity that reaches the nav, by LABEL, with the entitlement it held
   * before THE-219. `sees` is a tab that must be present, `denied` one that must
   * not — chosen so a widened OR-chain fails rather than passing by accident.
   */
  const IDENTITIES: Array<{
    label: string;
    who: { role: string; permissions: Record<string, boolean> };
    roster: 'admin' | 'not-admin';
    superAdmin: boolean;
    sees: string[];
    denied: string[];
  }> = [
    {
      label: "the provisioned tenant owner, listed in its tenant's roster",
      who: { role: PROVISIONED_TENANT_OWNER_ROLE, permissions: {} },
      roster: 'admin', superAdmin: false,
      sees: ['Dashboard', 'CRM', 'Settings'], denied: [],
    },
    {
      label: 'the provisioned owner role ALONE, absent from the roster — roster-dependent by design',
      who: { role: PROVISIONED_TENANT_OWNER_ROLE, permissions: {} },
      roster: 'not-admin', superAdmin: false,
      sees: ['Dashboard'], denied: ['CRM', 'Settings', 'Blog'],
    },
    {
      label: 'the legacy tenant-owner label — roster-INdependent, as it always was',
      who: { role: ROLE_CHURCH_ADMIN, permissions: {} },
      roster: 'not-admin', superAdmin: false,
      sees: ['Dashboard', 'CRM', 'Settings'], denied: [],
    },
    {
      label: 'a roster-only admin with no role at all (THE-64)',
      who: { role: ROLE_MEMBER, permissions: {} },
      roster: 'admin', superAdmin: false,
      sees: ['Dashboard', 'CRM', 'Settings'], denied: [],
    },
    {
      label: 'a single-permission admin — one tab, not the estate',
      who: { role: ROLE_MEMBER, permissions: { writeArticles: true } },
      roster: 'not-admin', superAdmin: false,
      sees: ['Dashboard', 'Blog'], denied: ['CRM', 'Settings'],
    },
    {
      label: 'a plain member with nothing',
      who: { role: ROLE_MEMBER, permissions: {} },
      roster: 'not-admin', superAdmin: false,
      sees: ['Dashboard'], denied: ['CRM', 'Settings', 'Blog'],
    },
    {
      label: 'the super admin',
      who: { role: ROLE_SUPER_ADMIN, permissions: {} },
      roster: 'not-admin', superAdmin: true,
      sees: ['Dashboard', 'CRM', 'Settings', 'Tenants'], denied: [],
    },
  ];

  it.each(IDENTITIES)("no role's permissions changed — $label", async ({ who, roster, superAdmin, sees, denied }) => {
    isSuperAdminMock.mockReturnValue(superAdmin);
    checkRosterAdminStatus.mockResolvedValue(roster);

    await mount(who);
    await flush();

    const labels = navLabels();
    for (const tab of sees) expect(labels.has(tab), `expected "${tab}"`).toBe(true);
    for (const tab of denied) expect(labels.has(tab), `"${tab}" was granted to an identity that never had it`).toBe(false);
  });

  it('the roster-independent set is still exactly super admin, the legacy label, or explicit fullAccess', () => {
    // 🔴 Read as source because it is a claim about the OR-CHAIN, not about one
    // identity: adding `|| userRole === PROVISIONED_TENANT_OWNER_ROLE` here is
    // the specific permission change THE-219 must not make, and it would pass
    // every behavioural assertion above that grants rather than denies.
    const src = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');
    expect(src).toContain(
      "const hasRosterIndependentAccess = isSuperAdmin || userRole === 'church_admin' || !!perms.fullAccess;",
    );
    expect(src).toContain("const hasFullAccess = isSuperAdmin || isChurchAdmin || perms.fullAccess;");
  });
});
