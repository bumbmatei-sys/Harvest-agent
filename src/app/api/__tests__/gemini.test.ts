import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockRequireAuth, mockDocGet, mockChatUsageSet, mockCollectionGet } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockDocGet: vi.fn(),
  mockChatUsageSet: vi.fn().mockResolvedValue(undefined),
  mockCollectionGet: vi.fn().mockResolvedValue({ docs: [], empty: true }),
}));

vi.mock('@/lib/api-auth', () => ({
  requireAuth: mockRequireAuth,
  verifyAuth: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ get: mockDocGet, set: mockChatUsageSet, update: vi.fn() })),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: mockCollectionGet,
    })),
    recursiveDelete: vi.fn(),
  },
  adminAuth: { verifyIdToken: vi.fn() },
}));

// Mock Gemini SDK — embedContent (ingest) + countTokens (ingest metering).
const { mockEmbedContent, mockCountTokens } = vi.hoisted(() => ({
  mockEmbedContent: vi.fn().mockResolvedValue({ embeddings: [{ values: [0.1, 0.2, 0.3] }] }),
  mockCountTokens: vi.fn().mockResolvedValue({ totalTokens: 42 }),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { embedContent: mockEmbedContent, countTokens: mockCountTokens };
  },
}));

// Mock the RAG usage metering module so the route's ordering/gating is asserted
// without a real Firestore. Unit correctness of these fns lives in
// src/lib/__tests__/rag-usage.test.ts.
const {
  mockCheckAndReserveIngest,
  mockRefundIngest,
  mockCheckQueryBudget,
  mockIncrementQueryTokens,
} = vi.hoisted(() => ({
  mockCheckAndReserveIngest: vi.fn(),
  mockRefundIngest: vi.fn().mockResolvedValue(undefined),
  mockCheckQueryBudget: vi.fn(),
  mockIncrementQueryTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/rag-usage', () => ({
  approxTokens: (t: string) => Math.ceil((t?.length ?? 0) / 4),
  checkAndReserveIngest: mockCheckAndReserveIngest,
  refundIngest: mockRefundIngest,
  checkQueryBudget: mockCheckQueryBudget,
  incrementQueryTokens: mockIncrementQueryTokens,
}));

const { POST } = await import('../gemini/route');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

function mockUser(overrides: object = {}) {
  return { uid: 'u1', email: 'test@test.com', tenantId: 'tenant1', isAdmin: false, isSuperAdmin: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.MIMO_API_KEY = 'tp-test-key';
  // Default metering: under both limits. Individual tests override.
  mockCountTokens.mockResolvedValue({ totalTokens: 42 });
  mockEmbedContent.mockResolvedValue({ embeddings: [{ values: [0.1, 0.2, 0.3] }] });
  mockCheckAndReserveIngest.mockResolvedValue({ allowed: true, used: 42, ceiling: 500_000 });
  mockCheckQueryBudget.mockResolvedValue({ allowed: true, used: 0, cap: 2_000_000 });
});

// ── Auth gate ──────────────────────────────────────────────────────────────

describe('auth gate', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const res = await POST(makeRequest({ action: 'generate', prompt: 'hello' }));
    expect(res.status).toBe(401);
  });
});

// ── Access & usage limits for generate action ─────────────────────────────

describe('generate — access (no plan/subscription gating)', () => {
  it('allows a plus-plan tenant (previously blocked) for non-chat generate', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Hello!' } }] }),
    }));

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hello' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe('Hello!');
  });

  it('allows a main-site user with no subscription for non-chat generate', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Grace!' } }] }),
    }));

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hello' }));
    expect(res.status).toBe(200);
  });
});

