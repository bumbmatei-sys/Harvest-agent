import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MainApp from '../MainApp';
import { getPlanFeatures, PLAN_ORDER, PLAN_DISPLAY_NAMES } from '../../utils/plan-features';

/**
 * THE-213 · defect 4, the member-app half — NO SURFACE OFFERS GIVING ON A FREE
 * TENANT.
 *
 * THE-202 gated the Give TAB in `topTabs`, and that entry was the ONLY reader
 * of `fundraising` in this file. A tab entry is not a gate (THE-193), and three
 * paths set `activeTopTab` to 'partner' without going near the tab strip:
 *
 *   Profile        "Give again →" / "Partner with Us →" → onGoToPartner()
 *   NewsTab        the giving CTA → onGoToPartner()
 *   the deep link  `/?giving=1`, which a printed giving QR (AdminQR) and every
 *                  Text-to-Give reply carry
 *
 * All three landed a free member on `PartnerWithUsTab` — a full donate form,
 * amount picker and all, on a tenant whose plan says it has no donate page and
 * whose /api/stripe/donate refuses. So `partner` now joins `news` in the
 * `effectiveTopTab` fallback AND the route carries its own guard, the pair the
 * Messages tab has had since THE-162.
 *
 * ⚠️ Home rather than an upgrade screen, and that is a deliberate difference
 * from Messages: a member cannot make their church able to take donations, so
 * answering a QR someone printed with an advert for a subscription tier is the
 * worst version of this screen. The feed's precedent, not the Messages one.
 *
 * ⚠️ THE OVERSHOOT IS THE RISK. Three tiers pay for giving; section 3 carries
 * the same weight as section 1.
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
/**
 * Profile announces its mount AND exposes the giving jump it really makes.
 * `onGoToPartner` is the exact prop MainApp hands it — `setActiveBottomTab
 * ('home'); setActiveTopTab('partner')` — so clicking here drives the real
 * wiring rather than poking MainApp's state from outside it.
 */
vi.mock('../Profile', () => ({
  default: (props: any) => (
    <div data-testid="profile">
      {/* 🔴 MIRRORS THE REAL COMPONENT'S CONTRACT SINCE THE-246: Profile draws
          "Give again →" / "Partner with Us →" only when a caller hands it a
          destination, and MainApp withholds `onGoToPartner` when the Give page
          is hidden. A stub that rendered the button unconditionally would let
          this file keep passing while the real screen offered a giving button
          that does nothing. */}
      {props.onGoToPartner && (
        <button data-testid="profile-give" onClick={() => props.onGoToPartner()}>Give again</button>
      )}
    </div>
  ),
}));
/**
 * PartnerWithUsTab announces its mount AND records that it opened the giving
 * path, exactly as the real one does on its first render. A gate that only
 * hides the tab would still mount this — the recorded surface is what tells the
 * two apart.
 */
vi.mock('../PartnerWithUsTab', () => ({
  default: () => {
    fx.paths.push('api/stripe/donate');
    return <div data-testid="partner" />;
  },
}));
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
  // 🔴 THE-246 — a church's plan says it MAY take gifts; these say it CAN.
  // Defaulted to a live Stripe account because that is the ordinary paying
  // church this file's section 3 is about: every assertion here is about the
  // PLAN gate, and a tenant with no payment rails at all would fail them for a
  // reason that has nothing to do with `fundraising`. The rails gate itself is
  // covered in MainApp.giving-rails.test.tsx.
  stripeConnectStatus: 'active' as string | undefined,
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => tenant }));

let container: HTMLDivElement;
let root: Root;

