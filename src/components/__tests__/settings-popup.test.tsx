import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdminDashboard from '../AdminDashboard';
import { SETTINGS_LEGACY_SECTIONS_ENABLED } from '../../lib/settings-legacy-sections';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = join(process.cwd());
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const TENANT_ID = 'bumb';
const UID = 'user-1';

const navigate = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: {} as { section?: string; itemId?: string } }));
const checkRosterAdminStatus = vi.hoisted(() => vi.fn());
const isSuperAdminMock = vi.hoisted(() => vi.fn(() => false));
const hasPlatformOverrideMock = vi.hoisted(() => vi.fn(() => false));
const store = vi.hoisted(() => ({
  current: { tenantPlan: 'pro' as string | null, currentTenantId: 'bumb' as string | null, isAuthReady: true },
}));
const currentUser = vi.hoisted(() => ({ current: { uid: 'user-1', email: 'bumb@theharvest.app', displayName: 'B', photoURL: null, providerData: [{ providerId: 'password' }], getIdToken: async () => 't' } as Record<string, unknown> | null }));
const userQuery = vi.hoisted(() => ({ current: { data: undefined as unknown, isLoading: false } }));
const tenantCtx = vi.hoisted(() => ({
  current: {
    branding: null as null,
    isLoading: false,
    tenantPlan: 'pro' as string | null,
    tenantAddons: undefined as { socialScheduler?: number } | undefined,
    refreshBranding: () => {},
  },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useParams: () => params.current }));
vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdminStatus }));
vi.mock('../../utils/tenant-scope', () => ({
  isSuperAdmin: isSuperAdminMock,
  hasPlatformOverride: hasPlatformOverrideMock,
  getTenantScope: async () => TENANT_ID,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store.current }));
vi.mock('../../hooks/queries/useUserQueries', () => ({ useCurrentUser: () => userQuery.current }));
vi.mock('../../hooks/queries/useDocsQueries', () => ({
  useDocs: () => ({ data: { items: [], truncated: false }, isLoading: false }),
}));
vi.mock('../../hooks/queries/useCRMQueries', () => ({
  useContacts: () => ({ data: [], isLoading: false }),
  CRM_FETCH_LIMIT: 200,
}));
vi.mock('../../hooks/queries/useEventQueries', () => ({
  useEvents: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../hooks/queries/useTenantQueries', () => ({
  useTenant: () => ({ data: { name: 'Bumb Ministry', ownerId: UID } }),
}));
vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => tenantCtx.current,
  useTenantOptional: () => tenantCtx.current,
}));
vi.mock('../../firebase', () => ({
  db: {},
  get auth() { return { get currentUser() { return currentUser.current; } }; },
}));
vi.mock('firebase/auth', () => ({
  signOut: vi.fn(async () => {}),
  updateProfile: vi.fn(async () => {}),
  updatePassword: vi.fn(async () => {}),
  EmailAuthProvider: { credential: vi.fn() },
  reauthenticateWithCredential: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), query: () => ({}), where: () => ({}), limit: () => ({}),
  onSnapshot: () => () => {},
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: TENANT_ID, displayName: 'B' }) }),
  updateDoc: vi.fn(),
}));
vi.mock('../../utils/firestore-errors', () => ({ OperationType: { GET: 'get' }, handleFirestoreError: () => {} }));
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

const stub = vi.hoisted(() => () => ({ default: () => null }));
vi.mock('../AdminBlog', stub);
vi.mock('../PlatformInbox', stub);
vi.mock('../AdminChurches', stub);
vi.mock('../AdminCourses', stub);
vi.mock('../AdminRAG', stub);
vi.mock('../AdminTenants', stub);
vi.mock('../AdminLibraryCourses', stub);
vi.mock('../AdminUpgradePage', stub);
vi.mock('../AdminBranding', stub);
vi.mock('../AffiliateSection', stub);
vi.mock('../NewsletterEditor', stub);
vi.mock('../NewsletterCampaigns', stub);
vi.mock('../CanvasList', stub);
vi.mock('../CanvasEditor', stub);
vi.mock('../AdminNavCustomizer', stub);
vi.mock('../FocusScreen', stub);
vi.mock('../AdminFundraising', stub);
vi.mock('../AdminDonations', stub);
vi.mock('../AdminCRM', stub);
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
vi.mock('../PlanUpgradeScreen', stub);
vi.mock('../Profile', stub);
vi.mock('../BillingAndPayments', stub);
vi.mock('../GraceWindowBanner', stub);
vi.mock('../settings/BrandingSection', () => ({
  default: () => React.createElement('div', { 'data-stub': 'branding' }),
}));
vi.mock('../settings/PlanUpgradeSection', () => ({
  default: ({ hideUpgrade }: { hideUpgrade?: boolean }) =>
    (hideUpgrade ? null : React.createElement('div', { 'data-stub': 'plans' })),
}));
vi.mock('../settings/OnboardingSection', () => ({
  default: () => React.createElement('div', { 'data-stub': 'onboarding' }),
}));
vi.mock('../settings/GivingStatementsSection', () => ({
  default: () => React.createElement('div', { 'data-stub': 'giving' }),
}));
vi.mock('../ThemeToggle', () => ({
  default: () => React.createElement('div', { role: 'radiogroup', 'aria-label': 'Colour theme' }),
}));

