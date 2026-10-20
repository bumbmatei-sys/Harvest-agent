import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  constructed: vi.fn(),
  ensureProfile: vi.fn(),
  load: vi.fn(),
  connectUrl: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  reserveZernioProfile: vi.fn(),
  commitZernioProfile: vi.fn(),
  releaseZernioProfileClaim: vi.fn(),
}));

vi.mock('../live-client', () => ({
  LiveSocialClient: class {
    constructor() {
      h.constructed();
    }

    ensureProfile = h.ensureProfile;

    load = h.load;

    connectUrl = h.connectUrl;

    create = h.create;

    update = h.update;

    cancel = h.cancel;
  },
}));

vi.mock('../profile-lock', () => ({
  reserveZernioProfile: h.reserveZernioProfile,
  commitZernioProfile: h.commitZernioProfile,
  releaseZernioProfileClaim: h.releaseZernioProfileClaim,
}));

vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: vi.fn(),
  tenantPrivateRef: () => ({ set: vi.fn() }),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: () => ({ doc: () => ({}) }), runTransaction: vi.fn() },
}));

import { resetSocialMock } from '../mock-client';
import { SOCIAL_SAMPLE_SCOPE } from '../mode';
import { resetPublishOnce } from '../publish-once';
import {
  cancelSocialPost,
  connectSocialAccount,
  createSocialPost,
  loadSocialWorkspace,
  updateSocialPost,
} from '../session';
import { resetWorkspaceCache } from '../workspace-cache';
import type { SocialPost, SocialPostDraft, SocialWorkspace } from '../types';

const clock = new Date(Date.UTC(2024, 2, 15, 12));
const envKeys = ['VERCEL_ENV', 'ZERNIO_API_KEY', 'ZERNIO_SOCIAL_LIVE', 'ZERNIO_SOCIAL_MODE'] as const;

function liveEnv(): void {
  process.env.VERCEL_ENV = 'production';
  process.env.ZERNIO_API_KEY = 'secret';
  process.env.ZERNIO_SOCIAL_LIVE = '1';
}

function liveWorkspace(profileId: string, posts: readonly SocialPost[] = []): SocialWorkspace {
  return {
    profileId,
    sample: false,
    timezone: 'UTC',
    accounts: [{ id: 'owned', platform: 'instagram', username: 'grace', displayName: 'Grace' }],
    posts,
  };
}

const scheduled: SocialPost = {
  id: 'post-1',
  content: 'Sunday at 10.',
  status: 'scheduled',
  scheduledFor: '2027-03-22T15:00:00.000Z',
  timezone: 'UTC',
  targets: [],
  media: [],
};

function draft(accountId: string, publishNow = false): SocialPostDraft {
  return {
    content: 'Sunday at 10.',
    scheduledFor: null,
    publishNow,
    timezone: 'UTC',
    media: [],
    idempotencyKey: publishNow ? '11111111-1111-4111-8111-111111111111' : null,
    targets: [{
      platform: 'instagram',
      accountId,
      text: 'Sunday at 10.',
      fields: {},
      madeWithAi: false,
    }],
  };
}

