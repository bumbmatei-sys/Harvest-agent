import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockRequireSuperAdmin } = vi.hoisted(() => ({ mockRequireSuperAdmin: vi.fn() }));
const { mockDocGet, mockBatchCreate, mockBatchSet, mockBatchUpdate, mockBatchCommit } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockBatchCreate: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockBatchCommit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    // Refs carry their collection + id so batch assertions can tell WHICH doc a
    // write targeted (the tenants doc vs its tenant_private dual-write mirror).
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id?: string) => ({ __coll: name, id, get: mockDocGet })),
    })),
    batch: vi.fn(() => ({
      create: mockBatchCreate,
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
  },
}));

vi.mock('@/lib/api-auth', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));

const { POST } = await import('../route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/tenants/save', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperAdmin.mockResolvedValue({
    uid: 'super1', email: 'platform@test.com', tenantId: null, isAdmin: true, isSuperAdmin: true,
  });
});

describe('POST /api/tenants/save — super-admin tenant create/update with dual-write', () => {
  it('rejects non-super-admin callers', async () => {
    mockRequireSuperAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Super admin access required' }, { status: 403 }),
    );
    const res = await POST(makeRequest({ name: 'X', subdomain: 'x' }));
    expect(res.status).toBe(403);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('creates public doc + tenant_private mirror in one batch, with identical roster', async () => {
    const res = await POST(makeRequest({
      name: 'Grace', subdomain: 'Grace-Church', plan: 'pro',
      adminEmails: ['pastor@grace.org'], config: { description: 'A church' },
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('grace-church');

    // Public doc created race-free (create(), not set()).
    expect(mockBatchCreate).toHaveBeenCalledWith(
      expect.objectContaining({ __coll: 'tenants', id: 'grace-church' }),
      expect.objectContaining({
        name: 'Grace', subdomain: 'grace-church', plan: 'pro', status: 'active',
        adminEmails: ['pastor@grace.org'],
      }),
    );
    // Dual-write parity: the mirror carries the identical roster, same batch.
    const publicCreate = mockBatchCreate.mock.calls[0];
    const privateSet = mockBatchSet.mock.calls.find((c) => c[0].__coll === 'tenant_private');
    expect(privateSet).toBeDefined();
    expect(privateSet![0].id).toBe('grace-church');
    expect(privateSet![1].adminEmails).toEqual(publicCreate[1].adminEmails);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('updates adminEmails on both locations in one batch', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ name: 'Grace' }) });

    const res = await POST(makeRequest({ id: 'grace-church', adminEmails: ['new@grace.org'] }));
    expect(res.status).toBe(200);

    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ __coll: 'tenants', id: 'grace-church' }),
      expect.objectContaining({ adminEmails: ['new@grace.org'] }),
    );
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ __coll: 'tenant_private', id: 'grace-church' }),
      expect.objectContaining({ adminEmails: ['new@grace.org'] }),
      { merge: true },
    );
  });

  it('skips the tenant_private write when no moved field is touched', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ name: 'Grace' }) });

    const res = await POST(makeRequest({ id: 'grace-church', name: 'Grace Renamed', status: 'suspended' }));
    expect(res.status).toBe(200);

    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ __coll: 'tenants', id: 'grace-church' }),
      expect.objectContaining({ name: 'Grace Renamed', status: 'suspended' }),
    );
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('returns 409 when the subdomain is already taken (ALREADY_EXISTS)', async () => {
    mockBatchCommit.mockRejectedValue(Object.assign(new Error('already exists'), { code: 6 }));
    const res = await POST(makeRequest({
      name: 'Other', subdomain: 'grace-church', plan: 'plus', adminEmails: ['x@y.z'],
    }));
    expect(res.status).toBe(409);
  });

  it('404s an update for a missing tenant', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    const res = await POST(makeRequest({ id: 'ghost', name: 'X' }));
    expect(res.status).toBe(404);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});
