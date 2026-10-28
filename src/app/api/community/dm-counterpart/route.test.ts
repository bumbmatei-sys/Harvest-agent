import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SUPER_ADMIN_EMAILS } from '@/utils/super-admins';
const fx = vi.hoisted(() => ({ user: { uid: 'member', tenantId: 'tenant' }, docs: {} as Record<string, Record<string, unknown> | undefined>, failPath: null as string | null }));
vi.mock('@/lib/api-auth', () => ({ requireTenantMember: async () => fx.user }));
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
    fx.docs['tenant_private/tenant'] = { adminEmails: ['owner@example.com'] };
    fx.docs['users/other'] = { tenantId: 'tenant', role: 'user', email: 'owner@example.com' };
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
  it('recognises private roster membership even before the stored tenant matches', async () => {
    fx.docs['users/other'] = { tenantId: 'foreign', role: 'user', email: 'roster@example.com' };
    fx.docs['tenant_private/tenant'] = { adminEmails: ['roster@example.com'] };
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: true });
  });
  it.each([
    { role: 'super_admin', tenantId: null },
    ...SUPER_ADMIN_EMAILS.map(email => ({ role: 'user', tenantId: 'foreign', email })),
  ])('recognises the persisted platform admin shape %j', async (profile) => {
    fx.docs['users/other'] = profile;
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: true });
  });
  it('recognises ownership independently of the user profile', async () => {
    fx.docs['tenants/tenant'] = { ownerId: 'other' };
    fx.docs['users/other'] = { role: 'user' };
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: true });
    delete fx.docs['users/other'];
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: true });
  });
  it('treats a missing private roster as empty and excludes missing profile emails', async () => {
    fx.docs['users/other'] = { role: 'user', email: 'roster@example.com' };
    delete fx.docs['tenant_private/tenant'];
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: false });
    fx.docs['users/other'] = { role: 'user' };
    fx.docs['tenant_private/tenant'] = { adminEmails: [''] };
    expect(await (await GET(request('thread'))).json()).toEqual({ isAdmin: false });
  });
  it.each(['users/other', 'tenants/tenant', 'tenant_private/tenant'])('surfaces a failed %s read', async (path) => {
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
