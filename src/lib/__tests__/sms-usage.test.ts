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

// ── Cap injection ───────────────────────────────────────────────────────────
// Every tier is now UNMETERED (smsSegmentsPerMonth: null) — Harvest does not
// sell platform SMS, so there is no allotment to ration. The reserve/settle/
// refund machinery is still live code and still has to be correct for the day a
// cap comes back (a metered add-on, a platform-SMS product), so its behaviour
// tests below run against an INJECTED cap rather than being deleted.
//
// `capOverride === undefined` passes through to the real PLAN_LIMITS, which is
// what the "no tier is metered" assertions rely on.
let capOverride: number | null | undefined;

vi.mock('@/lib/planLimits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../planLimits')>();
  return {
    ...actual,
    getPlanLimits: (plan?: string | null) => {
      const limits = actual.getPlanLimits(plan);
      return capOverride === undefined
        ? limits
        : { ...limits, smsSegmentsPerMonth: capOverride };
    },
  };
});
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
  recordByoSegments,
  getSmsUsageSnapshot,
} = await import('../sms-usage');

// The cap the metering tests inject. 250 was the real plus allotment before SMS
// went BYO-only; keeping the number makes the diff on those tests obvious.
const PLUS_CAP = 250;
const JULY = new Date(Date.UTC(2026, 6, 15)); // 2026-07-15
const JULY_DOC = 'tenants/t1/usage/2026-07';

beforeEach(() => {
  store.clear();
  txQueue = Promise.resolve();
  capOverride = undefined; // real PLAN_LIMITS unless a test opts in
});

// ── Plan caps ───────────────────────────────────────────────────────────────

describe('SMS is unmetered on every tier', () => {
  it('pins every tier to null so a cap cannot reappear silently', async () => {
    // Was 250 / 500 / 2,000 / 4,000. Those budgets metered plus/pro/max for a
    // feature whose `smsAutomation` plan flag was FALSE — three tiers billed
    // against an allotment they could not spend. SMS is now BYO-only: the
    // tenant's own Twilio bills them directly, so Harvest has nothing to cap.
    // Reintroducing a number here starts charging against an allotment nobody
    // is buying, so it must be a deliberate act, not a passing edit.
    const { PLAN_LIMITS } = await import('../planLimits');
    expect(PLAN_LIMITS.plus.smsSegmentsPerMonth).toBeNull();
    expect(PLAN_LIMITS.pro.smsSegmentsPerMonth).toBeNull();
    expect(PLAN_LIMITS.max.smsSegmentsPerMonth).toBeNull();
  });

  it('leaves no tier metered', async () => {
    const { PLAN_LIMITS } = await import('../planLimits');
    for (const tier of Object.values(PLAN_LIMITS)) {
      expect(tier.smsSegmentsPerMonth).toBeNull();
    }
  });

  it('has one row per tier, ultra gone and free added', async () => {
    // 🔴 THE-200 added the Forever Free tier, so this is four rows, not three.
    // `ultra` staying absent is the assertion that still matters — the tier was
    // deleted and folded into max, and a row reappearing here would mean it
    // came back through a Record<TenantPlan, …> nobody read.
    const { PLAN_LIMITS } = await import('../planLimits');
    expect(Object.keys(PLAN_LIMITS)).toEqual(['free', 'plus', 'pro', 'max']);
    expect(Object.keys(PLAN_LIMITS)).not.toContain('ultra');
  });

  it('gives the free tier ZERO AI budget, because it has no AI', async () => {
    // Not a placeholder: free carries aiChat: false and aiKnowledge: false, so
    // it reaches neither the RAG query path nor the ingest path. A non-zero
    // budget would be COGS allocated to a tier that cannot spend it — the same
    // defect as the SMS budgets this file exists to document.
    const { PLAN_LIMITS } = await import('../planLimits');
    expect(PLAN_LIMITS.free.queryTokensPerMonth).toBe(0);
    expect(PLAN_LIMITS.free.ingestTokensTotal).toBe(0);
    expect(PLAN_LIMITS.free.smsSegmentsPerMonth).toBeNull();
  });

  it('keeps max on its own token numbers — it did not inherit ultra 150M/30M', async () => {
    const { PLAN_LIMITS } = await import('../planLimits');
    expect(PLAN_LIMITS.max.queryTokensPerMonth).toBe(50_000_000);
    expect(PLAN_LIMITS.max.ingestTokensTotal).toBe(10_000_000);
  });
});

