import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-220 Part 2 — the admin emitted one pageview and then went silent.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── 🔴 WHICH OF THE TWO EXPLANATIONS HELD: NEITHER ──────────────────────────
 *
 * The ticket offers two, and the code answers a third. Measured against the
 * live project, every `$pageview` in fourteen days carried `route: '/admin'`
 * and `$pathname: '/admin'` — the two declared patterns `/admin/[section]` and
 * `/admin/[section]/[itemId]` had never been seen. So either the URL never
 * changed, or the bridge never saw it change.
 *
 *   • The admin DOES change the URL. `AdminDashboard.go()` calls
 *     `navigate('/admin/<slug>')` (react-router), and `activeTab` is derived
 *     from `useParams().section` — the tab cannot change WITHOUT the URL
 *     changing, because the URL is what stores it.
 *   • And `AnalyticsBridge` DOES observe it: it reads `useLocation()` inside
 *     the same `BrowserRouter`, and its effect is keyed on `pathname`.
 *
 * The tests below drive the REAL `AdminDashboard` through a REAL router with
 * the REAL bridge and the REAL PostHog client, click a real nav button, and
 * watch `/admin/[section]` leave. Both declared patterns are reachable, and
 * were reachable before this PR. What the production silence is consistent with
 * is sessions that never left `/admin` — which is what THE-219 (fixed in
 * 1aa1582, one day before those events) produced: an admin landing on apex
 * `/admin` had a Dashboard-only nav with nothing to click.
 *
 * ─── What WAS defective, and is fixed here ───────────────────────────────────
 *
 * 🔴 DOUBLE COUNTING, and it is in the production data. Two `/admin` pageviews
 * five seconds apart in one session (2026-08-23T23:13:34Z and :39Z) for one
 * screen nobody navigated to. `AnalyticsBridge` stored the Firebase user as a
 * fresh object literal on every `onAuthStateChanged` callback, so an ID-token
 * refresh made `authUser` a new dependency and re-ran the capture effect. That
 * violates this ticket's own non-negotiable — "a tab change must emit at most
 * one pageview" — in the direction that inflates every number on the dashboard.
 *
 * ─── ⚠️ THE MEMBER APP IS A DIFFERENT MECHANISM, and is NOT fixed here ───────
 *
 * `MainApp` holds its tabs in `useState` (`activeBottomTab` / `activeTopTab`)
 * and never calls `navigate`, so its tab changes produce no history entry and
 * nothing for a pathname-keyed hook to observe. The live data agrees: all eight
 * member pageviews carry `$pathname: '/'`. That IS the ticket's explanation (B)
 * — for the member app only. The ticket says to fix it only if it is the same
 * mechanism, and it is not: the admin's fix is a dedupe, the member app's would
 * be a new emitter and a new set of route patterns to name. Reported, not built.
 * `4 — the member app is state-driven` below pins the finding so it cannot be
 * quietly forgotten.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ── the SDK, faked at its own boundary ─────────────────────────────────────── */
