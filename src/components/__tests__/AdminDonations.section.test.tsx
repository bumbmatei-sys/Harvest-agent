import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDashboard from '../AdminDashboard';
import { getPlanFeatures, PLAN_ORDER, PLAN_DISPLAY_NAMES } from '../../utils/plan-features';
import { ADMIN_SECTION_TABS, SLUG_TO_TAB, TAB_TO_SLUG } from '../../lib/admin-sections';
import { GIVING_PROVIDERS } from '../donations/giving-providers';
import type { TenantPlan } from '../../types/tenant.types';
import { SMS_FEATURE_ENABLED } from '../../lib/sms-feature';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-246 — the Donations section: where it lives, who reaches it, and what it
 * has to say before a church pastes a link.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── ⚠️ The founder's premise, checked ───────────────────────────────────────
 *
 * "in the Featured tab or sidebar depending". THERE IS NO FEATURED TAB. The
 * admin nav is Dashboard, then four sidebar groups — CONTENT, MINISTRY,
 * BROADCASTING, GROW — then Settings, and the same ids grouped again for the
 * mobile More drawer. Donations is a MINISTRY section, directly after
 * Fundraising: MINISTRY is where giving already lives, and campaigns are what
 * spend whatever this screen configures. Section 1 pins that placement so a
 * later reader can see it was chosen rather than defaulted into.
 *
 * ─── 🔴 The dead end this ticket was told to avoid ──────────────────────────
 *
 * THE-193: a CRM button pointed at a Settings screen hidden for that tier, and
 * the workflow simply ended. Moving Stripe Connect OUT of Settings is the same
 * shape of edit, so section 3 walks the REAL shell — every tier, real
 * AdminSettings, real AdminDonations — and presses the pointer. Comparing the
 * two gate expressions by eye is what THE-193 already proved insufficient.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = process.cwd();
const TENANT_ID = 'grace';

const navigate = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: {} as { section?: string; itemId?: string } }));
const isSuperAdminMock = vi.hoisted(() => vi.fn(() => false));
const hasPlatformOverrideMock = vi.hoisted(() => vi.fn(() => false));
const store = vi.hoisted(() => ({
  current: { tenantPlan: null as string | null, currentTenantId: 'grace' as string | null, isAuthReady: true },
}));
const ctx = vi.hoisted(() => ({
  current: { branding: null as unknown, isLoading: false, tenantPlan: undefined as string | undefined },
}));
const userQuery = vi.hoisted(() => ({ current: { data: undefined as unknown, isLoading: false } }));
/** What `tenants/{id}` answers with — the giving links a church already saved. */
const tenantDoc = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
/** Every Firestore write this screen makes, so a save can be read back. */
const writes = vi.hoisted(() => ({ current: [] as Array<Record<string, unknown>> }));
/** Every endpoint the screen POSTs to. */
const posts = vi.hoisted(() => ({ current: [] as string[] }));

// ── THE-256 ────────────────────────────────────────────────────────────────
// This suite pins what Stripe Connect DOES, so it runs with the master switch
// ON. That is the hide-not-delete guarantee expressed as a test: every rule
// below — the Donations screen reaching the REAL Connect control, and mounting one
// component rather than a second copy of it — still holds, unchanged, the moment
// STRIPE_CONNECT_ENABLED goes back to true. That the same route answers 503
// while the switch is OFF is asserted in the-256-stripe-connect-hidden.test.ts.
vi.mock('../../lib/stripe-connect-feature', () => ({
  STRIPE_CONNECT_ENABLED: true,
  STRIPE_CONNECT_HIDDEN_MESSAGE: 'Temporarily unavailable',
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useParams: () => params.current }));
vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdminStatus: vi.fn(async () => 'not-admin') }));
vi.mock('../../utils/tenant-scope', () => ({
  isSuperAdmin: isSuperAdminMock,
  hasPlatformOverride: hasPlatformOverrideMock,
  getTenantScope: async () => TENANT_ID,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store.current }));
vi.mock('../../hooks/queries/useUserQueries', () => ({ useCurrentUser: () => userQuery.current }));
vi.mock('../../hooks/queries/useTenantQueries', () => ({
  useTenant: () => ({ data: { name: 'Grace Ministry', ownerId: 'someone-else' }, isLoading: false }),
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => ctx.current }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'user-1', email: 'a@b.org' } } }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(async () => {}) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), query: () => ({}), where: () => ({}), limit: () => ({}),
  onSnapshot: () => () => {},
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async (ref: { __path: string }) => ({
    exists: () => true,
    data: () => (ref.__path.startsWith('tenants/') ? tenantDoc.current : { tenantId: TENANT_ID }),
  }),
  updateDoc: async (_ref: unknown, payload: Record<string, unknown>) => { writes.current.push(payload); },
}));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: async (url: string) => {
    posts.current.push(url);
    return { json: async () => ({ url: 'https://connect.stripe.test/onboard' }) };
  },
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

/**
 * 🔴 `AdminSettings`, `AdminDonations` AND `PaymentSection` ARE ALL REAL.
 *
 * The dead-end claim is about three components agreeing across a navigation,
 * so stubbing any of them would leave the claim asserted against the stub. Only
 * the Settings sections this ticket does not touch are stubbed, and the network.
 */
