import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const m = vi.hoisted(() => ({ token: vi.fn(), permissions: {} as Record<string, boolean>, roster: [] as string[] }));
vi.mock('@/lib/firebase-admin', () => {
  const ref = (path: string): any => ({ collection: (id: string) => ref(`${path}/${id}`), doc: (id: string) => ref(`${path}/${id}`), get: async () => path.endsWith('/digitalProducts') ? { docs: [] } : { exists: true, data: () => path.startsWith('users/') ? { permissions: m.permissions } : { plan: 'ministry' } } });
  return { adminAuth: { verifyIdToken: m.token }, adminDb: { collection: (id: string) => ref(id), runTransaction: async (fn: any) => fn({ get: async () => ({ exists: true, data: () => ({}) }), set: vi.fn() }) } };
});
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: async () => ({ adminEmails: m.roster }) }));
vi.mock('@/lib/r2', () => ({ createR2Client: () => ({ send: async () => ({ ContentType: 'application/pdf', ContentLength: 10 }) }), r2Bucket: () => 'bucket' }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: async () => 'https://signed' }));
import { GET, POST as save } from '../route';
import { POST as upload } from '../upload/route';
const headers = { authorization: 'Bearer token' };
const post = (body: object) => new NextRequest('http://localhost/api', { method: 'POST', headers, body: JSON.stringify(body) });
const product = { tenantId: 'tenant1', id: 'product1', title: 'Book', description: '', coverUrl: '', priceCents: 0, status: 'draft', objectKey: 'private/tenants/tenant1/digital-products/product1/abc.pdf' };
const uploadBody = { tenantId: 'tenant1', productId: 'product1', contentType: 'application/pdf', fileSize: 10 };
const calls = async () => [await upload(post(uploadBody)), await save(post(product)), await GET(new NextRequest('http://localhost/api?admin=1&tenantId=tenant1', { headers }))];
beforeEach(() => { m.permissions = {}; m.roster = []; m.token.mockReset().mockResolvedValue({ uid: 'u', tenantId: 'tenant1', admin: true, email: 'admin@example.com' }); });
describe('digital admin permission', () => {
  it('denies an admin without createCourses on all endpoints', async () => { expect((await calls()).map(r => r.status)).toEqual([403, 403, 403]); });
  it('allows a createCourses admin', async () => { m.permissions = { createCourses: true }; expect((await calls()).map(r => r.status)).toEqual([200, 200, 200]); });
  it('allows a roster admin', async () => { m.token.mockResolvedValue({ uid: 'u', tenantId: 'tenant1', email: 'admin@example.com' }); m.roster = ['admin@example.com']; expect((await calls()).map(r => r.status)).toEqual([200, 200, 200]); });
  it('rejects another tenant even with full access', async () => { m.token.mockResolvedValue({ uid: 'u', tenantId: 'tenant2', admin: true, email: 'admin@example.com' }); m.permissions = { fullAccess: true }; expect((await calls()).map(r => r.status)).toEqual([403, 403, 403]); });
});
