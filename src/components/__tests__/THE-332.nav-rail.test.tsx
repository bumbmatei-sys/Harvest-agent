import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { NEWSLETTER_FEATURE_ENABLED } from '../../lib/newsletter-feature';
import { SMS_FEATURE_ENABLED } from '../../lib/sms-feature';

/**
 * THE-332 — THE DESKTOP ADMIN NAV IS A RAIL WITH FLYOUTS, NOT A LIST OF 23.
 *
 * The founder, with seven ClickUp screenshots: "instead of having all of the
 * features in the sidebar, lets put the categories and when hovering over, to
 * appear like in the screenshots attached." Asked whether that meant hover or
 * click, they answered "both". And: "in mobile stays the same for now."
 *
 * ── What these guards are pinned to, and what they are NOT ───────────────────
 * 🔴 NOT LINE NUMBERS. THE-331 pinned `AdminCommunity.tsx:362` and `:491`, then
 * deleting a picker moved the thing at 491 to 311 — so the suite would have
 * measured whatever landed on those lines instead of failing. Every nav surface
 * here is DISCOVERED: the rail entries by their `data-nav-rail-*` attributes,
 * the groups by reading `DESKTOP_NAV_GROUPS` out of the source, and the tab ids
 * by walking the rendered tree. `AdminDashboard.tsx` is ~1,500 lines and its
 * arrays move; a guard that silently measures the wrong thing is worse than one
 * that breaks.
 *
 * 🔴 NOT THE CURRENT BRANCH'S DIFF. #454 is a standing sweep and nothing here
 * asks git what changed.
 *
 * 🔴 NO DATE FIXTURE. Nothing in this file constructs a date, so there is
 * nothing for a clock to expire — #468's `'2026-09-06T10:00'` turned `main` red
 * for everyone with no code change at all.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = join(process.cwd());
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
/** Source with comments and string bodies left alone but comments stripped. */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const TENANT_ID = 'bumb';
const UID = 'user-1';

const navigate = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: {} as { section?: string; itemId?: string } }));
const checkRosterAdminStatus = vi.hoisted(() => vi.fn());
const isSuperAdminMock = vi.hoisted(() => vi.fn(() => false));
const hasPlatformOverrideMock = vi.hoisted(() => vi.fn(() => false));
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
/* THE-334 — the flyout's pinned footer reads the group's recent items, and it
   mounts INSIDE the popup, so opening a flyout now touches React Query. These
   three stubs keep this suite about the NAV: it asserts reachability and
   entitlement, not what the recents list contains. */
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
/* THE-334 — NOT stubbed. Settings left the rail for this menu, so it is now a
   NAV PATH and test 5 walks it for real: a stub would let "settings is
   reachable" pass without anything being reachable. */
vi.mock('../BillingAndPayments', stub);
vi.mock('../GraceWindowBanner', stub);

let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

/** The permission shape of a church admin who is entitled to everything a
 *  TENANT admin can be entitled to — i.e. every tab except the super-admin
 *  surfaces. Deliberately spelled as a full object so a new permission flag
 *  does not silently default this fixture into a smaller nav. */
const FULL_TENANT_PERMS = {
  manageBlog: true, manageCourses: true, manageNewsletter: true, uploadRag: true,
  manageDocs: true, manageCrm: true, manageSignups: true, manageChurches: true,
  manageCommunity: true, manageServices: true, manageFundraising: true,
  manageDonations: true, manageForms: true, manageAccounting: true, manageEvents: true,
  manageCheckin: true, manageSms: true, manageLivestream: true, manageSettings: true,
};

