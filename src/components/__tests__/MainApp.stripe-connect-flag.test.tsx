import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MainApp from '../MainApp';

/**
 * The fundraising-chooser Stripe flag fix, member-app half.
 *
 * `hasStripeGiving` used to be `isMainSite || stripeConnectStatus === 'active'`
 * — no read of `STRIPE_CONNECT_ENABLED` at all. `isMainSite` short-circuits
 * before any tenant document exists, so the platform's OWN apex Give page
 * always drew the amount picker, the One-Time/Monthly toggle and "Secure,
 * encrypted payment via Stripe" — even while the platform's own Stripe account
 * is closed (THE-256) and `/api/stripe/donate` already refuses every request
 * with 503. `app/campaign/[campaignId]/page.tsx` already reads
 * `STRIPE_CONNECT_ENABLED && stripeConnectStatus === 'active'` for the same
 * reason (THE-303); this file did not match it despite claiming to.
 *
 * Unlike the other MainApp giving suites, this file does NOT mock
 * `stripe-connect-feature` — it asserts against the real, current value of
 * `STRIPE_CONNECT_ENABLED`, which is `false` while the platform account is
 * closed. If that value ever flips to `true`, this suite's "flag off" cases
 * would need inverting — which is the point: it is pinned to the live switch,
 * not to a stand-in.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  doc: () => ({}),
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
}));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: vi.fn() }));
vi.mock('../../utils/member-courses', () => ({ hasMemberVisibleCourses: async () => true }));

const stub = vi.hoisted(() => (name: string) => ({ default: () => <div data-testid={name} /> }));
vi.mock('../Profile', () => stub('profile'));
vi.mock('../NewsTab', () => stub('news-tab'));
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
vi.mock('../ErrorBoundary', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
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
  tenantId: undefined as string | undefined,
  tenantName: 'Harvest',
  branding: {} as any,
  tenantPlan: 'pro' as string | null,
  isLoading: false,
  stripeConnectStatus: undefined as string | undefined,
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => tenant }));

let container: HTMLDivElement;
let root: Root;

async function mount(opts: { tenantId?: string; stripeConnectStatus?: string; plan?: string | null } = {}) {
  tenant.tenantId = opts.tenantId;
  tenant.stripeConnectStatus = opts.stripeConnectStatus;
  tenant.tenantPlan = opts.plan ?? 'pro';
  store.tenantPlan = opts.plan ?? 'pro';
  tenant.isLoading = false;
  tenant.branding = {};
  await act(async () => {
    root = createRoot(container);
    root.render(<MainApp onNavigate={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

const donateButton = (): HTMLElement | null =>
  Array.from(container.querySelectorAll('button')).find((b) => /^Give \$/.test((b.textContent || '').trim())) ?? null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('the apex Give page no longer promises card giving while STRIPE_CONNECT_ENABLED is off', () => {
  it('shows no donate form on the platform apex site (no tenantId, isMainSite)', async () => {
    await mount({ tenantId: undefined });
    expect(donateButton(), 'the apex Give page still drew a donate form').toBeNull();
    expect(container.textContent).not.toContain('Secure, encrypted payment via Stripe');
    expect(container.textContent).not.toContain('Monthly');
  });

  it('shows no donate form on the `harvest` platform tenant id either', async () => {
    await mount({ tenantId: 'harvest' });
    expect(donateButton(), 'the platform tenant id still drew a donate form').toBeNull();
  });

  it('still shows no donate form for a white-label tenant with a stale "active" Stripe status', async () => {
    // A church connected before the platform account closed keeps its stored
    // status per THE-256's own contract — this is exactly that tenant.
    await mount({ tenantId: 'tenant-1', stripeConnectStatus: 'active' });
    expect(donateButton(), 'a stale connected status still drew a donate form').toBeNull();
  });
});