//
// 🔴 `posthog-js` is mocked, NOT `lib/analytics/client`. Mocking the client
// would assert that the bridge called a function; mocking the SDK asserts what
// actually LEAVES — the event name and the property bag, after
// `normalizeAnalyticsPath` and the closed-vocabulary filter have both run. The
// question this file exists to answer is "what does a tab pageview send", and
// only the second shape can answer it.
const posthogMock = vi.hoisted(() => ({
  captures: [] as Array<{ event: string; properties: Record<string, unknown> }>,
  inits: [] as Array<{ key: string; options: Record<string, unknown> }>,
  init(key: string, options: Record<string, unknown>) { this.inits.push({ key, options }); },
  capture(event: string, properties: Record<string, unknown>) { this.captures.push({ event, properties }); },
  identified: [] as Array<{ distinctId: string; properties: Record<string, unknown> }>,
  groups: [] as string[],
  identify(distinctId: string, properties: Record<string, unknown>) { this.identified.push({ distinctId, properties }); },
  group(_type: string, key: string) { this.groups.push(key); },
  resetGroups() {}, reset() {},
}));
// ── THE-245 ────────────────────────────────────────────────────────────────
// Run with the SMS master switch ON. This suite is about PLAN ENTITLEMENT — who
// bought what — and the SMS tab is one of the cells it checks. Gating it off
// here would silently delete that column from the matrix; mocking it on keeps
// every tier's entitlement asserted AND doubles as the restore proof: flip
// SMS_FEATURE_ENABLED back to true and these are the surfaces that return.
// That the tab is GONE while the switch is off is asserted in
// the-245-sms-hidden.test.tsx instead.
vi.mock('../../lib/sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

// Reaches Firestore through tenant-scope; the bridge dynamic-imports it.
const identityGate = vi.hoisted(() => ({
  /** When set, `resolveAnalyticsIdentity` blocks on this until it is released. */
  pending: null as null | Promise<void>,
  release: null as null | (() => void),
  calls: 0,
  hold() {
    this.pending = new Promise<void>((r) => { this.release = () => r(); });
  },
}));
vi.mock('../../lib/analytics/identity', () => ({
  resolveAnalyticsIdentity: async (user: { uid: string } | null) => {
    identityGate.calls += 1;
    if (identityGate.pending) await identityGate.pending;
    return user
      ? { distinctId: user.uid, personProperties: { account_kind: 'tenant_admin' }, tenantGroupKey: 'grace', isPlatformAdmin: false }
      : null;
  },
}));

const TENANT_ID = 'grace';
const UID = 'user-1';

const authState = vi.hoisted(() => ({ callback: null as null | ((u: unknown) => void) }));
const checkRosterAdminStatus = vi.hoisted(() => vi.fn());
const isSuperAdminMock = vi.hoisted(() => vi.fn(() => false));
const hasPlatformOverrideMock = vi.hoisted(() => vi.fn(() => false));
const store = vi.hoisted(() => ({
  current: { tenantPlan: 'max' as string | null, currentTenantId: 'grace' as string | null, isAuthReady: true },
}));
const currentUser = vi.hoisted(() => ({ current: { uid: 'user-1' } as { uid: string } | null }));
const userQuery = vi.hoisted(() => ({ current: { data: undefined as unknown, isLoading: false } }));

vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdminStatus }));
vi.mock('../../utils/tenant-scope', () => ({
  isSuperAdmin: isSuperAdminMock, hasPlatformOverride: hasPlatformOverrideMock,
  getTenantScope: async () => TENANT_ID, PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store.current }));
vi.mock('../../hooks/queries/useUserQueries', () => ({ useCurrentUser: () => userQuery.current }));
/* THE-334 — a flyout's pinned footer reads that group's recent items, and it
   mounts INSIDE the popup, so walking the tabs now touches React Query. These
   three stubs keep this suite about PAGEVIEWS: what the recents list contains
   is asserted in THE-334's own suite, not here. */