async function mount(opts: { superAdmin?: boolean; perms?: Record<string, boolean>; role?: string } = {}) {
  isSuperAdminMock.mockReturnValue(!!opts.superAdmin);
  hasPlatformOverrideMock.mockReturnValue(!!opts.superAdmin);
  params.current = {};
  userQuery.current = {
    data: {
      role: opts.role ?? 'owner',
      permissions: opts.perms ?? FULL_TENANT_PERMS,
      displayName: 'B',
      email: 'bumb@theharvest.app',
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

/** Every rail entry on screen, discovered by attribute — never by position. */
const railTabs = () =>
  Array.from(container.querySelectorAll('[data-nav-rail-tab]'))
    .map((el) => el.getAttribute('data-nav-rail-tab')!);
const railGroups = () =>
  Array.from(container.querySelectorAll('[data-nav-rail-group]'))
    .map((el) => el.getAttribute('data-nav-rail-group')!);
/** Flyouts render in a portal, so they are looked for in the DOCUMENT. */
const openFlyouts = () =>
  Array.from(document.querySelectorAll('[data-nav-rail-flyout]'))
    .map((el) => el.getAttribute('data-nav-rail-flyout')!);
const flyoutTabs = (label: string) => {
  const panel = document.querySelector(`[data-nav-rail-flyout="${label}"]`);
  if (!panel) return [];
  return Array.from(panel.querySelectorAll('[data-nav-tab]'))
    .map((el) => el.getAttribute('data-nav-tab')!);
};
const groupTrigger = (label: string) =>
  container.querySelector<HTMLElement>(`[data-nav-rail-group="${label}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  store.current = { tenantPlan: 'max', currentTenantId: TENANT_ID, isAuthReady: true };
  currentUser.current = { uid: UID };
  checkRosterAdminStatus.mockResolvedValue(true);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount(); });
  mounted = false;
  container.remove();
});

/* ── The groups, read from the source rather than restated here ─────────────
   If DESKTOP_NAV_GROUPS gains a group, this parses it and every assertion
   below covers it automatically. Restating the four labels as a literal is
   exactly how a nav guard goes stale without going red. */
const DASHBOARD_SRC = read('src/components/AdminDashboard.tsx');
function parsedDesktopGroups(): { label: string; ids: string[] }[] {
  const block = DASHBOARD_SRC.split('const DESKTOP_NAV_GROUPS')[1];
  expect(block, 'DESKTOP_NAV_GROUPS is no longer declared under that name').toBeTruthy();
  const body = block.slice(0, block.indexOf('\n];'));
  const out: { label: string; ids: string[] }[] = [];
  const re = /\{\s*label:\s*'([^']+)',\s*ids:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push({ label: m[1], ids: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]) });
  }
  return out;
}

describe('THE-332 · the desktop nav is a rail with flyouts', () => {
  it('🔴 1 · the desktop sidebar is a narrow rail, not a list of 23 items', async () => {
    await mount({ superAdmin: true });

    /* The rail's own entries: ONE pinned tab plus one trigger per group.
       The DEFECT this replaces rendered every permitted tab at once.

       🔴 THE-334 — one pinned tab, not two. Settings left the rail for the
       account menu pinned at the column's floor, on the founder's instruction
       ("at the bottom of sidebar put the profile picture with its settings…
       remove the settings from the sidebar"). Dashboard is the only direct tab
       left. That Settings is still REACHABLE, and still behind the same
       entitlement, is proved by walking the menu in test 5 — not assumed here. */
    const entries = railTabs().length + railGroups().length;
    const groups = parsedDesktopGroups();
    expect(railGroups().sort()).toEqual(groups.map((g) => g.label).sort());
    expect(
      entries,
      `the rail draws ${entries} entries; it must be the 1 pinned tab plus ${groups.length} groups`,
    ).toBe(1 + groups.length);

    /* 🔴 THE MUTATION THIS CATCHES: render all 23 tabs in the rail and this
       fails, because the rail would then carry a `data-nav-tab` per tab where
       it may only carry the two pinned ones. */
    const everyTabId = new Set(groups.flatMap((g) => g.ids));
    for (const id of railTabs()) {
      expect(everyTabId.has(id), `${id} is a GROUP tab and may not sit in the rail`).toBe(false);
    }

    /* And the column really is narrow. 🔴 THE-334 took it from THE-332's 88px
       — the width the sidebar used when collapsed — down to 64px, because the
       founder asked twice ("our sidebar is too wide", then "the sidebar is
       still too wide" against a build measured at 88px) and named the size
       himself. That is a deliberate override of "invent no width", recorded in
       THE-334's ownership entry rather than slipped in. */
    const shell = container.querySelector('[class*="lg:w-[64px]"]');
    expect(shell, 'the nav column is not at the rail width').toBeTruthy();
    expect(DASHBOARD_SRC).not.toContain('lg:w-64');
  });

  it('🔴 5 · all 23 tabs are still reachable, enumerated by id', async () => {
    await mount({ superAdmin: true });
    const groups = parsedDesktopGroups();

    const reached = new Set<string>(railTabs());
    for (const { label } of groups) {
      const trigger = groupTrigger(label)!;
      await act(async () => { trigger.click(); });
      await flush();
      for (const id of flyoutTabs(label)) reached.add(id);
      await act(async () => { trigger.click(); });
      await flush();
    }

    /* 🔴 THE-334 — SETTINGS IS WALKED, NOT ASSUMED. It left the rail for the
       account menu pinned at the column's floor, so "still reachable" is only
       true if that menu really opens and really navigates. This opens the
       avatar, finds the Settings row, clicks it, and requires the router to be
       sent to the settings URL before `settings` is counted as reached. A stub
       menu, a missing row, or a row wired to nothing all fail here — which is
       the point, because 21 of the 23 tabs are reachable through this nav and
       nothing else. */
    const avatar = container.querySelector<HTMLElement>(
      '[data-nav-rail-account] button[aria-label="My account"]',
    );
    expect(avatar, 'no account avatar is pinned at the rail floor').toBeTruthy();
    await act(async () => { avatar!.click(); });
    await flush();
    const settingsRow = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((b) => b.textContent?.trim() === 'Settings');
    expect(settingsRow, 'the account menu has no Settings row').toBeTruthy();
    navigate.mockClear();
    await act(async () => { settingsRow!.click(); });
    await flush();
    expect(navigate, 'the Settings row navigated nowhere').toHaveBeenCalledWith('/admin/settings');
    reached.add('settings');

    const named = new Set<string>([...groups.flatMap((g) => g.ids), 'dashboard', 'settings']);
    /* 🔵 THE-335 ADDED TWO MORE, on identical terms and for the same reason.
       `newsletter` and `sms` are behind their own master switches now
       (`NEWSLETTER_FEATURE_ENABLED`, `SMS_FEATURE_ENABLED`, both false), so
       neither entry is built even for a super admin, and both ids stay listed in
       BOTH nav arrays so that flipping one constant restores each in both halves
       of the product at once. Derived from the switches rather than hardcoded to
       three, so each id leaves this list in the same motion that turns its
       feature back on — and a FOURTH unreachable id, or one of these becoming
       unreachable for any OTHER reason, still fails here. */
    const behindAKillSwitch = [
      ...(NEWSLETTER_FEATURE_ENABLED ? [] : ['newsletter']),
      ...(SMS_FEATURE_ENABLED ? [] : ['sms']),
      'affiliate',
    ];
    const missing = [...named].filter((id) => !reached.has(id));

    /* 🔴 `affiliate` IS THE ONE ID THAT IS NAMED AND NOT REACHABLE, and that is
       pre-existing and deliberate, not something this rail broke.
       `AFFILIATE_PROGRAM_ENABLED` is `false` in plan-features.ts, so the entry
       is never built even for a super admin; the id stays listed in BOTH nav
       arrays so that flipping one constant restores it in both halves of the
       product at once (AdminDashboard.tsx says exactly this at the gate).
       Asserting a flat "23 reachable" would therefore have been asserting
       something that is not true on `main` — so the claim is made precisely:
       every named tab is reachable EXCEPT the one behind the kill switch, and
       if that switch is ever flipped this test fails and is updated on purpose
       rather than silently passing a smaller nav. */
    expect(missing.sort(), `unreachable from the rail: ${missing.join(', ')}`)
      .toEqual([...behindAKillSwitch].sort());
    expect(read('src/utils/plan-features.ts'))
      .toContain('export const AFFILIATE_PROGRAM_ENABLED = false');

    /* The ticket's "23 tabs" is exactly DESKTOP_NAV_GROUPS' id count; Dashboard
       is pinned OUTSIDE the groups on the rail and Settings sits in the account
       menu at the rail's floor, so the nav reaches 25 destinations in all. 24 of them are reachable today — `affiliate` is
       the kill-switched one. Every reachable id is enumerated below, so hiding
       any of them from every path fails this test and names it. */
    expect(groups.flatMap((g) => g.ids).length, 'DESKTOP_NAV_GROUPS no longer holds 23 tabs').toBe(23);
    expect(named.size).toBe(25);
    // 🔵 THE-335 — the same three ids the assertion above derives, for the same
    // reason: an id behind a master switch is NAMED in the group arrays (so the
    // flip restores it) but is not built, so it cannot be reached.
    expect([...reached].sort())
      .toEqual([...named].filter((id) => !behindAKillSwitch.includes(id)).sort());
  });

  it('🔴 5b · the rail\'s advertised tab model is exactly what its flyout renders', async () => {
    /* 🔴 THE POINT OF THIS TEST. Seven entitlement guards elsewhere read the
       nav from `data-nav-group-tabs` rather than by opening every flyout. That
       attribute is therefore load-bearing, and this is what stops it becoming a
       comfortable lie: it must equal, exactly and in order, the rows the flyout
       actually draws. Drop a tab from the render but leave it advertised — the
       mutation that would otherwise hide a tab from every real path while the
       other guards stayed green — and this fails, naming it. */
    await mount({ superAdmin: true });
    for (const label of railGroups()) {
      const advertised = (container
        .querySelector(`[data-nav-group="${label}"]`)!
        .getAttribute('data-nav-group-tabs') ?? '').split(',').filter(Boolean);
      const trigger = groupTrigger(label)!;
      await act(async () => { trigger.click(); });
      await flush();
      expect(flyoutTabs(label), `${label} advertises a tab set its flyout does not render`)
        .toEqual(advertised);
      await act(async () => { trigger.click(); });
      await flush();
    }
  });

  it('🔴 6 · Dashboard stays pinned and reachable in ONE action', async () => {
    await mount({ superAdmin: true });
    /* One action = the rail button itself navigates. Not "open a flyout, then
       pick a row", which is two.

       🔴 THE-334 — Settings is no longer one of these. It moved into the account
       menu at the rail's floor, which is TWO actions (open the menu, pick the
       row), and that is what the founder asked for. Dashboard is still one. */
    expect(railTabs().sort()).toEqual(['dashboard']);
    for (const id of ['dashboard']) {
      const btn = container.querySelector<HTMLElement>(`[data-nav-rail-tab="${id}"]`)!;
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('🔴 3 · clicking a rail entry opens and PINS its flyout', async () => {
    await mount({ superAdmin: true });
    const label = parsedDesktopGroups()[0].label;
    const trigger = groupTrigger(label)!;

    expect(openFlyouts()).toEqual([]);
    await act(async () => { trigger.click(); });
    await flush();
    expect(openFlyouts(), 'a click did not open the flyout').toContain(label);
    /* PINNED — the primitive marks the trigger, and a pointer leaving does not
       close it. A hover-only flyout would have no pinned state at all. */
    expect(trigger.getAttribute('data-pinned'), 'the click did not pin').toBe('true');
  });

  it('🔴 4 · every flyout item is reachable by keyboard', async () => {
    await mount({ superAdmin: true });
    const groups = parsedDesktopGroups();

    for (const { label } of groups) {
      const trigger = groupTrigger(label)!;
      /* The keyboard path, named: the trigger is a real <button>, so it is in
         the tab order and Enter/Space fire a press — the SAME open reason a
         mouse click produces, which is why keyboard users get the pinned
         flyout rather than a hover-only one they could never open. */
      expect(trigger.tagName, `${label}'s rail trigger is not a button`).toBe('BUTTON');
      expect(trigger.getAttribute('disabled')).toBeNull();
      expect(
        trigger.getAttribute('tabindex'),
        `${label}'s trigger is removed from the tab order`,
      ).not.toBe('-1');

      await act(async () => { trigger.click(); });
      await flush();

      const rows = document.querySelectorAll(`[data-nav-rail-flyout="${label}"] [data-nav-tab]`);
      expect(rows.length, `${label} opened an empty flyout`).toBeGreaterThan(0);
      rows.forEach((r) => {
        /* Each row is a real button too, so Tab reaches it and Enter activates
           it. Nothing here relies on a pointer. */
        expect(r.tagName, 'a flyout row is not a button').toBe('BUTTON');
        expect((r as HTMLElement).getAttribute('tabindex')).not.toBe('-1');
      });

      await act(async () => { trigger.click(); });
      await flush();
    }
  });

  it('🔴 2 · hover is gated: it may not fire below lg, and the gate is a real media query', () => {
    const rail = read('src/components/layout/nav-rail.tsx');
    const code = codeOf(rail);
    /* The gate is three conditions, not just a width: on touch, `:hover` fires
       on TAP and then sticks, so a width-only gate still opens a flyout the
       user cannot dismiss on a hybrid device. */
    expect(code).toContain('(min-width: 1024px)');
    expect(code).toContain('(hover: hover)');
    expect(code).toContain('(pointer: fine)');
    /* 🔴 THE MUTATION: hard-code `openOnHover` to true and this fails, because
       the prop must be fed by the gate rather than by a literal. */
    expect(code).toMatch(/openOnHover=\{\s*hoverEnabled\s*\}/);
    expect(code).not.toMatch(/openOnHover=\{\s*true\s*\}/);
    expect(code).not.toMatch(/openOnHover\s*(?![=])/);
  });

  it('🔴 2b · the gate starts closed, so SSR and a touch device never get hover', async () => {
    /* `useRailHoverEnabled` must default to false and be raised in an effect.
       Defaulting to `matchMedia(...).matches` read during render would both
       break SSR (no matchMedia) and give a touch device one hovering frame. */
    const { useRailHoverEnabled } = await import('../layout/nav-rail');
    expect(typeof useRailHoverEnabled).toBe('function');
    const code = codeOf(read('src/components/layout/nav-rail.tsx'));
    expect(code).toMatch(/useState\(false\)/);
  });

  it('🔴 7 · every permission gate is unchanged — library stays super-admin-only', async () => {
    /* A church admin with EVERY tenant permission still sees no super-admin
       surface, and the group those surfaces live in is omitted whole when it
       resolves to nothing. */
    await mount({ superAdmin: false, perms: FULL_TENANT_PERMS });

    const reached = new Set<string>(railTabs());
    for (const { label } of parsedDesktopGroups()) {
      const trigger = groupTrigger(label);
      if (!trigger) continue; // an omitted group draws no rail entry at all
      await act(async () => { trigger.click(); });
      await flush();
      for (const id of flyoutTabs(label)) reached.add(id);
      await act(async () => { trigger.click(); });
      await flush();
    }

    for (const denied of ['library', 'tenants', 'inbox']) {
      expect(reached.has(denied), `a church admin can reach ${denied}`).toBe(false);
    }
    /* And the gate is still spelled where it always was, rather than having
       been moved into the rail. */
    expect(codeOf(DASHBOARD_SRC)).toMatch(/isSuperAdmin\s*&&\s*\{\s*id:\s*'library'/);
  });

  it("🔴 7b · a group whose tabs are all denied draws NO rail entry", async () => {
    await mount({ superAdmin: false, perms: FULL_TENANT_PERMS });
    for (const label of railGroups()) {
      const trigger = groupTrigger(label)!;
      await act(async () => { trigger.click(); });
      await flush();
      expect(flyoutTabs(label).length, `${label} is in the rail but opens empty`).toBeGreaterThan(0);
      await act(async () => { trigger.click(); });
      await flush();
    }
  });

  it('🔴 11 · no seeded demo data reaches the render', async () => {
    await mount({ superAdmin: true });
    const html = container.innerHTML + document.body.innerHTML;
    /* shadcn's sidebar blocks ship placeholder nav items, fake users and sample
       teams; sidebar-09 in particular ships "Acme Inc", a "shadcn" user at
       m@example.com, and ten invented correspondents. A church seeing "Acme
       Inc" is worse than an empty rail. */
    for (const seed of [
      'Acme', 'shadcn', 'm@example.com', 'Enterprise', 'example.com',
      'Michael Wilson', 'Sarah Brown', 'David Lee', 'Olivia Wilson',
      'Drafts', 'Junk', 'All Inboxes', '/avatars/',
    ]) {
      expect(html.includes(seed), `the render leaks the placeholder "${seed}"`).toBe(false);
    }
    for (const rel of ['src/components/layout/nav-rail.tsx', 'src/components/layout/nav-rail-groups.ts']) {
      const src = read(rel);
      for (const seed of ['Acme', 'shadcn', 'example.com', 'avatars/']) {
        expect(src.includes(seed), `${rel} carries the placeholder "${seed}"`).toBe(false);
      }
    }
  });
});

