import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory Firestore mock ────────────────────────────────────────────────
// A tiny store keyed by full doc path, plus a runTransaction that SERIALIZES
// (like Firestore's conflict handling) so a concurrent near-limit reserve test
// is faithful. `.set` interprets FieldValue.increment sentinels.

const store = new Map<string, Record<string, any>>();

function applySet(path: string, data: Record<string, any>, merge?: boolean) {
  const prev = merge ? store.get(path) || {} : {};
  const next: Record<string, any> = { ...prev };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && '__increment' in v) {
      next[k] = (typeof prev[k] === 'number' ? prev[k] : 0) + (v as any).__increment;
    } else {
      next[k] = v;
    }
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
  };
}
function makeColRef(path: string): any {
  return { doc: (id: string) => makeDocRef(`${path}/${id}`) };
}

// Serialize transactions so even Promise.all runs them one-at-a-time against the
// shared store — this is what makes the concurrency assertion meaningful.
let txQueue: Promise<unknown> = Promise.resolve();

const adminDbMock = {
  collection: (name: string) => makeColRef(name),
  runTransaction: (fn: (tx: any) => Promise<any>) => {
    const run = async () => {
      const tx = {
        async get(ref: any) {
          const data = store.get(ref.path);
          return { exists: data !== undefined, data: () => data };
        },
        set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
          applySet(ref.path, data, opts?.merge);
        },
      };
      return fn(tx);
    };
    const result = txQueue.then(run, run);
    txQueue = result.catch(() => {});
    return result;
  },
};

vi.mock('@/lib/firebase-admin', () => ({ adminDb: adminDbMock }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__ts__',
    increment: (n: number) => ({ __increment: n }),
  },
  Timestamp: {
    fromDate: (d: Date) => ({ __ts: d.toISOString() }),
  },
}));

const {
  monthKey,
  approxTokens,
  getTenantPlanLimits,
  checkAndReserveIngest,
  refundIngest,
  checkQueryBudget,
  incrementQueryTokens,
  getUsageSnapshot,
} = await import('../rag-usage');

// plus limits (the default): ingestTokensTotal 500_000, queryTokensPerMonth 2_000_000
const PLUS_CEIL = 500_000;
const PLUS_QUERY_CAP = 2_000_000;
const JULY = new Date(Date.UTC(2026, 6, 15)); // 2026-07-15