async function mount(
  plan: string | null,
  opts: { isLoading?: boolean; hasCourse?: boolean; giving?: boolean; stripe?: boolean } = {},
) {
  store.tenantPlan = plan;
  tenant.tenantPlan = plan;
  tenant.isLoading = opts.isLoading ?? false;
  tenant.stripeConnectStatus = (opts.stripe ?? true) ? 'active' : undefined;
  courses.present = opts.hasCourse ?? true;
  // The `?giving=1` deep link a printed QR / Text-to-Give reply carries. Set on
  // the real location so MainApp's own effect reads it, rather than reaching
  // past the effect to set state directly.
  window.history.replaceState({}, '', opts.giving ? '/?giving=1' : '/');
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

const partnerTab = () => container.querySelector('[data-testid="partner"]');
/** The shell's own way into Profile: the bottom bar's "My Profile" entry on a
 *  phone, the top-right avatar on desktop. Both mount the same screen. */
const profileEntry = (): Element | null =>
  navControls('My Profile')[0]
  ?? container.querySelector('button[title="My Profile"]');
/** Did anything open the giving path this mount? */
const touchedGiving = () => fx.paths.some((p) => p.startsWith('api/stripe/donate'));
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


// ─── 1. a free tenant reaches no giving surface ──────────────────────────────
describe('no member-app surface offers giving on a free tenant', () => {
  it('offers no Give tab anywhere in the shell', async () => {
    await mount('free');

    expect(topTab('partner'), 'the mobile Give top-tab survived').toBeNull();
    expect(navControls('Give'), 'a desktop sidebar Give entry survived').toHaveLength(0);
  });

  it('🔴 never MOUNTS PartnerWithUsTab, even on the deep link a QR carries', async () => {
    // `/?giving=1` is the link AdminQR prints on a giving QR and the one every
    // Text-to-Give reply sends. It sets `activeTopTab` directly, so the tab
    // strip is not on its path — this is the case a hidden tab never covered.
    await mount('free', { giving: true });

    expect(partnerTab(), 'the donate form mounted on a tenant with no donate page').toBeNull();
    expect(touchedGiving(), 'the giving path was opened anyway').toBe(false);
  });

  it('lands the deep link on Home rather than a blank tab or an upgrade advert', async () => {
    // A member cannot buy their church a plan, so an upgrade screen here would
    // answer a printed QR with a sales pitch. Home is the feed's precedent.
    await mount('free', { giving: true });

    expect(coursesScreen(), 'a free member did not land on their course').not.toBeNull();
  });

  it("🔴 refuses the jump Profile's own giving buttons make", async () => {
    // Profile is mounted inside this shell and is handed `onGoToPartner`, which
    // is `setActiveBottomTab('home'); setActiveTopTab('partner')`. Driven
    // through the real prop rather than by poking state, so the wiring is what
    // is under test — and this is the path the founder's own report walked.
    //
    // ⚠️ TIGHTENED BY THE-246, not weakened. The jump used to be OFFERED and
    // then bounced back to Home by `effectiveTopTab`; MainApp now withholds the
    // prop entirely on a tenant with no Give page, so there is no button to
    // press. Both facts are asserted: the CTA is absent, and pressing what
    // Profile does render still reaches no donate path.
    await mount('free');
    await click(profileEntry());

    expect(
      container.querySelector('[data-testid="profile-give"]'),
      'a free member was still offered a giving button',
    ).toBeNull();
    expect(partnerTab(), 'the donate form mounted from the Profile jump').toBeNull();
    expect(touchedGiving()).toBe(false);
  });

  it('the same jump on a paying tier still reaches the donate form', async () => {
    // The proof that the test above is testing the GATE and not a broken stub.
    await mount('pro');
    await click(profileEntry());
    await click(container.querySelector('[data-testid="profile-give"]'));

    expect(partnerTab(), 'the Profile jump stopped working on a paying tier').not.toBeNull();
  });

  it('🔴 opens no donate path at all across every entry it has', async () => {
    for (const giving of [false, true]) {
      fx.paths = [];
      await act(async () => { root?.unmount(); });
      await mount('free', { giving });
      expect(touchedGiving(), `giving=${giving} opened the donate path`).toBe(false);
    }
  });

  it('performs no write while refusing — nothing is cancelled or cleaned up', async () => {
    await mount('free', { giving: true });
    expect(fx.mutations, 'a refusal wrote to Firestore').toEqual([]);
  });
});

// ─── 2. the gate is BOTH halves, not just the tab ────────────────────────────
describe('the route is gated as well as the tab entry', () => {
  it('an unresolved plan offers no Give tab and mounts no donate form', async () => {
    // `features` is null until the tenant document resolves. `=== true` means an
    // unknown plan reads as "no", so nothing flashes on a cold load.
    await mount(null, { isLoading: true, giving: true });

    expect(topTab('partner')).toBeNull();
    expect(partnerTab()).toBeNull();
  });

  it('a tenant that upgrades gets the same deep link working again', async () => {
    // The refusal is a surface gate: nothing about the link, the QR or the
    // member's record had to change for it to come back.
    await mount('free', { giving: true });
    expect(partnerTab()).toBeNull();

    await act(async () => { root.unmount(); });
    await mount('pro', { giving: true });
    expect(partnerTab(), 'the deep link did not recover on an upgrade').not.toBeNull();
  });
});

// ─── 3. the three priced tiers ───────────────────────────────────────────────
describe('the three priced tiers are unchanged', () => {
  for (const plan of PLAN_ORDER.filter((p) => getPlanFeatures(p).fundraising)) {
    const name = PLAN_DISPLAY_NAMES[plan];

    it(`${name} keeps the Give tab and the donate form behind it`, async () => {
      await mount(plan);

      expect(topTab('partner'), `${name} lost the Give tab`).not.toBeNull();
      await click(topTab('partner'));
      expect(partnerTab(), `${name} lost the donate form`).not.toBeNull();
    });

    it(`${name} keeps the giving deep link`, async () => {
      await mount(plan, { giving: true });
      expect(partnerTab(), `${name} lost the ?giving=1 deep link`).not.toBeNull();
    });

    it(`${name} keeps Give in the desktop sidebar's SUPPORT US group`, async () => {
      await mount(plan);
      expect(sidebarGroup('SUPPORT US'), `${name} lost the sidebar entry`).toContain('Give');
    });
  }

  it('free is the only tier without giving, read off the matrix', async () => {
    expect(PLAN_ORDER.filter((p) => !getPlanFeatures(p).fundraising)).toEqual(['free']);
  });
});
