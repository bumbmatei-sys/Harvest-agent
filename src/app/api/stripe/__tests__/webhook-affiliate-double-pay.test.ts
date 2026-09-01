import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-? — the affiliate could be paid TWICE.
 *
 * The initial webhook transfer used to be keyed `aff_initial_${subscriptionId}`
 * while every retry path keyed `aff_sweep_${commissionId}`. The seam: the transfer
 * moved money, the write that recorded it as `paid` failed, the catch banked a
 * `pending` row instead — indistinguishable from a genuinely-unpaid one — and the
 * sweep re-sent it under the OTHER key, which Stripe reads as a brand-new request.
 * Two real transfers, one commission.
 *
 * These tests walk each failure interleaving with a real in-memory store, so the
 * assertions are about the actual doc state and the actual counter arithmetic, and
 * they pin the invariant that closes the bug: EVERY attempt on a given commission
 * presents the SAME idempotency key — asserted by comparing the key from attempt 2
 * against the key captured from attempt 1, not by matching a hard-coded string.
 */

const { mockConstructEvent, mockSubsRetrieve, mockSubsUpdate, mockSubsCancel, mockTransfersCreate } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockSubsRetrieve: vi.fn(),
  mockSubsUpdate: vi.fn().mockResolvedValue({ id: 'sub_updated' }),
  mockSubsCancel: vi.fn().mockResolvedValue(undefined),
  mockTransfersCreate: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mockConstructEvent };
    subscriptions = { retrieve: mockSubsRetrieve, update: mockSubsUpdate, cancel: mockSubsCancel };
    transfers = { create: mockTransfersCreate };
    customers = { retrieve: vi.fn() };
    charges = { retrieve: vi.fn() };
  },
}));

vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/lib/billing', () => ({
  PLAN_PRICES: { pro: { monthly: 'price_pro_m', yearly: 'price_pro_y' } },
  getPlanFromPriceId: vi.fn(() => 'pro'),
}));

// ── A minimal in-memory Firestore ──────────────────────────────────────────────
// Real enough for what is under test: increments actually accumulate (so a
// negative counter would show up as a negative number, not as an unasserted
// sentinel), single-field `where` filters work, and `doc()` with no argument mints
// an auto-id ref BEFORE anything is written — which is how the commission row's id
// becomes available to key the transfer.
type Data = Record<string, any>;

const { store, hooks } = vi.hoisted(() => ({
  store: new Map<string, Record<string, any>>(),
  // Set to a predicate over a batch's ops to make that commit throw, modelling the
  // Firestore write failure at the heart of the bug. Commits fail atomically —
  // nothing is applied — which is what a real batch does.
  hooks: { failBatchCommit: null as null | ((ops: Array<{ type: string; ref: any; data?: Data }>) => boolean) },
}));

let autoIdSeq = 0;

function applyPatch(base: Data, patch: Data): Data {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && '__increment' in v) out[k] = (out[k] ?? 0) + (v as any).__increment;
    else out[k] = v;
  }
  return out;
}

function makeDocRef(coll: string, id: string): any {
  const path = `${coll}/${id}`;
  return {
    id,
    __coll: coll,
    path,
    get: async () => {
      const d = store.get(path);
      return { exists: !!d, id, data: () => (d ? { ...d } : undefined), ref: makeDocRef(coll, id) };
    },
    set: async (data: Data) => { store.set(path, applyPatch(store.get(path) ?? {}, data)); },
    update: async (data: Data) => {
      if (!store.has(path)) throw new Error(`NOT_FOUND: ${path}`);
      store.set(path, applyPatch(store.get(path)!, data));
    },
    delete: async () => { store.delete(path); },
  };
}

