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
      affiliateClicks: 5,
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
