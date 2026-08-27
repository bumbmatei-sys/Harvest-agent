import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';
import { getPlanFeatures, PLAN_DISPLAY_NAMES, PLAN_ORDER } from '../../utils/plan-features';
import type { TenantPlan } from '../../types/tenant.types';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-220 Part 3 — the four-tier tab matrix, RESOLVED FROM THE CODE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The founder has re-tested this product by hand more than once in this series.
 * This replaces that with a table, and the table is generated rather than
 * written: every cell below is produced by MOUNTING the real `AdminDashboard`
 * on that tier, reading the real nav array, opening that tab's real URL and
 * seeing which screen the real render switch mounted.
 *
 * 🔴 A TABLE COPIED FROM `plan-features.ts` WOULD PROVE NOTHING. The whole
 * defect this ticket fixes is that the code and the matrix disagreed — twice:
 * the nav showed nine tabs an Individual tenant cannot use, and the Courses nav
 * clause read `blog` while the Courses screen read `maxCourses`. A table derived
 * from the matrix would have reported both as correct. So the matrix is used
 * only to say what a cell OUGHT to be, and the disagreements are the output.
 *
 * Three values per cell, exactly as the ticket specifies:
 *
 *   hidden                   — the tab is not in the nav.
 *   visible · upgrade screen — in the nav; the URL renders PlanUpgradeScreen.
 *   visible · full           — in the nav; the URL renders the feature itself.
 *
 * The rendered table is printed on every run (look for TIER-TAB MATRIX in the
 * test output) and written to `docs/the-220-tier-tab-matrix.md`, so the copy in
 * the PR body has a generated source and cannot quietly go stale.
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

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useParams: () => params.current }));
vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdminStatus }));
vi.mock('../../utils/tenant-scope', () => ({
  isSuperAdmin: isSuperAdminMock, hasPlatformOverride: hasPlatformOverrideMock,
  getTenantScope: async () => TENANT_ID, PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store.current }));
vi.mock('../../hooks/queries/useUserQueries', () => ({ useCurrentUser: () => userQuery.current }));
vi.mock('../../hooks/queries/useTenantQueries', () => ({
  useTenant: () => ({ data: { name: 'Grace Ministry', ownerId: 'someone-else' }, isLoading: false }),
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => ctx.current }));
vi.mock('../../firebase', () => ({
  db: {}, get auth() { return { get currentUser() { return currentUser.current; } }; },
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(async () => {}) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), query: () => ({}), where: () => ({}), limit: () => ({}), onSnapshot: () => () => {},
}));
vi.mock('../../utils/firestore-errors', () => ({ OperationType: { GET: 'get' }, handleFirestoreError: () => {} }));
vi.mock('../AnalyticsAndRoles', () => ({ normalizePermissions: (raw: unknown) => raw }));
vi.mock('../AdminScreenHeader', async () => {
  const React = await import('react');
  return {
    AdminScreenHeader: () => null,
    AdminHeaderContext: React.createContext({ setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderHidden: () => {} }),
  };
});

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

/* ── the tabs, and the feature each one claims ─────────────────────────────── */

/**
 * One row per admin tab a tenant can have.
 *
 * `feature` is what the tab CLAIMS to need — the cell a founder reading the
 * pricing page would expect to gate it. It is used for exactly one thing: to
 * ask, per tier, whether what the code does agrees with what the matrix says.
 * `null` means the tab claims no feature, and the reason is recorded in `note`.
 */
type Row = {
  label: string;
  section: string;
  screen: string;
  feature: ((f: ReturnType<typeof getPlanFeatures>) => boolean) | null;
  note?: string;
};

