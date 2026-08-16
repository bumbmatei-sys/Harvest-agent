import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * THE-138 — the payment confirmation must land BEFORE the origin hop.
 *
 * 🔴 THE ORDERING UNDER TEST, as it exists in the tree.
 *
 * `/api/dodo/checkout` returns the payer to the SAME origin they signed up on
 * (route.ts:104-108) precisely so their Firebase session survives — and it does.
 * Then the provisioning webhook writes `onboardingCompleted: true` and
 * `role: 'admin'` on the user doc and `setupCompleted: false` on the new tenant,
 * and App.tsx's auth callback reads that and hard-redirects apex →
 * `<tenant>.theharvest.app`. Those are DIFFERENT ORIGINS; Firebase persists auth
 * in origin-scoped storage. So the church signed in a second time, completed
 * first-run setup over there, and only then met "Your payment went through" — in
 * the SAME-ORIGIN variant, which says no second sign-in is needed, to someone
 * who had just done one.
 *
 * The only moment the session still exists is before the hop. These tests pin
 * the confirmation to that moment, and pin everything around it to unchanged:
 * the redirect still fires (after), a church that did not just pay never enters
 * the gate, the annual billing lane still carries, the affiliate branch is
 * untouched, and nothing on this path writes tenant state.
 *
 * Mounted through the REAL App, the REAL OnboardingGate and the REAL
 * WorkspaceHandoff — the defect was in how those three are ORDERED, so stubbing
 * any of them would test the wrong thing.
 */

// ── Controllable auth/firestore state ────────────────────────────────────────
const state = vi.hoisted(() => ({
  user: null as null | { uid: string; email: string },
  userDoc: null as null | { exists: boolean; data?: Record<string, unknown> },
  tenantDoc: null as null | { exists: boolean; data?: Record<string, unknown> },
  authListeners: [] as Array<(u: unknown) => void>,
  /** Any Firestore document path this test run wrote to. Must stay empty. */
  writes: [] as string[],
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
  getIdToken: async () => 'token',
}));

/**
 * ⚠️ Reads only. `setDoc`/`updateDoc`/`writeBatch` are deliberately NOT provided
 * — the webhook is the single writer of `plan` and `onboardingCompleted`, so any
 * attempt to write from this path fails as an unresolved import rather than
 * quietly succeeding against a permissive stub.
 */
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ col, id, path: `${col}/${id}` }),
  getDoc: async (ref: { col: string }) => {
    const d = ref.col === 'users' ? state.userDoc : state.tenantDoc;
    return { exists: () => !!d?.exists, data: () => d?.data };
  },
  onSnapshot: (ref: { col: string; path: string }, next: (snap: unknown) => void) => {
    const d = ref.col === 'users' ? state.userDoc : state.tenantDoc;
    Promise.resolve().then(() => next({ exists: () => !!d?.exists, data: () => d?.data }));
    return () => { /* noop */ };
  },
}));

// ── Page stubs. The gate, the handoff and the paid-arrival module are REAL. ──
vi.mock('../components/AuthPage', () => ({ default: () => <div data-testid="auth-page" /> }));
vi.mock('../components/MainApp', () => ({ default: () => <div data-testid="main-app" /> }));
vi.mock('../components/AffiliateDashboard', () => ({ default: () => <div data-testid="affiliate-dashboard" /> }));
vi.mock('../components/Onboarding', () => ({ default: () => <div data-testid="member-onboarding" /> }));
vi.mock('../components/ChurchOnboarding', () => ({ default: () => <div data-testid="church-onboarding" /> }));
vi.mock('../components/AdminDashboard', () => ({ default: () => <div data-testid="admin-dashboard" /> }));
vi.mock('../components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/PWAInstallManager', () => ({ default: () => null }));
vi.mock('../components/PostPurchaseWizard', () => ({ default: () => null }));
/** Stands in for first-run setup so "which screen came first" is observable. */
vi.mock('../components/FirstRunSetup', () => ({
  default: () => <div data-testid="first-run-setup" />,
}));
vi.mock('../utils/tenant.utils', () => ({ checkRosterAdmin: async () => false }));

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
import { SIGNUP_BILLING_STORAGE_KEY, resolveSignupBillingPeriod } from '../utils/signup-checkout';
import {
  PAYMENT_CONFIRMATION_PENDING_KEY,
  PAYMENT_CONFIRMATION_SEEN_KEY,
  withPaymentConfirmationHandoff,
} from '../utils/paid-arrival';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = path.join(process.cwd(), 'src');
const PAID_ARRIVAL_SRC = readFileSync(path.join(SRC, 'utils/paid-arrival.ts'), 'utf8');
/**
 * Source with comments stripped. The structural guards below are about what the
 * module can DO — the prose explains the webhook's fields at length, and matching
 * an explanation of a write is not the same as matching a write.
 */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PAID_ARRIVAL_CODE = codeOf(PAID_ARRIVAL_SRC);
