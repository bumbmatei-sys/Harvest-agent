import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const session = vi.hoisted(() => ({
  createSocialPost: vi.fn(),
  updateSocialPost: vi.fn(),
  cancelSocialPost: vi.fn(),
  connectSocialAccount: vi.fn(),
  loadSocialWorkspace: vi.fn(),
}));

const access = vi.hoisted(() => ({
  requireSocialAccess: vi.fn(),
}));

vi.mock('@/lib/social/session', () => session);
vi.mock('@/lib/social/access', () => access);

import { POST as connectPost } from '../connect/route';
import { POST as createPost } from '../posts/route';
import { PATCH, DELETE } from '../posts/[id]/route';

const entitled = { tenantId: 'tenant-a', entitled: true, sample: true, mockOnly: true };

function request(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function target(platform: string, publishNow = false) {
  const scheduledFor = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    content: 'Sunday at 10.',
    publishNow,
    scheduledFor: publishNow ? null : scheduledFor,
    targets: [{ platform, accountId: 'acct-1', text: 'Sunday at 10.', madeWithAi: true }],
  };
}

const publishKey = { 'idempotency-key': '11111111-1111-4111-8111-111111111111' };

describe('social routes reject anything outside the allow-list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.requireSocialAccess.mockResolvedValue(entitled);
    session.createSocialPost.mockResolvedValue({ ok: true, post: { id: 'p1', status: 'scheduled' } });
    session.updateSocialPost.mockResolvedValue({ ok: true, post: { id: 'p1', status: 'scheduled' } });
    session.connectSocialAccount.mockResolvedValue({ ok: true, authUrl: null, sample: true });
  });

  it.each(['twitter', 'x', 'X', 'Twitter', 'discord', 'slack'])(
    'connect, schedule, publish and edit refuse %s and do not call the provider',
    async (platform) => {
      const connect = await connectPost(request('POST', 'http://localhost/api/social/connect', { platform }));
      expect(connect.status).toBe(400);
      expect(await connect.json()).toEqual({ error: 'platform_not_offered' });

      const scheduled = await createPost(request('POST', 'http://localhost/api/social/posts', target(platform, false)));
      expect(scheduled.status).toBe(400);
      expect(await scheduled.json()).toEqual({ error: 'platform_not_offered' });

      const published = await createPost(request('POST', 'http://localhost/api/social/posts', target(platform, true), publishKey));
      expect(published.status).toBe(400);

      const edited = await PATCH(
        request('PATCH', 'http://localhost/api/social/posts/p1', target(platform, false)),
        { params: { id: 'p1' } },
      );
      expect(edited.status).toBe(400);

      expect(session.connectSocialAccount).not.toHaveBeenCalled();
      expect(session.createSocialPost).not.toHaveBeenCalled();
      expect(session.updateSocialPost).not.toHaveBeenCalled();
    },
  );

  it('schedules an offered platform for the token tenant and stores the AI flag as off', async () => {
    const response = await createPost(request('POST', 'http://localhost/api/social/posts', target('Instagram', false)));
    expect(response.status).toBe(200);
    expect(session.createSocialPost).toHaveBeenCalledTimes(1);
    const [tenantId, draft] = session.createSocialPost.mock.calls[0];
    expect(tenantId).toBe('tenant-a');
    expect(draft.targets[0].platform).toBe('instagram');
    expect(draft.targets[0].madeWithAi).toBe(false);
    expect(draft.publishNow).toBe(false);
  });

  it('publish now is the same allow-list and requires an idempotency key from the header', async () => {
    const missing = await createPost(request('POST', 'http://localhost/api/social/posts', target('instagram', true)));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'idempotency_key_required' });
    expect(session.createSocialPost).not.toHaveBeenCalled();

    const response = await createPost(request(
      'POST',
      'http://localhost/api/social/posts',
      { ...target('instagram', true), idempotencyKey: 'from-the-body' },
      publishKey,
    ));
    expect(response.status).toBe(200);
    expect(session.createSocialPost.mock.calls[0][1].publishNow).toBe(true);
    expect(session.createSocialPost.mock.calls[0][1].idempotencyKey).toBe(publishKey['idempotency-key']);
  });

  it('returns the access response unchanged when the ministry is not entitled', async () => {
    const denied = NextResponse.json({ error: 'social_scheduler_not_entitled' }, { status: 403 });
    access.requireSocialAccess.mockResolvedValue(denied);
    const response = await createPost(request('POST', 'http://localhost/api/social/posts', target('instagram', true)));
    expect(response.status).toBe(403);
    expect(session.createSocialPost).not.toHaveBeenCalled();
  });

  it('cancel stays on the tenant the access check named', async () => {
    session.cancelSocialPost.mockResolvedValue(true);
    const response = await DELETE(
      request('DELETE', 'http://localhost/api/social/posts/p1'),
      { params: { id: 'post-9' } },
    );
    expect(response.status).toBe(200);
    expect(session.cancelSocialPost).toHaveBeenCalledWith('tenant-a', 'post-9', true);
  });
});