const stub = vi.hoisted(() => () => ({ default: () => null }));
const screenStub = vi.hoisted(() => (name: string) => async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', { 'data-screen': name }) };
});
vi.mock('../AdminBlog', stub);
vi.mock('../AdminCourses', stub);
vi.mock('../AdminRAG', stub);
vi.mock('../NewsletterCampaigns', stub);
vi.mock('../NewsletterEditor', stub);
vi.mock('../AdminFundraising', screenStub('AdminFundraising'));
vi.mock('../AdminDocs', stub);
vi.mock('../AdminEvents', stub);
vi.mock('../AdminCRM', stub);
vi.mock('../AdminAccounting', stub);
vi.mock('../AdminForms', stub);
vi.mock('../AdminCheckin', stub);
vi.mock('../AdminLivestream', stub);
vi.mock('../AdminSms', stub);
vi.mock('../AdminCommunity', stub);
vi.mock('../AdminChurches', stub);
vi.mock('../AdminBranding', stub);
vi.mock('../AdminDashboardHome', stub);
vi.mock('../PlatformInbox', stub);
vi.mock('../AdminTenants', stub);
vi.mock('../AdminLibraryCourses', stub);
vi.mock('../AdminUpgradePage', stub);
vi.mock('../AffiliateSection', stub);
vi.mock('../CanvasList', stub);
vi.mock('../CanvasEditor', stub);
vi.mock('../AdminNavCustomizer', stub);
vi.mock('../FocusScreen', stub);
vi.mock('../Profile', stub);
vi.mock('../MyAccountMenu', stub);
vi.mock('../BillingAndPayments', stub);
vi.mock('../GraceWindowBanner', stub);
vi.mock('../settings/OnboardingSection', stub);
vi.mock('../settings/GivingStatementsSection', stub);
vi.mock('../settings/SmsSection', stub);
vi.mock('../settings/AiAssistantSection', stub);
vi.mock('../settings/IntegrationsSection', stub);
vi.mock('../ThemeToggle', stub);
vi.mock('../PaletteFamilyToggle', stub);
vi.mock('../PlanUpgradeScreen', async () => {
  const React = await import('react');
  return {
    default: ({ featureName }: { featureName: string }) =>
      React.createElement('div', { 'data-upgrade-wall': featureName }),
  };
});

let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
};

async function unmount() {
  if (!mounted) return;
  await act(async () => { root.unmount(); });
  mounted = false;
}

type Who = { role?: string; permissions?: Record<string, boolean> };

async function open(plan: TenantPlan | null, section: string, who: Who = {}) {
  await unmount();
  store.current = { ...store.current, tenantPlan: plan };
  ctx.current = { ...ctx.current, tenantPlan: plan ?? undefined };
  params.current = section ? { section } : {};
  userQuery.current = {
    data: {
      role: who.role ?? 'church_admin',
      permissions: who.permissions ?? { fullAccess: true },
      displayName: 'Admin', email: 'a@b.org', photoURL: null,
    },
    isLoading: false,
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminDashboard onNavigate={() => {}} />);
    mounted = true;
  });
  await flush();
}

/** Every nav control's label. */
const navLabels = (): string[] => [
  ...Array.from(container.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
  /* THE-332 — the desktop nav is a RAIL. A group's tabs are advertised on its
     rail entry because the flyout that draws them unmounts while it is closed,
     and the two pinned entries are icon-only so their name is the accessible
     one. THE-332.nav-rail.test.tsx holds the advertised model equal to what the
     flyout renders, so nothing unreachable can be reported here. */
  ...Array.from(container.querySelectorAll('[data-nav-group-labels]')).flatMap((g) =>
    (g.getAttribute('data-nav-group-labels') || '').split('|').filter(Boolean),
  ),
  ...Array.from(container.querySelectorAll('[data-nav-rail-tab]')).map(
    (b) => b.getAttribute('aria-label') || '',
  ),
];

const byText = (needle: string): HTMLElement | null =>
  (Array.from(container.querySelectorAll('button, a')) as HTMLElement[]).find(
    (el) => (el.textContent || '').trim() === needle,
  ) ?? null;

const upgradeWall = () => container.querySelector('[data-upgrade-wall]')?.getAttribute('data-upgrade-wall') ?? null;
/** The Stripe Connect panel, addressed by the control that actually connects. */
const connectStripeButton = (): HTMLElement | null =>
  (Array.from(container.querySelectorAll('button')) as HTMLElement[]).find((b) =>
    /Connect Stripe Account/i.test(b.textContent || ''),
  ) ?? null;
const linksEditor = () => container.querySelector('#giving-paypal-url');

async function click(el: Element | null, what: string) {
  expect(el, `${what} was not rendered`).not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); });
  await flush();
}

/**
 * Press a control and FOLLOW wherever it navigated.
 *
 * 🔴 The router is mocked, so a `navigate('/admin/donations')` would otherwise
 * be recorded and go nowhere — and a dead-end test that never leaves the page
 * it started on proves nothing. This reads the address the shell actually asked
 * for, feeds it back through `useParams` exactly as React Router would, and
 * re-renders the SAME root so the shell decides what to mount from the new URL.
 */
