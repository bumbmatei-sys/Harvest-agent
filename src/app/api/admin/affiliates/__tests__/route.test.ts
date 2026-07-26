import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireSuperAdmin, mockCollection, mockGetAll } = vi.hoisted(() => ({
  mockRequireSuperAdmin: vi.fn(),
  mockCollection: vi.fn(),
  mockGetAll: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: mockCollection, getAll: mockGetAll },
}));

const { GET } = await import('../route');

function makeReq(): NextRequest {
  return new NextRequest('https://example.com/api/admin/affiliates', {
    headers: { authorization: 'Bearer token' },
  });
}

const snap = (id: string, data: object) => ({ id, exists: true, data: () => data });

/**
 * GROUND TRUTH (verified against Stripe's complete 16-transfer history, THE-25):
 * exactly TWO affiliate transfers have ever fired — 1785 (15% of $119) and 4485
 * (15% of $299), each once. Everything else that looks like an affiliate payout
 * is either still pending or a zero-commission cancellation marker.
 *
 * The 47900/9580 row is the real legacy 20% commission. It is written as stored;
 * recomputing it at 15% would restate it as 7185.
 */
const COMMISSIONS = [
  // ── The two transfers that actually fired ────────────────────────────────
  snap('c1', {
    referrerId: 'aff-paid', tenantId: 't1', plan: 'pro', type: 'initial', status: 'paid',
    amount: 11900, commission: 1785, stripeTransferId: 'tr_1', paidAt: '2026-02-10T00:00:00.000Z',
    createdAt: '2026-02-10T00:00:00.000Z',
  }),
  snap('c2', {
    referrerId: 'aff-paid', tenantId: 't2', plan: 'max', type: 'initial', status: 'paid',
    amount: 29900, commission: 4485, stripeTransferId: 'tr_2', paidAt: '2026-03-01T00:00:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
  }),
  // ── Two rows pending forever: the referrer never finished Connect ─────────
  snap('c3', {
    referrerId: 'aff-stuck', tenantId: 't3', plan: 'ultra', type: 'initial', status: 'pending',
    amount: 47900, commission: 9580, createdAt: '2026-01-05T00:00:00.000Z',
  }),
  snap('c4', {
    referrerId: 'aff-stuck', tenantId: 't4', plan: 'pro', type: 'recurring', status: 'pending',
    amount: 11900, commission: 1785, createdAt: '2026-01-20T00:00:00.000Z',
  }),
  // ── A zero-commission cancellation marker: never money ───────────────────
  snap('c5', {
    referrerId: 'aff-paid', tenantId: 't1', plan: 'pro', type: 'cancellation', status: 'cancelled',
    amount: 0, commission: 0, createdAt: '2026-04-01T00:00:00.000Z',
  }),
];

const USERS: Record<string, object> = {
  'aff-paid': {
    email: 'paid@example.com', affiliateCode: 'aaa11111',
    affiliateEarnings: 6270, affiliatePendingPayouts: 0, affiliateReferralCount: 2,
    affiliateStripeAccountId: 'acct_1', affiliateConnectStatus: 'active',
  },
  'aff-stuck': {
    email: 'stuck@example.com', affiliateCode: 'bbb22222',
    affiliateEarnings: 11365, affiliatePendingPayouts: 11365, affiliateReferralCount: 1,
    // No affiliateStripeAccountId at all — the sweep skips these forever.
  },
  'aff-idle': {
    email: 'idle@example.com', affiliateCode: 'ccc33333',
  },
};

function wireDb(commissions = COMMISSIONS, users = USERS) {
  mockCollection.mockImplementation((name: string) => {
    if (name === 'affiliate_commissions') {
      return { get: async () => ({ docs: commissions, size: commissions.length }) };
    }
    const userDocs = Object.entries(users).map(([id, d]) => snap(id, d));
    return {
      orderBy: () => ({ limit: () => ({ get: async () => ({ docs: userDocs, size: userDocs.length }) }) }),
      doc: (id: string) => ({ __id: id }),
    };
  });
  mockGetAll.mockImplementation(async (...refs: { __id: string }[]) =>
    refs.map((r) => (users[r.__id] ? snap(r.__id, users[r.__id]) : { id: r.__id, exists: false, data: () => ({}) })));
}

const superAdmin = { uid: 'sa', email: 'owner@harvest', tenantId: null, isAdmin: true, isSuperAdmin: true };
const byId = (body: any, id: string) => body.affiliates.find((a: any) => a.userId === id);

