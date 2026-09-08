import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';
import { getPlanFeatures, hasBrandingAccess, PLAN_ORDER, FREE_PLAN } from '../../utils/plan-features';
import type { TenantPlan } from '../../types/tenant.types';

/**
 * THE-245 / THE-314 — the admin, RENDERED, with the SMS master switch exactly
 * as it ships.
 *
 * 🔴 THE SWITCH IS STILL NOT MOCKED IN THIS FILE, and that is the whole point
 * of it. Every other suite that touches SMS forces it ON; this one takes
 * `SMS_FEATURE_ENABLED` as shipped and asks what a church can actually reach.
 *
 * ⚠️ THE-245 SHIPPED IT OFF AND THIS FILE ASSERTED "no tier reaches SMS, free
 * and super admin included". THE-314 SHIPPED IT ON, so the question has a new
 * answer and the assertions turn round with it: the SMS entry is back, and it
 * is back on MINISTRY ALONE, because the same ticket made the capability
 * Ministry-only. Two gates now stand in the nav where one stood before — the
 * master switch, and the plan — and this file is where their combination is
 * read off the rendered DOM rather than inferred.
 *
 * The harness is the one from AdminDashboard.tier-nav-gating.test.tsx — the
 * same mounts, the same tiers, the same nav reader.
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
  /* THE-332 — the desktop nav is a RAIL: a group's tabs live in a flyout that
     unmounts while closed, and the two pinned entries are icon-only. Both are
     read from the model the rail advertises, which THE-332.nav-rail.test.tsx
     holds equal to what the flyout actually renders. Entitlement, which is what
     this file asserts, is unchanged. */
  container.querySelectorAll('[data-nav-group-labels]').forEach((g) => {
    (g.getAttribute('data-nav-group-labels') ?? '').split('|').forEach((l) => {
      if (ALL_TAB_LABELS.includes(l)) found.add(l);
    });
  });
  container.querySelectorAll('[data-nav-rail-tab]').forEach((b) => {
    const n = b.getAttribute('aria-label') ?? '';
    if (ALL_TAB_LABELS.includes(n)) found.add(n);
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
describe('1 — the SMS nav entry is back, on Ministry alone', () => {
  it('🔴 is PRESENT on max — the tier that bought it', async () => {
    const { nav } = await navFor('max');
    expect(nav, 'Ministry cannot reach SMS').toContain('SMS');
  });

  it('🔴 is absent on plus and pro — the two tiers THE-314 took it from', async () => {
    // The downgrade, read off the rendered nav rather than off the matrix.
    for (const plan of ['plus', 'pro'] as TenantPlan[]) {
      const { nav } = await navFor(plan);
      expect(nav, `${plan} still reaches SMS`).not.toContain('SMS');
      // …and the rest of that tier's nav is untouched, so the change took one
      // entry and not a category.
      for (const label of ['Blog', 'Courses', 'CRM', 'Fundraising', 'Check-In']) {
        expect(nav, `removing SMS from ${plan} also took "${label}"`).toContain(label);
      }
    }
  });

  it('🔴 free SEES the entry but cannot open it — the same shape as every other paid feature', async () => {
    // ⚠️ FREE IS THE ONE TIER WHOSE NAV IGNORES ITS OWN PLAN CELLS (THE-220):
    // it shows every entry and meets the upgrade wall on click. SMS is not made
    // an exception to that, and this is the assertion that says so on purpose
    // rather than by omission — a free tenant sees "SMS" exactly as it sees
    // "Blog" and "Newsletter", both of which it also cannot use.
    //
    // 🔴 WHAT ACTUALLY PROTECTS THE MONEY IS NOT THIS NAV ENTRY. `smsAutomation`
    // is false on free, so the screen walls, `/api/sms/numbers` refuses the
    // purchase with a 403, and the send funnel refuses before it reserves a
    // segment. A nav label is a label; three server-side gates are the control.
    const { nav } = await navFor(FREE_PLAN);
    expect(nav, 'free lost the SMS entry that THE-220 gives it').toContain('SMS');
    for (const label of ['Blog', 'Courses', 'CRM', 'Fundraising', 'Check-In', 'Livestream', 'Community']) {
      expect(nav, `free lost "${label}"`).toContain(label);
    }

    // And the entry does not open the screen — asserted here rather than left
    // to section 2, because "free sees the label" is only safe alongside it.
    const { screen } = await screenFor(FREE_PLAN);
    expect(screen, 'free reached the SMS screen from its see-everything nav').not.toBe('AdminSms');
  });

  it('a SUPER ADMIN with the platform override reaches it', async () => {
    isSuperAdminMock.mockReturnValue(true);
    hasPlatformOverrideMock.mockReturnValue(true);
    const { nav } = await navFor(null, { role: 'super_admin' });
    expect(nav, 'the super-admin nav lost SMS').toContain('SMS');
    expect(nav, 'the super-admin nav lost more than SMS').toContain('Tenants');
  });

  it('🔴 the manageSms permission alone does not open it on a tier without the plan', async () => {
    // Both clauses must hold. The permission is untouched in Firestore and
    // still grants what it always granted — it just has no Individual-tier
    // feature to open.
    const { nav } = await navFor('plus', { role: 'church_admin', permissions: { manageSms: true } });
    expect(nav, 'the manageSms permission overrode the plan gate').not.toContain('SMS');
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────
   🔴 And a typed or bookmarked URL does not get in either.                    */
describe('2 — /admin/sms renders for Ministry, and walls the tiers below it', () => {
  it('🔴 a typed URL renders the screen on max', async () => {
    const { screen } = await screenFor('max');
    expect(screen, 'AdminSms did not render from a typed URL on Ministry').toBe('AdminSms');
  });

  it('🔴 answers WITH the upgrade wall on plus and pro — the feature exists now', async () => {
    // ⚠️ REVERSED. While SMS was hidden this asserted the OPPOSITE: no upgrade
    // wall, because PlanUpgradeScreen sells the tier that includes what you
    // asked for, and marketing SMS on the very screen meant to hide it would
    // have been a false claim — the tiers that owned `smsAutomation` could not
    // use it either.
    //
    // Both halves of that reasoning are gone. SMS is real, Ministry genuinely
    // has it, and an Individual tenant that bookmarked /admin/sms is now in the
    // ordinary case this wall exists for: it asked for something a higher tier
    // sells. Showing "Page not found." there would hide a capability Harvest is
    // selling, which is the mirror of the false claim the old assertion feared.
    for (const plan of ['plus', 'pro'] as TenantPlan[]) {
      const { screen, wall } = await screenFor(plan);
      expect(screen, `${plan} reached the SMS screen`).not.toBe('AdminSms');
      expect(wall, `${plan} got no upgrade wall for a feature Ministry sells`).not.toBeNull();
    }
  });

  it('free is refused too', async () => {
    const { screen } = await screenFor(FREE_PLAN);
    expect(screen, 'free reached the SMS screen').not.toBe('AdminSms');
  });

  it('a super admin reaches the screen as well', async () => {
    isSuperAdminMock.mockReturnValue(true);
    hasPlatformOverrideMock.mockReturnValue(true);
    const { screen } = await screenFor(null, { role: 'super_admin' });
    expect(screen).toBe('AdminSms');
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