// An unmetered tier takes the `cap === null` short-circuit: always allowed, and
// it must never write a counter. This is the path EVERY tenant is on now.
describe('the unmetered path (cap === null)', () => {
  it('reports a null cap for every tier', async () => {
    for (const plan of ['plus', 'pro', 'max']) {
      store.set(`tenants/t-${plan}`, { plan });
      expect(await getSmsSegmentCap(`t-${plan}`)).toBeNull();
    }
  });

  it('always allows and writes NOTHING', async () => {
    const gate = await reserveSmsSegment('t1', JULY);
    expect(gate.allowed).toBe(true);
    expect(gate.cap).toBeNull();
    expect(gate.used).toBe(0);
    expect(store.get(JULY_DOC)).toBeUndefined(); // no reservation, no doc
  });

  it('allows well past what any old allotment would have permitted', async () => {
    store.set(JULY_DOC, { smsSegments: 999_999 });
    const gate = await reserveSmsSegment('t1', JULY);
    expect(gate.allowed).toBe(true);
    expect(store.get(JULY_DOC)?.smsSegments).toBe(999_999); // untouched
  });
});

describe('getSmsSegmentCap', () => {
  it('reads the tenant plan', async () => {
    // Behaviour under test is "the cap comes from the tenant's plan", not the
    // specific numbers — every real tier is null now, so the cap is injected.
    capOverride = 2_000;
    store.set('tenants/t-max', { plan: 'max' });
    expect(await getSmsSegmentCap('t-max')).toBe(2_000);
    store.set('tenants/t-pro', { plan: 'pro' });
    expect(await getSmsSegmentCap('t-pro')).toBe(2_000);
  });

  it('reads null straight through for a real (unmetered) tier', async () => {
    store.set('tenants/t-max', { plan: 'max' });
    expect(await getSmsSegmentCap('t-max')).toBeNull();
  });

  it('falls back to plus for a missing tenant or unknown plan', async () => {
    capOverride = PLUS_CAP;
    expect(await getSmsSegmentCap('t-missing')).toBe(PLUS_CAP);
    store.set('tenants/t-weird', { plan: 'enterprise-x' });
    expect(await getSmsSegmentCap('t-weird')).toBe(PLUS_CAP);
  });
});

// ── Reserve (the atomic pre-send gate) ──────────────────────────────────────

describe('reserveSmsSegment', () => {
  // The gate only engages on a metered tier. No tier is metered today, so these
  // run against an injected cap — the machinery must stay correct for the day
  // one comes back.
  beforeEach(() => { capOverride = PLUS_CAP; });

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

// ── BYO counting (visibility only — never a gate) ───────────────────────────

describe('recordByoSegments', () => {
  it('counts into its OWN field, leaving the capped counter untouched', async () => {
    store.set(JULY_DOC, { smsSegments: 7 });
    await recordByoSegments('t1', 3, JULY);
    expect(store.get(JULY_DOC)?.smsSegmentsByo).toBe(3);
    // The field the cap is checked against must not move for a send Harvest
    // is not paying for.
    expect(store.get(JULY_DOC)?.smsSegments).toBe(7);
  });

  it('accumulates across sends and counts a delivered message as at least 1', async () => {
    await recordByoSegments('t1', 2, JULY);
    await recordByoSegments('t1', 0, JULY); // Twilio omitted num_segments
    expect(store.get(JULY_DOC)?.smsSegmentsByo).toBe(3);
  });

  it('is never blocked by the cap — it records well past the plus allotment', async () => {
    store.set('tenants/t1', { plan: 'plus' });
    for (let i = 0; i < 3; i++) await recordByoSegments('t1', 200, JULY);
    expect(store.get(JULY_DOC)?.smsSegmentsByo).toBe(600); // > PLUS_CAP, no gate
  });

  it('stamps the TTL on the month doc', async () => {
    await recordByoSegments('t1', 1, JULY);
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
    capOverride = 2_000;
    store.set('tenants/t1', { plan: 'max' });
    store.set(JULY_DOC, { smsSegments: 1_234, smsSegmentsByo: 56 });
    expect(await getSmsUsageSnapshot('t1', JULY)).toEqual({
      plan: 'max',
      month: '2026-07',
      smsSegmentsUsed: 1_234,
      smsSegmentsByoUsed: 56,
      smsSegmentsCap: 2_000,
    });
  });

  it('reports a null cap on a real (unmetered) tier, counters still readable', async () => {
    store.set('tenants/t1', { plan: 'max' });
    store.set(JULY_DOC, { smsSegments: 1_234, smsSegmentsByo: 56 });
    const snap = await getSmsUsageSnapshot('t1', JULY);
    expect(snap.smsSegmentsCap).toBeNull();
    expect(snap.smsSegmentsUsed).toBe(1_234);
    expect(snap.smsSegmentsByoUsed).toBe(56);
  });

  it('reports 0 for a tenant with no usage doc yet (missing doc reads as 0)', async () => {
    capOverride = PLUS_CAP;
    const snap = await getSmsUsageSnapshot('t-fresh', JULY);
    expect(snap.smsSegmentsUsed).toBe(0);
    expect(snap.smsSegmentsByoUsed).toBe(0);
    expect(snap.plan).toBe('plus');
    expect(snap.smsSegmentsCap).toBe(PLUS_CAP);
  });
});
