import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * THE-138 part 2 — the payment confirmation must land ONCE, not twice.
 *
 * 🔴 THE DEFECT UNDER TEST. #327 put the confirmation before the apex →
 * subdomain hop, and that works. What it could not do is tell the DESTINATION
 * that the confirmation had happened: the acknowledgement is written to
 * `sessionStorage` on the apex, `<tenant>.theharvest.app` is a different
 * origin, and origin-scoped storage does not cross. #298's post-first-run
 * confirmation therefore fired again on the far side and a church saw "Your
 * payment went through." twice — once correctly on the apex, once redundantly
 * after first-run setup.
 *
 * The repair carries the acknowledgement ON the hop (the hop is a full URL
 * assignment, so a parameter survives it — unlike the in-app `navigate()` #310
 * had to build a storage lane around), captures it into the destination
 * origin's own storage on arrival, and suppresses the repeat there.
 *
 * 🔴 WHAT THESE TESTS ARE REALLY GUARDING is not the duplicate. It is the
 * church the duplicate's obvious fix would have stranded: one that reaches the
 * subdomain WITHOUT having seen the confirmation — webhook landed late, tab
 * closed, direct navigation — plus one that renames its subdomain during
 * first-run and is therefore about to cross another origin boundary it has not
 * been warned about. Both must still be told. A duplicate is annoying; a
 * missing confirmation after a charge is a chargeback. The strand guard is
 * worth as much as the regression test and is asserted just as hard.
 *
 * Mounted through the REAL App, the REAL OnboardingGate, the REAL
 * WorkspaceHandoff and the REAL paid-arrival module — the defect is in how
 * those are wired ACROSS two origins, so stubbing any of them tests nothing.
 */

