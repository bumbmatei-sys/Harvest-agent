import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';
import { getPlanFeatures, hasBrandingAccess, PLAN_ORDER } from '../../utils/plan-features';
import type { TenantPlan } from '../../types/tenant.types';

/**
 * THE-216 — a tenant must not REACH a feature its tier did not buy.
 *
 * ─── What the ticket reported, and what was actually there ───────────────────
 *
 * The report: an Individual tenant shows sixteen admin nav items, nine of them
 * gated behind higher tiers, caused by `!isTenantAdmin` short-circuiting the
 * feature check on nine nav gates.
 *
 * Two halves of that are not what the code does, and this file pins the
 * difference so neither reading can drift again:
 *
 *  1. THE SIXTEEN NAV ITEMS ARE DELIBERATE, and are not what `!isTenantAdmin`
 *     controls. THE-202 (49b2a0c) moved the plan clause OFF the nav array and
 *     onto the render switch on purpose — founder's words, quoted in that
 *     commit: "the admin of this free plan can see all the features and can
 *     navigate through them but he cannot use any of them." So every tier shows
 *     the same permission-filtered nav, and a tier that lacks a feature reaches
 *     PlanUpgradeScreen instead of the tab being absent. `navLabels` below pins
 *     that, per tier, so a silent revert is a failing test rather than a
 *     surprise.
 *
 *  2. `isTenantAdmin` IS NOT FALSE FOR AN UPGRADED TENANT. It is `!!resolvedPlan`
 *     and 'plus' is truthy, so the nine gates evaluated their feature cell
 *     correctly the whole time. What the term DID do was fail open whenever the
 *     plan did not resolve at all — see 'an unresolved plan is refused, not
 *     unlocked' below, which is the real defect and the one the fix closes.
 *
 * ─── What is therefore asserted ──────────────────────────────────────────────
 *
 * ENTITLEMENT, not nav presence: for every tier, opening each tab and checking
 * whether it mounts its screen or PlanUpgradeScreen. That is the question the
 * ticket's headline actually asks ("a paying tier shows features it did not
 * buy"), and it is the one a nav-item count cannot answer.
 *
 * Targets are named BY LABEL ('AI Knowledge', 'Newsletter'), never by matching a
 * value pattern, so a renamed feature cell cannot quietly empty an assertion.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT_ID = 'grace';
const UID = 'user-1';

const navigate = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: {} as { section?: string; itemId?: string } }));
const checkRosterAdminStatus = vi.hoisted(() => vi.fn());
const isSuperAdminMock = vi.hoisted(() => vi.fn(() => false));
const hasPlatformOverrideMock = vi.hoisted(() => vi.fn(() => false));
const store = vi.hoisted(() => ({
  current: { tenantPlan: null as string | null, currentTenantId: 'grace' as string | null, isAuthReady: true },
}));
const ctx = vi.hoisted(() => ({
  current: { branding: null as unknown, isLoading: false, tenantPlan: undefined as string | undefined },
}));
const currentUser = vi.hoisted(() => ({ current: { uid: 'user-1' } as { uid: string } | null }));
const userQuery = vi.hoisted(() => ({ current: { data: undefined as unknown, isLoading: false } }));

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
// 🔴 THE-335 — the newsletter switch is mocked ON here on EXACTLY the terms the
// SMS switch above already is, and for the same reason. This file is about the
// PLAN gate: which tier is entitled to which screen. A master switch in front of
// that gate would blank the row and turn every assertion about it vacuous. That
// the tab is GONE while the switch is off is asserted in THE-335's own suite.
vi.mock('../../lib/newsletter-feature', () => ({
  NEWSLETTER_FEATURE_ENABLED: true,
  NEWSLETTER_HIDDEN_MESSAGE: 'Newsletter is temporarily unavailable.',
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
vi.mock('../../hooks/queries/useTenantQueries', () => ({
  useTenant: () => ({ data: { name: 'Grace Ministry', ownerId: 'someone-else' }, isLoading: false }),
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => ctx.current }));
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
  OperationType: { GET: 'get' }, handleFirestoreError: () => {},
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

/**
 * Each admin screen renders a marker naming ITSELF, and PlanUpgradeScreen
 * renders one naming the feature it is refusing. So "did this tab mount its
 * feature, or the upgrade wall?" is answered by which marker is in the DOM —
 * the entitlement question, read directly, with no value pattern involved.
 */
