import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import AdminDashboard from '../AdminDashboard';
import { clearRosterAnswerCache } from '../../utils/roster-cache';
import type { RosterAdminStatus } from '../../utils/tenant.utils';

/**
 * THE-139 — a rate limit takes an admin's tabs away.
 *
 * On connect.theharvest.app/admin/livestream the shared `/api/*` limiter
 * (30/min per IP at the time) started answering 429 to both entitlement
 * lookups. The nav read the 429 as "the roster says no" and every admin tab
 * except Dashboard disappeared.
 *
 * This is the third instance of one shape — THE-64, then THE-83/#301 — an async
 * entitlement lookup does not answer, the UI treats silence as denial, and
 * nothing throws. The difference here is that the lookup was not denied. It was
 * rate limited, which is "ask again in a moment", not "no".
 *
 * These tests drive the REAL `tenant.utils` three-state outcome and the REAL
 * roster cache. Only the fetch layer and Firebase are mocked, so a 429 arrives
 * here exactly as it arrived in production: as an HTTP status on the roster
 * lookup, not as a pre-decided `RosterAdminStatus`.
 *
 * The invariant, in both directions:
 *   • a lookup that could not answer never REDUCES the nav, and
 *   • a roster that genuinely answered "no" never GRANTS one.
 * The second is not a footnote. A fix that widened access on an unknown answer
 * would be worse than the bug it replaced.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT_ID = 'connect';
const OTHER_TENANT_ID = 'grace';
const UID = 'user-1';

const navigate = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: {} as { section?: string; itemId?: string } }));
const isSuperAdminMock = vi.hoisted(() => vi.fn(() => false));
const hasPlatformOverrideMock = vi.hoisted(() => vi.fn(() => false));
const store = vi.hoisted(() => ({
  current: { tenantPlan: 'max' as string | null, currentTenantId: 'connect' as string | null, isAuthReady: true },
}));
const currentUser = vi.hoisted(() => ({
  current: { uid: 'user-1', getIdToken: async () => 'token' } as { uid: string; getIdToken: () => Promise<string> } | null,
}));
const userQuery = vi.hoisted(() => ({ current: { data: undefined as unknown, isLoading: false } }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => params.current,
}));
// 🔴 tenant.utils is deliberately NOT mocked — the point is to exercise the real
// lookup, its real retry policy and its real three-state outcome against a real
// HTTP 429. Mocking it would assert only that this test can say 'error'.
vi.mock('../../utils/tenant-scope', () => ({
  isSuperAdmin: isSuperAdminMock,
  hasPlatformOverride: hasPlatformOverrideMock,
  getTenantScope: async () => TENANT_ID,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store.current }));
vi.mock('../../hooks/queries/useUserQueries', () => ({ useCurrentUser: () => userQuery.current }));
vi.mock('../../hooks/queries/useTenantQueries', () => ({
  useTenant: () => ({ data: { name: 'Connect Church', ownerId: 'someone-else' } }),
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
  collection: () => ({}), query: () => ({}), where: () => ({}), limit: () => ({}),
  onSnapshot: () => () => {},
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get' },
  handleFirestoreError: () => {},
}));
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

// Every admin screen is a leaf here. GraceWindowBanner is deliberately NOT
// stubbed: its `/api/tenants/grace-status` call is the entitlement timer's
// convergence trigger (THE-125) and one of the two callers whose traffic this
// card is about, so it has to be real for the call counts below to mean
// anything.
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

// ── The fetch layer ─────────────────────────────────────────────────────────

/** Every `/api/*` URL requested, in order — the traffic the limiter would see. */
let apiCalls: string[] = [];
/** Queued roster-status responses; the last one repeats once the queue drains. */
let rosterResponses: Array<() => Response> = [];

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' }, ...init,
  });

/** A 429 shaped like the one `checkRateLimit` actually returns. */
const tooManyRequests = (retryAfterSeconds = 1) =>
  new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) },
  });

