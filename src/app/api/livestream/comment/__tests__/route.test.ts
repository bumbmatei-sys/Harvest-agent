import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockRequireAuth } = vi.hoisted(() => ({ mockRequireAuth: vi.fn() }));

const { mockDocGet, mockDocSet, mockAdd } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockAdd: vi.fn().mockResolvedValue({ id: 'c1' }),
}));

// Recursive doc/collection mock so tenants/{t}/livestream/current and
// tenants/{t}/livestreamSessions/{s}/comments both resolve.
function makeCollRef(): any {
  return { doc: vi.fn(() => makeDocRef()), add: mockAdd, get: vi.fn() };
}
function makeDocRef(): any {
  return { get: mockDocGet, set: mockDocSet, collection: vi.fn(() => makeCollRef()) };
}

vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn(() => makeCollRef()) } }));
// Identity comes from the verified token via requireAuth — never the body.
vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
}));

const { POST } = await import('../route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://grace.theharvest.app/api/livestream/comment', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'grace.theharvest.app' },
    body: JSON.stringify(body),
  });
}

const ACTIVE = { active: true, sessionId: 's1' };
const baseBody = { tenantId: 't1', name: 'Sam', text: 'Amen 🙏' };

beforeEach(() => {
  vi.clearAllMocks();
  mockDocSet.mockResolvedValue(undefined);
  mockAdd.mockResolvedValue({ id: 'c1' });
  // Default: authenticated viewer.
  mockRequireAuth.mockResolvedValue({ uid: 'user_1', email: 'sam@test.com', tenantId: 't1' });
});

describe('POST /api/livestream/comment', () => {
  it('rejects an unauthenticated request (requireAuth 401), writing nothing', async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(401);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockDocGet).not.toHaveBeenCalled();
  });

  it('rejects with 410 when no stream is active', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ active: false, sessionId: 's1' }) });

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(410);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rejects with 410 when the active stream has no sessionId', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ active: true }) });

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(410);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rejects an empty / whitespace-only comment with 400 (before touching Firestore)', async () => {
    const res = await POST(makeRequest({ ...baseBody, text: '   ' }));
    expect(res.status).toBe(400);
    expect(mockDocGet).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rejects a missing tenantId with 400', async () => {
    const res = await POST(makeRequest({ name: 'Sam', text: 'hi' }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rejects an oversized comment (> 500 chars) with 400', async () => {
    const res = await POST(makeRequest({ ...baseBody, text: 'x'.repeat(501) }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('writes the comment and increments commentCount on the session AND current on success', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ACTIVE });

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    // Comment written with the trimmed text, server timestamp, and the VERIFIED uid.
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Sam', text: 'Amen 🙏', authorId: 'user_1', createdAt: 'SERVER_TS' }),
    );

    // commentCount incremented on both the session doc and current (2 .set calls).
    expect(mockDocSet).toHaveBeenCalledTimes(2);
    expect(mockDocSet).toHaveBeenCalledWith({ commentCount: { __increment: 1 } }, { merge: true });
  });

  it('trims surrounding whitespace before writing', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ACTIVE });

    await POST(makeRequest({ ...baseBody, text: '  hello world  ' }));
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello world' }));
  });

  it('defaults a missing name to Anonymous', async () => {
    mockDocGet.mockResolvedValue({ exists: true, data: () => ACTIVE });

    await POST(makeRequest({ tenantId: 't1', text: 'hi' }));
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Anonymous', text: 'hi' }));
  });
});