let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

const FULL_TENANT_PERMS = {
  manageBlog: true, manageCourses: true, manageNewsletter: true, uploadRag: true,
  manageDocs: true, manageCrm: true, manageSignups: true, manageChurches: true,
  manageCommunity: true, manageServices: true, manageFundraising: true,
  manageDonations: true, manageForms: true, manageAccounting: true, manageEvents: true,
  manageCheckin: true, manageSms: true, manageLivestream: true, manageSettings: true,
};

function setDesktop() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const max = /max-width:\s*(\d+)px/.exec(query);
      const matches = min ? 1440 >= Number(min[1]) : max ? 1440 <= Number(max[1]) : false;
      return {
        matches,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
        onchange: null,
      };
    },
  });
}

function setMobile() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const max = /max-width:\s*(\d+)px/.exec(query);
      const matches = min ? 390 >= Number(min[1]) : max ? 390 <= Number(max[1]) : false;
      return {
        matches,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
        onchange: null,
      };
    },
  });
}

async function mount(user: Record<string, unknown> = {}) {
  isSuperAdminMock.mockReturnValue(false);
  hasPlatformOverrideMock.mockReturnValue(false);
  userQuery.current = {
    data: {
      role: 'owner',
      permissions: FULL_TENANT_PERMS,
      displayName: 'B',
      email: 'bumb@theharvest.app',
      ...user,
    },
    isLoading: false,
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminDashboard onNavigate={() => {}} />);
  });
  mounted = true;
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  store.current = { tenantPlan: 'pro', currentTenantId: TENANT_ID, isAuthReady: true };
  tenantCtx.current = { branding: null, isLoading: false, tenantPlan: 'pro', tenantAddons: undefined, refreshBranding: () => {} };
  currentUser.current = { uid: UID, email: 'bumb@theharvest.app', displayName: 'B', photoURL: null, providerData: [{ providerId: 'password' }], getIdToken: async () => 't' };
  checkRosterAdminStatus.mockResolvedValue(true);
  params.current = {};
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount(); });
  mounted = false;
  container.remove();
});