const APP_SRC = readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
const GATE_SRC = readFileSync(path.join(SRC, 'components/OnboardingGate.tsx'), 'utf8');

const APEX = 'https://theharvest.app';
const AFFILIATE = 'https://affiliate.theharvest.app';
const TENANT = 'gracechurch';
const WORKSPACE_URL = `https://${TENANT}.theharvest.app/admin`;
/**
 * THE-138 part 2: the same workspace, with the acknowledgement riding along.
 *
 * The hop's DESTINATION is unchanged — these tests still pin "it goes to the
 * workspace" — but once the church has acknowledged the confirmation the URL
 * also has to tell the far origin so, because sessionStorage cannot cross it.
 * Built through the exported helper rather than spelled out, so the parameter is
 * named by label here and can be renamed in one place.
 */
const WORKSPACE_URL_CONFIRMED = withPaymentConfirmationHandoff(WORKSPACE_URL);
const PASTOR = { uid: 'u1', email: 'pastor@gracechurch.org' };

/** The user doc exactly as the provisioning webhook leaves it. */
const provisionedUserDoc = () => ({
  exists: true,
  data: {
    role: 'admin',
    tenantId: TENANT,
    plan: 'plus',
    onboardingCompleted: true,
    signupInProgress: false,
    signupMinistryName: 'Grace Community Church',
  },
});
/** A tenant the webhook has just created — first-run setup not yet done. */
const justProvisionedTenant = () => ({
  exists: true,
  data: { name: 'Grace Community Church', setupCompleted: false },
});
/** A church that has been running for months. */
const establishedTenant = () => ({
  exists: true,
  data: { name: 'Grace Community Church', setupCompleted: true },
});

let container: HTMLDivElement;
let root: Root | null = null;
/** Every `window.location.href = …` the app attempted, in order. */
let hops: string[] = [];

function setURL(url: string) {
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(url);
}

/**
 * Point the browser at `url` and start recording origin hops.
 *
 * The redirect under test is a real cross-origin navigation, so it is observed
 * by intercepting the assignment rather than by letting the document unload —
 * `location.search` / `hostname` keep working, which the resolvers all read.
 */
function startAt(url: string) {
  setURL(url);
  const proto = Object.getPrototypeOf(window.location);
  const inherited = Object.getOwnPropertyDescriptor(proto, 'href');
  Object.defineProperty(window.location, 'href', {
    configurable: true,
    get: () => inherited?.get?.call(window.location),
    set: (v: string) => { hops.push(v); },
  });
}

function mount() {
  act(() => {
    root = createRoot(container);
    root.render(<App />);
  });
}

function unmount() {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
}

/** Flush the auth callback → awaited getDoc → hold/redirect → gate → handoff. */
async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

const text = () => container.textContent || '';
const rendered = (testId: string) => !!container.querySelector(`[data-testid="${testId}"]`);
/** The confirmation's single action, once the readiness guard has released it. */
const continueLink = () =>
  Array.from(container.querySelectorAll('a')).find((a) =>
    (a.getAttribute('href') || '').startsWith(`https://${TENANT}.theharvest.app`),
  ) || null;

