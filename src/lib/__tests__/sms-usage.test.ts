import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory Firestore mock ────────────────────────────────────────────────
// Same harness as rag-usage.test.ts: a store keyed by full doc path, and a
// runTransaction that SERIALIZES (like Firestore's conflict handling) so the
// concurrent near-limit test is faithful. `.set` interprets increment sentinels.

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
  getSmsSegmentCap,
  reserveSmsSegment,
  settleSmsSegments,
  refundSmsSegment,
  getSmsUsageSnapshot,
} = await import('../sms-usage');

const PLUS_CAP = 250; // the default tier
const JULY = new Date(Date.UTC(2026, 6, 15)); // 2026-07-15
const JULY_DOC = 'tenants/t1/usage/2026-07';

beforeEach(() => {
  store.clear();
  txQueue = Promise.resolve();
});

// ── Plan caps ───────────────────────────────────────────────────────────────

describe('the four SMS allotments', () => {
  it('pins the per-tier segment allotments so they cannot drift silently', async () => {
    const { PLAN_LIMITS } = await import('../planLimits');
    expect(PLAN_LIMITS.plus.smsSegmentsPerMonth).toBe(250);    // UNCONFIRMED — draft
    expect(PLAN_LIMITS.pro.smsSegmentsPerMonth).toBe(500);     // UNCONFIRMED — draft
    expect(PLAN_LIMITS.max.smsSegmentsPerMonth).toBe(2_000);   // UNCONFIRMED — draft
    expect(PLAN_LIMITS.ultra.smsSegmentsPerMonth).toBe(4_000); // confirmed by Matei 2026-07-25
  });

  it('leaves no tier unmetered', async () => {
    const { PLAN_LIMITS } = await import('../planLimits');
    for (const tier of Object.values(PLAN_LIMITS)) {
      expect(tier.smsSegmentsPerMonth).not.toBeNull();
    }
  });
});

describe('getSmsSegmentCap', () => {
  it('reads the tenant plan', async () => {
    store.set('tenants/t-ultra', { plan: 'ultra' });
    expect(await getSmsSegmentCap('t-ultra')).toBe(4_000);
    store.set('tenants/t-max', { plan: 'max' });
    expect(await getSmsSegmentCap('t-max')).toBe(2_000);
    store.set('tenants/t-pro', { plan: 'pro' });
    expect(await getSmsSegmentCap('t-pro')).toBe(500);
  });

  it('falls back to plus for a missing tenant or unknown plan', async () => {
    expect(await getSmsSegmentCap('t-missing')).toBe(PLUS_CAP);
    store.set('tenants/t-weird', { plan: 'enterprise-x' });
    expect(await getSmsSegmentCap('t-weird')).toBe(PLUS_CAP);
  });
});

// ── Reserve (the atomic pre-send gate) ──────────────────────────────────────