describe('desktop Settings popup from the sidebar', () => {
  it('opens the popup from the sidebar Settings entry instead of rendering the page', async () => {
    setDesktop();
    await mount();
    const avatar = container.querySelector<HTMLElement>(
      '[data-nav-rail-account] button[aria-label="My account"]',
    );
    expect(avatar, 'no account avatar in the sidebar').toBeTruthy();
    await act(async () => { avatar!.click(); });
    await flush();
    const settingsRow = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((b) => b.textContent?.trim() === 'Settings');
    expect(settingsRow, 'the account menu has no Settings row').toBeTruthy();
    await act(async () => { settingsRow!.click(); });
    await flush();
    expect(navigate).toHaveBeenCalledWith('/admin/settings');

    if (mounted) await act(async () => { root.unmount(); });
    mounted = false;
    container.innerHTML = '';
    params.current = { section: 'settings' };
    await mount();
    expect(document.querySelector('[data-settings-popup]'), 'the desktop popup did not open').toBeTruthy();
    expect(container.querySelector('[data-settings-navigation]'), 'the mobile Settings page rendered on desktop').toBeNull();
  });

  it('opens the deep-linked section on desktop', async () => {
    setDesktop();
    window.history.replaceState({}, '', '/admin/settings?section=billing');
    params.current = { section: 'settings' };
    await mount();
    expect(document.querySelector('[data-settings-popup]')).toBeTruthy();
    expect(document.querySelector('[data-settings-section="billing"]')).toBeTruthy();
  });

  it('keeps the full Settings page on phones, including Customize Navigation', async () => {
    setMobile();
    params.current = { section: 'settings' };
    await mount();
    expect(document.querySelector('[data-settings-popup]')).toBeNull();
    expect(container.textContent).toContain('Customize Navigation');
  });

  it('hides SMS, Integrations and Donations on both shells', async () => {
    expect(SETTINGS_LEGACY_SECTIONS_ENABLED).toBe(false);
    setMobile();
    params.current = { section: 'settings' };
    await mount();
    const mobile = container.textContent || '';
    expect(mobile).not.toContain('Donations & payment links');
    expect(mobile).not.toMatch(/\bSMS\b/);
    expect(mobile).not.toContain('Integrations');

    if (mounted) await act(async () => { root.unmount(); });
    mounted = false;
    container.innerHTML = '';
    setDesktop();
    params.current = { section: 'settings' };
    await mount();
    const desktop = document.body.textContent || '';
    expect(desktop).not.toContain('Donations & payment links');
    expect(desktop).not.toContain('Customize Navigation');
  });

  it('wires the popup from AdminDashboard rather than a hand-rolled replacement', () => {
    const src = read('src/components/AdminDashboard.tsx');
    expect(src).toContain("import { SettingsDialog } from './settings/SettingsDialog'");
    expect(src, 'Home no longer renders behind the popup on lg').toMatch(/activeTab === 'dashboard' \|\| \(activeTab === 'settings' && lgUp\)/);
    expect(src).toMatch(/\{lgUp && canSettings && \(\s*<SettingsDialog/);
    const dialog = read('src/components/settings/SettingsDialog.tsx');
    expect(dialog).toContain('SidebarProvider');
    expect(dialog).toContain('DialogContent');
    expect(dialog).toContain('Breadcrumb');
  });
});

describe('closing the desktop Settings popup', () => {
  const close = async () => {
    const x = document.querySelector<HTMLElement>('[data-settings-popup] [data-slot="dialog-close"]');
    expect(x, 'the popup has no close button').toBeTruthy();
    navigate.mockClear();
    await act(async () => { x!.click(); });
    await flush();
  };

  it('goes back to the screen the admin came from when there is one', async () => {
    setDesktop();
    window.history.replaceState({ idx: 2 }, '', '/admin/settings');
    params.current = { section: 'settings' };
    await mount();
    expect(document.querySelector('[data-settings-popup]')).toBeTruthy();
    await close();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('falls back to the dashboard on a cold deep link, leaving /admin/settings', async () => {
    setDesktop();
    window.history.replaceState({ idx: 0 }, '', '/admin/settings');
    params.current = { section: 'settings' };
    await mount();
    await close();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/admin', { replace: true });
  });
});

describe('desktop Settings popup gating', () => {
  it('gives an admin without manageSettings no popup and sends them elsewhere', async () => {
    setDesktop();
    window.history.replaceState({ idx: 0 }, '', '/admin/settings');
    checkRosterAdminStatus.mockResolvedValue(false);
    params.current = { section: 'settings' };
    await mount({ role: 'admin', permissions: { manageBlog: true } });
    expect(document.querySelector('[data-settings-popup]'), 'a member without canSettings got the popup').toBeNull();
    expect(navigate, 'the member was left on /admin/settings').toHaveBeenCalled();
    const targets = navigate.mock.calls.map((c) => c[0]);
    expect(targets).not.toContain('/admin/settings');
    expect(targets.every((t) => typeof t === 'string' && t.startsWith('/admin'))).toBe(true);
  });

  it('shows the plan cards to the owner and hides them from an admin who is not', async () => {
    setDesktop();
    window.history.replaceState({}, '', '/admin/settings?section=billing');
    params.current = { section: 'settings' };
    await mount();
    expect(document.querySelector('[data-settings-section="billing"]')).toBeTruthy();
    expect(document.querySelector('[data-stub="plans"]'), 'the owner lost the plan cards').toBeTruthy();

    if (mounted) await act(async () => { root.unmount(); });
    mounted = false;
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    checkRosterAdminStatus.mockResolvedValue(false);
    currentUser.current = { ...currentUser.current, uid: 'someone-else' };
    await mount({ role: 'church_admin' });
    await flush();
    expect(document.querySelector('[data-settings-section="billing"]')).toBeTruthy();
    expect(document.querySelector('[data-stub="plans"]'), 'a non-owner was offered the plan cards').toBeNull();
  });
});