beforeEach(() => {
  vi.clearAllMocks();
  wireDb();
});

describe('GET /api/admin/affiliates — the gate', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireSuperAdmin.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    expect((await GET(makeReq())).status).toBe(401);
  });

  it('403s a plain tenant admin and leaks NO affiliate data', async () => {
    // requireAdmin would pass this user (isAdmin true). That is exactly why this
    // route gates on requireSuperAdmin instead.
    mockRequireSuperAdmin.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Super admin access required' }), {
        status: 403, headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Super admin access required' });
    expect(body.affiliates).toBeUndefined();
    expect(mockCollection).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/affiliates — the numbers', () => {
  beforeEach(() => mockRequireSuperAdmin.mockResolvedValue(superAdmin));

  it('matches the ground truth: exactly two transfers ever fired, 1785 and 4485', async () => {
    const body = await (await GET(makeReq())).json();
    const transfers = body.affiliates.flatMap((a: any) => a.transfers);
    expect(transfers).toHaveLength(2);
    expect(transfers.map((t: any) => t.commission).sort((a: number, b: number) => a - b)).toEqual([1785, 4485]);
    expect(transfers.map((t: any) => t.stripeTransferId).sort()).toEqual(['tr_1', 'tr_2']);
    // Nothing else is counted as money that moved.
    const paidTotal = body.affiliates.reduce((s: number, a: any) => s + a.payoutStatus.paid.commission, 0);
    expect(paidTotal).toBe(6270);
  });

  it('reads the STORED commission — the 20% legacy row is not restated at 15%', async () => {
    const body = await (await GET(makeReq())).json();
    const stuck = byId(body, 'aff-stuck');
    const legacy = stuck.recentCommissions.find((c: any) => c.id === 'c3');
    expect(legacy.amount).toBe(47900);
    expect(legacy.commission).toBe(9580);       // as stored — NOT 47900 * 0.15 = 7185
    expect(stuck.commissionFromRows).toBe(9580 + 1785);
    // Harvest kept = amount − STORED commission, so the 20% row leaves less.
    expect(stuck.harvestKept).toBe((47900 - 9580) + (11900 - 1785));
    // The off-rate row is surfaced rather than averaged away.
    expect(stuck.commissionRates).toEqual(
      expect.arrayContaining([{ rate: 0.15, count: 1 }, { rate: 0.2, count: 1 }]),
    );
  });

  it('sums revenue, plans sold and Harvest\'s share per affiliate', async () => {
    const body = await (await GET(makeReq())).json();
    const paid = byId(body, 'aff-paid');
    expect(paid.revenueBrought).toBe(11900 + 29900 + 0);
    expect(paid.plansSold).toBe(2);                                   // type: 'initial' only
    expect(paid.harvestKept).toBe((11900 - 1785) + (29900 - 4485));
    expect(paid.earned).toBe(6270);                                   // users/{id}.affiliateEarnings
    expect(paid.owedUnpaid).toBe(0);                                  // users/{id}.affiliatePendingPayouts
    // A cancellation marker is a zero-commission row, not a sale.
    expect(paid.payoutStatus.cancelled.count).toBe(1);
    expect(paid.payoutStatus.cancelled.commission).toBe(0);
  });

  it('labels the referral counter as CONVERTED referrals, matching the affiliate\'s own dashboard', async () => {
    const body = await (await GET(makeReq())).json();
    expect(byId(body, 'aff-paid').convertedReferrals).toBe(2);
    // No field pretends to be a signup count — a live trial never increments this.
    expect(Object.keys(byId(body, 'aff-paid'))).not.toContain('signups');
    expect(Object.keys(byId(body, 'aff-paid'))).not.toContain('referralCount');
  });

  it('gives a pending commission with no Connect account a distinct reason', async () => {
    const body = await (await GET(makeReq())).json();
    const stuck = byId(body, 'aff-stuck');
    expect(stuck.payoutStatus.pending.count).toBe(2);
    expect(stuck.payoutStatus.pending.commission).toBe(11365);
    expect(stuck.pendingReason).toBe('no_connect_account');
    expect(stuck.connect).toEqual({ accountId: null, status: null, payoutReady: false });
  });

  it('distinguishes incomplete onboarding from a genuine sweep queue', async () => {
    wireDb(COMMISSIONS, {
      ...USERS,
      'aff-stuck': { ...USERS['aff-stuck'], affiliateStripeAccountId: 'acct_2', affiliateConnectStatus: 'pending' },
    });
    let body = await (await GET(makeReq())).json();
    expect(byId(body, 'aff-stuck').pendingReason).toBe('connect_incomplete');

    wireDb(COMMISSIONS, {
      ...USERS,
      'aff-stuck': { ...USERS['aff-stuck'], affiliateStripeAccountId: 'acct_2', affiliateConnectStatus: 'active' },
    });
    body = await (await GET(makeReq())).json();
    expect(byId(body, 'aff-stuck').pendingReason).toBe('awaiting_sweep');
  });

  it('carries no pendingReason when nothing is pending', async () => {
    const body = await (await GET(makeReq())).json();
    expect(byId(body, 'aff-paid').pendingReason).toBeNull();
  });

  it('includes an affiliate with a link but no sales, at zero', async () => {
    const body = await (await GET(makeReq())).json();
    const idle = byId(body, 'aff-idle');
    expect(idle.revenueBrought).toBe(0);
    expect(idle.plansSold).toBe(0);
    expect(idle.earned).toBe(0);
    expect(idle.transfers).toEqual([]);
    expect(idle.pendingReason).toBeNull();
  });

  it('picks up a referrer who has commissions but no affiliateCode', async () => {
    const users = { ...USERS };
    delete (users as any)['aff-stuck'];
    wireDb(COMMISSIONS, { ...users, 'aff-stuck': { email: 'nocode@example.com', affiliateEarnings: 11365 } });
    // The users-with-a-code query no longer returns aff-stuck, so it must be
    // fetched via getAll from the commission rows.
    mockCollection.mockImplementation((name: string) => {
      if (name === 'affiliate_commissions') return { get: async () => ({ docs: COMMISSIONS, size: COMMISSIONS.length }) };
      const codedDocs = Object.entries(users).map(([id, d]) => snap(id, d));
      return {
        orderBy: () => ({ limit: () => ({ get: async () => ({ docs: codedDocs, size: codedDocs.length }) }) }),
        doc: (id: string) => ({ __id: id }),
      };
    });
    mockGetAll.mockResolvedValue([snap('aff-stuck', { email: 'nocode@example.com', affiliateEarnings: 11365 })]);

    const body = await (await GET(makeReq())).json();
    const stuck = byId(body, 'aff-stuck');
    expect(stuck).toBeDefined();
    expect(stuck.email).toBe('nocode@example.com');
    expect(stuck.payoutStatus.pending.count).toBe(2);
  });

  it('returns an empty roster (not a crash) when there are no affiliates at all', async () => {
    wireDb([], {});
    const body = await (await GET(makeReq())).json();
    expect(body.affiliates).toEqual([]);
    expect(body.commissionRowsScanned).toBe(0);
    expect(body.truncated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Time windows: "who sold the most today / in 7 days / in 30 days".
// Clock is pinned so the UTC calendar-day cutoffs are exact rather than
// whatever the test machine's date happens to be.
// ─────────────────────────────────────────────────────────────────────────────
const NOW = new Date('2026-07-26T09:30:00.000Z');

/** One affiliate, four sales, one per bucket: today, inside 7d, inside 30d,
 * and older than 30d. Every window's expected plansSold is therefore known. */
const DATED = [
  snap('w1', {
    referrerId: 'seller', tenantId: 'ta', plan: 'pro', type: 'initial', status: 'paid',
    amount: 11900, commission: 1785, createdAt: '2026-07-26T02:00:00.000Z',   // today (UTC)
  }),
  snap('w2', {
    referrerId: 'seller', tenantId: 'tb', plan: 'pro', type: 'initial', status: 'paid',
    amount: 11900, commission: 1785, createdAt: '2026-07-22T12:00:00.000Z',   // within 7d
  }),
  snap('w3', {
    referrerId: 'seller', tenantId: 'tc', plan: 'max', type: 'initial', status: 'pending',
    amount: 29900, commission: 4485, createdAt: '2026-07-05T12:00:00.000Z',   // within 30d
  }),
  snap('w4', {
    referrerId: 'seller', tenantId: 'td', plan: 'max', type: 'initial', status: 'paid',
    amount: 29900, commission: 4485, createdAt: '2026-01-01T12:00:00.000Z',   // older
  }),
  // A renewal, not a sale: must never inflate plansSold in any window.
  snap('w5', {
    referrerId: 'seller', tenantId: 'ta', plan: 'pro', type: 'recurring', status: 'paid',
    amount: 11900, commission: 1785, createdAt: '2026-07-26T03:00:00.000Z',
  }),
  // No createdAt at all: counts toward all-time, belongs to no dated window.
  snap('w6', {
    referrerId: 'seller', tenantId: 'te', plan: 'pro', type: 'initial', status: 'pending',
    amount: 11900, commission: 1785,
  }),
];

describe('GET /api/admin/affiliates — time windows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockRequireSuperAdmin.mockResolvedValue(superAdmin);
    wireDb(DATED, { seller: { email: 'seller@example.com', affiliateCode: 'sss11111' } });
  });
  afterEach(() => vi.useRealTimers());

  it('reports UTC calendar-day cutoffs for each window', async () => {
    const body = await (await GET(makeReq())).json();
    expect(body.windowCutoffs).toEqual({
      today: '2026-07-26T00:00:00.000Z',
      d7: '2026-07-20T00:00:00.000Z',   // today plus the previous 6 days
      d30: '2026-06-27T00:00:00.000Z',  // today plus the previous 29 days
      all: null,
    });
  });

  it('counts plans sold per window, nesting today ⊆ 7d ⊆ 30d ⊆ all', async () => {
    const body = await (await GET(makeReq())).json();
    const s = byId(body, 'seller');
    expect(s.windows.today.plansSold).toBe(1);
    expect(s.windows.d7.plansSold).toBe(2);
    expect(s.windows.d30.plansSold).toBe(3);
    expect(s.windows.all.plansSold).toBe(5);  // + the January sale + the undated one
  });

  it('keeps renewals out of plansSold while still counting them', async () => {
    const body = await (await GET(makeReq())).json();
    const s = byId(body, 'seller');
    expect(s.windows.today.recurringPayments).toBe(1);
    expect(s.windows.today.plansSold).toBe(1);
    expect(s.windows.today.rows).toBe(2);
  });

  it('windows revenue and Harvest\'s share alongside the sale counts', async () => {
    const body = await (await GET(makeReq())).json();
    const s = byId(body, 'seller');
    // Today = one $119 sale + one $119 renewal.
    expect(s.windows.today.revenueBrought).toBe(11900 * 2);
    expect(s.windows.today.commission).toBe(1785 * 2);
    expect(s.windows.today.harvestKept).toBe((11900 - 1785) * 2);
  });

  it('windows.all is identical to the lifetime fields', async () => {
    const body = await (await GET(makeReq())).json();
    const s = byId(body, 'seller');
    expect(s.windows.all.revenueBrought).toBe(s.revenueBrought);
    expect(s.windows.all.plansSold).toBe(s.plansSold);
    expect(s.windows.all.harvestKept).toBe(s.harvestKept);
    expect(s.windows.all.commission).toBe(s.commissionFromRows);
  });

  it('reports undated rows instead of silently dropping them from windows', async () => {
    const body = await (await GET(makeReq())).json();
    const s = byId(body, 'seller');
    expect(s.undatedRows).toBe(1);
    // Present in all-time, absent from every dated window.
    expect(s.windows.all.rows - s.windows.d30.rows).toBe(2); // the January row + the undated one
  });

  it('ranks correctly for both most and fewest sold in a window', async () => {
    // Two affiliates: `seller` sold twice in the last 7 days, `quiet` once today.
    wireDb(
      [...DATED, snap('q1', {
        referrerId: 'quiet', tenantId: 'tz', plan: 'pro', type: 'initial', status: 'paid',
        amount: 11900, commission: 1785, createdAt: '2026-07-26T01:00:00.000Z',
      })],
      { seller: { affiliateCode: 's' }, quiet: { affiliateCode: 'q' }, idle: { affiliateCode: 'i' } },
    );
    const body = await (await GET(makeReq())).json();
    const plansIn = (id: string, k: string) => byId(body, id).windows[k].plansSold;

    // Today they are level; over 7 days `seller` is ahead. The view sorts on
    // these numbers, so this is the ranking it produces.
    expect(plansIn('seller', 'today')).toBe(1);
    expect(plansIn('quiet', 'today')).toBe(1);
    expect(plansIn('seller', 'd7')).toBe(2);
    expect(plansIn('quiet', 'd7')).toBe(1);
    // An affiliate with a link and no sales stays rankable at the bottom (or the
    // top, ordering by fewest) rather than dropping out of the list.
    expect(plansIn('idle', 'd7')).toBe(0);
    expect(byId(body, 'idle').windows.all.plansSold).toBe(0);
  });
});
