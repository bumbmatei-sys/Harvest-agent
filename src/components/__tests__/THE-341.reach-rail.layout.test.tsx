// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, and this is not inherited politeness — THE-338 hit
// exactly this: with a DOM environment selected `MeasuringBrowser` never
// attaches, because a request to the browser's own debugger port fails
// same-origin under happy-dom's browser semantics, and the file hangs in
// `browser.open()` with the page already written. Nothing here needs a DOM.
// The shell is rendered to a STRING and every box is read inside a real
// Chromium over CDP.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';

/**
 * THE-341 — the RENAMED group's rail entry and its flyout rows, MEASURED.
 *
 * ── Why a rename gets a measured guard at all ───────────────────────────────
 * ⚠️ Because the word changed length. The rail entry is an icon STACKED OVER a
 * visible text label inside an 88px column with `px-4` padding — 56px of
 * measure — and THE-334's own note records that `BROADCASTING` needed ~80px at
 * 10px type, which is why the readable word was shortened rather than the rail
 * widened. `REACH` is shorter than `BROADCASTING` and the printed word is
 * unchanged at 'Reach', so the entry is expected to be fine; expected is not
 * measured, and #482 found the CRM switcher missing its target the same way.
 *
 * ⚠️ `happy-dom` has NO layout engine, so a class-level assertion cannot say
 * what anything is actually WIDE.
 *
 * ── What is measured where, and why it is two pages ─────────────────────────
 * 🔴 The rail entry is measured in the REAL SHELL: it is in the SSR string, so
 * it is measured as the product renders it, discovered by
 * `[data-nav-rail-group="REACH"]` — the group's own identity attribute, never a
 * position and never a line.
 *
 * 🔴 The flyout ROWS cannot be. The panel is a Base UI popup inside a PORTAL,
 * which has nothing to attach to on the server and no React runtime in the
 * measured page to click it open — the same wall THE-334's measured suite hit.
 * So the rows are built on a second page from the row class READ OUT OF
 * `AdminDashboard.tsx` BY PATTERN, anchored on the `data-nav-tab` attribute the
 * row carries. Retyping the classes would measure this file instead of the
 * product; if the row's sizing rule changes, the extracted string changes with
 * it and this measures the change.
 *
 * ⚠️ THE FLOOR IS NOT UNIFORM ACROSS WIDTHS, and saying so is the point. Below
 * `lg` the rail and its flyouts DO NOT RENDER AT ALL — the mobile bottom bar
 * and More sheet are the shell there — so there is no rail target below `sm`
 * to hold to 44px, and this asserts their ABSENCE rather than inventing a
 * measurement for something that is not on screen. At and above 1024px the
 * floor THE-334 set for a labelled rail entry is a real 44px on BOTH axes,
 * capped at 64px so an entry cannot quietly become a card.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT_ID = 'bumb';

const navigate = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: {} as { section?: string } }));
const checkRosterAdminStatus = vi.hoisted(() => vi.fn());
const isSuperAdminMock = vi.hoisted(() => vi.fn(() => true));
const hasPlatformOverrideMock = vi.hoisted(() => vi.fn(() => true));
const store = vi.hoisted(() => ({
  current: { tenantPlan: 'max' as string | null, currentTenantId: 'bumb' as string | null, isAuthReady: true },
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
  useTenant: () => ({ data: { name: 'Bumb Ministry', ownerId: 'someone-else' } }),
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
vi.mock('../../utils/firestore-errors', () => ({ OperationType: { GET: 'get' }, handleFirestoreError: () => {} }));
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
vi.mock('../AdminDonations', stub);
vi.mock('../AdminCRM', stub);
vi.mock('../AdminSignups', stub);
vi.mock('../AdminDocs', stub);
vi.mock('../AdminCommunity', stub);
vi.mock('../AdminAccounting', stub);
vi.mock('../AdminForms', stub);
vi.mock('../AdminCheckin', stub);
vi.mock('../AdminLivestream', stub);
vi.mock('../AdminSms', stub);
vi.mock('../AdminEvents', stub);
vi.mock('../AdminServices', stub);
vi.mock('../PlanUpgradeScreen', stub);
vi.mock('../Profile', stub);
/* THE-334 — NOT stubbed any more. The account avatar is now a RAIL TARGET,
   pinned at the column's floor where the founder asked for it, so a stub that
   renders null would measure the rail's bottom entry as absent. The component
   imports nothing but React and lucide, so rendering it for real costs the
   measurement nothing. */
vi.mock('../BillingAndPayments', stub);
vi.mock('../GraceWindowBanner', stub);

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** 🔴 The six widths this repo measures at. Width is not monotonic. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440, 1920] as const;

/** The group this ticket renamed. Everything below is anchored on it. */
const GROUP = 'REACH';

let shell: MeasuringBrowser;
const railShots: Record<number, { entry: { width: number; height: number } | null }> = {};

setUpOrFail(async () => {
  const css = await buildAppCss();
  const FREEZE = '*,*::before,*::after{transition:none!important;animation:none!important;}';
  const page = (body: string, bodyStyle = '') =>
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>${FREEZE}</style></head><body${bodyStyle}>${body}</body></html>`;

  /* ── Page 1: the real shell, for the rail entry ─────────────────────────── */
  isSuperAdminMock.mockReturnValue(true);
  hasPlatformOverrideMock.mockReturnValue(true);
  checkRosterAdminStatus.mockResolvedValue(true);
  userQuery.current = {
    data: { role: 'owner', permissions: { fullAccess: true }, displayName: 'B', email: 'b@theharvest.app' },
    isLoading: false,
  };
  /* ⚠️ Imported DYNAMICALLY so the `vi.mock` factories above are registered
     before the shell's module graph loads. */
  const { default: AdminDashboard } = await import('../AdminDashboard');
  const shellBody = renderToStaticMarkup(<AdminDashboard onNavigate={() => {}} />);

  const shellDir = mkdtempSync(path.join(os.tmpdir(), 'the341-shell-'));
  const shellFile = path.join(shellDir, 'shell.html');
  writeFileSync(shellFile, page(shellBody));
  shell = new MeasuringBrowser();
  await shell.open(`file://${shellFile}`);

  for (const v of VIEWPORTS) {
    /* ⚠️ Measured twice, the first result discarded: the first layout after a
       resize can still be settling, and a drifting value is the tell. */
    await shell.measure(v, { entry: `[data-nav-rail-group="${GROUP}"]` });
    const m = await shell.measure(v, { entry: `[data-nav-rail-group="${GROUP}"]` });
    const b = m.boxes.entry;
    railShots[v] = { entry: b ? { width: b.width, height: b.height } : null };
  }

  // eslint-disable-next-line no-console
  console.log('THE-341 rail entry:', JSON.stringify(railShots));
}, 600_000);

afterAll(async () => {
  await shell?.close?.();
});

describe('THE-341 · the hover rail is gone from the shell', () => {
  it('the REACH rail entry is absent at every width, including desktop', () => {
    for (const v of VIEWPORTS) {
      expect(railShots[v].entry?.height ?? 0, `the hover rail rendered at ${v}px`).toBe(0);
    }
  });

  it('AdminDashboard no longer renders the flyout row this suite used to measure', () => {
    const src = read('src/components/AdminDashboard.tsx');
    expect(src, 'the flyout row is back in the shell').not.toContain('data-nav-tab={tab.id}');
    expect(src, 'the mobile More sheet left').toContain('lg:hidden');
  });
});