function makeCollection(name: string): any {
  const filters: Array<[string, unknown]> = [];
  const api: any = {
    doc: (id?: string) => makeDocRef(name, id ?? `auto_${++autoIdSeq}`),
    where: (field: string, _op: string, value: unknown) => { filters.push([field, value]); return api; },
    limit: () => api,
    orderBy: () => api,
    get: async () => {
      const docs = [...store.entries()]
        .filter(([p]) => p.startsWith(`${name}/`))
        .map(([p, d]) => {
          const id = p.slice(name.length + 1);
          return { id, data: () => ({ ...d }), ref: makeDocRef(name, id) };
        })
        .filter((d) => filters.every(([f, v]) => d.data()[f] === v));
      return { docs, empty: docs.length === 0, size: docs.length, forEach: (cb: any) => docs.forEach(cb) };
    },
    add: async (data: Data) => {
      const ref = makeDocRef(name, `auto_${++autoIdSeq}`);
      await ref.set(data);
      return ref;
    },
  };
  return api;
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => makeCollection(name),
    batch: () => {
      const ops: Array<{ type: string; ref: any; data?: Data }> = [];
      return {
        set: (ref: any, data: Data) => ops.push({ type: 'set', ref, data }),
        update: (ref: any, data: Data) => ops.push({ type: 'update', ref, data }),
        delete: (ref: any) => ops.push({ type: 'delete', ref }),
        commit: async () => {
          if (hooks.failBatchCommit?.(ops)) throw new Error('simulated Firestore batch failure');
          for (const op of ops) {
            if (op.type === 'set') await op.ref.set(op.data!);
            else if (op.type === 'update') await op.ref.update(op.data!);
            else await op.ref.delete();
          }
        },
      };
    },
  },
  adminAuth: {
    verifyIdToken: vi.fn(),
    getUser: vi.fn().mockResolvedValue({ uid: 'u1', email: 'pastor@grace.org' }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...a: unknown[]) => ({ __arrayUnion: a }),
  },
  getFirestore: vi.fn(),
}));

const { POST: WEBHOOK } = await import('../webhook/route');
const { POST: CRON } = await import('../../affiliate/retry-transfers/route');
const { sweepPendingAffiliateCommissions, affiliateSweepIdempotencyKey } = await import('@/lib/affiliate-payout');

// ── Fixtures ───────────────────────────────────────────────────────────────────

const AMOUNT = 11900;   // $119 pro plan
const COMMISSION = 3570; // flat 30%

function seed(opts: { connectStatus?: string | null } = {}) {
  store.clear();
  store.set('tenants/tenant1', {
    stripeSubscriptionId: 'sub_A',
    ownerId: 'owner1', // NOT the referrer — self-referral guard must not fire
    plan: 'plus',
  });
  store.set('users/refUser', {
    affiliateStripeAccountId: 'acct_ref',
    affiliateConnectStatus: opts.connectStatus === undefined ? 'active' : opts.connectStatus,
    affiliateEarnings: 0,
    affiliatePendingPayouts: 0,
    affiliateReferralCount: 0,
  });
}

function checkoutEvent(eventId: string) {
  mockConstructEvent.mockReturnValue({
    id: eventId,
    type: 'checkout.session.completed',
    data: { object: { subscription: 'sub_A', customer: 'cus_1', amount_total: AMOUNT } },
  });
  mockSubsRetrieve.mockResolvedValue({
    id: 'sub_A',
    metadata: { tenantId: 'tenant1', plan: 'pro', billing: 'monthly', referrerId: 'refUser' },
    current_period_end: 1800000000,
  });
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'valid-sig' },
    body: '{}',
  });
}

/** The single `type: 'initial'` commission row, or undefined. */
function commissionRow(): { id: string; data: Data } | undefined {
  const hit = [...store.entries()].find(
    ([p, d]) => p.startsWith('affiliate_commissions/') && d.type === 'initial',
  );
  return hit ? { id: hit[0].slice('affiliate_commissions/'.length), data: hit[1] } : undefined;
}

function commissionRowCount(): number {
  return [...store.keys()].filter((p) => p.startsWith('affiliate_commissions/')).length;
}

