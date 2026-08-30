import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';
import { getPlanFeatures, hasBrandingAccess, PLAN_ORDER, FREE_PLAN } from '../../utils/plan-features';
import type { TenantPlan, TenantAddons } from '../../types/tenant.types';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-220 — the nav gate is back for the tiers that pay, and gone for the one
 * that does not.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── What happened ───────────────────────────────────────────────────────────
 *
 * THE-202 (49b2a0c) built the free tier's "see every feature, read-only" mode
 * from the founder's words — "the admin of this free plan can see all the
 * features and can navigate through them but he cannot use any of them" — by
 * DELETING the plan clause from `allTabs` outright. That applied the behaviour
 * to every tier, so an Individual tenant showed all sixteen nav items, nine of
 * which it cannot use. The brief never said to keep the gating for paid tiers,
 * so this was its omission rather than that agent's error.
 *
 * The founder's correction: "Only the evangelist has to see the entire list of
 * features. Individual doesn't have to see the features from Ministry."
 *
 * ─── 🔴 WHY THE REMOVED CLAUSE WAS NOT SIMPLY RESTORED ───────────────────────
 *
 * Two reasons, and both are the kind that a verbatim revert would have buried:
 *
 *  1. It would hide the tabs from FREE as well, which is the half THE-202 got
 *     right and the whole point of the tier. `navAllows` is therefore the old
 *     clause PLUS the free tier, not the old clause.
 *
 *  2. THE OLD CLAUSE DISAGREED WITH THE RENDER LAYER. The Courses entry read
 *     `features.blog` while the Courses SCREEN reads `maxCourses !== 0` — two
 *     layers gating one tab on two different features, which is precisely the
 *     class of defect this ticket exists to close. The restored clause reads
 *     the render layer's cell. `AdminDashboard.tier-tab-matrix` resolves both
 *     layers per tier and fails on any remaining disagreement.
 *
 * ─── What is asserted here ───────────────────────────────────────────────────
 *
 * The NAV, per tier, by LABEL. Entitlement (which SCREEN a tab mounts) is
 * `AdminDashboard.plan-entitlement`'s job and is unchanged by this ticket; the
 * two-layer view is `AdminDashboard.tier-tab-matrix`. Targets are named by the
 * label a founder would read in the product, never by matching a value pattern,
 * so a renamed cell cannot quietly empty an assertion.
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
  current: { branding: null as unknown, isLoading: false, tenantPlan: undefined as string | undefined, tenantAddons: null as unknown },
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
vi.mock('../AnalyticsAndRoles', () => ({ normalizePermissions: (raw: unknown) => raw }));
vi.mock('../AdminScreenHeader', async () => {
  const React = await import('react');
  return {
    AdminScreenHeader: () => null,
    AdminHeaderContext: React.createContext({
      setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderHidden: () => {},
    }),
  };
});

/** Each screen names itself; PlanUpgradeScreen names the feature it refuses. */
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

/* ── the sixteen, and what each one's plan clause reads ─────────────────────── */

/**
 * Every tab a full-access tenant admin can have, with the FEATURE CELL its nav
 * clause consults. Derived per tier from the matrix rather than four
 * hand-written lists — four lists is the drift shape this project keeps paying
 * for, and the whole ticket is one instance of it.
 *
 * `cell: null` means the entry carries no plan clause at all. There are three,
 * and each is a decision recorded here rather than an omission:
 *
 *   Dashboard — the welcome screen. Nothing to buy.
 *   Church    — no plan clause on EITHER layer. `maxChurches` is a cap the
 *               create path enforces, not a surface gate, and the screen mounts
 *               unconditionally; adding a nav clause alone would hide a tab that
 *               still renders in full when reached by URL, which is exactly the
 *               disagreement `tier-tab-matrix` fails on.
 *   Check-In  — 🔴 STOP CONDITION 3, the known case. See CHECKIN_NOTE.
 */
type Tab = {
  label: string;
  section: string;
  /** The nav clause's cell, or null when the entry has none. */
  cell: ((f: ReturnType<typeof getPlanFeatures>) => boolean) | null;
};

