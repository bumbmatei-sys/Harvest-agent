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

// Mock Gemini SDK
const { mockEmbedContent } = vi.hoisted(() => ({
  mockEmbedContent: vi.fn().mockResolvedValue({ embeddings: [{ values: [0.1, 0.2, 0.3] }] }),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { embedContent: mockEmbedContent };
  },
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
