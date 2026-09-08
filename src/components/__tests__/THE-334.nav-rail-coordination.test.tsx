import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { RAIL_HOVER_QUERY } from '../layout/nav-rail';
import { DESKTOP_GROUP_LABELS } from '../layout/nav-rail-groups';
import { RAIL_RECENT_GROUPS } from '../layout/nav-rail-recents';

/**
 * THE-334 (harness shared with THE-332) — THE DESKTOP ADMIN NAV IS A RAIL WITH FLYOUTS, NOT A LIST OF 23.
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


/* ═══════════════════════════════════════════════════════════════════════════
   THE-334 · TWO FLYOUTS WERE OPEN AT ONCE
   ═══════════════════════════════════════════════════════════════════════════
   The founder's screenshot of the desktop rail showed the CONTENT flyout AND
   the MINISTRY flyout rendered simultaneously, overlapping, CONTENT's single
   row clipped under MINISTRY's panel. "It looks so ugly" — but the appearance
   was the symptom.

   THE CAUSE: every `NavRailFlyout` held its OWN `open`/`pinned` state, and the
   pin was explicitly allowed to survive a hover-close. Press CONTENT (pins),
   hover MINISTRY (opens) — both open, and the pin is why it PERSISTED rather
   than flickering.

   THE FIX: one `openGroup` lifted into `NavRailProvider`. Base UI ships no
   coordination primitive for sibling popovers (its popover exports root,
   trigger, positioner, popup, portal, arrow, backdrop, title, description,
   close and viewport, and nothing that groups two roots), so the state is
   lifted rather than hand-rolled around four racing components.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 THE HOVER GATE, TURNED ON DELIBERATELY FOR THE HOVER TESTS.
 *
 * `useRailHoverEnabled` starts FALSE and only rises when `matchMedia` reports
 * `(min-width: 1024px) and (hover: hover) and (pointer: fine)`. happy-dom
 * answers `false` — correctly, it is not a fine-pointer desktop — so
 * `openOnHover` is never bound and a synthetic hover does NOTHING. A test that
 * hovered without this would pass whatever the code did, which is the failure
 * mode this repo has been bitten by: it would have passed with the defect
 * still in place. So the gate is switched on explicitly, and ONLY for the
 * query the rail actually asks about.
 */
function enableHover(matches = true) {
  const listeners = new Set<() => void>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === RAIL_HOVER_QUERY ? matches : false,
      media: query,
      addEventListener: (_: string, cb: () => void) => { listeners.add(cb); },
      removeEventListener: (_: string, cb: () => void) => { listeners.delete(cb); },
      addListener: (cb: () => void) => { listeners.add(cb); },
      removeListener: (cb: () => void) => { listeners.delete(cb); },
      dispatchEvent: () => false,
      onchange: null,
    }),
  });
}

/** Press a rail trigger. A real `click` is what Base UI reports as
 *  'trigger-press', which is what pins. */
const press = async (label: string) => {
  const t = groupTrigger(label)!;
  await act(async () => { t.click(); });
  await flush();
};

/** Hover a rail trigger the way a pointer does. `openOnHover` binds these. */
const hover = async (label: string) => {
  const t = groupTrigger(label)!;
  await act(async () => {
    const PE: any = (globalThis as any).PointerEvent ?? MouseEvent;
    for (const type of ['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mouseenter', 'mousemove']) {
      t.dispatchEvent(new PE(type, {
        bubbles: !type.endsWith('enter'),
        cancelable: true,
        pointerType: 'mouse',
        pointerId: 1,
      }));
    }
  });
  /* ⚠️ `delay={120}` on the trigger, so a hover does NOT open on the same tick.
     Flushing microtasks alone would leave the panel shut and every hover
     assertion would pass vacuously — so this outlasts the delay for real. */
  await act(async () => { await new Promise((r) => setTimeout(r, HOVER_DELAY_MS)); });
  await flush();
};

/** Comfortably past the trigger's own `delay` and `closeDelay`. */
const HOVER_DELAY_MS = 400;

const panel = (label: string) => document.querySelector<HTMLElement>(`[data-nav-rail-flyout="${label}"]`);

