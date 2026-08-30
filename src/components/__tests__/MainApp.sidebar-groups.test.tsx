import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import MainApp from '../MainApp';
import { visibleNavGroups } from '../layout/nav-groups';

/**
 * THE-225 — the member's desktop sidebar on a free tenant. One screenshot,
 * three defects:
 *
 *   "Feed with Home and Bible. Community with Home button again. Support with
 *    nothing."
 *
 *  1. 🔴 A GROUP WITH NO ITEMS DREW ITS HEADING. "SUPPORT US" holds Give
 *     (`fundraising`) and the AI assistant (`aiChat`), both false on free, so
 *     the group resolved to `[]` and the sidebar rendered a heading over
 *     nothing. THIS IS THE GENERALISABLE ONE and it is fixed as a rule —
 *     `visibleNavGroups` in layout/nav-groups.ts, shared with the admin
 *     sidebar — not as "hide SUPPORT US on free". The next plan-gated feature
 *     would otherwise orphan the next heading.
 *
 *  2. HOME APPEARED TWICE. THE-205 made Home a derivation (feed → course →
 *     first surviving tab) instead of the `'news'` literal. The FEED group
 *     hoists that tab and subtracted it from FEED's own id list only — correct
 *     while Home could only be one of FEED's tabs. A free tenant that has
 *     adopted no course yet resolves Home to PRAYER, which lives under
 *     COMMUNITY: the sidebar drew it under FEED as "Home" and again under
 *     COMMUNITY, same label, same icon, same `desktop-prayer` id. Every group
 *     now subtracts `homeTabId`.
 *
 *  3. GROUPS THAT SHOULD NOT BE THERE. Reported as "Community and Support", and
 *     one of those two is drift — see `a free member's sidebar` below. SUPPORT
 *     US goes, entirely, on defect 1. COMMUNITY holds PRAYER, which is on every
 *     tier for every member and is not plan-gated at all; it disappears on free
 *     exactly when Prayer is Home and holds Prayer alone otherwise. Taking it
 *     from free would mean taking the prayer wall from free, which is a plan
 *     matrix change, and this ticket changes no feature flag.
 *
 * ⚠️ THE OVERSHOOT IS THE RISK. Three tiers pay for these sidebars. The
 * per-tier no-regression block carries the same weight as the free one.
 *
 * Groups are read from RENDERED OUTPUT by their `data-nav-group` marker and
 * their buttons' visible labels — never from the source array — so a change
 * that keeps the constant and breaks the render fails here.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));

vi.mock('firebase/firestore', () => {
  const ref = () => ({});
  return {
    collection: ref,
    query: () => ({}),
    where: () => ({}),
    orderBy: () => ({}),
    limit: () => ({}),
    doc: ref,
    getDoc: async () => ({ exists: () => false, data: () => ({}) }),
    getDocs: async () => ({ docs: [], forEach: () => {} }),
    getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
    onSnapshot: () => () => {},
    addDoc: async () => ({ id: 'x' }),
    updateDoc: async () => {},
    deleteDoc: async () => {},
    setDoc: async () => {},
    serverTimestamp: () => 'ts',
    arrayUnion: (v: unknown) => v,
    arrayRemove: (v: unknown) => v,
    Timestamp: class {},
  };
});

// Whether the tenant has a member-visible course decides the Courses tab, and
// therefore what Home falls back to. Both answers matter here: the founder's
// screenshot is the `false` one.
const courses = vi.hoisted(() => ({ present: true }));
vi.mock('../../utils/member-courses', () => ({
  hasMemberVisibleCourses: async () => courses.present,
}));

const stub = vi.hoisted(() => (name: string) => ({ default: () => <div data-testid={name} /> }));
vi.mock('../Profile', () => stub('profile'));
vi.mock('../PartnerWithUsTab', () => stub('partner'));
vi.mock('../BlogTab', () => stub('blog'));
vi.mock('../NewsTab', () => stub('news-tab'));
vi.mock('../AllNews', () => stub('all-news'));
vi.mock('../PrayerWall', () => stub('prayer-wall'));
vi.mock('../AIChat', () => stub('chat'));
vi.mock('../UserMessages', () => stub('user-messages'));
vi.mock('../BiblePage', () => stub('bible'));
vi.mock('../ReferralTracker', () => stub('referral'));
vi.mock('../LiveNowBanner', () => stub('live-banner'));
vi.mock('../LivestreamView', () => stub('livestream'));
vi.mock('../ChurchMap', () => stub('map'));
vi.mock('../../components/CoursePage', () => stub('courses-screen'));

vi.mock('../ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../layout/DesktopLayout', () => ({
  DesktopContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="dynamic" /> }));
vi.mock('framer-motion', () => {
  const passthrough = new Proxy(
    {},
    { get: () => ({ children, ...rest }: any) => <div {...{ className: rest.className }}>{children}</div> },
  );
  return { motion: passthrough, AnimatePresence: ({ children }: any) => <>{children}</> };
});

const store = vi.hoisted(() => ({ tenantPlan: 'plus' as string | null, currentUser: null as any }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store }));

const tenant = vi.hoisted(() => ({
  tenantId: 'tenant-1',
  tenantName: 'Grace Chapel',
  branding: null as any,
  tenantPlan: 'plus' as string | null,
  isLoading: false,
  // THE-246 — a paying church still needs a PAYMENT RAIL for the Give tab to
  // exist: `fundraising` says it may take gifts, a connected Stripe account or
  // a payment link says it can. Set to a live account here because these
  // assertions are about a different gate entirely, and a tenant with no rails
  // would lose Give for a reason this file is not testing. The rails gate has
  // its own suite: MainApp.giving-rails.test.tsx.
  stripeConnectStatus: 'active' as string | undefined,
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => tenant }));

let container: HTMLDivElement;
let root: Root;

async function mount(plan: string | null, opts: { hasCourse?: boolean } = {}) {
  store.tenantPlan = plan;
  tenant.tenantPlan = plan;
  tenant.isLoading = false;
  courses.present = opts.hasCourse ?? true;
  await act(async () => {
    root = createRoot(container);
    root.render(<MainApp onNavigate={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

async function remount(plan: string | null, opts: { hasCourse?: boolean } = {}) {
  await act(async () => { root?.unmount(); });
  container.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  await mount(plan, opts);
}

/**
 * Every desktop sidebar group the shell actually DREW, in document order, with
 * the visible label of each nav button under it. Found by the `data-nav-group`
 * marker, so a group that renders with no items is VISIBLE HERE as `items: []`
 * rather than silently indistinguishable from one that did not render.
 */
