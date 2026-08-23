import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PLAN_ORDER, PLAN_DISPLAY_NAMES, getPlanFeatures } from '@/utils/plan-features';

/**
 * THE-213 — THE TWO PUBLIC, SERVER-RENDERED PAGES.
 *
 * Both are `force-dynamic`, unauthenticated, indexable and read through the
 * Admin SDK, which bypasses firestore.rules entirely — so nothing else in the
 * app stands between a link somebody kept and a rendered surface:
 *
 *   /checkin/[sessionId]    the form that POSTs to /api/checkin/submit. The QR
 *                           a church printed keeps working after a downgrade.
 *   /campaign/[campaignId]  A DONATE PAGE — campaign, amount picker, Donate
 *                           button. `fundraising: false` is documented as "they
 *                           get a public subdomain… but not a donate page", and
 *                           that sentence was simply not true while this route
 *                           answered. The donate ROUTE already refuses (THE-202),
 *                           but a refusal one click later is a giving surface
 *                           that 403s, not an absent one — and the CRM's "no
 *                           donor can exist on free" claim only holds if the
 *                           page that could create one is gone too.
 *
 * ⚠️ Every priced tier has `fundraising: true`, so the campaign page changes for
 * free ALONE. `checkInSystem` is false on Individual as well, and section 3
 * states that per tier rather than hiding it.
 *
 * 🔴 THE ORDER IS THE ASSERTION, twice over: the plan is consulted BEFORE the
 * document read, so a refused tenant's campaign or session is never fetched and
 * its excerpt never reaches an OpenGraph tag.
 */

const h = vi.hoisted(() => ({
  tenant: { current: null as Record<string, unknown> | null },
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  campaignGet: vi.fn(),
  sessionGet: vi.fn(),
  reads: [] as string[],
}));

vi.mock('next/headers', () => ({ headers: async () => new Map([['host', 'grace.theharvest.app']]) }));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('@/lib/server-tenant', () => ({ getTenantFromHost: async () => h.tenant.current }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => {
        const path = `${name}/${id}`;
        return {
          get: async () => { h.reads.push(path); return name === 'campaigns' ? h.campaignGet() : { exists: false }; },
          collection: () => ({
            doc: () => ({ get: async () => { h.reads.push('checkinSessions'); return h.sessionGet(); } }),
          }),
        };
      },
    }),
  },
}));
vi.mock('@/components/PublicCheckin', () => ({ default: () => null }));
vi.mock('@/components/PublicCampaign', () => ({ default: () => null }));
vi.mock('@/components/PublicRouteAnalytics', () => ({ default: () => null }));

const CheckinPage = (await import('../checkin/[sessionId]/page')).default;
const campaignModule = await import('../campaign/[campaignId]/page');
const CampaignPage = campaignModule.default;
const campaignMetadata = campaignModule.generateMetadata;

const onPlan = (plan: string, addons?: Record<string, unknown>) => {
  h.tenant.current = { id: 'grace', name: 'Grace Chapel', plan, ...(addons ? { addons } : {}), config: {} };
};

/** Did the page render, or did it refuse? `notFound()` throws by contract. */
async function renders(page: () => Promise<unknown>): Promise<boolean> {
  try {
    await page();
    return true;
  } catch (e) {
    if ((e as Error).message === 'NEXT_NOT_FOUND') return false;
    throw e;
  }
}

const openCheckin = () => renders(() =>
  CheckinPage({ params: Promise.resolve({ sessionId: 's1' }) } as never));
const openCampaign = () => renders(() =>
  CampaignPage({ params: Promise.resolve({ campaignId: 'c1' }) } as never));

beforeEach(() => {
  vi.clearAllMocks();
  h.reads = [];
  h.sessionGet.mockReturnValue({ exists: true, data: () => ({ name: 'Sunday Service', status: 'active' }) });
  h.campaignGet.mockReturnValue({
    exists: true,
    data: () => ({ tenantId: 'grace', title: 'Roof Fund', description: 'Help us', isActive: true, goal: 5000, raised: 100 }),
  });
});

