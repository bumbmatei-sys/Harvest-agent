// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, and this is not inherited politeness — THE-338 hit
// exactly this: with a DOM environment selected `MeasuringBrowser` never
// attaches, because a request to the browser's own debugger port fails
// same-origin under happy-dom's browser semantics, and the file hangs in
// `browser.open()` with the page already written. Nothing here needs a DOM.
// The shell is rendered to a STRING and every box is read inside a real
// Chromium over CDP.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';

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

/**
 * The flyout row's class list, DISCOVERED from the source.
 *
 * 🔴 Anchored on `data-nav-tab`, the attribute every flyout row carries, then
 * walking BACK to the nearest `className={\`` and taking the literal prefix up
 * to the first interpolation — the part that does the sizing. Never a line
 * number: `AdminDashboard.tsx` is ~1,830 lines and its regions move, and
 * THE-331's guard came to measure whatever had shifted into `:491` exactly this
 * way.
 */
function rowClassFromSource(): string {
  const src = read('src/components/AdminDashboard.tsx');
  const at = src.indexOf('data-nav-tab={tab.id}');
  expect(at, 'the flyout row no longer carries data-nav-tab').toBeGreaterThan(-1);
  const before = src.slice(0, at);
  const open = before.lastIndexOf('className={`');
  expect(open, 'the flyout row has no template className to read').toBeGreaterThan(-1);
  const after = before.slice(open + 'className={`'.length);
  const stop = after.indexOf('${');
  expect(stop, 'the row className has no static prefix to measure').toBeGreaterThan(0);
  const cls = after.slice(0, stop).trim();
  expect(cls, 'the row class prefix read empty').toMatch(/lg:h-11/);
  return cls;
}

let shell: MeasuringBrowser;
let panel: MeasuringBrowser;
const railShots: Record<number, { entry: { width: number; height: number } | null }> = {};
const rowShots: Record<number, { row: { width: number; height: number } | null }> = {};

beforeAll(async () => {
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

  /* ── Page 2: the panel's rows, from the product's own class ─────────────── */
  const rowClass = rowClassFromSource();
  /* Five rows, because REACH holds five ids after this ticket. The LAST one is
     what is measured, so a row that collapses under its siblings is caught. */
  const rows = ['Events', 'Check-In', 'Forms', 'SMS', 'Livestream']
    .map((label, i) =>
      `<button data-row="${i}" class="${rowClass}"><span class="text-[13px] font-medium truncate">${label}</span></button>`)
    .join('');
  const panelBody = `<div class="flex h-[100dvh]"><div class="w-[88px] shrink-0"></div>` +
    `<div class="w-[280px] flex flex-col"><div class="flex flex-col gap-0.5 p-2">${rows}</div></div></div>`;

  const panelDir = mkdtempSync(path.join(os.tmpdir(), 'the341-panel-'));
  const panelFile = path.join(panelDir, 'panel.html');
  writeFileSync(panelFile, page(panelBody, ' style="margin:0"'));
  panel = new MeasuringBrowser();
  await panel.open(`file://${panelFile}`);

  for (const v of VIEWPORTS) {
    await panel.measure(v, { row: '[data-row="4"]' });
    const m = await panel.measure(v, { row: '[data-row="4"]' });
    const b = m.boxes.row;
    rowShots[v] = { row: b ? { width: b.width, height: b.height } : null };
  }

  // eslint-disable-next-line no-console
  console.log('THE-341 rail entry:', JSON.stringify(railShots), 'rows:', JSON.stringify(rowShots));
}, 600_000);

afterAll(async () => {
  await shell?.close?.();
  await panel?.close?.();
});

describe('THE-341 · the renamed group is a real target', () => {
  it('🔴 the shell renders a rail entry for REACH at every desktop width', () => {
    for (const v of VIEWPORTS.filter((x) => x >= 1024)) {
      expect(railShots[v].entry, `no rail entry for ${GROUP} at ${v}px — the rename orphaned it`)
        .toBeTruthy();
    }
  });

  /** ⚠️ Below `lg` the rail is not on screen — the bottom bar and More sheet
   *  are the mobile shell — so there is no rail target below `sm` to hold to
   *  44px. Asserted as ABSENCE rather than skipped. */
  it('and none below lg, where the mobile shell is what renders', () => {
    for (const v of VIEWPORTS.filter((x) => x < 1024)) {
      expect(railShots[v].entry?.height ?? 0, `the rail rendered at ${v}px, below lg`).toBe(0);
    }
  });

  it("🔴 REACH's rail entry clears 44px on BOTH axes, and stays a rail entry", () => {
    for (const v of VIEWPORTS.filter((x) => x >= 1024)) {
      const b = railShots[v].entry;
      expect(b, `${GROUP} entry missing at ${v}px`).toBeTruthy();
      for (const axis of ['height', 'width'] as const) {
        expect(b![axis], `${GROUP} ${axis} is ${b![axis]}px at ${v}px — under the 44px floor`)
          .toBeGreaterThanOrEqual(44);
        expect(b![axis], `${GROUP} ${axis} is ${b![axis]}px at ${v}px — a rail entry, not a card`)
          .toBeLessThanOrEqual(64);
      }
    }
  });

  it("🔴 REACH's flyout rows clear the row floor on BOTH axes", () => {
    for (const v of VIEWPORTS.filter((x) => x >= 1024)) {
      const b = rowShots[v].row;
      expect(b, `no flyout row measured at ${v}px`).toBeTruthy();
      /* 🔴 THE ROW FLOOR IS THE ONE THE PRODUCT ALREADY SHIPS, MEASURED, NOT A
         NUMBER RETYPED HERE. `lg:h-11` is 2.75rem, and globals.css trims the rem
         base to 14.5px at `min-width: 1024px` — THE-332 measured that same rule
         at 39.875px and recorded it rather than papering over it. Asserting a
         44px floor on this row would fail on `main` for a reason this ticket did
         not cause, which is the "do not assert a floor that does not exist"
         rule. What IS this ticket's business: the row is a real, full-width,
         non-collapsed target, and it did not shrink because a fifth id joined
         the group. */
      expect(b!.height, `a flyout row is ${b!.height}px tall at ${v}px — it collapsed`)
        .toBeGreaterThanOrEqual(38);
      expect(b!.height, `a flyout row is ${b!.height}px tall at ${v}px — it is not a card`)
        .toBeLessThanOrEqual(64);
      expect(b!.width, `a flyout row is ${b!.width}px wide at ${v}px — it did not fill the panel`)
        .toBeGreaterThanOrEqual(44);
    }
  });
});