vi.mock('../../hooks/queries/useDocsQueries', () => ({
  useDocs: () => ({ data: { items: [], truncated: false }, isLoading: false }),
}));
vi.mock('../../hooks/queries/useCRMQueries', () => ({
  useContacts: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../hooks/queries/useEventQueries', () => ({
  useEvents: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../hooks/queries/useTenantQueries', () => ({
  useTenant: () => ({ data: { name: 'Grace Ministry', ownerId: 'someone-else' }, isLoading: false }),
}));
vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => ({ branding: null, isLoading: false, tenantPlan: store.current.tenantPlan ?? undefined }),
}));
vi.mock('../../firebase', () => ({
  db: {}, get auth() { return { get currentUser() { return currentUser.current; } }; },
}));
vi.mock('firebase/auth', () => ({
  signOut: vi.fn(async () => {}),
  onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => { authState.callback = cb; return () => {}; },
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), query: () => ({}), where: () => ({}), limit: () => ({}), onSnapshot: () => () => {},
}));
vi.mock('../../utils/firestore-errors', () => ({ OperationType: { GET: 'get' }, handleFirestoreError: () => {} }));
vi.mock('../AdminRoles', () => ({ normalizePermissions: (raw: unknown) => raw }));
vi.mock('../AdminScreenHeader', async () => {
  const R = await import('react');
  return {
    AdminScreenHeader: () => null,
    AdminHeaderContext: R.createContext({ setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderHidden: () => {} }),
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
vi.mock('../GraceWindowBanner', stub);

/**
 * The one screen NOT stubbed away: it publishes the in-product path to an
 * `/admin/[section]/[itemId]` URL, so test 13's second pattern is reached the
 * way the product reaches it rather than by typing a path into the test.
 */
vi.mock('../AdminCommunity', async () => {
  const R = await import('react');
  return {
    default: ({ onOpenAttachment }: { onOpenAttachment: (t: string, id: string) => void }) =>
      R.createElement('button', { id: 'open-doc', onClick: () => onOpenAttachment('doc', 'aB3xQ9zK7mN2pL5r') }, 'attachment'),
  };
});

import AdminDashboard from '../AdminDashboard';
import AnalyticsBridge from '../AnalyticsBridge';
import { __resetAnalyticsForTests } from '../../lib/analytics/client';
import { buildPostHogOptions, beforeSendEvent } from '../../lib/analytics/config';
import { ALLOWED_EVENT_PROPERTY_KEYS, ANALYTICS_EVENTS } from '../../lib/analytics/events';
import { ANALYTICS_ROUTES, normalizeAnalyticsPath } from '../../lib/analytics/routes';

const ROOT = join(process.cwd());
let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
};

/** Mount the real admin, inside the real router, beside the real bridge. */
async function mountAdmin(initialPath = '/admin') {
  userQuery.current = {
    data: { role: 'church_admin', permissions: {}, displayName: 'B', email: 'admin@grace.test' },
    isLoading: false,
  };
  const admin = <AdminDashboard onNavigate={() => {}} />;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <AnalyticsBridge />
        <Routes>
          <Route path="/admin" element={admin} />
          <Route path="/admin/:section" element={admin} />
          <Route path="/admin/:section/:itemId" element={admin} />
        </Routes>
      </MemoryRouter>,
    );
  });
  mounted = true;
  await flush();
}

/** Answer Firebase's listener the way a real sign-in does. */
async function signIn(uid = UID, email: string | null = 'admin@grace.test') {
  await act(async () => { authState.callback?.({ uid, email }); });
  await flush();
}

async function unmount() {
  if (!mounted) return;
  mounted = false;
  await act(async () => { root.unmount(); });
}

/** Click a nav button by the LABEL a founder reads in the product. */
/** The rail entry that OWNS a tab label, if the tab lives inside a flyout. */
function owningRailGroup(label: string): HTMLButtonElement | null {
  const group = [...container.querySelectorAll('[data-nav-group-labels]')].find((g) =>
    (g.getAttribute('data-nav-group-labels') ?? '').split('|').includes(label),
  );
  if (!group) return null;
  return group.querySelector<HTMLButtonElement>('[data-nav-rail-group]');
}

/**
 * Click a nav destination by name.
 *
 * THE-332 — the desktop nav is a rail, so a tab is one of three things: a
 * button with that text (the mobile bar), an icon-only pinned rail button whose
 * name is its `aria-label`, or a row inside a flyout that is not mounted until
 * its rail entry is opened. This walks the REAL path a user walks — it opens
 * the flyout and clicks the row — rather than reaching past the interaction, so
 * a tab that could not actually be opened still fails here.
 */
async function clickTab(label: string) {
  const byText = () =>
    [...container.querySelectorAll('button'), ...document.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === label);
  const byAria = () =>
    [...container.querySelectorAll<HTMLButtonElement>('[data-nav-rail-tab]')]
      .find((b) => b.getAttribute('aria-label') === label);

  let button: Element | undefined = byText() ?? byAria();
  if (!button) {
    const group = owningRailGroup(label);
    expect(group, `no nav entry named "${label}", and no rail group advertises it`).toBeTruthy();
    await act(async () => { group!.click(); });
    await flush();
    button = byText();
  }
  expect(button, `no nav button labelled "${label}"`).toBeTruthy();
  await act(async () => { (button as HTMLButtonElement).click(); });
  await flush();
}