describe('loadSocialWorkspace mock boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSocialMock();
    resetPublishOnce();
    resetWorkspaceCache();
    for (const key of envKeys) delete process.env[key];
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('preview serves Sample Ministry and does not call Zernio', async () => {
    process.env.VERCEL_ENV = 'preview';
    vi.stubEnv('NODE_ENV', 'production');
    process.env.ZERNIO_API_KEY = 'secret';
    process.env.ZERNIO_SOCIAL_LIVE = '1';
    const workspace = await loadSocialWorkspace('tenant-a', clock);
    expect(workspace?.sample).toBe(true);
    expect(workspace?.accounts.every((account) => account.displayName === 'Sample Ministry')).toBe(true);
    expect(workspace?.posts.length).toBeGreaterThan(0);
    expect(h.constructed).not.toHaveBeenCalled();
    expect(h.ensureProfile).not.toHaveBeenCalled();
    expect(h.reserveZernioProfile).not.toHaveBeenCalled();
  });

  it('does not serve the sample scope through Zernio when production is live', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.ZERNIO_API_KEY = 'secret';
    process.env.ZERNIO_SOCIAL_LIVE = '1';
    const workspace = await loadSocialWorkspace(SOCIAL_SAMPLE_SCOPE, clock);
    expect(workspace).toBeNull();
    expect(h.constructed).not.toHaveBeenCalled();
    expect(h.reserveZernioProfile).not.toHaveBeenCalled();
  });

  it('refuses a mock-only request in production instead of publishing', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.ZERNIO_API_KEY = 'secret';
    process.env.ZERNIO_SOCIAL_LIVE = '1';
    const workspace = await loadSocialWorkspace('tenant-a', clock, true);
    expect(workspace).toBeNull();
    expect(h.constructed).not.toHaveBeenCalled();
  });

  it('still opens the live client for a real tenant when production is live', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.ZERNIO_API_KEY = 'secret';
    process.env.ZERNIO_SOCIAL_LIVE = '1';
    h.reserveZernioProfile.mockResolvedValue({
      status: 'create',
      claim: 'claim-1',
      profileName: '11111111-1111-4111-8111-111111111111',
    });
    h.ensureProfile.mockResolvedValue('profile-1');
    h.commitZernioProfile.mockResolvedValue('profile-1');
    h.load.mockResolvedValue({
      profileId: 'profile-1',
      sample: false,
      timezone: 'UTC',
      accounts: [],
      posts: [],
    });
    const workspace = await loadSocialWorkspace('grace-chapel', clock, false);
    expect(h.constructed).toHaveBeenCalled();
    expect(h.ensureProfile).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(h.ensureProfile.mock.calls[0][0]).not.toContain('grace-chapel');
    expect(workspace?.profileId).toBe('profile-1');
    expect(workspace?.sample).toBe(false);
  });

  it('reuses one live load for the same ministry, and does not reuse a failed one', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.ZERNIO_API_KEY = 'secret';
    process.env.ZERNIO_SOCIAL_LIVE = '1';
    const ready = {
      profileId: 'profile-1',
      sample: false,
      timezone: 'UTC',
      accounts: [],
      posts: [],
    };
    h.reserveZernioProfile.mockResolvedValue({ status: 'ready', profileId: 'profile-1' });
    let release: (value: typeof ready) => void = () => {};
    h.load.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const first = loadSocialWorkspace('grace-chapel', clock, false);
    const second = loadSocialWorkspace('grace-chapel', clock, false);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.load).toHaveBeenCalledTimes(1);
    release(ready);
    expect(await first).toEqual(ready);
    expect(await second).toEqual(ready);
    expect(h.reserveZernioProfile).toHaveBeenCalledTimes(1);
    await loadSocialWorkspace('grace-chapel', clock, false);
    expect(h.load).toHaveBeenCalledTimes(1);

    h.load.mockResolvedValue(null);
    resetWorkspaceCache();
    expect(await loadSocialWorkspace('grace-chapel', clock, false)).toBeNull();
    expect(await loadSocialWorkspace('grace-chapel', clock, false)).toBeNull();
    expect(h.load).toHaveBeenCalledTimes(3);
  });

  it('refuses a create whose account is not on this ministry, before the provider', async () => {
    const before = await loadSocialWorkspace('tenant-a', clock, true);
    const result = await createSocialPost('tenant-a', draft('other-church-account'), true);
    expect(result).toEqual({ ok: false, error: 'account_not_owned' });
    const after = await loadSocialWorkspace('tenant-a', clock, true);
    expect(after?.posts).toEqual(before?.posts);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('refuses an update whose account is not on this ministry, before the provider', async () => {
    const result = await updateSocialPost('tenant-a', 'sample-scheduled', draft('other-church-account'), true);
    expect(result).toEqual({ ok: false, error: 'account_not_owned' });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('accepts a create and an update that name this ministry\'s own account', async () => {
    const created = await createSocialPost('tenant-a', draft('sample-ig'), true);
    expect(created.ok).toBe(true);
    const updated = await updateSocialPost('tenant-a', 'sample-scheduled', draft('sample-ig'), true);
    expect(updated.ok).toBe(true);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('schedules once when the same idempotency key is sent twice', async () => {
    const body = {
      ...draft('sample-ig'),
      scheduledFor: '2027-03-22T15:00:00.000Z',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    };
    const [first, second] = await Promise.all([
      createSocialPost('tenant-a', body, true),
      createSocialPost('tenant-a', body, true),
    ]);
    expect(first.ok && second.ok && first.post.id === second.post.id).toBe(true);
    expect(first.ok && first.post.status).toBe('scheduled');
    const workspace = await loadSocialWorkspace('tenant-a', clock, true);
    const copies = workspace?.posts.filter((post) => post.id === (first.ok ? first.post.id : '')) ?? [];
    expect(copies).toHaveLength(1);
  });

  it('posts now once when the same idempotency key is sent twice', async () => {
    const body = draft('sample-ig', true);
    const [first, second] = await Promise.all([
      createSocialPost('tenant-a', body, true),
      createSocialPost('tenant-a', body, true),
    ]);
    expect(first.ok && second.ok && first.post.id === second.post.id).toBe(true);
    const workspace = await loadSocialWorkspace('tenant-a', clock, true);
    const copies = workspace?.posts.filter((post) => post.content === body.content) ?? [];
    expect(copies).toHaveLength(1);
  });

  it('does not call the live create for an account this profile does not own', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.ZERNIO_API_KEY = 'secret';
    process.env.ZERNIO_SOCIAL_LIVE = '1';
    h.reserveZernioProfile.mockResolvedValue({ status: 'ready', profileId: 'profile-1' });
    h.load.mockResolvedValue({
      profileId: 'profile-1',
      sample: false,
      timezone: 'UTC',
      accounts: [{ id: 'owned', platform: 'instagram', username: 'grace', displayName: 'Grace' }],
      posts: [{ id: 'post-1', content: 'Hi', status: 'scheduled', scheduledFor: null, timezone: 'UTC', targets: [], media: [] }],
    });
    const created = await createSocialPost('grace-chapel', draft('someone-else'), false);
    const updated = await updateSocialPost('grace-chapel', 'post-1', draft('someone-else'), false);
    expect(created).toEqual({ ok: false, error: 'account_not_owned' });
    expect(updated).toEqual({ ok: false, error: 'account_not_owned' });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('loads a different workspace for each ministry', async () => {
    liveEnv();
    h.reserveZernioProfile.mockImplementation(async (tenantId: string) => ({
      status: 'ready',
      profileId: tenantId === 'tenant-a' ? 'profile-a' : 'profile-b',
    }));
    h.load.mockImplementation(async (profileId: string) => liveWorkspace(profileId));
    const first = await loadSocialWorkspace('tenant-a', clock, false);
    const second = await loadSocialWorkspace('tenant-b', clock, false);
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(first?.profileId).toBe('profile-a');
    expect(second?.profileId).toBe('profile-b');
  });

  it('reads the provider again after a mock connect', async () => {
    liveEnv();
    h.reserveZernioProfile.mockResolvedValue({ status: 'ready', profileId: 'profile-1' });
    h.load.mockResolvedValue(liveWorkspace('profile-1'));
    await loadSocialWorkspace('grace-chapel', clock, false);
    delete process.env.VERCEL_ENV;
    delete process.env.ZERNIO_API_KEY;
    delete process.env.ZERNIO_SOCIAL_LIVE;
    vi.stubEnv('NODE_ENV', 'test');
    expect(await connectSocialAccount('grace-chapel', 'instagram', false)).toEqual({
      ok: true,
      authUrl: null,
      sample: true,
    });
    liveEnv();
    await loadSocialWorkspace('grace-chapel', clock, false);
    expect(h.load).toHaveBeenCalledTimes(2);
  });

  it('reads the provider again after a live connect', async () => {
    liveEnv();
    h.reserveZernioProfile.mockResolvedValue({ status: 'ready', profileId: 'profile-1' });
    h.load.mockResolvedValue(liveWorkspace('profile-1'));
    h.connectUrl.mockResolvedValue('https://connect.example/start');
    await loadSocialWorkspace('grace-chapel', clock, false);
    expect(await connectSocialAccount('grace-chapel', 'instagram', false)).toEqual({
      ok: true,
      authUrl: 'https://connect.example/start',
      sample: false,
    });
    await loadSocialWorkspace('grace-chapel', clock, false);
    expect(h.load).toHaveBeenCalledTimes(2);
  });

  it('reads the provider again after a create', async () => {
    liveEnv();
    h.reserveZernioProfile.mockResolvedValue({ status: 'ready', profileId: 'profile-1' });
    h.load.mockResolvedValue(liveWorkspace('profile-1'));
    h.create.mockResolvedValue({ ...scheduled, id: 'post-new' });
    await loadSocialWorkspace('grace-chapel', clock, false);
    expect((await createSocialPost('grace-chapel', draft('owned'), false)).ok).toBe(true);
    await loadSocialWorkspace('grace-chapel', clock, false);
    expect(h.load).toHaveBeenCalledTimes(2);
  });

  it('reads the provider again after an update', async () => {
    liveEnv();
    h.reserveZernioProfile.mockResolvedValue({ status: 'ready', profileId: 'profile-1' });
    h.load.mockResolvedValue(liveWorkspace('profile-1', [scheduled]));
    h.update.mockResolvedValue({ ...scheduled, content: 'Edited.' });
    await loadSocialWorkspace('grace-chapel', clock, false);
    expect((await updateSocialPost('grace-chapel', 'post-1', draft('owned'), false)).ok).toBe(true);
    await loadSocialWorkspace('grace-chapel', clock, false);
    expect(h.load).toHaveBeenCalledTimes(2);
  });

  it('reads the provider again after a cancel', async () => {
    liveEnv();
    h.reserveZernioProfile.mockResolvedValue({ status: 'ready', profileId: 'profile-1' });
    h.load.mockResolvedValue(liveWorkspace('profile-1', [scheduled]));
    h.cancel.mockResolvedValue(true);
    await loadSocialWorkspace('grace-chapel', clock, false);
    expect(await cancelSocialPost('grace-chapel', 'post-1', false)).toBe(true);
    await loadSocialWorkspace('grace-chapel', clock, false);
    expect(h.load).toHaveBeenCalledTimes(2);
  });
});
