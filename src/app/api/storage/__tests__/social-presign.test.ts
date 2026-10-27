// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_PDF_UPLOAD_BYTES, MAX_SOCIAL_IMAGE_UPLOAD_BYTES, MAX_SOCIAL_VIDEO_UPLOAD_BYTES } from '@/utils/upload-limits';
import { isTenantUploadKey } from '@/utils/r2-keys';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), sign: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireAdmin: mocks.auth }));
vi.mock('@/utils/tenant-scope', () => ({ PLATFORM_TENANT_ID: 'platform' }));
vi.mock('@/lib/r2', () => ({ createR2Client: () => ({}), r2Bucket: () => 'bucket' }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.sign }));
import { POST } from '../presign/route';

async function send(contentType: string, fileSize: number, purpose?: string) {
  const response = await POST({ json: async () => ({ fileName: 'file', contentType, fileSize, purpose }) } as never);
  return { status: response.status, body: await response.json() };
}

describe('social presign', () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ tenantId: 'tenant-a' });
    mocks.sign.mockResolvedValue('https://upload.example');
    vi.stubEnv('R2_PUBLIC_URL', 'https://cdn.example');
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
  });
});