/** Click the action the way the payer does, without unloading the document. */
async function clickContinue() {
  const link = continueLink();
  if (!link) throw new Error('the confirmation offered no way onward');
  const swallow = (e: Event) => e.preventDefault();
  window.addEventListener('click', swallow);
  await act(async () => {
    link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  window.removeEventListener('click', swallow);
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  state.user = null;
  state.userDoc = null;
  state.tenantDoc = null;
  state.authListeners.length = 0;
  state.writes.length = 0;
  hops = [];
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
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  delete (window.location as unknown as Record<string, unknown>).href;
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
});

/* ── 1 ─────────────────────────────────────────────────────────────────────── */

describe('1 — the confirmation lands before the origin hop', () => {
  it('a church returning from checkout sees the payment confirmed before any redirect', async () => {
    // The exact production state: paid on the apex, webhook has provisioned,
    // came back to the origin that took the payment with its session intact.
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    // 🔴 THE REGRESSION. Before this change the callback hard-redirected to the
    // subdomain the instant it read `onboardingCompleted: true` — ending the
    // only session the payer had, on the origin that had just charged them,
    // with nothing yet said about the charge.
    expect(hops, 'the origin hop fired before the church was told it had paid').toEqual([]);
    expect(text()).toContain('Your payment went through.');
    // And it is shown ON the origin that took the payment.
    expect(window.location.hostname).toBe('theharvest.app');
  });

  it('the confirmation precedes first-run setup, not the other way round', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    // The gate's listeners resolve a brand-new tenant with an admin, i.e.
    // 'first-run'. Reading `status` before the held confirmation would put
    // white-labelling in front of the sentence the payer is looking for.
    expect(rendered('first-run-setup')).toBe(false);
    expect(text()).toContain('Your payment went through.');
  });

  it('names the ministry that was created, from the tenant document', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    expect(text()).toContain('Grace Community Church');
    expect(text()).toContain(`${TENANT}.theharvest.app`);
  });

  it('?stripe=success is recognised identically to ?dodo=success', async () => {
    // checkout/route.ts:106 states the two are treated alike; a customer who was
    // mid-checkout when the processor flag flipped comes back on the other one.
    startAt(`${APEX}/?stripe=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    expect(hops).toEqual([]);
    expect(text()).toContain('Your payment went through.');
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────── */

describe('2 — the cross-origin copy is the honest one', () => {
  it('the cross-origin handoff says they will sign in again at the new address', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    // 🔴 They WILL sign in again — this screen is the last thing on the origin
    // holding their session, and the login prompt is the very next thing. The
    // sentence that promises it must name where, or it is a warning about an
    // unnamed elsewhere. Located by the claim it makes, then read for the
    // address it must contain.
    const secondSignIn = Array.from(container.querySelectorAll('p')).find((p) =>
      (p.textContent || '').includes('sign in once more'),
    );
    expect(secondSignIn, 'nothing on the screen mentions the second sign-in').toBeTruthy();
    expect(secondSignIn!.textContent).toContain(`${TENANT}.theharvest.app`);
    expect(secondSignIn!.textContent).toContain('expected');

    // And it must NOT be the same-origin reassurance, which is false here.
    expect(text()).not.toContain('already signed in at this address');
  });

  it('offers no way to pay again on the screen after a charge', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    // Everyone reaching this screen has already been charged.
    for (const el of Array.from(container.querySelectorAll('a, button'))) {
      expect(el.textContent || '').not.toMatch(
        /pay now|pay again|try again|retry payment|complete your payment|checkout|subscribe/i,
      );
    }
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────── */

describe('3 — the hop is gated, not removed', () => {
  it('the subdomain redirect still happens after the confirmation', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();
    expect(hops).toEqual([]);

    // The payer reads it and clicks through — that is the acknowledgement.
    await clickContinue();
    expect(sessionStorage.getItem(PAYMENT_CONFIRMATION_SEEN_KEY)).toBe('true');
    expect(sessionStorage.getItem(PAYMENT_CONFIRMATION_PENDING_KEY)).toBeNull();

    // From here the redirect App.tsx always had behaves exactly as before: the
    // next auth callback on this origin performs the hop it was holding.
    unmount();
    mount();
    await flush();

    // 🔴 Still the hop, still to the workspace — gated, never removed. It now
    // also carries the acknowledgement, because THIS is the resumed hop: the
    // payer came back to the apex after clicking through, and without the hint
    // the destination would show the confirmation a second time.
    expect(hops, 'the gate outlived the confirmation and stranded the church').toEqual([WORKSPACE_URL_CONFIRMED]);
    expect(hops[0].startsWith(WORKSPACE_URL), 'the hop no longer lands on the workspace').toBe(true);
  });

  it('the action points at the workspace, which is where the redirect went', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    const href = continueLink()?.getAttribute('href');
    expect(href?.startsWith(WORKSPACE_URL), 'the action no longer points at the workspace').toBe(true);
    // …and carries the acknowledgement over the boundary sessionStorage cannot.
    expect(href).toBe(WORKSPACE_URL_CONFIRMED);
  });

  it('holds nothing when the workspace does not resolve yet', async () => {
    // The webhook is still working: no tenant doc, so the redirect branch is not
    // reached at all and the gate keeps its own "setting up" screen.
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = { exists: true, data: { ...provisionedUserDoc().data, tenantId: TENANT } };
    state.tenantDoc = { exists: false };

    mount();
    await flush();

    expect(hops).toEqual([]);
    expect(sessionStorage.getItem(PAYMENT_CONFIRMATION_PENDING_KEY)).toBeNull();
  });
});

/* ── 4 ─────────────────────────────────────────────────────────────────────── */

describe('4 — an arrival that did not just pay is untouched', () => {
  it('a church that did not just pay is redirected exactly as before', async () => {
    // 🔴 NO-REGRESSION. The apex → subdomain redirect is deliberate: an admin who
    // lands on the apex belongs on their own tenant's admin, and FUNNEL_PATHS
    // depends on that. No processor marker in the URL ⇒ no gate, no delay.
    startAt(`${APEX}/`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    expect(hops, 'a church that did not just pay was held back').toEqual([WORKSPACE_URL]);
    expect(text()).not.toContain('Your payment went through.');
    expect(sessionStorage.getItem(PAYMENT_CONFIRMATION_PENDING_KEY)).toBeNull();
  });

  it('an established church arriving on a stale success URL is redirected, not congratulated', async () => {
    // `setupCompleted: true` — provisioning finished long ago, so this is not a
    // just-paid arrival however the URL is dressed.
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = establishedTenant();

    mount();
    await flush();

    expect(hops).toEqual([WORKSPACE_URL]);
    expect(text()).not.toContain('Your payment went through.');
  });

  it('a signed-in admin deep-linked past "/" is left where they are, as before', async () => {
    startAt(`${APEX}/admin/crm?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    // The redirect only ever applied at "/", and the gate inherits that scope.
    expect(hops).toEqual([]);
    expect(window.location.pathname).toBe('/admin/crm');
  });

  it('a user with no tenant is never sent to a subdomain, gate or no gate', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = { exists: true, data: { role: 'admin', tenantId: null, onboardingCompleted: true } };
    state.tenantDoc = { exists: false };

    mount();
    await flush();

    expect(hops).toEqual([]);
  });
});

