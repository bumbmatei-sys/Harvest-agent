import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

/**
 * 🔴 /api/enterprise-lead READ EVERY LEAD AN IP HAD EVER SUBMITTED.
 *
 * The same defect THE-109 fixed in /api/contact, on the very route that route's
 * comment named as its precedent. `checkRateLimit` ran
 * `.where('ip', '==', ip).get()` with NO `.limit()` and filtered the hour window
 * in memory: to answer "have there been 3 in an hour" it read all of them,
 * forever, on a public unauthenticated endpoint — and it failed open silently,
 * so the day that read got slow or expensive it would have stopped limiting
 * rather than complaining.
 *
 * ⚠️ THE `'unknown'` BUCKET IS THE PART THAT ACTUALLY HURT. Every request
 * arriving without `x-forwarded-for` shares one key, it accumulates from every
 * such visitor for the life of the app, and it was re-read in full on each new
 * one: the single hottest key and the only one guaranteed to grow.
 *
 * ⚠️ WHY A SMALL FIXTURE WOULD PROVE NOTHING. An unbounded read and a bounded
 * one look identical while the collection is smaller than the bound — the trap
 * that let THE-229 ship. `BUCKET_SIZE` is 500, 166× `RATE_LIMIT_MAX`.
 *
 * ⚠️ THIS ROUTE HAD NO TESTS AT ALL — `src/app/api/enterprise-lead/` contained
 * only `route.ts`. So the suite also pins the behaviour around the limiter
 * (validation, length caps, the written document) that nothing was holding.
 *
 * The real route runs. Only Firestore is faked, and the fake is a store, not a
 * spy rig: leads are driven through `POST` and land in the store, so the window
 * tests exercise the real key the real write produced.
 */

const tree = await import('@/test/mocks/firestore-tree');

vi.mock('@/lib/firebase-admin', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  return { adminDb: m.adminDb };
});

const { captureHandledError } = await import('@/lib/money-path-sentry');
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));

const { POST } = await import('../route');

const LEADS = 'enterprise_leads';

/** Mirrors the route's constants. Kept local so a change there has to be deliberate. */
const RATE_LIMIT_MAX = 3;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The size of the `'unknown'` bucket in the hot-key test.
 *
 * 🔴 THE NUMBER IS THE POINT. It must exceed every limit under test, or an
 * unbounded read still returns "few" documents and every assertion below passes
 * with the bug intact.
 */
const BUCKET_SIZE = 500;

const validBody = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  churchName: 'Grace Chapel',
  churchCount: 4,
  message: 'We run four campuses and would like to talk.',
};

