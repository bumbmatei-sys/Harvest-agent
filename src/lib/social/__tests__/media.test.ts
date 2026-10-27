import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_SOCIAL_IMAGE_UPLOAD_BYTES, MAX_SOCIAL_VIDEO_UPLOAD_BYTES } from '@/utils/upload-limits';
import { validateSocialMedia } from '../media-rules';
import { parseSocialDraft } from '../draft';
import { LiveSocialClient, toProviderBody } from '../live-client';
import { MockSocialClient, resetSocialMock } from '../mock-client';
import type { SocialPostDraft } from '../types';

const base = 'https://cdn.example/assets';
const context = { tenantId: 'ministry-a', publicUrl: base };
const image = { name: 'a.jpg', url: `${base}/tenants/ministry-a/uploads/a.jpg`, kind: 'image' as const, mimeType: 'image/jpeg' };
const video = { name: 'a.mp4', url: `${base}/tenants/ministry-a/uploads/a.mp4`, kind: 'video' as const, mimeType: 'video/mp4' };
const body = (platform: string, media: unknown[]) => ({ content: 'Hello', publishNow: true, targets: [{ platform, accountId: 'account' }], media });
const now = new Date('2020-01-01T00:00:00Z');

describe('social media rules', () => {
  it('accepts supported types at their caps and rejects other types or sizes', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(validateSocialMedia([{ kind: 'image', mimeType, size: MAX_SOCIAL_IMAGE_UPLOAD_BYTES }], [])).toBeNull();
    }
    for (const mimeType of ['video/mp4', 'video/quicktime']) {
      expect(validateSocialMedia([{ kind: 'video', mimeType, size: MAX_SOCIAL_VIDEO_UPLOAD_BYTES }], [])).toBeNull();
    }
    expect(MAX_IMAGE_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
    expect(validateSocialMedia([{ kind: 'image', mimeType: 'image/svg+xml' }], [])).toBe('media_invalid');
    expect(validateSocialMedia([{ kind: 'video', mimeType: 'image/png' }], [])).toBe('media_invalid');
    expect(validateSocialMedia([{ kind: 'image', size: MAX_SOCIAL_IMAGE_UPLOAD_BYTES + 1 }], [])).toBe('media_invalid');
    expect(validateSocialMedia([{ kind: 'video', size: MAX_SOCIAL_VIDEO_UPLOAD_BYTES + 1 }], [])).toBe('media_invalid');
  });
  it('enforces counts, mixing and platform requirements', () => {
    expect(validateSocialMedia(Array(10).fill(image), ['instagram'])).toBeNull();
    expect(validateSocialMedia(Array(11).fill(image), ['facebook'])).toBe('media_too_many');
    expect(validateSocialMedia([image, video], ['facebook'])).toBe('media_invalid');
    expect(validateSocialMedia([video, video], ['facebook'])).toBe('media_invalid');
    expect(validateSocialMedia([], ['facebook', 'threads'])).toBeNull();
    expect(validateSocialMedia([], ['instagram'])).toBe('instagram_needs_media');
    for (const platform of ['youtube', 'tiktok'] as const) {
      expect(validateSocialMedia([image], [platform])).toBe(`${platform}_needs_video`);
      expect(validateSocialMedia([video], [platform])).toBeNull();
    }
  });
});

describe('untrusted draft media', () => {
  it('accepts tenant media and applies platform rules', () => {
    expect(parseSocialDraft(body('instagram', [image]), now, context)).toMatchObject({ ok: true, draft: { media: [{ url: image.url, kind: image.kind, mimeType: image.mimeType }] } });
    for (const platform of ['youtube', 'tiktok']) expect(parseSocialDraft(body(platform, [video]), now, context).ok).toBe(true);
    expect(parseSocialDraft(body('instagram', []), now, context)).toEqual({ ok: false, error: 'instagram_needs_media' });
    expect(parseSocialDraft(body('facebook', Array(11).fill(image)), now, context)).toEqual({ ok: false, error: 'media_too_many' });
  });
  it('refuses foreign, other-tenant, traversal, non-HTTPS and missing configuration', () => {
    for (const url of ['https://evil.example/assets/tenants/ministry-a/uploads/a.jpg', `${base}/tenants/ministry-b/uploads/a.jpg`, `${base}/tenants/ministry-a/uploads/%2Fother`, `${base}/tenants/ministry-a/uploads/a.jpg?x=1`, 'http://cdn.example/assets/tenants/ministry-a/uploads/a.jpg']) {
      expect(parseSocialDraft(body('facebook', [{ ...image, url }]), now, context)).toEqual({ ok: false, error: 'media_invalid' });
    }
    expect(parseSocialDraft(body('facebook', [image]), now)).toEqual({ ok: false, error: 'media_invalid' });
    expect(parseSocialDraft(body('facebook', [{ ...image, mimeType: 'video/mp4' }]), now, context)).toEqual({ ok: false, error: 'media_invalid' });
  });
});

describe('provider media', () => {
  const draft = (media: SocialPostDraft['media'], publishNow = false): SocialPostDraft => ({ content: 'Hello', scheduledFor: null, timezone: 'UTC', publishNow, targets: [{ platform: 'facebook', accountId: 'account', text: 'Hello', fields: {}, madeWithAi: false }], media });
  it('maps image, carousel and video in order', () => {
    for (const media of [[image], [image, { ...image, url: `${base}/tenants/ministry-a/uploads/b.png` }], [video]]) {
      expect(toProviderBody('profile', draft(media)).mediaItems).toEqual(media.map(item => ({ url: item.url, type: item.kind })));
    }
    expect(() => toProviderBody(null, draft([{ name: 'old', kind: 'image' }]))).toThrow('URL');
  });
  it('sends media on create, update and publish now, and reads provider URLs', async () => {
    const sent: Record<string, unknown>[] = [];
    const client = new LiveSocialClient('test', async (_url, init) => {
      sent.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ post: { id: 'p', mediaItems: [{ url: image.url, type: 'image' }] } }), { status: 200 });
    });
    const created = await client.create('profile', draft([image]));
    await client.update('p', draft([image, image]));
    await client.create('profile', draft([video], true));
    await client.update('p', draft([video], true));
    expect(sent.map(row => row.mediaItems)).toEqual([[{ url: image.url, type: 'image' }], [{ url: image.url, type: 'image' }, { url: image.url, type: 'image' }], [{ url: video.url, type: 'video' }], [{ url: video.url, type: 'video' }]]);
    expect(sent[2].publishNow).toBe(true);
    expect(sent[3].publishNow).toBe(true);
    expect(created?.media[0].url).toBe(image.url);
  });
  it('preserves media in mock creates and edits', () => {
    resetSocialMock();
    const client = new MockSocialClient('a', now);
    const created = client.create(draft([image]));
    expect(created.media).toEqual([image]);
    expect(client.update(created.id, draft([video]))?.media).toEqual([video]);
    expect(client.load().posts.find(post => post.id === created.id)?.media).toEqual([video]);
  });
});