const pageviews = () => posthogMock.captures.filter((c) => c.event === ANALYTICS_EVENTS.PAGEVIEW);
const routes = () => pageviews().map((c) => c.properties.route as string);

beforeEach(() => {
  vi.clearAllMocks();
  posthogMock.captures.length = 0;
  posthogMock.inits.length = 0;
  posthogMock.identified.length = 0;
  posthogMock.groups.length = 0;
  identityGate.pending = null;
  identityGate.release = null;
  identityGate.calls = 0;
  __resetAnalyticsForTests();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
  authState.callback = null;
  store.current = { tenantPlan: 'max', currentTenantId: TENANT_ID, isAuthReady: true };
  currentUser.current = { uid: UID };
  isSuperAdminMock.mockReturnValue(false);
  hasPlatformOverrideMock.mockReturnValue(false);
  checkRosterAdminStatus.mockResolvedValue('admin');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmount();
  container.remove();
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  __resetAnalyticsForTests();
});

// ── 10 ───────────────────────────────────────────────────────────────────────
describe('10 — changing an admin tab emits a pageview', () => {
  it('changing an admin tab emits a pageview', async () => {
    await mountAdmin('/admin');
    await signIn();
    expect(routes(), 'the load itself did not count').toEqual(['/admin']);

    // 🔴 The reported gap: the founder walked these tabs and nothing fired.
    // ⚠️ THE-227 — the second entry names the section. It read
    // `'/admin/[section]'` until then, which is the bucket this whole ticket
    // exists to break apart.
    await clickTab('CRM');
    expect(routes(), 'a tab change emitted nothing').toEqual(['/admin', '/admin/crm']);
  });

  it('every tab the founder walked emits, one after another', async () => {
    await mountAdmin('/admin');
    await signIn();
    // Named by the label a founder reads, in the order the report lists them.
    // 🔵 'Newsletter' → 'Notes' AT THE-335, which put the newsletter behind a
    // master switch: the tab is in no tier's nav, so it cannot be clicked and a
    // walk through it would be measuring the switch rather than the pageview.
    // 'Notes' is the nearest ungated substitute — a real tab on this tier, one
    // route of its own — so the walk is still seven distinct sections.
    for (const label of ['CRM', 'Campus', 'Courses', 'Notes', 'Accounting', 'Forms', 'Livestream']) {
      await clickTab(label);
    }
    // One for the load, then one per tab change. None of them silent.
    expect(pageviews().length).toBe(8);
    // 🔴 THE-227, and the whole point of it: seven tab changes are seven
    // DISTINCT routes now, not seven copies of one bucket. This assertion was
    // `Array(7).fill('/admin/[section]')` — a sequence that is identical whether
    // the founder walked CRM or walked Accounting seven times.
    expect(routes().slice(1)).toEqual([
      '/admin/crm',
      '/admin/churches',
      '/admin/courses',
      '/admin/docs',
      '/admin/accounting',
      '/admin/forms',
      '/admin/livestream',
    ]);
  });

  it('and the tab really did change — the URL is what stores it', async () => {
    // The mechanism, stated as an assertion rather than as prose: `activeTab`
    // is derived from the route param, so a tab that changed IS a URL that
    // changed. This is why explanation (B) cannot hold for the admin.
    await mountAdmin('/admin');
    await signIn();
    await clickTab('SMS');
    expect(container.textContent, 'the SMS screen did not become the active tab').toContain('SMS');
    expect(routes().at(-1)).toBe('/admin/sms');
  });
});