const TABS: Row[] = [
  { label: 'Dashboard', section: '', screen: 'AdminDashboardHome', feature: null, note: 'the welcome screen — nothing to buy' },
  { label: 'Church', section: 'churches', screen: 'AdminChurches', feature: null, note: '`maxChurches` is a create-path cap, not a surface gate; ungated on BOTH layers' },
  { label: 'Courses', section: 'courses', screen: 'AdminCourses', feature: (f) => f.maxCourses !== 0 },
  { label: 'Blog', section: 'blog', screen: 'AdminBlog', feature: (f) => f.blog },
  { label: 'AI Knowledge', section: 'ai-knowledge', screen: 'AdminRAG', feature: (f) => f.aiKnowledge },
  { label: 'Newsletter', section: 'newsletter', screen: 'NewsletterCampaigns', feature: (f) => f.newsletterAutomation },
  { label: 'Fundraising', section: 'fundraising', screen: 'AdminFundraising', feature: (f) => f.fundraising },
  { label: 'Events', section: 'events', screen: 'AdminEvents', feature: (f) => f.eventRegistration },
  { label: 'Notes', section: 'docs', screen: 'AdminDocs', feature: (f) => f.docs },
  { label: 'CRM', section: 'crm', screen: 'AdminCRM', feature: (f) => f.crm },
  { label: 'Accounting', section: 'accounting', screen: 'AdminAccounting', feature: (f) => f.accountingTools || f.givingStatements },
  { label: 'Forms', section: 'forms', screen: 'AdminForms', feature: (f) => f.customForms },
  { label: 'Check-In', section: 'checkin', screen: 'AdminCheckin', feature: (f) => f.checkInSystem, note: 'hosts TWO products — see KNOWN_TWO_LAYER_EXCEPTIONS' },
  { label: 'Livestream', section: 'livestream', screen: 'AdminLivestream', feature: (f) => f.livestream },
  { label: 'SMS', section: 'sms', screen: 'AdminSms', feature: (f) => f.smsAutomation },
  { label: 'Community', section: 'community', screen: 'AdminCommunity', feature: (f) => f.communityGroups },
  { label: 'Branding', section: 'branding', screen: 'AdminBranding', feature: (f) => f.customBranding || f.customDomain },
];

/**
 * 🔴 THE CELLS WHERE THE TWO LAYERS DISAGREE ON PURPOSE, and nothing else may
 * join them without an edit here.
 *
 * Each entry is a tab that is VISIBLE in the nav and RENDERS IN FULL on a tier
 * whose named feature cell is false. That is the shape test 18 hunts for, so
 * every deliberate instance has to be written down with its reason — which is
 * the point: an exception a reviewer can read beats an assertion nobody can
 * fail.
 */
const KNOWN_TWO_LAYER_EXCEPTIONS: ReadonlyArray<{ label: string; tiers: TenantPlan[]; why: string }> = [
  {
    label: 'Check-In',
    tiers: ['free', 'plus'],
    why:
      'The tab hosts TWO products. QR Codes is on every tier deliberately (THE-213: gating the QR '
      + 'selector "would change a PRICED tier\'s screen, which the brief forbids"), and the check-in '
      + 'half self-gates inside AdminCheckin and again server-side. So `checkInSystem` describes half '
      + 'this tab, and hiding the whole tab on Individual would take QR from a tier that has it. '
      + 'BOTH layers are ungated here, so they agree with each other — what they disagree with is the '
      + 'one-cell-per-tab assumption, and that is the honest reading. STOP CONDITION 3.',
  },
];

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
  return [...found];
}

