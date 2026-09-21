import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Bounded rate-limit read for /api/waitlist (product_updates), mirroring
 * THE-109 / enterprise-lead. Asserts the bound on the read itself, the sliding
 * window, fail-open, and the hot 'unknown' bucket — against a real document
 * store fake, not a canned spy answer.
 */

const tree = await import('@/test/mocks/firestore-tree');

vi.mock('@/lib/firebase-admin', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  return { adminDb: m.adminDb };
});

const { captureHandledError } = await import('@/lib/money-path-sentry');
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));

const { POST, OPTIONS } = await import('../route');

const ORIGIN = 'https://theharvest.site';
const COLLECTION = 'product_updates';
const RATE_LIMIT_MAX = 3;
const HOUR_MS = 60 * 60 * 1000;
const BUCKET_SIZE = 500;

const validBody = { email: 'pastor@church.org', source: 'homepage' };

function makeRequest(body: unknown = validBody, ip?: string): NextRequest {
  return new NextRequest('https://theharvest.app/api/waitlist', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(ip === undefined ? {} : { 'x-forwarded-for': ip }),
    },
    body: JSON.stringify(body),
  });
}

function submission(ip: string, ageMs: number, i: number) {
  const createdAt = new Date(Date.now() - ageMs).toISOString();
  return {
    id: `seed-${ip}-${i}`,
    email: 'seed@example.com',
    source: 'waitlist',
    status: 'pending',
    createdAt,
    ip,
    rateLimitKey: `${ip}|${createdAt}`,
  };
}

const collectionReads = () => tree.recordedReads.filter((r) => r.path === COLLECTION);

beforeEach(() => {
  tree.__reset();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('/api/waitlist — the read is bounded', () => {
  it('the rate-limit read is bounded', async () => {
    await POST(makeRequest());
    const reads = collectionReads();
    expect(reads).toHaveLength(1);
    expect(reads[0].limit).not.toBe(Infinity);
    expect(reads[0].limit).toBe(RATE_LIMIT_MAX);
  });

  it('the read needs no composite index — one field, no orderBy', async () => {
    await POST(makeRequest(validBody, '203.0.113.5'));
    const fields = new Set(collectionReads()[0].filters.map((f) => f.field));
    expect([...fields]).toEqual(['rateLimitKey']);
    expect(collectionReads()[0].filters.map((f) => f.op).sort()).toEqual(['<', '>']);
  });
});

describe('/api/waitlist — the limit still limits', () => {
  it('3 submissions in an hour pass, the 4th is refused', async () => {
    const ip = '203.0.113.5';
    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
      expect((await POST(makeRequest(validBody, ip))).status).toBe(200);
    }
    expect(tree.__count(COLLECTION)).toBe(RATE_LIMIT_MAX);

    const fourth = await POST(makeRequest(validBody, ip));
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: 'Too many submissions. Please try again later.' });
    expect(tree.__count(COLLECTION)).toBe(RATE_LIMIT_MAX);
  });

  it('another IP is unaffected by a neighbour at the limit', async () => {
    tree.__seed(COLLECTION, [
      submission('203.0.113.5', 60_000, 0),
      submission('203.0.113.5', 60_000, 1),
      submission('203.0.113.5', 60_000, 2),
    ]);
    expect((await POST(makeRequest(validBody, '203.0.113.5'))).status).toBe(429);
    expect((await POST(makeRequest(validBody, '198.51.100.7'))).status).toBe(200);
  });

  it('submissions older than the window do not count', async () => {
    const ip = '203.0.113.5';
    tree.__seed(COLLECTION, Array.from({ length: 4 }, (_, i) => submission(ip, HOUR_MS + 60_000, i)));
    expect((await POST(makeRequest(validBody, ip))).status).toBe(200);
    expect(tree.__count(COLLECTION)).toBe(5);
  });

  it('the window slides', async () => {
    vi.useFakeTimers();
    const ip = '203.0.113.5';
    vi.setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
      expect((await POST(makeRequest(validBody, ip))).status).toBe(200);
    }
    expect((await POST(makeRequest(validBody, ip))).status).toBe(429);

    vi.setSystemTime(new Date('2026-09-01T10:59:00.000Z'));
    expect((await POST(makeRequest(validBody, ip))).status).toBe(429);

    vi.setSystemTime(new Date('2026-09-01T11:00:01.000Z'));
    expect((await POST(makeRequest(validBody, ip))).status).toBe(200);
  });
});

describe('/api/waitlist — fail open', () => {
  const BOOM = new Error('firestore unavailable');

  function rejectingCollection() {
    const query: Record<string, unknown> = {};
    for (const method of ['where', 'limit', 'orderBy', 'startAfter']) query[method] = () => query;
    query.get = () => Promise.reject(BOOM);
    return vi.spyOn(tree.adminDb, 'collection').mockImplementationOnce(() => query as never);
  }

  it('a read error fails open', async () => {
    const spy = rejectingCollection();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(tree.__count(COLLECTION)).toBe(1);
    spy.mockRestore();
  });

  it('a read error is reported rather than swallowed', async () => {
    const spy = rejectingCollection();
    await POST(makeRequest());
    expect(captureHandledError).toHaveBeenCalledWith(BOOM, {
      step: 'waitlist-rate-limit',
      level: 'warning',
    });
    spy.mockRestore();
  });
});

describe("/api/waitlist — the 'unknown' bucket", () => {
  it("the 'unknown' IP bucket does not grow the read", async () => {
    tree.__seed(COLLECTION, Array.from({ length: BUCKET_SIZE }, (_, i) => submission('unknown', 3 * HOUR_MS, i)));
    const res = await POST(makeRequest(validBody, undefined));
    expect(res.status).toBe(200);
    const read = collectionReads()[0];
    expect(read.limit).toBe(RATE_LIMIT_MAX);
    expect(read.returned).toBeLessThanOrEqual(RATE_LIMIT_MAX);
    expect(read.returned).toBeLessThan(BUCKET_SIZE);
  });
});

describe('/api/waitlist — written document + CORS', () => {
  it('writes to product_updates with email, source, ip, rateLimitKey', async () => {
    await POST(makeRequest({ email: 'pastor@church.org', source: 'waitlist' }, '198.51.100.7'));
    const [[, written]] = tree.__docs(COLLECTION);
    expect(written).toMatchObject({
      email: 'pastor@church.org',
      source: 'waitlist',
      status: 'pending',
      ip: '198.51.100.7',
    });
    expect(written.rateLimitKey).toBe(`${written.ip}|${written.createdAt}`);
  });

  it('CORS headers and OPTIONS preflight match contact', async () => {
    const preflight = await OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).not.toBe('*');

    const ok = await POST(makeRequest(validBody, '203.0.113.5'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
});
