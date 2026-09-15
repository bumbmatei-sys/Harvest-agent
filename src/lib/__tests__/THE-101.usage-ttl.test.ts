import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * THE-101 — the Firestore TTL policy on `usage.expiresAt`, before it is applied.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The card's action is a FIREBASE CONSOLE click, not code. What code can do —
 * and what this suite does — is establish the two facts that decide whether that
 * click is safe, so the founder is not applying a delete policy on trust:
 *
 *   1. EVERY DOCUMENT THAT SHOULD EXPIRE CARRIES `expiresAt`, written by every
 *      writer that touches it. A month doc that misses the stamp is a document
 *      the sweep never collects, which is the policy quietly doing nothing.
 *
 *   2. NOTHING READS A DOCUMENT AFTER ITS EXPIRY, and the doc that must NEVER
 *      expire does not carry the field at all. Firestore's TTL only considers
 *      documents whose TTL field holds a past timestamp — a document without the
 *      field is never a candidate — so the absence in section 2 is not an
 *      oversight to correct but the mechanism that keeps the persistent counter
 *      alive.
 *
 * 🔴 SECTION 3 IS THE ONE THAT WOULD HAVE STOPPED THE TICKET. "A TTL that
 * deletes something still being read is worse than no TTL": it asserts that the
 * month every reader asks for is a month whose expiry is still in the future, by
 * a margin, on the last day of a month and across a year boundary.
 *
 * ⚠️ `toFake: ['Date']` only. The usage modules are plain async functions with no
 * timers to advance, and faking the whole clock here would freeze the awaits.
 * NO FIXTURE IS ANCHORED NEAR TODAY — every instant below is an explicit literal.
 *
 * NO LINE NUMBER IS PINNED ANYWHERE IN THIS FILE.
 */

// ── In-memory Firestore, recording every write so the TTL stamp is inspectable.
// Same harness shape as `sms-usage.test.ts` and `rag-usage.test.ts`.
const store = new Map<string, Record<string, any>>();

function applySet(path: string, data: Record<string, any>, merge?: boolean) {
  const prev = merge ? store.get(path) || {} : {};
  const next: Record<string, any> = { ...prev };
  for (const [k, v] of Object.entries(data)) {
    next[k] = v && typeof v === 'object' && '__increment' in v
      ? (typeof prev[k] === 'number' ? prev[k] : 0) + (v as any).__increment
      : v;
  }
  store.set(path, next);
}

function makeDocRef(path: string): any {
  return {
    path,
    collection: (sub: string) => makeColRef(`${path}/${sub}`),
    async get() {
      const data = store.get(path);
      return { exists: data !== undefined, data: () => data };
    },
    async set(data: Record<string, any>, opts?: { merge?: boolean }) {
      applySet(path, data, opts?.merge);
    },
    async update(data: Record<string, any>) {
      applySet(path, data, true);
    },
  };
}
const makeColRef = (path: string): any => ({ doc: (id: string) => makeDocRef(`${path}/${id}`) });

const adminDbMock = {
  collection: (name: string) => makeColRef(name),
  runTransaction: async (fn: (tx: any) => Promise<any>) =>
    fn({
      async get(ref: any) {
        const data = store.get(ref.path);
        return { exists: data !== undefined, data: () => data };
      },
      set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
        applySet(ref.path, data, opts?.merge);
      },
    }),
};

vi.mock('@/lib/firebase-admin', () => ({ adminDb: adminDbMock }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__ts__',
    increment: (n: number) => ({ __increment: n }),
  },
  // Carries the real millisecond value, so an expiry can be COMPARED rather
  // than merely found to be present.
  Timestamp: {
    fromDate: (d: Date) => ({ __ms: d.getTime(), toDate: () => d }),
    now: () => ({ __ms: Date.now(), toDate: () => new Date() }),
  },
}));

