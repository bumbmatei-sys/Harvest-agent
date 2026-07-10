import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockSubsUpdate } = vi.hoisted(() => ({ mockSubsUpdate: vi.fn().mockResolvedValue({ id: 'sub_partner' }) }));
const { mockRequireAuth } = vi.hoisted(() => ({ mockRequireAuth: vi.fn() }));
const { mockDocGet, mockDocUpdate } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    subscriptions = { update: mockSubsUpdate };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockDocGet, update: mockDocUpdate })) })) },
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));

const { POST } = await import('../route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/stripe/cancel-partnership', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  mockRequireAuth.mockResolvedValue({ uid: 'donor1', isSuperAdmin: false });
});

describe('POST /api/stripe/cancel-partnership (BUG 4)', () => {
  it('cancels the subscription at period end and clears the partnership fields', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ donationSubscriptionId: 'sub_partner' }) });

    const res = await POST(makeRequest({ userId: 'donor1' }));
    expect(res.status).toBe(200);
    expect(mockSubsUpdate).toHaveBeenCalledWith('sub_partner', { cancel_at_period_end: true });
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        donationSubscriptionId: null,
        donationAmount: null,
        donationChurchId: null,
        donationChurchName: null,
      }),
    );
  });

  it('returns 400 when the user has no partnership subscription', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({}) });

    const res = await POST(makeRequest({ userId: 'donor1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no active partnership/i);
    expect(mockSubsUpdate).not.toHaveBeenCalled();
  });

  it("blocks cancelling another user's partnership", async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'attacker', isSuperAdmin: false });

    const res = await POST(makeRequest({ userId: 'victim' }));
    expect(res.status).toBe(403);
    expect(mockSubsUpdate).not.toHaveBeenCalled();
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });
});
