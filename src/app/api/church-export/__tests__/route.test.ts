import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * THE-228 — the export routes.
 *
 * requireAuth is mocked. The church-export gate is the real one, so a
 * manageCRM admin and a caller from another tenant are refused here, not
 * only in the unit test of the helper. The runner, the signer and the
 * delete are mocked so a refusal can be seen as "those were not called".
 */

interface User {
  uid: string;
  email?: string;
  tenantId: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  authTime: number;
}

const state = vi.hoisted(() => ({
  user: null as User | NextResponse | null,
  tenants: {} as Record<string, { ownerId?: string } | undefined>,
  users: {} as Record<string, { role?: string; permissions?: Record<string, boolean> } | undefined>,
  roster: {} as Record<string, string[]>,
  tenantGets: 0,
}));

const mockRun = vi.hoisted(() => vi.fn());
const mockLatest = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
const mockSign = vi.hoisted(() => vi.fn());
const mockConsume = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({ requireAuth: async () => state.user }));
vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: async (tenantId: string) => ({ adminEmails: state.roster[tenantId] ?? [] }),
}));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (name === 'tenants') {
            state.tenantGets += 1;
            const data = state.tenants[id];
            return { exists: data !== undefined, data: () => data };
          }
          const data = state.users[id];
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  },
}));
vi.mock('@/lib/church-export-run', () => ({
  runChurchExport: (...args: unknown[]) => mockRun(...args),
  latestChurchExport: (...args: unknown[]) => mockLatest(...args),
  getChurchExport: (...args: unknown[]) => mockGet(...args),
  signChurchExportUrl: (...args: unknown[]) => mockSign(...args),
  consumeChurchExport: (...args: unknown[]) => mockConsume(...args),
}));

const start = await import('../route');
const urlRoute = await import('../url/route');
const complete = await import('../complete/route');

