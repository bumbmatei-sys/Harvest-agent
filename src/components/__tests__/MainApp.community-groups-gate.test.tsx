import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MainApp from '../MainApp';
import { getPlanFeatures } from '../../utils/plan-features';

/**
 * THE-162 — Community Groups leaked to every tier in the member app.
 *
 * `communityGroups` ("private channels + DMs") is false on plus/pro and true on
 * max, and the admin app has gated on it since it shipped. The member app never
 * did: `{ id: 'messages', label: 'Messages' }` was an unconditional literal in
 * MainApp's `topTabs`, so a $49 Individual church and a $99 Small Team church
 * both got the tab, the desktop COMMUNITY sidebar entry, and UserMessages with
 * its channel + DM listeners.
 *
 * ⚠️ THE OVERSHOOT IS AS BAD AS THE LEAK. Every other entitlement bug in this
 * project was access wrongly WITHHELD; this one is access wrongly GRANTED, and
 * a fix that reaches too far takes a working feature away from the churches
 * actually paying for it. Hence the Ministry tests below carry the same weight
 * as the Individual ones, and the "not communityGroups" tests pin the surfaces
 * that must NOT move:
 *
 *   Messages  → UserMessages → tenants/{t}/{channels,channelMessages,
 *               directMessages,dmMessages}. Literally "private channels + DMs".
 *               THIS is communityGroups. Gated.
 *   Prayer    → PrayerWall → /prayer_requests. A public prayer wall: anyone
 *               posts, anyone taps "prayed". No channel, no DM, no plan flag on
 *               any tier. NOT communityGroups. Untouched.
 *   Map       → ChurchMap → /churches. Has its own `map` flag (false on plus,
 *               true on pro/max) and is already gated by it. Untouched.
 *   News feed → NewsTab/AllNews → /community_posts. A name collision, not the
 *               feature: this is the church news feed. NOT communityGroups.
 *               Untouched.
 *
 * Messages, Prayer and Map all sit in the SAME desktop sidebar group, labelled
 * "COMMUNITY". That group is a layout heading, not an entitlement — gating on
 * it would have taken Prayer and Map with it.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));

// Every Firestore mutation verb is recorded so the "nothing is deleted" test can
// assert on the absence of writes rather than on the absence of an error.
const fx = vi.hoisted(() => ({ mutations: [] as string[] }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: any, ...args: unknown[]) => ({ __path: col?.__path, args }),
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  getDocs: async () => ({ docs: [], forEach: () => {} }),
  onSnapshot: () => () => {},
  addDoc: async () => { fx.mutations.push('addDoc'); return { id: 'x' }; },
  updateDoc: async () => { fx.mutations.push('updateDoc'); },
  deleteDoc: async () => { fx.mutations.push('deleteDoc'); },
  setDoc: async () => { fx.mutations.push('setDoc'); },
  serverTimestamp: () => 'ts',
  arrayUnion: (v: unknown) => v,
  arrayRemove: (v: unknown) => v,
  Timestamp: class {},
}));

// Screens the nav can open are stubbed — none is under test, and each drags in
// its own listeners and network calls. PlanUpgradeScreen is deliberately NOT
// stubbed: what a blocked member actually reads is part of the fix.
const stub = vi.hoisted(() => (name: string) => ({ default: () => <div data-testid={name} /> }));
vi.mock('../Profile', () => stub('profile'));
vi.mock('../PartnerWithUsTab', () => stub('partner'));
vi.mock('../BlogTab', () => stub('blog'));
vi.mock('../PrayerWall', () => stub('prayer-wall'));
vi.mock('../AllNews', () => stub('all-news'));
vi.mock('../../components/CoursePage', () => stub('courses'));
vi.mock('../AIChat', () => stub('chat'));
vi.mock('../UserMessages', () => stub('user-messages'));
vi.mock('../BiblePage', () => stub('bible'));
vi.mock('../ReferralTracker', () => stub('referral'));
vi.mock('../LiveNowBanner', () => stub('live-banner'));
vi.mock('../LivestreamView', () => stub('livestream'));
vi.mock('../ChurchMap', () => stub('map'));

// The feed is the app's own deep link INTO Messages: its comment menu creates a
// DM and then jumps straight to the tab, without going through the tab strip.
// That jump is this SPA's equivalent of typing a URL, so the stub exposes it.
vi.mock('../NewsTab', () => ({
  default: ({ onOpenMessages }: { onOpenMessages?: () => void }) => (
    <button data-testid="feed-jump-to-messages" onClick={() => onOpenMessages?.()}>
      jump to messages
    </button>
  ),
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

// MainApp reads the plan from the store AND from TenantContext, preferring
// whichever resolves first; both are driven together here.
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

/** Mount the member app for a tenant on `plan`. `null` = plan not resolved yet. */
async function mount(plan: string | null, opts: { isLoading?: boolean } = {}) {
  store.tenantPlan = plan;
  tenant.tenantPlan = plan;
  tenant.isLoading = opts.isLoading ?? false;
  await act(async () => {
    root = createRoot(container);
    root.render(<MainApp onNavigate={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** A top-tab in the mobile strip, addressed by its surface id — never by index. */
const topTab = (id: string): HTMLElement | null =>
  container.querySelector(`[data-tab-id="${id}"]`);

/**
 * The labels inside one desktop sidebar group, addressed by the group's own
 * heading. Messages, Prayer and Map all live under "COMMUNITY", so this is
 * where a gate keyed on the heading rather than on the flag shows itself.
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

/**
 * Every nav control anywhere in the shell carrying `label` — the mobile top-tab
 * strip, the mobile bottom bar and the desktop sidebar all render into the same
 * tree in jsdom, so this answers "is this surface offered at all".
 */
function navControls(label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter(
    (b) => (b.textContent || '').trim() === label,
  ) as HTMLButtonElement[];
}

async function click(el: Element | null) {
  expect(el, 'the control under test was not rendered').not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); });
}

const messagesScreen = () => container.querySelector('[data-testid="user-messages"]');
const upgradeScreen = () => container.querySelector('[data-testid="plan-upgrade-screen"]');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  fx.mutations = [];

});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