describe('reserveSmsSegment', () => {
  it('treats a missing usage doc as 0 and reserves one segment', async () => {
    const gate = await reserveSmsSegment('t1', JULY);
    expect(gate.allowed).toBe(true);
    expect(gate.used).toBe(1);
    expect(gate.cap).toBe(PLUS_CAP);
    expect(store.get(JULY_DOC)?.smsSegments).toBe(1);
  });

  it('writes the month doc with a TTL so finished months self-expire', async () => {
    await reserveSmsSegment('t1', JULY);
    expect(store.get(JULY_DOC)?.expiresAt).toBeDefined();
  });

  it('does NOT disturb the RAG query counter sharing the same month doc', async () => {
    store.set(JULY_DOC, { queryTokens: 12_345 });
    await reserveSmsSegment('t1', JULY);
    expect(store.get(JULY_DOC)?.queryTokens).toBe(12_345);
    expect(store.get(JULY_DOC)?.smsSegments).toBe(1);
  });

  it('reserves while under cap', async () => {
    store.set(JULY_DOC, { smsSegments: 100 });
    const gate = await reserveSmsSegment('t1', JULY);
    expect(gate.allowed).toBe(true);
    expect(store.get(JULY_DOC)?.smsSegments).toBe(101);
  });

  it('BLOCKS at cap and writes nothing', async () => {
    store.set(JULY_DOC, { smsSegments: PLUS_CAP });
    const gate = await reserveSmsSegment('t1', JULY);
    expect(gate.allowed).toBe(false);
    expect(gate.used).toBe(PLUS_CAP);
    expect(gate.cap).toBe(PLUS_CAP);
    expect(store.get(JULY_DOC)?.smsSegments).toBe(PLUS_CAP); // no reservation
  });

  it('allows the very last segment (cap - 1) and blocks the next', async () => {
    store.set(JULY_DOC, { smsSegments: PLUS_CAP - 1 });
    expect((await reserveSmsSegment('t1', JULY)).allowed).toBe(true);
    expect(store.get(JULY_DOC)?.smsSegments).toBe(PLUS_CAP);
    expect((await reserveSmsSegment('t1', JULY)).allowed).toBe(false);
  });

  it('two concurrent near-limit sends cannot BOTH pass (transaction correctness)', async () => {
    store.set(JULY_DOC, { smsSegments: PLUS_CAP - 1 });
    const [a, b] = await Promise.all([
      reserveSmsSegment('t1', JULY),
      reserveSmsSegment('t1', JULY),
    ]);
    const passed = [a, b].filter((g) => g.allowed).length;
    expect(passed).toBe(1); // exactly one — the second sees the first's write
    expect(store.get(JULY_DOC)?.smsSegments).toBe(PLUS_CAP);
  });

  it('is keyed per month — a new month starts at 0 with no reset job', async () => {
    store.set(JULY_DOC, { smsSegments: PLUS_CAP });
    const aug = await reserveSmsSegment('t1', new Date(Date.UTC(2026, 7, 1)));
    expect(aug.allowed).toBe(true);
    expect(store.get('tenants/t1/usage/2026-08')?.smsSegments).toBe(1);
  });
});

// ── Settle (the post-send increment by Twilio's real count) ─────────────────

describe('settleSmsSegments', () => {
  it('adds nothing extra for a 1-segment message (the reservation covered it)', async () => {
    store.set(JULY_DOC, { smsSegments: 1 });
    await settleSmsSegments('t1', 1, JULY);
    expect(store.get(JULY_DOC)?.smsSegments).toBe(1);
  });

  it('a MULTI-SEGMENT message increments by more than one', async () => {
    store.set(JULY_DOC, { smsSegments: 1 }); // the reserved segment
    await settleSmsSegments('t1', 3, JULY);  // Twilio said num_segments = 3
    expect(store.get(JULY_DOC)?.smsSegments).toBe(3);
  });

  it('never refunds a delivered message (0 segments keeps the reserved one)', async () => {
    store.set(JULY_DOC, { smsSegments: 1 });
    await settleSmsSegments('t1', 0, JULY);
    expect(store.get(JULY_DOC)?.smsSegments).toBe(1);
  });

  it('stamps the TTL on the month doc', async () => {
    await settleSmsSegments('t1', 4, JULY);
    expect(store.get(JULY_DOC)?.expiresAt).toBeDefined();
  });
});

describe('refundSmsSegment', () => {
  it('gives the reserved segment back and clamps at 0', async () => {
    store.set(JULY_DOC, { smsSegments: 5 });
    await refundSmsSegment('t1', JULY);
    expect(store.get(JULY_DOC)?.smsSegments).toBe(4);
    store.set(JULY_DOC, { smsSegments: 0 });
    await refundSmsSegment('t1', JULY);
    expect(store.get(JULY_DOC)?.smsSegments).toBe(0);
  });
});

// ── Snapshot ────────────────────────────────────────────────────────────────

describe('getSmsUsageSnapshot', () => {
  it('reads the counter + cap for the admin indicator', async () => {
    store.set('tenants/t1', { plan: 'ultra' });
    store.set(JULY_DOC, { smsSegments: 1_234 });
    expect(await getSmsUsageSnapshot('t1', JULY)).toEqual({
      plan: 'ultra',
      month: '2026-07',
      smsSegmentsUsed: 1_234,
      smsSegmentsCap: 4_000,
    });
  });

  it('reports 0 for a tenant with no usage doc yet (missing doc reads as 0)', async () => {
    const snap = await getSmsUsageSnapshot('t-fresh', JULY);
    expect(snap.smsSegmentsUsed).toBe(0);
    expect(snap.plan).toBe('plus');
    expect(snap.smsSegmentsCap).toBe(PLUS_CAP);
  });
});