/* ── 5 ─────────────────────────────────────────────────────────────────────── */

describe('5 — refreshing on the confirmation', () => {
  it('a refresh during the confirmation does not strand them', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();
    expect(text()).toContain('Your payment went through.');

    // A refresh is a fresh document on the same origin, in the same tab, at the
    // same URL — the hold lives in sessionStorage precisely so this case is
    // decided by state that survives it.
    unmount();
    mount();
    await flush();

    // 🔴 Never nowhere: the same confirmation, with the same way onward, and
    // still no unannounced hop.
    expect(text()).toContain('Your payment went through.');
    expect(continueLink()?.getAttribute('href')).toBe(WORKSPACE_URL_CONFIRMED);
    expect(hops).toEqual([]);
  });

  it('a refresh after acknowledging it completes the journey rather than repeating it', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();
    await clickContinue();

    unmount();
    mount();
    await flush();

    // Acknowledged once ⇒ the hop is theirs to make, and it is made — carrying
    // the acknowledgement, so the far origin does not repeat the screen.
    expect(hops).toEqual([WORKSPACE_URL_CONFIRMED]);
  });
});

/* ── 6 ─────────────────────────────────────────────────────────────────────── */

describe('6 — the annual path is untouched', () => {
  it('the chosen billing period still reaches checkout unchanged', async () => {
    // #310's lane: `?billing=` rides sessionStorage across the /auth redirect
    // that drops the query, so a church that chose annual buys annual.
    startAt(`${APEX}/auth?signup=plus&billing=yearly`);
    state.user = PASTOR;
    state.userDoc = { exists: true, data: { role: 'user', tenantId: null } };
    state.tenantDoc = { exists: false };

    mount();
    await flush();

    expect(sessionStorage.getItem(SIGNUP_BILLING_STORAGE_KEY)).toBe('yearly');
    // What the checkout body would carry once the query is gone.
    expect(resolveSignupBillingPeriod('')).toBe('yearly');
    expect(window.location.pathname).toBe('/church-onboarding');
  });

  it('the payment gate cannot read or write the billing lane at all', () => {
    // Structural, so no later edit can quietly route the period through the
    // gate: the two lanes share no key and no module.
    expect(PAID_ARRIVAL_CODE).not.toContain(SIGNUP_BILLING_STORAGE_KEY);
    expect(PAID_ARRIVAL_CODE).not.toContain('billing');
    expect(PAID_ARRIVAL_CODE).not.toContain('readSignupBillingPeriod');
  });

  it('the funnel precedence the gate sits beside is unchanged', () => {
    // #298 declined to touch this precedence and #310 has since edited the same
    // file — the gate must not have become a third opinion about it.
    expect(APP_SRC).toContain("const FUNNEL_PATHS = ['/auth', '/onboarding', '/church-onboarding'];");
    expect(APP_SRC).toContain('resolvePostAuthFunnelRoute({');
  });
});