// ── Controllable auth/firestore state ────────────────────────────────────────
const state = vi.hoisted(() => ({
  user: null as null | { uid: string; email: string },
  userDoc: null as null | { exists: boolean; data?: Record<string, unknown> },
  tenantDoc: null as null | { exists: boolean; data?: Record<string, unknown> },
  authListeners: [] as Array<(u: unknown) => void>,
  /** Live onSnapshot callbacks, keyed by document path, so tests can re-fire. */
  snapshots: new Map<string, (snap: unknown) => void>(),
  /** Any Firestore document path this test run wrote to. Must stay empty. */
  writes: [] as string[],
  /**
   * The tenant id first-run setup reports back.
   *
   * Non-null models the church RENAMING its subdomain, which re-points the user
   * doc at a new id and makes the handoff cross-origin all over again.
   */
  renameTo: null as string | null,
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
    state.snapshots.set(ref.path, next);
    const d = ref.col === 'users' ? state.userDoc : state.tenantDoc;
    Promise.resolve().then(() => next({ exists: () => !!d?.exists, data: () => d?.data }));
    return () => { state.snapshots.delete(ref.path); };
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
/**
 * First-run setup, reduced to the one thing this ticket depends on: the moment
 * it hands a finished tenant id back to the gate. That call is what produces
 * #298's confirmation, i.e. the second render.
 */
vi.mock('../components/FirstRunSetup', () => ({
  default: ({ tenantId, onFinished }: { tenantId: string; onFinished: (id: string) => void }) => (
    <div data-testid="first-run-setup">
      <button data-testid="finish-setup" onClick={() => onFinished(state.renameTo ?? tenantId)}>
        finish
      </button>
    </div>
  ),
}));
vi.mock('../utils/tenant.utils', () => ({ checkRosterAdmin: async () => false }));

const tenantCtx = vi.hoisted(() => ({
  tenantId: null as string | null,
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
  PAYMENT_CONFIRMATION_HANDOFF_PARAM,
  PAYMENT_CONFIRMATION_SEEN_KEY,
  hasSeenPaymentConfirmation,
  withPaymentConfirmationHandoff,
} from '../utils/paid-arrival';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = path.join(process.cwd(), 'src');
const APP_SRC = readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
const GATE_SRC = readFileSync(path.join(SRC, 'components/OnboardingGate.tsx'), 'utf8');
const HANDOFF_SRC = readFileSync(path.join(SRC, 'components/WorkspaceHandoff.tsx'), 'utf8');

const APEX = 'https://theharvest.app';
const TENANT = 'gracechurch';
const RENAMED = 'gracechurchtx';
const WORKSPACE = `https://${TENANT}.theharvest.app`;
const WORKSPACE_URL = `${WORKSPACE}/admin`;
const PASTOR = { uid: 'u1', email: 'pastor@gracechurch.org' };

/** The sentence a church must read exactly once. */
const CONFIRMATION = 'Your payment went through.';
/** The cross-origin claim — true only when another sign-in really is coming. */
const SECOND_SIGN_IN = 'sign in once more';

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
  delete (window.location as unknown as Record<string, unknown>).href;
  setURL(url);
  const proto = Object.getPrototypeOf(window.location);
  const inherited = Object.getOwnPropertyDescriptor(proto, 'href');
  Object.defineProperty(window.location, 'href', {
    configurable: true,
    get: () => inherited?.get?.call(window.location),
    set: (v: string) => { hops.push(v); },
  });
}

/**
 * 🔴 CROSS TO ANOTHER ORIGIN, THE WAY A BROWSER REALLY DOES.
 *
 * happy-dom keeps ONE `sessionStorage` for the whole test realm. A real browser
 * gives every origin its own, and that difference IS this defect — the apex's
 * acknowledgement is invisible on `<tenant>.theharvest.app`. Wiping the store
 * here is what makes the boundary real. Without it the apex key would simply
 * still be there and the regression test would pass for a reason production
 * does not have.
 */
function hopTo(url: string) {
  sessionStorage.clear();
  localStorage.clear();
  startAt(url);
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
    (a.getAttribute('href') || '').startsWith(WORKSPACE),
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

/** Complete first-run setup, which is what produces #298's confirmation. */
async function finishFirstRun() {
  const button = container.querySelector('[data-testid="finish-setup"]');
  if (!button) throw new Error('first-run setup never rendered, so it could not be finished');
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
}

/**
 * The workspace as it is once first-run setup has run: `setupCompleted` flipped,
 * pushed down the SAME listener the gate is already holding. This is what makes
 * the gate resolve to 'ready' behind a suppressed handoff.
 */
async function firstRunLandsOnTheTenantDoc() {
  state.tenantDoc = { exists: true, data: { name: 'Grace Community Church', setupCompleted: true } };
  await act(async () => {
    state.snapshots.get(`tenants/${TENANT}`)?.({
      exists: () => true,
      data: () => state.tenantDoc?.data,
    });
  });
  await flush();
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  state.user = null;
  state.userDoc = null;
  state.tenantDoc = null;
  state.authListeners.length = 0;
  state.snapshots.clear();
  state.writes.length = 0;
  state.renameTo = null;
  tenantCtx.tenantId = null;
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

/**
 * The production journey, end to end: pay on the apex, read the confirmation,
 * click through, cross the origin, arrive at the workspace.
 *
 * Returns the URL the church actually left on — taken off the rendered action,
 * never hand-written, so the test crosses on whatever the app really emits.
 */
async function payOnApexAndCrossOver(): Promise<string> {
  startAt(`${APEX}/?dodo=success`);
  state.user = PASTOR;
  state.userDoc = provisionedUserDoc();
  state.tenantDoc = justProvisionedTenant();

  mount();
  await flush();
  if (!text().includes(CONFIRMATION)) throw new Error('the apex confirmation never rendered');

  const departure = continueLink()?.getAttribute('href') || '';
  await clickContinue();
  unmount();
  return departure;
}

/** Arrive on the workspace origin at `url`, signed in and mid-first-run. */
async function arriveAtWorkspace(url: string) {
  hopTo(url);
  tenantCtx.tenantId = TENANT;
  state.user = PASTOR;
  state.userDoc = provisionedUserDoc();
  state.tenantDoc = justProvisionedTenant();
  mount();
  await flush();
}

/* ── 1 ─────────────────────────────────────────────────────────────────────── */

describe('1 — the confirmation is not repeated on the far side of the hop', () => {
  it('a church that acknowledged the confirmation on the apex is not shown it again on the subdomain', async () => {
    // 🔴 THE REGRESSION. Everything below happened in production: the apex
    // screen was correct, and then the church read the very same sentence again
    // after first-run setup, on an origin that could not tell it had already
    // been said.
    const departure = await payOnApexAndCrossOver();
    await arriveAtWorkspace(departure);

    expect(rendered('first-run-setup'), 'the church never reached first-run setup').toBe(true);
    await finishFirstRun();

    expect(text(), 'the church was congratulated a second time').not.toContain(CONFIRMATION);
  });

  it('and lands in the workspace it was heading for instead', async () => {
    // Suppressing the screen must not mean suppressing the arrival: the screen
    // it replaces offered an in-origin route to /admin, and that is where the
    // church ends up once the listener that flipped `setupCompleted` reports.
    const departure = await payOnApexAndCrossOver();
    await arriveAtWorkspace(departure);
    await finishFirstRun();
    await firstRunLandsOnTheTenantDoc();

    expect(rendered('admin-dashboard'), 'the church was left short of its workspace').toBe(true);
    expect(text()).not.toContain(CONFIRMATION);
  });

  it('the acknowledgement survives the /auth redirect that drops the query string', async () => {
    // 🔴 WHY THE HINT IS CAPTURED ON ARRIVAL RATHER THAN READ WHERE IT IS NEEDED.
    // A church crosses NOT signed in on the new origin, so the callback
    // immediately navigates to /auth — a react-router navigation, which drops
    // the query. The fact is needed minutes and one sign-in later.
    const departure = await payOnApexAndCrossOver();

    hopTo(departure);
    tenantCtx.tenantId = TENANT;
    state.user = null;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();
    mount();
    await flush();

    // The query really is gone — this is the drop, not a simulation of it.
    expect(window.location.pathname).toBe('/auth');
    expect(window.location.search).not.toContain(PAYMENT_CONFIRMATION_HANDOFF_PARAM);
    // …and the fact outlived it.
    expect(hasSeenPaymentConfirmation(), 'the acknowledgement died at the /auth redirect').toBe(true);

    // Now they sign in on the new origin, exactly as the screen promised.
    state.user = PASTOR;
    await act(async () => { state.authListeners.forEach((cb) => cb(state.user)); });
    await flush();
    await finishFirstRun();

    expect(text(), 'the confirmation returned once the query string was dropped').not.toContain(CONFIRMATION);
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────── */

describe('2 — nobody who was never told is left untold', () => {
  it('a church that reaches the subdomain without having seen it is still shown it', async () => {
    // 🔴 THE STRAND GUARD, and it is worth exactly as much as test 1. #298's
    // render exists for a real case: the webhook landed late, the tab was
    // closed, someone typed the address. That church has been charged and has
    // been told nothing. Deleting the render outright would drop the
    // reassurance for precisely these people.
    await arriveAtWorkspace(WORKSPACE_URL);

    expect(hasSeenPaymentConfirmation(), 'this church has no acknowledgement to its name').toBe(false);
    await finishFirstRun();

    expect(text(), 'a church that was never told its payment succeeded was still not told').toContain(CONFIRMATION);
    expect(text()).toContain('Grace Community Church');
  });

  it('a church that renamed its subdomain is still warned about the next sign-in', async () => {
    // 🔴 THE SECOND STRAND, and the reason "already acknowledged" alone is not
    // enough to suppress. This church DID read the confirmation on the apex —
    // but that screen named the GENERATED address, and first-run has since
    // moved the workspace somewhere else. Another origin boundary is coming,
    // and the sentence warning them about it has not been said yet.
    const departure = await payOnApexAndCrossOver();
    state.renameTo = RENAMED;
    await arriveAtWorkspace(departure);

    expect(hasSeenPaymentConfirmation(), 'the acknowledgement did not cross').toBe(true);
    await finishFirstRun();

    expect(text(), 'a church about to cross another origin was sent off unwarned').toContain(SECOND_SIGN_IN);
    expect(text()).toContain(`${RENAMED}.theharvest.app`);
  });

  it('the acknowledgement alone never suppresses anything — the destination must also be this origin', () => {
    // Structural companion to the two cases above: the suppression is a
    // conjunction, and dropping either half re-opens one of them.
    const suppression = GATE_SRC.slice(GATE_SRC.indexOf('handoffRepeatsGivenConfirmation ='));
    const rule = suppression.slice(0, suppression.indexOf(';'));
    expect(rule).toContain('getTenantIdFromHost()');
    expect(rule).toContain('hasSeenPaymentConfirmation()');
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────── */

describe('3 — #327 is untouched', () => {
  it('the confirmation still renders before the hop', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    // The hold, the gate and the ordering are all #327's and all still here.
    expect(hops, 'the origin hop fired before the church was told it had paid').toEqual([]);
    expect(text()).toContain(CONFIRMATION);
    expect(rendered('first-run-setup')).toBe(false);
    expect(window.location.hostname).toBe('theharvest.app');
  });

  it('the cross-origin copy still names the destination', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    const secondSignIn = Array.from(container.querySelectorAll('p')).find((p) =>
      (p.textContent || '').includes(SECOND_SIGN_IN),
    );
    expect(secondSignIn, 'nothing on the screen mentions the second sign-in').toBeTruthy();
    expect(secondSignIn!.textContent).toContain(`${TENANT}.theharvest.app`);
    expect(secondSignIn!.textContent).toContain('expected');
    // And never the same-origin reassurance, which is false on the apex.
    expect(text()).not.toContain('already signed in at this address');
  });

  it('a refresh mid-confirmation still repaints rather than stranding', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();
    expect(text()).toContain(CONFIRMATION);

    // Same origin, same tab, same URL — the hold lives in sessionStorage
    // precisely so a refresh is decided by state that survives it. The new
    // arrival lane must not have disturbed that.
    unmount();
    mount();
    await flush();

    expect(text(), 'a refresh mid-read stranded the church').toContain(CONFIRMATION);
    expect(continueLink()?.getAttribute('href')).toBe(withPaymentConfirmationHandoff(WORKSPACE_URL));
    expect(hops).toEqual([]);
  });
});

/* ── 4 ─────────────────────────────────────────────────────────────────────── */

describe('4 — the suppression hint is a hint, and nothing more', () => {
  it('a forged suppression parameter grants no access, only hides a screen', async () => {
    // Nobody is signed in. The parameter is the only thing the visitor brings.
    hopTo(withPaymentConfirmationHandoff(WORKSPACE_URL));
    tenantCtx.tenantId = TENANT;
    state.user = null;
    state.userDoc = null;
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    // It bought them the sign-in prompt, like every other unauthenticated
    // arrival. No workspace, no admin surface, no tenant data.
    expect(rendered('auth-page')).toBe(true);
    expect(rendered('admin-dashboard'), 'a URL parameter opened the admin app').toBe(false);
    expect(window.location.pathname).toBe('/auth');
  });

  it('a forged suppression parameter does not promote a member to an admin', async () => {
    hopTo(withPaymentConfirmationHandoff(`${WORKSPACE}/admin`));
    tenantCtx.tenantId = TENANT;
    state.user = { uid: 'm1', email: 'member@gracechurch.org' };
    state.userDoc = {
      exists: true,
      data: { role: 'user', tenantId: TENANT, onboardingCompleted: true, signupInProgress: false },
    };
    state.tenantDoc = { exists: true, data: { name: 'Grace Community Church', setupCompleted: true } };

    mount();
    await flush();

    // The parameter was honoured — it is, after all, user-writable — and it
    // changed nothing that matters: the admin route still turned them away.
    expect(hasSeenPaymentConfirmation()).toBe(true);
    expect(rendered('admin-dashboard'), 'a URL parameter granted an admin route').toBe(false);
    expect(rendered('main-app')).toBe(true);
  });

  it('a forged parameter cannot suppress the confirmation on the origin that gives it', async () => {
    // The hint is an INBOUND signal for a destination. The apex is where this
    // fact is created, so it must never import one — otherwise a mangled or
    // forged link strands the payer on the one screen they are owed.
    startAt(withPaymentConfirmationHandoff(`${APEX}/?dodo=success`));
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    expect(hasSeenPaymentConfirmation(), 'the apex imported an acknowledgement it should have made').toBe(false);
    expect(text(), 'a forged parameter suppressed the confirmation the church had not read').toContain(CONFIRMATION);
    expect(hops).toEqual([]);
  });

  it('an empty or mangled parameter value fails closed, i.e. shows the screen', async () => {
    hopTo(`${WORKSPACE}/admin?${PAYMENT_CONFIRMATION_HANDOFF_PARAM}=`);
    tenantCtx.tenantId = TENANT;
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    expect(hasSeenPaymentConfirmation()).toBe(false);
    await finishFirstRun();
    expect(text()).toContain(CONFIRMATION);
  });

  it('no access decision anywhere reads the parameter — only the paid-arrival lane knows its name', () => {
    // 🔴 Structural, and the real guarantee behind "only hides a screen". The
    // literal exists in exactly one module, whose whole vocabulary is what the
    // BROWSER shows next. Every caller goes through a named helper, so no route,
    // role check or gate can be reading it for anything else.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) {
          if (entry !== '__tests__' && entry !== 'node_modules') walk(p);
        } else if (/\.tsx?$/.test(p)) files.push(p);
      }
    };
    walk(SRC);

    const owners = files
      .filter((f) => readFileSync(f, 'utf8').includes(`'${PAYMENT_CONFIRMATION_HANDOFF_PARAM}'`))
      .map((f) => path.relative(SRC, f));
    expect(owners).toEqual(['utils/paid-arrival.ts']);

    // And the callers reach it only by label.
    for (const src of [APP_SRC, GATE_SRC, HANDOFF_SRC]) {
      expect(src).not.toContain(`'${PAYMENT_CONFIRMATION_HANDOFF_PARAM}'`);
    }
  });
});

/* ── 5 ─────────────────────────────────────────────────────────────────────── */

describe('5 — everything beside this path is unchanged', () => {
  it('a church that did not just pay is redirected exactly as before', async () => {
    // 🔴 NO-REGRESSION. No processor marker ⇒ no gate, no hold, and — because
    // no confirmation was ever given — no hint riding the hop either.
    startAt(`${APEX}/`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = justProvisionedTenant();

    mount();
    await flush();

    expect(hops, 'a church that did not just pay was held back or re-addressed').toEqual([WORKSPACE_URL]);
    expect(text()).not.toContain(CONFIRMATION);
  });

  it('an established church on a stale success URL is redirected, not congratulated', async () => {
    startAt(`${APEX}/?dodo=success`);
    state.user = PASTOR;
    state.userDoc = provisionedUserDoc();
    state.tenantDoc = { exists: true, data: { name: 'Grace Community Church', setupCompleted: true } };

    mount();
    await flush();

    expect(hops).toEqual([WORKSPACE_URL]);
    expect(text()).not.toContain(CONFIRMATION);
  });

  it('the chosen billing period still reaches checkout unchanged', async () => {
    // #310's lane: `?billing=` rides sessionStorage across the /auth redirect
    // that drops the query, so a church that chose annual buys annual. The new
    // arrival lane rides the same redirect and must not have disturbed it.
    startAt(`${APEX}/auth?signup=plus&billing=yearly`);
    state.user = PASTOR;
    state.userDoc = { exists: true, data: { role: 'user', tenantId: null } };
    state.tenantDoc = { exists: false };

    mount();
    await flush();

    expect(sessionStorage.getItem(SIGNUP_BILLING_STORAGE_KEY)).toBe('yearly');
    expect(resolveSignupBillingPeriod('')).toBe('yearly');
    expect(window.location.pathname).toBe('/church-onboarding');
  });

  it('the two lanes share no key and no vocabulary', () => {
    // Structural, so no later edit routes the period through the arrival lane.
    const paidArrival = readFileSync(path.join(SRC, 'utils/paid-arrival.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(paidArrival).not.toContain(SIGNUP_BILLING_STORAGE_KEY);
    expect(paidArrival).not.toContain('billing');
    expect(PAYMENT_CONFIRMATION_HANDOFF_PARAM).not.toBe(SIGNUP_BILLING_STORAGE_KEY);
    expect(PAYMENT_CONFIRMATION_HANDOFF_PARAM).not.toBe(PAYMENT_CONFIRMATION_SEEN_KEY);
  });

  it('the funnel precedence beside this path is unchanged', () => {
    expect(APP_SRC).toContain("const FUNNEL_PATHS = ['/auth', '/onboarding', '/church-onboarding'];");
    expect(APP_SRC).toContain('resolvePostAuthFunnelRoute({');
    // The one-shot admin intent flag is consumed regardless of path, deliberately.
    expect(APP_SRC).toContain("sessionStorage.getItem('intentionalUserView') === 'true'");
  });
});

/* ── 6 ─────────────────────────────────────────────────────────────────────── */

describe('6 — the webhook remains the single writer', () => {
  it('nothing in this path writes the tenant plan or onboardingCompleted', async () => {
    // The whole two-origin journey, including the new arrival lane and the
    // suppression, exercised end to end.
    const departure = await payOnApexAndCrossOver();
    await arriveAtWorkspace(departure);
    await finishFirstRun();
    await firstRunLandsOnTheTenantDoc();

    // The Firestore stub exposes reads only; a write would have failed as an
    // unresolved import long before this assertion.
    expect(state.writes).toEqual([]);
    expect(state.userDoc?.data?.onboardingCompleted).toBe(true);
    expect(state.userDoc?.data?.plan).toBe('plus');
  });

  it('neither the arrival lane nor the suppression gained a write', () => {
    const codeOf = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const paidArrival = codeOf(readFileSync(path.join(SRC, 'utils/paid-arrival.ts'), 'utf8'));

    // 🔴 The hint is a note about what the BROWSER shows next. Giving it a
    // Firestore write is how a second writer gets in beside the webhook.
    expect(paidArrival).not.toContain('firebase');
    expect(paidArrival).not.toContain('setDoc');
    expect(paidArrival).not.toContain('updateDoc');
    expect(paidArrival).not.toContain('onboardingCompleted');
    expect(paidArrival).not.toMatch(/\bplan\b/);

    for (const src of [codeOf(APP_SRC), codeOf(GATE_SRC), codeOf(HANDOFF_SRC)]) {
      expect(src).not.toContain('setDoc');
      expect(src).not.toContain('updateDoc');
      expect(src).not.toContain('writeBatch');
    }
  });

  it('the destination is told by URL, never by a second writer of tenant state', () => {
    // The mechanism chosen for THE-138 part 2, pinned: the fact crosses on the
    // hop and lands in per-origin browser storage. No Firestore field was added
    // to carry it, so `plan` and `onboardingCompleted` keep their single writer.
    expect(HANDOFF_SRC).toContain('withPaymentConfirmationHandoff');
    expect(APP_SRC).toContain('capturePaymentConfirmationHandoff');
    expect(GATE_SRC).toContain('hasSeenPaymentConfirmation');
  });
});