const screenStub = vi.hoisted(() => (name: string) => async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', { 'data-screen': name }) };
});
vi.mock('../AdminBlog', screenStub('AdminBlog'));
vi.mock('../AdminCourses', screenStub('AdminCourses'));
vi.mock('../AdminRAG', screenStub('AdminRAG'));
vi.mock('../NewsletterCampaigns', screenStub('NewsletterCampaigns'));
vi.mock('../AdminFundraising', screenStub('AdminFundraising'));
vi.mock('../AdminDocs', screenStub('AdminDocs'));
vi.mock('../AdminEvents', screenStub('AdminEvents'));
vi.mock('../AdminServices', screenStub('AdminServices'));
vi.mock('../AdminCRM', screenStub('AdminCRM'));
vi.mock('../AdminAccounting', screenStub('AdminAccounting'));
vi.mock('../AdminForms', screenStub('AdminForms'));
vi.mock('../AdminCheckin', screenStub('AdminCheckin'));
vi.mock('../AdminLivestream', screenStub('AdminLivestream'));
vi.mock('../AdminSms', screenStub('AdminSms'));
vi.mock('../AdminCommunity', screenStub('AdminCommunity'));
vi.mock('../AdminChurches', screenStub('AdminChurches'));
vi.mock('../AdminBranding', screenStub('AdminBranding'));
vi.mock('../AdminDashboardHome', screenStub('AdminDashboardHome'));
vi.mock('../PlanUpgradeScreen', async () => {
  const React = await import('react');
  return {
    default: ({ featureName }: { featureName: string }) =>
      React.createElement('div', { 'data-upgrade-wall': featureName }),
  };
});

const stub = vi.hoisted(() => () => ({ default: () => null }));
vi.mock('../PlatformInbox', stub);
vi.mock('../AdminTenants', stub);
vi.mock('../AdminLibraryCourses', stub);
vi.mock('../AdminSettings', stub);
vi.mock('../AdminUpgradePage', stub);
vi.mock('../AffiliateSection', stub);
vi.mock('../NewsletterEditor', stub);
vi.mock('../CanvasList', stub);
vi.mock('../CanvasEditor', stub);
vi.mock('../AdminNavCustomizer', stub);
vi.mock('../FocusScreen', stub);
vi.mock('../Profile', stub);
vi.mock('../MyAccountMenu', stub);
vi.mock('../BillingAndPayments', stub);
vi.mock('../GraceWindowBanner', stub);

// ─── The tab table ───────────────────────────────────────────────────────────
//
// One row per plan-gated admin tab: the LABEL it carries in the nav, the URL
// section that opens it, the screen it mounts when entitled, and — derived from
// the feature matrix rather than hand-listed — whether a tier is entitled to it.
// Deriving `entitled` is what lets every tier below be asserted from one table
// without four hand-maintained lists that could each drift on their own.
type Row = {
  label: string;
  section: string;
  screen: string;
  entitled: (f: ReturnType<typeof getPlanFeatures>) => boolean;
};
const GATED_TABS: Row[] = [
  { label: 'Blog', section: 'blog', screen: 'AdminBlog', entitled: (f) => f.blog },
  { label: 'Courses', section: 'courses', screen: 'AdminCourses', entitled: (f) => f.maxCourses !== 0 },
  // The Products page: the same screen in `productsPage` mode, on the same cell as Courses.
  { label: 'Products', section: 'products', screen: 'AdminCourses', entitled: (f) => f.maxCourses !== 0 },
  { label: 'AI Knowledge', section: 'ai-knowledge', screen: 'AdminRAG', entitled: (f) => f.aiKnowledge },
  { label: 'Newsletter', section: 'newsletter', screen: 'NewsletterCampaigns', entitled: (f) => f.newsletterAutomation },
  { label: 'Fundraising', section: 'fundraising', screen: 'AdminFundraising', entitled: (f) => f.fundraising },
  { label: 'Notes', section: 'docs', screen: 'AdminDocs', entitled: (f) => f.docs },
  { label: 'Events', section: 'events', screen: 'AdminEvents', entitled: (f) => f.eventRegistration },
  // THE-326 — service planning, split out of Events into its own section. It
  // takes the SAME plan cell, `eventRegistration`, for the same reason Signups
  // takes `crm`: the run sheet, the rota and the invitations were reachable
  // through the Events screen and through nothing else, so that cell is already
  // the only expression of who gets this feature. Repeating it means the split
  // changes WHERE the work is done and not WHO may do it.
  { label: 'Services', section: 'services', screen: 'AdminServices', entitled: (f) => f.eventRegistration },
  { label: 'CRM', section: 'crm', screen: 'AdminCRM', entitled: (f) => f.crm },
  // THE-277 — Signups was the CRM screen's Analytics sub-tab and is now its
  // own page. It takes the SAME plan cell, `crm`: there is no `analytics`
  // cell in the matrix (plan-features.ts says so in as many words), so `crm`
  // is the only expression of who gets this screen, exactly as it was while
  // the screen was a sub-tab of that one.
  // 🔴 THE-335 — `signups`, not `crm`. The founder split what free gets ("The
  // free plan should have signup feature not CRM since we separated them"), and
  // a shared cell cannot express that: crm:false on free took this screen — and
  // the analytics that lives on it — away in the same edit. Still no `analytics`
  // cell; "free gets analytics" is now `signups: true` and nothing else.
  { label: 'Signups', section: 'signups', screen: 'AdminSignups', entitled: (f) => f.signups },
  { label: 'Giving records', section: 'accounting', screen: 'AdminAccounting', entitled: (f) => f.accountingTools || f.givingStatements },
  { label: 'Forms', section: 'forms', screen: 'AdminForms', entitled: (f) => f.customForms },
  { label: 'Livestream', section: 'livestream', screen: 'AdminLivestream', entitled: (f) => f.livestream },
  { label: 'SMS', section: 'sms', screen: 'AdminSms', entitled: (f) => f.smsAutomation },
  { label: 'Community', section: 'community', screen: 'AdminCommunity', entitled: (f) => f.communityGroups },
];

