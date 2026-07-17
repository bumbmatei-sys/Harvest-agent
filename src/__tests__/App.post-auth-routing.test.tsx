import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Post-auth routing through the REAL App component (real BrowserRouter, real
 * signup-intent capture effect, real onAuthStateChanged wiring) with the
 * Firebase SDK and page components stubbed.
 *
 * Pins the fix for the production incident where an affiliate signup on
 * affiliate.theharvest.app was hijacked into church onboarding by a stale
 * ?signup=<plan> intent sitting in sessionStorage['harvest_signup'] (stashed by
 * an earlier pricing-page visit in the tab, e.g. via a referral link) — through
 * a real Stripe payment and a real tenant. On the affiliate host, a CONFIRMED
 * tenant-less user must land on '/' no matter what signup intent is in play,
 * while the paid church funnel on the apex/tenant hosts stays byte-identical.
 */

// ── Controllable auth/firestore state (hoisted so the mocks can close over it) ──
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
    // Firebase fires the callback asynchronously with the current user on
    // every new subscription — mirroring that keeps the effect-resubscribe
    // dynamics (navigate identity changes after a navigation) realistic.
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

// ── Page/component stubs: the landed route is asserted via these test ids ──
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
// Identity-stable across renders, like the real context (setTenantPlan is a
// useCallback there) — a fresh object per render would loop the auth effect,
// whose dependency array includes ctxSetTenantPlan.
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

import App from '../App';
import { useAppStore } from '../store/useAppStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AFFILIATE_ORIGIN = 'https://affiliate.theharvest.app';
const APEX_ORIGIN = 'https://theharvest.app';
const USER = { uid: 'u1', email: 'affiliate@thetest.com' };

let container: HTMLDivElement;
let root: Root | null = null;

function setURL(url: string) {
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(url);
}

function mount() {
  act(() => {
    root = createRoot(container);
    root.render(<App />);
  });
}

/** Flush the microtask chain: auth callback → awaited getDoc → navigate →
 *  re-render → effect resubscribe → auth callback again (until stable). */
