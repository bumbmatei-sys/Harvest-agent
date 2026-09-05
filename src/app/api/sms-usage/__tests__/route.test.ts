import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireAuth, mockGetSmsUsageSnapshot, mockGetSource } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetSmsUsageSnapshot: vi.fn(),
  mockGetSource: vi.fn(),
}));

// ── THE-245 ────────────────────────────────────────────────────────────────
// This suite pins what SMS DOES, so it runs with the master switch ON. That is
// the hide-not-delete guarantee expressed as a test: every rule below — the
// US-only gate, the cap, the reserve/settle/refund order, the smsLogs write —
// still holds, unchanged, the moment SMS_FEATURE_ENABLED goes back to true.
// The OFF behaviour is covered in the-245-sms-hidden.test.ts.
vi.mock('@/lib/sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/sms-usage', () => ({ getSmsUsageSnapshot: mockGetSmsUsageSnapshot }));
// THE-314 — the credential source now comes from the new send funnel; the
// Twilio module is retired in place and imported by nothing.
vi.mock('@/lib/sms-send', () => ({ getSmsCredentialSource: mockGetSource }));

const { GET } = await import('../route');

function makeReq(): NextRequest {
  return new NextRequest('https://example.com/api/sms-usage', {
    headers: { authorization: 'Bearer token' },
  });
}
function mockUser(overrides: object = {}) {
  return { uid: 'u1', email: 'a@b.c', tenantId: 'tenant1', isAdmin: true, isSuperAdmin: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default to the platform account so the pre-existing meter cases below still
  // describe a tenant a cap actually applies to.
  mockGetSource.mockResolvedValue('platform');
});

describe('GET /api/sms-usage', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns { metered: false } for a super admin (never touches usage docs)', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null, isSuperAdmin: true }));
    const res = await GET(makeReq());
    expect((await res.json()).metered).toBe(false);
    expect(mockGetSmsUsageSnapshot).not.toHaveBeenCalled();
  });

  it('returns { metered: false } for a null-tenant user', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null }));
    const res = await GET(makeReq());
    expect((await res.json()).metered).toBe(false);
    expect(mockGetSmsUsageSnapshot).not.toHaveBeenCalled();
  });

  it("returns the caller's OWN tenant snapshot, resolved from the token", async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockGetSmsUsageSnapshot.mockResolvedValue({
      plan: 'ultra', month: '2026-07', smsSegmentsUsed: 1_234, smsSegmentsByoUsed: 0, smsSegmentsCap: 4_000,
    });

    const body = await (await GET(makeReq())).json();

    expect(body).toMatchObject({
      metered: true, plan: 'ultra', smsSegmentsUsed: 1_234, smsSegmentsCap: 4_000,
    });
    // The tenant comes from the verified token — never from the request.
    expect(mockGetSmsUsageSnapshot).toHaveBeenCalledWith('tenant1');
  });

  it('reports an unmetered tier (null cap) as not metered rather than a 0-limit meter', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockGetSmsUsageSnapshot.mockResolvedValue({
      plan: 'plus', month: '2026-07', smsSegmentsUsed: 5, smsSegmentsByoUsed: 0, smsSegmentsCap: null,
    });
    expect((await (await GET(makeReq())).json()).metered).toBe(false);
  });

  // ── BYO: their own volume, and NO limit they aren't subject to ─────────────
  it('reports a BYO tenant as UNMETERED with their own volume and a null cap', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockGetSource.mockResolvedValue('byo');
    mockGetSmsUsageSnapshot.mockResolvedValue({
      plan: 'plus', month: '2026-07', smsSegmentsUsed: 0, smsSegmentsByoUsed: 812, smsSegmentsCap: 250,
    });

    const body = await (await GET(makeReq())).json();

    // 812 is way past the plus allotment of 250 — and still uncapped, because
    // Twilio bills the church for it directly.
    expect(body).toEqual({
      metered: false, source: 'byo', plan: 'plus', month: '2026-07',
      smsSegmentsUsed: 812, smsSegmentsCap: null,
    });
  });

  it('reports a tenant with no Twilio at all as source: null — nothing to show', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockGetSource.mockResolvedValue(null);
    mockGetSmsUsageSnapshot.mockResolvedValue({
      plan: 'plus', month: '2026-07', smsSegmentsUsed: 0, smsSegmentsByoUsed: 0, smsSegmentsCap: 250,
    });

    const body = await (await GET(makeReq())).json();

    expect(body.metered).toBe(false);
    expect(body.source).toBeNull();
  });

  it('returns 500 (not a bogus 0 usage) when the snapshot read fails', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockGetSmsUsageSnapshot.mockRejectedValue(new Error('firestore down'));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
  });
});
