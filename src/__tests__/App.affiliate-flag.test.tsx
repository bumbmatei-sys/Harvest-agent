import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * AFFILIATE_PROGRAM_ENABLED — the standalone affiliate surface on
 * affiliate.theharvest.app.
 *
 * Hidden, that host falls back to the platform/apex view (MainApp) — the
 * documented pre-Phase-3 behaviour. Enabled, the affiliate dashboard comes back
 * on exactly the same tri-state gate it always had (`userTenantId === null`,
 * resolved AND tenant-less), which is the reversibility proof for this surface.
 *
 * What the flag must NOT move: the routing guard. A confirmed tenant-less user
 * on the affiliate host lands on '/' in BOTH directions, never in the paid
 * church funnel — that is the #253-era incident fix, it lives in
 * `resolvePostAuthFunnelRoute`, and it is deliberately not gated. Every test
 * below asserts the route as well as the component, so a future change that
 * couples them fails here.
 *
 * The flag-OFF routing cases are also covered from the other side in
 * App.post-auth-routing.test.tsx, which owns the incident regression itself.
 */
const state = vi.hoisted(() => ({
  user: null as null | { uid: string; email: string },
  authListeners: [] as Array<(u: unknown) => void>,
  userDoc: null as null | { exists: boolean; data?: Record<string, unknown> },
  userDocError: null as null | Error,
}));

vi.mock('../firebase', () => ({ auth: { currentUser: null }, db: {} }));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    state.authListeners.push(cb);
    Promise.resolve().then(() => cb(state.user));
    return () => {
      const i = state.authListeners.indexOf(cb);
      if (i >= 0) state.authListeners.splice(i, 1);
    };
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ col, id }),
  getDoc: async (ref: { col: string }) => {
    if (ref.col === 'users') {
      if (state.userDocError) throw state.userDocError;
      const d = state.userDoc;
      return { exists: () => !!d?.exists, data: () => d?.data };
    }
    return { exists: () => false, data: () => undefined };
  },
}));

