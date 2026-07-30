import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockRequireAuth } = vi.hoisted(() => ({ mockRequireAuth: vi.fn() }));
const { mockUserGet, mockUserUpdate, mockCommissionsGet, mockUsersWhereGet } = vi.hoisted(() => ({
  mockUserGet: vi.fn(),
  mockUserUpdate: vi.fn().mockResolvedValue(undefined),
  mockCommissionsGet: vi.fn(),
  mockUsersWhereGet: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn((name: string) => {
      if (name === 'affiliate_commissions') {
        return { where: vi.fn().mockReturnThis(), get: mockCommissionsGet };
      }
      // users
      return {
        doc: vi.fn(() => ({ get: mockUserGet, update: mockUserUpdate })),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: mockUsersWhereGet,
      };
    }),
  },
}));

const { GET } = await import('../status/route');

function makeRequest(): NextRequest {
  return new NextRequest('https://example.com/api/affiliate/status', {
    method: 'GET',
    headers: { authorization: 'Bearer tok' },
  });
}

// Relative timestamps: "now" is always this calendar month AND within 30 days;
// 45 days ago is always neither (a month is ≤ 31 days).
const now = Date.now();
const recentIso = new Date(now).toISOString();
const oldIso = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString();
const commDoc = (c: Record<string, unknown>) => ({ data: () => c });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ uid: 'user1', email: 'a@b.co', tenantId: 't1', isSuperAdmin: false });
  // User already has an affiliate code → route skips code generation.
  mockUserGet.mockResolvedValue({
    exists: true,
    data: () => ({
      affiliateCode: 'abc12345',
      affiliateEarnings: 9580,
      affiliatePendingPayouts: 4580,
      affiliateReferralCount: 1,
      affiliateStripeAccountId: 'acct_1',
      affiliateConnectStatus: 'active',
    }),
  });
  mockCommissionsGet.mockResolvedValue({ docs: [] });
});

describe('GET /api/affiliate/status — this-month earnings (ISSUE 1)', () => {
  it('includes PENDING commissions in thisMonthEarnings (not just paid)', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [
        commDoc({ type: 'initial', status: 'paid', commission: 5000, createdAt: recentIso }),
        commDoc({ type: 'initial', status: 'pending', commission: 4580, createdAt: recentIso }),
      ],
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    // 50.00 paid + 45.80 pending = 95.80 → matches Lifetime's basis.
    expect(body.thisMonthEarnings).toBe(9580);
    expect(body.thisMonthPending).toBe(4580);
  });

  it('counts a failed-transfer commission as earned this month (like Lifetime)', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [commDoc({ type: 'recurring', status: 'failed', commission: 3000, createdAt: recentIso })],
    });
    const body = await (await GET(makeRequest())).json();
    expect(body.thisMonthEarnings).toBe(3000);
    expect(body.thisMonthPending).toBe(3000); // not paid → counts as pending payout
  });

  it('excludes zero-commission cancellation marker rows', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [
        commDoc({ type: 'cancellation', status: 'cancelled', commission: 0, createdAt: recentIso }),
        commDoc({ type: 'initial', status: 'paid', commission: 5000, createdAt: recentIso }),
      ],
    });
    const body = await (await GET(makeRequest())).json();
    expect(body.thisMonthEarnings).toBe(5000);
  });
});

describe('GET /api/affiliate/status — recurring earnings (ISSUE 2 / ISSUE 6)', () => {
  it('sums only recurring commissions from the trailing 30 days', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [
        commDoc({ type: 'recurring', status: 'paid', commission: 1000, createdAt: recentIso }),
        commDoc({ type: 'recurring', status: 'paid', commission: 2000, createdAt: oldIso }), // > 30d ago
        commDoc({ type: 'initial', status: 'paid', commission: 5000, createdAt: recentIso }), // not recurring
      ],
    });
    const body = await (await GET(makeRequest())).json();
    // Only the fresh recurring commission — a cancelled referral's old recurring
    // commissions fall out of the 30-day window on their own (no clawback needed).
    expect(body.recurringEarnings).toBe(1000);
  });

  it('reports zero recurring income when there are no recent recurring commissions', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [commDoc({ type: 'initial', status: 'paid', commission: 5000, createdAt: recentIso })],
    });
    const body = await (await GET(makeRequest())).json();
    expect(body.recurringEarnings).toBe(0);
  });
});

// ── The 12-month commission window ───────────────────────────────────────────
// An affiliate who cannot see the clock reads a closed window as being underpaid,
// so the remaining window is reported per referral. These values are read STRAIGHT
// off the commission rows the webhook stamped, never recomputed here — the clock the
// affiliate sees has to be the clock the gate actually applied.

