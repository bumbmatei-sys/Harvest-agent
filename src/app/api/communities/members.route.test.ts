import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const snap = (path: string) => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => docs.get(path) });
  const children = (path: string) => [...docs.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).sort();
  const docRef = (path: string): any => ({ path, id: path.split('/').pop(), collection: (name: string) => colRef(`${path}/${name}`), get: async () => snap(path) });
  const colRef = (path: string): any => ({
    path, doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) => ({
      limit: (n: number) => ({ get: async () => ({ docs: children(path).filter(k => docs.get(k)?.[field] === value).slice(0, n).map(snap) }) }),
    }),
  });
  return {
    docs, auth: vi.fn(), admin: vi.fn(),
    db: { collection: (name: string) => colRef(name), getAll: async (...refs: any[]) => refs.map(ref => snap(ref.path)) },
  };
});
vi.mock('@/lib/firebase-admin', () => ({ adminDb: h.db }));
vi.mock('@/lib/api-auth', () => ({ requireAuth: h.auth, requireTenantAdmin: h.admin }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));
const limit = vi.hoisted(() => ({ value: 500 }));
vi.mock('@/lib/community/members', async original => ({ ...(await original<typeof import('@/lib/community/members')>()), get MEMBER_LIST_LIMIT() { return limit.value; } }));
import { GET } from './[communityId]/members/route';

const C = 'tenants/grace/communities/youth';
const list = (id = 'youth', tenant = 'grace') => GET(new NextRequest(`http://localhost/api/communities/${id}/members?tenantId=${tenant}`), { params: { communityId: id } });
const at = (ms: number) => ({ toMillis: () => ms });

beforeEach(() => {
  h.docs.clear(); limit.value = 500;
  h.auth.mockResolvedValue({ uid: 'u1' });
  h.admin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
  h.docs.set(C, { name: 'Youth', status: 'published' });
  h.docs.set(`${C}/members/u1`, { status: 'active', joinedAt: at(2000) });
  h.docs.set(`${C}/members/u2`, { status: 'active', joinedAt: at(1000) });
  h.docs.set(`${C}/members/gone`, { status: 'left', joinedAt: at(500) });
  h.docs.set('users/u1', { displayName: 'Ana', email: 'ana@test.com', photoURL: 'https://cdn.test/a.png' });
  h.docs.set('users/u2', { displayName: 'ben@test.com', email: 'ben@test.com' });
});

describe('a community member list', () => {
  it('shows active members, oldest first, with names and photos only', async () => {
    const response = await list();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ truncated: false, members: [
      { uid: 'u2', name: 'Member', photoURL: '', joinedAt: 1000 },
      { uid: 'u1', name: 'Ana', photoURL: 'https://cdn.test/a.png', joinedAt: 2000 },
    ] });
    expect(JSON.stringify(body)).not.toContain('@');
  });

  it('is for members and the ministry admins only', async () => {
    h.auth.mockResolvedValue({ uid: 'outsider' });
    const refused = await list();
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toBe('Join this community to see its members.');
    h.docs.set(`${C}/members/outsider`, { status: 'left' });
    expect((await list()).status).toBe(403);
    h.admin.mockResolvedValue({ uid: 'outsider' });
    expect((await list()).status).toBe(200);
    expect(h.admin).toHaveBeenCalledWith(expect.anything(), 'grace');
  });

  it('needs an account, a real community and well-formed ids', async () => {
    h.auth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    expect((await list()).status).toBe(401);
    h.auth.mockResolvedValue({ uid: 'u1' });
    expect((await list('missing')).status).toBe(404);
    expect((await list('default')).status).toBe(400);
    expect((await list('Bad Id')).status).toBe(400);
    expect((await list('youth', 'a/b')).status).toBe(400);
  });

  it('says when the list is cut at the limit', async () => {
    limit.value = 2;
    expect((await (await list()).json()).truncated).toBe(true);
  });
});