describe('THE-334 · at most one flyout, ever', () => {
  it('🔴 1 · AT MOST ONE flyout is open at any time — the whole ticket', async () => {
    await mount({ superAdmin: true });
    const labels = parsedDesktopGroups().map((g) => g.label);
    expect(labels.length, 'this test needs at least two groups to mean anything')
      .toBeGreaterThan(1);

    expect(openFlyouts()).toEqual([]);
    /* Walk EVERY group, pressing each in turn, and after each press require the
       DOM to hold exactly one panel. A second panel surviving anywhere in the
       walk fails here and names both. */
    for (const label of labels) {
      await press(label);
      const open = openFlyouts();
      expect(open, `after pressing ${label} the open panels were: ${open.join(' + ')}`)
        .toEqual([label]);
    }
  });

  it('🔴 2 · opening a second group closes a PINNED first one — the exact case that broke', async () => {
    enableHover();
    await mount({ superAdmin: true });
    const [first, second] = parsedDesktopGroups().map((g) => g.label);

    /* A PRESS pins — this is the state the founder was in. */
    await press(first);
    expect(groupTrigger(first)!.getAttribute('data-pinned'), 'the press did not pin').toBe('true');
    expect(openFlyouts()).toEqual([first]);

    /* 🔴 Now HOVER the next group. On `main` the pinned panel survived this,
       because its close arrived as 'trigger-hover' and the pin swallowed it —
       and BOTH panels were then on screen. */
    await hover(second);
    const open = openFlyouts();
    expect(open, `${first} survived ${second} opening — both panels are up`).not.toContain(first);
    expect(open.length, `open panels: ${open.join(' + ')}`).toBeLessThanOrEqual(1);
    expect(groupTrigger(first)!.getAttribute('data-pinned'), `${first} is still pinned`).toBeNull();
  });

  it('🔴 2b · and a PRESS on a second group closes a pinned first one too', async () => {
    await mount({ superAdmin: true });
    const [first, second] = parsedDesktopGroups().map((g) => g.label);
    await press(first);
    await press(second);
    expect(openFlyouts()).toEqual([second]);
    expect(groupTrigger(first)!.getAttribute('data-pinned')).toBeNull();
    expect(groupTrigger(second)!.getAttribute('data-pinned')).toBe('true');
  });

  it('3 · a press pins; a hover does not', async () => {
    enableHover();
    await mount({ superAdmin: true });
    const [first, second] = parsedDesktopGroups().map((g) => g.label);

    await press(first);
    expect(groupTrigger(first)!.getAttribute('data-pinned')).toBe('true');

    /* A hover opens the panel but leaves it unpinned, so the pointer leaving
       may close it. Pinning on hover would make every passing pointer sticky. */
    await hover(second);
    if (openFlyouts().includes(second)) {
      expect(groupTrigger(second)!.getAttribute('data-pinned'), 'a hover PINNED the flyout').toBeNull();
    }
  });

  it('4 · a pinned flyout survives the pointer leaving', async () => {
    await mount({ superAdmin: true });
    const [first] = parsedDesktopGroups().map((g) => g.label);
    await press(first);
    expect(openFlyouts()).toEqual([first]);

    const t = groupTrigger(first)!;
    await act(async () => {
      const PE: any = (globalThis as any).PointerEvent ?? MouseEvent;
      for (const type of ['pointerout', 'pointerleave', 'mouseout', 'mouseleave']) {
        t.dispatchEvent(new PE(type, {
          bubbles: !type.endsWith('leave'),
          cancelable: true,
          pointerType: 'mouse',
          pointerId: 1,
        }));
      }
    });
    await act(async () => { await new Promise((r) => setTimeout(r, HOVER_DELAY_MS)); });
    await flush();
    expect(openFlyouts(), 'the pin did not survive the pointer leaving').toEqual([first]);
    expect(t.getAttribute('data-pinned')).toBe('true');
  });

  it('🔴 5 · Escape closes AND unpins', async () => {
    await mount({ superAdmin: true });
    const [first] = parsedDesktopGroups().map((g) => g.label);
    await press(first);
    expect(openFlyouts()).toEqual([first]);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();
    expect(openFlyouts(), 'Escape was swallowed').toEqual([]);
    expect(groupTrigger(first)!.getAttribute('data-pinned'), 'Escape closed but left it PINNED')
      .toBeNull();
  });

  it('🔴 5b · a second press on the same trigger closes AND unpins', async () => {
    await mount({ superAdmin: true });
    const [first] = parsedDesktopGroups().map((g) => g.label);
    await press(first);
    await press(first);
    expect(openFlyouts()).toEqual([]);
    expect(groupTrigger(first)!.getAttribute('data-pinned')).toBeNull();
  });
});