const rosterSays = (isRosterAdmin: boolean) => () => json({ isRosterAdmin });

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    apiCalls.push(url);
    if (url.includes('/api/tenants/roster-status')) {
      const next = rosterResponses.length > 1 ? rosterResponses.shift()! : rosterResponses[0];
      return next ? next() : json({ isRosterAdmin: false });
    }
    if (url.includes('/api/tenants/grace-status')) return json({ state: 'none' });
    return json({});
  }));
}

const callsTo = (fragment: string) => apiCalls.filter((u) => u.includes(fragment)).length;

// ── Harness ─────────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

/** Every tab label currently reachable in the nav (mobile bar ∪ desktop sidebar). */
const ALL_TAB_LABELS = [
  'Dashboard', 'Church', 'Church List', 'Courses', 'Blog', 'AI Knowledge', 'Newsletter',
  'Fundraising', 'Events', 'Notes', 'CRM', 'Signups', 'Accounting', 'Forms', 'Check-In', 'Livestream',
  'SMS', 'Community', 'Library', 'Tenants', 'Affiliate', 'Branding', 'Settings', 'More',
];
function navLabels(): Set<string> {
  const found = new Set<string>();
  container.querySelectorAll('button').forEach((b) => {
    const text = b.textContent?.trim() ?? '';
    if (ALL_TAB_LABELS.includes(text)) found.add(text);
  });
  /* THE-332 — the desktop nav is a RAIL. A group's tabs live in a flyout that
     unmounts while it is closed, so they are read from the rail entry's own
     model rather than from buttons that are not mounted yet. This reports
     ENTITLEMENT, which is what this file is about and which THE-332 did not
     change; that the model equals what the flyout actually renders is asserted
     in THE-332.nav-rail.test.tsx, so this cannot report a tab no user can
     reach. */
  /* 🔴 THE-334 — Settings LEFT the rail for the account menu pinned at the
     rail's floor, on the founder's instruction ("remove the settings from the
     sidebar"). Its ENTITLEMENT did not move: the menu row and this attribute are
     gated on the same `canSettings`. A closed menu has no rows in the DOM, so
     — exactly as THE-332 did for the flyouts — the entry advertises what it can
     reach and this reads that model. THE-334's own suite holds the attribute
     equal to what the menu actually renders AND walks the row to the router, so
     a tab cannot be advertised here and be unreachable in fact. */
  container.querySelectorAll('[data-nav-account-labels]').forEach((g) => {
    (g.getAttribute('data-nav-account-labels') ?? '').split('|').forEach((l) => {
      if (ALL_TAB_LABELS.includes(l)) found.add(l);
    });
  });
  container.querySelectorAll('[data-nav-group-labels]').forEach((g) => {
    (g.getAttribute('data-nav-group-labels') ?? '').split('|').forEach((l) => {
      if (ALL_TAB_LABELS.includes(l)) found.add(l);
    });
  });
  /* The two PINNED rail entries (Dashboard, Settings) are icon-only, so their
     name is the accessible one rather than text content. `aria-label` is not a
     weaker signal here than `textContent` was — it is the name a screen reader
     announces, and the old collapsed sidebar carried the same name in a `title`
     attribute that no assistive technology could reach. */
  container.querySelectorAll('[data-nav-rail-tab]').forEach((b) => {
    const name = b.getAttribute('aria-label') ?? '';
    if (ALL_TAB_LABELS.includes(name)) found.add(name);
  });
  return found;
}

/** True while the dashboard is showing its loading skeleton (no nav rendered). */
const isSkeleton = () => container.querySelector('.animate-spin') !== null;

/** The tabs a roster grant — and nothing else — puts in front of this admin. */
const ROSTER_GRANTED_TABS = ['CRM', 'Blog', 'Courses', 'Community', 'Settings'];

type Who = { role?: string; permissions?: Record<string, boolean> };

async function mount(who: Who = { role: 'user', permissions: {} }, opts: { section?: string } = {}) {
  params.current = opts.section ? { section: opts.section } : {};
  userQuery.current = {
    data: { role: who.role ?? 'user', permissions: who.permissions ?? {}, displayName: 'B', email: 'admin@theharvest.app' },
    isLoading: false,
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminDashboard onNavigate={() => {}} />);
  });
  mounted = true;
}

