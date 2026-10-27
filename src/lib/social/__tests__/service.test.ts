import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockSocialClient, resetSocialMock } from '../mock-client';
import type { SocialActor } from '../access';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  tokens: new Map<string, Record<string, unknown>>(),
  tokenSetFails: false,
  userDoc: { role: 'church_admin', permissions: {} as Record<string, unknown> },
  privateDoc: { adminEmails: [] as string[] },
  tenantDoc: {
    name: 'Grace Chapel',
    plan: 'plus',
    addons: { socialScheduler: 1 },
  } as Record<string, unknown>,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id?: string) => {
        if (name === 'social_confirm_tokens') {
          const key = id ?? '';
          return {
            get: async () => {
              const data = h.tokens.get(key);
              return { exists: data !== undefined, data: () => data };
            },
            set: async (data: Record<string, unknown>) => {
              if (h.tokenSetFails) throw new Error('Could not load the default credentials');
              h.tokens.set(key, { ...data });
            },
            update: async (patch: Record<string, unknown>) => {
              const current = h.tokens.get(key);
              if (!current) return;
              h.tokens.set(key, { ...current, ...patch });
            },
          };
        }
        return {
          get: () => h.get(name),
          set: (...args: unknown[]) => h.set(name, ...args),
          update: (...args: unknown[]) => h.update(name, ...args),
        };
      },
    }),
    runTransaction: async (fn: (tx: {
      get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>;
      update: (ref: { update: (patch: Record<string, unknown>) => Promise<void> }, patch: Record<string, unknown>) => Promise<void>;
    }) => Promise<unknown>) => fn({
      get: (ref) => ref.get(),
      update: (ref, patch) => ref.update(patch),
    }),
  },
}));

import { resetPublishOnce } from '../publish-once';
import { cancel, createDraft, list, schedule, update, validate } from '../service';

const SCHEDULE_KEY = '22222222-2222-4222-8222-222222222222';

const ADC = 'Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.';

const actor: SocialActor = {
  uid: 'admin-1',
  email: 'owner@church.test',
  emailVerified: true,
  tenantId: 'tenant-a',
  isSuperAdmin: false,
  requestedTenantId: null,
};

