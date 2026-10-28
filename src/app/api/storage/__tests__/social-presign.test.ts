// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_PDF_UPLOAD_BYTES, MAX_SOCIAL_IMAGE_UPLOAD_BYTES, MAX_SOCIAL_VIDEO_UPLOAD_BYTES } from '@/utils/upload-limits';
import { isTenantUploadKey } from '@/utils/r2-keys';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), requireAuth: vi.fn(), sign: vi.fn(), privateData: { adminEmails: [] as string[] }, userData: { role: 'user' }, tenantData: { plan: 'free', addons: { socialScheduler: 1 } } }));
vi.mock('@/lib/api-auth', () => ({ requireAdmin: mocks.auth, requireAuth: mocks.requireAuth }));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: async () => mocks.privateData }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: (name: string) => ({ doc: () => ({ get: async () => ({ exists: true, data: () => name === 'users' ? mocks.userData : mocks.tenantData }) }) }) } }));
vi.mock('@/lib/firebase-admin-credentials', () => ({ firebaseAdminCredentialsAvailable: () => true }));
vi.mock('@/utils/tenant-scope', () => ({ PLATFORM_TENANT_ID: 'platform' }));
vi.mock('@/lib/r2', () => ({ createR2Client: () => ({}), r2Bucket: () => 'bucket' }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.sign }));
import { POST } from '../presign/route';

async function send(contentType: string, fileSize: number, purpose?: string, headers = new Headers()) {
  const response = await POST({ headers, json: async () => ({ fileName: 'file', contentType, fileSize, purpose, tenantId: 'foreign' }) } as never);
  return { status: response.status, body: await response.json() };
}

describe('social presign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('ZERNIO_SOCIAL_MODE', 'mock');
    mocks.auth.mockResolvedValue({ tenantId: 'tenant-a' });
    mocks.requireAuth.mockResolvedValue({ uid: 'roster', email: 'admin@example.com', emailVerified: true, tenantId: 'tenant-a', isAdmin: false, isSuperAdmin: false });
    mocks.privateData = { adminEmails: ['admin@example.com'] };
    mocks.userData = { role: 'user' };
    mocks.tenantData = { plan: 'free', addons: { socialScheduler: 1 } };
    mocks.sign.mockResolvedValue('https://upload.example');
    vi.stubEnv('R2_PUBLIC_URL', 'https://cdn.example');
  });
  it('binds the declared social size and type into the signature', async () => {
    expect((await send('video/mp4', 12345, 'social')).status).toBe(200);
    const [, command, options] = mocks.sign.mock.calls[0];
    expect(command.input).toMatchObject({ ContentType: 'video/mp4', ContentLength: 12345 });
    expect(options.signableHeaders).toEqual(new Set(['content-type', 'content-length']));
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it('enforces scheduler access and never mints a sample-scope key', async () => {
    expect((await send('image/png', 1, 'social')).status).toBe(200);
    mocks.tenantData.addons.socialScheduler = 0;
    expect((await send('image/png', 1, 'social')).status).toBe(403);
    mocks.tenantData.addons.socialScheduler = 1;
    mocks.privateData.adminEmails = [];
    expect((await send('image/png', 1, 'social')).status).toBe(403);
    mocks.privateData.adminEmails = ['admin@example.com'];
    expect((await send('image/png', 1, 'social', new Headers({ 'x-harvest-tenant': 'tenant-b' }))).status).toBe(403);
    vi.stubEnv('ZERNIO_SOCIAL_MODE', 'sample');
    mocks.requireAuth.mockResolvedValue({ uid: 'super', tenantId: null, isSuperAdmin: true });
    expect((await send('image/png', 1, 'social')).status).toBe(403);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });
  it.each(['https://cdn.example', 'https://cdn.example/'])('normalizes public base %s', async (base) => {
    vi.stubEnv('R2_PUBLIC_URL', base);
    const result = await send('image/png', 1, 'social');
    expect(result.body.publicUrl).toBe(`https://cdn.example/${result.body.key}`);
  });
  it('accepts supported social types at their caps and produces a tenant key', async () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime']) {
      const cap = type.startsWith('video/') ? MAX_SOCIAL_VIDEO_UPLOAD_BYTES : MAX_SOCIAL_IMAGE_UPLOAD_BYTES;
      const result = await send(type, cap, 'social');
      expect(result.status).toBe(200);
      expect(isTenantUploadKey(result.body.key, 'tenant-a')).toBe(true);
      expect(result.body.publicUrl).toBe(`https://cdn.example/${result.body.key}`);
      expect((await send(type, cap + 1, 'social')).status).toBe(400);
    }
  });
  it('rejects other social types and retains existing limits and types', async () => {
    expect((await send('application/pdf', 1, 'social')).status).toBe(400);
    expect((await send('image/svg+xml', 1, 'social')).status).toBe(400);
    expect((await send('video/mp4', 1)).status).toBe(400);
    expect((await send('image/jpeg', MAX_SOCIAL_IMAGE_UPLOAD_BYTES)).status).toBe(400);
    expect((await send('image/jpeg', MAX_IMAGE_UPLOAD_BYTES)).status).toBe(200);
    expect((await send('image/svg+xml', 1)).status).toBe(200);
    expect((await send('application/pdf', MAX_PDF_UPLOAD_BYTES)).status).toBe(200);
    expect((await send('application/pdf', MAX_PDF_UPLOAD_BYTES + 1)).status).toBe(400);
    expect(mocks.auth).toHaveBeenCalled();
  });
});