// ─── 1. the regression ───────────────────────────────────────────────────────
describe("an Individual tenant's members cannot reach the community surfaces", () => {
  it('offers no Messages control anywhere in the member app', async () => {
    await mount('plus');

    expect(topTab('messages'), 'the Messages top-tab is still in the strip').toBeNull();
    expect(navControls('Messages'), 'a Messages nav entry survives somewhere').toHaveLength(0);
  });

  it('drops Messages from the desktop COMMUNITY group but keeps the rest of it', async () => {
    await mount('plus');

    const group = sidebarGroup('COMMUNITY');
    expect(group, 'the COMMUNITY sidebar group did not render at all').not.toEqual([]);
    expect(group).not.toContain('Messages');
    expect(group, 'the whole group was gated instead of the one feature in it').toContain('Prayer');
  });

  it('stays closed while the plan is still resolving', async () => {
    // The direction of this bug decides the default: an unresolved plan must
    // read as "no". usePlanGate answers `true` here, which is right for a
    // feature being wrongly withheld and wrong for one being wrongly granted.
    await mount(null, { isLoading: true });

    expect(topTab('messages')).toBeNull();
    expect(navControls('Messages')).toHaveLength(0);
  });
});

// ─── 2. the tier nobody had looked at ────────────────────────────────────────
describe("a Small Team tenant's members cannot either", () => {
  it('offers no Messages control anywhere in the member app', async () => {
    await mount('pro');

    expect(topTab('messages')).toBeNull();
    expect(navControls('Messages')).toHaveLength(0);
    expect(messagesScreen()).toBeNull();
  });
});

