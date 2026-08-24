import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-219 — a freshly provisioned FREE tenant must land on its own subdomain.
 *
 * 🔴 WHAT THE FOUNDER REPORTED, AND WHAT IT ACTUALLY WAS.
 *
 *   "After I signed up, it brought me to theharvest.app/admin — in the dashboard
 *    I could only see the dashboard in the bottom bar and a More button with an
 *    empty list. I had to go to the new subdomain that I created, manually."
 *
 * The empty nav is a SYMPTOM and is correct behaviour for where they were
 * standing: apex `/admin` resolves no tenant, so `AdminDashboard` never issues
 * the roster lookup, `rosterState` stays 'unknown', `hasFullAccess` is false and
 * `allTabs` collapses to Dashboard. Give that same account its own subdomain and
 * the nav is right — which `AdminDashboard.free-admin-nav.test.tsx` pins.
 *
 * So the defect under test here is the LANDING, and it lives in App.tsx's
 * post-auth callback. Two arms mean the same thing — "finished onboarding, on a
 * page that should hand them to their workspace" — but only the '/' arm knew a
 * tenant owner's workspace is on another origin:
 *
 *   FUNNEL_PATHS arm  → navigate(homeBase)          ← apex /admin. no hop.
 *   path === '/' arm  → window.location.href = …    ← the hop.
 *
 * Which arm a signup ends on is decided by where its funnel stops, and that is
 * the ONLY thing that differs between free and paid:
 *
 *   paid — the processor returns to `/?dodo=success`, so it lands on the '/'
 *          arm and has always hopped;
 *   free — no processor, and THE-214 removed the trip through '/', so it
 *          finishes ON `/church-onboarding` — a FUNNEL_PATH.
 *
 * ⚠️ PR #376 saw one instance of this (a refresh during the free confirmation)
 * and read it as a confirmation-screen edge not worth a second sessionStorage
 * marker. It is wider than that: the arm is wrong for EVERY re-entry, not just
 * a refreshed one, which is why the founder hit it without refreshing.
 */

// ── Controllable auth/firestore state ────────────────────────────────────────
const state = vi.hoisted(() => ({
  user: null as null | { uid: string; email: string },
  userDoc: null as null | { exists: boolean; data?: Record<string, unknown> },
  tenantDoc: null as null | { exists: boolean; data?: Record<string, unknown> },
  authListeners: [] as Array<(u: unknown) => void>,
  /** Every tenant id the app looked up, in order. A super admin must look up none. */
  tenantLookups: [] as unknown[],
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
 * ⚠️ Reads only. No `setDoc`/`updateDoc`/`writeBatch` is provided, so a write
 * attempted from this path fails as an unresolved import rather than quietly
 * succeeding — the webhook stays the single writer of `plan`, and a landing fix
 * has no business writing tenant state at all.
 */
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ col, id, path: `${col}/${id}` }),
  getDoc: async (ref: { col: string; id: unknown }) => {
    if (ref.col === 'tenants') state.tenantLookups.push(ref.id);
    const d = ref.col === 'users' ? state.userDoc : state.tenantDoc;
    return { exists: () => !!d?.exists, data: () => d?.data };
  },
  onSnapshot: (ref: { col: string }, next: (snap: unknown) => void) => {
    const d = ref.col === 'users' ? state.userDoc : state.tenantDoc;
    Promise.resolve().then(() => next({ exists: () => !!d?.exists, data: () => d?.data }));
    return () => { /* noop */ };
  },
}));