describe('generate — chat usage limits (purpose: "chat")', () => {
  it('answers within the free allowance and records usage', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockDocGet.mockResolvedValue({ exists: false }); // fresh chat_usage doc
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Peace!' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hello', purpose: 'chat' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe('Peace!');
    expect(fetchMock).toHaveBeenCalledTimes(1); // MiMo was called
    expect(mockChatUsageSet).toHaveBeenCalledWith(
      expect.objectContaining({ windowCount: 1, cooldownUntil: null }),
      { merge: true }
    );
  });

  it('returns the Holy-Spirit redirect past the free allowance, without calling MiMo', async () => {
    const now = Date.now();
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ windowCount: 10, cooldownUntil: null, lastMessageAt: now }),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeRequest({ action: 'generate', prompt: 'q', purpose: 'chat' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toMatch(/The Holy Spirit is your true Helper/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rests during an active cooldown, without calling MiMo', async () => {
    const now = Date.now();
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ windowCount: 13, cooldownUntil: now + 3_600_000, lastMessageAt: now }),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeRequest({ action: 'generate', prompt: 'q', purpose: 'chat' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limited).toBe(true);
    expect(body.text).toMatch(/Let's pause here for a little while/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exempts super admins from the chat usage limit', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null, isSuperAdmin: true }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Always on' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hi', purpose: 'chat' }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockDocGet).not.toHaveBeenCalled(); // never touched chat_usage
  });
});

// ── Input validation ───────────────────────────────────────────────────────

describe('input validation', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'pro' }) });
  });

  it('returns 400 when prompt is missing', async () => {
    const res = await POST(makeRequest({ action: 'generate' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when prompt exceeds 30k character limit', async () => {
    const res = await POST(makeRequest({ action: 'generate', prompt: 'x'.repeat(30001) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/exceeds maximum length/i);
  });

  it('returns 400 for unknown action', async () => {
    const res = await POST(makeRequest({ action: 'unknown' }));
    expect(res.status).toBe(400);
  });
});

// ── MiMo API error passthrough ─────────────────────────────────────────────

describe('upstream error handling', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'pro' }) });
  });

  it('returns 500 when MIMO_API_KEY is not set', async () => {
    delete process.env.MIMO_API_KEY;
    const res = await POST(makeRequest({ action: 'generate', prompt: 'hello' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/MIMO_API_KEY/);
  });

  it('returns 502 when MiMo API returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue('rate limited'),
    }));

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hello' }));
    expect(res.status).toBe(502);
  });
});

// ── Embed action ───────────────────────────────────────────────────────────

describe('embed action', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
  });

  it('returns embedding vector', async () => {
    const res = await POST(makeRequest({ action: 'embed', text: 'Jesus is Lord' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vector).toEqual([0.1, 0.2, 0.3]);
  });

  it('returns 400 when text exceeds 50k character limit', async () => {
    const res = await POST(makeRequest({ action: 'embed', text: 'x'.repeat(50001) }));
    expect(res.status).toBe(400);
  });

  it('returns 500 when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(makeRequest({ action: 'embed', text: 'hello' }));
    expect(res.status).toBe(500);
  });
});

// ── Ingest metering (embed, purpose: 'ingest') ─────────────────────────────

