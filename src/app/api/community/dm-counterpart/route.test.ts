import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const fx = vi.hoisted(() => ({ user: { uid: 'member', tenantId: 'tenant' }, docs: {} as Record<string, Record<string, unknown> | undefined> }));
vi.mock('@/lib/api-auth', () => ({ requireTenantMember: async () => fx.user }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: (name: string) => ref(name) } }));
function ref(path: string): any { return { doc: (id: string) => ref(`${path}/${id}`), collection: (id: string) => ref(`${path}/${id}`), get: async () => ({ exists: !!fx.docs[path], data: () => fx.docs[path] }) }; }
import { GET } from './route';
const request = (id: string) => new NextRequest(`http://localhost/api/community/dm-counterpart?tenantId=tenant&dmId=${id}`);
beforeEach(() => { fx.docs = { 'tenants/tenant/directMessages/thread': { participants: ['member', 'other'] }, 'users/other': { tenantId: 'tenant', role: 'admin' }, 'tenants/tenant': {}, 'tenant_private/tenant': {} }; });
describe('DM counterpart status', () => {
  it('returns only the admin status for a participant', async () => {
    const response = await GET(request('thread'));
    expect(await response.json()).toEqual({ isAdmin: true });
    fx.docs['users/other'] = { tenantId: 'tenant', role: 'user' };
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: false });
  });
  it('does not expose another thread or turn failed identity reads into a member classification', async () => {
    fx.docs['tenants/tenant/directMessages/thread'] = { participants: ['other', 'third'] };
    expect((await GET(request('thread'))).status).toBe(404);
    fx.docs['tenants/tenant/directMessages/thread'] = { participants: ['member', 'other'] };
    delete fx.docs['users/other'];
    expect((await GET(request('thread'))).status).toBe(503);
  });
});