async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
    });
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
  useAppStore.setState({
    currentUser: null,
    isAuthReady: false,
    currentTenant: null,
    currentTenantId: null,
    tenantPlan: null,
    isSuperAdmin: false,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

describe('affiliate host — the affiliate branch is authoritative for confirmed tenant-less users', () => {
  it('THE BUG: stale sessionStorage plan intent does NOT hijack a tenant-less affiliate into church onboarding', async () => {
    // A pricing-page visit earlier in the tab stashed a plan intent…
    sessionStorage.setItem('harvest_signup', 'ultra');
    setURL(`${AFFILIATE_ORIGIN}/auth`);
    state.user = USER;
    state.userDoc = { exists: true, data: { role: 'user', tenantId: null } };

    mount();
    await flush();

    expect(window.location.pathname).toBe('/');
    expect(rendered('affiliate-dashboard')).toBe(true);
    expect(rendered('church-onboarding')).toBe(false);
    expect(rendered('member-onboarding')).toBe(false);
    // …and the affiliate host drops the meaningless stale intent entirely,
    // so it can't keep leaking into signupPlan/AuthPage for the session.
    expect(sessionStorage.getItem('harvest_signup')).toBeNull();
  });

  it('a live ?signup=ultra in the URL on the affiliate host is ignored (and never captured)', async () => {
    setURL(`${AFFILIATE_ORIGIN}/auth?signup=ultra`);
    state.user = USER;
    state.userDoc = { exists: true, data: { role: 'user', tenantId: null } };

    mount();
    await flush();

    expect(window.location.pathname).toBe('/');
    expect(rendered('affiliate-dashboard')).toBe(true);
    expect(rendered('church-onboarding')).toBe(false);
    expect(sessionStorage.getItem('harvest_signup')).toBeNull();
  });

  it('no-user-doc branch: a brand-new affiliate with a stale stored plan still lands on /', async () => {
    sessionStorage.setItem('harvest_signup', 'pro');
    setURL(`${AFFILIATE_ORIGIN}/auth`);
    state.user = USER;
    state.userDoc = { exists: false };

    mount();
    await flush();

    expect(window.location.pathname).toBe('/');
    expect(rendered('affiliate-dashboard')).toBe(true);
    expect(rendered('church-onboarding')).toBe(false);
  });

  it('a church admin WITH a tenantId on the affiliate origin still reaches the church flow (not trapped)', async () => {
    sessionStorage.setItem('harvest_signup', 'ultra'); // stale intent must not matter either way
    setURL(`${AFFILIATE_ORIGIN}/auth`);
    state.user = { uid: 'u2', email: 'pastor@gracechurch.org' };
    state.userDoc = {
      exists: true,
      data: { role: 'church_admin', tenantId: 'gracechurch', onboardingCompleted: false },
    };

    mount();
    await flush();

    expect(window.location.pathname).toBe('/church-onboarding');
    expect(rendered('church-onboarding')).toBe(true);
    expect(rendered('affiliate-dashboard')).toBe(false);
  });

  it('tri-state discipline: an unresolved/errored doc read (tenantId undefined) does NOT take the affiliate branch', async () => {
    setURL(`${AFFILIATE_ORIGIN}/auth`);
    state.user = USER;
    state.userDocError = new Error('permission-denied');

    mount();
    await flush();

    // The error fallback leaves the funnel for '/', but userTenantId stays
    // undefined (unresolved) — so the affiliate dashboard must NOT render.
    expect(window.location.pathname).toBe('/');
    expect(rendered('main-app')).toBe(true);
    expect(rendered('affiliate-dashboard')).toBe(false);
  });
});

describe('apex host — the paid church funnel is unchanged', () => {
  it('?signup=church (fresh signup, no doc) → /church-onboarding, intent captured to sessionStorage', async () => {
    setURL(`${APEX_ORIGIN}/auth?signup=church`);
    state.user = USER;
    state.userDoc = { exists: false };

    mount();
    await flush();

    expect(window.location.pathname).toBe('/church-onboarding');
    expect(rendered('church-onboarding')).toBe(true);
    expect(sessionStorage.getItem('harvest_signup')).toBe('church');
  });

  it('?signup=church&ref=CODE (the referral flow) → /church-onboarding', async () => {
    setURL(`${APEX_ORIGIN}/auth?signup=church&ref=marketer123`);
    state.user = USER;
    state.userDoc = { exists: false };

    mount();
    await flush();

    expect(window.location.pathname).toBe('/church-onboarding');
    expect(rendered('church-onboarding')).toBe(true);
  });

  it('?signup=ultra (plan deep-link, doc exists, tenant-less) → /church-onboarding', async () => {
    setURL(`${APEX_ORIGIN}/auth?signup=ultra`);
    state.user = USER;
    state.userDoc = { exists: true, data: { role: 'user', tenantId: null } };

    mount();
    await flush();

    expect(window.location.pathname).toBe('/church-onboarding');
    expect(rendered('church-onboarding')).toBe(true);
    expect(sessionStorage.getItem('harvest_signup')).toBe('ultra');
  });

  it('stored plan intent (no URL param) still drives the funnel on the apex', async () => {
    sessionStorage.setItem('harvest_signup', 'plus');
    setURL(`${APEX_ORIGIN}/auth`);
    state.user = USER;
    state.userDoc = { exists: true, data: { role: 'user', tenantId: null } };

    mount();
    await flush();

    expect(window.location.pathname).toBe('/church-onboarding');
    expect(rendered('church-onboarding')).toBe(true);
  });

  it('no plan, no doc → /onboarding (generic member onboarding)', async () => {
    setURL(`${APEX_ORIGIN}/auth`);
    state.user = USER;
    state.userDoc = { exists: false };

    mount();
    await flush();

    expect(window.location.pathname).toBe('/onboarding');
    expect(rendered('member-onboarding')).toBe(true);
    expect(rendered('church-onboarding')).toBe(false);
  });
});
