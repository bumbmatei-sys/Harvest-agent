import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), docGet: vi.fn(), sign: vi.fn(), send: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mocks.auth, requireAdmin: mocks.auth }));
vi.mock('@/lib/firebase-admin', () => {
  const ref: any = { collection: () => ref, doc: () => ref, get: mocks.docGet };
  return { adminDb: { collection: () => ref, runTransaction: mocks.transaction } };
});
vi.mock('@/lib/r2', () => ({ createR2Client: () => ({ send: mocks.send }), r2Bucket: () => 'bucket' }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.sign }));
import { hasDigitalEntitlement, DIGITAL_URL_TTL_SECONDS } from '@/lib/digital-products';
import { POST as save } from '../route';
import { POST as download } from '../download/route';
import { POST as upload } from '../upload/route';
const request = (body: unknown) => new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify(body) });
const user = { uid: 'user1', tenantId: 'tenant1', isAdmin: true };
describe('digital products security', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue(user); mocks.sign.mockResolvedValue('https://signed.example'); });
  it('requires an active entitlement and propagates read errors', async () => {
    mocks.docGet.mockResolvedValueOnce({ exists: false }).mockResolvedValueOnce({ exists: true, data: () => ({ active: true }) }).mockRejectedValueOnce(new Error('read failed'));
    expect(await hasDigitalEntitlement('tenant1', 'product1', 'user1')).toBe(false);
    expect(await hasDigitalEntitlement('tenant1', 'product1', 'user1')).toBe(true);
    await expect(hasDigitalEntitlement('tenant1', 'product1', 'user1')).rejects.toThrow('read failed');
  });
  it('rejects unauthenticated callers and non-buyers', async () => {
    mocks.auth.mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    expect((await download(request({ productId: 'product1' }))).status).toBe(401);
    mocks.docGet.mockResolvedValue({ exists: false });
    expect((await download(request({ productId: 'product1' }))).status).toBe(403);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('rejects an object from a different tenant and signs a valid object briefly', async () => {
    mocks.docGet.mockResolvedValueOnce({ exists: true, data: () => ({ active: true }) }).mockResolvedValueOnce({ exists: true, data: () => ({ objectKey: 'private/tenants/tenant2/digital-products/product1/123.pdf' }) });
    expect((await download(request({ productId: 'product1' }))).status).toBe(404);
    mocks.docGet.mockResolvedValueOnce({ exists: true, data: () => ({ active: true }) }).mockResolvedValueOnce({ exists: true, data: () => ({ objectKey: 'private/tenants/tenant1/digital-products/product1/123.pdf', title: 'My / Book!' }) });
    const response = await download(request({ productId: 'product1' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: 'https://signed.example', expiresInSeconds: DIGITAL_URL_TTL_SECONDS });
    expect(mocks.sign.mock.calls[0][2]).toEqual({ expiresIn: 300 });
    expect(mocks.sign.mock.calls[0][1].input.ResponseContentDisposition).toBe('attachment; filename="my-book.pdf"');
  });
  it('rejects a new product when the plan product cap is reached', async () => {
    mocks.send.mockResolvedValue({ ContentType: 'application/pdf', ContentLength: 10 });
    const set = vi.fn();
    mocks.transaction.mockImplementation(async fn => fn({
      get: vi.fn().mockResolvedValueOnce({ exists: false })
        .mockResolvedValueOnce({ exists: true, data: () => ({ plan: 'free' }) })
        .mockResolvedValueOnce({ size: 0 }),
      set,
    }));
    const response = await save(request({ id: 'product1', title: 'Book', description: '', coverUrl: '', priceCents: 0, status: 'draft', objectKey: 'private/tenants/tenant1/digital-products/product1/123.pdf' }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('product_limit_reached');
    expect(set).not.toHaveBeenCalled();
  });
  it.each([
    ['application/pdf', 1024.5], ['application/pdf', 0], ['application/pdf', -1],
    ['application/pdf', 15 * 1024 * 1024 + 1], ['application/pdf', '1024'],
    ['application/octet-stream', 1024], ['image/png', 1024],
  ])('rejects type %s and size %s before signing', async (contentType, fileSize) => {
    expect((await upload(request({ productId: 'product1', contentType, fileSize }))).status).toBe(400);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('binds the PDF type and size to the upload signature', async () => {
    expect((await upload(request({ productId: 'product1', contentType: 'application/pdf', fileSize: 1024 }))).status).toBe(200);
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(mocks.sign.mock.calls[0][1].input).toMatchObject({ ContentType: 'application/pdf', ContentLength: 1024 });
    expect(mocks.sign.mock.calls[0][2]).toEqual({ expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length']) });
  });
});