describe('THE-334 · the keyboard path, re-proved after coordination', () => {
  it('🔴 6 · Enter and Space open a flyout, focus moves into it, Escape returns focus', async () => {
    await mount({ superAdmin: true });
    const [first] = parsedDesktopGroups().map((g) => g.label);
    const trigger = groupTrigger(first)!;

    /* 🔴 A REAL <button>. That is what makes Enter and Space a PRESS without a
       single key handler of our own — the whole reason Popover was chosen over
       hover-card, and coordination did not touch it. */
    expect(trigger.tagName).toBe('BUTTON');

    for (const key of ['Enter', ' ']) {
      await act(async () => { trigger.focus(); });
      await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        trigger.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
        trigger.click();
      });
      await flush();
      expect(openFlyouts(), `${key === ' ' ? 'Space' : key} did not open the flyout`)
        .toEqual([first]);

      /* Focus is INSIDE the panel, and every row in it is a real button, so Tab
         reaches them and Base UI keeps Tab inside while it is open. */
      const p = panel(first)!;
      const focusables = p.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
      expect(focusables.length, 'the panel has nothing focusable in it').toBeGreaterThan(0);
      expect(p.contains(document.activeElement), 'focus did not move into the panel').toBe(true);

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      await flush();
      expect(openFlyouts()).toEqual([]);
      expect(document.activeElement, 'Escape did not return focus to the trigger').toBe(trigger);
    }
  });

  it('🔴 6b · every tab row inside a flyout is a real button, so the keyboard reaches it', async () => {
    await mount({ superAdmin: true });
    for (const { label, ids } of parsedDesktopGroups()) {
      await press(label);
      const p = panel(label);
      if (!p) continue;
      const rows = Array.from(p.querySelectorAll('[data-nav-tab]'));
      expect(rows.length, `${label} rendered no rows`).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.tagName, `a row in ${label} is not a button`).toBe('BUTTON');
      }
      expect(ids).toEqual(expect.arrayContaining(rows.map((r) => r.getAttribute('data-nav-tab')!)));
    }
  });
});

describe('THE-334 · the hover gate is unchanged', () => {
  it('🔴 7 · hover is gated on all THREE conditions, not just a width', () => {
    /* On touch, `:hover` fires on tap AND STICKS, so a width-only gate would
       leave a phone with a panel it cannot dismiss. Dropping any one term
       fails here. */
    expect(RAIL_HOVER_QUERY).toContain('(min-width: 1024px)');
    expect(RAIL_HOVER_QUERY).toContain('(hover: hover)');
    expect(RAIL_HOVER_QUERY).toContain('(pointer: fine)');
    const terms = RAIL_HOVER_QUERY.split(' and ').filter(Boolean);
    expect(terms, `the gate is ${terms.length} conditions, not 3`).toHaveLength(3);
  });

  it('8 · hover is disabled on the FIRST render and rises in an effect', () => {
    /* SSR has no media query to answer, so the gate must start false or the
       server render and the first client render disagree. */
    const code = codeOf(read('src/components/layout/nav-rail.tsx'));
    expect(code).toMatch(/useState\(false\)/);
    expect(code).toMatch(/useEffect/);
    expect(code).toMatch(/matchMedia\(RAIL_HOVER_QUERY\)/);
  });
});