function future(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function tokenOf(result: { ok: boolean; data?: unknown }): string {
  if (!result.ok || !result.data || typeof result.data !== 'object' || !('confirmToken' in result.data)) {
    throw new Error('expected a preview token');
  }
  const token = (result.data as { confirmToken?: unknown }).confirmToken;
  if (typeof token !== 'string' || !token) throw new Error('expected a preview token');
  return token;
}

function postBody(platform: string, extra: Record<string, unknown> = {}) {
  return {
    content: 'Sunday at 10.',
    publishNow: false,
    scheduledFor: future(),
    confirm: false,
    ...(platform === 'instagram' ? { media: [{ url: 'https://cdn.example/tenants/tenant-a/uploads/photo.jpg', kind: 'image' }] } : {}),
    targets: [{ platform, accountId: 'sample-ig', text: 'Sunday at 10.', madeWithAi: true }],
    ...extra,
  };
}

describe('social service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.tokens.clear();
    h.tokenSetFails = false;
    resetSocialMock();
    resetPublishOnce();
    vi.stubEnv('R2_PUBLIC_URL', 'https://cdn.example');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('ZERNIO_API_KEY', '');
    vi.stubEnv('ZERNIO_SOCIAL_LIVE', '');
    vi.stubEnv('ZERNIO_SOCIAL_MODE', '');
    h.userDoc = { role: 'church_admin', permissions: {} };
    h.privateDoc = { adminEmails: [] };
    h.tenantDoc = { name: 'Grace Chapel', plan: 'plus', addons: { socialScheduler: 1 } };
    h.get.mockImplementation(async (name: string) => {
      if (name === 'users') return { exists: true, data: () => h.userDoc };
      if (name === 'tenant_private') return { exists: true, data: () => h.privateDoc };
      if (name === 'tenants') return { exists: true, data: () => h.tenantDoc };
      return { exists: false, data: () => ({}) };
    });
  });

  it('lists the ministry sample and refuses another ministry in the same call', async () => {
    const listed = await list(actor);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.accounts.map((account) => account.platform).sort()).toEqual(['facebook', 'instagram', 'youtube']);
    expect(listed.data.sample).toBe(true);

    const other = await list({ ...actor, requestedTenantId: 'other-ministry' });
    expect(other).toMatchObject({ ok: false, status: 403, error: 'Access denied to this tenant' });
  });

  it('keeps the sample ministry zone when the caller names another', async () => {
    const listed = await list(actor, 'America/New_York');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.timezone).toBe('America/Chicago');
  });

  it('refuses an unentitled production ministry and a normal admin still needs the add-on', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    h.tenantDoc = { plan: 'plus', addons: { socialScheduler: 0 } };
    const denied = await list(actor);
    expect(denied).toMatchObject({ ok: false, status: 403, error: 'social_scheduler_not_entitled' });
  });

  it('lets a super admin through without the add-on and does not write it', async () => {
    h.tenantDoc = { plan: 'plus', addons: { socialScheduler: 0 } };
    const opened = await list({ ...actor, isSuperAdmin: true });
    expect(opened.ok).toBe(true);
    expect(h.set).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('refuses a platform outside the five before anything is saved', async () => {
    const before = new MockSocialClient('tenant-a', new Date()).load().posts.length;
    for (const platform of ['twitter', 'linkedin', 'pinterest']) {
      const result = await schedule(actor, postBody(platform), null);
      expect(result).toMatchObject({ ok: false, error: 'platform_not_offered' });
    }
    expect(new MockSocialClient('tenant-a', new Date()).load().posts).toHaveLength(before);
  });

  it('previews a schedule and writes only on confirm', async () => {
    const before = new MockSocialClient('tenant-a', new Date()).load().posts.length;
    const body = postBody('instagram');
    const preview = await schedule(actor, body, null);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data).toMatchObject({
      requiresConfirm: true,
      sample: true,
      preview: {
        action: 'schedule',
        ministryId: 'tenant-a',
        ministryName: 'Sample Ministry',
        platforms: ['instagram'],
        content: 'Sunday at 10.',
        publishNow: false,
      },
    });
    expect(typeof tokenOf(preview)).toBe('string');
    expect(new MockSocialClient('tenant-a', new Date()).load().posts).toHaveLength(before);

    const bare = await schedule(actor, { ...body, confirm: true }, null);
    expect(bare).toMatchObject({ ok: false, error: 'confirm_token_required' });
    expect(new MockSocialClient('tenant-a', new Date()).load().posts).toHaveLength(before);

    const missingKey = await schedule(actor, { ...body, confirmToken: tokenOf(preview) }, null);
    expect(missingKey).toMatchObject({ ok: false, error: 'idempotency_key_required' });
    expect(new MockSocialClient('tenant-a', new Date()).load().posts).toHaveLength(before);

    const saved = await schedule(actor, { ...body, confirmToken: tokenOf(preview) }, SCHEDULE_KEY);
    expect(saved.ok).toBe(true);
    if (!saved.ok || !('post' in saved.data)) return;
    expect(saved.data.post.status).toBe('scheduled');
    expect(new MockSocialClient('tenant-a', new Date()).load().posts).toHaveLength(before + 1);
  });

  it('previews publish and refuses a confirm that has no idempotency key', async () => {
    const before = new MockSocialClient('tenant-a', new Date()).load().posts.length;
    const body = postBody('instagram', { publishNow: true, confirm: false });
    const preview = await schedule(actor, body, null);
    expect(preview.ok).toBe(true);
    if (!preview.ok || !('preview' in preview.data)) return;
    expect(preview.data.preview.action).toBe('publish');
    expect(preview.data.preview.publishNow).toBe(true);
    expect(new MockSocialClient('tenant-a', new Date()).load().posts).toHaveLength(before);

    const missing = await schedule(actor, { ...body, confirmToken: tokenOf(preview) }, null);
    expect(missing).toMatchObject({ ok: false, error: 'idempotency_key_required' });
    expect(new MockSocialClient('tenant-a', new Date()).load().posts).toHaveLength(before);

    const published = await schedule(
      actor,
      { ...body, confirmToken: tokenOf(preview) },
      '11111111-1111-4111-8111-111111111111',
    );
    expect(published.ok).toBe(true);
  });

  it('refuses an account that this ministry does not own', async () => {
    const result = await schedule(actor, postBody('instagram', {
      confirmToken: '11111111-1111-4111-8111-111111111111',
      targets: [{ platform: 'instagram', accountId: 'other-church-account', text: 'Sunday at 10.', madeWithAi: false }],
    }), null);
    expect(result).toMatchObject({ ok: false, status: 403, error: 'account_not_owned' });
  });

  it('requires a video for YouTube and refuses a malformed attachment', async () => {
    const bare = await schedule(actor, postBody('youtube', {
      targets: [{ platform: 'youtube', accountId: 'sample-yt', text: 'A short.', madeWithAi: false }],
    }), null);
    expect(bare).toMatchObject({ ok: false, error: 'youtube_needs_video' });
    const withFile = await schedule(actor, postBody('youtube', {
      media: [{ name: 'clip.mp4', kind: 'video' }],
      targets: [{ platform: 'youtube', accountId: 'sample-yt', text: 'A short.', madeWithAi: false }],
    }), null);
    expect(withFile).toMatchObject({ ok: false, error: 'media_invalid' });
  });

  it('validate reads and does not write', async () => {
    const before = new MockSocialClient('tenant-a', new Date()).load().posts.length;
    const refused = await validate(actor, postBody('twitter'));
    expect(refused.ok).toBe(false);
    const owned = await validate(actor, postBody('instagram'));
    expect(owned.ok).toBe(true);
    expect(new MockSocialClient('tenant-a', new Date()).load().posts).toHaveLength(before);
  });

  it('saves a draft without publishing', async () => {
    const saved = await createDraft(actor, postBody('instagram', { draft: true }));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.post.status).toBe('draft');
    expect(saved.data.post.scheduledFor).toBeNull();
  });

  function postContent(id: string): string | undefined {
    return new MockSocialClient('tenant-a', new Date()).load().posts.find((post) => post.id === id)?.content;
  }

  it('previews an edit and writes the new text only on confirm', async () => {
    const body = postBody('instagram');
    const preview = await update(actor, 'sample-scheduled', body, null);
    expect(preview).toMatchObject({
      ok: true,
      data: {
        requiresConfirm: true,
        preview: {
          action: 'update',
          ministryId: 'tenant-a',
          ministryName: 'Sample Ministry',
          platforms: ['instagram'],
          content: 'Sunday at 10.',
          postId: 'sample-scheduled',
          publishNow: false,
        },
      },
    });
    expect(typeof tokenOf(preview)).toBe('string');
    expect(postContent('sample-scheduled')).toContain('Verse of the day');

    const bare = await update(actor, 'sample-scheduled', { ...body, confirm: true }, null);
    expect(bare).toMatchObject({ ok: false, error: 'confirm_token_required' });
    expect(postContent('sample-scheduled')).toContain('Verse of the day');

    const saved = await update(actor, 'sample-scheduled', { ...body, confirmToken: tokenOf(preview) }, null);
    expect(saved.ok).toBe(true);
    expect(postContent('sample-scheduled')).toBe('Sunday at 10.');

    const sent = await update(actor, 'sample-sent', postBody('facebook', {
      targets: [{ platform: 'facebook', accountId: 'sample-fb', text: 'Sunday at 10.', madeWithAi: false }],
    }), null);
    expect(sent).toMatchObject({ ok: false, status: 404, error: 'post_not_editable' });
  });

  it('retains only media already on the edited post, even when hosted by the provider', async () => {
    const client = new MockSocialClient('tenant-a', new Date());
    const original = client.load().posts.find(post => post.id === 'sample-draft')!;
    const url = 'https://media.zernio.example/copied.jpg';
    client.update(original.id, { ...original, publishNow: false, media: [{ name: url, url, kind: 'image' }] });
    const body = postBody('instagram', { scheduledFor: null, media: [{ url, kind: 'image' }] });
    const preview = await update(actor, original.id, body, null);
    expect(preview.ok).toBe(true);
    const saved = await update(actor, original.id, { ...body, confirmToken: tokenOf(preview) }, null);
    expect(saved).toMatchObject({ ok: true, data: { post: { media: [{ url }] } } });
    expect(await update(actor, original.id, { ...body, media: [{ url: `${url}?other`, kind: 'image' }] }, null)).toMatchObject({ ok: false, error: 'media_invalid' });
    expect(await update(actor, 'sample-scheduled', { ...body, scheduledFor: future() }, null)).toMatchObject({ ok: false, error: 'media_invalid' });
    expect(await createDraft(actor, body)).toMatchObject({ ok: false, error: 'media_invalid' });
  });

  it('refuses an edit token that is missing, changed, foreign, reused, or expired', async () => {
    const body = postBody('facebook');
    const preview = await update(actor, 'sample-scheduled', body, null);
    const token = tokenOf(preview);

    const changed = await update(actor, 'sample-scheduled', { ...body, content: 'Monday at 11.', confirmToken: token }, null);
    expect(changed).toMatchObject({ ok: false, error: 'confirm_invalid' });
    const otherMinistry = await update({ ...actor, tenantId: 'tenant-b' }, 'sample-scheduled', { ...body, confirmToken: token }, null);
    expect(otherMinistry).toMatchObject({ ok: false, error: 'confirm_invalid' });
    const otherPerson = await update({ ...actor, uid: 'admin-2' }, 'sample-scheduled', { ...body, confirmToken: token }, null);
    expect(otherPerson).toMatchObject({ ok: false, error: 'confirm_invalid' });
    expect(postContent('sample-scheduled')).toContain('Verse of the day');

    const saved = await update(actor, 'sample-scheduled', { ...body, confirmToken: token }, null);
    expect(saved.ok).toBe(true);
    const reused = await update(actor, 'sample-scheduled', { ...body, confirmToken: token }, null);
    expect(reused).toMatchObject({ ok: false, error: 'confirm_invalid' });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2024, 5, 1, 12)));
    try {
      const later = postBody('instagram', { scheduledFor: new Date(Date.UTC(2024, 5, 8, 12)).toISOString() });
      const expiring = await update(actor, 'sample-scheduled', later, null);
      vi.setSystemTime(new Date(Date.UTC(2024, 5, 1, 12, 11)));
      const expired = await update(actor, 'sample-scheduled', { ...later, confirmToken: tokenOf(expiring) }, null);
      expect(expired).toMatchObject({ ok: false, error: 'confirm_invalid' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel previews the post and deletes it only on confirm', async () => {
    const preview = await cancel(actor, 'sample-draft', {});
    expect(preview).toMatchObject({
      ok: true,
      data: {
        requiresConfirm: true,
        preview: {
          action: 'cancel',
          ministryId: 'tenant-a',
          ministryName: 'Sample Ministry',
          postId: 'sample-draft',
          platforms: ['instagram'],
        },
      },
    });
    expect(tokenOf(preview)).toEqual(expect.any(String));
    expect(postContent('sample-draft')).toContain('Sunday');

    const bare = await cancel(actor, 'sample-draft', { confirm: true });
    expect(bare).toMatchObject({ ok: false, error: 'confirm_token_required' });
    expect(postContent('sample-draft')).toContain('Sunday');

    const removed = await cancel(actor, 'sample-draft', { confirmToken: tokenOf(preview) });
    expect(removed.ok).toBe(true);
    expect(postContent('sample-draft')).toBeUndefined();
  });

  it('refuses a cancel token that is changed, foreign, reused, or expired', async () => {
    const preview = await cancel(actor, 'sample-draft', {});
    const token = tokenOf(preview);
    const otherMinistry = await cancel({ ...actor, tenantId: 'tenant-b' }, 'sample-draft', { confirmToken: token });
    expect(otherMinistry).toMatchObject({ ok: false, error: 'confirm_invalid' });
    const otherPerson = await cancel({ ...actor, uid: 'admin-2' }, 'sample-draft', { confirmToken: token });
    expect(otherPerson).toMatchObject({ ok: false, error: 'confirm_invalid' });
    expect(postContent('sample-draft')).toContain('Sunday');

    const removed = await cancel(actor, 'sample-draft', { confirmToken: token });
    expect(removed.ok).toBe(true);
    const reused = await cancel(actor, 'sample-scheduled', { confirmToken: token });
    expect(reused).toMatchObject({ ok: false, error: 'confirm_invalid' });
    expect(postContent('sample-scheduled')).toContain('Verse of the day');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2024, 5, 1, 12)));
    try {
      const expiring = await cancel(actor, 'sample-scheduled', {});
      vi.setSystemTime(new Date(Date.UTC(2024, 5, 1, 12, 11)));
      const expired = await cancel(actor, 'sample-scheduled', { confirmToken: tokenOf(expiring) });
      expect(expired).toMatchObject({ ok: false, error: 'confirm_invalid' });
      expect(postContent('sample-scheduled')).toContain('Verse of the day');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a token bound to another action or another post', async () => {
    const body = postBody('instagram');
    const scheduled = await schedule(actor, body, null);
    const scheduleToken = tokenOf(scheduled);
    const asUpdate = await update(actor, 'sample-scheduled', { ...body, confirmToken: scheduleToken }, null);
    expect(asUpdate).toMatchObject({ ok: false, error: 'confirm_invalid' });
    expect(postContent('sample-scheduled')).toContain('Verse of the day');

    const edited = await update(actor, 'sample-scheduled', body, null);
    const updateToken = tokenOf(edited);
    const otherPost = await update(actor, 'sample-draft', { ...body, confirmToken: updateToken }, null);
    expect(otherPost).toMatchObject({ ok: false, error: 'confirm_invalid' });
    expect(postContent('sample-draft')).toContain('parable');

    const dropped = await cancel(actor, 'sample-draft', {});
    const cancelToken = tokenOf(dropped);
    const wrongPost = await cancel(actor, 'sample-scheduled', { confirmToken: cancelToken });
    expect(wrongPost).toMatchObject({ ok: false, error: 'confirm_invalid' });
    expect(postContent('sample-scheduled')).toContain('Verse of the day');
    expect(postContent('sample-draft')).toContain('parable');
  });

  it('rejects an edit token spent on cancel of the same post', async () => {
    const content = 'This Sunday: a short word on the parable of the sower. Service at 10.';
    const body = {
      content,
      media: [{ url: 'https://cdn.example/tenants/tenant-a/uploads/photo.jpg', kind: 'image' }],
      publishNow: false,
      scheduledFor: null,
      timezone: 'America/Chicago',
      targets: [{
        platform: 'instagram',
        accountId: 'sample-ig',
        text: content,
        fields: {},
        madeWithAi: false,
      }],
    };
    const edited = await update(actor, 'sample-draft', body, null);
    const spent = await cancel(actor, 'sample-draft', { confirmToken: tokenOf(edited) });
    expect(spent).toMatchObject({ ok: false, error: 'confirm_invalid' });
    expect(postContent('sample-draft')).toContain('parable');
  });

  it('still confirms on a preview when Firestore cannot store the token', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    h.tokenSetFails = true;
    const body = postBody('instagram');
    const preview = await schedule(actor, body, null);
    expect(preview.ok).toBe(true);
    expect(typeof tokenOf(preview)).toBe('string');
    const saved = await schedule(actor, { ...body, confirmToken: tokenOf(preview) }, SCHEDULE_KEY);
    expect(saved.ok).toBe(true);
  });

  it('refuses a schedule that has no time', async () => {
    const result = await schedule(actor, postBody('instagram', { scheduledFor: null }), null);
    expect(result).toMatchObject({ ok: false, error: 'schedule_invalid' });
    expect(new MockSocialClient('tenant-a', new Date()).load().posts.filter((post) => post.content === 'Sunday at 10.')).toHaveLength(0);
  });

  it('saves a text edit of an undated draft and refuses to drop a scheduled time', async () => {
    const body = postBody('instagram', {
      content: 'A revised Sunday word.',
      scheduledFor: null,
      targets: [{ platform: 'instagram', accountId: 'sample-ig', text: 'A revised Sunday word.', madeWithAi: false }],
    });
    const preview = await update(actor, 'sample-draft', body, null);
    expect(preview).toMatchObject({ ok: true });
    if (!preview.ok || !('preview' in preview.data)) return;
    expect(preview.data.preview.scheduledFor).toBeNull();
    const bare = await update(actor, 'sample-draft', { ...body, confirm: true }, null);
    expect(bare).toMatchObject({ ok: false, error: 'confirm_token_required' });
    expect(postContent('sample-draft')).toContain('parable');
    const saved = await update(actor, 'sample-draft', { ...body, confirmToken: tokenOf(preview) }, null);
    expect(saved.ok).toBe(true);
    if (!saved.ok || !('post' in saved.data)) return;
    expect(saved.data.post.content).toBe('A revised Sunday word.');
    expect(saved.data.post.scheduledFor).toBeNull();
    expect(saved.data.post.status).toBe('draft');

    const stripped = await update(actor, 'sample-scheduled', body, null);
    expect(stripped).toMatchObject({ ok: false, error: 'schedule_invalid' });
    expect(postContent('sample-scheduled')).toContain('Verse of the day');
  });

  it('refuses a missing, changed, foreign, or reused confirm token', async () => {
    const body = postBody('facebook');
    const before = new MockSocialClient('tenant-a', new Date()).load().posts.length;
    const preview = await schedule(actor, body, null);
    const token = tokenOf(preview);

    const changed = await schedule(actor, { ...body, content: 'Monday at 11.', confirmToken: token }, SCHEDULE_KEY);
    expect(changed).toMatchObject({ ok: false, error: 'confirm_invalid' });

    const otherMinistry = await schedule({ ...actor, tenantId: 'tenant-b' }, { ...body, confirmToken: token }, SCHEDULE_KEY);
    expect(otherMinistry).toMatchObject({ ok: false, error: 'confirm_invalid' });

    const otherPerson = await schedule({ ...actor, uid: 'admin-2' }, { ...body, confirmToken: token }, SCHEDULE_KEY);
    expect(otherPerson).toMatchObject({ ok: false, error: 'confirm_invalid' });

    expect(new MockSocialClient('tenant-a', new Date()).load().posts).toHaveLength(before);
    expect(new MockSocialClient('tenant-b', new Date()).load().posts.filter((post) => post.content === body.content)).toHaveLength(0);

    const saved = await schedule(actor, { ...body, confirmToken: token }, SCHEDULE_KEY);
    expect(saved.ok).toBe(true);
    const reused = await schedule(actor, { ...body, confirmToken: token }, SCHEDULE_KEY);
    expect(reused).toMatchObject({ ok: false, error: 'confirm_invalid' });
    expect(new MockSocialClient('tenant-a', new Date()).load().posts).toHaveLength(before + 1);
  });

  it('refuses an expired confirm token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2024, 5, 1, 12)));
    try {
      const body = postBody('instagram', { scheduledFor: new Date(Date.UTC(2024, 5, 8, 12)).toISOString() });
      const preview = await schedule(actor, body, null);
      vi.setSystemTime(new Date(Date.UTC(2024, 5, 1, 12, 11)));
      const expired = await schedule(actor, { ...body, confirmToken: tokenOf(preview) }, SCHEDULE_KEY);
      expect(expired).toMatchObject({ ok: false, error: 'confirm_invalid' });
      const copies = new MockSocialClient('tenant-a', new Date()).load().posts.filter((post) => post.content === 'Sunday at 10.');
      expect(copies).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not return a raw credential error when admin reads throw', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT', JSON.stringify({ client_email: 'a@b.c', private_key: 'pem' }));
    h.get.mockRejectedValue(new Error(ADC));
    const result = await list(actor);
    expect(result).toMatchObject({ ok: false, status: 503, error: 'social_unavailable' });
    expect(JSON.stringify(result)).not.toContain('default credentials');
    expect(JSON.stringify(result)).not.toContain('cloud.google.com');
  });
});
