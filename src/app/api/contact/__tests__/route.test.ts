import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
// adminDb.collection('platform_inbox')
//   .where('rateLimitKey','>',…).where('rateLimitKey','<',…).limit(N).get()
//                                                                 → rate limit
// adminDb.collection('platform_inbox').add({...})                 → the write
//
// The query builder is chainable because THE-109 bounded that read: two range
// filters and a `.limit()`. The rate-limit BEHAVIOUR is covered against a real
// document store in the-109-rate-limit-bound.test.ts, which is where the window
// tests moved to — a hand-rolled `{ docs: [...] }` can only assert what the
// route does with a canned answer, and the window now lives in the query.
const { mockAdd, mockGet } = vi.hoisted(() => ({
  mockAdd: vi.fn().mockResolvedValue({ id: 'contact_1' }),
  mockGet: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
}));

vi.mock('@/lib/firebase-admin', () => {
  const query: Record<string, unknown> = {};
  query.where = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.get = mockGet;
  return { adminDb: { collection: vi.fn(() => ({ ...query, add: mockAdd })) } };
});

const { POST, OPTIONS } = await import('../route');

const ORIGIN = 'https://theharvest.site';

function makeRequest(body: unknown, ip = '203.0.113.5'): NextRequest {
  return new NextRequest('https://theharvest.app/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validBody = { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Hello, I have a question.' };

beforeEach(() => {
  vi.clearAllMocks();
  mockAdd.mockResolvedValue({ id: 'contact_1' });
  mockGet.mockResolvedValue({ docs: [], size: 0 }); // under the limit by default
});

describe('OPTIONS /api/contact (CORS preflight)', () => {
  it('returns 204 with the marketing-origin CORS headers (never *)', async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  });
});

describe('POST /api/contact — validation', () => {
  it('rejects a missing name with 400 and writes nothing', async () => {
    const res = await POST(makeRequest({ email: 'ada@example.com', message: 'hi there' }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('rejects a missing email with 400', async () => {
    const res = await POST(makeRequest({ name: 'Ada', message: 'hi there' }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rejects a missing message with 400', async () => {
    const res = await POST(makeRequest({ name: 'Ada', email: 'ada@example.com' }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only required field as missing (400)', async () => {
    const res = await POST(makeRequest({ name: '   ', email: 'ada@example.com', message: 'hi' }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('treats a non-string required field as missing (400) — no coercion into the doc', async () => {
    const res = await POST(makeRequest({ name: { evil: true }, email: 'ada@example.com', message: 'hi' }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rejects an invalid email with 400', async () => {
    const res = await POST(makeRequest({ ...validBody, email: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rejects an invalid JSON body with 400', async () => {
    const res = await POST(makeRequest('{ not json', '203.0.113.5'));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('POST /api/contact — length caps', () => {
  it('truncates over-length fields instead of rejecting them (still 200)', async () => {
    const res = await POST(
      makeRequest({
        name: 'n'.repeat(500),
        email: 'ada@example.com',
        subject: 's'.repeat(500),
        message: 'm'.repeat(9000),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    const written = mockAdd.mock.calls[0][0];
    expect(written.data.name.length).toBe(100);
    expect(written.data.subject.length).toBe(200);
    expect(written.data.message.length).toBe(5000);
  });
});

describe('POST /api/contact — rate limit', () => {
  // The window and the bound are exercised against a real document store in
  // the-109-rate-limit-bound.test.ts. What stays here is the wiring: the route
  // turns the query's verdict into the right status, and never blocks on error.
  it('returns 429 when the window read comes back at the limit, writing nothing', async () => {
    mockGet.mockResolvedValue({ docs: [{}, {}, {}], size: 3 });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('allows the write when the window read comes back under the limit', async () => {
    mockGet.mockResolvedValue({ docs: [{}, {}], size: 2 });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it('fails open (allows the write) when the rate-limit query throws', async () => {
    mockGet.mockRejectedValue(new Error('firestore down'));
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/contact — success write', () => {
  it('writes an anonymous type:contact doc into platform_inbox and returns 200 + CORS', async () => {
    const res = await POST(makeRequest(validBody, '198.51.100.7, 10.0.0.1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

    expect(mockAdd).toHaveBeenCalledTimes(1);
    const written = mockAdd.mock.calls[0][0];
    expect(written).toMatchObject({
      type: 'contact',
      status: 'pending',
      userId: null,
      userEmail: null,
      fromTenantId: null,
      data: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        message: 'Hello, I have a question.',
      },
    });
    // createdAt is an ISO string (not a Firestore Timestamp).
    expect(typeof written.createdAt).toBe('string');
    expect(() => new Date(written.createdAt).toISOString()).not.toThrow();
    // ip is the first hop of x-forwarded-for, stored top-level for rate limiting.
    expect(written.ip).toBe('198.51.100.7');
    // THE-109: the bounded window read keys off this, derived from the two
    // fields above. Consumer-invisible exactly as `ip` is.
    expect(written.rateLimitKey).toBe(`198.51.100.7|${written.createdAt}`);
  });

  it('defaults a missing subject to "General enquiry"', async () => {
    await POST(makeRequest(validBody));
    expect(mockAdd.mock.calls[0][0].data.subject).toBe('General enquiry');
  });

  it('keeps a provided subject', async () => {
    await POST(makeRequest({ ...validBody, subject: 'Partnership idea' }));
    expect(mockAdd.mock.calls[0][0].data.subject).toBe('Partnership idea');
  });
});