// ── 11 ───────────────────────────────────────────────────────────────────────
describe('11 — the pageview carries a route pattern, never a resolved id', () => {
  it('the pageview carries a route pattern, never a resolved id', async () => {
    await mountAdmin('/admin');
    await signIn();
    await clickTab('Community');
    // ⚠️ THE-227 — the section name is sent, because `community` is a feature
    // name from the app's own nav and routes.ts now has a row for it. It is
    // still MATCHED, not passed through: an unregistered section collapses, and
    // `9 — an unknown section` below is where that is asserted.
    expect(routes().at(-1)).toBe('/admin/community');

    // 🔴 An itemId is a Firestore document id. Reached the way the product
    // reaches it: an attachment link inside the Community screen.
    await act(async () => { (container.querySelector('#open-doc') as HTMLButtonElement).click(); });
    await flush();
    expect(routes().at(-1)).toBe('/admin/[section]/[itemId]');
    for (const route of routes()) {
      expect(route, 'a document id left the browser').not.toContain('aB3xQ9zK7mN2pL5r');
    }
  });

  it('sends only registered property keys, through the allowlist and not around it', async () => {
    await mountAdmin('/admin');
    await signIn();
    await clickTab('CRM');

    const last = pageviews().at(-1)!;
    expect(Object.keys(last.properties).sort()).toEqual(['app_surface', 'is_platform_admin', 'route']);
    for (const key of Object.keys(last.properties)) {
      expect(ALLOWED_EVENT_PROPERTY_KEYS, `"${key}" is not in the closed vocabulary`).toContain(key);
    }
    expect(last.properties.app_surface).toBe('admin');
    // ⚠️ A tab pageview needed NO new property. `route` was already registered
    // by THE-206; nothing was added to the allowlist by this ticket.
    expect(ALLOWED_EVENT_PROPERTY_KEYS).toEqual(['app_surface', 'is_platform_admin', 'route']);
  });

  it('survives `before_send` unchanged — the choke point does not strip it', () => {
    // The mocked SDK does not run `before_send`, so it is run here by hand over
    // a real tab pageview: an event that the bridge builds correctly and the
    // choke point then drops would look identical on a dashboard to one never sent.
    const sent = beforeSendEvent({
      event: '$pageview',
      properties: { route: '/admin/[section]', app_surface: 'admin', is_platform_admin: false },
    } as never);
    expect(sent, 'before_send dropped a tab pageview').not.toBeNull();
    expect(sent!.properties!.route).toBe('/admin/[section]');
  });
});