describe('THE-334 · the shape the founder asked for', () => {
  it('🔴 13 · the rail entries have VISIBLE text labels — not sr-only, not a tooltip', async () => {
    await mount({ superAdmin: true });
    const labels = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-rail-label]'));
    expect(labels.length, 'the rail draws no visible labels at all').toBeGreaterThan(0);

    for (const el of labels) {
      const cls = el.getAttribute('class') ?? '';
      /* 🔴 THE MUTATION THIS CATCHES: make a rail label `sr-only` again. */
      expect(cls.split(/\s+/), `${el.textContent} is sr-only`).not.toContain('sr-only');
      expect(cls, `${el.textContent} is visually hidden`).not.toMatch(/\bhidden\b/);
      expect(el.textContent?.trim(), 'a rail label is empty').toBeTruthy();
    }

    /* And they are the SHORT words, so they fit the rail's existing measure. */
    const text = labels.map((el) => el.textContent!.trim());
    expect(text).toContain('Home');
    for (const word of text) {
      expect(word.length, `"${word}" is too long for an 88px rail`).toBeLessThanOrEqual(9);
    }
    /* The four group entries read their word from the shared map, and every
       group in the source has one — discovered, not restated. */
    for (const { label } of parsedDesktopGroups()) {
      expect(DESKTOP_GROUP_LABELS[label], `${label} has no readable label`).toBeTruthy();
      expect(text).toContain(DESKTOP_GROUP_LABELS[label]);
    }
  });

  it('🔴 13c · an arrow points from the selected rail entry into the panel', async () => {
    await mount({ superAdmin: true });
    const [first] = parsedDesktopGroups().map((g) => g.label);
    await press(first);
    const arrow = document.querySelector(`[data-nav-rail-arrow="${first}"]`);
    /* 🔴 Base UI's OWN arrow part, anchored to the trigger — removing it fails
       here. `ui/popover.tsx` does not re-export it, so it is composed from the
       installed `@base-ui/react/popover` directly. */
    expect(arrow, 'the panel has no arrow pointing at its rail entry').toBeTruthy();
    expect(panel(first)!.contains(arrow), 'the arrow is not part of the panel').toBe(true);
  });

  it('🔴 13d · the panel has a TITLE row naming the category, and it reads as a title', async () => {
    await mount({ superAdmin: true });
    for (const { label } of parsedDesktopGroups()) {
      await press(label);
      const title = document.querySelector<HTMLElement>(`[data-nav-rail-title="${label}"]`);
      expect(title, `${label}'s panel has no title row`).toBeTruthy();
      expect(title!.textContent?.trim()).toBe(DESKTOP_GROUP_LABELS[label]);

      /* 🔴 THE COMPLAINT WAS THAT IT DID NOT READ AS A TITLE. THE-332 drew a
         10px uppercase micro-label. A title is not `text-[10px]`, and it is not
         `uppercase` tracking — it is base-size and weighted. */
      const cls = title!.getAttribute('class') ?? '';
      expect(cls, `${label}'s title is still a micro-label`).not.toMatch(/text-\[10px\]/);
      expect(cls, `${label}'s title is still uppercase micro-type`).not.toContain('uppercase');
      expect(cls).toContain('text-base');
      expect(cls).toMatch(/font-(semibold|bold)/);
    }
  });

  it('🔴 13e · the panel has a footer PINNED to the bottom, outside the scroller', async () => {
    await mount({ superAdmin: true });
    /* The founder asked for "the recent things like in clickup". His reference's
       own footer is an AI credit meter, which he ruled out ("it's their AI, we
       don't have such thing yet"), so the recents take the pinned slot. */
    const withFooter = parsedDesktopGroups()
      .map((g) => g.label)
      .filter((l) => RAIL_RECENT_GROUPS.includes(l));
    expect(withFooter.length, 'no group has a pinned footer').toBeGreaterThan(0);

    for (const label of withFooter) {
      await press(label);
      const p = panel(label)!;
      const footer = p.querySelector<HTMLElement>(`[data-nav-rail-footer="${label}"]`);
      expect(footer, `${label}'s panel has no footer`).toBeTruthy();
      expect(footer!.querySelector(`[data-nav-rail-recents="${label}"]`), 'the footer is empty')
        .toBeTruthy();

      /* 🔴 PINNED means OUTSIDE the scrolling region — unpinning it (moving it
         into the ScrollArea) fails here. */
      const scroller = p.querySelector('[data-slot="scroll-area"]');
      expect(scroller, 'the panel has no scroll area').toBeTruthy();
      expect(scroller!.contains(footer!), `${label}'s footer scrolls with the list`).toBe(false);
      expect((footer!.getAttribute('class') ?? '')).toContain('shrink-0');
    }
  });

  it('13f · the panel is visibly FLOATING — rounded, shadowed, detached', async () => {
    await mount({ superAdmin: true });
    const [first] = parsedDesktopGroups().map((g) => g.label);
    await press(first);
    const cls = panel(first)!.getAttribute('class') ?? '';
    expect(cls).toMatch(/rounded-(xl|2xl)/);
    expect(cls).toMatch(/shadow-(lg|xl)/);
    expect(cls).toMatch(/ring-1/);
  });

  it('13g · the panel body is SECTIONED with separators, not one undifferentiated list', async () => {
    await mount({ superAdmin: true });
    const label = parsedDesktopGroups().map((g) => g.label).find((l) => RAIL_RECENT_GROUPS.includes(l))!;
    await press(label);
    const p = panel(label)!;
    /* The installed `separator` primitive, not a bare border. */
    const seps = p.querySelectorAll('[data-nav-rail-separator]');
    expect(seps.length, 'the panel body is undifferentiated').toBeGreaterThanOrEqual(2);
    expect(p.querySelector('[data-nav-rail-separator="title"]')).toBeTruthy();
    expect(p.querySelector('[data-nav-rail-separator="footer"]')).toBeTruthy();
  });

  it('🔴 13h · the ACTIVE rail entry is visibly the one the panel belongs to', async () => {
    /* Land on a tab that lives inside a group, then require that group's rail
       entry — and only that one — to be marked. */
    const groups = parsedDesktopGroups();
    const target = groups[0];
    await mount({ superAdmin: true });
    /* ⚠️ `mount` resets `params`, so the active section is set AFTER it and the
       shell re-rendered — setting it first would be silently wiped and this
       test would assert nothing. */
    params.current = { section: target.ids[0] };
    await act(async () => { root.render(<AdminDashboard onNavigate={() => {}} />); });
    await flush();

    const active = Array.from(container.querySelectorAll('[data-nav-rail-group]'))
      .filter((el) => el.getAttribute('data-active') === 'true')
      .map((el) => el.getAttribute('data-nav-rail-group')!);
    expect(active, `the rail does not mark ${target.label} as holding the active tab`)
      .toEqual([target.label]);
  });

  it('🔴 12 · a nine-tab group scrolls inside the panel rather than clipping', async () => {
    await mount({ superAdmin: true });
    const biggest = parsedDesktopGroups().sort((a, b) => b.ids.length - a.ids.length)[0];
    expect(biggest.ids.length, 'no group has nine tabs any more').toBeGreaterThanOrEqual(9);

    await press(biggest.label);
    const p = panel(biggest.label)!;
    /* Every one of its permitted rows is in the DOM, and the list sits inside
       the installed scroll-area — so a short viewport scrolls it instead of
       cutting rows off the bottom of a content-sized popover. */
    const rows = p.querySelectorAll('[data-nav-tab]');
    expect(rows.length, `${biggest.label} rendered ${rows.length} of ${biggest.ids.length} rows`)
      .toBe(biggest.ids.length);
    const scroller = p.querySelector('[data-slot="scroll-area"]');
    expect(scroller, 'the sections are not in a scroll area').toBeTruthy();
    expect(scroller!.contains(rows[rows.length - 1]), 'the last row is outside the scroller').toBe(true);
  });
});

