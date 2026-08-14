import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import App from '../App';
import { useAppStore } from '../store/useAppStore';
import { SIGNUP_BILLING_STORAGE_KEY } from '../utils/signup-checkout';

/**
 * THE-135: the billing period survives the auth redirect.
 *
 * The live defect: the marketing site sent `?signup=max&billing=yearly`, App.tsx
 * captured only `?signup` into sessionStorage, and `navigate('/auth')` dropped
 * the query string — so by the time ChurchOnboarding looked for `?billing=` it
 * was gone and the church that chose annual was sold monthly
 * (`sub_0NlLQsjES5cQltCrsBpJ4`, 2026-08-14). The plan survived the redirect
 * because it was given a sessionStorage lane; these tests pin that the period
 * now rides the SAME lane with the SAME lifecycle.
 *
 * ChurchOnboarding is deliberately NOT mocked: the regression test walks the
 * real funnel — pricing link → /auth redirect (query dropped) → post-auth
 * routing → the real checkout POST — because the defect lived precisely in the
 * seams between those steps.
 */
const state = vi.hoisted(() => ({
  user: null as null | { uid: string; email: string },
  authListeners: [] as Array<(u: unknown) => void>,
  userDoc: null as null | { exists: boolean; data?: Record<string, unknown> },
}));

const authState = vi.hoisted(() => ({
  currentUser: null as null | Record<string, unknown>,
}));

const setDoc = vi.hoisted(() => vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => {}));
const updateDoc = vi.hoisted(() => vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => {}));

vi.mock('../firebase', () => ({ auth: authState, db: {} }));

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
  setDoc,
  updateDoc,
}));

vi.mock('../components/AuthPage', () => ({ default: () => <div data-testid="auth-page" /> }));
vi.mock('../components/MainApp', () => ({ default: () => <div data-testid="main-app" /> }));
vi.mock('../components/AffiliateDashboard', () => ({ default: () => <div data-testid="affiliate-dashboard" /> }));
vi.mock('../components/Onboarding', () => ({ default: () => <div data-testid="member-onboarding" /> }));
vi.mock('../components/AdminDashboard', () => ({ default: () => <div data-testid="admin-dashboard" /> }));
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

const APEX = 'https://theharvest.app';
const USER = { uid: 'u1', email: 'pastor@grace.org' };

const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root | null = null;

function setURL(url: string) {
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(url);
}

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => { await Promise.resolve(); });
  }
};

async function mountApp() {
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
  await flush();
}

/** Fire the auth listeners as Firebase would on a successful sign-in. */
async function signIn() {
  state.user = USER;
  authState.currentUser = {
    ...USER,
    displayName: 'Pastor',
    getIdToken: vi.fn(async () => 'tok-1'),
  };
  await act(async () => {
    state.authListeners.forEach((cb) => cb(state.user));
  });
  await flush();
}

/** Complete the real ChurchOnboarding screen and return the checkout POST. */
async function completeCheckout(): Promise<{ url: string; body: Record<string, unknown> }> {
  const input = container.querySelector('input[placeholder="Grace Community Church"]') as HTMLInputElement;
  expect(input, 'real ChurchOnboarding not rendered after the funnel').toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, 'Grace Chapel');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const continueBtn = Array.from(container.querySelectorAll('button')).find(
    (b) => /continue to payment/i.test(b.textContent || ''),
  );
  expect(continueBtn, 'continue button not rendered').toBeTruthy();
  await act(async () => { continueBtn!.click(); });
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return { url: fetchMock.mock.calls[0][0], body: JSON.parse(fetchMock.mock.calls[0][1].body) };
}

/**
 * The whole live-defect path in one walk: land signed-out on a pricing link,
 * ride the /auth redirect that drops the query, sign in, get routed into the
 * church funnel, and buy. Returns what actually left the browser.
 */
