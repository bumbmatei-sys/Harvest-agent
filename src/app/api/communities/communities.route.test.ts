import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { defaultCommunitySettings } from '@/lib/community/settings';
import { newCommunityDraft } from '@/lib/community/communities';

/** A tiny in-memory Firestore: documents by path, collections by prefix. */
const h = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const docRef = (path: string): any => ({
    path, id: path.split('/').pop(),
    collection: (name: string) => colRef(`${path}/${name}`),
    get: async () => snap(path),
  });
  const snap = (path: string) => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => docs.get(path) });
  const children = (path: string) => [...docs.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).sort();
  const colRef = (path: string): any => {
    const query = { isQuery: true, path, get: async () => ({ docs: children(path).map(snap) }) };
    return { path, doc: (id: string) => docRef(`${path}/${id}`), select: () => query, orderBy: () => query };
  };
  const tx = {
    get: async (ref: any) => (ref.isQuery ? ref.get() : snap(ref.path)),
    set: (ref: any, data: Record<string, unknown>, opts?: { merge?: boolean }) => { docs.set(ref.path, opts?.merge ? { ...(docs.get(ref.path) ?? {}), ...data } : data); },
    create: (ref: any, data: Record<string, unknown>) => { if (docs.has(ref.path)) throw new Error('exists'); docs.set(ref.path, data); },
    update: (ref: any, data: Record<string, unknown>) => { docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data }); },
    delete: (ref: any) => { docs.delete(ref.path); },
  };
  return {
    docs, admin: vi.fn(), permission: vi.fn(),
    db: { collection: (name: string) => colRef(name), runTransaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
  };
});
vi.mock('@/lib/firebase-admin', () => ({ adminDb: h.db }));
vi.mock('@/lib/api-auth', () => ({ requireTenantAdmin: h.admin, requireTenantPermission: h.permission }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts' } }));
import { GET, POST } from './route';
import { DELETE, PATCH } from './[communityId]/route';

const T = 'tenants/grace';
const get = () => GET(new NextRequest('http://localhost/api/communities?tenantId=grace'));
const create = (name: string) => POST(new NextRequest('http://localhost/api/communities', { method: 'POST', body: JSON.stringify({ tenantId: 'grace', name }) }));
const patch = (id: string, body: Record<string, unknown>) => PATCH(new NextRequest(`http://localhost/api/communities/${id}`, { method: 'PATCH', body: JSON.stringify({ tenantId: 'grace', ...body }) }), { params: { communityId: id } });
const remove = (id: string) => DELETE(new NextRequest(`http://localhost/api/communities/${id}?tenantId=grace`, { method: 'DELETE' }), { params: { communityId: id } });

beforeEach(() => {
  h.docs.clear();
  h.admin.mockResolvedValue({ uid: 'admin', tenantId: 'grace', isSuperAdmin: false });
  h.permission.mockResolvedValue({ uid: 'admin' });
  h.docs.set(T, { name: 'Grace Chapel', plan: 'ministry' });
  h.docs.set(`${T}/settings/community`, { ...defaultCommunitySettings(), isPublic: true, shortDescription: 'Welcome' });
  h.docs.set('discovery_listings/grace', { tenantId: 'grace' });
});

describe('communities API', () => {
  it('requires manageCommunity and writes nothing without it', async () => {
    h.permission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await create('Youth')).status).toBe(403);
    expect(h.permission).toHaveBeenCalledWith(expect.anything(), 'grace', 'manageCommunity');
    expect([...h.docs.keys()].some(k => k.includes('/communities/'))).toBe(false);
  });

  it('lists the default community first, drawn from the existing setup', async () => {
    const body = await (await get()).json();
    expect(body.communities).toHaveLength(1);
    expect(body.communities[0]).toMatchObject({ id: 'default', name: 'Grace Chapel', tagline: 'Welcome', isDefault: true, visibility: 'public' });
    expect(body.limit).toBe(-1);
  });

  it('creates a private free draft with a unique id, then lists it after the default', async () => {
    expect(await (await create('Youth Group')).json()).toEqual({ id: 'youth-group' });
    expect(await (await create('Youth Group')).json()).toEqual({ id: 'youth-group-2' });
    const stored = h.docs.get(`${T}/communities/youth-group`)!;
    expect(stored).toMatchObject({ name: 'Youth Group', status: 'draft', visibility: 'private', pricing: { type: 'free' }, createdBy: 'admin' });
    const ids = (await (await get()).json()).communities.map((c: { id: string }) => c.id);
    expect(ids).toEqual(['default', 'youth-group', 'youth-group-2']);
  });

  it('holds the plan limit, counting the default community while it is open', async () => {
    h.docs.set(T, { name: 'Grace Chapel', plan: 'church' });
    const refused = await create('Youth');
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toContain('includes 1 community');
    // Deleting the default frees the one place.
    expect((await remove('default')).status).toBe(200);
    expect((await create('Youth')).status).toBe(200);
    // And the default cannot then come back past the limit.
    expect((await patch('default', { restore: true })).status).toBe(403);
  });

  it('refuses a free plan any community', async () => {
    h.docs.set(T, { name: 'Grace Chapel', plan: 'free' });
    h.docs.set(`${T}/settings/community`, { ...defaultCommunitySettings(), closed: true });
    const refused = await create('Youth');
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toContain('does not include communities');
  });

  it('saves an edit, but will not publish a second community yet', async () => {
    await create('Youth');
    const community = { ...newCommunityDraft('Youth'), tagline: 'Ages 13 to 18', visibility: 'public' };
    expect((await patch('youth', { community })).status).toBe(200);
    expect(h.docs.get(`${T}/communities/youth`)).toMatchObject({ tagline: 'Ages 13 to 18', status: 'draft', visibility: 'public' });
    const publish = await patch('youth', { community, status: 'published' });
    expect(publish.status).toBe(409);
    expect(h.docs.get(`${T}/communities/youth`)!.status).toBe('draft');
    expect((await patch('youth', { community: { ...community, name: '' } })).status).toBe(400);
    expect((await patch('missing', { community })).status).toBe(404);
  });

  it('refuses paid pricing while paid communities are coming soon', async () => {
    await create('Youth');
    const paid = { ...newCommunityDraft('Youth'), pricing: { type: 'paid', amountCents: 500, currency: 'usd', interval: 'month' } };
    const refused = await patch('youth', { community: paid });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain('coming soon');
    expect(h.docs.get(`${T}/communities/youth`)!.pricing).toEqual({ type: 'free' });
  });

  it('closes the default community on delete: off Discover, out of the list, data kept', async () => {
    h.docs.set(`${T}/communityMembers/m1`, { status: 'active' });
    expect((await remove('default')).status).toBe(200);
    expect(h.docs.get(`${T}/settings/community`)).toMatchObject({ closed: true, isPublic: false, shortDescription: 'Welcome' });
    expect(h.docs.has('discovery_listings/grace')).toBe(false);
    expect(h.docs.has(`${T}/communityMembers/m1`)).toBe(true);
    const body = await (await get()).json();
    expect(body).toMatchObject({ communities: [], defaultClosed: true });
    // Reopened private, so it is not relisted until the admin publishes it again.
    expect((await patch('default', { restore: true })).status).toBe(200);
    expect(h.docs.get(`${T}/settings/community`)).toMatchObject({ closed: false, isPublic: false });
    expect((await (await get()).json()).communities[0].id).toBe('default');
  });

  it('deletes another community outright, and will not edit the default here', async () => {
    await create('Youth');
    expect((await remove('youth')).status).toBe(200);
    expect(h.docs.has(`${T}/communities/youth`)).toBe(false);
    expect((await remove('youth')).status).toBe(404);
    expect((await patch('default', { community: newCommunityDraft('X') })).status).toBe(400);
  });

  it('rejects malformed ids and tenants', async () => {
    expect((await GET(new NextRequest('http://localhost/api/communities?tenantId=a/b'))).status).toBe(400);
    expect((await patch('Bad Id', { community: newCommunityDraft('X') })).status).toBe(400);
  });
});
