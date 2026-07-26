import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockRequireSuperAdmin, mockGetUsageSnapshot, mockGetSmsUsageSnapshot,
  mockGetSmsCredentialSource, mockGetPlatformTwilioConfig, mockCollection,
} = vi.hoisted(() => ({
  mockRequireSuperAdmin: vi.fn(),
  mockGetUsageSnapshot: vi.fn(),
  mockGetSmsUsageSnapshot: vi.fn(),
  mockGetSmsCredentialSource: vi.fn(),
  mockGetPlatformTwilioConfig: vi.fn(),
  mockCollection: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/rag-usage', () => ({ getUsageSnapshot: mockGetUsageSnapshot }));
vi.mock('@/lib/sms-usage', () => ({ getSmsUsageSnapshot: mockGetSmsUsageSnapshot }));
vi.mock('@/lib/twilio', () => ({ getSmsCredentialSource: mockGetSmsCredentialSource }));
vi.mock('@/lib/twilio-platform', () => ({ getPlatformTwilioConfig: mockGetPlatformTwilioConfig }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: mockCollection } }));

const { GET } = await import('../route');

function makeReq(tenantId = 'tenant1'): NextRequest {
  const qs = tenantId ? `?tenantId=${tenantId}` : '';
  return new NextRequest(`https://example.com/api/admin/tenant-usage${qs}`, {
    headers: { authorization: 'Bearer token' },
  });
}

/** tenants/{id}.get() plus rag_sources / rag_chunks count() aggregations. */
function wireDb(opts: { tenantExists?: boolean; sources?: number; chunks?: number } = {}) {
  const { tenantExists = true, sources = 0, chunks = 0 } = opts;
  mockCollection.mockImplementation((name: string) => {
    if (name === 'tenants') {
      return { doc: () => ({ get: async () => ({ exists: tenantExists, data: () => ({ name: 'First Church' }) }) }) };
    }
    const count = name === 'rag_sources' ? sources : chunks;
    return {
      where: () => ({
        limit: () => ({ count: () => ({ get: async () => ({ data: () => ({ count }) }) }) }),
      }),
    };
  });
}

const BASE_RAG = {
  plan: 'pro', month: '2026-07',
  queryTokensUsed: 1_000, queryTokensCap: 10_000_000,
  ingestTokensUsed: 2_000, ingestTokensCeiling: 2_000_000,
};
const BASE_SMS = {
  plan: 'pro', month: '2026-07',
  smsSegmentsUsed: 0, smsSegmentsByoUsed: 0, smsSegmentsCap: 500,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUsageSnapshot.mockResolvedValue(BASE_RAG);
  mockGetSmsUsageSnapshot.mockResolvedValue(BASE_SMS);
  mockGetSmsCredentialSource.mockResolvedValue('byo');
  // Today there is no platform Twilio account (THE-32) — this is the real state.
  mockGetPlatformTwilioConfig.mockReturnValue(null);
  wireDb();
});

describe('GET /api/admin/tenant-usage — the gate', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireSuperAdmin.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('403s a plain tenant admin and leaks NO data', async () => {
    // requireSuperAdmin is what rejects here; requireAdmin would have let this
    // exact user through, which is the whole reason this route does not use it.
    mockRequireSuperAdmin.mockResolvedValue(
      NextResponseLike({ error: 'Super admin access required' }, 403),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Super admin access required' });
    expect(body.rag).toBeUndefined();
    expect(body.sms).toBeUndefined();
    expect(mockGetUsageSnapshot).not.toHaveBeenCalled();
    expect(mockGetSmsUsageSnapshot).not.toHaveBeenCalled();
    expect(mockCollection).not.toHaveBeenCalled();
  });
});