const TABS: Tab[] = [
  { label: 'Dashboard', section: '', cell: null },
  { label: 'Church', section: 'churches', cell: null },
  { label: 'Courses', section: 'courses', cell: (f) => f.maxCourses !== 0 },
  { label: 'Blog', section: 'blog', cell: (f) => f.blog },
  { label: 'AI Knowledge', section: 'ai-knowledge', cell: (f) => f.aiKnowledge },
  { label: 'Newsletter', section: 'newsletter', cell: (f) => f.newsletterAutomation },
  { label: 'Fundraising', section: 'fundraising', cell: (f) => f.fundraising },
  { label: 'Events', section: 'events', cell: (f) => f.eventRegistration },
  { label: 'Notes', section: 'docs', cell: (f) => f.docs },
  { label: 'CRM', section: 'crm', cell: (f) => f.crm },
  { label: 'Accounting', section: 'accounting', cell: (f) => f.accountingTools || f.givingStatements },
  { label: 'Forms', section: 'forms', cell: (f) => f.customForms },
  { label: 'Check-In', section: 'checkin', cell: null },
  { label: 'Livestream', section: 'livestream', cell: (f) => f.livestream },
  { label: 'SMS', section: 'sms', cell: (f) => f.smsAutomation },
  { label: 'Community', section: 'community', cell: (f) => f.communityGroups },
];

/**
 * 🔴 CHECK-IN, AND WHY IT STAYS VISIBLE ON EVERY TIER.
 *
 * The ticket counts Check-In among the nine an Individual tenant must not see,
 * and this file deliberately does not. `checkInSystem` gates only HALF the tab:
 * it hosts QR Codes as well, which every tier carries on purpose (THE-213,
 * whose own note says gating the QR selector "would change a PRICED tier's
 * screen, which the brief forbids"), and the check-in half self-gates inside
 * `AdminCheckin` and again server-side.
 *
 * So hiding the tab on Individual would take the QR generator away from a tier
 * that genuinely has it, in order to hide a sub-tab that tier already cannot
 * open. The render switch carries no plan clause here for the same reason, so
 * both layers agree — which is the property that matters, and the one
 * `tier-tab-matrix` checks.
 */
const CHECKIN_NOTE = 'QR Codes is on every tier; checkInSystem gates only the inner sub-tab';

/**
 * The nav a tier is expected to show. DERIVED — free takes everything, a priced
 * tier takes the entries whose cell it carries — so the four expectations
 * cannot drift from each other or from the matrix.
 */
function expectedNav(plan: TenantPlan): string[] {
  const f = getPlanFeatures(plan);
  const labels = TABS
    .filter((t) => plan === FREE_PLAN || t.cell === null || t.cell(f))
    // The churches label is per-tier: a tier capped at one campus says 'Church'.
    .map((t) => (t.label === 'Church' && f.maxChurches !== 1 ? 'Church List' : t.label));
  if (hasBrandingAccess(f)) labels.push('Branding');
  return labels.sort();
}

let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

const ALL_TAB_LABELS = [
  'Dashboard', 'Church', 'Church List', 'Courses', 'Blog', 'AI Knowledge', 'Newsletter',
  'Fundraising', 'Events', 'Notes', 'CRM', 'Accounting', 'Forms', 'Check-In', 'Livestream',
  'SMS', 'Community', 'Library', 'Tenants', 'Affiliate', 'Branding',
];
function navLabels(): string[] {
  const found = new Set<string>();
  container.querySelectorAll('button').forEach((b) => {
    const text = b.textContent?.trim() ?? '';
    if (ALL_TAB_LABELS.includes(text)) found.add(text);
  });
  return [...found].sort();
}