describe('ingest metering — embed with purpose: "ingest"', () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
  });

  it('reserves tokens then embeds when the doc fits under the ceiling', async () => {
    const res = await POST(makeRequest({ action: 'embed', text: 'a doc chunk', purpose: 'ingest' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vector).toEqual([0.1, 0.2, 0.3]);
    // Token count comes from Gemini countTokens (42), reserved for tenant1.
    expect(mockCountTokens).toHaveBeenCalledTimes(1);
    expect(mockCheckAndReserveIngest).toHaveBeenCalledWith('tenant1', 42);
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
    expect(mockRefundIngest).not.toHaveBeenCalled();
  });

  it('BLOCKS before calling embedContent when the doc would exceed the ceiling', async () => {
    mockCheckAndReserveIngest.mockResolvedValue({ allowed: false, used: 500_000, ceiling: 500_000 });
    const res = await POST(makeRequest({ action: 'embed', text: 'too big', purpose: 'ingest' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ingest_ceiling_reached');
    expect(body.ceiling).toBe(500_000);
    // The provider was never called — this is a hard pre-call gate.
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  it('refunds the reservation when embedding fails', async () => {
    mockEmbedContent.mockRejectedValueOnce(new Error('upstream quota'));
    const res = await POST(makeRequest({ action: 'embed', text: 'a doc chunk', purpose: 'ingest' }));
    expect(res.status).toBe(502);
    expect(mockRefundIngest).toHaveBeenCalledWith('tenant1', 42);
  });

  it('refunds the reservation when the provider returns no vector', async () => {
    mockEmbedContent.mockResolvedValueOnce({ embeddings: [] });
    const res = await POST(makeRequest({ action: 'embed', text: 'a doc chunk', purpose: 'ingest' }));
    expect(res.status).toBe(502);
    expect(mockRefundIngest).toHaveBeenCalledWith('tenant1', 42);
  });

  it('does NOT meter a query-time embed (no purpose)', async () => {
    const res = await POST(makeRequest({ action: 'embed', text: 'search query' }));
    expect(res.status).toBe(200);
    expect(mockCheckAndReserveIngest).not.toHaveBeenCalled();
    expect(mockCountTokens).not.toHaveBeenCalled();
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
  });

  it('exempts super admins (tenantId: null) — no metering, no tenants/null write', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null, isSuperAdmin: true }));
    const res = await POST(makeRequest({ action: 'embed', text: 'a doc chunk', purpose: 'ingest' }));
    expect(res.status).toBe(200);
    expect(mockCheckAndReserveIngest).not.toHaveBeenCalled();
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
  });
});

// ── Query metering (generate, purpose: 'chat') ─────────────────────────────

describe('query metering — chat token cap', () => {
  it('increments query tokens by MiMo usage.total_tokens after a successful answer', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockDocGet.mockResolvedValue({ exists: false }); // fresh chat_usage (per-user gate)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'Peace!' } }],
        // total_tokens deliberately != prompt+completion (137+914=1051) so the
        // assertion pins that we read usage.total_tokens, not a re-sum.
        usage: { prompt_tokens: 137, completion_tokens: 914, total_tokens: 1200 },
      }),
    }));

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hi', purpose: 'chat' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe('Peace!');
    expect(mockCheckQueryBudget).toHaveBeenCalledWith('tenant1');
    expect(mockIncrementQueryTokens).toHaveBeenCalledWith('tenant1', 1200);
  });

  it('does NOT increment query tokens when MiMo returns a non-200 (failed answer)', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockDocGet.mockResolvedValue({ exists: false }); // fresh chat_usage (per-user gate)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue('rate limited'),
    }));

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hi', purpose: 'chat' }));
    expect(res.status).toBe(502);
    // The increment lives strictly after the !response.ok early-return, so a
    // failed answer must never charge the tenant.
    expect(mockIncrementQueryTokens).not.toHaveBeenCalled();
  });

  it('blocks the next query when the monthly cap is reached, WITHOUT calling MiMo', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockCheckQueryBudget.mockResolvedValue({ allowed: false, used: 2_000_000, cap: 2_000_000 });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hi', purpose: 'chat' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limited).toBe(true);
    expect(body.capReached).toBe('query');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockIncrementQueryTokens).not.toHaveBeenCalled();
  });

  it('falls back to a char/4 estimate when MiMo returns no usage', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockDocGet.mockResolvedValue({ exists: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Hi' } }] }),
    }));

    // prompt 'hello' (5) + no systemInstruction ('') + reply 'Hi' (2) = 'helloHi' (7) → ceil(7/4) = 2
    const res = await POST(makeRequest({ action: 'generate', prompt: 'hello', purpose: 'chat' }));
    expect(res.status).toBe(200);
    expect(mockIncrementQueryTokens).toHaveBeenCalledWith('tenant1', 2);
  });

  it('exempts super admins — no budget check, no increment', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null, isSuperAdmin: true }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'Always on' } }],
        usage: { total_tokens: 500 },
      }),
    }));

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hi', purpose: 'chat' }));
    expect(res.status).toBe(200);
    expect(mockCheckQueryBudget).not.toHaveBeenCalled();
    expect(mockIncrementQueryTokens).not.toHaveBeenCalled();
  });

  it('allows a null-tenant chat user (main site) but does not meter them', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null, isSuperAdmin: false }));
    mockDocGet.mockResolvedValue({ exists: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'Grace!' } }],
        usage: { total_tokens: 500 },
      }),
    }));

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hi', purpose: 'chat' }));
    expect(res.status).toBe(200);
    expect(mockCheckQueryBudget).not.toHaveBeenCalled();
    expect(mockIncrementQueryTokens).not.toHaveBeenCalled();
  });
});