/**
 * Tabs that mount unconditionally, and why each one is not a hole.
 *
 * ⚠️ CHECK-IN IS HERE, AND THE-373 NARROWED WHO REACHES IT.
 * The tab hosts two products: QR Codes, which free still has, and attendance,
 * which `checkInSystem` gates inside the screen. Individual used to reach the
 * tab for the QR half. That tab was the whole Reach group on that plan, and
 * the founder asked for the group to be gone — so Individual no longer mounts
 * this screen. Free, Small Team and Ministry still do. `entitled` stays true
 * because those three still open it; Individual is asserted by name below,
 * not by this predicate.
 */
const UNGATED_TABS: Row[] = [
  { label: 'Dashboard', section: '', screen: 'AdminHome', entitled: () => true },
  { label: 'Campus', section: 'churches', screen: 'AdminChurches', entitled: () => true },
  { label: 'Check-In', section: 'checkin', screen: 'AdminCheckin', entitled: () => true },
];

/**
 * The surfaces a Church tenant may actually use. The spec lists them: courses and
 * products, the feed and chat (Community), donations and fundraising campaigns,
 * the CRM and signups, campuses, the blog and notes.
 *
 * ⚠️ A STORED RETIRED `plus` OR `pro` IS READ AS CHURCH, so this is also what
 * those tenants reach now. Pro lost Check-In, Livestream and the newsletter in
 * that move; the spec is explicit that Church has none of them.
 */
const CHURCH_ENTITLED = [
  'Dashboard', 'Blog', 'Campus', 'Courses', 'Products', 'CRM', 'Signups', 'Fundraising', 'Notes', 'Community',
];

/**
 * What a Church tenant can open. Check-In is not here: Reach is hidden on this
 * plan (THE-373), and the tab answers "page not found".
 */
const CHURCH_REACHABLE = [...CHURCH_ENTITLED];

let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

const ALL_TAB_LABELS = [
  'Dashboard', 'Campus', 'Campuses', 'Courses', 'Products', 'Blog', 'AI Knowledge', 'Newsletter',
  'Fundraising', 'Donations', 'Events', 'Services', 'Notes', 'CRM', 'Signups', 'Giving records', 'Forms', 'Check-In', 'Livestream',
  'SMS', 'Community', 'Library', 'Tenants', 'Affiliate', 'Branding', 'Settings',
];
function navLabels(): string[] {
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
  /* Courses has no sidebar row of its own: it is opened from the Products page, on the same plan
     cell, so a tier that reaches Products reaches Courses and the two are reported together. */
  if (found.has('Products')) found.add('Courses');
  return [...found].sort();
}

/** Which marker the active tab mounted: its own screen, or the upgrade wall. */
function activeScreen(): { screen: string | null; wall: string | null } {
  const screen = container.querySelector('[data-screen]');
  const wall = container.querySelector('[data-upgrade-wall]');
  return {
    screen: screen?.getAttribute('data-screen') ?? null,
    wall: wall?.getAttribute('data-upgrade-wall') ?? null,
  };
}

type Who = { role?: string; permissions?: Record<string, boolean> };