function sidebarGroups(): { label: string; items: string[] }[] {
  return Array.from(container.querySelectorAll('[data-nav-group]')).map((el) => ({
    label: el.getAttribute('data-nav-group') || '',
    items: Array.from(el.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
  }));
}

const groupLabels = () => sidebarGroups().map((g) => g.label);
const groupNamed = (label: string) => sidebarGroups().find((g) => g.label === label);
/** Every sidebar entry on screen, across every group. */
const allSidebarItems = () => sidebarGroups().flatMap((g) => g.items);

const PRICED = ['plus', 'pro', 'max'] as const;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

// ─── 1. 🔴 the general rule ──────────────────────────────────────────────────
describe('a sidebar group with no visible items does not render', () => {
  it('drops an empty group and keeps the rest, in order — the rule itself', () => {
    // The rule, alone, with no tier and no feature anywhere near it. It counts.
    const groups = [
      { label: 'FEED', items: ['Home'] },
      { label: 'COMMUNITY', items: [] as string[] },
      { label: 'SUPPORT US', items: ['Give', 'Ask'] },
    ];

    expect(visibleNavGroups(groups).map((g) => g.label)).toEqual(['FEED', 'SUPPORT US']);
    // Order preserved, items untouched, and a group holding ONE item survives —
    // the rule is about emptiness and nothing else.
    expect(visibleNavGroups(groups)[0]).toBe(groups[0]);
    expect(visibleNavGroups([{ label: 'ONLY', items: [] as string[] }])).toEqual([]);
    expect(visibleNavGroups([{ label: 'ONLY', items: ['x'] }]).map((g) => g.label)).toEqual(['ONLY']);
  });

  it('🔴 free draws no SUPPORT US heading — the founder\'s "Support with nothing"', async () => {
    await mount('free', { hasCourse: true });

    expect(groupLabels(), 'the SUPPORT US heading survived with nothing under it')
      .not.toContain('SUPPORT US');
    // And the two entries that would have filled it really are absent, so the
    // group is empty rather than merely unlabelled.
    expect(allSidebarItems()).not.toContain('Give');
  });

  it('🔴 renders no heading over an empty list, on any tier and either course state', async () => {
    // The general claim, swept: whatever a tier's gates leave behind, every
    // heading the sidebar draws has something underneath it.
    for (const plan of ['free', ...PRICED] as const) {
      for (const hasCourse of [true, false]) {
        await remount(plan, { hasCourse });
        for (const group of sidebarGroups()) {
          expect(group.items.length, `${plan} (course: ${hasCourse}) drew an empty "${group.label}" heading`)
            .toBeGreaterThan(0);
        }
        // Not vacuous — the sidebar drew something on every tier.
        expect(sidebarGroups().length, `${plan} rendered no sidebar at all`).toBeGreaterThan(0);
      }
    }
  });

  it('both grouped sidebars obtain their groups from the one shared rule', () => {
    // A second inline copy of `items.length === 0` is how the two sidebars
    // drifted apart in the first place — the admin one had the rule and the
    // member one did not.
    for (const file of ['src/components/MainApp.tsx', 'src/components/AdminDashboard.tsx']) {
      const src = read(file);
      expect(src, `${file} no longer imports the shared emptiness rule`)
        .toMatch(/import \{ visibleNavGroups \} from '\.\/layout\/nav-groups'/);
      expect(src, `${file} does not run its groups through the rule`).toContain('visibleNavGroups(');
    }
  });
});

// ─── 2. Home, exactly once ───────────────────────────────────────────────────
describe('Home appears in exactly one group, on every tier', () => {
  for (const plan of ['free', ...PRICED] as const) {
    for (const hasCourse of [true, false]) {
      it(`${plan} (course: ${hasCourse}) lists Home once and only once`, async () => {
        await mount(plan, { hasCourse });

        const homes = allSidebarItems().filter((label) => label === 'Home');
        expect(homes, `${plan} rendered ${homes.length} Home entries in its sidebar`).toHaveLength(1);
      });
    }
  }

  it("🔴 free with no course yet: Home is Prayer, and it is NOT drawn again under COMMUNITY", async () => {
    // The founder's exact screenshot. `homeTabId` falls through feed → course →
    // first surviving tab, which on a free tenant with nothing adopted is
    // Prayer — a COMMUNITY tab. It is hoisted to FEED as "Home" and must not
    // also appear in the group it came from.
    await mount('free', { hasCourse: false });

    expect(groupNamed('FEED')?.items).toEqual(['Home', 'Bible']);
    expect(groupLabels(), 'COMMUNITY rendered holding only the duplicated Home')
      .not.toContain('COMMUNITY');
    expect(allSidebarItems(), 'the Prayer entry was drawn beside its own Home alias')
      .not.toContain('Prayer');
  });

  it('Home is still the FEED entry, first, on every tier that has a feed', async () => {
    for (const plan of PRICED) {
      await remount(plan, { hasCourse: true });
      expect(groupNamed('FEED')?.items[0], `${plan} lost Home from the top of FEED`).toBe('Home');
    }
  });
});

// ─── 3. what a free member's sidebar holds ───────────────────────────────────
describe("a free member's sidebar", () => {
  it('🔴 has no SUPPORT US group, with or without a course', async () => {
    for (const hasCourse of [true, false]) {
      await remount('free', { hasCourse });
      expect(groupLabels(), `free drew SUPPORT US (course: ${hasCourse})`).not.toContain('SUPPORT US');
    }
  });

  it('has no COMMUNITY group when Prayer is its Home', async () => {
    await mount('free', { hasCourse: false });
    expect(groupLabels()).toEqual(['FEED']);
  });

  it('⚠️ DRIFT — keeps COMMUNITY, holding Prayer alone, once a course exists', async () => {
    // Reported as "Community and Support" being groups free should not have.
    // Support is right and is gone. Community is not: it holds PRAYER, which
    // `topTabs` gives to "all plans, all users" and which no plan cell gates.
    // Removing the group on free would mean removing the prayer wall from free
    // — a plan matrix change, and this ticket changes no feature flag. So the
    // group is left to the general rule, which keeps it precisely because it is
    // not empty. Messages (`communityGroups`) and Map (`map`) stay gated off.
    await mount('free', { hasCourse: true });

    expect(groupNamed('COMMUNITY')?.items).toEqual(['Prayer']);
    expect(allSidebarItems()).not.toContain('Messages');
    expect(allSidebarItems()).not.toContain('Map');
  });

  it('reads exactly FEED[Home, Bible] + COMMUNITY[Prayer] with a course adopted', async () => {
    await mount('free', { hasCourse: true });

    expect(sidebarGroups()).toEqual([
      { label: 'FEED', items: ['Home', 'Bible'] },
      { label: 'COMMUNITY', items: ['Prayer'] },
    ]);
  });
});

// ─── 4. 🔴 the three priced tiers are unchanged ──────────────────────────────
describe("the three priced tiers' member sidebars are unchanged", () => {
  // The shape each paying tier has, pinned per tier. Chat is branded
  // "Ask {first word of the ministry name}" on desktop, so the test tenant
  // "Grace Chapel" would read "Ask Grace".
  //
  // ⚠️ 'Ask Grace' WAS ON pro AND max AND IS ON NEITHER NOW. THE-253 took
  // `aiChat` off every tier — it is the AI Assistant add-on — and these mounts
  // hold no add-ons, so no priced tier draws the entry. It comes back for any
  // tier that holds one: `MainApp` gates on `getEffectiveFeatures`, which is
  // covered by MainApp.ai-chat-addon.test.tsx. Nothing else in these three
  // sidebars moved, which is what the rest of this block still proves.
  const EXPECTED: Record<(typeof PRICED)[number], { label: string; items: string[] }[]> = {
    // Individual — feed, blog, courses, bible; prayer; give. No AI chat, no map,
    // no Community Groups.
    plus: [
      { label: 'FEED', items: ['Home', 'Blog', 'Courses', 'Bible'] },
      { label: 'COMMUNITY', items: ['Prayer'] },
      { label: 'SUPPORT US', items: ['Give'] },
    ],
    // Small Team — adds the map. (No AI chat: that is the add-on.)
    pro: [
      { label: 'FEED', items: ['Home', 'Blog', 'Courses', 'Bible'] },
      { label: 'COMMUNITY', items: ['Prayer', 'Map'] },
      { label: 'SUPPORT US', items: ['Give'] },
    ],
    // Ministry — adds Community Groups (Messages).
    max: [
      { label: 'FEED', items: ['Home', 'Blog', 'Courses', 'Bible'] },
      { label: 'COMMUNITY', items: ['Messages', 'Prayer', 'Map'] },
      { label: 'SUPPORT US', items: ['Give'] },
    ],
  };

  for (const plan of PRICED) {
    it(`${plan}'s sidebar reads exactly as it did`, async () => {
      await mount(plan, { hasCourse: true });
      expect(sidebarGroups()).toEqual(EXPECTED[plan]);
    });

    it(`${plan} keeps all three headings`, async () => {
      await mount(plan, { hasCourse: true });
      expect(groupLabels()).toEqual(['FEED', 'COMMUNITY', 'SUPPORT US']);
    });
  }

  it('a priced tier with no course yet loses only the Courses entry', async () => {
    // The emptiness rule must not reach a paying tier through the back door of
    // an empty course library.
    await mount('pro', { hasCourse: false });

    expect(sidebarGroups()).toEqual([
      { label: 'FEED', items: ['Home', 'Blog', 'Bible'] },
      { label: 'COMMUNITY', items: ['Prayer', 'Map'] },
      { label: 'SUPPORT US', items: ['Give'] },
    ]);
  });
});
