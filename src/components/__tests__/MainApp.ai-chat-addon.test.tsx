import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MainApp from '../MainApp';
import { NO_ADDONS } from '../../utils/plan-features';
import type { TenantAddons } from '../../types/tenant.types';

/* ─── THE-253 — the Chat tab follows the ADD-ON, not just the tier ────────────
 *
 * 🔴 THE BUG THIS TICKET ALMOST SHIPPED. Granting `aiChat` in
 * `getEffectiveFeatures` while `MainApp` resolved its gates through
 * `getPlanFeatures` would have reproduced the original defect exactly: the
 * church pays, the entitlement resolves, and the tab is still hidden. The
 * entitlement is only real when the surface asks the TENANT question.
 *
 * ⚠️ ASSERTED AGAINST RENDERED OUTPUT, never against the tab array. #55 on the
 * marketing site is why that distinction is load-bearing there and it is
 * load-bearing here: a pure-function test passes while the JSX seam is broken.
 * The Chat button is found by its visible label among the buttons the shell
 * actually drew, so a change that keeps the constant and breaks the render
 * fails here.
 *
 * ⚠️ `plus` (Individual) THROUGHOUT, because it is the tier where the answer
 * changes. On `pro` and `max` the plan already includes the chat, so an add-on
 * test there could pass with the gate wired to anything.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

vi.mock('../../utils/member-courses', () => ({ hasMemberVisibleCourses: async () => true }));

const stub = vi.hoisted(() => (name: string) => ({ default: () => <div data-testid={name} /> }));
vi.mock('../Profile', () => stub('profile'));
vi.mock('../PartnerWithUsTab', () => stub('partner'));
vi.mock('../BlogTab', () => stub('blog'));
vi.mock('../NewsTab', () => stub('news-tab'));
vi.mock('../AllNews', () => stub('all-news'));
vi.mock('../PrayerWall', () => stub('prayer-wall'));
// Stubbed to render NO TEXT, so the only "Chat" in the document is the nav
// button this file is looking for.
vi.mock('../AIChat', () => stub('chat-screen'));
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
  tenantAddons: null as unknown,
  isLoading: false,
  stripeConnectStatus: 'active' as string | undefined,
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => tenant }));

let container: HTMLDivElement;
let root: Root;

/** The add-on set as the Dodo webhook writes it onto the tenant document. */
const owning = (over: Partial<TenantAddons>): TenantAddons => ({ ...NO_ADDONS, ...over });

async function mount(plan: string | null, addons: unknown) {
  store.tenantPlan = plan;
  tenant.tenantPlan = plan;
  tenant.tenantAddons = addons;
  tenant.isLoading = false;
  await act(async () => {
    root = createRoot(container);
    root.render(<MainApp onNavigate={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** Every nav button the shell actually DREW, by visible label. */
const navLabels = () =>
  Array.from(container.querySelectorAll('button')).map((b) => (b.textContent || '').trim());

const hasChatTab = () => navLabels().includes('Chat');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('a tenant WITHOUT the add-on does not get the AI chat', () => {
  it('draws no Chat button on Individual owning nothing', async () => {
    await mount('plus', NO_ADDONS);
    expect(hasChatTab()).toBe(false);
    // The shell rendered — this is an absent Chat tab, not an empty document.
    expect(navLabels().length).toBeGreaterThan(0);
    expect(navLabels()).toContain('Bible');
  });

  it('draws no Chat button when the add-on record is absent or junk', async () => {
    for (const nothing of [null, undefined, 'aiAssistant: 1', { aiAssistant: -1 }]) {
      await act(async () => { root?.unmount(); });
      container.remove();
      container = document.createElement('div');
      document.body.appendChild(container);
      await mount('plus', nothing);
      expect(hasChatTab(), String(nothing)).toBe(false);
    }
  });
});

describe('a tenant that owns the add-on gets the AI chat', () => {
  it('🔴 draws the Chat button on Individual — the add-on is the only difference', async () => {
    await mount('plus', owning({ aiAssistant: 1 }));
    expect(hasChatTab()).toBe(true);
  });

  it('and the AI chat screen is reachable from it', async () => {
    // A tab that renders and leads nowhere is the other half of this defect.
    await mount('plus', owning({ aiAssistant: 1 }));
    const chat = Array.from(container.querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim() === 'Chat');
    expect(chat).toBeDefined();
    await act(async () => { chat!.click(); });
    expect(container.querySelector('[data-testid="chat-screen"]')).not.toBeNull();
  });
});

describe('the tiers that already included the chat are untouched', () => {
  it.each([['pro'], ['max']])('%s keeps the Chat button owning nothing', async (plan) => {
    /* 🔴 THE NO-REGRESSION HALF. A lift written as a REPLACEMENT rather than an
       `||` would take the chat away from the two tiers that pay for it. */
    await mount(plan, NO_ADDONS);
    expect(hasChatTab()).toBe(true);
  });

  it('free still has no Chat button owning nothing', async () => {
    await mount('free', NO_ADDONS);
    expect(hasChatTab()).toBe(false);
  });
});