beforeEach(() => {
  store.clear();
  txQueue = Promise.resolve();
});

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('monthKey / approxTokens', () => {
  it('formats the UTC month key', () => {
    expect(monthKey(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01');
    expect(monthKey(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-12');
  });

  it('approxTokens is ~4 chars/token and 0 for empty', () => {
    expect(approxTokens('abcdefgh')).toBe(2);
    expect(approxTokens('')).toBe(0);
    expect(approxTokens(undefined as any)).toBe(0);
  });
});

describe('getTenantPlanLimits', () => {
  it('reads the tenant plan', async () => {
    store.set('tenants/t-pro', { plan: 'pro' });
    const limits = await getTenantPlanLimits('t-pro');
    expect(limits.queryTokensPerMonth).toBe(10_000_000);
    expect(limits.ingestTokensTotal).toBe(2_000_000);
  });

  it('falls back to plus for a missing tenant or unknown plan', async () => {
    expect((await getTenantPlanLimits('t-missing')).ingestTokensTotal).toBe(PLUS_CEIL);
    store.set('tenants/t-weird', { plan: 'enterprise-x' });
    expect((await getTenantPlanLimits('t-weird')).ingestTokensTotal).toBe(PLUS_CEIL);
  });
});

// ── Ingest reserve / refund ─────────────────────────────────────────────────

describe('checkAndReserveIngest', () => {
  it('treats a missing usage doc as 0 and reserves', async () => {
    const gate = await checkAndReserveIngest('t1', 100);
    expect(gate.allowed).toBe(true);
    expect(gate.used).toBe(100);
    expect(gate.ceiling).toBe(PLUS_CEIL);
    expect(store.get('tenants/t1/usage/ingest')?.ingestTokens).toBe(100);
  });

  it('reserves when the doc fits under the ceiling', async () => {
    store.set('tenants/t1/usage/ingest', { ingestTokens: 100 });
    const gate = await checkAndReserveIngest('t1', 50);
    expect(gate.allowed).toBe(true);
    expect(store.get('tenants/t1/usage/ingest')?.ingestTokens).toBe(150);
  });

  it('BLOCKS and writes nothing when the doc would exceed the ceiling', async () => {
    store.set('tenants/t1/usage/ingest', { ingestTokens: PLUS_CEIL - 10 });
    const gate = await checkAndReserveIngest('t1', 20);
    expect(gate.allowed).toBe(false);
    expect(gate.used).toBe(PLUS_CEIL - 10);
    // No reservation written on a block.
    expect(store.get('tenants/t1/usage/ingest')?.ingestTokens).toBe(PLUS_CEIL - 10);
  });

  it('two concurrent near-limit reserves cannot BOTH pass (transaction correctness)', async () => {
    store.set('tenants/t1/usage/ingest', { ingestTokens: PLUS_CEIL - 50 });
    const [a, b] = await Promise.all([
      checkAndReserveIngest('t1', 40),
      checkAndReserveIngest('t1', 40),
    ]);
    const passed = [a, b].filter((g) => g.allowed).length;
    expect(passed).toBe(1); // exactly one — the second sees the first's write
    expect(store.get('tenants/t1/usage/ingest')?.ingestTokens).toBe(PLUS_CEIL - 10);
  });
});

describe('refundIngest', () => {
  it('subtracts and clamps at 0', async () => {
    store.set('tenants/t1/usage/ingest', { ingestTokens: 100 });
    await refundIngest('t1', 30);
    expect(store.get('tenants/t1/usage/ingest')?.ingestTokens).toBe(70);
    await refundIngest('t1', 200); // over-refund clamps
    expect(store.get('tenants/t1/usage/ingest')?.ingestTokens).toBe(0);
  });

  it('is a no-op for <= 0 tokens', async () => {
    store.set('tenants/t1/usage/ingest', { ingestTokens: 100 });
    await refundIngest('t1', 0);
    expect(store.get('tenants/t1/usage/ingest')?.ingestTokens).toBe(100);
  });
});

// ── Query budget / increment ────────────────────────────────────────────────

describe('checkQueryBudget', () => {
  it('treats a missing month doc as 0 (allowed)', async () => {
    const b = await checkQueryBudget('t1', JULY);
    expect(b.allowed).toBe(true);
    expect(b.used).toBe(0);
    expect(b.cap).toBe(PLUS_QUERY_CAP);
  });

  it('blocks at/over cap, allows strictly under', async () => {
    store.set('tenants/t1/usage/2026-07', { queryTokens: PLUS_QUERY_CAP });
    expect((await checkQueryBudget('t1', JULY)).allowed).toBe(false);
    store.set('tenants/t1/usage/2026-07', { queryTokens: PLUS_QUERY_CAP - 1 });
    expect((await checkQueryBudget('t1', JULY)).allowed).toBe(true);
  });
});

describe('incrementQueryTokens', () => {
  it('atomically adds to the month counter and sets a TTL', async () => {
    await incrementQueryTokens('t1', 500, JULY);
    const doc = store.get('tenants/t1/usage/2026-07');
    expect(doc?.queryTokens).toBe(500);
    expect(doc?.expiresAt).toBeDefined();
    await incrementQueryTokens('t1', 300, JULY);
    expect(store.get('tenants/t1/usage/2026-07')?.queryTokens).toBe(800);
  });

  it('is a no-op for <= 0 tokens', async () => {
    await incrementQueryTokens('t1', 0, JULY);
    expect(store.get('tenants/t1/usage/2026-07')).toBeUndefined();
  });
});

// ── Snapshot ────────────────────────────────────────────────────────────────

describe('getUsageSnapshot', () => {
  it('reads both counters + plan limits, missing docs as 0', async () => {
    store.set('tenants/t1', { plan: 'pro' });
    store.set('tenants/t1/usage/ingest', { ingestTokens: 1234 });
    store.set('tenants/t1/usage/2026-07', { queryTokens: 5678 });
    const snap = await getUsageSnapshot('t1', JULY);
    expect(snap).toEqual({
      plan: 'pro',
      month: '2026-07',
      queryTokensUsed: 5678,
      queryTokensCap: 10_000_000,
      ingestTokensUsed: 1234,
      ingestTokensCeiling: 2_000_000,
    });
  });

  it('reports 0 usage for a tenant with no usage docs yet', async () => {
    const snap = await getUsageSnapshot('t-fresh', JULY);
    expect(snap.queryTokensUsed).toBe(0);
    expect(snap.ingestTokensUsed).toBe(0);
    expect(snap.plan).toBe('plus');
  });
});
