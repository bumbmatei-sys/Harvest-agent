import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ uid: '', admin: false, permissions: {} as Record<string, boolean>, writes: [] as string[] }));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: async () => ({ adminEmails: [] }) }));
vi.mock('@/lib/firebase-admin', () => {
  const doc = (collection: string, id: string): any => ({
    id, path: `${collection}/${id}`,
    get: async () => ({ exists: collection !== 'signup_handles', data: () => collection === 'tenants' ? { ownerId: 'owner', plan: 'free' } : { tenantId: 'tenant', permissions: state.permissions } }),
  });
  return { adminAuth: { verifyIdToken: async () => ({ uid: state.uid, tenantId: 'tenant', admin: state.admin }) }, adminDb: {
    collection: (name: string) => ({ doc: (id = 'new') => doc(name, id) }),
    runTransaction: async (fn: any) => fn({ get: (ref: any) => ref.get(), create: (ref: any) => state.writes.push(ref.path) }),
  } };
});
import { POST } from '../route';

const input = { handle: 'fresh', title: 'Title', message: '', fields: Object.fromEntries(['name', 'email', 'phone', 'prayerRequest'].map(key => [key, { enabled: key === 'name', required: key === 'name' }])) };
const request = () => new NextRequest('http://localhost/api/signup-pages', { method: 'POST', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify(input) });

beforeEach(() => { state.uid = 'member'; state.admin = false; state.permissions = {}; state.writes = []; });
describe('create signup page authorization', () => {
  it('denies a plain member without writing', async () => {
    expect((await POST(request())).status).toBe(403);
    expect(state.writes).toEqual([]);
  });
  it('allows an admin with manageForms', async () => {
    state.uid = 'admin'; state.admin = true; state.permissions = { manageForms: true };
    expect((await POST(request())).status).toBe(201);
    expect(state.writes).toEqual(['signup_handles/fresh', 'signup_pages/new']);
  });
  it('allows the Free tenant owner', async () => {
    state.uid = 'owner';
    expect((await POST(request())).status).toBe(201);
    expect(state.writes).toEqual(['signup_handles/fresh', 'signup_pages/new']);
  });
});