// ── 12 ───────────────────────────────────────────────────────────────────────
describe('12 — one tab change emits exactly one pageview', () => {
  it('one tab change emits exactly one pageview', async () => {
    await mountAdmin('/admin');
    await signIn();
    const before = pageviews().length;
    await clickTab('CRM');
    expect(pageviews().length - before, 'one tab change was counted more than once').toBe(1);
  });

  it('a repeated auth callback for the SAME user does not re-count the screen', async () => {
    // 🔴 THE DEFECT IN THE PRODUCTION DATA. Firebase re-fires its listener on
    // every ID-token refresh; before this PR each one filed another $pageview
    // for whatever screen was open. Two `/admin` events five seconds apart in
    // one live session are this.
    await mountAdmin('/admin');
    await signIn();
    expect(pageviews().length).toBe(1);

    await signIn(); // token refresh: same uid, same email, new callback
    await signIn();
    expect(pageviews().length, 'a token refresh counted as a page view').toBe(1);
  });

  it('a token refresh mid-identify does not re-identify the same person', async () => {
    // 🔴 THE OTHER HALF OF THE FIX, and the half a dedupe alone cannot cover.
    // Resolving the tenant group reads Firestore, and `identify()` sends a $set;
    // doing both twice for one sign-in is a second Firestore read and a second
    // person write on every token refresh that lands in that window.
    //
    // Storing the user as a fresh object literal made every callback a new
    // effect dependency, so the in-flight run was CANCELLED before it could
    // record who it had identified — and the run that replaced it started the
    // whole identify again. Returning `prev` unchanged is what stops the effect
    // re-running at all.
    identityGate.hold();
    await mountAdmin('/admin');
    await act(async () => { authState.callback?.({ uid: UID, email: 'admin@grace.test' }); });
    await flush();
    // A token refresh arrives while the first identify is still resolving.
    await act(async () => { authState.callback?.({ uid: UID, email: 'admin@grace.test' }); });
    await flush();
    await act(async () => { identityGate.release?.(); });
    await flush();

    expect(identityGate.calls, 'the same person was identified twice').toBe(1);
    expect(posthogMock.identified.map((i) => i.distinctId)).toEqual([UID]);
    // And the pageview still landed — the fix must not turn a double into a zero.
    expect(routes()).toEqual(['/admin']);
  });

  it('a re-render with no navigation emits nothing', async () => {
    await mountAdmin('/admin');
    await signIn();
    await clickTab('CRM');
    const after = pageviews().length;

    // A state change inside the shell: open and close the desktop nav group.
    // THE-332 — the group heading is now a rail entry whose name is its
    // `aria-label`, so it is found by the attribute the rail marks it with
    // rather than by text content it no longer renders.
    const group = container.querySelector<HTMLButtonElement>('[data-nav-rail-group="MINISTRY"]');
    await act(async () => { (group as HTMLButtonElement).click(); });
    await flush();
    await act(async () => { (group as HTMLButtonElement).click(); });
    await flush();
    expect(pageviews().length, 'a re-render counted as a page view').toBe(after);
  });

  it('re-selecting the tab already open emits nothing', async () => {
    await mountAdmin('/admin');
    await signIn();
    await clickTab('CRM');
    const after = pageviews().length;
    await clickTab('CRM');
    expect(pageviews().length, 'clicking the open tab counted again').toBe(after);
  });

  it('but going back to a screen after leaving it DOES count', async () => {
    // ⚠️ The dedupe must not become an under-count: a screen genuinely revisited
    // is a genuine view. Only the LAST (uid, path) pair is held, so A → B → A
    // is three.
    await mountAdmin('/admin');
    await signIn();
    await clickTab('CRM');
    await clickTab('Dashboard');
    await clickTab('CRM');
    expect(routes()).toEqual(['/admin', '/admin/crm', '/admin', '/admin/crm']);
  });
});

// ── 13 ───────────────────────────────────────────────────────────────────────
describe('13 — the declared admin route patterns are actually reachable', () => {
  it('the declared admin route patterns are actually reachable', async () => {
    // 🔴 The question the ticket asks: are `/admin/[section]` and
    // `/admin/[section]/[itemId]` aspirational, or real? Both are produced here
    // by real in-product navigation, so neither is renamed and neither is
    // removed. Read OFF the registry rather than restated, so a pattern that is
    // added there without a way to reach it fails this test.
    const declared = ANALYTICS_ROUTES
      .filter((r) => r.surface === 'admin')
      .map((r) => r.pattern);
    // ⚠️ THE-227 adds a row per named section. The three patterns below are the
    // ones this test was written about and they all still exist — the parameter
    // pair is not renamed, not removed, and still what an unregistered section
    // and an itemId resolve to.
    expect(declared).toContain('/admin');
    expect(declared).toContain('/admin/[section]');
    expect(declared).toContain('/admin/[section]/[itemId]');
    // The rest are the sections, and nothing else crept in.
    expect(declared.filter((p) => p.includes('[')).sort())
      .toEqual(['/admin/[section]', '/admin/[section]/[itemId]']);

    await mountAdmin('/admin');
    await signIn();
    await clickTab('Community');
    await act(async () => { (container.querySelector('#open-doc') as HTMLButtonElement).click(); });
    await flush();

    // 🔴 Reachability, for the three this test is about. A per-section row is a
    // row for a nav entry the drift test in `admin-sections.test.ts` already
    // holds against `AdminDashboard`, and walking twenty-four screens here would
    // be asserting that suite's job a second time, more slowly.
    for (const pattern of ['/admin', '/admin/community', '/admin/[section]/[itemId]']) {
      expect(routes(), `"${pattern}" is declared but was never reached`).toContain(pattern);
    }
    // And the parameter row is genuinely still reachable — by a section that is
    // not in the vocabulary, which is the only thing left that can produce it.
    expect(normalizeAnalyticsPath('/admin/prayer-wall')).toBe('/admin/[section]');
  });

  it('a deep link opened cold reports the itemId pattern, not the id', async () => {
    await mountAdmin('/admin/docs/9f2c4471aa0e4d8fb1');
    await signIn();
    expect(routes()).toEqual(['/admin/[section]/[itemId]']);
  });
});

