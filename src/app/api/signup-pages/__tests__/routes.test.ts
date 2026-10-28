import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), requireTenantPermission: vi.fn(), collection: vi.fn(), transaction: vi.fn(), checkRateLimit: vi.fn(), rateLimiters: { auth: {} as object | null } }));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mocks.requireAuth, requireTenantPermission: mocks.requireTenantPermission }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: mocks.collection, runTransaction: mocks.transaction } }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit, rateLimiters: mocks.rateLimiters }));
import { GET as list, POST as create, PATCH as update } from '../route';
import { POST as submit } from '../submit/route';
import { GET as publicPage } from '../public/[handle]/route';
import { GET as submissions } from '../[pageId]/submissions/route';
import { GET as exportCsv } from '../[pageId]/export/route';

const fields = Object.fromEntries(['name', 'email', 'phone', 'prayerRequest'].map((key) => [key, { enabled: key === 'name', required: key === 'name' }]));
const stored = Object.entries(fields).map(([key, settings]) => ({ key, ...settings }));
const page = { tenantId: 'tenant', ownerUid: 'owner', handle: 'hello', title: 'Hello', message: '', fields: stored, active: true };
const request = (method: string, body?: unknown) => new NextRequest('http://localhost/api/signup-pages', { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });
const params = { params: { pageId: 'page' } };
let documents: Record<string, Record<string, unknown>>;
let writes: string[];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimiters.auth = {};
  mocks.requireAuth.mockResolvedValue({ uid: 'owner', tenantId: 'tenant' });
  mocks.requireTenantPermission.mockResolvedValue(NextResponse.json({ error: 'Denied' }, { status: 403 }));
  mocks.checkRateLimit.mockResolvedValue(null);
  documents = { 'signup_pages/page': page, 'signup_handles/hello': { pageId: 'page' } };
  writes = [];
  const ref = (path: string): any => ({ id: path.split('/').pop(), path, get: async () => ({ exists: !!documents[path], data: () => documents[path] }), collection: (name: string) => collection(`${path}/${name}`) });
  const collection = (path: string): any => ({ doc: (id = 'new') => ref(`${path}/${id}`), where: () => ({ get: async () => ({ docs: [{ id: 'page', data: () => page }] }) }), orderBy: () => ({ get: async () => ({ docs: [{ id: 'one', data: () => ({ createdAt: '2040', answers: { name: '=1, "x"' } }) }] }) }) });
  mocks.collection.mockImplementation(collection);
  mocks.transaction.mockImplementation(async (fn) => fn({ get: (r: any) => r.get(), create: (r: any) => writes.push(`create:${r.path}`), update: (r: any) => writes.push(`update:${r.path}`), delete: (r: any) => writes.push(`delete:${r.path}`) }));
});

describe('signup page routes', () => {
  it('lists only the caller’s pages and propagates auth failures', async () => {
    expect((await (await list(request('GET'))).json()).pages).toHaveLength(1);
    mocks.requireAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await list(request('GET'))).status).toBe(401);
  });
  it('requires forms permission for a tenant-wide list', async () => {
    const req = new NextRequest('http://localhost/api/signup-pages?tenantId=tenant');
    expect((await list(req)).status).toBe(403);
    mocks.requireTenantPermission.mockResolvedValueOnce({ uid: 'admin', tenantId: 'tenant' });
    expect((await list(req)).status).toBe(200);
    expect(mocks.requireTenantPermission).toHaveBeenCalledWith(req, 'tenant', 'manageForms');
  });
  it('reserves a unique handle with the page atomically', async () => {
    const input = { handle: 'fresh', title: 'Title', message: '', fields };
    expect((await create(request('POST', input))).status).toBe(201);
    expect(writes).toEqual(['create:signup_handles/fresh', 'create:signup_pages/new']);
    expect((await create(request('POST', { ...input, handle: 'hello' }))).status).toBe(409);
    expect((await create(request('POST', { ...input, handle: 'BAD' }))).status).toBe(400);
  });
  it('updates and moves a reservation atomically, refusing conflicts', async () => {
    const input = { pageId: 'page', active: false, handle: 'fresh', title: 'Title', message: '', fields };
    expect((await update(request('PATCH', input))).status).toBe(200);
    expect(writes).toEqual(['create:signup_handles/fresh', 'delete:signup_handles/hello', 'update:signup_pages/page']);
    documents['signup_handles/fresh'] = { pageId: 'other' };
    expect((await update(request('PATCH', input))).status).toBe(409);
  });
  it('exposes only public enabled fields and hides inactive pages', async () => {
    const response = await publicPage(request('GET'), { params: { handle: 'hello' } });
    expect(await response.json()).toEqual({ title: 'Hello', message: '', fields: [stored[0]] });
    documents['signup_pages/page'] = { ...page, active: false };
    expect((await publicPage(request('GET'), { params: { handle: 'hello' } })).status).toBe(404);
  });
  it('rate limits, validates and stores submissions; traps honeypots', async () => {
    expect((await submit(request('POST', { handle: 'hello', website: '', answers: { name: 'A' } }))).status).toBe(201);
    expect(writes).toContain('create:signup_pages/page/submissions/new');
    writes = [];
    expect((await submit(request('POST', { handle: 'hello', website: 'spam', answers: {} }))).status).toBe(200);
    expect(writes).toEqual([]);
    expect((await submit(request('POST', { handle: 'hello', website: '', answers: { email: 'x' } }))).status).toBe(400);
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await submit(request('POST', {}))).status).toBe(429);
    mocks.rateLimiters.auth = null;
    expect((await submit(request('POST', {}))).status).toBe(503);
  });
  it('restricts submissions and exports and escapes spreadsheet formulas', async () => {
    expect((await submissions(request('GET'), params)).status).toBe(200);
    const csv = await exportCsv(request('GET'), params);
    expect(await csv.text()).toContain('"\'=1, ""x"""');
    mocks.requireAuth.mockResolvedValue({ uid: 'other', tenantId: 'tenant' });
    expect((await submissions(request('GET'), params)).status).toBe(403);
    expect((await exportCsv(request('GET'), params)).status).toBe(403);
  });
});