function referrer(): Data {
  return store.get('users/refUser')!;
}

/** The idempotencyKey Stripe was handed on the Nth transfer attempt (0-based). */
function keyOfAttempt(n: number): string {
  return mockTransfersCreate.mock.calls[n][1]?.idempotencyKey;
}

/** Every counter that can be driven negative by a mismatched decrement. */
function expectCountersNeverNegative() {
  expect(referrer().affiliatePendingPayouts).toBeGreaterThanOrEqual(0);
  expect(referrer().affiliateEarnings).toBeGreaterThanOrEqual(0);
  expect(referrer().affiliateReferralCount).toBeGreaterThanOrEqual(0);
}

const sweep = () => sweepPendingAffiliateCommissions({
  stripe: { transfers: { create: mockTransfersCreate } } as any,
  referrerId: 'refUser',
  connectAccountId: 'acct_ref',
});

/** Fail exactly the batch that flips a commission row to `paid`. */
const failThePaidFlip = (ops: Array<{ type: string; data?: Data }>) =>
  ops.some((o) => o.type === 'update' && o.data?.status === 'paid');

beforeEach(() => {
  vi.clearAllMocks();
  autoIdSeq = 0;
  hooks.failBatchCommit = null;
  store.clear();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
  process.env.CRON_SECRET = 'cron_secret';
  mockTransfersCreate.mockResolvedValue({ id: 'tr_original' });
});

// ── Interleaving 1: transfer succeeds, the status write fails ───────────────────
// This is the bug. The affiliate HAS been paid but the row says `pending`.