async function clickAndFollow(el: Element | null, what: string) {
  navigate.mockClear();
  await click(el, what);
  const calls = navigate.mock.calls as [string][];
  expect(calls.length, `${what} navigated nowhere`).toBeGreaterThan(0);
  const path = calls[calls.length - 1][0];
  const [, section, itemId] = path.replace(/^\/admin\/?/, '/').split('/');
  params.current = section ? { section, ...(itemId ? { itemId } : {}) } : {};
  await act(async () => { root.render(<AdminDashboard onNavigate={() => {}} />); });
  await flush();
  return path;
}

const PRICED = PLAN_ORDER.filter((p) => getPlanFeatures(p).fundraising);

beforeEach(() => {
  vi.clearAllMocks();
  store.current = { tenantPlan: null, currentTenantId: TENANT_ID, isAuthReady: true };
  ctx.current = { branding: null, isLoading: false, tenantPlan: undefined };
  tenantDoc.current = {};
  writes.current = [];
  posts.current = [];
  isSuperAdminMock.mockReturnValue(false);
  hasPlatformOverrideMock.mockReturnValue(false);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmount();
  container.remove();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. 🔴 The section exists only where `fundraising` is true
// ═════════════════════════════════════════════════════════════════════════════
describe('the Donations section appears only where fundraising is true', () => {
  for (const plan of PRICED) {
    it(`${PLAN_DISPLAY_NAMES[plan]} has a Donations entry in the nav`, async () => {
      await open(plan, '');
      expect(navLabels(), `${plan} has no Donations entry`).toContain('Donations');
    });
  }

  it('🔴 free has no Donations entry at all — not a walled one, an absent one', async () => {
    // Free carries `fundraising: false` and has NO DONATE PAGE BY DECISION
    // (THE-202/THE-213). A visible-but-walled tab would put a Connect button
    // one click away, behind a screen that asks a church for its bank details
    // to receive money that cannot arrive — the surface THE-225 removed from
    // Settings after the founder reported it three times.
    await open('free', '');
    expect(navLabels(), 'free was offered a Donations tab').not.toContain('Donations');
    // And the tiers around it prove the gate is the cell, not the test.
    expect(getPlanFeatures('free').fundraising).toBe(false);
    expect(PLAN_ORDER.filter((p) => !getPlanFeatures(p).fundraising)).toEqual(['free']);
  });

  it('lives in the MINISTRY group, next to Fundraising — the placement, pinned', async () => {
    // ⚠️ There is no "Featured" tab in this nav; see the header note. Both nav
    // definitions (desktop sidebar, mobile More drawer) are asserted, because a
    // section added to one and not the other is invisible on half the devices.
    const src = readFileSync(join(ROOT, 'src/components/AdminDashboard.tsx'), 'utf8');
    const groups = [...src.matchAll(/\{ label: 'MINISTRY', ids: \[([^\]]+)\] \}/g)]
      .map((m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')));
    expect(groups.length, 'the MINISTRY group is no longer declared twice').toBe(2);
    for (const ids of groups) {
      expect(ids, 'Donations is missing from a MINISTRY group').toContain('donations');
      expect(ids.indexOf('donations'), 'Donations no longer follows Fundraising')
        .toBe(ids.indexOf('fundraising') + 1);
    }
  });

  it('is registered in the section vocabulary, so its URL round-trips', async () => {
    expect(ADMIN_SECTION_TABS).toContain('donations');
    expect(TAB_TO_SLUG.donations).toBe('donations');
    expect(SLUG_TO_TAB.donations).toBe('donations');
  });

  it('needs the permission its own writes need, not the fundraising one', async () => {
    // 🔴 The links are written to `tenants/{id}.config`, and firestore.rules
    // lets a non-super-admin update that document only with manageBranding or
    // manageSettings. An editor whose Save can only ever be denied is worse
    // than an absent tab.
    const onlyFundraising = { role: 'admin', permissions: { manageFundraising: true } };
    const onlySettings = { role: 'admin', permissions: { manageSettings: true } };
    await open('max', '', onlyFundraising);
    expect(navLabels(), 'the fundraising role alone opened the links editor').not.toContain('Donations');
    await open('max', '', onlySettings);
    expect(navLabels()).toContain('Donations');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Stripe Connect is reachable from the Donations section
// ═════════════════════════════════════════════════════════════════════════════
describe('Stripe Connect is reachable from the Donations section', () => {
  for (const plan of PRICED) {
    it(`${PLAN_DISPLAY_NAMES[plan]} reaches the real Connect control there`, async () => {
      await open(plan, 'donations');
      expect(upgradeWall(), `${plan} was walled out of Donations`).toBeNull();
      expect(connectStripeButton(), `${plan} cannot connect Stripe from Donations`).not.toBeNull();
    });
  }

  it('the Connect button still opens the same onboarding endpoint', async () => {
    // The button is the real `PaymentSection`, so this is the actual route the
    // church has always been sent to — nothing about Connect moved, only where
    // the panel is mounted.
    await open('pro', 'donations');
    await click(connectStripeButton(), 'the Connect Stripe button');
    /**
     * ─── AMENDED BY THE-351 — narrowed to STRIPE, which is the whole claim ────
     *
     * THE-351 puts a per-tenant inbox badge in the admin shell's header, so the
     * shell this screen is mounted inside now makes a read of its own
     * (`/api/event-payment/inbox`) that has nothing to do with Connect.
     *
     * 🔴 NOTHING IS LOOSENED. This case is about the ONBOARDING ENDPOINT and
     * about there being exactly one of it: a second Stripe call, a changed
     * path, or a Connect button that stopped calling anything all still fail.
     * What it no longer asserts is that the surrounding SHELL makes no requests
     * — which it never set out to assert, and which would make this suite fail
     * for every future feature that reads anything.
     */
    const stripeCalls = posts.current.filter((u) => u.startsWith('/api/stripe/'));
    expect(stripeCalls, 'the Connect onboarding endpoint changed').toEqual(['/api/stripe/connect']);
  });

  it('🔴 mounts ONE component, not a second copy of the Stripe panel', async () => {
    // The ticket's constraint, asserted at the import graph. Exactly two screens
    // mount `PaymentSection`: its new home, and Fundraising — which keeps the
    // path the fundraising role already had. Settings mounts it nowhere.
    const mounts = ['AdminDonations', 'AdminFundraising', 'AdminSettings']
      .map((f) => [f, readFileSync(join(ROOT, `src/components/${f}.tsx`), 'utf8')] as const)
      .filter(([, src]) => /<PaymentSection\b/.test(src))
      .map(([f]) => f);
    expect(mounts.sort()).toEqual(['AdminDonations', 'AdminFundraising']);
  });

  it('holds the links editor beside it — one screen, both ways of being paid', async () => {
    await open('pro', 'donations');
    expect(linksEditor(), 'the payment-links editor is missing').not.toBeNull();
    for (const provider of GIVING_PROVIDERS) {
      expect(container.querySelector(`#giving-${provider.id}-url`), `${provider.id} has no URL field`).not.toBeNull();
      expect(container.querySelector(`#giving-${provider.id}-handle`), `${provider.id} has no handle field`).not.toBeNull();
      expect(container.querySelector(`#giving-${provider.id}-email`), `${provider.id} has no email field`).not.toBeNull();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. 🔴 The dead-end guard
// ═════════════════════════════════════════════════════════════════════════════
describe('no path points at a hidden or removed Settings screen', () => {
  for (const plan of PRICED) {
    it(`${PLAN_DISPLAY_NAMES[plan]}'s Settings pointer actually opens Donations`, async () => {
      // Walked, not compared: mount the real shell on Settings, open the row,
      // press the pointer, and assert the Donations screen is what appears.
      await open(plan, 'settings');
      await click(byText('Donations & payment links'), 'the Settings Payments row');
      const landed = await clickAndFollow(byText('Open Donations'), 'the Open Donations button');

      expect(landed, 'the pointer went somewhere other than the Donations section')
        .toBe('/admin/donations');
      expect(upgradeWall(), 'the pointer landed on an upgrade wall').toBeNull();
      expect(connectStripeButton(), 'the pointer did not reach Stripe Connect').not.toBeNull();
      expect(linksEditor(), 'the pointer did not reach the links editor').not.toBeNull();
    });
  }

  it('offers no pointer on a tier that has no Donations section to open', async () => {
    // The other half of the same claim: free sees neither the row nor the tab,
    // so there is no link and no destination — rather than a link to nothing.
    await open('free', 'settings');
    expect(byText('Donations & payment links'), 'free was offered the pointer').toBeNull();
    expect(container.textContent, 'a Stripe Connect control survived in free Settings')
      .not.toMatch(/Connect Stripe/);
    expect(navLabels()).not.toContain('Donations');
  });

  it('makes the pointer impossible to write without a destination', async () => {
    // 🔴 THE STRUCTURAL HALF. `onOpenDonations` is REQUIRED on AdminSettings, so
    // a caller that cannot navigate cannot compile — which is a stronger
    // guarantee than any assertion here, and the reason THE-193 cannot recur in
    // this shape. Pinned as source so a later edit cannot quietly make it
    // optional and reintroduce the silent no-op.
    const settings = readFileSync(join(ROOT, 'src/components/AdminSettings.tsx'), 'utf8');
    expect(settings, '`onOpenDonations` became optional').toMatch(/^\s*onOpenDonations: \(\) => void;$/m);
    expect(settings, 'the pointer no longer calls it').toMatch(/onClick=\{onOpenDonations\}/);
    const shell = readFileSync(join(ROOT, 'src/components/AdminDashboard.tsx'), 'utf8');
    expect(shell, 'the shell no longer hands Settings a destination')
      .toMatch(/onOpenDonations=\{\(\) => go\('donations'\)\}/);
  });

  it('leaves every other Settings row reaching what it always did', async () => {
    // The move must not take the rest of the screen with it.
    //
    // 🔴 THE-250 — "SMS (Twilio)" is spread on the master switch, not dropped
    // from this list. This assertion's job is that the DONATIONS move took no
    // other row with it, so the row has to stay named here: with
    // SMS_FEATURE_ENABLED off it is absent for a reason that is not this
    // ticket's, and with it on this guard must catch the Donations move
    // breaking it again. A hardcoded list would have to pick one of those.
    await open('max', 'settings');
    const labels = navLabels();
    for (const row of ['Appearance', 'Onboarding Questions', 'Giving Statements',
                       ...(SMS_FEATURE_ENABLED ? ['SMS'] : []), 'Integrations']) {
      expect(labels, `Settings lost its "${row}" row`).toContain(row);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. 🔴 A free tenant reaches none of this
// ═════════════════════════════════════════════════════════════════════════════
describe('a free tenant reaches none of this', () => {
  it('is bounced off /admin/donations rather than shown a Connect button', async () => {
    await open('free', 'donations');
    expect(connectStripeButton(), 'free reached a Stripe Connect button').toBeNull();
    expect(linksEditor(), 'free reached the payment-links editor').toBeNull();
    // The redirect guard builds `known` from the tabs a tier actually has, so a
    // typed URL for a section it does not have goes to its first tab. Either
    // that or the upgrade wall is a refusal; a Connect button is not.
    expect(upgradeWall() ?? 'redirected').toBeTruthy();
  });

  it('writes nothing to the tenant document on the way past', async () => {
    await open('free', 'donations');
    expect(writes.current, 'a refusal wrote to Firestore').toEqual([]);
  });

  it('gives a paying tier the same URL in full — the gate, not a broken route', async () => {
    await open('plus', 'donations');
    expect(connectStripeButton()).not.toBeNull();
    expect(linksEditor()).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. 🔴 What the admin copy has to say
// ═════════════════════════════════════════════════════════════════════════════
describe('the admin copy states that Harvest does not process these gifts and that statements will not include them', () => {
  it('says Harvest is not in the flow, in the church\'s own words', async () => {
    await open('pro', 'donations');
    const copy = container.textContent || '';
    expect(copy, 'the church is not told Harvest does not process these')
      .toMatch(/Harvest does not process these gifts/i);
    expect(copy, 'the church is not told there is no Harvest fee').toMatch(/no Harvest fee/i);
    expect(copy, 'the church is not told the money goes straight to its own account')
      .toMatch(/straight from your member to your own/i);
  });

  it('🔴 warns that these gifts are not recorded until a church records them', async () => {
    /**
     * 🔴 AMENDED BY THE-350 — and the amendment is a correction, not a
     * loosening.
     *
     * THE-249 asserted "will not appear on giving statements" and "Only gifts
     * given through Stripe are recorded and receipted". Both were true of a
     * manual entry that wrote a `contactActivities` row and nothing else. Add
     * Activity → Donation now writes the same `donation_receipt` invoice the
     * Stripe webhook writes, so both sentences became FALSE — and a screen
     * telling a church its own books cannot hold a gift they just recorded is
     * the same class of false claim this file exists to catch.
     *
     * The GAP is still real and still asserted: Harvest never SEES a gift sent
     * through a church's own link, so nothing records it on its own. What
     * changed is the remedy — it is now whole, and the copy has to say which.
     */
    await open('pro', 'donations');
    const copy = container.textContent || '';
    expect(copy, 'the gap is not stated')
      .toMatch(/not recorded until you record them/i);
    expect(copy, 'the donation-history gap is not stated').toMatch(/donation history/i);
    // 🔴 The old contrast is GONE, because it is no longer true.
    expect(copy, 'the screen still says only Stripe gifts are recorded')
      .not.toMatch(/Only\s+gifts given through Stripe are recorded and receipted/i);
    // 🔴 And the whole remedy is named, all five surfaces of it.
    expect(copy, 'the remedy is not named').toMatch(/press Add Activity, choose Donation/i);
    expect(copy, 'the remedy does not say the gift reaches the dashboard')
      .toMatch(/counts on your dashboard/i);
    expect(copy, 'the remedy does not say the gift reaches the giving statement')
      .toMatch(/giving statement/i);
    // 🔴 And the ONE exception is named where a church will read it.
    expect(copy, 'the no-email consequence is not stated')
      .toMatch(/no email address is the one exception/i);
  });

  it('says the emails will be public BEFORE a church types one', async () => {
    // `tenants/{id}` is world-readable by rule, so an address here is published
    // the moment it is saved. Asserted as DOCUMENT ORDER: a warning a person
    // reads after they have finished is a warning that did not work.
    await open('pro', 'donations');
    const copy = container.textContent || '';
    expect(copy).toMatch(/shown publicly on your Give page, including the email/i);

    const warning = Array.from(container.querySelectorAll('p'))
      .find((p) => /shown publicly on your Give page/i.test(p.textContent || ''))!;
    const firstField = container.querySelector(`#giving-${GIVING_PROVIDERS[0].id}-url`)!;
    expect(
      warning.compareDocumentPosition(firstField) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the public-email warning sits below the fields it is about',
    ).toBeTruthy();
  });

  it('marks Stripe as the half that IS recorded and receipted', async () => {
    await open('pro', 'donations');
    expect(container.textContent, 'the Stripe block no longer says what it buys')
      .toMatch(/records every gift, sends\s*the receipt/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Saving — validated on the way in, and nothing else on `config` disturbed
// ═════════════════════════════════════════════════════════════════════════════
describe('the links editor writes only validated values, at a dotted path', () => {
  it('stores a good paste and drops a look-alike, in the same save', async () => {
    await open('pro', 'donations');
    const type = async (id: string, value: string) => {
      const input = container.querySelector(`#${id}`) as HTMLInputElement;
      expect(input, `${id} is missing`).not.toBeNull();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await type('giving-paypal-url', 'https://paypal.me/gracechapel');
    await type('giving-paypal-handle', 'gracechapel');
    await type('giving-paypal-email', 'Giving@Grace.ORG');
    await type('giving-cashapp-url', 'https://cash.app.collect.example/$grace');

    // A refused URL blocks the save outright, so a church cannot half-publish a
    // phishing link by pressing Save past an error.
    const save = () => (Array.from(container.querySelectorAll('button')) as HTMLElement[])
      .find((b) => /Save payment links/i.test(b.textContent || ''))!;
    expect((save() as HTMLButtonElement).disabled, 'Save was live with a refused link on screen').toBe(true);
    expect(container.textContent).toMatch(/has to be a Cash App link/i);

    await type('giving-cashapp-url', '');
    expect((save() as HTMLButtonElement).disabled, 'Save stayed dead after the bad link was cleared').toBe(false);
    await click(save(), 'the Save button');

    expect(writes.current).toHaveLength(1);
    const payload = writes.current[0];
    // 🔴 A DOTTED PATH. `config` carries branding, the onboarding questions and
    // the custom domain; writing the whole object would erase them.
    expect(Object.keys(payload)).toEqual(['config.givingLinks']);
    expect(payload['config.givingLinks']).toEqual({
      paypal: { url: 'https://paypal.me/gracechapel', handle: 'gracechapel', email: 'giving@grace.org' },
    });
  });

  it('loads what is already saved rather than showing an empty form', async () => {
    tenantDoc.current = {
      config: { givingLinks: { venmo: { url: 'https://venmo.com/u/grace', handle: '@grace' } } },
    };
    await open('pro', 'donations');
    expect((container.querySelector('#giving-venmo-url') as HTMLInputElement).value)
      .toBe('https://venmo.com/u/grace');
    expect((container.querySelector('#giving-venmo-handle') as HTMLInputElement).value).toBe('@grace');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. 🔴 No money path changed
// ═════════════════════════════════════════════════════════════════════════════
describe('no Stripe Connect route, donation route, fee or receipt path changed', () => {
  /**
   * ⚠️ DIGESTS RECORDED AS LITERALS, not a `git show` at assertion time. CI's
   * clone depth is not this suite's business, and a shell-out would make it one
   * — the same rule `posthog-admin-sections.test.ts` already follows for
   * `layout.tsx`, `firestore.rules` and `functions/src/index.ts`. (The last two
   * digests below are byte-identical to the ones pinned there, which is a free
   * cross-check that neither file moved.)
   *
   * Every file here is a path money travels: onboarding, the callback, the
   * dashboard login link, the Connect webhook, the donate route, the fee map,
   * receipts, donation history, the statement generator, and the public
   * campaign page's own `fundraising` gate. THE-246 touches none of them — it
   * moves WHERE the Connect panel is mounted and adds a second, separate way to
   * give that Harvest is deliberately not part of.
   */
  const UNCHANGED: Readonly<Record<string, string>> = {
    /*
     * ─── THE-256 RE-RECORDED THESE FOUR, deliberately and with one reason ───
     *
     * 🔴 Stripe closed the platform account as `rejected.fraud` on 2026-08-27
     * (appeal pending). Each of these four routes now answers 503 while
     * `STRIPE_CONNECT_ENABLED` is false, and that is the WHOLE edit to each:
     * one refusal, first in the handler, ahead of auth and ahead of Firestore.
     *
     * What THE-246 pinned here was that no money path MOVED, and that claim
     * survives literally: nothing below the added block changed a byte, so the
     * fee, the direct charge, the account type, the callback's redirects and
     * THE-148's gone-account answers are all exactly as they were, and this
     * suite's own behavioural sections above still pass — they now run with the
     * switch mocked ON, which is what proves the gate is additive rather than a
     * rewrite. The 503s are asserted in
     * `src/lib/__tests__/the-256-stripe-connect-hidden.test.ts`.
     */
    /*
     * ─── RE-RECORDED BY THE-152, and by nothing else since THE-256 ──────────
     *
     * 🔴 A COMMENT, NOT A MONEY PATH. The affiliate note by the Standard-account
     * creation claimed affiliate payout accounts "are deliberately NOT changed",
     * while this very route writes `affiliateStripeAccountId` /
     * `affiliateConnectStatus` onto the connecting user in both branches. It now
     * says what the code does: the standalone payout-only account stays Express,
     * and the affiliate mirror here only ever refuses a DIFFERENT, already-active
     * account (`mirrorSafe`).
     *
     * What THE-246 pinned here still holds literally: no money path moved. The
     * comment-stripped source is byte-identical to the previous digest's, which
     * `src/lib/__tests__/the-155-the-152-stale-money-path-comments.test.ts`
     * asserts rather than asks you to take on trust.
     */
    'src/app/api/stripe/connect/route.ts':
      '2c3cb84321cead669bc582e9d8c5cda90cbc5ab675d2d9eab4d1cd52d365b5e3',
    'src/app/api/stripe/connect/callback/route.ts':
      '09268d95196960479fd56a0c49e432b92bbc207db959edd06898bdca28e258dc',
    'src/app/api/stripe/connect/login-link/route.ts':
      '01705197e9828011eb135bbc71e831265005dc039e493b00dd1257d1c259bd36',
    /*
     * 🔴 NOT re-recorded, and that is the point: THE-256 deliberately leaves the
     * Connect webhook ungated. It confirms donations and paid event tickets, so
     * it must stay live for anything in flight, and it is harmless idle.
     */
    'src/app/api/stripe/connect/webhook/route.ts':
      'febfc599c9ffedb31843bc7cb00e58ae50fb2db09998dfd455ad6b2d37054b1e',
    'src/app/api/stripe/donate/route.ts':
      '04c78731552a29297e41495af61e5202eae7461d954806a3792c0e763ccd26b9',
    /*
     * ─── RE-RECORDED BY THE-155, for a stale docblock and nothing else ──────
     *
     * 🔴 Two comments still called paid event tickets DESTINATION charges.
     * THE-154 converted them to direct charges — the last destination charge in
     * the codebase — so the prose next to the fee map described a topology that
     * had been removed. `PLATFORM_FEE_MAP` itself is byte-identical and still 0
     * on every tier, which the suite below re-asserts.
     */
    'src/lib/stripe-connect.ts':
      'ca494d925deb1e6dde5a740cbef0c1d24fc48e8e8655222b53ba4cda19b4d6e1',
    'src/lib/donation-receipt.ts':
      'a7d4872a73e7eb3518d47c264373428d1663afd43032506e5402123cdab1723a',
    'src/lib/donation-history.ts':
      '47e4c9edfe038efd2497df976254868faef08f8a6c208b4885203908ffda19db',
    'src/lib/donation-webhook.ts':
      'f835ce195029a246a06d00e4202f8149c54b3a37b4ad9e425a7c1081a317aeed',
    'src/lib/connect-return-url.ts':
      '71bc1aff6e65a3aa0e99ebc003b148999588e99167a18cc90f5d84f2dbae5fee',
    'src/app/api/giving-statements/generate/route.ts':
      '5e7778c1d12f8cd19143a6e6aad0a361dfc0925fb6eaf80355dc1eff2e3f1158',
    'src/app/api/giving-statements/config/route.ts':
      '48ad99a41cafd02a423493abf73308195108551c0da9d542f979f6cf8cc083b6',
    /*
     * ⚠️ RE-RECORDED BY THE-256, and for the same reason as the four routes.
     *
     * The Connect panel is now WRAPPED in `STRIPE_CONNECT_ENABLED` — a wrapper
     * around the existing component, not an early return inside it, so its hooks
     * are never conditionally called and no `tenants/{id}` read fires to paint a
     * status nobody is being shown.
     *
     * 🔴 STILL ONE COMPONENT AND ONE ANSWER TO "ARE WE CONNECTED". All four
     * status branches — active, pending, restricted, not connected — are
     * byte-identical inside the wrapper, and the "mounts ONE component, not a
     * second copy" test above still holds: nothing was forked, copied or
     * deleted. That test, and every other behavioural one in this file, now runs
     * with the switch mocked ON, which is the restore proof.
     */
    /**
     * RE-RECORDED BY THE-362, and here is the whole of what moved: ONE
     * WORD OF COPY, in the HIDDEN branch.
     *
     * The founder: "Hide everything that talks about stripe. In donations,
     * everywhere." THE-350 rewrote the sentence this panel shows while Connect
     * is off and left the processor's NAME as the heading above it, so the one
     * screen that ticket was about still read "Stripe Connect" to a church.
     * That `<h3>` now reads "Card giving".
     *
     * NO MONEY PATH MOVED, which is what this pin exists to prove:
     *
     *   • `StripeConnectPanel` — every one of its four status branches, both
     *     of its fetches and all three of its handlers — is BYTE-FOR-BYTE
     *     untouched. It is still not mounted while the switch is off, and it
     *     still comes back whole when the switch goes on, exactly as THE-256
     *     requires.
     *   • `STRIPE_CONNECT_ENABLED` and `STRIPE_CONNECT_HIDDEN_MESSAGE` are
     *     read from `lib/stripe-connect-feature.ts`, which is untouched.
     *   • no route, no fee, no receipt path and no Firestore call changed.
     *   • `data-testid="stripe-connect-hidden"` is unchanged: it names the
     *     STATE, not the copy, and no church ever reads it.
     */
    'src/components/settings/PaymentSection.tsx':
      '3ca18f998b4cce909523f132e0871847438b569729084fb92d260e5c3eca636f',
    /*
     * ⚠️ RE-RECORDED BY THE-251, and by nothing else in this list.
     *
     * THE-246 pinned this file to prove it changed no money path. THE-251
     * DELIBERATELY edits it: the campaign page now derives the church's own
     * payment links from the `tenant.config` it already read for the logo, and
     * hands them to PublicCampaign.
     *
     * What that edit is NOT is a change to a money path, and the two assertions
     * that matter say so rather than asking a reader to take it on trust:
     *
     *   • `loadCampaign`'s gate is untouched — the free-tier `fundraising`
     *     refusal, the cross-tenant check, the pledge-type refusal and the
     *     `isActive` check are byte-identical, and
     *     public-page-plan-gates.test.ts still pins them.
     *   • every OTHER digest in this list is unchanged, `donation-webhook.ts`
     *     among them — which is the file that increments `raised` on a Stripe
     *     gift. Its digest below is the proof that THE-251 did not touch how
     *     Stripe gifts update a campaign total.
     */
    /*
     * ─── ⚠️ RE-RECORDED AGAIN BY THE-303, and here is the whole of what moved ──
     *
     * The founder: "If stripe is not connected, the fundraising page shall only
     * show the donation links. Wise etc." This page drew the amount picker, the
     * donor fields, the Donate button and "Secure payment powered by Stripe"
     * for EVERY tenant — so with `STRIPE_CONNECT_ENABLED` false (THE-256) and
     * no church connected, a public appeal led with an action that posts to
     * `/api/stripe/donate` and comes back 503.
     *
     * TWO ADDITIONS, and nothing else in the file moved:
     *
     *   1. an import of `STRIPE_CONNECT_ENABLED`, and
     *   2. one derived boolean — `STRIPE_CONNECT_ENABLED && tenant
     *      .stripeConnectStatus === 'active'` — handed to PublicCampaign as
     *      `showDonationForm`.
     *
     * 🔴 STILL NOT A MONEY-PATH CHANGE, and the same two assertions THE-251
     * leaned on say so:
     *
     *   • `loadCampaign`'s gate is byte-identical — the free-tier `fundraising`
     *     refusal, the cross-tenant check, the pledge-type refusal and the
     *     `isActive` check are untouched, and public-page-plan-gates.test.ts
     *     still pins them. The new flag is read AFTER that gate and can only
     *     ever draw LESS, never admit a page that would have been refused.
     *   • every other digest in this list is unchanged — the donate route,
     *     `PLATFORM_FEE_MAP`, `donation-webhook.ts` and the receipt paths
     *     among them. What a gift does once it exists did not move; what moved
     *     is whether a form that cannot create one is drawn at all.
     *
     * ⚠️ `lib/stripe-connect-feature.ts` IS UNTOUCHED. Reading the switch is not
     * restoring Connect UI: flip that one value and this page's form returns
     * exactly as it was.
     */
    'src/app/campaign/[campaignId]/page.tsx':
      '4e7181866e9487913ef7e458229c950e0f1b94572e2b4cdf5619cc6c26ffdcf8',
    'functions/src/index.ts':
      '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b',
  };

  /**
   * 🔴 THE-325 · the accepted SET moved to `__fixtures__/ownership/`, the
   * ASSERTION stayed here. This suite still says what it always said: the
   * `firestore.rules` on disk is at a digest some ticket recorded, and so
   * THIS ticket did not touch a file that auto-deploys to production with no
   * emulator test in CI. Only the list of accepted values is now shared, so
   * a legitimate rules change is one new record rather than 50 edits.
   */
  it('firestore.rules is byte-for-byte unchanged', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it.each(Object.keys(UNCHANGED))('%s is byte-for-byte unchanged', (file) => {
    const digest = createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex');
    expect(digest, `${file} changed — this ticket must not touch a money path`).toBe(UNCHANGED[file]);
  });

  it('adds no second donate endpoint, and no fee anywhere in the new code', async () => {
    // 🔴 Harvest is not in the manual-links flow AT ALL. Nothing this ticket
    // adds may compute a fee, take a cut, or post money anywhere: the links are
    // anchors, and the only endpoint the new screen touches is the Connect
    // onboarding one Stripe already owned.
    const NEW_FILES = [
      'src/components/AdminDonations.tsx',
      'src/components/donations/giving-providers.ts',
      'src/components/donations/GivingLinks.tsx',
    ];
    for (const file of NEW_FILES) {
      const src = readFileSync(join(ROOT, file), 'utf8')
        .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, `${file} computes a fee`).not.toMatch(/application_fee|PLATFORM_FEE|feePercent/);
      expect(src, `${file} posts to a donate or checkout endpoint`)
        .not.toMatch(/api\/stripe\/(donate|checkout)/);
    }
  });

  it('leaves the member donate form posting exactly where it did', async () => {
    const partner = readFileSync(join(ROOT, 'src/components/PartnerWithUsTab.tsx'), 'utf8');
    expect(partner).toContain("authFetch('/api/stripe/donate'");
    expect((partner.match(/authFetch\(/g) ?? []).length, 'the Give page gained a second endpoint').toBe(1);
  });
});