async function mount(who: Who, section: string) {
  params.current = section ? { section } : {};
  userQuery.current = {
    data: {
      role: who.role ?? 'church_admin',
      permissions: who.permissions ?? {},
      displayName: 'B',
      email: 'admin@grace.test',
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

async function unmount() {
  if (!mounted) return;
  mounted = false;
  await act(async () => { root.unmount(); });
}

/** Open one tab on one plan and report what it mounted. */
async function openTab(plan: TenantPlan | null, row: Row, who: Who = {}) {
  store.current = { ...store.current, tenantPlan: plan };
  ctx.current = { ...ctx.current, tenantPlan: plan ?? undefined };
  await mount(who, row.section);
  const result = { ...activeScreen(), nav: navLabels() };
  await unmount();
  return result;
}

/** Every tab a tier may actually USE, by label. */
async function entitledLabels(plan: TenantPlan, who: Who = {}) {
  const reached: string[] = [];
  for (const row of [...UNGATED_TABS, ...GATED_TABS]) {
    const { screen } = await openTab(plan, row, who);
    if (screen === row.screen) reached.push(row.label);
  }
  return reached.sort();
}

beforeEach(() => {
  vi.clearAllMocks();
  store.current = { tenantPlan: null, currentTenantId: TENANT_ID, isAuthReady: true };
  ctx.current = { branding: null, isLoading: false, tenantPlan: undefined };
  currentUser.current = { uid: UID };
  isSuperAdminMock.mockReturnValue(false);
  hasPlatformOverrideMock.mockReturnValue(false);
  checkRosterAdminStatus.mockResolvedValue('not-admin');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmount();
  container.remove();
});

// ── 1. The regression ────────────────────────────────────────────────────────
describe("a Church tenant's admin nav is exactly the ten correct items", () => {
  it('reaches exactly the ten entitled surfaces, and an upgrade wall on every other', async () => {
    expect(await entitledLabels('church')).toEqual([...CHURCH_REACHABLE].sort());
    // Said again by name, so a deviation cannot hide inside a derived list.
    for (const label of CHURCH_ENTITLED) {
      expect(await entitledLabels('church'), `"${label}" is one of the ten`).toContain(label);
    }
  }, 20_000);

  it('reads the retired plus and pro ids as Church, and max as Ministry', async () => {
    expect(await entitledLabels('plus' as TenantPlan)).toEqual([...CHURCH_REACHABLE].sort());
    expect(await entitledLabels('pro' as TenantPlan)).toEqual([...CHURCH_REACHABLE].sort());
    expect(await entitledLabels('max' as TenantPlan)).toEqual(await entitledLabels('ministry'));
  }, 40_000);

  it('shows the upgrade wall — naming the feature — on each of the eight it did not buy', async () => {
    const walled: string[] = [];
    for (const row of GATED_TABS) {
      const { screen, wall } = await openTab('church', row);
      if (wall !== null) {
        walled.push(row.label);
        expect(screen, `${row.label} mounted its screen behind an upgrade wall`).toBeNull();
      }
    }
    // Check-In is not in this list: it is not walled, it is absent. THE-373.
    // 🔴 'SMS' JOINED THIS LIST — THE-314. Individual used to reach the SMS
    // screen; it now meets the upgrade wall there, naming Ministry.
    // 🔴 'Services' JOINED IT — THE-326, and it is the SAME wall 'Events'
    // already had. Service planning was split out of the Events screen onto the
    // same `eventRegistration` cell, so a tier that met the wall on Events now
    // meets it on Services too. ⚠️ Nothing Individual could reach before became
    // unreachable: the run sheet was behind Events, which was already walled.
    expect(walled.sort()).toEqual(
      ['AI Knowledge', 'Giving records', 'Events', 'Forms', 'Livestream', 'Newsletter', 'SMS', 'Services'].sort(),
    );
  });

  it('does not mount Check-In for Church — Reach is hidden on that plan', async () => {
    const { screen, nav } = await openTab('church', UNGATED_TABS[2]);
    expect(screen, 'Church still opens Check-In').toBeNull();
    expect(nav, 'Church still lists Check-In').not.toContain('Check-In');
    expect(getPlanFeatures('church').checkInSystem, 'attendance was already off').toBe(false);
    expect(getPlanFeatures('church').customForms, 'Forms was not added').toBe(false);
  });

  it('does not put Branding in a Church nav', async () => {
    const { nav } = await openTab('church', UNGATED_TABS[0]);
    expect(hasBrandingAccess(getPlanFeatures('church'))).toBe(false);
    expect(nav).not.toContain('Branding');
  });
});

// ── 2–4. Every other tier ────────────────────────────────────────────────────
describe.each([
  ['a free tenant', 'free' as const],
  ['a Ministry tenant', 'ministry' as const],
])("%s's nav is correct", (_name, plan) => {
  it('reaches exactly the surfaces its tier carries, and no others', async () => {
    const features = getPlanFeatures(plan);
    const expected = [...UNGATED_TABS, ...GATED_TABS]
      .filter((r) => r.entitled(features))
      .map((r) => r.label)
      .sort();
    expect(await entitledLabels(plan)).toEqual(expected);
  });

  it('offers no Branding sidebar entry on any tier', async () => {
    const { nav } = await openTab(plan, UNGATED_TABS[0]);
    expect(nav, 'Branding is a Settings pane now, not a sidebar entry').not.toContain('Branding');
  });
});

// ── The nav itself: THE-202's decision, as THE-220 corrected its SCOPE ───────
//
// 🔴 THIS BLOCK USED TO ASSERT THE OPPOSITE, and it was pinning a defect.
//
// THE-202 built the free tier's "see every feature, read-only" mode by deleting
// the plan clause from the nav array outright, which applied the mode to EVERY
// tier — so these two tests asserted that free, Individual and Small Team all
// showed one identical sixteen-item nav. That is the behaviour the founder then
// corrected: "Only the evangelist has to see the entire list of features.
// Individual doesn't have to see the features from Ministry."
//
// So the free half stays (it was right) and the paid half inverts. The tests
// below are the same two questions asked of the corrected rule.
describe('only the free tier shows every tab; a priced tier shows what it bought (THE-220)', () => {
  it('keeps the free nav whole, and it is the ONLY tier whose nav ignores its own cells', async () => {
    const navs = new Map<string, string[]>();
    for (const plan of ['free', 'church', 'ministry'] as const) {
      navs.set(plan, (await openTab(plan, UNGATED_TABS[0])).nav);
    }
    // The churches label can differ per tier: a tier capped at one campus says
    // 'Campus', an uncapped/unknown one 'Campuses'.
    const withoutChurch = (l: string[]) => l.filter((x) => x !== 'Campus' && x !== 'Campuses');

    // Free carries every gated tab, none of which its own cells unlock.
    for (const row of GATED_TABS) {
      expect(navs.get('free')!, `free lost "${row.label}" — the point of the tier`).toContain(row.label);
    }
    // And the priced tiers are now strictly narrower, which is the correction.
    expect(withoutChurch(navs.get('church')!).length)
      .toBeLessThan(withoutChurch(navs.get('free')!).length);
    // Ministry carries everything Church does, bar the one tab Reach hides.
    for (const label of withoutChurch(navs.get('church')!)) {
      expect(navs.get('ministry')!, `Ministry lost "${label}" that Church has`).toContain(label);
    }
  });

  it('drops from a Church nav every gated tab that tier did not buy', async () => {
    const { nav } = await openTab('church', UNGATED_TABS[0]);
    const churchFeatures = getPlanFeatures('church');
    for (const row of GATED_TABS) {
      if (row.entitled(churchFeatures)) {
        expect(nav, `"${row.label}" is one of Church's own tabs`).toContain(row.label);
      } else {
        expect(nav, `"${row.label}" is a tab Church cannot use and must not see`)
          .not.toContain(row.label);
      }
    }
  });
});

// ── 5. The actual scenario ───────────────────────────────────────────────────
describe('a tenant upgraded from free has the same nav as one that signed up paid', () => {
  it('resolves identical entitlements once the tenant doc carries the new plan', async () => {
    // The upgrade path writes `tenants/{id}.plan` in the webhook and the client
    // re-reads it on the return hop, so "upgraded" and "signed up paid" differ
    // only in which of the two plan sources answers first. Both are asserted.
    const signedUpPaid = await entitledLabels('church');

    // Upgraded: the store's copy has not caught up yet, so AdminDashboard falls
    // back to the context plan from the freshly-read tenant doc.
    const upgraded: string[] = [];
    for (const row of [...UNGATED_TABS, ...GATED_TABS]) {
      store.current = { ...store.current, tenantPlan: null };
      ctx.current = { ...ctx.current, tenantPlan: 'church' };
      await mount({}, row.section);
      if (activeScreen().screen === row.screen) upgraded.push(row.label);
      await unmount();
    }
    expect(upgraded.sort()).toEqual(signedUpPaid);
    expect(upgraded.sort()).toEqual([...CHURCH_REACHABLE].sort());
  });

  it('refuses a paid feature while a stale free plan is still what resolved', async () => {
    // The other side of the same coin: if the webhook has not landed when the
    // browser returns, the tenant doc still says 'free'. That must under-grant
    // (an upgrade wall the admin can dismiss by reloading), never over-grant.
    const { screen, wall } = await openTab('free', GATED_TABS.find((r) => r.label === 'Blog')!);
    expect(screen).toBeNull();
    expect(wall).toBe('Blog');
  });
});

// ── The real defect the bypass caused ────────────────────────────────────────
describe('an unresolved plan is refused, not unlocked', () => {
  it('walls every gated tab when the tenant doc yields no plan at all', async () => {
    // `!isTenantAdmin` — `!resolvedPlan` — used to be an OR term in front of
    // every one of these gates, so a tenant whose plan did not resolve was
    // handed all thirteen paid screens in full working order. A gate must not
    // open on its own failure.
    for (const row of GATED_TABS) {
      const { screen, wall } = await openTab(null, row);
      expect(screen, `${row.label} unlocked on an unresolved plan`).toBeNull();
      expect(wall, `${row.label} showed no upgrade wall on an unresolved plan`).not.toBeNull();
    }
  });
});

// ── 6. The super admin ───────────────────────────────────────────────────────
describe('a super admin still sees everything through platformOverride', () => {
  it('mounts every gated screen with no plan resolved at all', async () => {
    isSuperAdminMock.mockReturnValue(true);
    hasPlatformOverrideMock.mockReturnValue(true);
    for (const row of GATED_TABS) {
      const { screen, wall } = await openTab(null, row, { role: 'super_admin' });
      expect(screen, `platformOverride lost "${row.label}"`).toBe(row.screen);
      expect(wall).toBeNull();
    }
  });

  it('keeps Branding and the platform-only tabs', async () => {
    isSuperAdminMock.mockReturnValue(true);
    hasPlatformOverrideMock.mockReturnValue(true);
    const { nav } = await openTab(null, UNGATED_TABS[0], { role: 'super_admin' });
    expect(nav).toContain('Tenants');
    expect(nav, 'Branding is a Settings pane now, not a sidebar entry').not.toContain('Branding');
  });

  it('is still gated by the tenant plan on a tenant subdomain, where platformOverride is false', async () => {
    // Deliberate, and documented on `platformOverride` in AdminDashboard: a super
    // admin browsing a tenant keeps full ACCESS but their FEATURES are that
    // tenant's. Pinned so the narrowing cannot be "fixed" by widening it back.
    isSuperAdminMock.mockReturnValue(true);
    hasPlatformOverrideMock.mockReturnValue(false);
    const { screen, wall } = await openTab('church', GATED_TABS.find((r) => r.label === 'AI Knowledge')!, {
      role: 'super_admin',
    });
    expect(screen).toBeNull();
    expect(wall).toBe('AI Knowledge');
  });

  it('unlocks the platform tenant, which has no tenant plan to gate on', async () => {
    // The case `!isTenantAdmin` was FOR. `!isWhiteLabel` now states it directly:
    // no tenant in scope, or the platform tenant itself.
    store.current = { ...store.current, currentTenantId: null };
    const { screen } = await openTab(null, GATED_TABS.find((r) => r.label === 'Notes')!);
    expect(screen).toBe('AdminDocs');
  });

  it('unlocks the platform tenant on its own subdomain, where platformOverride is false', async () => {
    /**
     * ⚠️ A DELIBERATE BEHAVIOUR CHANGE, pinned so it is visible rather than
     * incidental.
     *
     * `harvest.theharvest.app` resolves as a tenant slug, so `platformOverride`
     * is false there. `scripts/seed-platform-tenant.js` USED TO WRITE that
     * tenant a plan id the matrix did not know, so `getPlanFeatures` fell through
     * to its default and the platform's own admin surface was silently gated to
     * the cheapest paid tier.
     *
     * `!isWhiteLabel` now answers this the way every other platform-tenant check
     * in the shell already does (`isPlanReady`, `showInbox`, the logo choice):
     * Harvest is not a customer, so there is no tier to hold it to. What this
     * asserts is that the platform tenant is unlocked REGARDLESS of what its plan
     * field happens to say, so it holds the tenant to a plan that WOULD wall the
     * screen (free has no Notes) and shows the screen mounts anyway.
     */
    store.current = { ...store.current, currentTenantId: 'harvest' };
    hasPlatformOverrideMock.mockReturnValue(false);
    const { screen } = await openTab('free', GATED_TABS.find((r) => r.label === 'Notes')!);
    expect(getPlanFeatures('free').docs, 'the plan on the platform tenant would wall Notes').toBe(false);
    expect(screen).toBe('AdminDocs');
  });
});

// ── 7. Role gates are orthogonal to plan ─────────────────────────────────────
describe("a limited admin's role gates still apply independently of plan", () => {
  it('withholds a tab the permission denies even on the tier that carries it', async () => {
    /* Ministry carries every cell, so anything missing here is the ROLE gate. */
    const { nav } = await openTab('ministry', UNGATED_TABS[0], {
      role: 'admin',
      permissions: { manageNewsletter: true },
    });
    expect(nav).toContain('Newsletter');
    for (const denied of ['AI Knowledge', 'Notes', 'Forms', 'Giving records', 'Livestream', 'Community']) {
      expect(nav, `"${denied}" appeared without its permission`).not.toContain(denied);
    }
  });

  it('keeps Settings on its role gate, not the plan (THE-193)', async () => {
    const withSettings = await openTab('free', UNGATED_TABS[0], {
      role: 'admin', permissions: { manageSettings: true },
    });
    const without = await openTab('ministry', UNGATED_TABS[0], {
      role: 'admin', permissions: { manageNewsletter: true },
    });
    expect(withSettings.nav, 'manageSettings on the cheapest tier still reaches Settings').toContain('Settings');
    expect(without.nav, 'no manageSettings on the top tier still has no Settings').not.toContain('Settings');
  });

  it('needs BOTH the plan cell and the permission for Donations (THE-246)', async () => {
    // 🔴 The permission half is `manageSettings`, NOT `manageFundraising`, and
    // that is deliberate: the payment links are written to `tenants/{id}.config`
    // and firestore.rules lets only manageBranding / manageSettings update that
    // document. Gating on the fundraising role would hand the editor to admins
    // whose Save can only ever be denied.
    const noPerm = await openTab('ministry', UNGATED_TABS[0], { role: 'admin', permissions: { manageFundraising: true } });
    const withPerm = await openTab('ministry', UNGATED_TABS[0], { role: 'admin', permissions: { manageSettings: true } });
    // 🔴 And free — which has `fundraising: false` and no donate page — gets no
    // entry even holding the permission. Not a walled tab: an absent one.
    const freeTier = await openTab('free', UNGATED_TABS[0], { role: 'admin', permissions: { manageSettings: true } });
    expect(noPerm.nav, 'the fundraising role alone opened the links editor').not.toContain('Donations');
    expect(withPerm.nav).toContain('Donations');
    expect(freeTier.nav, 'free was offered a Donations tab').not.toContain('Donations');
  });

  it('needs BOTH the plan cell and the permission for Branding', async () => {
    const noPerm = await openTab('ministry', UNGATED_TABS[0], { role: 'admin', permissions: {} });
    const withPerm = await openTab('ministry', UNGATED_TABS[0], { role: 'admin', permissions: { manageBranding: true } });
    const wrongTier = await openTab('church', UNGATED_TABS[0], { role: 'admin', permissions: { manageBranding: true } });
    expect(noPerm.nav).not.toContain('Branding');
    expect(withPerm.nav).toContain('Branding');
    expect(wrongTier.nav).not.toContain('Branding');
  });
});

// ── 8. Structural: no gate may skip its feature check ────────────────────────
describe('no nav item is shown by a bypass that skips its feature check', () => {
  const SOURCE = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');
  /**
   * The shell with its comments removed.
   *
   * 🔴 REQUIRED, not a convenience. The fix's own comment QUOTES the defect it
   * removed (`platformOverride || !isTenantAdmin || (features && features.X)`)
   * so the next reader knows what shape to refuse — and a raw-text search would
   * read that explanation as the defect and fail on the file that fixes it.
   * Worse, the obvious "fix" for that failure is deleting the explanation. So
   * the assertions below run over CODE, and the comments stay.
   */
  // Line comments FIRST, block comments second, and that order is load-bearing:
  // a `//` comment in this file mentions the path `/api/billing/*`, whose `/*`
  // a block-comment pass run first would read as an opening delimiter and
  // swallow the next 60 lines of real code — silently emptying the count below.
  // `(^|\s)` before `//` keeps `https://…` inside a string intact.
  const CODE = SOURCE
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('routes every plan gate through the single `planAllows` helper', () => {
    // A tenth item cannot be added the same way: the bypass exists in exactly
    // one place, so there is no per-site term left to get wrong.
    const gateCount = (CODE.match(/planAllows\(/g) ?? []).length;
    // The 13 gated tabs, plus canBranding, plus canDonations, plus ONE more:
    // THE-220's `navAllows` delegates to this helper rather than restating
    // `planUnlocked || cell === true`, so the nav layer and the render layer
    // cannot drift on what "the plan allows" means. That delegation is the whole
    // reason the count moved, and the next assertion pins its shape.
    //
    // ⚠️ `canDonations` (THE-246) is counted here rather than added to
    // GATED_TABS because it is Branding's shape, not theirs: ONE expression
    // feeding both the nav entry and the render guard, so an unentitled tier has
    // no tab at all instead of a walled one. See section 7 for what that buys —
    // free has no donate page by decision, and a wall in front of Stripe Connect
    // would be the surface THE-225 deleted from Settings.
    //
    // The AI Knowledge RENDER gate is the one call that does not spell
    // `planAllows`. It asks `isKnowledgeBaseEnabled`, which is that same
    // `planUnlocked || cell === true` predicate, so the blog screen (which
    // hides Automate on it) and the knowledge-base screen cannot drift. It
    // still counts: dropping it, or open-coding a second bypass in its place,
    // moves this total.
    const kbGate = (CODE.match(/isKnowledgeBaseEnabled\(/g) ?? []).length;
    expect(kbGate, 'the knowledge-base screen stopped sharing its one predicate').toBe(1);
    // APPENDED BY the 23 Oct UI polish: ONE more. A board's grid is a second screen of the Notes
    // tab, and it asks the Notes tab's own cell (`features?.docs`) through the same helper, so it is
    // refused to exactly the tiers the Notes editor is. Nothing about the helper itself moved.
    // Community setup applies six existing plan cells to its module availability.
    expect(gateCount + kbGate).toBe(GATED_TABS.length + 1 + 1 + 1 + 1 + 6 + 1 /* #557 sign-up pages */);
  });

  it('builds the NAV gate from the render gate plus exactly one term: the free tier', () => {
    // 🔴 The nav layer must be the render layer widened by free, and nothing
    // else. Any other cell in this expression is a second definition of "which
    // feature does this tab need", which is the drift THE-220 closed — the old
    // nav clause gated Courses on `blog` while the screen gated it on
    // `maxCourses`, and neither layer knew.
    expect(CODE).toMatch(
      /navAllows = \(cell: boolean \| null \| undefined\): boolean =>\s*resolvedPlan === FREE_PLAN \|\| planAllows\(cell\);/,
    );
    expect((CODE.match(/const navAllows =/g) ?? []).length).toBe(1);
    // The free bypass is NAMED, never spelled inline, so it is greppable.
    expect(CODE, "the free tier is compared as a bare string literal").not.toMatch(/resolvedPlan === 'free'/);
  });

  it('has no open-coded plan bypass left anywhere in the shell', () => {
    // The exact defect shape, and the near misses a refactor would reach for.
    expect(CODE, '`!isTenantAdmin` is back as a gate term').not.toMatch(/\|\|\s*!isTenantAdmin\s*\|\|/);
    expect(CODE, 'a gate reintroduced `platformOverride ||` beside a feature cell')
      .not.toMatch(/platformOverride\s*\|\|\s*\(?\s*features\s*&&/);
  });

  it('declares the bypass once, from platformOverride and the tenant scope', () => {
    expect(CODE).toMatch(/const planUnlocked = platformOverride \|\| !isWhiteLabel;/);
    expect((CODE.match(/const planUnlocked =/g) ?? []).length).toBe(1);
  });

  it('fails closed on an unknown cell rather than on a truthiness test', () => {
    // `features && f.x` is `null` while the plan is unresolved. `=== true` is
    // what makes that read as "no"; `!!cell` or a bare `cell` would not.
    expect(CODE).toMatch(/planAllows = \(cell: boolean \| null \| undefined\): boolean => planUnlocked \|\| cell === true;/);
  });
});

// ── 9. The matrix is untouched ───────────────────────────────────────────────
describe('no feature flag changed', () => {
  it('holds every cell this ticket names, on every tier', () => {
    // Named by cell, per tier, rather than by a digest: a digest says "something
    // moved", this says which tier lost what.
    //
    // ⚠️ `aiKnowledge` MOVED IN THE-253: true → false on pro and max. The
    // Knowledge Base is the RAG chat's other half and is sold with it as the AI
    // Assistant add-on, so no PLAN grants it. A tenant holding the add-on still
    // reaches the screen — `AdminDashboard` gates on `getEffectiveFeatures`, not
    // on this matrix.
    //
    // ⚠️ `crm` MOVED IN THE-335: true → false ON FREE, and a NEW `signups` cell
    // arrived true on every tier. The founder split what free gets — "The free
    // plan should have signup feature not CRM since we separated them" — and it
    // needed a second cell rather than one flipped boolean because
    // `AdminDashboard` gated BOTH screens on `crm`, so crm:false alone would
    // have taken the Signups screen and the analytics on it away in the same
    // edit. 🔴 NO PRICED TIER MOVED: all three still carry `crm: true`.
    //
    // ⚠️ THE TWO-PLAN REPRICING collapsed plus / pro / max into Church and
    // Ministry (a stored retired id reads as the tier it became), so the table
    // below has two paid rows. Church carries the community chat (`communityGroups`)
    // and notes (`docs`) that the old Individual row did not, and Ministry carries
    // `aiKnowledge`, which the spec lists under it.
    //
    // ⚠️ `smsAutomation` MOVED IN THE-314: true → false on plus and pro. SMS was
    // true on every paid tier while a church brought its own Twilio account and
    // the cell gated nothing. Harvest now RESELLS and pays for every segment, so
    // the founder made it Ministry-only — and the same `getEffectiveFeatures`
    // note applies, deliberately: if SMS is ever sold as an add-on it lifts with
    // `||` and this matrix does not move again.
    const CELLS = [
      'newsletterAutomation', 'aiKnowledge', 'docs', 'communityGroups',
      'customForms', 'accountingTools', 'eventRegistration', 'checkInSystem', 'livestream',
      'blog', 'crm', 'signups', 'fundraising', 'smsAutomation', 'customBranding', 'customDomain',
    ] as const;
    const actual: Record<string, Record<string, unknown>> = {};
    for (const plan of PLAN_ORDER) {
      const f = getPlanFeatures(plan);
      actual[plan] = Object.fromEntries(CELLS.map((c) => [c, f[c]]));
    }
    expect(actual).toEqual({
      free: {
        newsletterAutomation: false, aiKnowledge: false, docs: false, communityGroups: false,
        customForms: false, accountingTools: false, eventRegistration: false, checkInSystem: false,
        livestream: false, blog: false, crm: false, signups: true, fundraising: false, smsAutomation: false,
        customBranding: false, customDomain: false,
      },
      church: {
        newsletterAutomation: false, aiKnowledge: false, docs: true, communityGroups: true,
        customForms: false, accountingTools: false, eventRegistration: false, checkInSystem: false,
        livestream: false, blog: true, crm: true, signups: true, fundraising: true, smsAutomation: false,
        customBranding: false, customDomain: false,
      },
      ministry: {
        newsletterAutomation: true, aiKnowledge: true, docs: true, communityGroups: true,
        customForms: true, accountingTools: true, eventRegistration: true, checkInSystem: true,
        livestream: true, blog: true, crm: true, signups: true, fundraising: true, smsAutomation: true,
        customBranding: true, customDomain: true,
      },
    });
  });

  it('keeps the tier count and order the gates are derived from', () => {
    expect(PLAN_ORDER).toEqual(['free', 'church', 'ministry']);
  });
});
