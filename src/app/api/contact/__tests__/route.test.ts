import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
// adminDb.collection('platform_inbox').where('ip','==',ip).get()  → rate limit
// adminDb.collection('platform_inbox').add({...})                 → the write
const { mockAdd, mockGet } = vi.hoisted(() => ({
  mockAdd: vi.fn().mockResolvedValue({ id: 'contact_1' }),
  mockGet: vi.fn().mockResolvedValue({ docs: [] }),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      where: vi.fn(() => ({ get: mockGet })),
      add: mockAdd,
    })),
  },
}));

const { POST, OPTIONS } = await import('../route');

const ORIGIN = 'https://theharvest.site';

function makeRequest(body: unknown, ip = '203.0.113.5'): NextRequest {
  return new NextRequest('https://theharvest.app/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// A platform_inbox doc from this IP whose createdAt is inside the 1h window.
function recentDoc(ip = '203.0.113.5') {
  return { data: () => ({ ip, createdAt: new Date().toISOString() }) };
}
// A doc older than the window — must NOT count toward the limit.
function oldDoc(ip = '203.0.113.5') {
  return { data: () => ({ ip, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }) };
}

const validBody = { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Hello, I have a question.' };

beforeEach(() => {
  vi.clearAllMocks();
  mockAdd.mockResolvedValue({ id: 'contact_1' });
  mockGet.mockResolvedValue({ docs: [] }); // under the limit by default
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
  it('returns 429 once 3 submissions from the IP already exist in the window, writing nothing', async () => {
    mockGet.mockResolvedValue({ docs: [recentDoc(), recentDoc(), recentDoc()] });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('ignores submissions older than the 1h window (still allowed)', async () => {
    mockGet.mockResolvedValue({ docs: [oldDoc(), oldDoc(), oldDoc(), recentDoc()] });
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