// ── 4 (reported, not fixed) ──────────────────────────────────────────────────
describe('4 — the member app is state-driven, so it has the same symptom by a different mechanism', () => {
  const MAIN_APP = readFileSync(join(ROOT, 'src/components/MainApp.tsx'), 'utf8');

  it('holds its tabs in component state and never navigates', () => {
    // ⚠️ THE FINDING, PINNED. This is why the member app's silence is NOT the
    // admin's bug: there is no history entry for a pathname-keyed hook to see.
    expect(MAIN_APP).toMatch(/const \[activeBottomTab, setActiveBottomTab\] = useState\(/);
    expect(MAIN_APP).toMatch(/const \[activeTopTab, setActiveTopTab\] = useState\(/);
    expect(MAIN_APP, 'MainApp gained a router navigation — re-open the member half of THE-220')
      .not.toMatch(/navigate\(['"`]\//);
  });

  it('and the registry declares no member-tab route to carry one', () => {
    // Nothing was renamed or invented for the member app in this PR: its only
    // declared route is the SPA root, which is what its events already carry.
    const member = ANALYTICS_ROUTES.filter((r) => r.surface === 'member').map((r) => r.pattern);
    expect(member).toEqual(['/']);
  });
});

// ── 14 ───────────────────────────────────────────────────────────────────────
describe('14 — nothing is emitted when the analytics key is absent', () => {
  it('nothing is emitted when the analytics key is absent', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    __resetAnalyticsForTests();

    await mountAdmin('/admin');
    await signIn();
    await clickTab('CRM');
    await clickTab('Blog');

    // Not "initialised and told to stay quiet" — never initialised. This is the
    // state the app ships in until the founder sets a key.
    expect(posthogMock.inits, 'the SDK was initialised without a key').toEqual([]);
    expect(posthogMock.captures, 'an event left the browser without a key').toEqual([]);
  });

  it('and nothing throws — the admin still navigates', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    __resetAnalyticsForTests();
    await mountAdmin('/admin');
    await signIn();
    await clickTab('SMS');
    expect(container.textContent).toContain('SMS');
  });
});

// ── 15 ───────────────────────────────────────────────────────────────────────
describe('15 — session recording, autocapture and the closed vocabulary are all unchanged', () => {
  const options = buildPostHogOptions();

  it('session recording is off behind both locks', () => {
    // 🔴 Donor names, giving amounts, prayer requests and private messages. Two
    // deliberate edits would be needed to start a recorder, not one.
    expect(options.disable_session_recording, 'replay was enabled to gain coverage').toBe(true);
    expect(options.disable_external_dependency_loading, 'recorder.js became fetchable').toBe(true);
    expect(options.session_recording).toMatchObject({
      maskAllInputs: true, maskTextSelector: '*', maskAllElementAttributes: true,
    });
  });

  it('autocapture and every DOM-reading relative are off', () => {
    expect(options.autocapture).toBe(false);
    expect(options.capture_heatmaps).toBe(false);
    expect(options.capture_dead_clicks).toBe(false);
    expect(options.rageclick).toBe(false);
    expect(options.capture_exceptions).toBe(false);
    // `$copy_autocapture` has no option of its own — `autocapture: false` gates
    // it, and `before_send` refuses the name outright. Both, asserted.
    expect(beforeSendEvent({ event: '$copy_autocapture', properties: {} } as never)).toBeNull();
    expect(beforeSendEvent({ event: '$autocapture', properties: {} } as never)).toBeNull();
    expect(beforeSendEvent({ event: '$rageclick', properties: {} } as never)).toBeNull();
  });

  it('the event vocabulary is still closed, and is still three property keys wide', () => {
    expect(Object.values(ANALYTICS_EVENTS)).toEqual(['$pageview']);
    expect(ALLOWED_EVENT_PROPERTY_KEYS).toEqual(['app_surface', 'is_platform_admin', 'route']);
    expect(beforeSendEvent({ event: 'admin_tab_opened', properties: {} } as never), 'an unregistered event now leaves').toBeNull();
  });

  it('a resolved path is still never a property, and the exception list is still empty', () => {
    // The whole point of the enumeration: matching is by list, never by shape.
    const noPatternRoutes = ANALYTICS_ROUTES.filter((r) => !r.pattern.startsWith('/'));
    expect(noPatternRoutes).toEqual([]);
    // `$current_url` is the SDK's own, and is normalised too.
    const scrubbed = beforeSendEvent({
      event: '$pageview',
      properties: { $current_url: 'https://grace.theharvest.app/admin/docs/9f2c4471?token=abc' },
    } as never);
    expect(scrubbed!.properties!.$current_url).toBe('https://grace.theharvest.app/admin/[section]/[itemId]');
  });

  it('identity is the Firebase uid, never the email', async () => {
    await mountAdmin('/admin');
    await signIn('uid-abc', 'pastor@grace.org');
    await clickTab('CRM');

    // 🔴 The distinct_id is the uid. An email as an identifier would put a
    // church's staff list into a third party by way of the id column itself.
    expect(posthogMock.identified.map((i) => i.distinctId)).toEqual(['uid-abc']);
    expect(JSON.stringify(posthogMock.identified), 'an email reached PostHog').not.toContain('pastor@grace.org');
    expect(JSON.stringify(posthogMock.captures), 'an email reached an event').not.toContain('pastor@grace.org');
    // The church is a GROUP, not a person property.
    expect(posthogMock.groups).toEqual([TENANT_ID]);
    expect(Object.keys(posthogMock.identified[0].properties)).toEqual(['account_kind']);
  });

  it('a platform admin is never attributed to the tenant they are viewing', async () => {
    // `is_platform_admin` is stamped on the event so staff traffic can be
    // excluded, rather than being inferred from a group that would file it
    // under the church.
    await mountAdmin('/admin');
    await signIn();
    await clickTab('CRM');
    for (const view of pageviews()) {
      expect(view.properties).toHaveProperty('is_platform_admin');
    }
  });
});

// ── 16 ───────────────────────────────────────────────────────────────────────
describe('16 — layout.tsx is unchanged', () => {
  const LAYOUT = 'src/app/layout.tsx';

  it('layout.tsx is unchanged — byte-for-byte', () => {
    // ⚠️ NOT A SECOND PIN. The canonical digest lives in
    // `src/lib/analytics/__tests__/posthog-untouched.test.ts` (THE-36) and is
    // READ from there rather than restated, so there is exactly one recorded
    // value and the two cannot drift apart. And no `git show` at assertion
    // time: CI's clone depth is not something this suite may depend on.
    const guard = readFileSync(join(ROOT, 'src/lib/analytics/__tests__/posthog-untouched.test.ts'), 'utf8');
    const pinned = guard.match(/const LAYOUT_SHA = '([0-9a-f]{64})';/)?.[1];
    expect(pinned, 'the canonical layout pin could not be read').toMatch(/^[0-9a-f]{64}$/);

    const actual = createHash('sha256').update(readFileSync(join(ROOT, LAYOUT))).digest('hex');
    expect(actual, 'layout.tsx changed — analytics must not be initialised from the root layout').toBe(pinned);
  });

  it('and gained nothing analytics-shaped', () => {
    const layout = readFileSync(join(ROOT, LAYOUT), 'utf8');
    expect(layout).not.toMatch(/posthog/i);
    expect(layout).not.toMatch(/AnalyticsBridge/);
    expect(layout).not.toMatch(/capturePageview/);
  });
});
