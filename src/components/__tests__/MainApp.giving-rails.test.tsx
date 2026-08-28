import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MainApp from '../MainApp';
import { GIVING_PROVIDERS } from '../donations/giving-providers';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-246 — THE GIVE PAGE'S FOUR STATES, and every entry point into them.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Confirmed with the founder:
 *
 *   Stripe ✗ links ✗ → the Give page is HIDDEN ENTIRELY
 *   Stripe ✓ links ✗ → shown, the donation form alone
 *   Stripe ✗ links ✓ → shown, LINKS ONLY, no form
 *   Stripe ✓ links ✓ → the form, with the links beneath it
 *
 * 🔴 A TAB ENTRY IS NOT A GATE — THE-193, and THE-213 paid for it here already.
 * Dropping "Give" from the strip hides one of SEVEN ways this screen is reached.
 * Every one of them is walked below, on a tenant with no rails:
 *
 *   1. the mobile top-tab strip
 *   2. the desktop sidebar's SUPPORT US group
 *   3. `/?giving=1` — the deep link a printed giving QR (AdminQR) carries
 *   4. `/?giving=1` — the same link every Text-to-Give reply sends
 *   5. Profile's "Give again →" / "Partner with Us →"
 *   6. NewsTab's "Give Now" card in the feed
 *   7. LivestreamView's Donate button, which opens `/?giving=1`
 *
 * 3, 4 and 7 are the SAME path (`?giving=1`) and are asserted once as that path,
 * named here so the count is honest rather than inflated.
 *
 * ⚠️ THE SERVER HALF IS NOT HERE, and is not missing. `/api/stripe/donate` is
 * the server gate — it refuses a plan without `fundraising`, a tenant past its
 * grace window, and a tenant with no connected account, before any Stripe object
 * exists — and it is pinned in `stripe/__tests__` and by the digest assertion in
 * `AdminDonations.section.test.tsx`. This file is the client half.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));

/** Every Firestore path touched, so a refusal can be asserted as an ABSENCE. */
const fx = vi.hoisted(() => ({ paths: [] as string[], mutations: [] as string[] }));

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

/**
 * 🔴 `PartnerWithUsTab` AND `GivingLinks` ARE NOT STUBBED. This suite asserts
 * what a member SEES — a mark, a name, a handle, and an anchor that opens the
 * church's URL — so stubbing the screen would leave the four-state table
 * asserted only at the tab strip, which is the layer THE-193 already proved is
 * not a gate. The donate POST is the one thing intercepted, below.
 */
const posts = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: async (url: string) => {
    posts.urls.push(url);
    return { ok: true, json: async () => ({ url: 'https://checkout.stripe.test/x' }) };
  },
}));

const courses = vi.hoisted(() => ({ present: true }));
vi.mock('../../utils/member-courses', () => ({ hasMemberVisibleCourses: async () => courses.present }));

const stub = vi.hoisted(() => (name: string) => ({ default: () => <div data-testid={name} /> }));
vi.mock('../Profile', () => ({
  default: (props: any) => (
    <div data-testid="profile">
      {/* Mirrors the real component: the CTA exists only when a destination was
          handed over. See Profile.tsx's `onGoToPartner`. */}
      {props.onGoToPartner && (
        <button data-testid="profile-give" onClick={() => props.onGoToPartner()}>Give again</button>
      )}
    </div>
  ),
}));
vi.mock('../NewsTab', () => ({
  default: (props: any) => (
    <div data-testid="news-tab">
      {/* Mirrors NewsTab: the "Partner with Us" card renders only when the
          caller passes a jump. */}
      {props.onGoToPartner && (
        <button data-testid="news-give" onClick={() => props.onGoToPartner()}>Give Now</button>
      )}
    </div>
  ),
}));
vi.mock('../AllNews', () => stub('all-news'));
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

