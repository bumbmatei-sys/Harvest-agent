import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireAuth, mockGetSmsUsageSnapshot } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetSmsUsageSnapshot: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/sms-usage', () => ({ getSmsUsageSnapshot: mockGetSmsUsageSnapshot }));

const { GET } = await import('../route');

function makeReq(): NextRequest {
  return new NextRequest('https://example.com/api/sms-usage', {
    headers: { authorization: 'Bearer token' },
  });
}
function mockUser(overrides: object = {}) {
  return { uid: 'u1', email: 'a@b.c', tenantId: 'tenant1', isAdmin: true, isSuperAdmin: false, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/sms-usage', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns { metered: false } for a super admin (never touches usage docs)', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null, isSuperAdmin: true }));
    const res = await GET(makeReq());
    expect((await res.json()).metered).toBe(false);
    expect(mockGetSmsUsageSnapshot).not.toHaveBeenCalled();
  });

  it('returns { metered: false } for a null-tenant user', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null }));
    const res = await GET(makeReq());
    expect((await res.json()).metered).toBe(false);
    expect(mockGetSmsUsageSnapshot).not.toHaveBeenCalled();
  });

  it("returns the caller's OWN tenant snapshot, resolved from the token", async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockGetSmsUsageSnapshot.mockResolvedValue({
      plan: 'ultra', month: '2026-07', smsSegmentsUsed: 1_234, smsSegmentsCap: 4_000,
    });

    const body = await (await GET(makeReq())).json();

    expect(body).toMatchObject({
      metered: true, plan: 'ultra', smsSegmentsUsed: 1_234, smsSegmentsCap: 4_000,
    });
    // The tenant comes from the verified token — never from the request.
    expect(mockGetSmsUsageSnapshot).toHaveBeenCalledWith('tenant1');
  });

  it('reports an unmetered tier (null cap) as not metered rather than a 0-limit meter', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockGetSmsUsageSnapshot.mockResolvedValue({
      plan: 'plus', month: '2026-07', smsSegmentsUsed: 5, smsSegmentsCap: null,
    });
    expect((await (await GET(makeReq())).json()).metered).toBe(false);
  });

  it('returns 500 (not a bogus 0 usage) when the snapshot read fails', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockGetSmsUsageSnapshot.mockRejectedValue(new Error('firestore down'));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
  });
});
