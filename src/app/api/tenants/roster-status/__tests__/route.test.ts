import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const { mockRequireAuth } = vi.hoisted(() => ({ mockRequireAuth: vi.fn() }));
const { mockGetTenantPrivate } = vi.hoisted(() => ({ mockGetTenantPrivate: vi.fn() }));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: mockGetTenantPrivate }));

const { GET } = await import('../route');

function makeRequest(tenantId?: string): NextRequest {
  const url = tenantId
    ? `https://example.com/api/tenants/roster-status?tenantId=${tenantId}`
    : 'https://example.com/api/tenants/roster-status';
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({
    uid: 'u1', email: 'Pastor@Grace.org', tenantId: 'grace', isAdmin: false, isSuperAdmin: false,
  });
  mockGetTenantPrivate.mockResolvedValue({ adminEmails: ['pastor@grace.org'] });
});

describe('GET /api/tenants/roster-status', () => {
  it('401s unauthenticated callers', async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));
    const res = await GET(makeRequest('grace'));
    expect(res.status).toBe(401);
  });

  it('answers true for a rostered caller (case-insensitive email match)', async () => {
    const res = await GET(makeRequest('grace'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isRosterAdmin: true });
  });

  it('answers false for a non-rostered caller — and never returns the roster itself', async () => {
    mockGetTenantPrivate.mockResolvedValue({ adminEmails: ['someone-else@x.com'] });
    const res = await GET(makeRequest('grace'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ isRosterAdmin: false });
    expect(JSON.stringify(body)).not.toContain('someone-else');
  });

  it('answers false when the tenant has no private doc', async () => {
    mockGetTenantPrivate.mockResolvedValue({});
    const res = await GET(makeRequest('grace'));
    expect(await res.json()).toEqual({ isRosterAdmin: false });
  });

  it('falls back to the caller\'s own tenantId when the param is omitted', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(mockGetTenantPrivate).toHaveBeenCalledWith('grace');
  });
});