vi.mock('../ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="dynamic" /> }));
vi.mock('framer-motion', () => {
  const passthrough = new Proxy(
    {},
    { get: () => ({ children, ...rest }: any) => <div {...{ className: rest.className }}>{children}</div> },
  );
  return { motion: passthrough, AnimatePresence: ({ children }: any) => <>{children}</> };
});

const store = vi.hoisted(() => ({ tenantPlan: 'pro' as string | null, currentUser: null as any }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store }));

const tenant = vi.hoisted(() => ({
  tenantId: 'tenant-1',
  tenantName: 'Grace Chapel',
  branding: {} as any,
  tenantPlan: 'pro' as string | null,
  isLoading: false,
  stripeConnectStatus: undefined as string | undefined,
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => tenant }));

/** A church that pasted every one of the four providers. */
/**
 * A church that publishes EVERY provider — built from the table, not typed out.
 *
 * 🔴 THE-254 found this fixture hand-written as four literal rows while the
 * assertions below already ranged over `GIVING_PROVIDERS`. That combination
 * fails silently in the direction that matters: the suite kept asserting over
 * the table, but only ever fed it four providers, so a new row was "covered" by
 * tests that had no data for it. Derived here instead, so the seventh provider
 * is exercised by every assertion in this file the day it is added.
 *
 * Each provider's own `urlExample` and `handleExample` are the values a church
 * is actually shown as placeholders, and a provider with no per-account page
 * (Zelle) gets no URL — which is what keeps the "renders as a card, not a dead
 * link" case below honest.
 */
const ALL_PROVIDERS: Record<string, { url?: string; handle: string; email: string }> =
  Object.fromEntries(
    GIVING_PROVIDERS.map((p) => [
      p.id,
      {
        ...(p.hasPersonalLink ? { url: p.urlExample } : {}),
        handle: p.handleExample,
        email: `${p.id}@grace.org`,
      },
    ]),
  );

let container: HTMLDivElement;
let root: Root;

type Rails = {
  stripe?: boolean;
  /** The raw `stripeConnectStatus`, when the test is about a status that is not
   *  'active' — 'pending' and 'restricted' both LOOK connected on the doc. */
  stripeStatus?: string | undefined;
  links?: Record<string, unknown> | null;
};

