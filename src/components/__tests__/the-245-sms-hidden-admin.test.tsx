import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';
import { getPlanFeatures, hasBrandingAccess, PLAN_ORDER, FREE_PLAN } from '../../utils/plan-features';
import type { TenantPlan } from '../../types/tenant.types';

/**
 * THE-245 — the admin, RENDERED, with the SMS master switch OFF.
 *
 * 🔴 THE SWITCH IS NOT MOCKED IN THIS FILE. Every other suite that touches SMS
 * forces it ON, because they pin what SMS does and must keep doing. This one
 * takes `SMS_FEATURE_ENABLED` exactly as it ships and asks the only question
 * left: with it off, can a church get to SMS at all?
 *
 * The harness is the one from AdminDashboard.tier-nav-gating.test.tsx — the
 * same mounts, the same tiers, the same nav reader — so "the SMS tab is absent"
 * here and "the SMS tab is present" there are answers to the same question
 * under the two settings of one boolean. That pairing IS the hide-not-delete
 * guarantee: nothing else differs between the two files.
 *
 * ⚠️ Nav labels are read off the RENDERED buttons, not off the tab array, so a
 * tab filtered out of `allTabs` but still drawn by some other path would fail.
 */

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

/** The nav a tier renders, for an admin with the given role/permissions. */
async function navFor(plan: TenantPlan | null, who: Who = {}, section = '') {
  store.current = { ...store.current, tenantPlan: plan };
  ctx.current = { ...ctx.current, tenantPlan: plan ?? undefined };
  await mount(who, section);
  const result = { nav: navLabels(), ...activeScreen() };
  await unmount();
  return result;
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
/** Mount, read what actually rendered, then unmount. `navFor` above drops the
 *  container before it returns, and the not-found branch is TEXT rather than a
 *  data attribute, so this variant keeps both. */
async function screenFor(plan: TenantPlan | null, who: Who = {}, section = 'sms') {
  store.current = { ...store.current, tenantPlan: plan };
  ctx.current = { ...ctx.current, tenantPlan: plan ?? undefined };
  await mount(who, section);
  const result = { ...activeScreen(), text: container.textContent ?? '' };
  await unmount();
  return result;
}

/* ── 1 ─────────────────────────────────────────────────────────────────────
   No tier reaches SMS in the nav — free included.                            */
describe('1 — the SMS nav entry is gone for every tier', () => {
  it('is absent on free, which otherwise sees every feature', async () => {
    // Free is the strong case: THE-220 made it the one tier whose nav ignores
    // its own plan cells and shows everything. If SMS is gone HERE, no plan
    // clause is doing the hiding — the master switch is.
    const { nav } = await navFor(FREE_PLAN);
    expect(nav, 'free still reaches SMS').not.toContain('SMS');
    // …and the rest of the free nav is untouched, so the switch took one entry
    // and not a category.
    for (const label of ['Blog', 'Courses', 'CRM', 'Fundraising', 'Check-In', 'Livestream', 'Community']) {
      expect(nav, `hiding SMS also took "${label}"`).toContain(label);
    }
  });

  it.each(PLAN_ORDER.map((p) => [p] as const))('is absent on %s', async (plan) => {
    const { nav } = await navFor(plan as TenantPlan);
    expect(nav, `${plan} still reaches SMS`).not.toContain('SMS');
  });

  it('🔴 is absent for a SUPER ADMIN too — the master switch outranks the override', async () => {
    // The affiliate entry set this precedent: while a feature is hidden NOBODY
    // gets the entry, super admin included. A super admin with platformOverride
    // sees every other gated tab, so this proves the switch is not a plan gate
    // wearing a different name.
    isSuperAdminMock.mockReturnValue(true);
    hasPlatformOverrideMock.mockReturnValue(true);
    const { nav } = await navFor(null, { role: 'super_admin' });
    expect(nav, 'a super admin still reaches SMS').not.toContain('SMS');
    expect(nav, 'the super-admin nav lost more than SMS').toContain('Tenants');
  });

  it('is absent for an admin who explicitly holds manageSms', async () => {
    // The permission is untouched in Firestore and still grants what it always
    // granted — it just has nothing to open while the feature is hidden.
    const { nav } = await navFor('max', { role: 'church_admin', permissions: { manageSms: true } });
    expect(nav, 'the manageSms permission still opens an SMS tab').not.toContain('SMS');
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────
   🔴 And a typed or bookmarked URL does not get in either.                    */
describe('2 — /admin/sms does not render the screen', () => {
  it('answers a typed URL with "Page not found.", on a tier that owns SMS', async () => {
    const { screen, text } = await screenFor('max');
    expect(screen, 'AdminSms rendered from a typed URL').not.toBe('AdminSms');
    expect(text).toContain('Page not found.');
  });

  it('🔴 does NOT answer with the upgrade wall — that would advertise the feature', async () => {
    // PlanUpgradeScreen sells the tier that includes what you asked for. On a
    // hidden feature it would market SMS on the very screen meant to hide it,
    // and it would be false anyway: the tiers that own `smsAutomation` cannot
    // use it either right now.
    for (const plan of ['free', 'plus', 'max'] as TenantPlan[]) {
      const { screen, wall, text } = await screenFor(plan);
      expect(screen, `${plan} reached the SMS screen`).not.toBe('AdminSms');
      expect(wall, `${plan} was sold an upgrade for a hidden feature`).toBeNull();
      expect(text, `${plan} was shown the SMS feature name`).not.toContain('SMS');
      expect(text).toContain('Page not found.');
    }
  });

  it('a super admin is refused the screen as well', async () => {
    isSuperAdminMock.mockReturnValue(true);
    hasPlatformOverrideMock.mockReturnValue(true);
    const { screen, text } = await screenFor(null, { role: 'super_admin' });
    expect(screen).not.toBe('AdminSms');
    expect(text).toContain('Page not found.');
  });

  it('every other section still renders, so the switch took exactly one', async () => {
    // The control. If /admin/sms is the only URL that stopped working, the gate
    // is where it says it is.
    for (const [section, expected] of [['crm', 'AdminCRM'], ['blog', 'AdminBlog'], ['checkin', 'AdminCheckin']] as const) {
      const { screen } = await screenFor('max', {}, section);
      expect(screen, `/admin/${section} broke`).toBe(expected);
    }
  });
});