describe('GET /api/affiliate/status — the 12-month commission window', () => {
  const daysFromNow = (d: number) => new Date(now + d * 24 * 60 * 60 * 1000).toISOString();

  it('states the window length', async () => {
    const body = await (await GET(makeRequest())).json();
    expect(body.commissionWindowMonths).toBe(12);
  });

  it('reports days remaining per referral, soonest to close first', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [
        commDoc({
          type: 'recurring', status: 'paid', commission: 1000, createdAt: recentIso,
          tenantId: 'later-church', commissionWindowEndsAt: daysFromNow(200),
        }),
        commDoc({
          type: 'recurring', status: 'paid', commission: 1000, createdAt: recentIso,
          tenantId: 'soonest-church', commissionWindowEndsAt: daysFromNow(30),
        }),
      ],
    });

    const body = await (await GET(makeRequest())).json();
    expect(body.referralWindows.map((w: any) => w.tenantId)).toEqual(['soonest-church', 'later-church']);
    expect(body.referralWindows[0]).toMatchObject({ daysRemaining: 30, expired: false });
    expect(body.referralWindows[1]).toMatchObject({ daysRemaining: 200, expired: false });
    expect(body.activeReferralWindows).toBe(2);
    expect(body.expiredReferralWindows).toBe(0);
    expect(body.nextWindowEndsAt).toBe(daysFromNow(30));
  });

  it('collapses a referral\'s many commission rows into ONE window entry', async () => {
    const endsAt = daysFromNow(90);
    mockCommissionsGet.mockResolvedValue({
      docs: [1, 2, 3].map(i => commDoc({
        type: 'recurring', status: 'paid', commission: 1000,
        createdAt: new Date(now - i * 1000).toISOString(),
        tenantId: 'grace', commissionWindowEndsAt: endsAt,
      })),
    });

    const body = await (await GET(makeRequest())).json();
    expect(body.referralWindows).toHaveLength(1);
    expect(body.referralWindows[0]).toMatchObject({ tenantId: 'grace', windowEndsAt: endsAt });
  });

  it('surfaces an EXPIRED window — the `expired` marker row is what proves the clock ran out', async () => {
    // The webhook writes this zero-commission row when it withholds a commission. It
    // is filtered out of the earnings totals, but it is the most authoritative
    // statement of a closed window there is, so the window bookkeeping must see it.
    mockCommissionsGet.mockResolvedValue({
      docs: [
        commDoc({
          type: 'expired', status: 'cancelled', commission: 0, createdAt: recentIso,
          tenantId: 'old-church', skippedReason: 'window-elapsed',
          commissionWindowEndsAt: daysFromNow(-10),
        }),
      ],
    });

    const body = await (await GET(makeRequest())).json();
    expect(body.referralWindows).toEqual([
      { tenantId: 'old-church', windowEndsAt: daysFromNow(-10), expired: true, daysRemaining: 0 },
    ]);
    expect(body.expiredReferralWindows).toBe(1);
    expect(body.activeReferralWindows).toBe(0);
    expect(body.nextWindowEndsAt).toBeNull();
    // ...and it still does not count as earnings.
    expect(body.thisMonthEarnings).toBe(0);
  });

  it('reports a row with no stamped window as UNKNOWN, never as expired', async () => {
    // Rows written before the window fields existed. Guessing "expired" here would be
    // the silent-underpay failure this whole change is written to avoid.
    mockCommissionsGet.mockResolvedValue({
      docs: [commDoc({
        type: 'recurring', status: 'paid', commission: 1000,
        createdAt: recentIso, tenantId: 'legacy-church',
      })],
    });

    const body = await (await GET(makeRequest())).json();
    expect(body.referralWindows).toEqual([
      { tenantId: 'legacy-church', windowEndsAt: null, expired: false, daysRemaining: null },
    ]);
    expect(body.expiredReferralWindows).toBe(0);
    expect(body.nextWindowEndsAt).toBeNull();
  });

  it('sorts unknown windows last — unknown is not urgent', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [
        commDoc({ type: 'recurring', commission: 1000, createdAt: recentIso, tenantId: 'unknown-church' }),
        commDoc({
          type: 'recurring', commission: 1000, createdAt: recentIso,
          tenantId: 'dated-church', commissionWindowEndsAt: daysFromNow(45),
        }),
      ],
    });

    const body = await (await GET(makeRequest())).json();
    expect(body.referralWindows.map((w: any) => w.tenantId)).toEqual(['dated-church', 'unknown-church']);
  });

  it('reports no windows when there are no commissions at all', async () => {
    const body = await (await GET(makeRequest())).json();
    expect(body.referralWindows).toEqual([]);
    expect(body.activeReferralWindows).toBe(0);
    expect(body.expiredReferralWindows).toBe(0);
  });

  it('leaves referralCount alone — the clock running out does not un-convert a referral', async () => {
    mockCommissionsGet.mockResolvedValue({
      docs: [commDoc({
        type: 'expired', status: 'cancelled', commission: 0, createdAt: recentIso,
        tenantId: 'old-church', commissionWindowEndsAt: daysFromNow(-10),
      })],
    });

    const body = await (await GET(makeRequest())).json();
    expect(body.referralCount).toBe(1); // straight from users/{uid}.affiliateReferralCount
  });
});
