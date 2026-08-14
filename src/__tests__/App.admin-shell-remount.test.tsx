import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-139 — the admin shell must survive navigation, not be rebuilt by it.
 *
 * The rate limit that took an admin's tabs away was reached because the admin
 * dashboard was REMOUNTED on every tab change rather than re-rendered. The
 * cause was a route guard declared inside AppInner's render body:
 *
 *     const RequireAdmin: React.FC<…> = ({ children }) => …   // ← new identity
 *                                                            //   every render
 *
 * React reconciles by element type, so a component created during render is a
 * different type each time and its whole subtree is thrown away and rebuilt.
 * AppInner re-renders on every navigation (it reads `useLocation`), and a
 * navigation also re-runs its auth effect — measured at TWO full remounts of
 * the dashboard per tab change on the code before this fix.
 *
 * Each remount re-ran the shell's mount effects, which is two more `/api/*`
 * calls (roster-status + grace-status). That is the traffic that exhausted the
 * shared per-IP limiter and produced the 429 the nav then misread as "no".
 *
 * The lookup is now robust to a 429 on its own terms (see
 * AdminDashboard.rate-limit-nav.test.tsx). This test guards the other half: the
 * traffic must not come back. It counts MOUNTS, not renders — re-rendering the
 * dashboard on navigation is correct and expected; remounting it is the defect.
 */

const state = vi.hoisted(() => ({
  user: { uid: 'u1', email: 'admin@theharvest.app' } as null | { uid: string; email: string },
  authListeners: [] as Array<(u: unknown) => void>,
  userDoc: null as null | { exists: boolean; data?: Record<string, unknown> },
  mounts: 0,
}));

vi.mock('../firebase', () => ({ auth: { currentUser: { uid: 'u1', email: 'admin@theharvest.app' } }, db: {} }));

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
      const d = state.userDoc;
      return { exists: () => !!d?.exists, data: () => d?.data };
    }
    return { exists: () => false, data: () => undefined };
  },
}));

vi.mock('../components/AuthPage', () => ({ default: () => <div data-testid="auth-page" /> }));
vi.mock('../components/MainApp', () => ({ default: () => <div data-testid="main-app" /> }));
vi.mock('../components/AffiliateDashboard', () => ({ default: () => <div data-testid="affiliate-dashboard" /> }));
vi.mock('../components/Onboarding', () => ({ default: () => <div data-testid="member-onboarding" /> }));
vi.mock('../components/ChurchOnboarding', () => ({ default: () => <div data-testid="church-onboarding" /> }));

// Stands in for the real dashboard and counts how often it is MOUNTED. The real
// shell's mount effects are the roster-status and grace-status calls, so one
// mount here is two `/api/*` calls there.
vi.mock('../components/AdminDashboard', async () => {
  const React = await import('react');
  // Named (and capitalised) rather than an inline arrow on `default`: it calls a
  // hook, and react-hooks/rules-of-hooks can only recognise a function as a
  // component by its name.
  const AdminDashboardProbe = () => {
    React.useEffect(() => { state.mounts++; }, []);
    return <div data-testid="admin-dashboard" />;
  };
  return { default: AdminDashboardProbe };
});
vi.mock('../components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/OnboardingGate', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/PWAInstallManager', () => ({ default: () => null }));
vi.mock('../components/PostPurchaseWizard', () => ({ default: () => null }));

const tenantCtx = vi.hoisted(() => ({
  tenantId: 'connect', isAdminDomain: true, error: null, isLoading: false,
  setTenantPlan: () => {}, tenantPlan: null,
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

import App from '../App';
import { useAppStore } from '../store/useAppStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function setURL(url: string) {
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(url);
}

async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

/** Client-side navigation, the way the admin nav's `go()` reaches the router. */
async function navigateTo(path: string) {
  await act(async () => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await flush();
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  state.user = { uid: 'u1', email: 'admin@theharvest.app' };
  state.authListeners.length = 0;
  state.userDoc = { exists: true, data: { role: 'admin', tenantId: 'connect', onboardingCompleted: true } };
  state.mounts = 0;
  useAppStore.setState({
    currentUser: null, isAuthReady: false, currentTenant: null,
    currentTenantId: null, tenantPlan: null, isSuperAdmin: false,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
});

describe('THE-139 — the admin shell is not remounted by navigation', () => {
  it('moving between admin tabs does not remount the dashboard', async () => {
    setURL('https://connect.theharvest.app/admin');
    act(() => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();

    // Land on a tab and take that as the baseline — one shell, one set of
    // entitlement lookups.
    await navigateTo('/admin/livestream');
    expect(container.querySelector('[data-testid="admin-dashboard"]')).not.toBeNull();
    const afterFirstTab = state.mounts;
    expect(afterFirstTab).toBeGreaterThan(0);

    // The admin now works: six more tab changes, exactly the behaviour that
    // exhausted the limiter. Before the fix each of these cost two remounts.
    for (const tab of ['crm', 'blog', 'courses', 'community', 'accounting', 'forms']) {
      await navigateTo(`/admin/${tab}`);
    }

    expect(container.querySelector('[data-testid="admin-dashboard"]')).not.toBeNull();
    expect(
      state.mounts,
      `the admin shell was remounted ${state.mounts - afterFirstTab} extra time(s) across six tab ` +
      'changes — every remount re-asks roster-status and grace-status, which is what hit the rate limit',
    ).toBe(afterFirstTab);
  });

  it('returning to the dashboard root does not remount it either', async () => {
    setURL('https://connect.theharvest.app/admin');
    act(() => {
      root = createRoot(container);
      root.render(<App />);
    });
    await flush();

    await navigateTo('/admin/crm');
    const baseline = state.mounts;
    expect(baseline).toBeGreaterThan(0);

    // '/admin' and '/admin/:section' are separate route entries; crossing
    // between them must still reconcile rather than rebuild. (The dashboard's
    // own "Dashboard" tab is '/admin', so this is the single most common hop an
    // admin makes.)
    await navigateTo('/admin');
    expect(window.location.pathname, 'the router did not actually move').toBe('/admin');
    expect(container.querySelector('[data-testid="admin-dashboard"]')).not.toBeNull();

    await navigateTo('/admin/blog');
    expect(window.location.pathname).toBe('/admin/blog');
    expect(container.querySelector('[data-testid="admin-dashboard"]')).not.toBeNull();

    expect(state.mounts).toBe(baseline);
  });
});
