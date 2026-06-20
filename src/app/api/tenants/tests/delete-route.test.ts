import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  mockVerifyIdToken,
  mockGetDoc,
  mockRecursiveDelete,
} from '@/test/mocks/firebase-admin';

// Dynamic import so mocks are applied first
const { DELETE } = await import('@/app/api/tenants/delete/route');

function makeRequest(token?: string, tenantId?: string): NextRequest {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const url = tenantId
    ? `https://example.com/api/tenants/delete?id=${tenantId}`
    : 'https://example.com/api/tenants/delete';
  return new NextRequest(new Request(url, { method: 'DELETE', headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DELETE /api/tenants/delete', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await DELETE(makeRequest(undefined, 't1'));
    expect(res.status).toBe(401);
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
  });

  it('returns 403 for authenticated non-super-admin users', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1',
      email: 'regular@test.com',
      admin: true,
      superAdmin: false,
    });
    const res = await DELETE(makeRequest('tok', 't1'));
    expect(res.status).toBe(403);
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
  });

  it('returns 400 when tenant id is missing', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1',
      email: 'admin@test.com',
      superAdmin: true,
    });
    const res = await DELETE(makeRequest('tok'));
    expect(res.status).toBe(400);
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
  });

  it('returns 404 when the tenant does not exist', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1',
      email: 'admin@test.com',
      superAdmin: true,
    });
    mockGetDoc.mockResolvedValue({ exists: false });

    const res = await DELETE(makeRequest('tok', 'missing-tenant'));
    expect(res.status).toBe(404);
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
  });

  it('uses recursiveDelete (not a plain doc delete) for super admins, so subcollections are not orphaned', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1',
      email: 'admin@test.com',
      superAdmin: true,
    });
    mockGetDoc.mockResolvedValue({ exists: true });
    mockRecursiveDelete.mockResolvedValue(undefined);

    const res = await DELETE(makeRequest('tok', 't1'));

    expect(res.status).toBe(200);
    expect(mockRecursiveDelete).toHaveBeenCalledTimes(1);
  });

  it('allows deletion when isSuperAdmin claim is false but email matches SUPER_ADMIN_EMAIL fallback', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1',
      email: 'bumbmatei@proton.me',
      superAdmin: false,
    });
    mockGetDoc.mockResolvedValue({ exists: true });
    mockRecursiveDelete.mockResolvedValue(undefined);

    const res = await DELETE(makeRequest('tok', 't1'));
    expect(res.status).toBe(200);
    expect(mockRecursiveDelete).toHaveBeenCalledTimes(1);
  });

  it('returns 500 if recursiveDelete throws', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1',
      email: 'admin@test.com',
      superAdmin: true,
    });
    mockGetDoc.mockResolvedValue({ exists: true });
    mockRecursiveDelete.mockRejectedValue(new Error('Firestore error'));

    const res = await DELETE(makeRequest('tok', 't1'));
    expect(res.status).toBe(500);
  });
});