function user(partial: Partial<User> & Pick<User, 'uid'>): User {
  return {
    email: 'admin@example.com',
    tenantId: 'tenant-a',
    isAdmin: true,
    isSuperAdmin: false,
    authTime: 1_700_000_000,
    ...partial,
  };
}

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.user = user({ uid: 'full-1' });
  state.tenants = { 'tenant-a': { ownerId: 'owner-1' }, 'tenant-b': { ownerId: 'owner-b' } };
  state.users = { 'full-1': { role: 'admin', permissions: { fullAccess: true } } };
  state.roster = {};
  state.tenantGets = 0;
  mockRun.mockReset().mockResolvedValue({
    exportId: 'exp-1',
    status: 'ready',
    files: ['members.csv', 'contacts.csv', 'giving.csv', 'events.csv'],
  });
  mockLatest.mockReset().mockResolvedValue(null);
  mockGet.mockReset().mockResolvedValue(null);
  mockSign.mockReset().mockResolvedValue('https://signed.example/church-export');
  mockConsume.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/church-export', () => {
  it('lets a tenant admin start an export of their own church', async () => {
    const res = await start.POST(post('/api/church-export', { tenantId: 'tenant-a' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      exportId: 'exp-1',
      status: 'ready',
      files: ['members.csv', 'contacts.csv', 'giving.csv', 'events.csv'],
    });
    expect(body.objectKey).toBeUndefined();
    expect(mockRun).toHaveBeenCalledWith('tenant-a', 'full-1');
  });

  it('refuses manageCRM-only, another tenant, and a signed-out caller without starting an export', async () => {
    state.user = user({ uid: 'crm-1', isAdmin: true });
    state.users['crm-1'] = { role: 'admin', permissions: { manageCRM: true } };
    const crm = await start.POST(post('/api/church-export', { tenantId: 'tenant-a' }));
    expect(crm.status).toBe(403);
    expect(await crm.json()).toEqual({ error: 'Tenant admin access required' });

    state.user = user({ uid: 'full-1', tenantId: 'tenant-a' });
    state.tenantGets = 0;
    const other = await start.POST(post('/api/church-export', { tenantId: 'tenant-b' }));
    expect(other.status).toBe(403);
    expect(state.tenantGets).toBe(0);

    state.user = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const anon = await start.POST(post('/api/church-export', { tenantId: 'tenant-a' }));
    expect(anon.status).toBe(401);

    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe('GET /api/church-export', () => {
  it('returns status without the object key', async () => {
    mockLatest.mockResolvedValue({
      id: 'exp-1',
      status: 'ready',
      createdAtMs: 1_700_000_000_000,
      objectKey: 'church-exports/tenant-a/exp-1.zip',
      error: undefined,
    });
    const res = await start.GET(new NextRequest('http://localhost/api/church-export?tenantId=tenant-a'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.export).toEqual({
      id: 'exp-1',
      status: 'ready',
      createdAtMs: 1_700_000_000_000,
      error: null,
    });
    expect(JSON.stringify(body)).not.toContain('objectKey');
    expect(JSON.stringify(body)).not.toContain('church-exports');
  });

  it('refuses a manageCRM admin', async () => {
    state.user = user({ uid: 'crm-1' });
    state.users['crm-1'] = { role: 'admin', permissions: { manageCRM: true } };
    const res = await start.GET(new NextRequest('http://localhost/api/church-export'));
    expect(res.status).toBe(403);
    expect(mockLatest).not.toHaveBeenCalled();
  });
});

describe('POST /api/church-export/url', () => {
  const ready = {
    id: 'exp-1',
    status: 'ready',
    createdAtMs: 1_700_000_000_000,
    objectKey: 'church-exports/tenant-a/exp-1.zip',
  };

  it('mints a 15-minute url for the stored key, not a key from the body', async () => {
    mockGet.mockResolvedValue(ready);
    const res = await urlRoute.POST(post('/api/church-export/url', {
      exportId: 'exp-1',
      tenantId: 'tenant-a',
      objectKey: 'church-exports/tenant-b/exp-1.zip',
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: 'https://signed.example/church-export',
      expiresInSeconds: 900,
    });
    expect(mockSign).toHaveBeenCalledWith('church-exports/tenant-a/exp-1.zip');
    expect(mockGet).toHaveBeenCalledWith('tenant-a', 'exp-1');
  });

  it('refuses manageCRM, another tenant, and a key that points at a different church', async () => {
    state.user = user({ uid: 'crm-1' });
    state.users['crm-1'] = { role: 'admin', permissions: { manageCRM: true } };
    const crm = await urlRoute.POST(post('/api/church-export/url', { exportId: 'exp-1', tenantId: 'tenant-a' }));
    expect(crm.status).toBe(403);

    state.user = user({ uid: 'full-1', tenantId: 'tenant-a' });
    const other = await urlRoute.POST(post('/api/church-export/url', { exportId: 'exp-1', tenantId: 'tenant-b' }));
    expect(other.status).toBe(403);

    mockGet.mockResolvedValue({ ...ready, objectKey: 'church-exports/tenant-b/exp-1.zip' });
    const foreign = await urlRoute.POST(post('/api/church-export/url', { exportId: 'exp-1' }));
    expect(foreign.status).toBe(500);

    expect(mockSign).not.toHaveBeenCalled();
  });
});

describe('POST /api/church-export/complete', () => {
  const ready = {
    id: 'exp-1',
    status: 'ready',
    createdAtMs: 1_700_000_000_000,
    objectKey: 'church-exports/tenant-a/exp-1.zip',
  };

  it('deletes after a successful download and does not delete twice once consumed', async () => {
    mockGet.mockResolvedValue(ready);
    const res = await complete.POST(post('/api/church-export/complete', { exportId: 'exp-1', tenantId: 'tenant-a' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(mockConsume).toHaveBeenCalledWith('tenant-a', ready);

    mockConsume.mockClear();
    mockGet.mockClear();
    mockGet.mockResolvedValue({ ...ready, status: 'consumed' });
    const again = await complete.POST(post('/api/church-export/complete', { exportId: 'exp-1' }));
    expect(again.status).toBe(200);
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('refuses manageCRM and another tenant without deleting', async () => {
    mockGet.mockClear();
    mockConsume.mockClear();
    state.user = user({ uid: 'crm-1' });
    state.users['crm-1'] = { role: 'admin', permissions: { manageCRM: true } };
    const crm = await complete.POST(post('/api/church-export/complete', { exportId: 'exp-1' }));
    expect(crm.status).toBe(403);

    state.user = user({ uid: 'full-1', tenantId: 'tenant-b' });
    state.users['full-1'] = { role: 'admin', permissions: { fullAccess: true } };
    const other = await complete.POST(post('/api/church-export/complete', { exportId: 'exp-1', tenantId: 'tenant-a' }));
    expect(other.status).toBe(403);

    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
