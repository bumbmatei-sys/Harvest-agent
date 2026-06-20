import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockRequireAuth, mockDocGet, mockCollectionGet } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockDocGet: vi.fn(),
  mockCollectionGet: vi.fn().mockResolvedValue({ docs: [], empty: true }),
}));

vi.mock('@/lib/api-auth', () => ({
  requireAuth: mockRequireAuth,
  verifyAuth: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ get: mockDocGet, update: vi.fn() })),
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

// ── Plan gating for generate action ───────────────────────────────────────

describe('generate — tenant plan gating', () => {
  it('returns 403 for plus-plan tenant (AI not included)', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'plus' }) });

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hello' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/individual plan/i);
  });

  it('returns 403 for main-site user with no subscription', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null }));
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ aiChatSubscription: null }) });

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hello' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/subscription required/i);
  });

  it('returns 403 for main-site user with past_due subscription', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null }));
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ aiChatSubscription: { status: 'past_due' } }),
    });

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hello' }));
    expect(res.status).toBe(403);
  });

  it('passes main-site user through when subscription is active', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: null }));
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ aiChatSubscription: { status: 'active' } }),
    });
    // Mock fetch (MiMo API)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Hello!' } }] }),
    }));

    const res = await POST(makeRequest({ action: 'generate', prompt: 'hello' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe('Hello!');
  });

  it('passes pro-plan tenant through without checking subscription', async () => {
    mockRequireAuth.mockResolvedValue(mockUser({ tenantId: 'tenant1' }));
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'pro' }) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Grace!' } }] }),
    }));

    const res = await POST(makeRequest({ action: 'generate', prompt: 'What is grace?' }));
    expect(res.status).toBe(200);
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
