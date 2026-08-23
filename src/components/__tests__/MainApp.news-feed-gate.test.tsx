import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MainApp from '../MainApp';
import { getPlanFeatures, PLAN_ORDER } from '../../utils/plan-features';

/**
 * THE-205 — the news feed is on the free tier, which is discipleship only.
 *
 * The founder, having seen the live card: "Literally the only thing is
 * discipleship, the discipleship page for the user and for admin." Free had the
 * feed because the feed had no gate at all — `{ id: 'news', label: 'News' }` was
 * an unconditional literal in MainApp's `topTabs`, exactly the shape Messages
 * carried before THE-162 — so `newsFeed` is a NEW matrix cell, not a flag that
 * was set wrong.
 *
 * 🔴 THREE PRODUCTS SHARE THE WORD "COMMUNITY" AND ONLY ONE MOVES:
 *
 *   news feed        → NewsTab / AllNews → /community_posts. THIS. Free only.
 *   Community Groups → UserMessages → tenants/{t}/{channels,directMessages,…}.
 *                      `communityGroups`, Ministry only. PR 332 drew this line
 *                      explicitly and named the feed as a surface its fix must
 *                      NOT take with it. Untouched — section 3 proves it.
 *   blog             → BlogTab → /blog_posts. `blog`, Individual and above.
 *                      Untouched — section 3 proves it.
 *
 * ⚠️ THE OVERSHOOT IS THE RISK, exactly as in THE-162. Three tiers pay for this
 * feed. The no-regression tests in section 2 carry the same weight as the free
 * ones in section 1.
 *
 * 🔴 AND THE FEED WAS HOME. `topTabs[0]` was the feed and the desktop sidebar's
 * "Home" entry is an alias of that tab, so removing it without moving Home
 * lands a free member on a tab that is not there — a blank screen, which the
 * brief calls worse than the feature being absent. Section 4 is that half of
 * the fix: a free member lands on their COURSE.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));

/**
 * Every Firestore verb AND every collection path touched is recorded, so
 * "the feed is gated" can be asserted as the ABSENCE of a /community_posts read
 * rather than as the absence of a rendered node. A hidden nav item that still
 * opens the listener is the THE-193 defect this exists to catch.
 */
const fx = vi.hoisted(() => ({ mutations: [] as string[], paths: [] as string[] }));

vi.mock('firebase/firestore', () => {
  const track = (seg: string[]) => { fx.paths.push(seg.join('/')); return { __path: seg.join('/') }; };
  return {
    collection: (_db: unknown, ...seg: string[]) => track(seg),
    query: (col: any, ...args: unknown[]) => ({ __path: col?.__path, args }),
    where: () => ({}),
    orderBy: () => ({}),
    limit: () => ({}),
    doc: (_db: unknown, ...seg: string[]) => track(seg),
    getDoc: async () => ({ exists: () => false, data: () => ({}) }),
    getDocs: async () => ({ docs: [], forEach: () => {} }),
    getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
    onSnapshot: () => () => {},
    addDoc: async () => { fx.mutations.push('addDoc'); return { id: 'x' }; },
    updateDoc: async () => { fx.mutations.push('updateDoc'); },
    deleteDoc: async () => { fx.mutations.push('deleteDoc'); },
    setDoc: async () => { fx.mutations.push('setDoc'); },
    serverTimestamp: () => 'ts',
    arrayUnion: (v: unknown) => v,
    arrayRemove: (v: unknown) => v,
    Timestamp: class {},
  };
});

// Whether the tenant has a member-visible course is what decides the Courses
// tab, and therefore what Home falls back to. Driven explicitly rather than
// left to the Firestore stub, because section 4 turns on both answers.
const courses = vi.hoisted(() => ({ present: true }));
vi.mock('../../utils/member-courses', () => ({
  hasMemberVisibleCourses: async () => courses.present,
}));

const stub = vi.hoisted(() => (name: string) => ({ default: () => <div data-testid={name} /> }));
vi.mock('../Profile', () => stub('profile'));
vi.mock('../PartnerWithUsTab', () => stub('partner'));
vi.mock('../BlogTab', () => stub('blog'));
vi.mock('../PrayerWall', () => stub('prayer-wall'));
vi.mock('../AIChat', () => stub('chat'));
vi.mock('../UserMessages', () => stub('user-messages'));
vi.mock('../BiblePage', () => stub('bible'));
vi.mock('../ReferralTracker', () => stub('referral'));
vi.mock('../LiveNowBanner', () => stub('live-banner'));
vi.mock('../LivestreamView', () => stub('livestream'));
vi.mock('../ChurchMap', () => stub('map'));
vi.mock('../../components/CoursePage', () => stub('courses-screen'));