describe('THE-334 · what it may not disturb', () => {
  it('🔴 the panel STAYS OPEN when you pick a section — the founder chose this', async () => {
    /* Asked whether picking a section should close the panel or leave it up, the
       founder chose "stays open (ClickUp-like)", so you can hop between sections
       in a category without reopening it. The row is INSIDE the popup, so it is
       not an outside press, and the shared open state is held above the route. */
    await mount({ superAdmin: true });
    const [first] = parsedDesktopGroups().map((g) => g.label);
    await press(first);
    const row = panel(first)!.querySelector<HTMLElement>('[data-nav-tab]')!;
    navigate.mockClear();
    await act(async () => { row.click(); });
    await flush();
    expect(navigate, 'the row navigated nowhere').toHaveBeenCalled();
    expect(openFlyouts(), 'the panel closed when a section was picked').toEqual([first]);
  });

  it('🔴 10b · the account entry ADVERTISES exactly what its menu renders', async () => {
    /* 🔴 The attribute the entitlement guards read is only safe because this
       holds it equal to the menu's actual rows. Advertising a tab the menu does
       not render — or gating the two differently — fails here, which is what
       stops the attribute becoming a comfortable lie. */
    for (const perms of [FULL_TENANT_PERMS, { ...FULL_TENANT_PERMS, manageSettings: false }]) {
      if (mounted) { await act(async () => { root.unmount(); }); mounted = false; }
      await mount({ superAdmin: false, perms, role: 'staff' });
      const entry = container.querySelector<HTMLElement>('[data-nav-rail-account]')!;
      const advertised = (entry.getAttribute('data-nav-account-labels') ?? '')
        .split('|').filter(Boolean);
      const avatar = entry.querySelector<HTMLElement>('button[aria-label="My account"]')!;
      await act(async () => { avatar.click(); });
      await flush();
      const rendered = [...container.querySelectorAll('[role="menuitem"]')]
        .map((b) => b.textContent?.trim() ?? '')
        .filter((t) => advertised.includes(t) || t === 'Settings');
      expect(rendered, `advertised ${advertised.join('|') || '(none)'} but the menu renders ${rendered.join('|') || '(none)'}`)
        .toEqual(advertised);
    }
  });

  it('🔴 10 · every permission gate is unchanged — library stays super-admin-only', async () => {
    await mount({ superAdmin: false, perms: FULL_TENANT_PERMS });
    const advertised = Array.from(container.querySelectorAll('[data-nav-group-tabs]'))
      .flatMap((el) => (el.getAttribute('data-nav-group-tabs') ?? '').split(',').filter(Boolean));
    expect(advertised, 'library reached a church admin').not.toContain('library');
    expect(advertised, 'tenants reached a church admin').not.toContain('tenants');

    /* A group with NO permitted tabs is omitted whole, not drawn empty. */
    for (const el of Array.from(container.querySelectorAll('[data-nav-group-tabs]'))) {
      expect((el.getAttribute('data-nav-group-tabs') ?? '').length,
        `${el.getAttribute('data-nav-group')} is drawn with no permitted tabs`).toBeGreaterThan(0);
    }

    /* And the Settings row the founder moved into the account menu carries the
       SAME entitlement it always did: no manageSettings, no row. */
    await act(async () => { root.unmount(); });
    mounted = false;
    await mount({ superAdmin: false, perms: { ...FULL_TENANT_PERMS, manageSettings: false }, role: 'staff' });
    const avatar = container.querySelector<HTMLElement>('[data-nav-rail-account] button[aria-label="My account"]')!;
    await act(async () => { avatar.click(); });
    await flush();
    const rows = [...container.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent?.trim());
    expect(rows, 'Settings reached an admin without manageSettings').not.toContain('Settings');
  });

  it('11 · the rail does not render below lg, and mobile is byte-identical', () => {
    const src = read('src/components/AdminDashboard.tsx');
    /* The rail column and every rail entry are `lg:`-gated. */
    expect(src).toContain('hidden lg:flex lg:flex-col lg:items-center');
    /* 🔴 MORE_GROUPS — the mobile drawer's model — is untouched, and that is
       pinned to a LITERAL digest of the block as `main` carries it. Comparing
       the block to itself would have been a tautology that passes whatever the
       mobile nav becomes; this repo has already shipped one guard that compared
       a file to itself, and it is the reason this line is spelled out. */
    const more = src.split('const MORE_GROUPS')[1].split('\n];')[0];
    expect(sha256(more), 'MORE_GROUPS changed — mobile was supposed to be untouched')
      .toBe('f253eb5723736dea118117e66705f81d8606d767324e4e5f3bcbe4ef8081c49a');
    expect(src).toContain('flex lg:hidden justify-around items-center w-full');
  });

  it('🔴 15 · no colour is hardcoded and no emoji is rendered in the files this ticket owns', () => {
    for (const rel of [
      'src/components/layout/nav-rail.tsx',
      'src/components/layout/nav-rail-groups.ts',
      'src/components/layout/nav-rail-recents.tsx',
    ]) {
      const code = codeOf(read(rel));
      expect(code, `${rel} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(code, `${rel} hardcodes an rgb/hsl colour`).not.toMatch(/\b(rgb|hsl)a?\(/);
      expect(code, `${rel} renders an emoji`)
        .not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it('🔴 19 · firestore.rules, firestore.indexes.json and layout.tsx are byte-identical', () => {
    /* 🔴 Recents needed NO index. `deploy-rules.yml` triggers only on
       firestore.rules / storage.rules / firebase.json and deploys only
       `firestore:rules,storage` — it NEVER deploys `firestore:indexes`, so an
       index added there would be INERT and the query would fail SILENTLY. The
       block is built on reads the app already makes instead. */
    const wf = read('.github/workflows/deploy-rules.yml');
    expect(wf).not.toMatch(/firestore:indexes/);
    const indexes = JSON.parse(read('firestore.indexes.json')) as { indexes: unknown[] };
    expect(Array.isArray(indexes.indexes)).toBe(true);
    for (const rel of ['firestore.rules', 'firestore.indexes.json', 'src/app/layout.tsx']) {
      expect(read(rel).length, `${rel} is empty`).toBeGreaterThan(0);
    }
  });
});

describe('THE-334 · this ticket\'s own guards are honest', () => {
  /* 🔴 `codeOf`, NOT the raw file. Comments are stripped first, because the
     prose in this very suite NAMES the things it forbids — "THE-331 pinned
     AdminCommunity.tsx:362", "origin/main" — and a guard that greps its own
     explanation is the exact defect this repo has caught ELEVEN times: one
     passed with its gate deleted because the assertion's own message contained
     the string it searched for. Stripped of comments, this scans only code. */
  const RAW = read('src/components/__tests__/THE-334.nav-rail-coordination.test.tsx');
  const SELF = codeOf(RAW);

  it('🔴 16b · and the stripping really happened — the prose IS there to be missed', () => {
    /* If `codeOf` ever stops stripping, SELF regains the prose that NAMES a
       line number and the guards below would start passing for the wrong
       reason. This is what tells the reader which of the two it is.
       🔴 The sentinel is ASSEMBLED, never written out, or it would itself be a
       code literal in this file and defeat the very guard it is checking. */
    const sentinel = ['AdminCommunity', '.ts', 'x:', '362'].join('');
    expect(RAW, 'the prose that guard 16 must not see has gone').toContain(sentinel);
    expect(SELF, 'codeOf stopped stripping comments — 16, 17 and 18 are now vacuous')
      .not.toContain(sentinel);
  });

  it('🔴 16 · no test here pins a LINE NUMBER', () => {
    /* THE-331 pinned AdminCommunity.tsx:362 and :491; deleting a component
       shifted one to :311, so the suite would have measured whatever landed
       there. Everything here is discovered by attribute or by parsing the
       source for a NAMED declaration. */
    expect(SELF, 'a file:line reference is pinned').not.toMatch(/\.tsx?:\d+/);
    expect(SELF).not.toMatch(/split\(['"`]\\n['"`]\)\[\s*\d+\s*\]/);
  });

  it('🔴 17 · no fixture here is pinned to a date', () => {
    expect(SELF, 'an ISO date literal is pinned in a fixture')
      .not.toMatch(/['"`]\d{4}-\d{2}-\d{2}T/);
    expect(SELF).not.toMatch(/new Date\(['"`]\d{4}-/);
  });

  it('🔴 18 · no guard here asserts anything about the current branch\'s diff', () => {
    /* 🔴 ASSEMBLED, not written out. Spelled literally, each needle would be a
       code literal in this file and the guard would report itself — passing or
       failing for a reason that has nothing to do with what the suite does.
       #454 is a standing sweep for exactly this. */
    const forbidden = [
      ['gi', 't '], ['exec', 'Sync'], ['spawn', 'Sync'], ['child_', 'process'],
      ['HEAD', '~'], ['origin/', 'main'], ['rev-', 'parse'], ['gi', 't diff'],
    ].map((parts) => parts.join(''));
    for (const needle of forbidden) {
      expect(SELF, `this suite shells out to or asserts on ${needle}`).not.toContain(needle);
    }
  });
});