async function unmount() {
  if (!mounted) return;
  mounted = false;
  await act(async () => { root.unmount(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  clearRosterAnswerCache();
  apiCalls = [];
  rosterResponses = [rosterSays(false)];
  store.current = { tenantPlan: 'max', currentTenantId: TENANT_ID, isAuthReady: true };
  currentUser.current = { uid: UID, getIdToken: async () => 'token' };
  isSuperAdminMock.mockReturnValue(false);
  hasPlatformOverrideMock.mockReturnValue(false);
  installFetch();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmount();
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearRosterAnswerCache();
});

describe('THE-139 — a rate-limited entitlement lookup must not reduce the nav', () => {
  // ── 1. The regression for the live defect ─────────────────────────────────
  it('a 429 on the roster lookup does not reduce the nav', async () => {
    vi.useFakeTimers();
    // Exactly the production sequence: the limiter refuses, then the window
    // slides and the same question is answered. A 429 clears on its own.
    rosterResponses = [() => tooManyRequests(1), rosterSays(true)];

    // A roster-only admin: no admin role, no permissions. Every tab they have
    // comes from the roster, so a 429 read as "no" costs them all of them.
    await mount({ role: 'user', permissions: {} }, { section: 'livestream' });
    await flush();

    // Mid-retry the nav is held, NOT rendered from the unanswered lookup.
    expect(navLabels().size).toBe(0);

    // The limiter asked for 1s; the retry waits it out rather than guessing.
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await flush();

    const labels = navLabels();
    for (const tab of ROSTER_GRANTED_TABS) {
      expect(labels.has(tab), `429 cost the admin the "${tab}" tab`).toBe(true);
    }
    // The retry actually happened — this is not passing because the 429 was
    // never delivered.
    expect(callsTo('/api/tenants/roster-status')).toBe(2);
    expect(navigate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a 429 that never clears still fails CLOSED, loudly, rather than granting tabs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    rosterResponses = [() => tooManyRequests(1)];

    await mount({ role: 'user', permissions: { writeArticles: true } });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    await flush();

    // Retries are bounded: it settles rather than hanging or retrying forever.
    expect(navLabels().has('Blog')).toBe(true);
    // …and it never invents access the roster did not confirm.
    expect(navLabels().has('CRM')).toBe(false);
    expect(warn.mock.calls.some(([m]) => String(m).includes('roster lookup'))).toBe(true);
    warn.mockRestore();
    vi.useRealTimers();
  });

  // ── 2. A timeout is the same class of non-answer ──────────────────────────
  it('a timeout on the roster lookup does not reduce the nav', async () => {
    // First load answers, so the session has a settled answer for this admin.
    rosterResponses = [rosterSays(true)];
    await mount({ role: 'user', permissions: {} });
    await flush();
    expect(navLabels().has('CRM')).toBe(true);
    await unmount();

    // The shell remounts (a reload of the view, a return from the member app)
    // and this time the lookup never answers at all.
    vi.useFakeTimers();
    rosterResponses = [() => { throw new Error('never answers'); }];
    const before = callsTo('/api/tenants/roster-status');

    await mount({ role: 'user', permissions: {} });
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    await flush();

    const labels = navLabels();
    for (const tab of ROSTER_GRANTED_TABS) {
      expect(labels.has(tab), `a hung lookup cost the admin the "${tab}" tab`).toBe(true);
    }
    // It did not reduce the nav because it did not have to ask: the answer was
    // already known. Nothing was sent to the limiter at all.
    expect(callsTo('/api/tenants/roster-status')).toBe(before);
    vi.useRealTimers();
  });

  it('a remount renders the known nav on the first paint, without a skeleton flash', async () => {
    rosterResponses = [rosterSays(true)];
    await mount({ role: 'user', permissions: {} });
    await flush();
    expect(navLabels().has('CRM')).toBe(true);
    await unmount();

    // Remount and look BEFORE any promise has had a chance to settle. Crossing
    // between '/admin' and '/admin/:section' is a real remount (separate router
    // entries), and it is the hop an admin makes most often — resolving the
    // roster asynchronously each time would blink the whole nav away and back.
    // Synchronous act on purpose: an async one would flush the lookup's promise
    // and hide the very frame under test.
    act(() => {
      root = createRoot(container);
      root.render(<AdminDashboard onNavigate={() => {}} />);
    });
    mounted = true;

    expect(isSkeleton(), 'the nav blinked through a skeleton on remount').toBe(false);
    expect(navLabels().has('CRM')).toBe(true);

    await flush();
    expect(navLabels().has('CRM')).toBe(true);
  });

  // ── 3. 🔴 The fail-open guard ─────────────────────────────────────────────
  it('a roster that genuinely says no still hides the tabs', async () => {
    rosterResponses = [rosterSays(false)];

    await mount({ role: 'user', permissions: {} });
    await flush();

    const labels = navLabels();
    // Dashboard is unconditional; everything else here was roster-granted.
    expect(labels.has('Dashboard')).toBe(true);
    for (const tab of ROSTER_GRANTED_TABS) {
      expect(labels.has(tab), `"${tab}" must not be offered on a settled "no"`).toBe(false);
    }
    expect(labels.has('Tenants')).toBe(false);
  });

  it('a settled "no" is not softened into "unknown" by the retry policy', async () => {
    // 403 is an answer about this request, not a hiccup: it must be taken at
    // face value and must NOT be retried.
    rosterResponses = [() => json({ error: 'forbidden' }, { status: 403 })];

    await mount({ role: 'user', permissions: { writeArticles: true } });
    await flush();

    expect(navLabels().has('Blog')).toBe(true);
    expect(navLabels().has('CRM')).toBe(false);
    expect(callsTo('/api/tenants/roster-status')).toBe(1);
  });

  // ── 4. The THE-64 shape still holds ───────────────────────────────────────
  it('a roster admin with no admin role on their user doc still sees their tabs', async () => {
    rosterResponses = [rosterSays(true)];

    await mount({ role: 'user', permissions: {} }, { section: 'crm' });
    await flush();

    const labels = navLabels();
    for (const tab of ROSTER_GRANTED_TABS) {
      expect(labels.has(tab), `roster-only admin lost "${tab}"`).toBe(true);
    }
    // And is not bounced off the tab they opened.
    expect(navigate).not.toHaveBeenCalled();
  });

  // ── 5. The traffic itself ─────────────────────────────────────────────────
  it('one admin page load stays within the api rate limit', async () => {
    rosterResponses = [rosterSays(true)];

    await mount({ role: 'user', permissions: {} });
    await flush();
    const perLoad = apiCalls.length;

    // One load asks each entitlement question exactly once.
    expect(callsTo('/api/tenants/roster-status')).toBe(1);
    expect(callsTo('/api/tenants/grace-status')).toBe(1);
    expect(perLoad).toBe(2);

    // Now the behaviour that produced THE-139: the admin moves around the
    // dashboard, remounting the shell each time. The roster question is not
    // re-asked, so the cost of a session does not grow with navigation.
    for (const section of ['livestream', 'crm', 'blog', 'courses', 'community', 'accounting']) {
      await unmount();
      await mount({ role: 'user', permissions: {} }, { section });
      await flush();
    }
    expect(callsTo('/api/tenants/roster-status')).toBe(1);

    // The whole session stays comfortably inside the limiter's window. The
    // ceiling is read from the limiter itself so this fails if either half
    // regresses — the cap being lowered, or the refetching coming back.
    const source = readFileSync(join(process.cwd(), 'src/lib/rate-limit.ts'), 'utf8');
    const apiWindow = /api:[\s\S]*?slidingWindow\((\d+),\s*'60 s'\)/.exec(source);
    expect(apiWindow, 'could not read the api limiter from rate-limit.ts').not.toBeNull();
    const limit = Number(apiWindow![1]);
    expect(apiCalls.length).toBeLessThan(limit);
  });

  // ── 6/7. The cache is scoped, in both dimensions ──────────────────────────
  it('the roster answer is not reused across tenants', async () => {
    rosterResponses = [rosterSays(true)];
    await mount({ role: 'user', permissions: {} });
    await flush();
    expect(navLabels().has('CRM')).toBe(true);
    await unmount();

    // A different tenant. The previous "yes" was about a different church and
    // must not travel — this one says no, and the nav must reflect that.
    store.current = { ...store.current, currentTenantId: OTHER_TENANT_ID };
    rosterResponses = [rosterSays(false)];
    const before = callsTo('/api/tenants/roster-status');

    await mount({ role: 'user', permissions: {} });
    await flush();

    // It asked again rather than reusing tenant "connect"'s answer…
    expect(callsTo('/api/tenants/roster-status')).toBe(before + 1);
    expect(apiCalls.some((u) => u.includes(`tenantId=${OTHER_TENANT_ID}`))).toBe(true);
    // …and the new tenant's "no" is what the nav renders.
    for (const tab of ROSTER_GRANTED_TABS) {
      expect(navLabels().has(tab), `"${tab}" leaked across tenants`).toBe(false);
    }
  });

  it('the roster answer is not reused across a sign-in change', async () => {
    rosterResponses = [rosterSays(true)];
    await mount({ role: 'user', permissions: {} });
    await flush();
    expect(navLabels().has('CRM')).toBe(true);
    await unmount();

    // Somebody else signs in on the same tab, into the same tenant.
    currentUser.current = { uid: 'user-2', getIdToken: async () => 'token-2' };
    rosterResponses = [rosterSays(false)];
    const before = callsTo('/api/tenants/roster-status');

    await mount({ role: 'user', permissions: {} });
    await flush();

    expect(callsTo('/api/tenants/roster-status')).toBe(before + 1);
    for (const tab of ROSTER_GRANTED_TABS) {
      expect(navLabels().has(tab), `"${tab}" leaked across a sign-in`).toBe(false);
    }
  });

  // ── 8. The convergence trigger ────────────────────────────────────────────
  it('the grace-status call still happens', async () => {
    rosterResponses = [rosterSays(true)];

    await mount({ role: 'user', permissions: {} });
    await flush();

    // Not decoration: this read is what converges a lapsed church's entitlement
    // timer (THE-125). Silencing it to save a request would stop lapsed tenants
    // ever converging, which is a worse bug than the one this card is about.
    expect(callsTo('/api/tenants/grace-status')).toBe(1);
    expect(apiCalls.some((u) => u.includes(`grace-status?tenantId=${TENANT_ID}`))).toBe(true);
  });

  // ── 9. The signal survives ────────────────────────────────────────────────
  it('both console warnings still fire on their respective paths', async () => {
    // (a) the failure path — a lookup that cannot answer, retries exhausted.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    rosterResponses = [() => { throw new Error('offline'); }];

    await mount({ role: 'user', permissions: { writeArticles: true } });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    await flush();

    expect(
      warn.mock.calls.some(([m]) => String(m).includes('roster lookup') && String(m).includes('failed')),
      'the failure warning is gone — THE-64 was invisible partly because this path was silent',
    ).toBe(true);
    await unmount();
    warn.mockClear();

    // (b) the timeout path — a lookup that never settles at all.
    clearRosterAnswerCache();
    rosterResponses = [() => new Promise<Response>(() => {}) as unknown as Response];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    await mount({ role: 'user', permissions: { writeArticles: true } });
    await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
    await flush();

    expect(
      warn.mock.calls.some(([m]) => String(m).includes('timed out')),
      'the timeout warning is gone',
    ).toBe(true);
    warn.mockRestore();
    vi.useRealTimers();
  });

  // ── The type under test is the real one ───────────────────────────────────
  it('drives the real three-state roster outcome', async () => {
    const { checkRosterAdminStatus } = await import('../../utils/tenant.utils');
    rosterResponses = [rosterSays(true)];
    const answer: RosterAdminStatus = await checkRosterAdminStatus(TENANT_ID);
    expect(answer).toBe('admin');

    clearRosterAnswerCache();
    rosterResponses = [() => json({ error: 'nope' }, { status: 403 })];
    expect(await checkRosterAdminStatus(TENANT_ID)).toBe<RosterAdminStatus>('error');
  });
});