vi.mock('../components/AuthPage', () => ({ default: () => <div data-testid="auth-page" /> }));
vi.mock('../components/MainApp', () => ({ default: () => <div data-testid="main-app" /> }));
vi.mock('../components/AffiliateDashboard', () => ({ default: () => <div data-testid="affiliate-dashboard" /> }));
vi.mock('../components/Onboarding', () => ({ default: () => <div data-testid="member-onboarding" /> }));
vi.mock('../components/ChurchOnboarding', () => ({ default: () => <div data-testid="church-onboarding" /> }));
vi.mock('../components/AdminDashboard', () => ({ default: () => <div data-testid="admin-dashboard" /> }));
vi.mock('../components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
/**
 * The gate is passed through on purpose. It owns the free CONFIRMATION screen
 * (THE-214), which is a separate question from where the callback sends this
 * browser; stubbing it leaves exactly the routing decision under test.
 */
vi.mock('../components/OnboardingGate', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/PWAInstallManager', () => ({ default: () => null }));
vi.mock('../components/PostPurchaseWizard', () => ({ default: () => null }));
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
import { resolvePostAuthFunnelRoute } from '../utils/post-auth-route';
import { PROVISIONED_TENANT_OWNER_ROLE } from '../lib/roles';
import { SUPER_ADMIN_EMAILS } from '../utils/super-admins';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APEX_ORIGIN = 'https://theharvest.app';
const TENANT = 'gracechurch';
const WORKSPACE_URL = `https://${TENANT}.theharvest.app/admin`;

/**
 * 🔴 Named by LABEL, never by value pattern. The funnel screens are identified
 * by what they ARE — the paths App.tsx classifies as the auth/onboarding funnel
 * — so this list keeps meaning if a path is ever renamed.
 */
const FUNNEL_SCREENS = [
  { label: 'the sign-in screen', path: '/auth' },
  { label: 'member onboarding', path: '/onboarding' },
  { label: 'church onboarding — where a free signup finishes', path: '/church-onboarding' },
] as const;

/** The account state every provisioning path leaves behind, free included. */
const provisionedOwnerDoc = (over: Record<string, unknown> = {}) => ({
  exists: true,
  data: {
    role: PROVISIONED_TENANT_OWNER_ROLE,
    tenantId: TENANT,
    onboardingCompleted: true,
    signupInProgress: false,
    plan: 'free',
    ...over,
  },
});

/** A free tenant whose address was chosen at signup, so nothing is left to ask. */
const freshFreeTenant = () => ({
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
 * Point the browser at `url` and start recording origin hops. The redirect is a
 * real cross-origin navigation, so it is observed by intercepting the assignment
 * rather than letting the document unload — `location.pathname` / `hostname`
 * keep working, which the resolvers read.
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

async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

const rendered = (testId: string) => !!container.querySelector(`[data-testid="${testId}"]`);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  state.user = null;
  state.userDoc = null;
  state.tenantDoc = null;
  state.authListeners.length = 0;
  state.tenantLookups.length = 0;
  tenantCtx.tenantId = null;
  tenantCtx.isAdminDomain = false;
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
});

/* ── 1 ─────────────────────────────────────────────────────────────────────── */

describe('1 — a freshly provisioned free tenant lands on its own subdomain, not the apex', () => {
  it('a freshly provisioned free tenant lands on its own subdomain, not the apex', async () => {
    // Exactly where the free lane leaves the evangelist: on the apex, on the
    // church-onboarding funnel path, with a tenant that now exists.
    startAt(`${APEX_ORIGIN}/church-onboarding`);
    state.user = { uid: 'u1', email: 'pastor@gracechurch.org' };
    state.userDoc = provisionedOwnerDoc();
    state.tenantDoc = freshFreeTenant();

    mount();
    await flush();

    // 🔴 THE REPORT. Before the fix this was `[]` and the browser sat on apex
    // /admin — the origin with no tenant, and so with no roster and no nav.
    expect(hops, 'the free tenant was left on the apex instead of its own subdomain').toEqual([WORKSPACE_URL]);
    expect(window.location.pathname, 'the founder was parked on apex /admin').not.toBe('/admin');
  });

  it.each(FUNNEL_SCREENS)(
    'a provisioned owner re-entering on $label is handed to its subdomain',
    async ({ path: funnelPath }) => {
      // The founder hit this WITHOUT refreshing, and `api/tenants/delete` is why
      // a second signup can: it detaches the user (tenantId null, role 'user')
      // but leaves `onboardingCompleted: true` behind, so the very next auth
      // callback reaches this arm already "finished". Every funnel screen has to
      // hop, not just the one a refresh happens to land on.
      startAt(`${APEX_ORIGIN}${funnelPath}`);
      state.user = { uid: 'u1', email: 'pastor@gracechurch.org' };
      state.userDoc = provisionedOwnerDoc();
      state.tenantDoc = freshFreeTenant();

      mount();
      await flush();

      expect(hops).toEqual([WORKSPACE_URL]);
    },
  );

  it('an owner ALREADY on their subdomain is not hopped again', async () => {
    // The destination must be terminal — a hop that fires on arrival is a loop.
    startAt(`https://${TENANT}.theharvest.app/church-onboarding`);
    tenantCtx.tenantId = TENANT;
    state.user = { uid: 'u1', email: 'pastor@gracechurch.org' };
    state.userDoc = provisionedOwnerDoc();
    state.tenantDoc = freshFreeTenant();

    mount();
    await flush();

    expect(hops, 'the workspace bounced the owner off itself').toEqual([]);
  });

  it('an owner whose tenant no longer exists stays on the apex rather than a dead subdomain', async () => {
    // The existence check the '/' arm already performed comes with the hop; it
    // is not re-implemented, and it must still refuse an orphaned user doc.
    startAt(`${APEX_ORIGIN}/church-onboarding`);
    state.user = { uid: 'u1', email: 'pastor@gracechurch.org' };
    state.userDoc = provisionedOwnerDoc();
    state.tenantDoc = { exists: false };

    mount();
    await flush();

    expect(hops, 'the owner was thrown at a subdomain that renders Organization Not Found').toEqual([]);
    expect(window.location.pathname).toBe('/admin');
  });

  it('a MEMBER signing in on the apex is not hopped across an origin', async () => {
    // 🔴 The guard on the hop. Members have a tenantId too, and they reach this
    // arm on every sign-in. Hopping them is a change to member sign-in that
    // THE-219 does not make.
    startAt(`${APEX_ORIGIN}/auth`);
    state.user = { uid: 'm1', email: 'member@gracechurch.org' };
    state.userDoc = {
      exists: true,
      data: { role: 'user', tenantId: TENANT, onboardingCompleted: true },
    };
    state.tenantDoc = freshFreeTenant();

    mount();
    await flush();

    expect(hops, 'a member was teleported to the admin origin').toEqual([]);
    expect(window.location.pathname).toBe('/');
    expect(rendered('main-app')).toBe(true);
  });
});

/* ── 5 ─────────────────────────────────────────────────────────────────────── */

describe('5 — a super admin still operates on the apex with platformOverride intact', () => {
  it('a super admin still operates on the apex with platformOverride intact', async () => {
    startAt(`${APEX_ORIGIN}/auth`);
    state.user = { uid: 'sa', email: SUPER_ADMIN_EMAILS[0] };
    // 🔴 tenantId null, and it MUST stay null: for a super admin null means ALL
    // tenants. "Fixing" the apex by handing them a tenant would scope the
    // platform owner to one church.
    state.userDoc = { exists: true, data: { role: 'super_admin', tenantId: null, onboardingCompleted: true } };
    // A tenant doc that WOULD answer "yes" to any lookup. The guard under test
    // is that no lookup is made at all — without it the hop resolves a tenant id
    // of `null` and sends the platform owner to `https://null.theharvest.app`.
    state.tenantDoc = freshFreeTenant();

    mount();
    await flush();

    expect(state.tenantLookups, 'the apex asked about a tenant for a super admin').toEqual([]);

    expect(hops, 'the platform owner was hopped off the apex').toEqual([]);
    expect(window.location.pathname).toBe('/admin');
    expect(useAppStore.getState().isSuperAdmin).toBe(true);
    // 🔴 The apex IS the platform tenant for a super admin — the long-standing
    // PLATFORM_TENANT_ID fallback, untouched by this ticket. What must never
    // happen is the apex being "fixed" by handing the platform owner a CHURCH:
    // their scope is the platform, and a church tenant here would silently
    // narrow every tenant-scoped read and write to one congregation.
    expect(useAppStore.getState().currentTenantId).toBe(PLATFORM_TENANT_ID);
    expect(useAppStore.getState().currentTenantId, 'the super admin was scoped to a church').not.toBe(TENANT);
  });

  it('platformOverride is still the untouched platform-context read', () => {
    // hasPlatformOverride() === isPlatformContext(): the apex, with no tenant
    // subdomain. Nothing in this ticket may make it depend on a role or a hop.
    const src = readFileSync(path.join(process.cwd(), 'src/utils/tenant-scope.ts'), 'utf8');
    expect(src).toContain('export function hasPlatformOverride(): boolean {\n  return isPlatformContext();\n}');
  });
});

/* ── 7 ─────────────────────────────────────────────────────────────────────── */

describe('7 — the paid signup landing is unchanged', () => {
  it('the paid signup landing is unchanged', async () => {
    // The paid lane returns to `/?dodo=success` — the '/' arm, which hopped
    // before this ticket and hops identically after it.
    startAt(`${APEX_ORIGIN}/?dodo=success`);
    state.user = { uid: 'p1', email: 'pastor@paid.org' };
    state.userDoc = provisionedOwnerDoc({ plan: 'pro' });
    // setupCompleted true ⇒ not a just-provisioned church mid-confirmation, so
    // the THE-138 hold does not apply and the hop is the whole behaviour.
    state.tenantDoc = { exists: true, data: { name: 'Grace', setupCompleted: true } };

    mount();
    await flush();

    expect(hops).toEqual([WORKSPACE_URL]);
  });

  it('the THE-138 payment confirmation still holds the hop for a just-provisioned church', async () => {
    // `setupCompleted: false` + a processor success marker = a church that has
    // just been charged. It must be TOLD before it is sent to another origin.
    startAt(`${APEX_ORIGIN}/?dodo=success`);
    state.user = { uid: 'p1', email: 'pastor@paid.org' };
    state.userDoc = provisionedOwnerDoc({ plan: 'pro' });
    state.tenantDoc = { exists: true, data: { name: 'Grace', setupCompleted: false } };

    mount();
    await flush();

    expect(hops, 'the church was hopped before it was told the payment landed').toEqual([]);
  });
});

/* ── 8 ─────────────────────────────────────────────────────────────────────── */

describe('8 — the post-auth route order is unchanged', () => {
  /**
   * 🔴 PRs #327, #334, #343 and #376 all touched this ordering. It is asserted
   * as the DECISION TABLE it is — every combination of the four inputs, by
   * label — rather than by re-reading the source, so a rewrite that preserves
   * behaviour passes and one that reorders a branch cannot.
   */
  const ROUTE_ORDER = [
    { label: 'affiliate host + confirmed tenant-less beats every signup intent',
      args: { onAffiliateHost: true, confirmedTenantless: true, churchSignupIntent: true, planSignupIntent: true, isChurchAdminRole: true },
      expected: '/' },
    { label: 'affiliate host + a tenant still reaches the church flow',
      args: { onAffiliateHost: true, confirmedTenantless: false, churchSignupIntent: false, planSignupIntent: false, isChurchAdminRole: true },
      expected: '/church-onboarding' },
    { label: 'church signup intent → the paid church funnel',
      args: { onAffiliateHost: false, confirmedTenantless: true, churchSignupIntent: true, planSignupIntent: false, isChurchAdminRole: false },
      expected: '/church-onboarding' },
    { label: 'plan signup intent → the paid church funnel',
      args: { onAffiliateHost: false, confirmedTenantless: true, churchSignupIntent: false, planSignupIntent: true, isChurchAdminRole: false },
      expected: '/church-onboarding' },
    { label: 'an established church_admin role → the paid church funnel',
      args: { onAffiliateHost: false, confirmedTenantless: false, churchSignupIntent: false, planSignupIntent: false, isChurchAdminRole: true },
      expected: '/church-onboarding' },
    { label: 'no host, no intent, no role → generic member onboarding',
      args: { onAffiliateHost: false, confirmedTenantless: true, churchSignupIntent: false, planSignupIntent: false, isChurchAdminRole: false },
      expected: '/onboarding' },
  ] as const;

  it('the post-auth route order is unchanged', () => {
    for (const { label, args, expected } of ROUTE_ORDER) {
      expect(resolvePostAuthFunnelRoute({ ...args }), label).toBe(expected);
    }
  });

  it('FUNNEL_PATHS is unchanged — the fix changed what the arm DOES, not what it matches', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(src).toContain("const FUNNEL_PATHS = ['/auth', '/onboarding', '/church-onboarding'];");
    // Every funnel screen this suite exercises is one of them, so the table
    // above cannot silently drift from the array under test.
    for (const { path: p } of FUNNEL_SCREENS) expect(src).toContain(`'${p}'`);
  });
});