async function mount(rails: Rails = {}, opts: { giving?: boolean; plan?: string | null } = {}) {
  const plan = opts.plan ?? 'pro';
  store.tenantPlan = plan;
  tenant.tenantPlan = plan;
  tenant.isLoading = false;
  tenant.stripeConnectStatus =
    'stripeStatus' in rails ? rails.stripeStatus : (rails.stripe ? 'active' : undefined);
  tenant.branding = rails.links ? { givingLinks: rails.links } : {};
  courses.present = true;
  window.history.replaceState({}, '', opts.giving ? '/?giving=1' : '/');
  await act(async () => {
    root = createRoot(container);
    root.render(<MainApp onNavigate={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

const topTab = (id: string) => container.querySelector(`[data-tab-id="${id}"]`);

function navControls(label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter(
    (b) => (b.textContent || '').trim() === label,
  ) as HTMLButtonElement[];
}

/** The button labels inside ONE desktop sidebar group, by its heading. */
function sidebarGroup(heading: string): string[] {
  const head = Array.from(container.querySelectorAll('div')).find(
    (d) => d.children.length === 0 && (d.textContent || '').trim() === heading,
  );
  const wrapper = head?.parentElement;
  return wrapper ? Array.from(wrapper.querySelectorAll('button')).map((b) => (b.textContent || '').trim()) : [];
}

async function click(el: Element | null) {
  expect(el, 'the control under test was not rendered').not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); });
}

/** The donation form — addressed by the control that actually takes money. */
const donateButton = (): HTMLElement | null =>
  Array.from(container.querySelectorAll('button')).find(
    (b) => /^Give \$/.test((b.textContent || '').trim()),
  ) ?? null;
/** The amount picker, the other half of the form. */
const amountPresets = () =>
  Array.from(container.querySelectorAll('button')).filter((b) => /^\$\d+$/.test((b.textContent || '').trim()));
const linksSection = () => container.querySelector('[data-testid="giving-links"]');
const linkRows = () => Array.from(container.querySelectorAll('[data-provider]'));
const givePage = () => donateButton() ?? linksSection();
const profileEntry = (): Element | null =>
  navControls('My Profile')[0] ?? container.querySelector('button[title="My Profile"]');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  fx.paths = [];
  fx.mutations = [];
  posts.urls = [];
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. 🔴 Stripe ✗ links ✗ — hidden entirely, on EVERY entry point
// ═════════════════════════════════════════════════════════════════════════════
describe('the Give page is hidden when there is no Stripe and no link', () => {
  it('offers no Give tab in the strip, and no Give entry in the desktop sidebar', async () => {
    await mount({ stripe: false, links: null });

    expect(topTab('partner'), 'the mobile Give tab survived').toBeNull();
    expect(navControls('Give'), 'a desktop Give entry survived').toHaveLength(0);
    expect(sidebarGroup('SUPPORT US'), 'the sidebar still offers Give').not.toContain('Give');
  });

  it('🔴 mounts nothing on the `?giving=1` deep link a QR, an SMS or the livestream sends', async () => {
    // AdminQR prints `${base}/?giving=1` on a giving QR, /api/sms/incoming replies
    // with the same link, and LivestreamView's Donate opens it. One path, three
    // producers — and it never goes near the tab strip.
    await mount({ stripe: false, links: null }, { giving: true });

    expect(givePage(), 'the Give page mounted from the deep link').toBeNull();
    expect(posts.urls, 'the donate endpoint was called anyway').toEqual([]);
  });

  it("🔴 offers no giving button in Profile", async () => {
    await mount({ stripe: false, links: null });
    await click(profileEntry());

    expect(
      container.querySelector('[data-testid="profile-give"]'),
      'Profile offered "Give again →" with nowhere to send it',
    ).toBeNull();
  });

  it("🔴 offers no giving card in the news feed", async () => {
    await mount({ stripe: false, links: null });

    expect(
      container.querySelector('[data-testid="news-give"]'),
      'the feed offered "Give Now" with nowhere to send it',
    ).toBeNull();
  });

  it('opens no donate path and writes nothing, across both entries', async () => {
    for (const giving of [false, true]) {
      await act(async () => { root?.unmount(); });
      posts.urls = [];
      fx.mutations = [];
      await mount({ stripe: false, links: null }, { giving });
      expect(posts.urls, `giving=${giving} opened the donate path`).toEqual([]);
      expect(fx.mutations, 'a refusal wrote to Firestore').toEqual([]);
    }
  });

  it('is hidden by a pending or restricted Stripe account too, not only by no account', async () => {
    // 🔴 A pending onboarding and a restricted account both LOOK connected on
    // the tenant doc and neither can complete a checkout. A form on top of one
    // fails after a member has typed their card in, which is worse than an
    // absent page, not better.
    for (const status of ['pending', 'restricted', 'active'] as const) {
      await act(async () => { root?.unmount(); });
      await mount({ stripeStatus: status, links: null });
      const shown = topTab('partner') !== null;
      // 'active' is in the loop as the control: without it a broken mount would
      // pass this test by rendering nothing at all.
      expect(shown, `a "${status}" Connect account was read as ${shown ? 'live' : 'dead'}`)
        .toBe(status === 'active');
    }
  });

  it('is hidden when the only stored link would be refused as a phishing link', async () => {
    // 🔴 The rails count is taken from VALIDATED links. A church whose only
    // stored "PayPal" link points at collect.example has no rail, so the page
    // is hidden rather than shown with nothing safe on it.
    await mount({ stripe: false, links: { paypal: { url: 'https://paypal.me.collect.example/x' } } });

    expect(topTab('partner'), 'a refused link kept the Give page alive').toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Stripe ✓ links ✗ — the donation form alone
// ═════════════════════════════════════════════════════════════════════════════
describe('the Give page shows the form alone when only Stripe is connected', () => {
  it('shows the tab, the amount picker and the Give button, and no links block', async () => {
    await mount({ stripe: true, links: null });

    expect(topTab('partner'), 'the Give tab is missing').not.toBeNull();
    await click(topTab('partner'));
    expect(amountPresets().length, 'the amount picker is missing').toBeGreaterThan(0);
    expect(donateButton(), 'the Give button is missing').not.toBeNull();
    expect(linksSection(), 'a links block appeared with no links').toBeNull();
  });

  it('still posts to the donate endpoint, so the form is the real one', async () => {
    await mount({ stripe: true, links: null });
    await click(topTab('partner'));
    await click(donateButton());

    expect(posts.urls, 'the Give button no longer reaches the donate route').toEqual(['/api/stripe/donate']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Stripe ✗ links ✓ — links only, no form
// ═════════════════════════════════════════════════════════════════════════════
describe('the Give page shows links alone when only links exist', () => {
  it('shows the links and NO amount picker, NO Give button', async () => {
    await mount({ stripe: false, links: ALL_PROVIDERS });

    expect(topTab('partner'), 'a church with links but no Stripe lost its Give tab').not.toBeNull();
    await click(topTab('partner'));
    expect(linksSection(), 'the links block is missing').not.toBeNull();
    expect(linkRows()).toHaveLength(GIVING_PROVIDERS.length);
    // 🔴 A form with no Stripe account behind it is a form whose submit 400s.
    expect(donateButton(), 'a donate form was drawn with no Stripe account').toBeNull();
    expect(amountPresets(), 'an amount picker was drawn with no Stripe account').toHaveLength(0);
  });

  it('opens no donate path at all', async () => {
    await mount({ stripe: false, links: ALL_PROVIDERS }, { giving: true });
    expect(posts.urls).toEqual([]);
  });

  it('names the ways to give rather than calling them "other" ways', async () => {
    // With no form above them these ARE the ways to give, and a heading that
    // says otherwise names a form that is not on the page.
    await mount({ stripe: false, links: ALL_PROVIDERS }, { giving: true });
    expect(linksSection()!.textContent).toContain('Ways to give');
    expect(linksSection()!.textContent).not.toContain('Other ways to give');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Stripe ✓ links ✓ — the form, with the links beneath it
// ═════════════════════════════════════════════════════════════════════════════
describe('the Give page shows the form with links beneath when both exist', () => {
  it('shows both, with the links after the form in document order', async () => {
    await mount({ stripe: true, links: ALL_PROVIDERS }, { giving: true });

    const give = donateButton();
    const links = linksSection();
    expect(give, 'the form is missing').not.toBeNull();
    expect(links, 'the links are missing').not.toBeNull();
    // "the form, with the links beneath it" — asserted as document order, which
    // is what decides reading order on a phone and tab order everywhere.
    expect(
      give!.compareDocumentPosition(links!) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the links render above the donation form',
    ).toBeTruthy();
    expect(links!.textContent).toContain('Other ways to give');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. 🔴 What a link looks like to a member
// ═════════════════════════════════════════════════════════════════════════════
describe('each link renders a logo, a provider name and a username, and opens its URL', () => {
  it('renders a mark, the provider name and the church\'s handle for each one', async () => {
    await mount({ stripe: false, links: ALL_PROVIDERS }, { giving: true });

    for (const provider of GIVING_PROVIDERS) {
      const row = container.querySelector(`[data-provider="${provider.id}"]`)!;
      expect(row, `${provider.id} did not render`).not.toBeNull();
      // The mark. A monogram tile, not artwork — the repo carries no licensed
      // brand asset and none is scraped; see GivingLinks' own note.
      const mark = row.querySelector('[aria-hidden="true"]');
      expect(mark?.textContent, `${provider.id} lost its mark`).toBe(provider.monogram);
      expect(row.textContent, `${provider.id} lost its name`).toContain(provider.label);
      expect(row.textContent, `${provider.id} lost the church's handle`)
        .toContain(ALL_PROVIDERS[provider.id].handle);
    }
  });

  it('renders the email, which is how some people are identified', async () => {
    // The founder: "some people are being identified by the email not by the
    // username or the phone number". Rendered rather than hidden behind a tap —
    // `tenants/{id}` is world-readable by rule, so the address is public the
    // moment it is saved and tap-to-reveal would hide it only from the member.
    await mount({ stripe: false, links: ALL_PROVIDERS }, { giving: true });
    for (const provider of GIVING_PROVIDERS) {
      const row = container.querySelector(`[data-provider="${provider.id}"]`)!;
      expect(row.textContent, `${provider.id} lost its email`)
        .toContain(ALL_PROVIDERS[provider.id].email);
    }
  });

  it('opens the church\'s URL, in a new tab, with the opener severed', async () => {
    await mount({ stripe: false, links: ALL_PROVIDERS }, { giving: true });

    const paypal = container.querySelector('a[data-provider="paypal"]') as HTMLAnchorElement;
    expect(paypal, 'the PayPal row is not a link').not.toBeNull();
    expect(paypal.getAttribute('href')).toBe('https://paypal.me/gracechapel');
    expect(paypal.getAttribute('target')).toBe('_blank');
    // A church's link is a stranger's site: no window.opener, no referrer, and
    // no search-engine endorsement lent by the Harvest domain.
    const rel = paypal.getAttribute('rel') || '';
    for (const token of ['noopener', 'noreferrer', 'nofollow']) {
      expect(rel, `rel is missing ${token}`).toContain(token);
    }
  });

  it('renders a provider with no URL as a card, never as a link that does nothing', async () => {
    // Zelle. A row that looks tappable and is not is the THE-193 dead end.
    await mount({ stripe: false, links: ALL_PROVIDERS }, { giving: true });

    const zelle = container.querySelector('[data-provider="zelle"]')!;
    expect(zelle.tagName.toLowerCase(), 'a link was drawn for a provider with no URL').toBe('div');
    expect(zelle.textContent).toContain('Zelle');
    expect(zelle.textContent).toContain('zelle@grace.org');
  });

  it('🔴 never renders an href for a link that fails the phishing rule', async () => {
    // The stored value is re-validated on READ, so a document written before the
    // rule — or by anything other than the admin screen — cannot put an
    // unchecked href in front of a member.
    await mount({
      stripe: true,
      links: {
        paypal: { url: 'https://paypal.me.collect.example/x', handle: 'grace' },
        venmo: { url: 'javascript:alert(1)', handle: '@grace' },
        cashapp: { url: 'https://cash.app/$grace', handle: '$grace' },
      },
    }, { giving: true });

    const hrefs = Array.from(container.querySelectorAll('a[data-provider]')).map((a) => a.getAttribute('href'));
    expect(hrefs, 'a refused URL reached an href').toEqual(['https://cash.app/$grace']);
    expect(container.innerHTML).not.toContain('collect.example');
    expect(container.innerHTML).not.toContain('javascript:');
    // And the two refused rows still render, with the handle the church typed —
    // a bad paste loses the LINK, not the whole row.
    expect(container.querySelector('div[data-provider="paypal"]')).not.toBeNull();
    expect(container.querySelector('div[data-provider="venmo"]')).not.toBeNull();
  });

  it('tells the member these gifts are not receipted or on a statement', async () => {
    await mount({ stripe: true, links: ALL_PROVIDERS }, { giving: true });
    const copy = linksSection()!.textContent || '';
    expect(copy, 'the member is not told Harvest is not in this flow').toMatch(/not processed by Harvest/i);
    expect(copy, 'the member is not told statements will not cover these').toMatch(/giving statement/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. 🔴 Order is stable across renders
// ═════════════════════════════════════════════════════════════════════════════
describe('link order is deterministic', () => {
  it('renders the table order however the document lists the providers', async () => {
    // Reversed FROM the table, so every provider is scrambled rather than the
    // four this test was written against.
    const reversed = Object.fromEntries(
      [...GIVING_PROVIDERS].reverse().map((p) => [p.id, ALL_PROVIDERS[p.id]]),
    );
    await mount({ stripe: false, links: reversed }, { giving: true });

    expect(linkRows().map((r) => r.getAttribute('data-provider')))
      .toEqual(GIVING_PROVIDERS.map((p) => p.id));
  });

  it('renders the same order on every remount — a member finds it where it was', async () => {
    const seen: string[][] = [];
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { root?.unmount(); });
      await mount({ stripe: true, links: ALL_PROVIDERS }, { giving: true });
      seen.push(linkRows().map((r) => r.getAttribute('data-provider') as string));
    }
    for (const order of seen) expect(order, 'the giving options moved between visits').toEqual(seen[0]);
    expect(seen[0]).toEqual(GIVING_PROVIDERS.map((p) => p.id));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. 🔴 The plan gate still wins — free reaches none of it
// ═════════════════════════════════════════════════════════════════════════════
describe('a free tenant reaches none of this, rails or no rails', () => {
  it('has no Give tab and no Give page even with Stripe connected and every link pasted', async () => {
    // 🔴 `fundraising: false` means NO DONATE PAGE BY DECISION. Rails are a
    // second question asked only of a tier that is allowed to ask it — a free
    // tenant that somehow carried a Connect account and every link still has no
    // giving surface, and `/api/stripe/donate` refuses it server-side as well.
    await mount({ stripe: true, links: ALL_PROVIDERS }, { plan: 'free', giving: true });

    expect(topTab('partner'), 'free was offered a Give tab').toBeNull();
    expect(navControls('Give'), 'free was offered a desktop Give entry').toHaveLength(0);
    expect(givePage(), 'free reached the Give page').toBeNull();
    expect(linksSection(), 'free rendered payment links').toBeNull();
    expect(posts.urls, 'free opened the donate path').toEqual([]);
    expect(container.querySelector('[data-testid="news-give"]'), 'free was offered a feed giving CTA').toBeNull();
  });

  it('offers a free member no giving button in Profile either', async () => {
    await mount({ stripe: true, links: ALL_PROVIDERS }, { plan: 'free' });
    await click(profileEntry());
    expect(container.querySelector('[data-testid="profile-give"]')).toBeNull();
  });

  it('gives a paying tenant with the same rails all of it — the gate, not a broken mount', async () => {
    await mount({ stripe: true, links: ALL_PROVIDERS }, { plan: 'pro', giving: true });

    expect(topTab('partner')).not.toBeNull();
    expect(donateButton()).not.toBeNull();
    expect(linkRows()).toHaveLength(GIVING_PROVIDERS.length);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. An unresolved plan shows nothing — no flash on a cold load
// ═════════════════════════════════════════════════════════════════════════════
describe('an unresolved tenant offers no giving surface', () => {
  it('shows no Give tab while the plan has not resolved', async () => {
    store.tenantPlan = null;
    tenant.tenantPlan = null;
    tenant.isLoading = true;
    tenant.branding = { givingLinks: ALL_PROVIDERS };
    tenant.stripeConnectStatus = 'active';
    window.history.replaceState({}, '', '/?giving=1');
    await act(async () => {
      root = createRoot(container);
      root.render(<MainApp onNavigate={() => {}} />);
    });
    await act(async () => { await Promise.resolve(); });

    expect(topTab('partner'), 'the Give tab flashed on a cold load').toBeNull();
    expect(givePage(), 'the Give page mounted before the plan resolved').toBeNull();
  });
});