function makeRequest(body: unknown = validBody, ip?: string): NextRequest {
  return new NextRequest('https://theharvest.app/api/enterprise-lead', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Omitted entirely when `ip` is undefined — which is how a request lands
      // in the 'unknown' bucket for real.
      ...(ip === undefined ? {} : { 'x-forwarded-for': ip }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** The document this route writes, as it looked `ageMs` ago. */
function lead(ip: string, ageMs: number, i: number) {
  const createdAt = new Date(Date.now() - ageMs).toISOString();
  return {
    id: `seed-${ip}-${i}`,
    name: 'Seed',
    email: 'seed@example.com',
    churchName: 'Seed Chapel',
    churchCount: null,
    message: '',
    userId: null,
    ip,
    status: 'new',
    createdAt,
    rateLimitKey: `${ip}|${createdAt}`,
  };
}

/** Every read the route made against enterprise_leads during this test. */
const leadReads = () => tree.recordedReads.filter((r) => r.path === LEADS);

let savedResendKey: string | undefined;

beforeEach(() => {
  tree.__reset();
  vi.clearAllMocks();
  // The Resend branch is `if (process.env.RESEND_API_KEY)`. Unset it so the
  // route never reaches out over the network and these tests stay about the
  // limiter and the write.
  savedResendKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
});

afterEach(() => {
  vi.useRealTimers();
  if (savedResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedResendKey;
});

// ─────────────────────────────────────────────────────────────────────────────
// The bound itself
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/enterprise-lead — the read is bounded', () => {
  it('the rate-limit read is bounded', async () => {
    await POST(makeRequest());

    const reads = leadReads();
    expect(reads).toHaveLength(1);

    // 🔴 THE ASSERTION THIS IS ABOUT. Not "the limiter works" — the read itself
    // carries a bound. `Infinity` is what the fake records when the caller set
    // no `.limit()`, which is exactly what the old query did.
    expect(reads[0].limit).not.toBe(Infinity);
    expect(Number.isFinite(reads[0].limit)).toBe(true);
    expect(reads[0].limit).toBe(RATE_LIMIT_MAX);
  });

  it('the bound is a constant — a thousand prior leads do not widen it', async () => {
    const ip = '203.0.113.5';
    tree.__seed(LEADS, Array.from({ length: 1000 }, (_, i) => lead(ip, 3 * HOUR_MS, i)));

    await POST(makeRequest(validBody, ip));

    expect(leadReads()[0].limit).toBe(RATE_LIMIT_MAX);
    expect(leadReads()[0].returned).toBeLessThanOrEqual(RATE_LIMIT_MAX);
  });

  it('the read needs no composite index — one field, no orderBy', async () => {
    await POST(makeRequest(validBody, '203.0.113.5'));

    const fields = new Set(leadReads()[0].filters.map((f) => f.field));
    // A single field carries both halves of the key. Two fields (an equality on
    // `ip` plus an inequality on `createdAt`) is precisely what would demand a
    // composite index — and firestore.indexes.json does not deploy on merge.
    expect([...fields]).toEqual(['rateLimitKey']);
    expect(leadReads()[0].filters.map((f) => f.op).sort()).toEqual(['<', '>']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The limit still limits
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/enterprise-lead — the limit still limits', () => {
  it('3 submissions in an hour pass, the 4th is refused', async () => {
    const ip = '203.0.113.5';

    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
      expect((await POST(makeRequest(validBody, ip))).status).toBe(200);
    }
    expect(tree.__count(LEADS)).toBe(RATE_LIMIT_MAX);

    const fourth = await POST(makeRequest(validBody, ip));
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: 'Too many submissions. Please try again later.' });
    // Refused means refused: nothing was written.
    expect(tree.__count(LEADS)).toBe(RATE_LIMIT_MAX);
  });

  it('another IP is unaffected by a neighbour at the limit', async () => {
    tree.__seed(LEADS, Array.from({ length: RATE_LIMIT_MAX }, (_, i) => lead('203.0.113.5', 60_000, i)));

    expect((await POST(makeRequest(validBody, '203.0.113.5'))).status).toBe(429);
    expect((await POST(makeRequest(validBody, '198.51.100.7'))).status).toBe(200);
  });

  it('submissions older than the window do not count', async () => {
    const ip = '203.0.113.5';
    tree.__seed(LEADS, Array.from({ length: 4 }, (_, i) => lead(ip, HOUR_MS + 60_000, i)));

    expect((await POST(makeRequest(validBody, ip))).status).toBe(200);
    expect(tree.__count(LEADS)).toBe(5);
  });

  it('the window slides — submissions ageing out of it stop counting', async () => {
    vi.useFakeTimers();
    const ip = '203.0.113.5';

    vi.setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
      expect((await POST(makeRequest(validBody, ip))).status).toBe(200);
    }
    expect((await POST(makeRequest(validBody, ip))).status).toBe(429);

    // 🔴 A FIXED HOURLY BUCKET WOULD PASS THE TEST ABOVE AND FAIL THESE TWO.
    vi.setSystemTime(new Date('2026-09-01T10:59:00.000Z'));
    expect((await POST(makeRequest(validBody, ip))).status).toBe(429);

    vi.setSystemTime(new Date('2026-09-01T11:00:01.000Z'));
    expect((await POST(makeRequest(validBody, ip))).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail open
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/enterprise-lead — fail open', () => {
  const BOOM = new Error('firestore unavailable');

  /**
   * A query builder that rejects whenever the read is finally issued.
   *
   * Chainable unconditionally: it must fail for the ONE reason it names, no
   * matter how the query is shaped. A stub hard-coded to `where→where→limit→get`
   * would also blow up if a `.limit()` went missing — and a fail-open test that
   * goes red when somebody removes the bound reports the wrong defect.
   */
  function rejectingCollection() {
    const query: Record<string, unknown> = {};
    for (const method of ['where', 'limit', 'orderBy', 'startAfter']) query[method] = () => query;
    query.get = () => Promise.reject(BOOM);
    return vi.spyOn(tree.adminDb, 'collection').mockImplementationOnce(() => query as never);
  }

  it('a read error fails open', async () => {
    const spy = rejectingCollection();

    const res = await POST(makeRequest());

    // 🔴 NON-NEGOTIABLE. A read error must not block a sales enquiry.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(tree.__count(LEADS)).toBe(1);

    spy.mockRestore();
  });

  it('a read error is reported rather than swallowed', async () => {
    const spy = rejectingCollection();

    await POST(makeRequest());

    // The old `catch {}` said nothing at all. Failing open quietly is how a
    // limiter stops limiting without anyone noticing. Open, but loud.
    expect(captureHandledError).toHaveBeenCalledWith(BOOM, {
      step: 'enterprise-lead-rate-limit',
      level: 'warning',
    });

    spy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The hot key
// ─────────────────────────────────────────────────────────────────────────────

describe("/api/enterprise-lead — the 'unknown' bucket", () => {
  it("the 'unknown' IP bucket does not grow the read", async () => {
    tree.__seed(LEADS, Array.from({ length: BUCKET_SIZE }, (_, i) => lead('unknown', 3 * HOUR_MS, i)));
    expect(tree.__count(LEADS)).toBe(BUCKET_SIZE);

    expect((await POST(makeRequest(validBody, undefined))).status).toBe(200);

    const read = leadReads()[0];
    // 🔴 THE DEFECT. 500 documents on the hot key; the read fetches at most 3.
    expect(read.limit).toBe(RATE_LIMIT_MAX);
    expect(read.returned).toBeLessThanOrEqual(RATE_LIMIT_MAX);
    expect(read.returned).toBeLessThan(BUCKET_SIZE);
  });

  it("the 'unknown' bucket is still rate limited, however large its history", async () => {
    tree.__seed(LEADS, [
      ...Array.from({ length: BUCKET_SIZE }, (_, i) => lead('unknown', 3 * HOUR_MS, i)),
      ...Array.from({ length: RATE_LIMIT_MAX }, (_, i) => lead('unknown', 60_000, BUCKET_SIZE + i)),
    ]);

    expect((await POST(makeRequest(validBody, undefined))).status).toBe(429);
    expect(leadReads()[0].returned).toBe(RATE_LIMIT_MAX);
  });

  it("a request with no x-forwarded-for lands in the 'unknown' bucket", async () => {
    await POST(makeRequest(validBody, undefined));
    const [[, written]] = tree.__docs(LEADS);
    expect(written.ip).toBe('unknown');
    expect(String(written.rateLimitKey).startsWith('unknown|')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The written document
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/enterprise-lead — the written document', () => {
  it('the written document shape is unchanged', async () => {
    await POST(makeRequest(validBody, '198.51.100.7, 10.0.0.1'));

    const [[, written]] = tree.__docs(LEADS);

    expect(written).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      churchName: 'Grace Chapel',
      churchCount: 4,
      message: 'We run four campuses and would like to talk.',
      userId: null,
      status: 'new',
    });
    expect(typeof written.createdAt).toBe('string');
    expect(() => new Date(written.createdAt as string).toISOString()).not.toThrow();
    // `ip` is the raw first hop of x-forwarded-for — the window is NOT smuggled
    // into it.
    expect(written.ip).toBe('198.51.100.7');

    // 🔴 THE ONE ADDITION, PINNED. Nothing renders this collection in-app; the
    // lead reaches a human through the Resend email the route builds, and
    // firestore.rules gates direct reads to super admins. Neither reads this.
    expect(Object.keys(written).sort()).toEqual(
      ['churchCount', 'churchName', 'createdAt', 'email', 'ip', 'message', 'name', 'rateLimitKey', 'status', 'userId'],
    );
  });

  it('the rate-limit key is derived from the ip and createdAt actually written', async () => {
    await POST(makeRequest(validBody, '198.51.100.7'));

    const [[, written]] = tree.__docs(LEADS);
    // One timestamp, used for both — so the window is measured against the value
    // the record shows, and the two can never drift.
    expect(written.rateLimitKey).toBe(`${written.ip}|${written.createdAt}`);
  });

  it('an optional churchCount and message are normalised, not dropped', async () => {
    await POST(makeRequest({ name: 'Ada', email: 'ada@example.com', churchName: 'Grace' }, '203.0.113.5'));
    const [[, written]] = tree.__docs(LEADS);
    expect(written.churchCount).toBeNull();
    expect(written.message).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation — the route had no tests at all, so this was unheld
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/enterprise-lead — validation', () => {
  it.each([
    ['name', { email: 'ada@example.com', churchName: 'Grace' }],
    ['email', { name: 'Ada', churchName: 'Grace' }],
    ['churchName', { name: 'Ada', email: 'ada@example.com' }],
  ])('rejects a missing %s with 400 and writes nothing', async (_field, body) => {
    const res = await POST(makeRequest(body, '203.0.113.5'));
    expect(res.status).toBe(400);
    expect(tree.__count(LEADS)).toBe(0);
  });

  it('rejects an invalid email with 400', async () => {
    const res = await POST(makeRequest({ ...validBody, email: 'not-an-email' }, '203.0.113.5'));
    expect(res.status).toBe(400);
    expect(tree.__count(LEADS)).toBe(0);
  });

  it('rejects an invalid JSON body with 400', async () => {
    const res = await POST(makeRequest('{ not json', '203.0.113.5'));
    expect(res.status).toBe(400);
    expect(tree.__count(LEADS)).toBe(0);
  });

  it('truncates over-length fields instead of rejecting them', async () => {
    await POST(
      makeRequest(
        {
          name: 'n'.repeat(500),
          email: 'ada@example.com',
          churchName: 'c'.repeat(500),
          message: 'm'.repeat(5000),
        },
        '203.0.113.5',
      ),
    );
    const [[, written]] = tree.__docs(LEADS);
    expect(String(written.name)).toHaveLength(100);
    expect(String(written.churchName)).toHaveLength(200);
    expect(String(written.message)).toHaveLength(2000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scope guards
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/enterprise-lead — the out-of-scope files are untouched', () => {
  /**
   * Pinned by content digest recorded here, rather than shelling out to
   * `git show` at assertion time — CI's checkout depth has already made that a
   * source of failures with nothing to do with the code under test.
   *
   * ⚠️ `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE and CI runs no
   * emulator rules tests. `enterprise_leads` needs no rule change: the Admin SDK
   * bypasses rules, and the existing block already denies client create.
   * `functions/` does not deploy on merge — the mirror-image trap.
   */
  const RULES_SHA = 'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499';
  const FUNCTIONS_SHA = '98132e824b2082a4ac3b6ddf8d99551c7bdc7f5398af73b6696ae0116d865d30';

  const sha = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

  function functionsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === 'node_modules' || entry.name === 'lib') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) functionsFiles(full, out);
      else out.push(full);
    }
    return out;
  }

  it('firestore.rules and functions/ are byte-identical', () => {
    expect(sha(readFileSync(path.join(process.cwd(), 'firestore.rules')))).toBe(RULES_SHA);

    const files = functionsFiles(path.join(process.cwd(), 'functions'));
    expect(files).toHaveLength(5);

    const digest = createHash('sha256');
    for (const file of files) {
      digest.update(path.relative(process.cwd(), file).split(path.sep).join('/'));
      digest.update('\0');
      digest.update(sha(readFileSync(file)));
      digest.update('\0');
    }
    expect(digest.digest('hex')).toBe(FUNCTIONS_SHA);
  });

  /**
   * ⚠️ `firestore.indexes.json` ALREADY DECLARES a composite index on this
   * collection — `enterprise_leads: ip ASC, createdAt ASC`, the exact index the
   * obvious `where('ip','==').where('createdAt','>')` fix would need. It was
   * already DEAD before this change: the only `enterprise_leads` query in the
   * repo is the rate limiter, and it used a single-field equality, never that
   * index. It stays dead now, for a different reason — a range on one field
   * needs no composite index at all.
   *
   * Which is why this is a DIGEST PIN and not "the file does not mention
   * enterprise_leads": the honest guarantee is that this change added no index,
   * not that none exists. Removing the stale declaration is a separate call —
   * the file does not deploy on merge, so deleting the line would not remove the
   * index from production anyway.
   */
  const INDEXES_SHA = '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0';

  it('no composite index was added', () => {
    expect(sha(readFileSync(path.join(process.cwd(), 'firestore.indexes.json')))).toBe(INDEXES_SHA);
  });
});