async function mountAt(plan: TenantPlan, section: string) {
  store.current = { ...store.current, tenantPlan: plan };
  ctx.current = { ...ctx.current, tenantPlan: plan };
  params.current = section ? { section } : {};
  userQuery.current = {
    data: { role: 'church_admin', permissions: {}, displayName: 'B', email: 'admin@grace.test' },
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

type Cell = 'hidden' | 'visible · upgrade screen' | 'visible · full';
type Resolved = {
  cell: Cell;
  inNav: boolean;
  screen: string | null;
  wall: string | null;
  /** Whether the unknown-tab guard bounced the URL away — a THIRD layer. */
  redirected: boolean;
};

/**
 * Resolve one (tier, tab) cell by running the real component twice: once on the
 * dashboard to read the nav, once on the tab's own URL to read what mounts.
 */
async function resolveCell(plan: TenantPlan, row: Row): Promise<Resolved> {
  await mountAt(plan, '');
  const nav = navLabels();
  const inNav = nav.includes(row.label) || (row.label === 'Church' && nav.includes('Church List'));
  await unmount();

  navigate.mockClear();
  await mountAt(plan, row.section);
  const screen = container.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null;
  const wall = container.querySelector('[data-upgrade-wall]')?.getAttribute('data-upgrade-wall') ?? null;
  // The unknown-tab guard sends an id that is not in `allTabs` back to the
  // first tab. `navigate` is mocked, so the render below is still the tab's own
  // — which is what lets the render layer be observed independently of it.
  const redirected = navigate.mock.calls.some((c) => c[0] === '/admin');
  await unmount();

  const cell: Cell = !inNav ? 'hidden' : screen === row.screen ? 'visible · full' : 'visible · upgrade screen';
  return { cell, inNav, screen, wall, redirected };
}

/** The whole table, resolved once and shared by every assertion below. */
const MATRIX = new Map<string, Map<TenantPlan, Resolved>>();

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

async function buildMatrix() {
  if (MATRIX.size) return MATRIX;
  for (const row of TABS) {
    const byPlan = new Map<TenantPlan, Resolved>();
    for (const plan of PLAN_ORDER) byPlan.set(plan, await resolveCell(plan, row));
    MATRIX.set(row.label, byPlan);
  }
  return MATRIX;
}

// ── 17 ───────────────────────────────────────────────────────────────────────
describe('17 — the tier/tab matrix is generated from the real nav array and the real render switch', () => {
  it('the tier/tab matrix is generated from the real nav array and the real render switch', async () => {
    const matrix = await buildMatrix();

    const header = `| Tab | ${PLAN_ORDER.map((p) => `${PLAN_DISPLAY_NAMES[p]} (\`${p}\`)`).join(' | ')} |`;
    const lines = [header, `| --- | ${PLAN_ORDER.map(() => '---').join(' | ')} |`];
    for (const row of TABS) {
      const cells = PLAN_ORDER.map((p) => matrix.get(row.label)!.get(p)!.cell);
      lines.push(`| ${row.label} | ${cells.join(' | ')} |`);
    }
    const table = lines.join('\n');

    // Printed AND written. The PR body carries a copy; this is where that copy
    // comes from, so it regenerates on every run rather than being retyped.
    // eslint-disable-next-line no-console
    console.log(`\n───── TIER-TAB MATRIX (THE-220, generated) ─────\n${table}\n`);
    const out = join(process.cwd(), 'docs/the-220-tier-tab-matrix.md');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `<!-- Generated by AdminDashboard.tier-tab-matrix.test.tsx. Do not edit by hand. -->\n\n# THE-220 — admin tab matrix, resolved from the code\n\n${table}\n`);

    // Every cell is one of the three values the ticket defines, and the table
    // is complete — no tab silently absent from a tier's column.
    for (const row of TABS) {
      for (const plan of PLAN_ORDER) {
        const resolved = matrix.get(row.label)!.get(plan)!;
        expect(['hidden', 'visible · upgrade screen', 'visible · full'], `${row.label}/${plan}`)
          .toContain(resolved.cell);
      }
    }
    expect(matrix.size).toBe(TABS.length);
  });

  it('resolves the free column to sixteen visible tabs, and Branding hidden', async () => {
    const matrix = await buildMatrix();
    const visible = TABS.filter((r) => matrix.get(r.label)!.get('free')!.cell !== 'hidden');
    expect(visible.length, 'free must see all sixteen').toBe(16);
    expect(matrix.get('Branding')!.get('free')!.cell).toBe('hidden');
  });

  it('resolves the Individual column to the seven plus Check-In', async () => {
    const matrix = await buildMatrix();
    const visible = TABS
      .filter((r) => matrix.get(r.label)!.get('plus')!.cell !== 'hidden')
      .map((r) => r.label);
    expect(visible.sort()).toEqual(
      ['Blog', 'CRM', 'Check-In', 'Church', 'Courses', 'Dashboard', 'Fundraising', 'SMS'],
    );
    // And every one of them is FULL — an Individual tenant meets no wall on a
    // tab it can see. That is the product promise the nav gate now keeps.
    for (const label of visible) {
      expect(matrix.get(label)!.get('plus')!.cell, `${label} is visible but walled on Individual`)
        .toBe('visible · full');
    }
  });
});

// ── 18 ───────────────────────────────────────────────────────────────────────
describe('18 — no tab is visible in the nav but renders fully without its feature', () => {
  it('no tab is visible in the nav but renders fully without its feature', async () => {
    const matrix = await buildMatrix();
    const offenders: string[] = [];

    for (const row of TABS) {
      if (row.feature === null) continue; // records its reason in `note`
      for (const plan of PLAN_ORDER) {
        const resolved = matrix.get(row.label)!.get(plan)!;
        const hasFeature = row.feature(getPlanFeatures(plan));
        if (resolved.cell === 'visible · full' && !hasFeature) {
          offenders.push(`${row.label}/${plan}`);
        }
      }
    }

    const excused = KNOWN_TWO_LAYER_EXCEPTIONS
      .flatMap((e) => e.tiers.map((t) => `${e.label}/${t}`));
    // 🔴 The exception list is the deliverable, not the pass. A NEW offender —
    // a tab shown to a tier that cannot use it, rendering in full — fails here
    // and has to be either fixed or written into KNOWN_TWO_LAYER_EXCEPTIONS
    // with its reason.
    expect(offenders.sort(), 'a tab renders in full for a tier whose feature cell is false')
      .toEqual([...excused].sort());
    expect(KNOWN_TWO_LAYER_EXCEPTIONS.length, 'the excused list grew').toBe(1);
  });

  it('every excused cell states a reason long enough to be one', () => {
    for (const e of KNOWN_TWO_LAYER_EXCEPTIONS) {
      expect(e.why.length, `${e.label} is excused without a stated reason`).toBeGreaterThan(120);
      expect(e.tiers.length).toBeGreaterThan(0);
    }
  });

  it('and the free tier meets a wall on every tab its cells do not carry', async () => {
    // The other half of the same property: free sees everything, and everything
    // it did not buy refuses. A visible tab that quietly worked on free would be
    // the same defect pointing the other way.
    const matrix = await buildMatrix();
    for (const row of TABS) {
      if (row.feature === null || row.label === 'Check-In') continue;
      const resolved = matrix.get(row.label)!.get('free')!;
      if (resolved.cell === 'hidden') continue;
      const expected = row.feature(getPlanFeatures('free')) ? 'visible · full' : 'visible · upgrade screen';
      expect(resolved.cell, `${row.label} on free`).toBe(expected);
    }
  });
});

// ── 19 ───────────────────────────────────────────────────────────────────────
describe('19 — no tab hidden from the nav renders fully when reached by URL', () => {
  it('no tab hidden from the nav renders fully when reached by URL', async () => {
    const matrix = await buildMatrix();
    const leaks: string[] = [];

    for (const row of TABS) {
      for (const plan of PLAN_ORDER) {
        const resolved = matrix.get(row.label)!.get(plan)!;
        // `cell === 'hidden'` is decided by the NAV. `screen === row.screen`
        // is what the RENDER switch did when the URL was opened anyway. A tab
        // that is both is reachable by typing a path, which is the whole reason
        // the render-time layer was kept.
        if (resolved.cell === 'hidden' && resolved.screen === row.screen) {
          leaks.push(`${row.label}/${plan}`);
        }
      }
    }
    expect(leaks, 'a tab hidden from the nav still rendered in full when reached by URL').toEqual([]);
  });

  it('each hidden tab answers with an upgrade wall that names the feature', async () => {
    const matrix = await buildMatrix();
    let checked = 0;
    for (const row of TABS) {
      for (const plan of PLAN_ORDER) {
        const resolved = matrix.get(row.label)!.get(plan)!;
        if (resolved.cell !== 'hidden') continue;
        expect(resolved.wall, `${row.label}/${plan} refused with no upgrade screen`).not.toBeNull();
        checked += 1;
      }
    }
    // A guard on the guard: if the nav gate ever stopped hiding anything, the
    // loop above would pass by never running. Fifteen cells, and the breakdown
    // is the ticket's own arithmetic — Individual hides eight of the nine plus
    // Branding (9), Small Team hides Events, Accounting, Forms, Community plus
    // Branding (5), free hides Branding alone (1), Ministry hides nothing.
    expect(checked, 'the count of hidden cells moved — check the matrix above').toBe(15);
  });

  it('and a third layer bounces the URL too, so the wall is not the only refusal', async () => {
    // ⚠️ Reported rather than relied on. The unknown-tab guard in AdminDashboard
    // sends a section that is not in `allTabs` back to the first tab, so in the
    // real app a hidden tab is redirected AS WELL AS walled. It is observed here
    // (the router is mocked, so the redirect does not prevent the render being
    // measured above) to record that the two layers are independent.
    const matrix = await buildMatrix();
    const hidden = TABS.flatMap((row) =>
      PLAN_ORDER
        .filter((p) => matrix.get(row.label)!.get(p)!.cell === 'hidden')
        .map((p) => matrix.get(row.label)!.get(p)!));
    expect(hidden.every((r) => r.redirected), 'a hidden section was not bounced by the unknown-tab guard').toBe(true);
  });
});
