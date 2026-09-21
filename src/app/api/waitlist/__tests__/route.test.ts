import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockAdd, mockGet } = vi.hoisted(() => ({
  mockAdd: vi.fn().mockResolvedValue({ id: 'lead_1' }),
  mockGet: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
}));

vi.mock('@/lib/firebase-admin', () => {
  const query: Record<string, unknown> = {};
  query.where = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.get = mockGet;
  return { adminDb: { collection: vi.fn(() => ({ ...query, add: mockAdd })) } };
});

vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));

const { POST, OPTIONS } = await import('../route');

const ORIGIN = 'https://theharvest.site';

function makeRequest(body: unknown, ip = '203.0.113.5'): NextRequest {
  return new NextRequest('https://theharvest.app/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validBody = { email: 'pastor@church.org', source: 'homepage' };

beforeEach(() => {
  vi.clearAllMocks();
  mockAdd.mockResolvedValue({ id: 'lead_1' });
  mockGet.mockResolvedValue({ docs: [], size: 0 });
});

describe('OPTIONS /api/waitlist (CORS preflight)', () => {
  it('returns 204 with the marketing-origin CORS headers (never *)', async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  });
});

describe('POST /api/waitlist — validation', () => {
  it('rejects a missing email with 400 and writes nothing', async () => {
    const res = await POST(makeRequest({ source: 'homepage' }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('treats a whitespace-only email as missing (400)', async () => {
    const res = await POST(makeRequest({ email: '   ' }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('treats a non-string email as missing (400)', async () => {
    const res = await POST(makeRequest({ email: { evil: true } }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rejects an invalid email with 400', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rejects an invalid JSON body with 400', async () => {
    const res = await POST(makeRequest('{ not json'));
    expect(res.status).toBe(400);
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('POST /api/waitlist — length caps', () => {
  it('truncates an over-length email instead of rejecting (still 200)', async () => {
    const email = `${'a'.repeat(190)}@${'b'.repeat(20)}.com`; // > 200 chars, still valid shape
    expect(email.length).toBeGreaterThan(200);
    const res = await POST(makeRequest({ email }));
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0].email.length).toBe(200);
  });
});

describe('POST /api/waitlist — rate limit', () => {
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

describe('POST /api/waitlist — success write', () => {
  it('writes email-only product_updates doc and returns 200 + CORS', async () => {
    const res = await POST(makeRequest(validBody, '198.51.100.7, 10.0.0.1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

    expect(mockAdd).toHaveBeenCalledTimes(1);
    const written = mockAdd.mock.calls[0][0];
    expect(written).toMatchObject({
      email: 'pastor@church.org',
      source: 'homepage',
      status: 'pending',
      ip: '198.51.100.7',
    });
    expect(typeof written.createdAt).toBe('string');
    expect(written.rateLimitKey).toBe(`198.51.100.7|${written.createdAt}`);
    // Email-only body — no name/message/newsletter fields.
    expect(written).not.toHaveProperty('name');
    expect(written).not.toHaveProperty('message');
    expect(Object.keys(written).sort()).toEqual(
      ['createdAt', 'email', 'ip', 'rateLimitKey', 'source', 'status'],
    );
  });

  it('defaults an unknown/missing source to waitlist', async () => {
    await POST(makeRequest({ email: 'a@b.co' }));
    expect(mockAdd.mock.calls[0][0].source).toBe('waitlist');

    await POST(makeRequest({ email: 'a@b.co', source: 'newsletter' }));
    expect(mockAdd.mock.calls[1][0].source).toBe('waitlist');
  });

  it('accepts source=waitlist', async () => {
    await POST(makeRequest({ email: 'a@b.co', source: 'waitlist' }));
    expect(mockAdd.mock.calls[0][0].source).toBe('waitlist');
  });
});