vi.mock('../components/AuthPage', () => ({ default: () => <div data-testid="auth-page" /> }));
vi.mock('../components/MainApp', () => ({ default: () => <div data-testid="main-app" /> }));
vi.mock('../components/AffiliateDashboard', () => ({
  default: () => <div data-testid="affiliate-dashboard" />,
}));
vi.mock('../components/Onboarding', () => ({
  default: () => <div data-testid="member-onboarding" />,
}));
vi.mock('../components/ChurchOnboarding', () => ({
  default: () => <div data-testid="church-onboarding" />,
}));
vi.mock('../components/AdminDashboard', () => ({
  default: () => <div data-testid="admin-dashboard" />,
}));
vi.mock('../components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/OnboardingGate', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/PWAInstallManager', () => ({ default: () => null }));
vi.mock('../components/PostPurchaseWizard', () => ({ default: () => null }));
const tenantCtx = vi.hoisted(() => ({
  tenantId: null,
  isAdminDomain: false,
  error: null,
  isLoading: false,
  setTenantPlan: () => {},
  tenantPlan: null,
}));
vi.mock('../contexts/TenantContext', () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTenant: () => tenantCtx,
}));
vi.mock('../contexts/SavedItemsContext', () => ({
  SavedItemsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../hooks/useClaimsFreshness', () => ({ useClaimsFreshness: () => {} }));
vi.mock('../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', WRITE: 'write', UPDATE: 'update' },
  handleFirestoreError: () => {},
}));
vi.mock('@tanstack/react-query-devtools', () => ({ ReactQueryDevtools: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AFFILIATE_ORIGIN = 'https://affiliate.theharvest.app';
const USER = { uid: 'u1', email: 'affiliate@thetest.com' };

let container: HTMLDivElement;
let root: Root | null = null;

function setURL(url: string) {
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(url);
}

/**
 * Mount App with AFFILIATE_PROGRAM_ENABLED forced to `enabled`. Everything else
 * in plan-features comes through `importActual`, so only the one boolean moves.
 * The store is re-imported inside the same reset cycle — after `resetModules`
 * the App under test holds a fresh store instance, and resetting a stale one
 * would silently do nothing.
 */
async function mount(enabled: boolean) {
  vi.resetModules();
  vi.doMock('../utils/plan-features', async () => {
    const actual = await vi.importActual<typeof import('../utils/plan-features')>('../utils/plan-features');
    return { ...actual, AFFILIATE_PROGRAM_ENABLED: enabled };
  });
  const App = (await import('../App')).default;
  const { useAppStore } = await import('../store/useAppStore');
  useAppStore.setState({
    currentUser: null,
    isAuthReady: false,
    currentTenant: null,
    currentTenantId: null,
    tenantPlan: null,
    isSuperAdmin: false,
  });
  act(() => {
    root = createRoot(container);
    root.render(<App />);
  });
  for (let i = 0; i < 8; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

function rendered(testId: string): boolean {
  return !!container.querySelector(`[data-testid="${testId}"]`);
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  state.user = null;
  state.authListeners.length = 0;
  state.userDoc = null;
  state.userDocError = null;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  vi.doUnmock('../utils/plan-features');
});

describe('affiliate host — AFFILIATE_PROGRAM_ENABLED === false', () => {
  it('a confirmed tenant-less user gets the platform view, not the affiliate dashboard', async () => {
    setURL(`${AFFILIATE_ORIGIN}/auth`);
    state.user = USER;
    state.userDoc = { exists: true, data: { role: 'user', tenantId: null } };

    await mount(false);

    expect(rendered('affiliate-dashboard')).toBe(false);
    expect(rendered('main-app')).toBe(true);
  });

  it('still keeps that user OUT of the paid church funnel — hiding the surface does not re-open the incident', async () => {
    sessionStorage.setItem('harvest_signup', 'max'); // stale intent from an earlier pricing visit
    setURL(`${AFFILIATE_ORIGIN}/auth`);
    state.user = USER;
    state.userDoc = { exists: true, data: { role: 'user', tenantId: null } };

    await mount(false);

    expect(window.location.pathname).toBe('/');
    expect(rendered('church-onboarding')).toBe(false);
    expect(sessionStorage.getItem('harvest_signup')).toBeNull();
  });
});

describe('affiliate host — AFFILIATE_PROGRAM_ENABLED === true restores the dashboard', () => {
  it('a confirmed tenant-less user gets the affiliate dashboard back', async () => {
    setURL(`${AFFILIATE_ORIGIN}/auth`);
    state.user = USER;
    state.userDoc = { exists: true, data: { role: 'user', tenantId: null } };

    await mount(true);

    expect(window.location.pathname).toBe('/');
    expect(rendered('affiliate-dashboard')).toBe(true);
    expect(rendered('main-app')).toBe(false);
  });

  it('a brand-new affiliate with no user doc gets it too', async () => {
    setURL(`${AFFILIATE_ORIGIN}/auth`);
    state.user = USER;
    state.userDoc = { exists: false };

    await mount(true);

    expect(window.location.pathname).toBe('/');
    expect(rendered('affiliate-dashboard')).toBe(true);
  });

  it('leaves the tri-state gate behind the flag intact — an unresolved doc read still gets MainApp', async () => {
    setURL(`${AFFILIATE_ORIGIN}/auth`);
    state.user = USER;
    state.userDocError = new Error('permission-denied');

    await mount(true);

    expect(rendered('affiliate-dashboard')).toBe(false);
    expect(rendered('main-app')).toBe(true);
  });

  it('leaves the tenant gate behind the flag intact — a church admin on the affiliate origin is not trapped', async () => {
    setURL(`${AFFILIATE_ORIGIN}/auth`);
    state.user = { uid: 'u2', email: 'pastor@gracechurch.org' };
    state.userDoc = {
      exists: true,
      data: { role: 'church_admin', tenantId: 'gracechurch', onboardingCompleted: false },
    };

    await mount(true);

    expect(window.location.pathname).toBe('/church-onboarding');
    expect(rendered('affiliate-dashboard')).toBe(false);
  });
});