describe('interleaving: transfer succeeds, the paid-flip write fails', () => {
  it('banks a pending row keyed to the transfer that already went out', async () => {
    seed();
    hooks.failBatchCommit = failThePaidFlip;

    const res = await WEBHOOK(checkoutEvent('evt_1'));
    expect(res.status).toBe(200); // the failure is swallowed, as before

    // Money moved once, keyed off the commission row's id.
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    const row = commissionRow()!;
    expect(keyOfAttempt(0)).toBe(affiliateSweepIdempotencyKey(row.id));

    // The row is `pending` — the paid-flip never landed — and, crucially, its
    // counters match that: the pending total actually contains this commission, so
    // the sweep's later decrement lands on a balance that holds it.
    expect(row.data.status).toBe('pending');
    expect(row.data.stripeTransferId).toBeUndefined();
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(COMMISSION);
    expect(referrer().affiliateReferralCount).toBe(1);
    expectCountersNeverNegative();
  });

  it('a webhook REDELIVERY of the same event moves no money (marker skip)', async () => {
    seed();
    hooks.failBatchCommit = failThePaidFlip;
    await WEBHOOK(checkoutEvent('evt_1'));
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);

    const res = await WEBHOOK(checkoutEvent('evt_1'));
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(commissionRowCount()).toBe(1);
  });

  it('a DISTINCT event for the same subscription moves no money (commission guard)', async () => {
    seed();
    hooks.failBatchCommit = failThePaidFlip;
    await WEBHOOK(checkoutEvent('evt_1'));
    const firstKey = keyOfAttempt(0);

    // A different event id gets past the webhook_events marker, so this is the
    // pre-existing-commission guard doing the work — it must still hold.
    await WEBHOOK(checkoutEvent('evt_2'));
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(commissionRowCount()).toBe(1);
    expect(referrer().affiliateEarnings).toBe(COMMISSION);      // not doubled
    expect(referrer().affiliateReferralCount).toBe(1);          // not doubled
    expect(firstKey).toBe(affiliateSweepIdempotencyKey(commissionRow()!.id));
  });

  it('THE FIX: the sweep re-attempts with the SAME key, so Stripe returns the original transfer', async () => {
    seed();
    hooks.failBatchCommit = failThePaidFlip;
    await WEBHOOK(checkoutEvent('evt_1'));
    const webhookKey = keyOfAttempt(0);

    // Stripe replays an idempotent request by handing back the ORIGINAL transfer.
    hooks.failBatchCommit = null;
    mockTransfersCreate.mockResolvedValue({ id: 'tr_original' });
    const result = await sweep();

    expect(mockTransfersCreate).toHaveBeenCalledTimes(2);
    // The whole point: attempt 2's key is byte-identical to attempt 1's. Under the
    // old `aff_initial_${subscriptionId}` scheme these differed and Stripe issued a
    // SECOND real transfer.
    expect(keyOfAttempt(1)).toBe(webhookKey);
    expect(result).toEqual({ total: 1, swept: 1 });

    // Settled exactly once: one row, `paid`, pointing at the original transfer.
    expect(commissionRowCount()).toBe(1);
    expect(commissionRow()!.data.status).toBe('paid');
    expect(commissionRow()!.data.stripeTransferId).toBe('tr_original');
    expect(referrer().affiliateEarnings).toBe(COMMISSION); // counted once, at earn time
    expect(referrer().affiliatePendingPayouts).toBe(0);    // +1785 then -1785
    expectCountersNeverNegative();
  });

  it('THE FIX: the hourly cron re-attempts with the SAME key too', async () => {
    seed();
    hooks.failBatchCommit = failThePaidFlip;
    await WEBHOOK(checkoutEvent('evt_1'));
    const webhookKey = keyOfAttempt(0);

    // The cron only touches rows older than 5 minutes (it gives the initial
    // transfer time to finish), so age this one past the window.
    const row = commissionRow()!;
    store.set(`affiliate_commissions/${row.id}`, {
      ...row.data,
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    hooks.failBatchCommit = null;
    const res = await CRON(new NextRequest('https://example.com/api/affiliate/retry-transfers', {
      method: 'POST',
      headers: { authorization: 'Bearer cron_secret' },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ retried: 1, failed: 0 }));

    expect(mockTransfersCreate).toHaveBeenCalledTimes(2);
    expect(keyOfAttempt(1)).toBe(webhookKey);
    expect(commissionRow()!.data.status).toBe('paid');
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expectCountersNeverNegative();
  });
});

// ── Interleaving 2: the transfer itself fails ──────────────────────────────────

describe('interleaving: the transfer fails', () => {
  it('leaves the row pending with matching counters, and the sweep retries under the same key', async () => {
    seed();
    mockTransfersCreate.mockRejectedValueOnce(new Error('Stripe 500'));

    const res = await WEBHOOK(checkoutEvent('evt_f'));
    expect(res.status).toBe(200);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    const attemptedKey = keyOfAttempt(0);

    const row = commissionRow()!;
    expect(row.data.status).toBe('pending');
    expect(attemptedKey).toBe(affiliateSweepIdempotencyKey(row.id));
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(COMMISSION);

    // Retry succeeds — same key. (Nothing moved the first time, so Stripe treats
    // this as the first real request; the key costs nothing when it is not a replay.)
    mockTransfersCreate.mockResolvedValue({ id: 'tr_retry' });
    await sweep();
    expect(keyOfAttempt(1)).toBe(attemptedKey);
    expect(commissionRow()!.data.status).toBe('paid');
    expect(commissionRow()!.data.stripeTransferId).toBe('tr_retry');
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expectCountersNeverNegative();
  });
});

// ── Interleaving 3: Connect not active (unchanged behaviour) ───────────────────

describe('interleaving: Connect not active', () => {
  it('banks a pending row and attempts NO transfer', async () => {
    seed({ connectStatus: 'pending' });

    const res = await WEBHOOK(checkoutEvent('evt_nc'));
    expect(res.status).toBe(200);
    expect(mockTransfersCreate).not.toHaveBeenCalled();

    expect(commissionRowCount()).toBe(1);
    expect(commissionRow()!.data.status).toBe('pending');
    expect(commissionRow()!.data.stripeTransferId).toBeUndefined();
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(COMMISSION);
    expect(referrer().affiliateReferralCount).toBe(1);
    expectCountersNeverNegative();
  });

  it('the activation sweep then pays it exactly once', async () => {
    seed({ connectStatus: 'pending' });
    await WEBHOOK(checkoutEvent('evt_nc'));

    await sweep();
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(keyOfAttempt(0)).toBe(affiliateSweepIdempotencyKey(commissionRow()!.id));
    expect(commissionRow()!.data.status).toBe('paid');
    expect(referrer().affiliatePendingPayouts).toBe(0);

    // A second sweep sees no `pending` row at all — the status flip is the outer
    // guard, the idempotency key the inner one.
    const again = await sweep();
    expect(again).toEqual({ total: 0, swept: 0 });
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expectCountersNeverNegative();
  });
});

// ── Interleaving 4: redelivery after a fully successful run ────────────────────

describe('interleaving: redelivery after a fully successful run', () => {
  it('the guard skips: no second row, no second transfer, no double-counted counters', async () => {
    seed();
    await WEBHOOK(checkoutEvent('evt_ok'));

    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(commissionRow()!.data.status).toBe('paid');
    expect(commissionRow()!.data.stripeTransferId).toBe('tr_original');
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(0); // +1785 then -1785 in one batch
    expect(referrer().affiliateReferralCount).toBe(1);

    // Distinct event id → past the marker, into the commission guard.
    const res = await WEBHOOK(checkoutEvent('evt_ok2'));
    expect(res.status).toBe(200);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(commissionRowCount()).toBe(1);
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expect(referrer().affiliateReferralCount).toBe(1);
    expectCountersNeverNegative();
  });

  it('a sweep after full success finds nothing to do', async () => {
    seed();
    await WEBHOOK(checkoutEvent('evt_ok'));
    const result = await sweep();
    expect(result).toEqual({ total: 0, swept: 0 });
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expectCountersNeverNegative();
  });
});

// ── The record-first ordering itself ──────────────────────────────────────────

describe('record-before-pay ordering', () => {
  it('writes the pending row BEFORE calling Stripe, so no transfer can be unrecorded', async () => {
    seed();
    let rowAtTransferTime: Data | undefined;
    mockTransfersCreate.mockImplementation(async () => {
      rowAtTransferTime = commissionRow()?.data;
      return { id: 'tr_original' };
    });

    await WEBHOOK(checkoutEvent('evt_order'));

    // The row already existed when Stripe was called — that durability is what
    // makes the shared key derivable by every later attempt.
    expect(rowAtTransferTime).toMatchObject({ status: 'pending', commission: COMMISSION, type: 'initial' });
    expect(rowAtTransferTime?.stripeTransferId).toBeUndefined();
  });

  it('does not bump the referral count when the row itself fails to commit', async () => {
    seed();
    // Fail the record batch: the row and the counters are one atomic write, so
    // neither lands and the redelivered event re-runs from a clean slate.
    hooks.failBatchCommit = (ops) => ops.some((o) => o.type === 'set' && o.data?.type === 'initial');

    const res = await WEBHOOK(checkoutEvent('evt_norow'));
    expect(res.status).toBe(500); // outer catch → marker undone → Stripe redelivers

    expect(mockTransfersCreate).not.toHaveBeenCalled(); // nothing paid without a record
    expect(commissionRowCount()).toBe(0);
    expect(referrer().affiliateEarnings).toBe(0);
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expect(referrer().affiliateReferralCount).toBe(0);

    // …and the redelivery (marker was undone) completes normally, exactly once.
    hooks.failBatchCommit = null;
    await WEBHOOK(checkoutEvent('evt_norow'));
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(commissionRowCount()).toBe(1);
    expect(commissionRow()!.data.status).toBe('paid');
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expect(referrer().affiliateReferralCount).toBe(1);
    expectCountersNeverNegative();
  });
});