async function signupFunnel(pricingLink: string) {
  setURL(`${APEX}${pricingLink}`);
  await mountApp();

  // The redirect that caused THE-135 must still happen exactly as before: the
  // funnel lands on /auth and the query string really is gone.
  expect(window.location.pathname).toBe('/auth');
  expect(window.location.search).toBe('');

  await signIn();
  expect(window.location.pathname).toBe('/church-onboarding');
  return completeCheckout();
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  state.user = null;
  state.authListeners.length = 0;
  state.userDoc = null;
  authState.currentUser = null;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe('the billing period survives the auth redirect (THE-135)', () => {
  it('an annual signup link survives the auth redirect and buys the annual product', async () => {
    const { url, body } = await signupFunnel('/?signup=max&billing=yearly');
    // The client's full say on which product is bought is (plan, billing) —
    // this pair is what the server maps to the annual Ministry product.
    expect(body.billing).toBe('yearly');
    expect(body.plan).toBe('max');
    expect(url).toBe('/api/dodo/checkout');
    // The marker agrees, so the restart-after-abandonment path re-buys annual.
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(setDoc.mock.calls[0][1].signupBilling).toBe('yearly');
  });

  it('a monthly signup still buys monthly', async () => {
    const { body } = await signupFunnel('/?signup=pro&billing=monthly');
    expect(body.billing).toBe('monthly');
    expect(body.plan).toBe('pro');
  });

  it('no billing period in the link still buys monthly', async () => {
    const { body } = await signupFunnel('/?signup=pro');
    expect(body.billing).toBe('monthly');
    // Nothing was stored either: an absent period is not a value.
    expect(sessionStorage.getItem(SIGNUP_BILLING_STORAGE_KEY)).toBeNull();
  });

  it('an invalid stored period fails closed to monthly', async () => {
    // Captured raw off the URL exactly as a hostile/mangled link would write
    // it; validation happens on read-back, and the raw value never leaves.
    const { body } = await signupFunnel('/?signup=pro&billing=every-decade');
    expect(body.billing).toBe('monthly');
    expect(fetchMock.mock.calls[0][1].body).not.toContain('every-decade');
  });
});

describe('the lane has the same lifecycle as the plan', () => {
  it('a stale period does not leak into a later non-signup visit in the same tab', async () => {
    // (a) Funnel finished: onboardingCompleted clears the plan — the period
    // must go with it, or the NEXT signup in this tab buys a term nobody chose.
    sessionStorage.setItem('harvest_signup', 'max');
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'yearly');
    state.user = USER;
    state.userDoc = { exists: true, data: { role: 'user', tenantId: null, onboardingCompleted: true } };
    setURL(`${APEX}/`);
    await mountApp();
    expect(sessionStorage.getItem('harvest_signup')).toBeNull();
    expect(sessionStorage.getItem(SIGNUP_BILLING_STORAGE_KEY)).toBeNull();
  });

  it('the affiliate surface drops a stale period exactly as it drops the stale plan', async () => {
    // (b) The non-signup surface: the affiliate host clears any stashed signup
    // intent — the period is cleared beside it.
    sessionStorage.setItem('harvest_signup', 'max');
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'yearly');
    setURL('https://affiliate.theharvest.app/auth');
    await mountApp();
    expect(sessionStorage.getItem('harvest_signup')).toBeNull();
    expect(sessionStorage.getItem(SIGNUP_BILLING_STORAGE_KEY)).toBeNull();
  });

  it('a later signup link with no period overwrites a stale annual one', async () => {
    // A church opens an annual link, abandons, then opens a MONTHLY-priced link
    // (no ?billing=) in the same tab. The stale 'yearly' must not survive into
    // that signup — that is the live defect pointed the other way, and worse.
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'yearly');
    setURL(`${APEX}/?signup=pro`);
    await mountApp();
    expect(sessionStorage.getItem('harvest_signup')).toBe('pro');
    expect(sessionStorage.getItem(SIGNUP_BILLING_STORAGE_KEY)).toBeNull();
  });
});
