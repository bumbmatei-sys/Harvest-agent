import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const m = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), send: vi.fn(), sign: vi.fn(), data: new Map<string, any>(), writes: [] as string[] }));
vi.mock('@/lib/api-auth', () => ({ requireAuth: m.auth, requireTenantPermission: m.permission }));
vi.mock('@/lib/firebase-admin', () => {
  const ref = (path: string): any => ({ path, collection: (id: string) => ref(`${path}/${id}`), doc: (id: string) => ref(`${path}/${id}`), get: async () => {
    if (path.endsWith('/digitalProducts')) return { docs: [...m.data.entries()].filter(([key]) => key.startsWith(`${path}/`) && key.slice(path.length + 1).split('/').length === 1).map(([key, value]) => ({ id: key.split('/').pop(), data: () => value })) };
    const value = m.data.get(path); return { exists: value !== undefined, data: () => value };
  } });
  return { adminDb: { collection: (id: string) => ref(id), runTransaction: async (fn: any) => fn({ get: (r: any) => r.get(), set: (r: any, value: any) => { m.writes.push(r.path); m.data.set(r.path, value); } }) } };
});
vi.mock('@/lib/r2', () => ({ createR2Client: () => ({ send: m.send }), r2Bucket: () => 'bucket' }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: m.sign }));
import { GET, POST as save } from '../route';
import { POST as upload } from '../upload/route';
import { POST as claim } from '../claim/route';
import { POST as download } from '../download/route';
const base = 'tenants/tenant1/digitalProducts/product1';
const key = 'private/tenants/tenant1/digital-products/product1/abc.pdf';
const product = { id: 'product1', title: 'Book', description: '', coverUrl: '', priceCents: 0, status: 'published', objectKey: key, fileName: 'secret.pdf', fileSize: 10 };
const req = (body: object) => new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify(body) });
const get = (query = '') => new NextRequest(`http://localhost/api${query}`);
const user = { uid: 'user1', tenantId: 'tenant1', isAdmin: true };
beforeEach(() => { vi.resetAllMocks(); m.data.clear(); m.writes.length = 0; m.auth.mockResolvedValue(user); m.permission.mockResolvedValue(user); m.sign.mockResolvedValue('https://signed'); m.send.mockResolvedValue({ ContentType: 'application/pdf', ContentLength: 10 }); });
describe('review security and product access', () => {
  it.each([{ priceCents: 100, status: 'published' }, { priceCents: 0, status: 'draft' }, null])('refuses unavailable claim %s', async value => {
    if (value) m.data.set(base, value);
    expect((await claim(req({ productId: 'product1' }))).status).toBe(404); expect(m.writes).toEqual([]);
  });
  it('claims only for the caller tenant and is idempotent', async () => {
    m.data.set(base, product);
    for (let i = 0; i < 2; i++) expect((await claim(req({ productId: 'product1', tenantId: 'tenant2' }))).status).toBe(200);
    expect(m.writes).toEqual([`${base}/entitlements/user1`, `${base}/entitlements/user1`]);
    expect(m.data.get(`${base}/entitlements/user1`).active).toBe(true);
    expect([...m.data.keys()].filter(k => k.includes('/entitlements/'))).toHaveLength(1);
  });
  it('requires authentication for claim', async () => { m.auth.mockResolvedValue(NextResponse.json({}, { status: 401 })); expect((await claim(req({ productId: 'product1' }))).status).toBe(401); });
  it('lists published and owned unpublished products without private fields, and presence follows visibility', async () => {
    m.data.set(base, product); m.data.set('tenants/tenant1/digitalProducts/owned', { ...product, status: 'draft' }); m.data.set('tenants/tenant1/digitalProducts/hidden', { ...product, status: 'draft' });
    m.data.set('tenants/tenant1/digitalProducts/owned/entitlements/user1', { active: true });
    const result = await (await GET(get())).json();
    expect(result.products.map((p: any) => p.id)).toEqual(['product1', 'owned']);
    expect(result.products[1]).toMatchObject({ status: 'draft', entitled: true });
    for (const p of result.products) { expect(p).not.toHaveProperty('objectKey'); expect(p).not.toHaveProperty('fileName'); expect(p).not.toHaveProperty('fileSize'); }
    m.data.delete(base); expect(await (await GET(get('?presence=1'))).json()).toEqual({ present: true });
    m.data.delete('tenants/tenant1/digitalProducts/owned/entitlements/user1'); expect(await (await GET(get('?presence=1'))).json()).toEqual({ present: false });
    m.data.set(base, product); expect(await (await GET(get('?presence=1'))).json()).toEqual({ present: true });
  });
  it('checks the permission and target tenant on each admin endpoint', async () => {
    m.permission.mockResolvedValueOnce(NextResponse.json({}, { status: 403 })).mockResolvedValueOnce(NextResponse.json({}, { status: 403 })).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await upload(req({ tenantId: 'tenant1', productId: 'product1', contentType: 'application/pdf', fileSize: 1 }))).status).toBe(403);
    expect((await save(req({ ...product, tenantId: 'tenant1' }))).status).toBe(403);
    expect((await GET(get('?admin=1&tenantId=tenant1'))).status).toBe(403);
    expect(m.permission.mock.calls.map(c => c.slice(1))).toEqual(Array(3).fill(['tenant1', 'createCourses']));
  });
  it.each([{ ContentType: 'text/plain', ContentLength: 10 }, { ContentType: 'application/pdf', ContentLength: 15 * 1024 * 1024 + 1 }])('rejects bad HEAD %s', async head => { m.send.mockResolvedValue(head); expect((await save(req({ ...product, tenantId: 'tenant1' }))).status).toBe(400); expect(m.writes).toEqual([]); });
  it.each(['private/tenants/tenant2/digital-products/product1/abc.pdf', 'private/tenants/tenant1/digital-products/other/abc.pdf'])('rejects foreign key %s', async objectKey => { expect((await save(req({ ...product, objectKey, tenantId: 'tenant1' }))).status).toBe(400); expect(m.writes).toEqual([]); });
  it('edits at the cap and deletes a replaced key once after commit', async () => {
    const old = 'private/tenants/tenant1/digital-products/product1/abcd.pdf'; m.data.set(base, { ...product, objectKey: old });
    m.send.mockImplementation(async command => { if (command.constructor.name === 'DeleteObjectCommand') { expect(m.writes).toEqual([base]); return {}; } return { ContentType: 'application/pdf', ContentLength: 10 }; });
    expect((await save(req({ ...product, tenantId: 'tenant1' }))).status).toBe(200);
    expect(m.send.mock.calls.filter(c => c[0].constructor.name === 'DeleteObjectCommand').map(c => c[0].input.Key)).toEqual([old]);
    m.send.mockClear(); expect((await save(req({ ...product, tenantId: 'tenant1' }))).status).toBe(200); expect(m.send).toHaveBeenCalledTimes(1);
  });
  it('keeps a committed save when cleanup fails', async () => {
    m.data.set(base, { ...product, objectKey: 'private/tenants/tenant1/digital-products/product1/abcd.pdf' });
    m.send.mockImplementation(async command => { if (command.constructor.name === 'DeleteObjectCommand') throw new Error('delete failed'); return { ContentType: 'application/pdf', ContentLength: 10 }; });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { expect((await save(req({ ...product, tenantId: 'tenant1' }))).status).toBe(200); expect(m.data.get(base).objectKey).toBe(key); expect(log).toHaveBeenCalled(); }
    finally { log.mockRestore(); }
  });
  it('generates distinct random tenant-scoped upload keys', async () => {
    const body = { tenantId: 'tenant1', productId: 'product1', contentType: 'application/pdf', fileSize: 10 };
    const a = await (await upload(req(body))).json(); const b = await (await upload(req(body))).json();
    expect(a.key).toMatch(/^private\/tenants\/tenant1\/digital-products\/product1\/[0-9a-f-]{36}\.pdf$/); expect(a.key).not.toBe(b.key);
    expect(m.permission).toHaveBeenCalledWith(expect.anything(), 'tenant1', 'createCourses');
  });
  it.each(['../x', 'a/b'])('rejects unsafe id %s', async productId => { expect((await upload(req({ tenantId: 'tenant1', productId, contentType: 'application/pdf', fileSize: 10 }))).status).toBe(400); });
  it('rejects inactive entitlement and deleted product, and prevents caching', async () => {
    m.data.set(`${base}/entitlements/user1`, { active: false }); expect((await download(req({ productId: 'product1' }))).status).toBe(403);
    m.data.set(`${base}/entitlements/user1`, { active: true }); expect((await download(req({ productId: 'product1' }))).status).toBe(404);
    m.data.set(base, product); const response = await download(req({ productId: 'product1' })); expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
