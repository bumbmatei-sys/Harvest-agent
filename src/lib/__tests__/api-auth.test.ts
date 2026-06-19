import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mockVerifyIdToken, mockGetDoc } from '@/test/mocks/firebase-admin';

// Dynamic import so mocks are applied first
const { verifyAuth, requireAuth, requireAdmin, requireTenantMember } = await import('@/lib/api-auth');

function makeRequest(token?: string): NextRequest {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(new Request('https://example.com/api/test', { headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyAuth', () => {
  it('returns null for missing auth header', async () => {
    expect(await verifyAuth(makeRequest())).toBeNull();
  });

  it('returns null for invalid token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid'));
    expect(await verifyAuth(makeRequest('bad'))).toBeNull();
  });

  it('returns user info for valid token', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1', email: 'test@test.com', tenantId: 't1', admin: true, superAdmin: false,
    });
    const result = await verifyAuth(makeRequest('valid'));
    expect(result).not.toBeNull();
    expect(result!.uid).toBe('u1');
    expect(result!.tenantId).toBe('t1');
    expect(result!.isAdmin).toBe(true);
  });

  it('falls back to Firestore for tenantId', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'test@test.com' });
    mockGetDoc.mockResolvedValue({
      exists: true,
      data: () => ({ tenantId: 't2' }),
    });
    const result = await verifyAuth(makeRequest('valid'));
    expect(result!.tenantId).toBe('t2');
  });
});

describe('requireAuth', () => {
  it('returns 401 for unauthenticated', async () => {
    const result = await requireAuth(makeRequest());
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

describe('requireAdmin', () => {
  it('returns 403 for non-admin', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1', email: 'test@test.com', admin: false, superAdmin: false,
    });
    const result = await requireAdmin(makeRequest('tok'));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it('allows super admin', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1', email: 'admin@test.com', admin: false, superAdmin: true,
    });
    const result = await requireAdmin(makeRequest('tok'));
    expect(result).not.toBeInstanceOf(Response);
    expect((result as any).isSuperAdmin).toBe(true);
  });
});

describe('requireTenantMember', () => {
  it('returns 403 for wrong tenant', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1', email: 'test@test.com', tenantId: 'other', admin: false, superAdmin: false,
    });
    const result = await requireTenantMember(makeRequest('tok'), 't1');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it('allows super admin to any tenant', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1', email: 'admin@test.com', superAdmin: true,
    });
    const result = await requireTenantMember(makeRequest('tok'), 'any');
    expect(result).not.toBeInstanceOf(Response);
  });
});
