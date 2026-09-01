import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

/**
 * 🔴 THE-109 — THE RATE LIMITER READ EVERY SUBMISSION AN IP HAD EVER MADE.
 *
 * `checkRateLimit` ran `.where('ip', '==', ip).get()` with NO `.limit()`, then
 * filtered to the last hour in memory. To answer "have there been 3 in an hour"
 * it read all of them, forever, on a public unauthenticated endpoint — and
 * because it fails open on any error, the day that read got slow or expensive it
 * would have stopped limiting rather than complaining.
 *
 * ⚠️ THE `'unknown'` BUCKET IS THE PART THAT ACTUALLY HURT. Every request
 * arriving without `x-forwarded-for` shares one key. It accumulates from every
 * such visitor for the life of the app and was re-read in full on each new one:
 * the single hottest key and the only one guaranteed to grow.
 *
 * ⚠️ WHY A FIXTURE OF FIVE WOULD PROVE NOTHING. An unbounded read and a bounded
 * one look identical while the collection is smaller than the bound — the same
 * trap that let THE-229 ship. `BUCKET_SIZE` is 500, two orders of magnitude past
 * `RATE_LIMIT_MAX`, so a read that fetches the bucket returns 500 documents and
 * fails the assertion named for it.
 *
 * ⚠️ THE ASSERTIONS THAT ENCODE THE DEFECT, each failing BY NAME:
 *   - 'the rate-limit read is bounded' — the whole ticket. Asserts the BOUND on
 *     the read itself (`recordedReads[].limit`), not merely that the limiter
 *     still returns the right answer. Removing `.limit()` makes the recorded
 *     limit `Infinity` and fails THAT test.
 *   - 'the unknown IP bucket does not grow the read' — the specific defect,
 *     against 500 documents on the hot key.
 *   - 'a read error fails open' — the no-regression guard.
 *   - the scope guards: `firestore.rules` and `functions/` byte-identical.
 *
 * The real route runs. Only Firestore is faked, and the fake is a store, not a
 * spy rig: submissions are driven through `POST` and land in the store, so the
 * window tests exercise the real key the real write produced.
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
const INBOX = 'platform_inbox';

/** Mirrors the route's constants. Kept local so a change there has to be deliberate. */
const RATE_LIMIT_MAX = 3;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The size of the `'unknown'` bucket in the hot-key test.
 *
 * 🔴 THE NUMBER IS THE POINT. It must exceed every limit under test, or an
 * unbounded read still returns "few" documents and every assertion below passes
 * with the bug intact. At 500 it is 166× `RATE_LIMIT_MAX`, and larger than the
 * only other bound anywhere near this collection (PlatformInbox's `limit(300)`),
 * so no plausible off-by-a-bound reading of the code sneaks through.
 */
const BUCKET_SIZE = 500;

const validBody = { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Hello, I have a question.' };

function makeRequest(body: unknown = validBody, ip?: string): NextRequest {
  return new NextRequest('https://theharvest.app/api/contact', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Omitted entirely when `ip` is undefined — which is how a request lands
      // in the 'unknown' bucket for real.
      ...(ip === undefined ? {} : { 'x-forwarded-for': ip }),
    },
    body: JSON.stringify(body),
  });
}

/** The document this route writes, as it looked `ageMs` ago. */
function submission(ip: string, ageMs: number, i: number) {
  const createdAt = new Date(Date.now() - ageMs).toISOString();
  return {
    id: `seed-${ip}-${i}`,
    type: 'contact',
    status: 'pending',
    createdAt,
    userId: null,
    userEmail: null,
    data: { name: 'Seed', email: 'seed@example.com', subject: 'General enquiry', message: 'seeded' },
    fromTenantId: null,
    ip,
    rateLimitKey: `${ip}|${createdAt}`,
  };
}

/** Every read the route made against platform_inbox during this test. */
const inboxReads = () => tree.recordedReads.filter((r) => r.path === INBOX);