function NextResponseLike(body: object, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('GET /api/admin/tenant-usage — payload', () => {
  beforeEach(() => {
    mockRequireSuperAdmin.mockResolvedValue({
      uid: 'sa', email: 'owner@harvest', tenantId: null, isAdmin: true, isSuperAdmin: true,
    });
  });

  it('requires a tenantId', async () => {
    const res = await GET(makeReq(''));
    expect(res.status).toBe(400);
  });

  it('404s an unknown tenant', async () => {
    wireDb({ tenantExists: false });
    const res = await GET(makeReq('nope'));
    expect(res.status).toBe(404);
  });

  it('returns RAG caps, knowledge-base counts and BOTH SMS counters', async () => {
    mockGetSmsUsageSnapshot.mockResolvedValue({ ...BASE_SMS, smsSegmentsByoUsed: 42 });
    wireDb({ sources: 7, chunks: 913 });
    const res = await GET(makeReq('tenant1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rag).toEqual({
      queryTokensUsed: 1_000, queryTokensCap: 10_000_000,
      ingestTokensUsed: 2_000, ingestTokensCeiling: 2_000_000,
    });
    expect(body.knowledgeBase.sources).toBe(7);
    expect(body.knowledgeBase.chunks).toBe(913);
    // The two SMS numbers stay separate — no combined field exists to misread.
    expect(body.sms.platformSegments).toBe(0);
    expect(body.sms.byoSegments).toBe(42);
    expect(Object.keys(body.sms)).not.toContain('smsSegmentsTotal');
  });

  it('BYO tenant: byoSegments carries the volume, platform is 0 and flagged unavailable', async () => {
    mockGetSmsUsageSnapshot.mockResolvedValue({ ...BASE_SMS, smsSegmentsUsed: 0, smsSegmentsByoUsed: 128 });
    mockGetSmsCredentialSource.mockResolvedValue('byo');
    const res = await GET(makeReq('tenant1'));
    const body = await res.json();
    expect(body.sms.credentialSource).toBe('byo');
    expect(body.sms.byoSegments).toBe(128);
    expect(body.sms.platformSegments).toBe(0);
    // No platform Twilio account exists yet, so the UI must not draw a meter.
    expect(body.sms.platformAvailable).toBe(false);
  });

  it('tenant with no SMS credentials at all reports source null', async () => {
    mockGetSmsCredentialSource.mockResolvedValue(null);
    const res = await GET(makeReq('tenant1'));
    expect((await res.json()).sms.credentialSource).toBeNull();
  });

  it('reports platformAvailable once Harvest has its own Twilio account', async () => {
    mockGetPlatformTwilioConfig.mockReturnValue({ accountSid: 'AC', authToken: 't', fromNumber: '+1' });
    const res = await GET(makeReq('tenant1'));
    expect((await res.json()).sms.platformAvailable).toBe(true);
  });

  it('a tenant with no usage docs renders zeros, not a crash', async () => {
    // Every snapshot reads a missing doc as 0; the count aggregations return 0.
    mockGetUsageSnapshot.mockResolvedValue({ ...BASE_RAG, queryTokensUsed: 0, ingestTokensUsed: 0 });
    mockGetSmsUsageSnapshot.mockResolvedValue({ ...BASE_SMS, smsSegmentsUsed: 0, smsSegmentsByoUsed: 0 });
    wireDb({ sources: 0, chunks: 0 });
    const res = await GET(makeReq('fresh'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rag.queryTokensUsed).toBe(0);
    expect(body.rag.ingestTokensUsed).toBe(0);
    expect(body.knowledgeBase.sources).toBe(0);
    expect(body.knowledgeBase.chunks).toBe(0);
    expect(body.sms.platformSegments).toBe(0);
    expect(body.sms.byoSegments).toBe(0);
  });

  it('reads the tenant named in the query string', async () => {
    await GET(makeReq('other-church'));
    expect(mockGetUsageSnapshot).toHaveBeenCalledWith('other-church');
    expect(mockGetSmsUsageSnapshot).toHaveBeenCalledWith('other-church');
  });
});
