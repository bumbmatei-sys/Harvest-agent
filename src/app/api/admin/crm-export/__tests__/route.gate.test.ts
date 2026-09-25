/**
 * The founder CRM export's gate, run through the REAL `requireSuperAdmin`.
 *
 * `route.test.ts` replaces `@/lib/api-auth` wholesale, so on its own it proves
 * only that the route returns whatever the gate returns. This suite leaves the
 * gate real and mocks one level lower - the Admin SDK's token verification and
 * the users-doc read `verifyAuth` falls back to - so a tenant admin, whose token
 * carries `admin: true` and whose users doc says `role: 'admin'`, is refused by
 * the same code production runs. Hiding the button in AdminCRM is not the
 * access control; this is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { verifyIdToken, collection } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  collection: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: { verifyIdToken },
  adminDb: { collection, getAll: vi.fn(async () => []) },
}));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: vi.fn(async () => null) }));
vi.mock('@/utils/tenant-scope', () => ({ PLATFORM_TENANT_ID: 'harvest' }));

const { GET } = await import('../route');
const { SUPER_ADMIN_EMAILS } = await import('@/utils/super-admins');

/** Every collection read the route makes, so a refused call can prove it read nothing. */
const reads: string[] = [];

function emptyCollection(name: string) {
  const page = { get: async () => ({ empty: true, size: 0, docs: [] }) };
  const query = { limit: () => page, startAfter: () => query };
  return {
    orderBy: () => { reads.push(name); return query; },
    doc: (id: string) => ({
      id,
      // verifyAuth's users-doc fallback. A tenant admin's doc says 'admin'.
      get: async () => ({ exists: true, data: () => ({ role: 'admin', tenantId: 'grace' }) }),
    }),
  };
}

const request = (auth?: string) => new NextRequest(
  'https://theharvest.app/api/admin/crm-export?newsletter=in&type=all&q=',
  { headers: auth ? { authorization: auth } : {} },
);

beforeEach(() => {
  vi.clearAllMocks();
  reads.length = 0;
  collection.mockImplementation(emptyCollection);
});

describe('GET /api/admin/crm-export through the real requireSuperAdmin', () => {
  it('401 with no bearer token, and reads no users or contacts', async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
  });

  it('401 when the token does not verify', async () => {
    verifyIdToken.mockRejectedValue(new Error('auth/argument-error'));
    const res = await GET(request('Bearer forged'));
    expect(res.status).toBe(401);
    expect(reads).toEqual([]);
  });

  it('403 for a church admin (admin claim + admin role), and reads no users or contacts', async () => {
    verifyIdToken.mockResolvedValue({
      uid: 'grace-admin', email: 'pastor@grace.example.test', tenantId: 'grace', admin: true, auth_time: 1,
    });
    const res = await GET(request('Bearer tenant-admin'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Super admin access required' });
    expect(reads).toEqual([]);
  });

  it('200 CSV for a super admin by email', async () => {
    verifyIdToken.mockResolvedValue({
      uid: 'sa', email: SUPER_ADMIN_EMAILS[0], auth_time: 1,
    });
    const res = await GET(request('Bearer super-admin'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(reads.sort()).toEqual(['contacts', 'users']);
  });
});
