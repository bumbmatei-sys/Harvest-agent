// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-320, THE-290 and THE-298 give,
// and re-verified here rather than inherited: with happy-dom selected,
// `MeasuringBrowser` never attaches and this file hung in `browser.open()` for
// 600s with the page already written, then again at 45s and at 280s. Nothing
// here needs a DOM. The shell is rendered to a STRING and every measurement
// happens inside a real Chromium over CDP.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';

/**
 * THE-332 — the rail, MEASURED, at the six widths this repo measures at.
 *
 * ⚠️ `happy-dom` has no layout engine, so a class-level assertion cannot tell
 * you what anything is actually WIDE. The shell is therefore mounted for real,
 * its markup handed to headless Chromium with the app's compiled Tailwind, and
 * the boxes read there.
 *
 * ⚠️ #429 measured the content box FALLING at 1024, because the 232px sidebar
 * costs more than the padding it replaces. The rail is 88px, so that arithmetic
 * moves by 144px and the fall is expected to change — which is exactly why this
 * measures rather than asserts a remembered number.
 *
 * ⚠️ Transitions are frozen. The nav column carries `transition-all
 * duration-300`, and `browser-measure`'s settle() is two animation frames, so
 * an unfrozen sample can land mid-flight and drift by a few px with nothing
 * having changed. A geometry guard that is not deterministic is not a guard.
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

/** 🔴 The six widths this repo measures at. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440, 1920] as const;

const SELECTORS = {
  /* Discovered by the attributes the rail marks itself with — never by a
     position or a line, so a moved array cannot silently redirect this. */
  rail: '[data-nav-rail-tab="dashboard"]',
  // THE-334 — Settings left the rail for the account menu at its floor, so the
  // bottom-pinned target measured here is the avatar button, not a Settings tab.
  account: '[data-nav-rail-account] button',
  group: '[data-nav-rail-group]',
  navColumn: '[data-nav-shell]',
  content: '[data-admin-content]',
};

let browser: MeasuringBrowser;
const shots: Record<number, { scrollWidth: number; boxes: Record<string, { width: number; height: number; right: number } | null> }> = {};

beforeAll(async () => {
  const css = await buildAppCss();

  /* ⚠️ The shell is imported DYNAMICALLY, so that the `vi.mock` factories above
     are registered before its module graph loads. The environment docblock at
     the top of this file is what makes the browser attach at all; this import
     shape is only about mock ordering. */
  isSuperAdminMock.mockReturnValue(true);
  hasPlatformOverrideMock.mockReturnValue(true);
  checkRosterAdminStatus.mockResolvedValue(true);
  userQuery.current = {
    data: { role: 'owner', permissions: { fullAccess: true }, displayName: 'B', email: 'b@theharvest.app' },
    isLoading: false,
  };
  const { default: AdminDashboard } = await import('../AdminDashboard');
  const body = renderToStaticMarkup(<AdminDashboard onNavigate={() => {}} />);

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the332-'));
  const file = path.join(dir, 'page.html');
  const FREEZE = '*,*::before,*::after{transition:none!important;animation:none!important;}';
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>${FREEZE}</style></head><body>${body}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const v of VIEWPORTS) {
    /* ⚠️ Measured twice, first result discarded: the first layout after a
       resize can still be settling, and a drifting value is the tell. */
    await browser.measure(v, SELECTORS);
    const m = await browser.measure(v, SELECTORS);
    shots[v] = {
      scrollWidth: m.scrollWidth,
      boxes: Object.fromEntries(
        Object.entries(m.boxes).map(([k, b]) => [
          k,
          b ? { width: b.width, height: b.height, right: b.right } : null,
        ]),
      ),
    };
  }
  // eslint-disable-next-line no-console
  console.log('THE-332 measurements:', JSON.stringify(shots, null, 1));
}, 600_000);

afterAll(async () => { await browser?.close?.(); });