/* ── 7 ─────────────────────────────────────────────────────────────────────── */

describe('7 — the affiliate host', () => {
  it('the affiliate host branch is unchanged', async () => {
    // A confirmed tenant-less user on the affiliate origin lands on '/', and a
    // processor marker in the URL — meaningless on a surface that runs no
    // purchase funnel — cannot pull them into the paid path.
    startAt(`${AFFILIATE}/auth?dodo=success`);
    state.user = { uid: 'a1', email: 'partner@example.com' };
    state.userDoc = { exists: true, data: { role: 'user', tenantId: null } };
    state.tenantDoc = { exists: false };

    mount();
    await flush();

    expect(window.location.pathname).toBe('/');
    expect(rendered('main-app')).toBe(true);
    expect(rendered('church-onboarding')).toBe(false);
    expect(text()).not.toContain('Your payment went through.');
    expect(hops).toEqual([]);
  });

  it('a church admin on the affiliate origin still reaches their church flow', async () => {
    startAt(`${AFFILIATE}/auth`);
    state.user = PASTOR;
    state.userDoc = { exists: true, data: { role: 'church_admin', tenantId: TENANT, onboardingCompleted: false } };
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    expect(window.location.pathname).toBe('/church-onboarding');
  });
});

/* ── 8 ─────────────────────────────────────────────────────────────────────── */

describe('8 — the webhook remains the single writer', () => {
  it('nothing in this path writes the tenant plan or onboardingCompleted', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();
    await clickContinue();

    // The Firestore stub exposes reads only; a write would have failed as an
    // unresolved import long before this assertion.
    expect(state.writes).toEqual([]);
    // The doc the church arrived with is the doc it leaves with.
    expect(state.userDoc?.data?.onboardingCompleted).toBe(true);
    expect(state.userDoc?.data?.plan).toBe('plus');
    expect(state.tenantDoc?.data?.setupCompleted).toBe(false);
  });

  it('the gating module cannot write to Firestore at all', () => {
    // 🔴 The hold is a note about what the BROWSER shows next. Giving it the
    // ability to write tenant state is how a second writer of `plan` /
    // `onboardingCompleted` gets in beside the webhook.
    expect(PAID_ARRIVAL_CODE).not.toContain('firebase/firestore');
    expect(PAID_ARRIVAL_CODE).not.toContain('firebase');
    expect(PAID_ARRIVAL_CODE).not.toContain('setDoc');
    expect(PAID_ARRIVAL_CODE).not.toContain('updateDoc');
    expect(PAID_ARRIVAL_CODE).not.toContain('onboardingCompleted');
    expect(PAID_ARRIVAL_CODE).not.toMatch(/\bplan\b/);
  });

  it('neither the gate nor the callback gained a write on this path', () => {
    for (const src of [codeOf(APP_SRC), codeOf(GATE_SRC)]) {
      expect(src).not.toContain('setDoc');
      expect(src).not.toContain('updateDoc');
      expect(src).not.toContain('writeBatch');
    }
  });
});
