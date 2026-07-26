import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireAdmin, docStore, setCalls } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  docStore: new Map<string, Record<string, unknown> | null>(),
  setCalls: [] as Array<{ path: string; data: Record<string, unknown>; options: unknown }>,
}));

function makeRef(path: string): any {
  return {
    path,
    get: async () => {
      const data = docStore.get(path);
      return { exists: data != null, data: () => data ?? undefined };
    },
    set: async (data: Record<string, unknown>, options: unknown) => {
      setCalls.push({ path, data, options });
    },
    collection: (name: string) => makeCollection(`${path}/${name}`),
  };
}
function makeCollection(path: string) {
  return { doc: (id: string) => makeRef(`${path}/${id}`) };
}

vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => makeCollection(name) },
}));

const { POST } = await import('../address/route');

function makeReq(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/composio/gmail/address', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockUser(overrides: object = {}) {
  return { uid: 'admin-a', email: 'a@church.org', tenantId: 'bumb', isAdmin: true, isSuperAdmin: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  docStore.clear();
  setCalls.length = 0;
  docStore.set('tenants/bumb/integrations/admin-a_gmail', {
    status: 'active', connectedAccountId: 'ca_admin_a',
  });
});

describe('POST /api/composio/gmail/address', () => {
  it('updates the sending address on the caller\'s own connection', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    const res = await POST(makeReq({ senderEmail: 'Personal@Gmail.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ senderEmail: 'personal@gmail.com' });
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].path).toBe('tenants/bumb/integrations/admin-a_gmail');
    expect(setCalls[0].data).toMatchObject({ senderEmail: 'personal@gmail.com' });
    // merge, or the update would wipe connectedAccountId and unlink the account.
    expect(setCalls[0].options).toEqual({ merge: true });
  });

  it('back-fills a connection made before an address was ever recorded', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    docStore.set('tenants/bumb/integrations/admin-a_gmail', {
      status: 'active', connectedAccountId: 'ca_admin_a', // no senderEmail
    });

    const res = await POST(makeReq({ senderEmail: 'pastor@church.org' }));
    expect(res.status).toBe(200);
    expect(setCalls[0].data).toMatchObject({ senderEmail: 'pastor@church.org' });
  });

  it('rejects a malformed address without writing', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    for (const bad of ['', 'nope', 'a@church.org\nBcc: evil@attacker.test', 'a@b.org,c@d.org']) {
      const res = await POST(makeReq({ senderEmail: bad }));
      expect(res.status, `${bad} must be refused`).toBe(400);
    }
    expect(setCalls).toHaveLength(0);
  });

  it('returns 404 when this admin has no Gmail connection', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ uid: 'admin-b' }));
    const res = await POST(makeReq({ senderEmail: 'b@church.org' }));
    expect(res.status).toBe(404);
    expect(setCalls).toHaveLength(0);
  });

  // ── One admin cannot set another admin's sending address ──────────────────
  it('writes only to the caller\'s own {uid}_gmail doc, ignoring body-supplied ids', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ uid: 'admin-b' }));
    docStore.set('tenants/bumb/integrations/admin-b_gmail', {
      status: 'active', connectedAccountId: 'ca_admin_b',
    });

    await POST(makeReq({ senderEmail: 'b@church.org', uid: 'admin-a', tenantId: 'victim' }));

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].path).toBe('tenants/bumb/integrations/admin-b_gmail');
  });

  it('returns 401 when unauthenticated and writes nothing', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(makeReq({ senderEmail: 'a@church.org' }));
    expect(res.status).toBe(401);
    expect(setCalls).toHaveLength(0);
  });

  it('returns 400 for an admin with no tenant', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ tenantId: null }));
    const res = await POST(makeReq({ senderEmail: 'a@church.org' }));
    expect(res.status).toBe(400);
    expect(setCalls).toHaveLength(0);
  });
});
