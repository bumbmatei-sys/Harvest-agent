import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The RECURRING affiliate commission (invoice.payment_succeeded) had two money
 * defects, the sibling of the initial-path bug #223 fixed.
 *
 * A. The transfer carried NO idempotency key at all — `stripe.transfers.create`
 *    was called with no options argument. A request that SUCCEEDED at Stripe and
 *    then timed out on the response hit the catch, which banked a `pending` row
 *    indistinguishable from a genuinely unpaid one; the sweep then re-sent it
 *    under `aff_sweep_${docId}`. A key Stripe has never seen is a brand-new
 *    request: two real transfers for one renewal.
 *
 * B. A successful transfer could leave NO record. The commission row was written
 *    after the transfer, and a failure there throws past the block to
 *    `catch (subErr)`, which logs and does NOT rethrow — so the handler returns
 *    200 with the webhook_events marker intact. Money left the platform with no
 *    commission doc, no counter, and no retry.
 *
 * Both close the same way: record first, key the transfer off the row's id.
 * These tests walk each interleaving against a real in-memory store, so the
 * assertions are about actual doc state and actual counter arithmetic, and the
 * key invariant is pinned by comparing attempt 2's key to the key CAPTURED from
 * attempt 1 rather than to a hard-coded string.
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
// Same shape as the initial-path double-pay suite: increments actually accumulate
// (so a negative counter shows up as a negative number rather than an unasserted
// sentinel), single-field `where` filters work, and `doc()` with no argument mints
// an auto-id ref BEFORE anything is written — which is how the commission row's id
// becomes available to key the transfer.
type Data = Record<string, any>;

const { store, hooks } = vi.hoisted(() => ({
  store: new Map<string, Record<string, any>>(),
  // Set to a predicate over a batch's ops to make that commit throw, modelling the
  // Firestore write failure at the heart of both bugs. Commits fail atomically —
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

const AMOUNT = 11900;    // $119 pro plan renewal
const COMMISSION = 1785; // flat 15%

function seed(opts: { connectStatus?: string | null } = {}) {
  store.clear();
  store.set('tenants/tenant1', { status: 'active', ownerId: 'owner1', plan: 'pro' });
  store.set('users/refUser', {
    affiliateStripeAccountId: 'acct_ref',
    affiliateConnectStatus: opts.connectStatus === undefined ? 'active' : opts.connectStatus,
    affiliateEarnings: 0,
    affiliatePendingPayouts: 0,
    affiliateReferralCount: 1, // the referral itself was counted on the initial commission
  });
}

/**
 * A renewal invoice for a referred tenant. `invoiceId` distinct from `eventId` on
 * purpose: the webhook_events marker keys on the event, the commission dedup guard
 * keys on the INVOICE, and the two guards have to be exercised independently.
 */
function renewalEvent(eventId: string, invoiceId = 'in_R1', amountPaid = AMOUNT) {
  mockConstructEvent.mockReturnValue({
    id: eventId,
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: invoiceId,
        subscription: 'sub_A',
        amount_paid: amountPaid,
        currency: 'usd',
        billing_reason: 'subscription_cycle',
      },
    },
  });
  mockSubsRetrieve.mockResolvedValue({
    id: 'sub_A',
    metadata: { tenantId: 'tenant1', plan: 'pro', billing: 'monthly', referrerId: 'refUser' },
  });
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'valid-sig' },
    body: '{}',
  });
}