beforeEach(() => {
  tree.__reset();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The bound itself
// ─────────────────────────────────────────────────────────────────────────────

describe('THE-109 — the read is bounded', () => {
  it('the rate-limit read is bounded', async () => {
    await POST(makeRequest());

    const reads = inboxReads();
    expect(reads).toHaveLength(1);

    // 🔴 THE ASSERTION THE TICKET IS ABOUT. Not "the limiter works" — the read
    // itself carries a bound. `Infinity` is what the fake records when the
    // caller set no `.limit()`, which is exactly what the old query did.
    expect(reads[0].limit).not.toBe(Infinity);
    expect(Number.isFinite(reads[0].limit)).toBe(true);
    expect(reads[0].limit).toBe(RATE_LIMIT_MAX);
  });

  it('the bound is a constant — a thousand prior submissions do not widen it', async () => {
    const ip = '203.0.113.5';
    tree.__seed(INBOX, Array.from({ length: 1000 }, (_, i) => submission(ip, 3 * HOUR_MS, i)));

    await POST(makeRequest(validBody, ip));

    const reads = inboxReads();
    expect(reads[0].limit).toBe(RATE_LIMIT_MAX);
    // The bound is on the read, so what came back is bounded too — 1000 documents
    // exist for this key and at most RATE_LIMIT_MAX of them can ever be fetched.
    expect(reads[0].returned).toBeLessThanOrEqual(RATE_LIMIT_MAX);
  });

  it('the read needs no composite index — one field, no orderBy', async () => {
    await POST(makeRequest(validBody, '203.0.113.5'));

    const fields = new Set(inboxReads()[0].filters.map((f) => f.field));
    // A single field carries both halves of the key. Two fields (an equality on
    // `ip` plus an inequality on `createdAt`) is precisely what would demand a
    // composite index — and firestore.indexes.json does not deploy on merge.
    expect([...fields]).toEqual(['rateLimitKey']);
    expect(inboxReads()[0].filters.map((f) => f.op).sort()).toEqual(['<', '>']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 & 3. Behaviour is unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('THE-109 — the limit still limits', () => {
  it('3 submissions in an hour pass, the 4th is refused', async () => {
    const ip = '203.0.113.5';

    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
      const res = await POST(makeRequest(validBody, ip));
      expect(res.status).toBe(200);
    }
    expect(tree.__count(INBOX)).toBe(RATE_LIMIT_MAX);

    const fourth = await POST(makeRequest(validBody, ip));
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: 'Too many submissions. Please try again later.' });
    // Refused means refused: nothing was written.
    expect(tree.__count(INBOX)).toBe(RATE_LIMIT_MAX);
  });

  it('another IP is unaffected by a neighbour at the limit', async () => {
    tree.__seed(INBOX, [
      submission('203.0.113.5', 60_000, 0),
      submission('203.0.113.5', 60_000, 1),
      submission('203.0.113.5', 60_000, 2),
    ]);

    expect((await POST(makeRequest(validBody, '203.0.113.5'))).status).toBe(429);
    expect((await POST(makeRequest(validBody, '198.51.100.7'))).status).toBe(200);
  });

  it('submissions older than the window do not count', async () => {
    const ip = '203.0.113.5';
    // Four submissions, every one of them just outside the 1h window.
    tree.__seed(INBOX, Array.from({ length: 4 }, (_, i) => submission(ip, HOUR_MS + 60_000, i)));

    const res = await POST(makeRequest(validBody, ip));
    expect(res.status).toBe(200);
    expect(tree.__count(INBOX)).toBe(5);
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
    // 59 minutes on, the three are still inside a sliding hour...
    vi.setSystemTime(new Date('2026-09-01T10:59:00.000Z'));
    expect((await POST(makeRequest(validBody, ip))).status).toBe(429);

    // ...and only once they age past it does the address get another turn.
    vi.setSystemTime(new Date('2026-09-01T11:00:01.000Z'));
    expect((await POST(makeRequest(validBody, ip))).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Fail open
// ─────────────────────────────────────────────────────────────────────────────

describe('THE-109 — fail open', () => {
  const BOOM = new Error('firestore unavailable');

  /**
   * A query builder that rejects whenever the read is finally issued.
   *
   * Chainable on purpose, and unconditionally so: it must fail for the ONE
   * reason it names, no matter how the query is shaped. A stub hard-coded to
   * `where→where→limit→get` would also blow up if a `.limit()` went missing —
   * and a fail-open test that goes red when somebody removes the bound reports
   * the wrong defect.
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

    // 🔴 NON-NEGOTIABLE. A read error must not block a submission: a limiter that
    // fails closed silently drops a church's first contact with Harvest.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(tree.__count(INBOX)).toBe(1);

    spy.mockRestore();
  });

  it('a read error is reported rather than swallowed', async () => {
    const spy = rejectingCollection();

    await POST(makeRequest());

    // Failing open quietly is how a limiter stops limiting without anyone
    // noticing — the silent-failure rule. Open, but loud.
    expect(captureHandledError).toHaveBeenCalledWith(BOOM, { step: 'contact-rate-limit', level: 'warning' });

    spy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The hot key
// ─────────────────────────────────────────────────────────────────────────────

describe("THE-109 — the 'unknown' bucket", () => {
  it("the 'unknown' IP bucket does not grow the read", async () => {
    // Every visitor who ever arrived without x-forwarded-for, in one key. This
    // is the bucket the old query re-read in full on every new request.
    tree.__seed(INBOX, Array.from({ length: BUCKET_SIZE }, (_, i) => submission('unknown', 3 * HOUR_MS, i)));
    expect(tree.__count(INBOX)).toBe(BUCKET_SIZE);

    const res = await POST(makeRequest(validBody, undefined));
    expect(res.status).toBe(200);

    const read = inboxReads()[0];
    // 🔴 THE DEFECT. 500 documents on the hot key; the read fetches at most 3.
    expect(read.limit).toBe(RATE_LIMIT_MAX);
    expect(read.returned).toBeLessThanOrEqual(RATE_LIMIT_MAX);
    expect(read.returned).toBeLessThan(BUCKET_SIZE);
  });

  it("the 'unknown' bucket is still rate limited, however large its history", async () => {
    // Old history, plus three inside the window: the limit must still bite. A
    // bound that worked by reading less of the truth would let the 4th through.
    tree.__seed(INBOX, [
      ...Array.from({ length: BUCKET_SIZE }, (_, i) => submission('unknown', 3 * HOUR_MS, i)),
      ...Array.from({ length: RATE_LIMIT_MAX }, (_, i) => submission('unknown', 60_000, BUCKET_SIZE + i)),
    ]);

    const res = await POST(makeRequest(validBody, undefined));
    expect(res.status).toBe(429);
    expect(inboxReads()[0].returned).toBe(RATE_LIMIT_MAX);
  });

  it("a request with no x-forwarded-for lands in the 'unknown' bucket", async () => {
    await POST(makeRequest(validBody, undefined));
    const [[, written]] = tree.__docs(INBOX);
    expect(written.ip).toBe('unknown');
    expect(String(written.rateLimitKey).startsWith('unknown|')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 & 7. The document
// ─────────────────────────────────────────────────────────────────────────────

describe('THE-109 — the written document', () => {
  it('the written document shape is unchanged', async () => {
    await POST(makeRequest({ ...validBody, subject: 'Partnership idea' }, '198.51.100.7, 10.0.0.1'));

    const [[, written]] = tree.__docs(INBOX);

    // Every field PlatformInbox.tsx renders and notifyPlatformInbox formats the
    // email off, pinned by value. None of them moved.
    expect(written).toMatchObject({
      type: 'contact',
      status: 'pending',
      userId: null,
      userEmail: null,
      fromTenantId: null,
      data: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        subject: 'Partnership idea',
        message: 'Hello, I have a question.',
      },
    });
    expect(typeof written.createdAt).toBe('string');
    expect(() => new Date(written.createdAt as string).toISOString()).not.toThrow();
    // `ip` is the raw first hop of x-forwarded-for, exactly as before — the
    // window is NOT smuggled into it.
    expect(written.ip).toBe('198.51.100.7');

    // 🔴 THE ONE ADDITION, PINNED. The key set is the pre-THE-109 set plus
    // `rateLimitKey` and nothing else. Neither consumer reads it, exactly as
    // neither reads `ip`; both ignore top-level fields they do not name.
    expect(Object.keys(written).sort()).toEqual(
      ['createdAt', 'data', 'fromTenantId', 'ip', 'rateLimitKey', 'status', 'type', 'userEmail', 'userId'],
    );
  });

  it('the rate-limit key is derived from the ip and createdAt actually written', async () => {
    await POST(makeRequest(validBody, '198.51.100.7'));

    const [[, written]] = tree.__docs(INBOX);
    // One timestamp, used for both — so the window is measured against the value
    // the inbox displays, and the two can never drift.
    expect(written.rateLimitKey).toBe(`${written.ip}|${written.createdAt}`);
  });

  it("only this route's documents carry a top-level ip field", async () => {
    // What ContactModal.tsx writes: same collection, authenticated, no `ip` and
    // no `rateLimitKey`. Three of them, inside the window, from a "user" who
    // would blow the limit if they ever matched.
    tree.__seed(INBOX, [
      { id: 'modal-1', type: 'contact', status: 'pending', createdAt: new Date().toISOString(), userId: 'u1', userEmail: 'a@b.c', fromTenantId: 't1', data: { message: 'from the modal' } },
      { id: 'modal-2', type: 'bug', status: 'pending', createdAt: new Date().toISOString(), userId: 'u1', userEmail: 'a@b.c', fromTenantId: 't1', data: { title: 'bug' } },
      { id: 'modal-3', type: 'feature', status: 'pending', createdAt: new Date().toISOString(), userId: 'u1', userEmail: 'a@b.c', fromTenantId: 't1', data: { title: 'idea' } },
    ]);

    // They do not count against an anonymous visitor...
    const res = await POST(makeRequest(validBody, '203.0.113.5'));
    expect(res.status).toBe(200);
    expect(inboxReads()[0].returned).toBe(0);

    // ...and they still carry neither field afterwards.
    for (const [id, doc] of tree.__docs(INBOX)) {
      if (!id.startsWith('modal-')) continue;
      expect(doc).not.toHaveProperty('ip');
      expect(doc).not.toHaveProperty('rateLimitKey');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. CORS
// ─────────────────────────────────────────────────────────────────────────────

describe('THE-109 — CORS is untouched', () => {
  const EXPECTED = {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  it('CORS headers and the OPTIONS preflight are unchanged', async () => {
    const preflight = await OPTIONS();
    expect(preflight.status).toBe(204);
    for (const [header, value] of Object.entries(EXPECTED)) {
      expect(preflight.headers.get(header)).toBe(value);
    }
    // A single explicit origin, never '*'.
    expect(preflight.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('every POST response carries them — 200, 429 and 400 alike', async () => {
    const ok = await POST(makeRequest(validBody, '203.0.113.5'));
    expect(ok.status).toBe(200);

    tree.__seed(INBOX, Array.from({ length: RATE_LIMIT_MAX }, (_, i) => submission('198.51.100.7', 60_000, i)));
    const limited = await POST(makeRequest(validBody, '198.51.100.7'));
    expect(limited.status).toBe(429);

    const bad = await POST(makeRequest({ email: 'ada@example.com' }, '203.0.113.9'));
    expect(bad.status).toBe(400);

    for (const res of [ok, limited, bad]) {
      for (const [header, value] of Object.entries(EXPECTED)) {
        expect(res.headers.get(header)).toBe(value);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Scope guards
// ─────────────────────────────────────────────────────────────────────────────

describe('THE-109 — the out-of-scope files are untouched', () => {
  /**
   * Pinned by content digest recorded here, rather than shelling out to
   * `git show` at assertion time — CI's checkout depth has already made that a
   * source of failures with nothing to do with the code under test. Changing a
   * pinned file on purpose means editing a digest here: deliberate, and
   * reviewable in the diff.
   *
   * ⚠️ `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE
   * (.github/workflows/deploy-rules.yml) and CI runs no emulator rules tests, so
   * a rules edit riding along in a rate-limiter PR would ship unverified.
   * `functions/` does not deploy on merge, which is the mirror-image trap: an
   * edit there would look shipped and not be.
   */
  const RULES_SHA = 'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499';
  const FUNCTIONS_SHA = '98132e824b2082a4ac3b6ddf8d99551c7bdc7f5398af73b6696ae0116d865d30';

  const sha = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

  /** Every tracked file under functions/, in a stable order. `lib/` is build output and gitignored. */
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

    // A digest over the (path, content) pairs, so an added or deleted file fails
    // this too — not just an edited one.
    const root = path.join(process.cwd(), 'functions');
    const files = functionsFiles(root);
    expect(files).toHaveLength(5);

    const tree = createHash('sha256');
    for (const file of files) {
      tree.update(path.relative(process.cwd(), file).split(path.sep).join('/'));
      tree.update('\0');
      tree.update(sha(readFileSync(file)));
      tree.update('\0');
    }
    expect(tree.digest('hex')).toBe(FUNCTIONS_SHA);
  });

  it('no composite index was added for platform_inbox', () => {
    // The alternative fix, rejected: firestore.indexes.json does not deploy on
    // merge, so an index this query depended on would be missing in production
    // and the query would reject QUIETLY behind the fail-open catch.
    const indexes = readFileSync(path.join(process.cwd(), 'firestore.indexes.json'), 'utf-8');
    expect(indexes).not.toContain('platform_inbox');
  });
});
