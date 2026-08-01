import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const { mockRequireSuperAdmin } = vi.hoisted(() => ({ mockRequireSuperAdmin: vi.fn() }));
const { mockCollGet } = vi.hoisted(() => ({ mockCollGet: vi.fn() }));

vi.mock('@/lib/api-auth', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => ({ get: mockCollGet })) },
}));

const { GET } = await import('../route');

const makeRequest = () => new NextRequest('https://example.com/api/tenants/rosters', { method: 'GET' });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperAdmin.mockResolvedValue({
    uid: 'super1', email: 'platform@test.com', tenantId: null, isAdmin: true, isSuperAdmin: true,
  });
  mockCollGet.mockResolvedValue({
    docs: [
      { id: 'grace', data: () => ({ adminEmails: ['pastor@grace.org'] }) },
      { id: 'hope', data: () => ({ stripeCustomerId: 'cus_1' }) }, // no roster field
    ],
  });
});

describe('GET /api/tenants/rosters', () => {
  it('403s non-super-admin callers', async () => {
    mockRequireSuperAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Super admin access required' }, { status: 403 }),
    );
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect(mockCollGet).not.toHaveBeenCalled();
  });

  it('returns every tenant\'s roster keyed by tenant id ([] when missing)', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rosters: { grace: ['pastor@grace.org'], hope: [] },
    });
  });
});