function activeScreen(): { screen: string | null; wall: string | null } {
  return {
    screen: container.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null,
    wall: container.querySelector('[data-upgrade-wall]')?.getAttribute('data-upgrade-wall') ?? null,
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

/** The nav a tier renders, for an admin with the given role/permissions.
 *  `addons` defaults to owning nothing — see the AI Knowledge tests below. */
async function navFor(
  plan: TenantPlan | null,
  who: Who = {},
  section = '',
  addons: TenantAddons | null = null,
) {
  store.current = { ...store.current, tenantPlan: plan };
  ctx.current = { ...ctx.current, tenantPlan: plan ?? undefined, tenantAddons: addons };
  await mount(who, section);
  const result = { nav: navLabels(), ...activeScreen() };
  await unmount();
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.current = { tenantPlan: null, currentTenantId: TENANT_ID, isAuthReady: true };
  ctx.current = { branding: null, isLoading: false, tenantPlan: undefined, tenantAddons: null };
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

// ── 1 ────────────────────────────────────────────────────────────────────────
describe('1 — a free tenant sees all sixteen nav items', () => {
  it('a free tenant sees all sixteen nav items', async () => {
    const { nav } = await navFor('free');

    // 🔴 THE POINT OF THE TIER. Named individually, not counted, so a nav that
    // lost one and gained another cannot pass on arithmetic.
    for (const tab of TABS) {
      const label = tab.label === 'Church' ? 'Church List' : tab.label;
      expect(nav, `a free admin lost "${label}" — free must see every feature`).toContain(label);
    }
    expect(nav.length, 'the free nav is exactly the sixteen').toBe(16);
    expect(nav).toEqual(expectedNav('free'));

    // And it is genuinely the see-everything case: free's own cells unlock only
    // two of these, so the other eleven gated tabs are there in spite of the
    // matrix rather than because of it.
    const f = getPlanFeatures('free');
    const unlockedByCells = TABS.filter((t) => t.cell !== null && t.cell(f)).map((t) => t.label);
    expect(unlockedByCells, "free's cells now unlock more than Courses and CRM — check the matrix")
      .toEqual(['Courses', 'CRM']);
  });

  it('Branding is NOT one of the sixteen, on free or on any tier below Ministry', async () => {
    // ⚠️ `canBranding` gates the nav entry AND the render guard together, and it
    // predates THE-202 — it was never in the family of clauses 49b2a0c removed,
    // so THE-220 has nothing to restore there. Giving it the free clause would
    // make the free nav SEVENTEEN, contradicting the founder's own count, and
    // would put a tab in the nav whose render guard still refuses it.
    for (const plan of ['free', 'plus', 'pro'] as const) {
      expect(hasBrandingAccess(getPlanFeatures(plan))).toBe(false);
      expect((await navFor(plan)).nav, `${plan} gained a Branding tab`).not.toContain('Branding');
    }
    expect(hasBrandingAccess(getPlanFeatures('max'))).toBe(true);
    expect((await navFor('max')).nav).toContain('Branding');
  });
});

// ── 2–4 ──────────────────────────────────────────────────────────────────────
describe('2 — an Individual tenant sees exactly its seven', () => {
  /** The founder's report, named individually rather than derived. */
  const SEVEN = ['Dashboard', 'Blog', 'Church', 'Courses', 'CRM', 'Fundraising', 'SMS'];

  /** 🔴 The nine the ticket says must go, by label. */
  const NINE_HIDDEN = [
    'Newsletter', 'AI Knowledge', 'Notes', 'Community', 'Forms',
    'Accounting', 'Events', 'Livestream',
  ];

  it('an Individual tenant sees exactly its seven', async () => {
    const { nav } = await navFor('plus');
    for (const label of SEVEN) {
      expect(nav, `Individual lost "${label}", one of its seven`).toContain(label);
    }
    // Eight, not seven: Check-In is the ticket's own known exception and the
    // reason is recorded above. STOP CONDITION 3, reported not silently applied.
    expect(nav, CHECKIN_NOTE).toContain('Check-In');
    expect(nav.length, 'Individual shows its seven plus Check-In and nothing else').toBe(8);
    expect(nav).toEqual(expectedNav('plus'));
  });

  it('hides eight of the nine, and keeps Check-In for the QR half it does carry', async () => {
    const { nav } = await navFor('plus');
    const f = getPlanFeatures('plus');
    for (const label of NINE_HIDDEN) {
      expect(nav, `"${label}" is still in an Individual nav`).not.toContain(label);
    }
    // Every cell the ticket names is false on plus — asserted, not assumed, so
    // the hiding above is attributable to the matrix and not to a lost tab.
    for (const cell of [
      'newsletterAutomation', 'aiKnowledge', 'docs', 'communityGroups', 'customForms',
      'accountingTools', 'eventRegistration', 'checkInSystem', 'livestream',
    ] as const) {
      expect(f[cell], `${cell} is not false on plus`).toBe(false);
    }
    // The ninth: hidden nowhere, because its tab is not only checkInSystem.
    expect(nav, CHECKIN_NOTE).toContain('Check-In');
  });
});

describe('3 — a Small Team tenant sees exactly its expected set', () => {
  /**
   * Small Team (pro), read off the matrix and stated here by name so the
   * derivation has something to be checked against:
   * Dashboard · Church · Courses · Blog · Newsletter ·
   * Fundraising · Notes · CRM · Check-In · Livestream · SMS.
   * Absent: Events, Accounting, Forms, Community, Branding.
   */
  // ⚠️ 'AI Knowledge' WAS IN THIS LIST. THE-253 took `aiKnowledge` off every
  // tier — the Knowledge Base is the RAG chat's other half and is sold with it
  // as the AI Assistant add-on — so no PLAN grants the screen. A Small Team
  // tenant HOLDING the add-on does see it: `AdminDashboard` gates on
  // `getEffectiveFeatures`, and `navFor` here mounts with no add-ons.
  const EXPECTED = [
    'Dashboard', 'Church', 'Courses', 'Blog', 'Newsletter',
    'Fundraising', 'Notes', 'CRM', 'Check-In', 'Livestream', 'SMS',
  ];

  it('a Small Team tenant sees exactly its expected set', async () => {
    const { nav } = await navFor('pro');
    expect(nav).toEqual([...EXPECTED].sort());
    expect(nav).toEqual(expectedNav('pro'));
    for (const label of ['Events', 'Accounting', 'Forms', 'Community', 'Branding']) {
      expect(nav, `Small Team does not buy "${label}"`).not.toContain(label);
    }
  });
});

/* ── 🔴 PR 394's CATCH, AS A BEHAVIOURAL NO-REGRESSION ──────────────────────
 *
 * The defect PR 394 nearly shipped, and the one THE-253 must never reintroduce:
 * `getEffectiveFeatures` grants the capability, and then the SURFACE refuses it
 * anyway because its gate reads `getPlanFeatures` — the TIER question. The
 * church pays, the entitlement resolves, and the screen still says no.
 *
 * `the-253-ai-chat-addon.test.ts` pins that neither component calls
 * `getPlanFeatures`, which is the structural half. This is the other half: mount
 * the real AdminDashboard with the add-on held and watch the nav entry appear.
 * A source guard can be satisfied by an unused import; this cannot. */
describe('3b — an entitled admin is not refused at the surface', () => {
  const OWNS_ADDON = {
    aiAssistant: 1, adminSeats: 0, contactPacks: 0, unlimitedContacts: false, campuses: 0,
  } as const;
  const OWNS_NOTHING = {
    aiAssistant: 0, adminSeats: 0, contactPacks: 0, unlimitedContacts: false, campuses: 0,
  } as const;

  /* ⚠️ THE THREE PRICED TIERS, NOT ALL FOUR. `free` is the permissive fallback
     in this harness — test 1 above pins that a free tenant hides only Branding
     — so it cannot show the add-on making a difference. It is also the tier
     that cannot buy this add-on at all: no Dodo subscription to attach it to,
     and `queryTokensPerMonth: 0` if one ever arrived. Both facts are pinned in
     the-253-ai-chat-addon.test.ts. */
  it.each(['plus', 'pro', 'max'] as const)(
    '%s: the AI Knowledge entry appears when the add-on is held', async (plan) => {
    const without = await navFor(plan, {}, '', { ...OWNS_NOTHING });
    expect(without.nav, `${plan} shows AI Knowledge owning nothing`).not.toContain('AI Knowledge');

    const withAddon = await navFor(plan, {}, '', { ...OWNS_ADDON });
    expect(withAddon.nav, `${plan} BOUGHT the add-on and was still refused`).toContain('AI Knowledge');
  });

  it('🔴 the AI Knowledge SCREEN renders for an entitled admin, not an upgrade wall', async () => {
    // The nav entry appearing is not enough: THE-213's defect was a tab hidden
    // from the nav that still rendered by URL, and this is its mirror — a tab
    // the church is entitled to that answers with a wall when reached.
    const { screen, wall } = await navFor('plus', {}, 'ai-knowledge', { ...OWNS_ADDON });
    expect(wall, 'an entitled admin got an upgrade wall').toBeNull();
    expect(screen, 'the AI Knowledge screen did not render for an entitled admin').toBe('AdminRAG');
  });

  it('and an unentitled admin still gets the wall, so the gate is real', async () => {
    const { screen, wall } = await navFor('max', {}, 'ai-knowledge', { ...OWNS_NOTHING });
    expect(screen, 'Ministry reached AI Knowledge without the add-on').not.toBe('AdminRAG');
    expect(wall, 'no upgrade wall for an unentitled admin').not.toBeNull();
  });
});

describe('4 — a Ministry tenant sees exactly its expected set', () => {
  /** Ministry (max) buys everything a PLAN can buy: the fifteen plus Branding.
   *  ⚠️ Was sixteen. 'AI Knowledge' is no longer among them — THE-253 made it
   *  part of the AI Assistant add-on, so even Ministry does not get it by
   *  paying for the tier. It returns for a Ministry tenant that holds the
   *  add-on, through `getEffectiveFeatures`. */
  it('a Ministry tenant sees exactly its expected set', async () => {
    const { nav } = await navFor('max');
    for (const tab of TABS) {
      if (tab.label === 'AI Knowledge') {
        expect(nav, 'Ministry claims AI Knowledge without the add-on').not.toContain(tab.label);
        continue;
      }
      expect(nav, `Ministry lost "${tab.label}"`).toContain(tab.label);
    }
    expect(nav).toContain('Branding');
    expect(nav.length, 'Ministry shows the fifteen plus Branding').toBe(16);
    expect(nav).toEqual(expectedNav('max'));
  });

  it('the tiers are nested: free ⊇ Ministry ⊇ Small Team ⊇ Individual', async () => {
    // A monotonic matrix must produce a monotonic nav. This is what fails if a
    // future cell is set on a cheaper tier but not a dearer one.
    const navs = new Map<TenantPlan, string[]>();
    for (const plan of PLAN_ORDER) navs.set(plan, (await navFor(plan)).nav);
    const gated = (l: string[]) => l.filter((x) => x !== 'Church' && x !== 'Church List' && x !== 'Branding');
    for (const [smaller, larger] of [['plus', 'pro'], ['pro', 'max'], ['max', 'free']] as const) {
      for (const label of gated(navs.get(smaller)!)) {
        expect(gated(navs.get(larger)!), `${larger} lost "${label}" that ${smaller} has`).toContain(label);
      }
    }
  });
});

// ── 5 ────────────────────────────────────────────────────────────────────────
describe('5 — a super admin still sees everything through platformOverride', () => {
  it('a super admin still sees everything through platformOverride', async () => {
    isSuperAdminMock.mockReturnValue(true);
    hasPlatformOverrideMock.mockReturnValue(true);

    // On the cheapest tier there is, which is where a lost bypass would show.
    const { nav } = await navFor('plus', { role: 'super_admin' });
    for (const tab of TABS) {
      expect(nav, `platformOverride lost "${tab.label}"`).toContain(tab.label);
    }
    expect(nav).toContain('Branding');
    // A super-admin-only surface, which no tenant tier has at any price.
    // (`Library` is in `allTabs` but in no desktop nav GROUP, so it renders only
    // in the mobile More sheet — out of scope for a nav-label scrape.)
    expect(nav).toContain('Tenants');
  });

  it('a super admin on a tenant subdomain is still gated by that tenant\'s plan', async () => {
    // ⚠️ Deliberate and pre-existing (tenant-scope.ts's contract): the override
    // is the PLATFORM context, not the role. THE-220 must not widen it into one.
    isSuperAdminMock.mockReturnValue(true);
    hasPlatformOverrideMock.mockReturnValue(false);
    const { nav } = await navFor('plus', { role: 'super_admin' });
    expect(nav, 'a super admin on a paid subdomain now bypasses that plan').not.toContain('Community');
  });
});

// ── 6 ────────────────────────────────────────────────────────────────────────
describe("6 — a limited admin's permission gates still apply on top of the plan gate", () => {
  it("a limited admin's permission gates still apply on top of the plan gate", async () => {
    // ⚠️ BOTH conditions must hold. Ministry buys every feature, so anything
    // missing here is the permission clause doing its job — the plan clause
    // cannot be what removed it.
    const onlyBlog = await navFor('max', { role: 'admin', permissions: { writeArticles: true } });
    expect(onlyBlog.nav).toContain('Blog');
    for (const label of ['CRM', 'Newsletter', 'Community', 'Accounting', 'Forms', 'Livestream', 'SMS']) {
      expect(onlyBlog.nav, `a writeArticles-only admin reached "${label}"`).not.toContain(label);
    }
  });

  it('the plan gate cannot hand a tab to an admin whose role denies it', async () => {
    // The free tier is where the two gates are most likely to be confused: its
    // nav clause is open for every tab, so ONLY the permission clause stands.
    const onlyCrm = await navFor('free', { role: 'admin', permissions: { manageCRM: true } });
    expect(onlyCrm.nav).toContain('CRM');
    expect(onlyCrm.nav).toContain('Dashboard');
    for (const label of ['Blog', 'Newsletter', 'Community', 'Check-In', 'SMS', 'Courses']) {
      expect(onlyCrm.nav, `free's see-everything clause overrode the "${label}" permission gate`)
        .not.toContain(label);
    }
  });

  it('a permission the admin holds on a tier that lacks the feature still hides the tab', async () => {
    // The converse, and the reason both clauses are needed: holding the
    // permission is not enough when the tenant never bought the feature.
    const { nav } = await navFor('plus', { role: 'admin', permissions: { manageCommunity: true } });
    expect(nav, 'a permission granted a tab the tier did not buy').not.toContain('Community');
    expect(getPlanFeatures('plus').communityGroups).toBe(false);
  });
});

// ── 7 ────────────────────────────────────────────────────────────────────────
describe('7 — a hidden tab still refuses when reached by URL', () => {
  it('a hidden tab still refuses when reached by URL', async () => {
    // 🔴 The render-time layer is the one that cannot be bypassed by typing a
    // path, and THE-220 did not touch it. Every tab now absent from an
    // Individual nav must still answer PlanUpgradeScreen — never its screen —
    // when `/admin/<section>` is opened directly.
    const f = getPlanFeatures('plus');
    const hidden = TABS.filter((t) => t.cell !== null && !t.cell(f));
    expect(hidden.length, 'nothing is hidden from Individual — the gate did not apply').toBe(8);

    for (const tab of hidden) {
      const { screen, wall } = await navFor('plus', {}, tab.section);
      expect(screen, `"${tab.label}" rendered its screen when reached by URL`).toBeNull();
      expect(wall, `"${tab.label}" showed no upgrade wall when reached by URL`).not.toBeNull();
    }
  });

  it('and the nav entry really is gone, so this is a second layer and not the only one', async () => {
    const f = getPlanFeatures('plus');
    for (const tab of TABS.filter((t) => t.cell !== null && !t.cell(f))) {
      const { nav } = await navFor('plus', {}, tab.section);
      expect(nav, `"${tab.label}" is still in the nav`).not.toContain(tab.label);
    }
  });
});

// ── 8 ────────────────────────────────────────────────────────────────────────
describe('8 — no feature flag changed', () => {
  it('no feature flag changed', () => {
    // Named per cell per tier rather than digested: a digest says "something
    // moved", this says which. Every cell any nav clause in this ticket reads.
    const CELLS = [
      ['blog', [false, true, true, true]],
      // 🔴 MOVED BY THE-253, AND THE ONLY CELL IN THIS TABLE THAT DID. Was
      // [false, false, true, true]. The Knowledge Base is the RAG chat's other
      // half and is sold with it, so no tier includes it; the add-on lifts it.
      ['aiKnowledge', [false, false, false, false]],
      ['newsletterAutomation', [false, false, true, true]],
      ['fundraising', [false, true, true, true]],
      ['eventRegistration', [false, false, false, true]],
      ['docs', [false, false, true, true]],
      ['crm', [true, true, true, true]],
      ['accountingTools', [false, false, false, true]],
      ['givingStatements', [false, false, false, true]],
      ['customForms', [false, false, false, true]],
      ['checkInSystem', [false, false, true, true]],
      ['livestream', [false, false, true, true]],
      ['smsAutomation', [false, true, true, true]],
      ['communityGroups', [false, false, false, true]],
      ['customBranding', [false, false, false, true]],
      ['customDomain', [false, false, false, true]],
    ] as const;
    for (const [cell, perTier] of CELLS) {
      expect(PLAN_ORDER.map((p) => getPlanFeatures(p)[cell]), `${cell} moved`).toEqual([...perTier]);
    }
    // The one numeric cell a nav clause reads, and the reason Courses is on
    // every tier: no tier has zero courses.
    expect(PLAN_ORDER.map((p) => getPlanFeatures(p).maxCourses)).toEqual([1, 2, 5, 15]);
    expect(PLAN_ORDER.map((p) => getPlanFeatures(p).maxChurches)).toEqual([0, 1, 1, 1]);
  });
});

// ── 9 ────────────────────────────────────────────────────────────────────────
describe('9 — the nav is derived from one tab array, not two', () => {
  const SOURCE = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');
  const CODE = SOURCE
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('the nav is derived from one tab array, not two', () => {
    // 🔴 STOP CONDITION 5. Preserving free's full list by keeping a second,
    // free-only copy of the tab array would have worked on the day it shipped
    // and drifted by the next ticket — two lists that must stay in sync is the
    // shape this project keeps paying for. There is one array, and the tier
    // difference is one term inside each entry.
    expect((CODE.match(/const allTabs = \[/g) ?? []).length).toBe(1);
    expect(CODE, 'a second tab array appeared').not.toMatch(/const \w*[Tt]abs(ForFree|Free|Full)\w* = \[/);

    // Every downstream consumer still reads that one array: the mobile bar, the
    // More drawer, the desktop sidebar and the unknown-tab guard.
    for (const consumer of [
      'primaryTabs = allTabs.slice(0, 4)',
      'drawerTabs = allTabs.slice(4)',
      'allTabs.map(t => t.id)',
      '...allTabs,',
    ]) {
      expect(CODE, `a nav consumer stopped reading allTabs: ${consumer}`).toContain(consumer);
    }
  });

  it('every gated entry states its plan clause through the one helper', () => {
    // 13 nav clauses — one per gated tab. Check-In, Church and Dashboard carry
    // none, deliberately, and `canBranding` predates this family.
    const navGates = (CODE.match(/navAllows\(/g) ?? []).length;
    const gatedTabs = TABS.filter((t) => t.cell !== null).length;
    expect(navGates, 'a nav entry gained or lost its plan clause').toBe(gatedTabs);
    expect(gatedTabs).toBe(13);
  });

  it('leaves Check-In and Church without a plan clause, which is the recorded decision', () => {
    // If someone later adds one, this fails and they have to say why here.
    expect(CODE).toMatch(/\(hasFullAccess \|\| perms\.manageCheckin \|\| perms\.manageQR\) &&\s*\{ id: 'checkin'/);
    expect(CODE).toMatch(/\(hasFullAccess \|\| perms\.modifyChurches\) && \{ id: 'churches'/);
  });
});