/**
 * NewsTab and AllNews are stubbed to ANNOUNCE THEIR MOUNT and to read
 * /community_posts on mount, exactly as the real ones do. A gate that only
 * hides the tab would still mount these; the recorded path is what tells the
 * two apart.
 */
vi.mock('../NewsTab', () => ({
  default: (props: any) => {
    fx.paths.push('community_posts');
    return (
      <div data-testid="news-tab">
        <button data-testid="news-open-all" onClick={() => props.onOpenAllNews?.()}>all news</button>
      </div>
    );
  },
}));
vi.mock('../AllNews', () => ({
  default: () => {
    fx.paths.push('community_posts');
    return <div data-testid="all-news" />;
  },
}));

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
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => tenant }));

let container: HTMLDivElement;
let root: Root;

async function mount(plan: string | null, opts: { isLoading?: boolean; hasCourse?: boolean } = {}) {
  store.tenantPlan = plan;
  tenant.tenantPlan = plan;
  tenant.isLoading = opts.isLoading ?? false;
  courses.present = opts.hasCourse ?? true;
  await act(async () => {
    root = createRoot(container);
    root.render(<MainApp onNavigate={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

const topTab = (id: string): HTMLElement | null =>
  container.querySelector(`[data-tab-id="${id}"]`);

function navControls(label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter(
    (b) => (b.textContent || '').trim() === label,
  ) as HTMLButtonElement[];
}

/**
 * The button labels inside ONE desktop sidebar group, addressed by that group's
 * own heading. Necessary rather than convenient: `navControls` sees the whole
 * shell, and the mobile bottom bar carries its own permanent "Home" while the
 * mobile top-tab strip labels each tab by its own name. Only this can say what
 * the DESKTOP sidebar offers.
 */
function sidebarGroup(heading: string): string[] {
  const head = Array.from(container.querySelectorAll('div')).find(
    (d) => d.children.length === 0 && (d.textContent || '').trim() === heading,
  );
  const wrapper = head?.parentElement;
  return wrapper
    ? Array.from(wrapper.querySelectorAll('button')).map((b) => (b.textContent || '').trim())
    : [];
}

async function click(el: Element | null) {
  expect(el, 'the control under test was not rendered').not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); });
}

const newsTab = () => container.querySelector('[data-testid="news-tab"]');
const allNews = () => container.querySelector('[data-testid="all-news"]');
const coursesScreen = () => container.querySelector('[data-testid="courses-screen"]');
const prayerScreen = () => container.querySelector('[data-testid="prayer-wall"]');
/** Did anything open a /community_posts read this mount? */
const touchedFeedData = () => fx.paths.some((p) => p.startsWith('community_posts'));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  fx.mutations = [];
  fx.paths = [];
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

// ─── 1. a free tenant has no news feed — surface AND route ───────────────────
describe('a free tenant has no news feed', () => {
  it('offers no News tab anywhere in the shell', async () => {
    await mount('free');

    expect(topTab('news'), 'the mobile News top-tab survived').toBeNull();
    expect(navControls('News'), 'a desktop sidebar News entry survived').toHaveLength(0);
  });

  it('🔴 never MOUNTS NewsTab — the surface, not just the nav entry', async () => {
    // THE-193: a hidden button led to a hidden screen and the workflow simply
    // ended. Absence from the tab strip is not a gate; NewsTab not existing in
    // the tree is.
    await mount('free');

    expect(newsTab(), 'NewsTab mounted on a tier with no feed').toBeNull();
  });

  it('🔴 opens no /community_posts read at all', async () => {
    // The sharpest form of the same claim, and the one a rendered-node check
    // cannot make: a mounted-but-invisible feed would still open its listener.
    await mount('free');

    expect(touchedFeedData(), `free read ${fx.paths.filter((p) => p.startsWith('community_posts')).join(', ')}`)
      .toBe(false);
  });

  it('refuses the AllNews full-screen route, not merely its entry point', async () => {
    // `onOpenAllNews` lives inside NewsTab, which free never mounts — so this
    // route "cannot" be reached, which is exactly what THE-193 assumed.
    await mount('free');

    expect(allNews(), 'the AllNews route rendered on a tier with no feed').toBeNull();
  });

  it('leaves a free member on a real screen, never an empty content area', async () => {
    await mount('free');

    const main = container.querySelector('[data-testid="courses-screen"], [data-testid="prayer-wall"]');
    expect(main, 'the content area rendered neither the course nor the prayer wall').not.toBeNull();
  });
});

// ─── 2. 🔴 the three priced tiers still have the news feed ───────────────────
describe('the three priced tiers still have the news feed', () => {
  for (const plan of ['plus', 'pro', 'max'] as const) {
    it(`${plan} keeps the News tab, and it is still Home`, async () => {
      await mount(plan);

      expect(topTab('news'), `${plan} lost the News tab`).not.toBeNull();
      expect(newsTab(), `${plan} lost the feed surface`).not.toBeNull();
      // Home is the feed on every tier that has it — the desktop sidebar's
      // "Home" entry is an alias of the News tab and must still resolve to it.
      expect(navControls('Home').length, `${plan} lost its Home entry`).toBeGreaterThan(0);
    });

    it(`${plan} still opens the feed's /community_posts read`, async () => {
      await mount(plan);

      expect(touchedFeedData(), `${plan}'s feed stopped reading community_posts`).toBe(true);
    });

    it(`${plan} can still reach the AllNews full-screen route`, async () => {
      await mount(plan);
      await click(container.querySelector('[data-testid="news-open-all"]'));

      expect(allNews(), `${plan} lost the AllNews route`).not.toBeNull();
    });
  }

  it('gates on the plan, not on the tenant — an unresolved plan is not a free tenant', async () => {
    // `features` is null until the tenant doc resolves. `=== true` means that
    // reads as "no"; the tab appears once the plan actually says so. The bug
    // this shape avoids is the opposite one — flashing the feed on every cold
    // load — and it is why this is not `!== false`.
    await mount(null, { isLoading: true });

    expect(topTab('news'), 'the feed flashed before the plan resolved').toBeNull();
  });
});

// ─── 3. the neighbouring gates are untouched ─────────────────────────────────
describe('community groups is still Ministry only and blog is still unchanged per tier', () => {
  it('Community Groups is on Ministry and nowhere else — in the matrix', () => {
    expect(getPlanFeatures('free').communityGroups).toBe(false);
    expect(getPlanFeatures('plus').communityGroups).toBe(false);
    expect(getPlanFeatures('pro').communityGroups).toBe(false);
    expect(getPlanFeatures('max').communityGroups).toBe(true);
  });

  it('Blog is on Individual and above — in the matrix', () => {
    expect(getPlanFeatures('free').blog).toBe(false);
    expect(getPlanFeatures('plus').blog).toBe(true);
    expect(getPlanFeatures('pro').blog).toBe(true);
    expect(getPlanFeatures('max').blog).toBe(true);
  });

  it('🔴 Ministry keeps Messages, which a feed gate must not have taken', async () => {
    // The overshoot test. Messages and the feed both live under the desktop
    // "COMMUNITY"/"FEED" headings and both were once unconditional literals in
    // the same array — a gate that reached one line too far takes a $159
    // feature from the tier that pays for it.
    await mount('max');

    expect(topTab('messages'), 'Ministry lost Community Groups to the feed gate').not.toBeNull();
    expect(topTab('news'), 'Ministry lost the feed').not.toBeNull();
  });

  it('Individual keeps the Blog tab and the feed, and still has no Messages', async () => {
    await mount('plus');

    expect(topTab('blog'), 'Individual lost the Blog tab').not.toBeNull();
    expect(topTab('news'), 'Individual lost the feed').not.toBeNull();
    expect(topTab('messages'), 'Individual gained Community Groups').toBeNull();
  });

  it('free keeps Prayer and Bible, which are on every tier and are not the feed', async () => {
    // PrayerWall reads /prayer_requests and Bible reads nothing — neither is
    // /community_posts, and a gate that swept the "FEED"/"COMMUNITY" sidebar
    // headings rather than the flag would have taken both.
    await mount('free');

    expect(topTab('prayer'), 'free lost the prayer wall').not.toBeNull();
    expect(navControls('Bible').length, 'free lost the Bible').toBeGreaterThan(0);
  });

  it('free still has no Blog and no Messages — this ticket moved neither', async () => {
    await mount('free');

    expect(topTab('blog')).toBeNull();
    expect(topTab('messages')).toBeNull();
  });
});

// ─── 4. 🔴 what Home IS for a free member ────────────────────────────────────
describe('a free member lands on their course, not a blank feed', () => {
  it('🔴 renders the COURSE on first paint, with no click and no navigation', async () => {
    // The named behaviour: signing in as a free member puts you on your
    // discipleship course. Not an upgrade screen, not an empty feed, not a
    // composer that cannot post.
    await mount('free', { hasCourse: true });

    expect(coursesScreen(), 'a free member did not land on their course').not.toBeNull();
    expect(newsTab(), 'a free member landed on the feed').toBeNull();
  });

  it("labels that landing 'Home' in the desktop sidebar, so Home still exists", async () => {
    // The sidebar's Home entry was an alias of the News tab. Keyed on the
    // `'news'` literal it would now resolve to a tab that is not there, and a
    // free member would have no Home entry in the sidebar at all. Asserted on
    // the FEED group rather than on the shell, because the mobile bottom bar
    // carries a permanent "Home" that would mask the loss.
    await mount('free', { hasCourse: true });

    expect(sidebarGroup('FEED'), 'free lost its desktop Home entry with the feed').toContain('Home');
  });

  it('does not list the course twice — once as Home and once under its own name', async () => {
    // `homeTabId` resolving to 'courses' makes the Courses entry the Home
    // entry. Listing both is a duplicate React key and two sidebar rows for one
    // destination. Scoped to the sidebar: the MOBILE top-tab strip labels that
    // same tab "Courses" and is untouched by this — there is no "Home" in that
    // strip for it to duplicate.
    await mount('free', { hasCourse: true });

    const feed = sidebarGroup('FEED');
    expect(feed, 'the course is listed as both Home and Courses').not.toContain('Courses');
    expect(feed.filter((l) => l === 'Home'), 'more than one Home entry').toHaveLength(1);
    // And no News entry survived in the group it used to lead.
    expect(feed).not.toContain('News');
  });

  it('🔴 leaves the FEED group reading exactly as before on a tier with the feed', async () => {
    // The dedupe is a free-tier consequence, not a reordering. On Ministry the
    // group must still read Home(News), Blog, Courses, Bible — in that order.
    await mount('max', { hasCourse: true });

    expect(sidebarGroup('FEED')).toEqual(['Home', 'Blog', 'Courses', 'Bible']);
  });

  it('falls back to a real screen — never a blank one — when no course exists yet', async () => {
    // A free tenant that has adopted nothing yet has no Courses tab either. The
    // last arm of `homeTabId` is the first surviving tab, which on free is
    // Prayer. A real screen, not an empty content area.
    await mount('free', { hasCourse: false });

    expect(coursesScreen()).toBeNull();
    expect(prayerScreen(), 'a free member with no course landed on nothing').not.toBeNull();
    expect(newsTab()).toBeNull();
  });

  it('🔴 leaves Home as the FEED on every tier that has one', async () => {
    // The no-regression half of the Home move: a paying tier's Home must not
    // have become the course.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      await act(async () => { root?.unmount(); });
      container.remove();
      container = document.createElement('div');
      document.body.appendChild(container);
      fx.paths = [];

      await mount(plan, { hasCourse: true });
      expect(newsTab(), `${plan}'s Home stopped being the feed`).not.toBeNull();
      expect(coursesScreen(), `${plan} landed on the course instead of the feed`).toBeNull();
    }
  });
});

// ─── 5. gating hides the surface; it destroys nothing ────────────────────────
describe('no /community_posts data is written, moved or deleted', () => {
  it('writes nothing when the gate closes on free', async () => {
    await mount('free');

    expect(fx.mutations, 'the feed gate performed a Firestore mutation').toEqual([]);
  });

  it('writes nothing on a priced tier either', async () => {
    await mount('plus');

    expect(fx.mutations, 'the feed gate performed a Firestore mutation').toEqual([]);
  });

  it('every tier in PLAN_ORDER answers the cell, so no tier is silently undefined', () => {
    for (const plan of PLAN_ORDER) {
      expect(typeof getPlanFeatures(plan).newsFeed, `${plan}.newsFeed is not a boolean`).toBe('boolean');
    }
  });
});