// ─── 1. the public check-in page ─────────────────────────────────────────────
describe('/checkin/[sessionId] refuses a tier without check-in', () => {
  it('404s a free tenant’s kept QR link', async () => {
    onPlan('free');
    expect(await openCheckin()).toBe(false);
  });

  it('🔴 never reads the session — the refusal is BEFORE the fetch', async () => {
    onPlan('free');
    await openCheckin();
    expect(h.reads, 'a refused tenant’s session was fetched anyway').toEqual([]);
  });

  it('renders for the tiers whose cell is true', async () => {
    for (const plan of PLAN_ORDER.filter((p) => getPlanFeatures(p).checkInSystem)) {
      onPlan(plan);
      expect(await openCheckin(), `${PLAN_DISPLAY_NAMES[plan]} lost the public check-in page`).toBe(true);
    }
  });

  it('still 404s a missing session on a permitted tier — nothing else moved', async () => {
    onPlan('pro');
    h.sessionGet.mockReturnValue({ exists: false });
    expect(await openCheckin()).toBe(false);
  });
});

// ─── 2. the public donate page ───────────────────────────────────────────────
describe('/campaign/[campaignId] refuses a tier with no donate page', () => {
  it('refuses a free tenant', async () => {
    onPlan('free');
    expect(await openCampaign()).toBe(false);
  });

  it('🔴 never reads the campaign — nothing about it reaches an OpenGraph tag', async () => {
    onPlan('free');
    await openCampaign();
    expect(h.reads, 'a refused tenant’s campaign was fetched anyway').toEqual([]);
  });

  it('the metadata for a refused page names no campaign either', async () => {
    onPlan('free');
    const meta = await campaignMetadata({ params: Promise.resolve({ campaignId: 'c1' }) } as never);
    expect(meta.title).toBe('Campaign Not Found');
    expect(JSON.stringify(meta)).not.toContain('Roof Fund');
  });

  it('🔴 renders for all three priced tiers — this is a money surface', async () => {
    for (const plan of PLAN_ORDER.filter((p) => getPlanFeatures(p).fundraising)) {
      onPlan(plan);
      expect(await openCampaign(), `${PLAN_DISPLAY_NAMES[plan]} lost its donate page`).toBe(true);
    }
  });

  it('still refuses a foreign, inactive or pledge campaign on a permitted tier', async () => {
    onPlan('pro');
    h.campaignGet.mockReturnValue({ exists: true, data: () => ({ tenantId: 'other', isActive: true }) });
    expect(await openCampaign()).toBe(false);

    h.campaignGet.mockReturnValue({ exists: true, data: () => ({ tenantId: 'grace', isActive: false }) });
    expect(await openCampaign()).toBe(false);

    h.campaignGet.mockReturnValue({ exists: true, data: () => ({ tenantId: 'grace', isActive: true, campaignType: 'pledge' }) });
    expect(await openCampaign()).toBe(false);
  });
});

// ─── 3. the gates read effective features ────────────────────────────────────
describe('both pages resolve the tenant’s effective feature set', () => {
  it('an add-on record on the document neither opens nor closes either gate', async () => {
    // No add-on lifts a boolean cell today — only the four capacity cells move —
    // so this pins the SHAPE: the tier still decides, and the add-ons are read
    // rather than ignored or thrown on.
    onPlan('free', { contactPacks: 6, adminSeats: 4, campuses: 3, unlimitedContacts: true });
    expect(await openCheckin()).toBe(false);
    expect(await openCampaign()).toBe(false);

    onPlan('max', { contactPacks: 6, adminSeats: 4, campuses: 3, unlimitedContacts: true });
    expect(await openCheckin()).toBe(true);
    expect(await openCampaign()).toBe(true);
  });

  it('a corrupt plan field falls closed to Individual rather than throwing', async () => {
    h.tenant.current = { id: 'grace', name: 'Grace Chapel', plan: 'enterprise-999', config: {} };
    // 'plus': checkInSystem false, fundraising true.
    expect(await openCheckin()).toBe(false);
    expect(await openCampaign()).toBe(true);
  });

  it('an unknown host is refused by both, before any plan question', async () => {
    h.tenant.current = null;
    expect(await openCheckin()).toBe(false);
    expect(await openCampaign()).toBe(false);
    expect(h.reads).toEqual([]);
  });
});
