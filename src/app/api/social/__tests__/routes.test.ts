import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

const service = vi.hoisted(() => ({
  actorFromRequest: vi.fn(),
  submitPost: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  connectAccount: vi.fn(),
  list: vi.fn(),
  socialResponse: (result: { ok: boolean; status: number; error?: string; data?: unknown }) => (
    NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.status })
  ),
}));

vi.mock('@/lib/social/service', () => service);

import { POST as connectPost } from '../connect/route';
import { GET as bootstrap } from '../bootstrap/route';
import { POST as createPost } from '../posts/route';
import { PATCH, DELETE } from '../posts/[id]/route';

const actor = {
  uid: 'admin-1',
  email: 'owner@church.test',
  tenantId: 'tenant-a',
  isSuperAdmin: false,
  requestedTenantId: null,
};

function request(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe('social routes delegate to the service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.actorFromRequest.mockResolvedValue(actor);
    service.submitPost.mockResolvedValue({ ok: true, status: 200, data: { post: { id: 'p1' } } });
    service.update.mockResolvedValue({ ok: true, status: 200, data: { post: { id: 'p1' } } });
    service.cancel.mockResolvedValue({ ok: true, status: 200, data: { cancelled: true } });
    service.connectAccount.mockResolvedValue({ ok: true, status: 200, data: { platform: 'instagram', authUrl: null, sample: true } });
    service.list.mockResolvedValue({ ok: true, status: 200, data: { accounts: [], posts: [] } });
  });

  it('passes the verified actor, the body and the idempotency header through', async () => {
    const body = { content: 'Sunday', confirm: true };
    const response = await createPost(request(
      'POST',
      'http://localhost/api/social/posts',
      body,
      { 'idempotency-key': '11111111-1111-4111-8111-111111111111' },
    ));
    expect(response.status).toBe(200);
    expect(service.submitPost).toHaveBeenCalledWith(actor, body, '11111111-1111-4111-8111-111111111111');
  });

  it('returns the auth response and does not call the service when the token is refused', async () => {
    service.actorFromRequest.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const response = await createPost(request('POST', 'http://localhost/api/social/posts', { content: 'x' }));
    expect(response.status).toBe(401);
    expect(service.submitPost).not.toHaveBeenCalled();
  });

  it('lists, updates, cancels and connects through the same actor', async () => {
    await bootstrap(request('GET', 'http://localhost/api/social/bootstrap'));
    expect(service.list).toHaveBeenCalledWith(actor, null);
    await bootstrap(request('GET', 'http://localhost/api/social/bootstrap', undefined, {
      'x-social-timezone': 'America/Denver',
    }));
    expect(service.list).toHaveBeenLastCalledWith(actor, 'America/Denver');

    await PATCH(
      request('PATCH', 'http://localhost/api/social/posts/post-9', { content: 'edited', confirm: true }),
      { params: { id: 'post-9' } },
    );
    expect(service.update).toHaveBeenCalledWith(actor, 'post-9', { content: 'edited', confirm: true }, null);

    await DELETE(
      request('DELETE', 'http://localhost/api/social/posts/post-9', { confirm: true }),
      { params: { id: 'post-9' } },
    );
    expect(service.cancel).toHaveBeenCalledWith(actor, 'post-9', { confirm: true });

    await connectPost(request('POST', 'http://localhost/api/social/connect', { platform: 'threads' }));
    expect(service.connectAccount).toHaveBeenCalledWith(actor, { platform: 'threads' });
  });

  it('keeps allow-list and ownership checks out of the route files', () => {
    const dir = path.join(__dirname, '..');
    for (const rel of ['posts/route.ts', 'posts/[id]/route.ts', 'connect/route.ts', 'bootstrap/route.ts']) {
      const text = readFileSync(path.join(dir, rel), 'utf8');
      expect(text).not.toContain('parseSocialDraft');
      expect(text).not.toContain('createSocialPost');
      expect(text).not.toContain('platform_not_offered');
    }
  });
});