/** The single `type: 'recurring'` commission row, or undefined. */
function commissionRow(): { id: string; data: Data } | undefined {
  const hit = [...store.entries()].find(
    ([p, d]) => p.startsWith('affiliate_commissions/') && d.type === 'recurring',
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

/** Every counter that a mismatched decrement could drive negative. */
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

/** Fail exactly the batch that records the recurring commission row. */
const failTheRecord = (ops: Array<{ type: string; data?: Data }>) =>
  ops.some((o) => o.type === 'set' && o.data?.type === 'recurring');

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

// ── BUG A: the transfer succeeds but the response never arrives ────────────────
// The defining failure mode. The old code sent this transfer with no options
// argument at all, so there was nothing for a retry to collapse onto.

describe('BUG A — transfer succeeds, response times out', () => {
  it('the recurring transfer is keyed at all, with the shared per-commission key', async () => {
    seed();

    await WEBHOOK(renewalEvent('evt_r1'));

    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    // The old call site passed ONE argument. An options object must exist and must
    // carry the key derived from the row that was written before the transfer.
    expect(mockTransfersCreate.mock.calls[0][1]).toBeDefined();
    expect(keyOfAttempt(0)).toBe(affiliateSweepIdempotencyKey(commissionRow()!.id));
  });

  it('a timed-out success banks a pending row whose key matches the money already sent', async () => {
    seed();
    // Stripe took the request and moved the money; the response never came back.
    mockTransfersCreate.mockRejectedValueOnce(Object.assign(new Error('ETIMEDOUT'), { type: 'StripeConnectionError' }));

    const res = await WEBHOOK(renewalEvent('evt_r2'));
    expect(res.status).toBe(200);

    const row = commissionRow()!;
    expect(row.data.status).toBe('pending');
    expect(row.data.stripeTransferId).toBeUndefined();
    // The row is durable and the attempted key is derived from it, so the retry
    // paths can reproduce the exact key of the transfer that may already exist.
    expect(keyOfAttempt(0)).toBe(affiliateSweepIdempotencyKey(row.id));
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(COMMISSION);
    expectCountersNeverNegative();
  });

  it('THE FIX: the sweep re-attempts with the SAME key, so Stripe returns the original transfer', async () => {
    seed();
    mockTransfersCreate.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await WEBHOOK(renewalEvent('evt_r3'));
    const webhookKey = keyOfAttempt(0);

    // Stripe replays an idempotent request by handing back the ORIGINAL transfer —
    // the one the timed-out call actually created.
    mockTransfersCreate.mockResolvedValue({ id: 'tr_original' });
    const result = await sweep();

    expect(mockTransfersCreate).toHaveBeenCalledTimes(2);
    // The whole point of the fix: attempt 2's key is byte-identical to attempt 1's.
    // Unkeyed, attempt 1 had no key at all and Stripe issued a SECOND real transfer.
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
    mockTransfersCreate.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await WEBHOOK(renewalEvent('evt_r4'));
    const webhookKey = keyOfAttempt(0);

    // The cron only touches rows older than 5 minutes, so age this one past it.
    const row = commissionRow()!;
    store.set(`affiliate_commissions/${row.id}`, {
      ...row.data,
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    mockTransfersCreate.mockResolvedValue({ id: 'tr_original' });
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

  it('the paid-flip failing is the same story: one key, one transfer, settled once', async () => {
    seed();
    hooks.failBatchCommit = failThePaidFlip;

    await WEBHOOK(renewalEvent('evt_r5'));
    const webhookKey = keyOfAttempt(0);
    expect(commissionRow()!.data.status).toBe('pending');
    expect(referrer().affiliatePendingPayouts).toBe(COMMISSION);

    hooks.failBatchCommit = null;
    await sweep();
    expect(keyOfAttempt(1)).toBe(webhookKey);
    expect(commissionRowCount()).toBe(1);
    expect(commissionRow()!.data.status).toBe('paid');
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expectCountersNeverNegative();
  });
});

// ── BUG B: a successful transfer leaving no record ─────────────────────────────

describe('BUG B — the row can no longer be missing after money moves', () => {
  it('writes the pending row BEFORE calling Stripe', async () => {
    seed();
    let rowAtTransferTime: Data | undefined;
    mockTransfersCreate.mockImplementation(async () => {
      rowAtTransferTime = commissionRow()?.data;
      return { id: 'tr_original' };
    });

    await WEBHOOK(renewalEvent('evt_order'));

    // The row already existed when Stripe was called. That durability is both what
    // makes an unrecorded payment impossible and what lets every later attempt
    // derive the same key.
    expect(rowAtTransferTime).toMatchObject({
      status: 'pending', commission: COMMISSION, type: 'recurring', stripeInvoiceId: 'in_R1',
    });
    expect(rowAtTransferTime?.stripeTransferId).toBeUndefined();
  });

  it('a failing record commit pays nothing and leaves no trace (was: money gone, no record)', async () => {
    seed();
    hooks.failBatchCommit = failTheRecord;

    const res = await WEBHOOK(renewalEvent('evt_norow'));
    // #224 moved the throw to BEFORE any money moves; THE-26 then made that throw
    // retryable. A simulated Firestore fault is transient by default, so
    // `catch (subErr)` now undoes the idempotency marker and 5xxs instead of
    // swallowing at 200 — Stripe redelivers and the commission is recorded on the
    // retry. (Full coverage of that behaviour lives in
    // webhook-recurring-commission-retry.test.ts.)
    expect(res.status).toBe(500);
    expect(store.has('webhook_events/evt_norow')).toBe(false);

    expect(mockTransfersCreate).not.toHaveBeenCalled(); // nothing paid without a record
    expect(commissionRowCount()).toBe(0);
    // The row and the counters are one atomic batch, so neither landed.
    expect(referrer().affiliateEarnings).toBe(0);
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expectCountersNeverNegative();
  });

  it('every interleaving that moves money leaves a row that accounts for it', async () => {
    // Exhaustive over the write that can fail around the transfer. In each case:
    // if Stripe was called, a commission row exists whose counters reconcile.
    const cases: Array<[string, null | typeof failThePaidFlip]> = [
      ['nothing fails', null],
      ['the paid-flip fails', failThePaidFlip],
      ['the record fails', failTheRecord],
    ];

    for (const [label, hook] of cases) {
      seed();
      vi.clearAllMocks();
      mockTransfersCreate.mockResolvedValue({ id: 'tr_original' });
      hooks.failBatchCommit = hook;

      await WEBHOOK(renewalEvent(`evt_x_${label.replace(/\s/g, '_')}`));

      if (mockTransfersCreate.mock.calls.length > 0) {
        const row = commissionRow();
        expect(row, `money moved with no row (${label})`).toBeDefined();
        // Pending counter and row status agree: `paid` → already decremented,
        // `pending` → still held, and the transfer's key is derivable from the row.
        const expectedPending = row!.data.status === 'paid' ? 0 : COMMISSION;
        expect(referrer().affiliatePendingPayouts, label).toBe(expectedPending);
        expect(referrer().affiliateEarnings, label).toBe(COMMISSION);
        expect(keyOfAttempt(0)).toBe(affiliateSweepIdempotencyKey(row!.id));
      }
      expectCountersNeverNegative();
    }
  });
});

// ── Connect inactive (unchanged behaviour) ─────────────────────────────────────

describe('Connect not active', () => {
  it('banks a pending row and attempts NO transfer', async () => {
    seed({ connectStatus: 'pending' });

    const res = await WEBHOOK(renewalEvent('evt_nc'));
    expect(res.status).toBe(200);
    expect(mockTransfersCreate).not.toHaveBeenCalled();

    expect(commissionRowCount()).toBe(1);
    const row = commissionRow()!;
    expect(row.data.status).toBe('pending');
    expect(row.data.type).toBe('recurring');
    expect(row.data.stripeInvoiceId).toBe('in_R1');
    expect(row.data.stripeTransferId).toBeUndefined();
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(COMMISSION);
    // A renewal is not a new referral.
    expect(referrer().affiliateReferralCount).toBe(1);
    expectCountersNeverNegative();
  });

  it('the activation sweep then pays it exactly once', async () => {
    seed({ connectStatus: 'pending' });
    await WEBHOOK(renewalEvent('evt_nc'));

    await sweep();
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(keyOfAttempt(0)).toBe(affiliateSweepIdempotencyKey(commissionRow()!.id));
    expect(commissionRow()!.data.status).toBe('paid');
    expect(referrer().affiliatePendingPayouts).toBe(0);

    const again = await sweep();
    expect(again).toEqual({ total: 0, swept: 0 });
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expectCountersNeverNegative();
  });
});

// ── The transfer failing outright ──────────────────────────────────────────────

describe('the transfer fails outright', () => {
  it('leaves the row pending with matching counters; the sweep retries under the same key', async () => {
    seed();
    mockTransfersCreate.mockRejectedValueOnce(new Error('insufficient funds'));

    const res = await WEBHOOK(renewalEvent('evt_f'));
    expect(res.status).toBe(200);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    const attemptedKey = keyOfAttempt(0);

    const row = commissionRow()!;
    expect(row.data.status).toBe('pending');
    expect(attemptedKey).toBe(affiliateSweepIdempotencyKey(row.id));
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(COMMISSION);

    // Nothing moved the first time, so Stripe treats the retry as the first real
    // request; the shared key costs nothing when it is not a replay.
    mockTransfersCreate.mockResolvedValue({ id: 'tr_retry' });
    await sweep();
    expect(keyOfAttempt(1)).toBe(attemptedKey);
    expect(commissionRow()!.data.status).toBe('paid');
    expect(commissionRow()!.data.stripeTransferId).toBe('tr_retry');
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expectCountersNeverNegative();
  });
});

// ── The dedup guard stays invoice-scoped ───────────────────────────────────────

describe('the dedup guard is per-INVOICE, and doc-first ordering keeps it working', () => {
  it('a redelivered invoice after a full success: no second doc, no second transfer', async () => {
    seed();
    await WEBHOOK(renewalEvent('evt_ok', 'in_R1'));

    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(commissionRow()!.data.status).toBe('paid');
    expect(commissionRow()!.data.stripeTransferId).toBe('tr_original');
    expect(referrer().affiliatePendingPayouts).toBe(0);

    // A DISTINCT event id for the SAME invoice gets past the webhook_events marker,
    // so this is the `stripeInvoiceId` guard doing the work.
    const res = await WEBHOOK(renewalEvent('evt_ok2', 'in_R1'));
    expect(res.status).toBe(200);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(commissionRowCount()).toBe(1);
    expect(referrer().affiliateEarnings).toBe(COMMISSION); // not doubled
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expectCountersNeverNegative();
  });

  it('the guard fires even when the first run only got as far as the pending row', async () => {
    seed();
    // Doc-first means the row — and its stripeInvoiceId — exists before the money
    // moves, so a redelivery finds it even on a run that never reached `paid`.
    mockTransfersCreate.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await WEBHOOK(renewalEvent('evt_p1', 'in_R1'));
    expect(commissionRow()!.data.status).toBe('pending');

    await WEBHOOK(renewalEvent('evt_p2', 'in_R1'));
    // Skipped: retrying the payout belongs to the keyed sweep, not to a second
    // webhook delivery that would bank a second row and a second earnings bump.
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(commissionRowCount()).toBe(1);
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(COMMISSION);
    expectCountersNeverNegative();
  });

  it('is NOT subscription-scoped: the NEXT renewal on the same subscription earns its own commission', async () => {
    seed();
    await WEBHOOK(renewalEvent('evt_m1', 'in_R1'));
    await WEBHOOK(renewalEvent('evt_m2', 'in_R2'));

    // Two invoices, two commissions, two transfers — each keyed to its own row.
    expect(commissionRowCount()).toBe(2);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(2);
    expect(keyOfAttempt(0)).not.toBe(keyOfAttempt(1));
    expect(referrer().affiliateEarnings).toBe(COMMISSION * 2);
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expect(referrer().affiliateReferralCount).toBe(1); // still one referral
    expectCountersNeverNegative();
  });
});

// ── Counter arithmetic, explicitly ─────────────────────────────────────────────
// The paid branch used to read `increment(0)` — correct, because the money had
// already left and pending must not rise. Record-then-pay decomposes that same net
// into +C at record time and -C at pay time. These pin the net per branch.

describe('counter arithmetic per branch', () => {
  it('paid: earnings +C, pending net 0 (+C then -C) — the old increment(0) net, preserved', async () => {
    seed();
    await WEBHOOK(renewalEvent('evt_c1'));
    expect(commissionRow()!.data.status).toBe('paid');
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(0);
  });

  it('pending: earnings +C, pending +C', async () => {
    seed({ connectStatus: 'pending' });
    await WEBHOOK(renewalEvent('evt_c2'));
    expect(commissionRow()!.data.status).toBe('pending');
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(COMMISSION);
  });

  it('a $0 renewal writes a $0 row, attempts no transfer, and moves no counter', async () => {
    seed();
    await WEBHOOK(renewalEvent('evt_c3', 'in_zero', 0));
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect(commissionRow()!.data.commission).toBe(0);
    expect(referrer().affiliateEarnings).toBe(0);
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expectCountersNeverNegative();
  });

  it('pending never goes negative across pay-then-sweep-then-sweep', async () => {
    seed();
    await WEBHOOK(renewalEvent('evt_c4'));
    expect(referrer().affiliatePendingPayouts).toBe(0);
    await sweep(); // row is already `paid`, so the sweep must not decrement again
    await sweep();
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expectCountersNeverNegative();
  });
});
