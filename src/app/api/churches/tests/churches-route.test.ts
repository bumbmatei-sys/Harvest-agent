import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  mockVerifyIdToken,
  mockAdd,
  mockCollectionGet,
} from '@/test/mocks/firebase-admin';

const { GET, POST } = await import('@/app/api/churches/route');

function makeRequest(method: string, token?: string, body?: unknown): Request {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body) headers.set('content-type', 'application/json');
  return new Request('https://example.com/api/churches', {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCollectionGet.mockResolvedValue({ docs: [], empty: true, forEach: vi.fn() });
  mockAdd.mockResolvedValue({ id: 'church-123' });
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /api/churches', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when authenticated user has no tenantId and is not super admin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'x@x.com', superAdmin: false });
    const res = await GET(makeRequest('GET', 'tok'));
    expect(res.status).toBe(400);
  });

  it('scopes results to the user\'s tenantId — does not leak other tenants\' churches', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1', email: 'x@x.com', tenantId: 'tenant-a', admin: true, superAdmin: false,
    });
    const fakeDoc = { id: 'c1', data: () => ({ name: 'Grace Church', tenantId: 'tenant-a' }) };
    mockCollectionGet.mockResolvedValue({ docs: [fakeDoc], empty: false, forEach: vi.fn() });

    const res = await GET(makeRequest('GET', 'tok'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.churches).toHaveLength(1);
    expect(json.churches[0].tenantId).toBe('tenant-a');
  });

  it('returns all churches for super admins (no tenant filter)', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'super', email: 'admin@x.com', superAdmin: true });
    const docs = [
      { id: 'c1', data: () => ({ tenantId: 'tenant-a' }) },
      { id: 'c2', data: () => ({ tenantId: 'tenant-b' }) },
    ];
    mockCollectionGet.mockResolvedValue({ docs, empty: false, forEach: vi.fn() });

    const res = await GET(makeRequest('GET', 'tok'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.churches).toHaveLength(2);
  });
});

// ─── POST ────────────────────────────────────────────────────────────────────

describe('POST /api/churches', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await POST(makeRequest('POST', undefined, { name: 'Test' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 for authenticated non-admin users', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1', email: 'x@x.com', tenantId: 'tenant-a', admin: false, superAdmin: false,
    });
    const res = await POST(makeRequest('POST', 'tok', { name: 'Test Church' }));
    expect(res.status).toBe(403);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('allows tenant admins to create a church', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'admin1', email: 'admin@x.com', tenantId: 'tenant-a', admin: true, superAdmin: false,
    });
    const res = await POST(makeRequest('POST', 'tok', { name: 'New Church', tenantId: 'tenant-a' }));
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    const savedData = mockAdd.mock.calls[0][0];
    expect(savedData.name).toBe('New Church');
    expect(savedData.createdBy).toBe('admin1');
  });

  it('strips disallowed fields from the payload', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'admin1', email: 'admin@x.com', tenantId: 'tenant-a', admin: true, superAdmin: false,
    });
    const res = await POST(makeRequest('POST', 'tok', {
      name: 'New Church',
      role: 'superAdmin',       // should be stripped
      __proto__: 'exploit',     // should be stripped
      tenantId: 'tenant-a',
    }));
    expect(res.status).toBe(200);
    const savedData = mockAdd.mock.calls[0][0];
    expect(savedData).not.toHaveProperty('role');
    expect(savedData).not.toHaveProperty('__proto__');
  });
});

// ─── Known gaps (documented) ──────────────────────────────────────────────────

describe('Known security gaps (tracked)', () => {
  it.todo(
    'KNOWN: stripeCustomerId, stripeSubscriptionId, addOnAiAssistantCode are on the public ' +
    'tenant doc (allow read: if true). Fix requires moving these to tenants/{id}/private/billing ' +
    'subcollection and updating all read/write sites. See comment in firestore.rules lines 193-205.'
  );

  it.todo(
    'KNOWN: DELETE /api/tenants/delete uses recursiveDelete for tenant subcollections (settings/, members/) ' +
    'but does NOT delete top-level collection documents that reference the tenantId ' +
    '(courses, blog_posts, community_posts, rag_sources, rag_chunks, ai_assistant_bindings). ' +
    'These are orphaned on tenant deletion. Needs a batched cross-collection cleanup added to the route.'
  );
});
