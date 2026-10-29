import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SUPER_ADMIN_EMAILS } from '@/utils/super-admins';
const fx = vi.hoisted(() => ({ user: { uid: 'member', tenantId: 'tenant' }, docs: {} as Record<string, Record<string, unknown> | undefined>, failPath: null as string | null }));
vi.mock('@/lib/api-auth', () => ({ requireCommunityMember: async () => fx.user }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: (name: string) => ref(name) } }));
function ref(path: string): any { return { doc: (id: string) => ref(`${path}/${id}`), collection: (id: string) => ref(`${path}/${id}`), get: async () => { if (fx.failPath === path) throw new Error('read failed'); return { exists: !!fx.docs[path], data: () => fx.docs[path] }; } }; }
import { GET } from './route';
const request = (id: string) => new NextRequest(`http://localhost/api/community/dm-counterpart?tenantId=tenant&dmId=${id}`);
beforeEach(() => { fx.failPath = null; fx.docs = { 'tenants/tenant/directMessages/thread': { participants: ['member', 'other'] }, 'users/other': { tenantId: 'tenant', role: 'admin' }, 'tenants/tenant': {}, 'tenant_private/tenant': {} }; });
describe('DM counterpart status', () => {
  it('returns only the admin status for a participant', async () => {
    const response = await GET(request('thread'));
    expect(await response.json()).toEqual({ isAdmin: true });
    fx.docs['users/other'] = { tenantId: 'tenant', role: 'church_admin' };
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: true });
  });
  it('does not trust thread role labels, public rosters, or a foreign tenant role', async () => {
    fx.docs['users/other'] = { tenantId: 'tenant', role: 'user', email: 'member@example.com' };
    fx.docs['tenants/tenant/directMessages/thread']!.participantRoles = { other: 'admin' };
    fx.docs['tenants/tenant'] = { adminEmails: ['member@example.com'] };
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: false });
    fx.docs['users/other'] = { tenantId: 'foreign', role: 'admin' };
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: false });
  });
  it.each(['tenant', 'foreign'])('rejects stale roster/platform profile emails with stored tenant %s', async (tenantId) => {
    fx.docs['tenants/tenant'] = { ownerId: 'real-owner', adminEmails: ['owner@example.com'] };
    fx.docs['tenant_private/tenant'] = { adminEmails: ['owner@example.com', 'roster@example.com'] };
    for (const email of ['owner@example.com', 'roster@example.com', ...SUPER_ADMIN_EMAILS]) {
      fx.docs['users/other'] = { tenantId, role: 'user', email };
      fx.docs['tenants/tenant/directMessages/thread']!.participantRoles = { other: 'admin' };
      expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: false });
    }
  });
  it('recognises the protected platform role independently of email and tenant', async () => {
    fx.docs['users/other'] = { role: 'super_admin', tenantId: null };
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: true });
  });
  it('recognises ownership independently of the user profile', async () => {
    fx.docs['tenants/tenant'] = { ownerId: 'other' };
    fx.docs['users/other'] = { role: 'user' };
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: true });
    delete fx.docs['users/other'];
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: true });
  });
  it('does not depend on the email roster for UID-based counterpart checks', async () => {
    fx.failPath = 'tenant_private/tenant';
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: true });
  });
  it.each(['users/other', 'tenants/tenant'])('surfaces a failed %s read', async (path) => {
    fx.failPath = path;
    const response = await GET(request('thread'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Could not check conversation' });
  });
  it('does not expose another thread or turn failed identity reads into a member classification', async () => {
    fx.docs['tenants/tenant/directMessages/thread'] = { participants: ['other', 'third'] };
    expect((await GET(request('thread'))).status).toBe(404);
    fx.docs['tenants/tenant/directMessages/thread'] = { participants: ['member', 'other'] };
    delete fx.docs['users/other'];
    expect((await GET(request('thread'))).status).toBe(503);
  });
});