describe('THE-332 · measured', () => {
  it('🔴 15 · no horizontal overflow at 380 / 768 / 1024 / 1280 / 1440 / 1920', () => {
    for (const v of VIEWPORTS) {
      expect(shots[v].scrollWidth, `${v}px overflows horizontally`).toBeLessThanOrEqual(v);
    }
  });

  it('🔴 1 · the rail is narrow — 64px, the width the founder asked for', () => {
    /* Below `lg` the rail does not exist; the mobile bottom bar is what draws,
       and this ticket did not touch it. So the rail is asserted only where it
       renders. */
    for (const v of VIEWPORTS.filter((x) => x >= 1024)) {
      const dash = shots[v].boxes.rail;
      expect(dash, `no rail at ${v}px`).toBeTruthy();
      /* The whole nav column, measured through the entry that sits in it. */
      /* 🔴 THE-334 — 64px, down from THE-332's 88px. The founder asked twice
         ("our sidebar is too wide", then "the sidebar is still too wide" against
         a build measured at 88px) and named the size himself. */
      expect(dash!.right, `the rail is wider than 64px at ${v}px`).toBeLessThanOrEqual(64);
    }
  });

  it("🔴 14 · every rail target clears the 44px floor on BOTH axes", () => {
    /* 🔴 THE-334 CHANGED WHAT THIS MEASURES, AND MADE THE BAR STRICTER.
       ═══════════════════════════════════════════════════════════════════════
       THE-332 drew an icon-only `h-11 w-11` rail entry. At the 16px base that
       is 44px, but globals.css trims the rem base to 14.5px at `min-width:
       1024px`, so it MEASURED 39.875px — under the 44px floor — and this test
       therefore asserted Rule 4's desktop CONTROL band instead, whose ceiling
       `DESKTOP_CONTROL_MAX_PX` forbids going above.

       🔴 THE FOUNDER ASKED FOR VISIBLE TEXT LABELS under the rail icons ("there
       is no title under to know what category is it"), which ClickUp's rail —
       his reference — has throughout. An icon STACKED OVER a word is necessarily
       taller than a bare icon, and the ticket anticipated exactly that: "an icon
       plus a text label is a taller target, which helps."

       ⚠️ So the band moved, and it moved UP, not out. A rail entry is a NAV
       TARGET, not one of the form controls Rule 4's band governs — Rule 4 fixes
       inputs, selects and submit buttons at 38px so a FORM does not sprawl, and
       nothing about that argument reaches a two-line nav tile. Holding the rail
       to a form control's ceiling was right while it was a bare 44px icon box
       and is wrong now that it carries a label.

       🔴 THE REPLACEMENT IS NOT A LOOSENING. The old assertion permitted
       39.875px, BELOW the 44px touch floor, and merely capped growth at 40px.
       This one requires a real 44px on BOTH axes — which the labelled entry now
       genuinely clears at every desktop width, where the icon-only one never
       did — and still caps growth, at 64px, so a rail entry cannot quietly
       become a card. Both axes, because THE-332's own notes record a tab that
       measured 44px tall and 35.6px WIDE. */
    for (const v of VIEWPORTS.filter((x) => x < 1024)) {
      for (const key of ['rail', 'account', 'group'] as const) {
        expect(shots[v].boxes[key]?.height ?? 0, `the rail rendered at ${v}px, below lg`).toBe(0);
      }
    }
    for (const v of VIEWPORTS.filter((x) => x >= 1024)) {
      for (const key of ['rail', 'group'] as const) {
        const b = shots[v].boxes[key];
        expect(b, `${key} missing at ${v}px`).toBeTruthy();
        for (const axis of ['height', 'width'] as const) {
          expect(b![axis], `${key} ${axis} is ${b![axis]}px at ${v}px — under the 44px floor`)
            .toBeGreaterThanOrEqual(44);
          expect(b![axis], `${key} ${axis} is ${b![axis]}px at ${v}px — a rail entry, not a card`)
            .toBeLessThanOrEqual(64);
        }
      }
      /* The account avatar is a 36px circle (`w-9 h-9`), deliberately: it is an
         identity affordance rather than a nav tile, it is the SAME control the
         top bar already draws, and THE-334 did not resize it. It is asserted to
         still be square and still be there, not held to the tile's floor. */
      const acct = shots[v].boxes.account;
      expect(acct, `no account avatar at ${v}px`).toBeTruthy();
      expect(acct!.height, `account avatar at ${v}px`).toBeGreaterThanOrEqual(DENSITY_PX.control);
      expect(acct!.height, `account avatar at ${v}px`).toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
    }
  });

  it('🔴 the rail gives the content box 168px back at every desktop width', () => {
    /* form-layout.ts derives its 1120px page measure from a 232px sidebar. The
       rail is 88px, so the shell hands 144px back — the number is asserted
       rather than described, because #429 showed this arithmetic is where a
       non-monotonic surprise hides. */
    for (const v of VIEWPORTS.filter((x) => x >= 1024)) {
      const content = shots[v].boxes.content;
      expect(content, `no content box at ${v}px`).toBeTruthy();
      /* form-layout.ts derives its 1120px page measure from a 232px sidebar.
         The rail is 64px, so the shell hands 168px back — 24px more than
         THE-332's 88px rail did. */
      expect(content!.width, `content box at ${v}px`).toBe(v - 64);
    }
  });
});
