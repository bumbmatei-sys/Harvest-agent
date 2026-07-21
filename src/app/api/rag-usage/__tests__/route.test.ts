import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireAuth, mockGetUsageSnapshot } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetUsageSnapshot: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/rag-usage', () => ({ getUsageSnapshot: mockGetUsageSnapshot }));

const { GET } = await import('../route');

function makeReq(): NextRequest {
  return new NextRequest('https://example.com/api/rag-usage', {
    headers: { authorization: 'Bearer token' },
  });
}
function mockUser(overrides: object = {}) {
  return { uid: 'u1', email: 'a@b.c', tenantId: 'tenant1', isAdmin: true, isSuperAdmin: false, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/rag-usage', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns { metered: false } for a super admin (never touches usage docs)', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null, isSuperAdmin: true }));
    const res = await GET(makeReq());
    expect((await res.json()).metered).toBe(false);
    expect(mockGetUsageSnapshot).not.toHaveBeenCalled();
  });

  it('returns { metered: false } for a null-tenant user', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null }));
    const res = await GET(makeReq());
    expect((await res.json()).metered).toBe(false);
    expect(mockGetUsageSnapshot).not.toHaveBeenCalled();
  });

  it('returns the caller\'s own tenant snapshot', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockGetUsageSnapshot.mockResolvedValue({
      plan: 'pro',
      month: '2026-07',
      queryTokensUsed: 10,
      queryTokensCap: 10_000_000,
      ingestTokensUsed: 20,
      ingestTokensCeiling: 2_000_000,
    });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.metered).toBe(true);
    expect(body.plan).toBe('pro');
    expect(body.ingestTokensCeiling).toBe(2_000_000);
    expect(mockGetUsageSnapshot).toHaveBeenCalledWith('tenant1');
  });
});