/**
 * ⚠️ EVERY TIER IS CURRENTLY UNMETERED (`smsSegmentsPerMonth: null`) — Harvest
 * does not sell platform SMS — and `reserveSmsSegment` short-circuits to a plain
 * read when the cap is null, writing nothing. Its reserve path is still live
 * code that must stamp the TTL for the day a cap comes back (a metered add-on, a
 * platform-SMS product), so it is exercised against an INJECTED cap, exactly as
 * `sms-usage.test.ts` already does. Nothing else in this file overrides limits.
 */
vi.mock('@/lib/planLimits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../planLimits')>();
  return {
    ...actual,
    getPlanLimits: (plan?: string | null) => ({
      ...actual.getPlanLimits(plan),
      smsSegmentsPerMonth: 1000,
    }),
  };
});

const { monthKey, monthlyUsageTtl, incrementQueryTokens, checkAndReserveIngest } =
  await import('../rag-usage');
const { reserveSmsSegment, settleSmsSegments, recordByoSegments, getSmsUsageSnapshot } =
  await import('../sms-usage');

const TENANT = 't1';
const usagePath = (id: string) => `tenants/${TENANT}/usage/${id}`;
const ms = (v: unknown) => (v as { __ms: number } | undefined)?.__ms;

/** An instant far from today, deliberately: mid-month, mid-year, not "now". */
const MID_MONTH = new Date('2031-05-17T12:00:00.000Z');

beforeEach(() => {
  store.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MID_MONTH);
});
afterEach(() => {
  vi.useRealTimers();
});

/* ═══ 1 · Every month document that should expire carries expiresAt ══════════ */

describe('1 · every writer of a month document stamps expiresAt', () => {
  /**
   * Both metering modules share ONE document per tenant-month — `queryTokens`
   * from RAG, `smsSegments` from SMS — so BOTH must stamp the same TTL. A writer
   * that merged without it would leave the month unswept if it happened to write
   * last, which is a bug that only shows up as a bill.
   */
  const WRITERS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    ['incrementQueryTokens', () => incrementQueryTokens(TENANT, 100)],
    ['reserveSmsSegment', () => reserveSmsSegment(TENANT)],
    ['settleSmsSegments', () => settleSmsSegments(TENANT, 3)],
    ['recordByoSegments', () => recordByoSegments(TENANT, 2)],
  ];

  it.each(WRITERS)('%s leaves an expiresAt on the month doc', async (_name, write) => {
    await write();
    const doc = store.get(usagePath(monthKey(MID_MONTH)));
    expect(doc, 'no month document was written at all').toBeDefined();
    expect(ms(doc!.expiresAt), 'the month doc carries no TTL stamp').toBeTypeOf('number');
  });

  it('and all of them agree on the SAME instant, so none sweeps the month early', async () => {
    const stamps: number[] = [];
    for (const [, write] of WRITERS) {
      store.clear();
      await write();
      stamps.push(ms(store.get(usagePath(monthKey(MID_MONTH)))!.expiresAt)!);
    }
    expect(new Set(stamps).size, `writers disagree on the TTL: ${stamps.join(', ')}`).toBe(1);
    expect(stamps[0]).toBe(ms(monthlyUsageTtl(monthKey(MID_MONTH))));
  });

  it('the stamp is 90 days past the FIRST of that month, not past the write', () => {
    // Keyed off the month rather than "now" so a late write in a busy month
    // cannot extend the retention window past what the policy promises.
    const expiry = new Date(ms(monthlyUsageTtl('2031-05'))!);
    expect(expiry.toISOString()).toBe('2031-07-30T00:00:00.000Z');
  });
});

/* ═══ 2 · The document that must NEVER expire carries no field ═══════════════ */