// ─── 3. the overshoot guard — worth as much as test 1 ────────────────────────
describe("a Ministry tenant's members still can", () => {
  it('keeps the Messages top-tab', async () => {
    await mount('max');

    expect(topTab('messages'), 'Ministry lost a feature it pays for').not.toBeNull();
    expect(navControls('Messages').length).toBeGreaterThan(0);
  });

  it('keeps Messages in the desktop COMMUNITY group', async () => {
    await mount('max');

    expect(sidebarGroup('COMMUNITY')).toContain('Messages');
  });

  it('opens the real channel + DM screen, not an upgrade prompt', async () => {
    await mount('max');
    await click(topTab('messages'));

    expect(messagesScreen(), 'Ministry got the upgrade screen instead of Messages').not.toBeNull();
    expect(upgradeScreen()).toBeNull();
  });
});

// ─── 4. hiding the nav entry is not the fix ──────────────────────────────────
describe('a direct URL to a gated surface is refused, not just hidden from the nav', () => {
  // The member app is a single route (`/`) whose surfaces are tab state, so the
  // "direct URL" here is the app's own non-nav way in: the feed's comment menu
  // sets the Messages tab directly, bypassing the strip entirely. If only the
  // nav entry were gated, this would still mount UserMessages.
  it('refuses the feed jump into Messages on Individual', async () => {
    await mount('plus');
    await click(container.querySelector('[data-testid="feed-jump-to-messages"]'));

    expect(messagesScreen(), 'the route opened even though the nav entry was hidden').toBeNull();
    expect(upgradeScreen(), 'the surface was reachable with no explanation').not.toBeNull();
  });

  it('refuses the feed jump into Messages on Small Team', async () => {
    await mount('pro');
    await click(container.querySelector('[data-testid="feed-jump-to-messages"]'));

    expect(messagesScreen()).toBeNull();
    expect(upgradeScreen()).not.toBeNull();
  });

  it('still lets Ministry through the same jump', async () => {
    await mount('max');
    await click(container.querySelector('[data-testid="feed-jump-to-messages"]'));

    expect(messagesScreen()).not.toBeNull();
  });
});

// ─── 5. what must NOT move ───────────────────────────────────────────────────
describe('a surface that is not communityGroups is unaffected', () => {
  it('keeps Prayer on Individual — a public prayer wall is not a private channel', async () => {
    await mount('plus');

    expect(topTab('prayer'), 'Prayer was gated as if it were a community feature').not.toBeNull();
    await click(topTab('prayer'));
    expect(container.querySelector('[data-testid="prayer-wall"]')).not.toBeNull();
  });

  it('keeps Prayer on Small Team too', async () => {
    await mount('pro');

    expect(topTab('prayer')).not.toBeNull();
  });

  it('leaves Map on its own `map` flag — present on Small Team, where Messages is not', async () => {
    // The sharpest statement of the scope: Map and Messages sit in the same
    // desktop "COMMUNITY" sidebar group, and on pro they now disagree. A gate
    // keyed on that group heading instead of on the flag could not do this.
    await mount('pro');

    expect(navControls('Map').length, 'Map lost its own entitlement').toBeGreaterThan(0);
    expect(navControls('Messages')).toHaveLength(0);
  });

  it('leaves the news feed, Give and Bible alone on Individual', async () => {
    await mount('plus');

    // /community_posts is the church news feed, not Community Groups.
    expect(topTab('news')).not.toBeNull();
    expect(topTab('partner')).not.toBeNull();
    expect(navControls('Bible').length).toBeGreaterThan(0);
  });
});