describe('THE-332 · what this ticket may not disturb', () => {
  it('🔴 8 · the mobile bottom nav is untouched and the More sheet is at its recorded digest', () => {
    /* MORE_GROUPS is the mobile drawer's model. Byte-identity is asserted on
       the ARRAY, read out of the source, so a reordering or a renamed section
       fails here rather than surfacing as a founder bug report.

       🔴 AN ACCEPTED SET, APPENDED TO, NOT ONE VALUE SUBSTITUTED. THE-338
       REPLACED the single literal this held. That works locally and is the
       shape that turned `main` red for everyone once: CI runs against
       `refs/pull/N/merge`, and a merge ref cut before a ticket landed
       legitimately carries the older value. THE-341 converts it to the
       accepted-SET shape the rest of this repo's digest pins use and APPENDS,
       so every earlier value stays accepted and a digest that is NONE of them
       still fails — which is the whole job of this guard.

       🔴 EVERY ENTRY IS A DELIBERATE DRAWER CHANGE, each arriving through a
       founder request, which is exactly the path this guard exists to
       intercept — and it did intercept both:
        • THE-338 — the founder asked the drawer's group names and order to
          match desktop, so mobile's `PLATFORM` and `MORE` groups became
          desktop's single `GROW` and MINISTRY adopted desktop's order.
        • THE-341 — the founder answered THE-338's open question with
          "renames", so `BROADCASTING` became `REACH` and `forms` moved into
          it, on both shells.
       No id moved BETWEEN shells in either. */
    const MORE_GROUPS_ACCEPTED = [
      // THE-338 — the drawer re-cut to mirror desktop's names and order.
      '33f0aaa0e0caef51e1a19f14e526ee0afa919d61f944760afc438bb52cb0651b',
      // 🔴 APPENDED BY THE-341 — BROADCASTING renamed to REACH, `forms` moved in.
      '8b0789543891a489d0de9001ecd2326d248809111c4f1f1baf61b3ebddd4f0bd',
    ];
    const before = readFileSync(join(ROOT, 'src/components/AdminDashboard.tsx'), 'utf8');
    const slice = (src: string) => {
      const i = src.indexOf('const MORE_GROUPS');
      return src.slice(i, src.indexOf('\n];', i));
    };
    const actual = sha256(slice(before));
    expect(
      MORE_GROUPS_ACCEPTED,
      `MORE_GROUPS is at ${actual}, which is none of the accepted values — so an unrecorded change reached the mobile drawer`,
    ).toContain(actual);
  });

  it('🔴 9 · all eight sidebar theme variables map onto Harvest tokens, with no new token', () => {
    const css = read('src/app/globals.css');
    /* Eight names, each mapped to a token this app already had. THE-321
       established the pattern (`--card: var(--surface-raised)`); THE-270 landed
       these. This ticket ADDS NONE and re-asserts them because it is the first
       consumer of the sidebar family. */
    const MAP: Record<string, string> = {
      '--sidebar': 'var(--surface-raised)',
      '--sidebar-foreground': 'var(--text-body)',
      '--sidebar-accent': 'var(--surface-chip)',
      '--sidebar-accent-foreground': 'var(--text-strong)',
      '--sidebar-primary': 'var(--primary)',
      '--sidebar-primary-foreground': 'var(--primary-foreground)',
      '--sidebar-border': 'var(--border-default)',
      '--sidebar-ring': 'var(--ring)',
    };
    for (const [name, value] of Object.entries(MAP)) {
      expect(css, `${name} is not mapped onto an existing token`)
        .toMatch(new RegExp(`${name}\\s*:\\s*${value.replace(/[()]/g, '\\$&')}\\s*;`));
    }
    /* 🔴 THE MUTATION: add a ninth sidebar token — or give one of the eight a
       literal instead of a var() — and this fails. */
    const declared = [...css.matchAll(/^\s*(--sidebar[a-z-]*)\s*:/gm)].map((m) => m[1]);
    const unexpected = declared.filter((n) => !(n in MAP));
    expect(unexpected, `undeclared sidebar token(s): ${unexpected.join(', ')}`).toEqual([]);
  });

  it('🔴 12 · every pre-existing primitive is byte-identical', () => {
    /* The shadcn CLI was never run against this repo: its own --dry-run planned
       12 overwrites (button, input, separator, skeleton, tooltip, breadcrumb,
       dropdown-menu, avatar, switch, label, sheet and SIDEBAR itself) plus a
       phantom `cn` dependency, so the block was installed into a scratch
       project instead and nothing was copied back into src/components/ui. */
    for (const [file, digest] of Object.entries(PRIMITIVE_DIGESTS)) {
      expect(sha256(read(`src/components/ui/${file}`)), `${file} was overwritten`).toBe(digest);
    }
  });

  it('🔴 13 · the flyout is built on the installed primitive, not hand-written markup', () => {
    const code = codeOf(read('src/components/layout/nav-rail.tsx'));
    expect(code).toMatch(/from ['"]@\/components\/ui\/popover['"]/);
    expect(code).toContain('<PopoverTrigger');
    /* 🔴 THE-334 — `<PopoverContent` is gone, and NOT because the markup was
       hand-rolled. It hardcodes its own Positioner (`className="isolate z-50"`,
       no `anchor`, no arrow slot), and `src/components/ui/popover.tsx` is pinned
       BYTE-FOR-BYTE by THE-308's guard, so it cannot be extended to expose them.
       A full-height panel with a real pointer therefore composes the SAME Base
       UI popover one level down. The parts below are the primitive's own — this
       assertion is what keeps that honest, and it is STRICTER than the old one,
       because it names each part rather than trusting one wrapper. */
    for (const part of [
      '<PopoverPrimitive.Portal',
      '<PopoverPrimitive.Positioner',
      '<PopoverPrimitive.Popup',
      '<PopoverPrimitive.Arrow',
      '<PopoverPrimitive.Title',
    ]) {
      expect(code, `${part} is not composed from the installed Base UI popover`).toContain(part);
    }
    expect(code).toMatch(/from ['"]@base-ui\/react\/popover['"]/);
    /* 🔴 A hand-rolled floating div would be the defect. Nothing here may
        position itself. */
    expect(code).not.toMatch(/position:\s*['"]?(?:absolute|fixed)/);
    expect(code).not.toMatch(/createPortal/);
  });

  it('🔴 16 · no colour is hardcoded and no emoji is rendered', () => {
    for (const rel of ['src/components/layout/nav-rail.tsx', 'src/components/layout/nav-rail-groups.ts']) {
      const code = codeOf(read(rel));
      expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], `${rel} hardcodes a colour`).toEqual([]);
      expect(code.match(/\b(?:rgba?|hsla?)\s*\(/g) ?? [], `${rel} hardcodes a colour`).toEqual([]);
      expect(code.match(/\p{Extended_Pictographic}/gu) ?? [], `${rel} renders an emoji`).toEqual([]);
    }
  });

  it('🔴 17 · no fixture in this file is pinned to a date', () => {
    const code = codeOf(read('src/components/__tests__/THE-332.nav-rail.test.tsx'));
    /* 🔴 THE NEEDLE IS BUILT, NOT SPELLED. On its first run this test FAILED ON
       ITSELF — the assertion contained the very literal it was grepping for, so
       a file with no date in it still reported one. That is the same defect
       this series has hit nine times (a guard satisfied by its own text), and
       the fix is to make the needle impossible to write into the source. */
    const DATE_CALL = ['new', 'Date('].join(' ');
    expect(code.match(/\b20\d\d-\d\d-\d\d/g) ?? [], 'this suite pins a date').toEqual([]);
    expect(code.includes(DATE_CALL), 'this suite constructs a date').toBe(false);
  });

  it('🔴 18 · no guard in this PR asserts anything about the current branch\'s diff', () => {
    const self = codeOf(read('src/components/__tests__/THE-332.nav-rail.test.tsx'));
    /* Built, not spelled — same reason as the guard above. */
    const FORBIDDEN = [['git', ' ', 'diff'], ['git', ' ', 'show'], ['rev', '-', 'parse'],
      ['exec', '', 'Sync'], ['merge', '-', 'base']];
    for (const parts of FORBIDDEN) {
      const forbidden = parts.join('');
      expect(self.includes(forbidden), `this suite reaches for "${forbidden}"`).toBe(false);
    }
  });

  it('🔴 19+20 · the files this ticket does not own are byte-identical', () => {
    /* 🔴 `firestore.rules` IS DELIBERATELY ABSENT FROM THIS MAP, and its absence
       is the correct behaviour rather than a gap. THE-325 moved the accepted
       rules digest into `__fixtures__/ownership/` precisely so that ONE file
       carries it — a second copy here would make a legitimate rules change cost
       two edits, and THE-325's own guard fails when any suite writes that
       digest. It is still pinned, by the register, and this ticket records no
       rules entry at all because it changes none. */
    for (const [file, digest] of Object.entries(NOT_OURS)) {
      const accepted = typeof digest === 'string' ? [digest] : digest;
      const actual = sha256(read(file));
      expect(
        accepted,
        `${file} is at ${actual}, which is none of the accepted values - so an unrecorded change reached a file THE-332 does not own`,
      ).toContain(actual);
    }
  });
});

/* ── Recorded digests ───────────────────────────────────────────────────────
   Literals, so a rewrite of the file that produced them cannot also rewrite
   the expectation. */
const PRIMITIVE_DIGESTS: Record<string, string> = {
  'alert.tsx': '126a26b401ab2cd3f3855551d012b5dca7a96b7d6984a921add3ce2d441af4b6',
  'avatar.tsx': '357b2f9aac0192c071cb2ed65cb6e4c8ec01fa02fc15cf50d889b85731b75666',
  'badge.tsx': '968b0403af74a785c9408ca69a677235e49d0c80b2c27fb9858ad421a8778c7d',
  'breadcrumb.tsx': '26f83fc8ed302d710851a71b705f5f8f28c805561c1fb6945370617267c5a4a9',
  'button-group.tsx': 'fe97631e1a07bc0add09503c5032002e37f4c71ef5dd3c7475b856a29848583d',
  'button.tsx': 'd14549ab3ba7a9d5d1f424c2599233bffa0b317121abf3b6efa2fb902d5e2781',
  'calendar.tsx': '0ea3d4bd2cf7b8edef5bd5a724518d94d609b15f2f4f42e489c63f532706e55c',
  'card.tsx': 'd8113cbf964f8d1aadf2649d2944d8bbc6e3cfd49d36746f76868cbc4dde3cfe',
  'chart.tsx': '0060b7708d85a5fffc914dcd1ee4753b5acfe83db7ba634b4cea280bd9f19c8f',
  'checkbox.tsx': '7221fec06ed8f697d03157cec8e668f84fcc6706391f487a90773b7fe4fc762d',
  'collapsible.tsx': 'ead4349ff7b01d696ef89294a81d18ee1d3f732321398896462c834ab9b9e065',
  'command.tsx': 'b80b0f0356add12993366cd4571ceae1416f50035ac189876373d0e5050308c5',
  'context-menu.tsx': '8658b48f25544047357bc809e6f6485d2309e72cf310c521e92430003b0d56a8',
  'dialog.tsx': 'bfd230cea544d2de7650182341e082de92141174da80f6193843e8d71b622e41',
  'dropdown-menu.tsx': '1c1ae4ec02de9778286f84e0d15a1b74cc610c13c5b6a13c1ada2e6770eeb4e1',
  'empty.tsx': 'e65ee3ba54a21ed61e3c50041bb12a6a3fcb215c56611cda6795c23a7bd89f61',
  'field.tsx': '3c2272fd6ca7d1b478a48d9a9b796862541cfe0882b76899dfe1bcad25bd18be',
  'hover-card.tsx': '7e7880883ba91290133e61f8bf1df72547795b8d9f2c13d4a17a51c17540d712',
  'input-group.tsx': '17e76f6e6093754756dd10182f833abf35f1020dc4a8a7ead8c0f9703576870b',
  'input.tsx': 'f7d6ecff9a4d631feeaf401c02bb87e26ddb38131c55d15a43b9290747390847',
  'item.tsx': '3f5ec6eac0a7c2daea3f4403408974ff4bae1e949d328701bcf3a74a4554b6e0',
  'label.tsx': '7f19b8476658d25ff197c84030e58cd7395059d876a54630e025951e474ebdae',
  'pagination.tsx': '0aba86a91ba0a8d99e92846f10b395d0ddc1a8901a4f54418e8802c12fad57c1',
  'popover.tsx': '67aa5f28d07c6b149d9d30d173af78d6640f9bca18138bfb16b98e66973974b9',
  'progress.tsx': '45e33890b5a82744fc27d0928f927c5942c1166e5e27de8f776b29112967d317',
  'radio-group.tsx': '3fcee2611d534df43e2ca0d4db49024c656fc1183dd5ab4eb92f4c5d10bde2f7',
  'resizable.tsx': '379baf7a1de109a1ea14419c99b76fbec1cb4f10d6ee13605b0b2940d615afeb',
  'scroll-area.tsx': '42de3962daca60255bf1d3cd90bd3c038db73a3ed61ecaac6cffc6a153181e4a',
  'select.tsx': 'ca3bd1b370ea67b84632d435c22d8270752fa6013c06c365162af265e4a0e87e',
  'separator.tsx': '75085bd84ff6965e4a356c53a4689799cabf65caa93c0bba064d5a0c6fa78f13',
  'sheet.tsx': '68d13d9826a9b5b28e3d78a0ba632b347ca91b67a3333a38acb6310ade8846d4',
  'sidebar.tsx': '29e33400cfdd00cb499da3615ed2258d75192d2b2a5a5117a84d2db4242ed0bf',
  'skeleton.tsx': '8110bba70d0cb9fe968c0b7bd092ad12258caef40b028b4a87f402bdab907faf',
  'slider.tsx': 'd5f419f7f96a6aaf8c28251ceb58b48518379d8b61a9d7cb3f2dc9e254569290',
  'sonner.tsx': '2ebc0c9ba968858cead2fbf2523dfd9da217715339967025e8c8df94f2131ab9',
  'spinner.tsx': '900f722c961fa6e1c28104809d56831c9056dc69599e49d364cc13a6f33966a3',
  'switch.tsx': 'cabbf7804a4d6768ef62f5c2256fbf39e214372318bb1b3b22d407f808c56249',
  'table.tsx': 'a13f55a7c1406197608f223006cf16f211a257b213362caaef0d2abf3a389c8f',
  'tabs.tsx': '096e3d4b2a99b1eff95d16959f97daaa1747fdb7de6226d6c54b9693e22b3410',
  'textarea.tsx': '58b58d84fc54ba5f4ca46937870c619349fd9eccc4d494250ac7bc73a94e05e9',
  'toggle-group.tsx': 'f7776d68b06148d9742fe4f21df45f931b2a259592192d4bda16a7039f508d15',
  'toggle.tsx': '290d2cd01c768d1e3c894bfebcf9c3d1532191ae7ec1e48da1e405dab0a95c4c',
  'tooltip.tsx': '2cea2294d4947b88d815860f64e0b5e0eb47a59bde47cfd194aac2230c923865',
};
const NOT_OURS: Record<string, string | readonly string[]> = {
  'firestore.indexes.json': '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0',
  'src/app/layout.tsx': 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f',
  /* AN ACCEPTED SET, APPENDED TO, NOT ONE VALUE SUBSTITUTED - the same shape
     and the same reason as the sets below. THE-331 owns the first value. */
  'src/components/AdminCommunity.tsx': [
    '10333c22ed0c6f98d233b9f057f8da260a76f17682451c38c52f694e77fddc7a',
    /* APPENDED BY THE-346 - ONE className token, `-mx-4 lg:mx-0` on the thread
       pane, plus the note explaining it. The founder: the chat input is not wide
       enough. Measured at 380px, the composer pill spanned 316px of 380 because
       AdminDashboard wraps this screen in `p-4` and the thread adds `px-4` of its
       own. The shell padding is deliberately NOT removed - the conversation rail
       has none of its own below `lg` - so the gutter is cancelled for the thread
       pane alone. No nav, tab id, read, write or permission gate moved, which is
       what THE-332 pins this file for. */
    'fedb1e028e2c74d0184411ed651c922a280369c7b549fff8943706b8c03257c9',
  ],
  /* AN ACCEPTED SET, APPENDED TO, NOT ONE VALUE SUBSTITUTED - the same shape and
     the same reason as MORE_GROUPS_ACCEPTED above. CI runs against
     `refs/pull/N/merge`, and a merge ref cut before THE-345 landed legitimately
     carries the older value, so substituting is what turned `main` red for
     everyone once. THE-332's value stays accepted and a digest that is NEITHER
     still fails, which is the whole job of this entry.

     THE-345 legitimately changes AdminEvents.tsx, and it arrives through a
     founder bug report - which is exactly the path this guard exists to
     intercept. Looking at a published event reading "$50 - Registration open":
     "I should not be able to create paid events with stripe disabled. How are we
     gonna know if someone paid or not." The screen now hides both price inputs
     behind `PAID_EVENTS_ENABLED`, quotes no price it cannot collect, and reports
     an uncollected CSV amount as a word rather than a figure. NOTHING THE-332
     OWNS MOVED: this file spells no nav group, no rail entry and no flyout. */
  'src/components/AdminEvents.tsx': [
    // THE-332 - the value this guard was written at.
    'edf9088a9c7aff6b3f5d672207cab0f50c1e1428490b1bee61685f55313dc508',
    // APPENDED BY THE-345 - the paid-event gate.
    '9c9eaabe1d7b5d202d623d4655328332025d425c810e102ad3d49aee775e86b4',
    /* APPENDED BY THE-346 - THREE className strings on the List/Month tab bar
       and the note explaining them. Measured at 380px, TabsList was 32px tall
       while the triggers inside it carried a required 44px tap floor, so the
       active pill hung 6px out of each end of its own container. No nav,
       tab id, read, write or permission gate moved, which is what THE-332 pins
       this file for. */
    '6f645f19cce4f1b074f499fae928c36cc47ecaea0fd58147595aaf0167fe4ef2',
    /* APPENDED BY THE-351 - paid events return, on manual terms: a disclaimer
       above the pricing block, a per-event picker over the church's OWN payment
       links, the ticket-type price un-gated, a payment flag beside each attendee
       and a Confirm control on rows that owe money. NO NAV, TAB ID, READ, WRITE
       OR PERMISSION GATE MOVED, which is what THE-332 pins this file for: the
       Confirm control calls an API route through the shared client module, so
       `firestorePathsOf` on this screen is unchanged and the money is written
       server-side by THE-350's writer. */
    '9ae3b79a3125d1734e6b1b9a9623fbedb40089572865919e132e0b37b72d6e53',
    /* APPENDED BY THE-355 - THREE exact strings, and the word "confirmed" is all
       that moves. The founder's screenshot of his own event page showed each
       attendee as `confirmed` (a badge) AND "Payment not confirmed" (a warning),
       with a Confirm button beside both: one word for two different facts, so an
       admin could not tell what the button would change. The badge is
       REGISTRATION status - the field that gates Check In and has never meant
       money - and it now reads "Registered"; the stat above the list, which
       counts `status === 'confirmed'` and therefore SEATS, is re-labelled in the
       same breath, because "2 Confirmed" over two unpaid seats is the same
       collision one level up. The payment side keeps the word, because "Confirm"
       is the founder's own word for the button and the correct verb for what the
       CHURCH does.

       IT IS A DISPLAY MAP AND NOT A MIGRATION: `status` still stores
       `confirmed`, every query still filters on it, and the Check In control is
       still gated on it. NO NAV, TAB ID, READ, WRITE OR PERMISSION GATE MOVED,
       which is what THE-332 pins this file for - this ticket adds no read and no
       write to this screen at all, so `firestorePathsOf` on it is unchanged. */
    'd0f2f7d652ce08c4e80d46957cf7022559cd7624df97705ce0d66e6d54a6a2e8',
  ],
  'src/components/AdminServices.tsx': '17f508718d3c6b1ad016b9fb6be2c241629421705af4a9c0966b02739eba74ae',
  /* 🔴 AN ACCEPTED SET, APPENDED TO, NOT ONE VALUE SUBSTITUTED — the shape the
     entries above and below already use, and the rule this map states: THE-332's
     own value stays accepted and a digest that is NEITHER still fails.

     THE-357 legitimately changes AdminSms.tsx, on a defect #500 measured and
     deliberately did not sweep: the screen's five Buttons computed 25.38 / 36.25
     / 36.25 / 36.25 / 34.63px above `sm`, every one under Rule 4's 38px floor,
     because `sm:h-auto` let `ui/button.tsx`'s 24/28/32/36px intrinsic sizes
     through. Each now spells Rule 4's own opt-in token instead and measures 40px
     at 768/1024/1280/1440, 44px at 380. NOTHING THE-332 OWNS MOVED: this file
     spells no nav group, no rail entry and no flyout, and this ticket adds no
     read and no write to the screen — five className strings and one named
     import from `layout/form-layout`. */
  'src/components/AdminSms.tsx': [
    // THE-332 — the value this guard was written at.
    'f48ae4b8b6deff201e3767e5812bf7045af632a64c88384e5a91f285c47caab2',
    // APPENDED BY THE-357 — the five SMS controls adopt Rule 4's density token.
    '36dbc419cc5990f1021b81e03dfa33851c62199a54a5052c89511e8e34d43002',
  ],
  /* AN ACCEPTED SET, APPENDED TO, NOT ONE VALUE SUBSTITUTED - the same shape
     and the same reason as the sets above. THE-332's value stays accepted and a
     digest that is NEITHER still fails, which is the whole job of this entry.

     THE-348 legitimately changes UserMessages.tsx, and it arrives through a
     founder bug report on a phone - the path this guard exists to intercept.
     Three items: the chat composer travelled with the page and was half-cut by
     the bottom nav ("put the input text field fixed at the bottom"); the
     paperclip opened a forms-only sheet instead of the menu Community uses
     ("not all that is in community and the same style that we applied"); and a
     member could see the paperclip at all ("The user, non admin should not have
     the paperclip"). NOTHING THE-332 OWNS MOVED: this file spells no nav group,
     no rail entry and no flyout, and MOBILE-IS-UNTOUCHED does not apply to it -
     THE-332 pinned it as a file it does not own, not as one that may not
     change. The member bottom nav IS hidden inside a conversation, but that is
     a term added to a condition in MainApp.tsx, which is not in this map, and
     AdminDashboard's own `data-nav-shell` string is byte-identical. */
  'src/components/UserMessages.tsx': [
    // THE-332 - the value this guard was written at.
    'e6998c91739caf2605538a9f12f14eee034c93cb6668713cd619e925addb8e61',
    // APPENDED BY THE-348 - the fixed composer, the shared attach menu and the
    // admin gate. Measured in Chromium at five widths.
    '60a43ca453f322d7b0a14aa2c574ccfa539259bf4ffc37a4db2cdd7be09a680f',
  ],
};