describe('2 · the persistent ingest counter is not a TTL candidate', () => {
  /**
   * 🔴 THE MUTATION THIS EXISTS FOR — "read a usage document after expiry".
   *
   * `usage/ingest` is a STOCK, not a monthly flow: it never resets, and the
   * ingest gate reads it on every upload for the life of the tenant. It sits in
   * the SAME subcollection the TTL policy would be applied to. Stamping it with
   * an `expiresAt` would enrol it in that policy and have Firestore delete a
   * live quota counter 90 days on — silently resetting every tenant's consumed
   * ingest allowance to zero.
   */
  it('checkAndReserveIngest writes no expiresAt', async () => {
    await checkAndReserveIngest(TENANT, 10);
    const doc = store.get(usagePath('ingest'));
    expect(doc, 'the ingest doc was not written').toBeDefined();
    expect(doc!.ingestTokens).toBe(10);
    expect(
      'expiresAt' in doc!,
      'the ingest STOCK must never be a TTL candidate — it is read for the life of the tenant',
    ).toBe(false);
  });

  it('and repeated reservations never introduce one', async () => {
    await checkAndReserveIngest(TENANT, 10);
    await checkAndReserveIngest(TENANT, 5);
    const doc = store.get(usagePath('ingest'))!;
    expect(doc.ingestTokens).toBe(15);
    expect('expiresAt' in doc).toBe(false);
  });

  it('so the ingest doc and the month doc are distinguishable by the TTL field alone', async () => {
    await checkAndReserveIngest(TENANT, 1);
    await incrementQueryTokens(TENANT, 1);
    const withTtl = [...store.entries()]
      .filter(([, v]) => 'expiresAt' in v)
      .map(([k]) => k);
    expect(withTtl, 'exactly the month doc, and nothing else, is swept').toEqual([
      usagePath(monthKey(MID_MONTH)),
    ]);
  });
});

/* ═══ 3 · Nothing reads a document after its expiry ══════════════════════════ */

describe('3 · every read targets a month whose expiry is still in the future', () => {
  /**
   * The readers take `date = new Date()` and no caller passes anything else, so
   * the month in play is always the current one. This states the consequence:
   * the doc a reader asks for expires at 1st-of-month + 90 days, which is at
   * minimum 59 days after the LAST day of that month. There is no window in
   * which a live reader can meet a swept document.
   */
  const INSTANTS: ReadonlyArray<readonly [string, string]> = [
    ['the first instant of a month', '2031-05-01T00:00:00.000Z'],
    ['the last instant of a 31-day month', '2031-05-31T23:59:59.999Z'],
    ['the last instant of a 28-day month', '2031-02-28T23:59:59.999Z'],
    ['the last instant of a leap February', '2032-02-29T23:59:59.999Z'],
    ['the last instant of a year', '2031-12-31T23:59:59.999Z'],
  ];

  it.each(INSTANTS)('at %s the current month has not expired', (_label, iso) => {
    const now = new Date(iso);
    vi.setSystemTime(now);
    const expiry = ms(monthlyUsageTtl(monthKey(now)))!;
    expect(expiry, `the month doc read at ${iso} is already a TTL candidate`)
      .toBeGreaterThan(now.getTime());
  });

  it.each(INSTANTS)('and at %s it has at least 59 days of margin left', (_label, iso) => {
    // The floor case is the last instant of a 31-day month: 90 days from the 1st
    // leaves 59. Anything less would mean the policy is cutting into live data.
    const now = new Date(iso);
    vi.setSystemTime(now);
    const daysLeft = (ms(monthlyUsageTtl(monthKey(now)))! - now.getTime()) / 86_400_000;
    expect(daysLeft).toBeGreaterThanOrEqual(59);
  });

  it('a reader gets the document it just wrote, at a month boundary', async () => {
    vi.setSystemTime(new Date('2031-12-31T23:59:59.999Z'));
    // The real sequence: reserve one segment up front, then settle the EXTRA
    // three a 4-segment message actually cost.
    await reserveSmsSegment(TENANT);
    await settleSmsSegments(TENANT, 4);
    const snapshot = await getSmsUsageSnapshot(TENANT);
    expect(snapshot.month).toBe('2031-12');
    expect(snapshot.smsSegmentsUsed, 'the reader and the writer disagreed on the month').toBe(4);
  });
});