// ─── 6. what the blocked member actually reads ───────────────────────────────
describe('a member sees an explanation, not a dead end', () => {
  it('names the feature and the plan that carries it', async () => {
    await mount('plus');
    await click(container.querySelector('[data-testid="feed-jump-to-messages"]'));

    const text = upgradeScreen()!.textContent || '';
    expect(text).toMatch(/Community Groups/);
    expect(text, 'the required plan is derived from the matrix, not hardcoded').toMatch(/Ministry/);
  });

  it('does not hand a member an Upgrade button they cannot act on', async () => {
    // A member is not an admin and cannot buy a plan. The admin variant of this
    // screen offers "Upgrade"; the member variant must say who can, instead of
    // offering a button that goes nowhere.
    await mount('plus');
    await click(container.querySelector('[data-testid="feed-jump-to-messages"]'));

    const buttons = Array.from(upgradeScreen()!.querySelectorAll('button')).map(
      (b) => (b.textContent || '').trim(),
    );
    expect(buttons).not.toContain('Upgrade');
    expect(upgradeScreen()!.textContent || '').toMatch(/admin at your church/i);
  });

  it('offers a way back out of the blocked surface', async () => {
    await mount('plus');
    await click(container.querySelector('[data-testid="feed-jump-to-messages"]'));

    const back = Array.from(upgradeScreen()!.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'Go Back',
    );
    expect(back, 'the member is stranded on the blocked surface').toBeDefined();

    await click(back!);
    expect(upgradeScreen(), 'Go Back left the member on the same screen').toBeNull();
    expect(topTab('news')).not.toBeNull();
  });
});

// ─── 7. gating hides, it does not destroy ────────────────────────────────────
describe('no community data is deleted', () => {
  it('writes nothing when the gate closes on Individual', async () => {
    await mount('plus');
    await click(container.querySelector('[data-testid="feed-jump-to-messages"]'));

    expect(fx.mutations, 'the gate performed a Firestore mutation').toEqual([]);
  });

  it('writes nothing when the gate closes on Small Team', async () => {
    await mount('pro');
    await click(container.querySelector('[data-testid="feed-jump-to-messages"]'));

    expect(fx.mutations).toEqual([]);
  });

  it('shows the same screen again once the tenant is on Ministry', async () => {
    // The messages, channels and DMs live in Firestore and are never touched by
    // this change: the same tenant, re-read on max, gets the same screen back
    // with its history intact. Gating is a hidden surface, not a deletion.
    await mount('plus');
    expect(messagesScreen()).toBeNull();
    await act(async () => { root.unmount(); });

    await mount('max');
    await click(topTab('messages'));
    expect(messagesScreen()).not.toBeNull();
    expect(fx.mutations).toEqual([]);
  });
});

// ─── 8. the matrix this whole fix rests on ───────────────────────────────────
describe('communityGroups is still Ministry only in plan-features', () => {
  // The gate above is only correct while these three cells are. Nothing in this
  // change edits plan-features.ts; this is the contract it depends on.
  it('is off on Individual (plus)', () => {
    expect(getPlanFeatures('plus').communityGroups).toBe(false);
  });

  it('is off on Small Team (pro)', () => {
    expect(getPlanFeatures('pro').communityGroups).toBe(false);
  });

  it('is on for Ministry (max)', () => {
    expect(getPlanFeatures('max').communityGroups).toBe(true);
  });
});

// ─── 9. both themes ──────────────────────────────────────────────────────────
describe('no colour is hardcoded', () => {
  it('carries no literal colour in the blocked member surface', async () => {
    await mount('plus');
    await click(container.querySelector('[data-testid="feed-jump-to-messages"]'));

    const offenders = Array.from(upgradeScreen()!.querySelectorAll<HTMLElement>('*'))
      .concat(upgradeScreen() as HTMLElement)
      .map((el) => el.getAttribute('style') || '')
      .filter((s) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(s));

    expect(offenders, 'a colour is pinned inline and cannot follow the theme').toEqual([]);
  });

  it('draws the lock plate from the theme ramp', async () => {
    // The plate used to be `#fcefc7` with a `#d4a017` icon — fixed cream and
    // fixed gold, which stay cream and gold on the dark ramp. Both now resolve
    // through --surface-gold / --brand-color, which the dark block redefines.
    await mount('plus');
    await click(container.querySelector('[data-testid="feed-jump-to-messages"]'));

    const plate = upgradeScreen()!.querySelector('.bg-surface-gold');
    expect(plate, 'the lock plate no longer uses the themed surface token').not.toBeNull();
    expect(plate!.querySelector('.text-gold'), 'the lock icon is not on the brand token').not.toBeNull();
  });
});
