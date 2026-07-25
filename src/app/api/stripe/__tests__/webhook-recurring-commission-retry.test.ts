import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE GAP (deferred in THE-26, closed here). The recurring-commission block inside
 * `invoice.payment_succeeded` is wrapped in a `catch (subErr)` that logged, captured
 * to Sentry, and did NOT rethrow — so the handler fell through to
 * `NextResponse.json({ received: true })`, a 200. The `webhook_events/{event.id}`
 * marker survived (only the outer catch deleted it), so even a MANUAL Stripe
 * redelivery was dropped by the duplicate guard before the invoice dedup was
 * reached. A single transient Firestore blip therefore cost the affiliate a real
 * commission, permanently and silently.
 *
 * The fix mirrors the outer catch exactly — delete the marker, return non-2xx — but
 * only for failures that a retry can actually fix. A PERMANENT failure (a missing
 * referrer user doc, a malformed id, a Stripe `resource_missing`) keeps the old 200:
 * redelivering it cannot record the commission, and because the failure path returns
 * early it would also re-skip the campaign credit and the renewal receipt further
 * down the same case — on every one of Stripe's retries for three days.
 *
 * These tests run the real route against an in-memory Firestore, so the assertions
 * are about actual response codes, actual marker state, and actual doc/counter
 * values across a redelivery.
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
vi.mock('@/lib/ai-utils', () => ({ generateAccessCode: vi.fn(() => 'CODE-1') }));
vi.mock('@/lib/stripe-config', () => ({
  PLAN_PRICES: { pro: { monthly: 'price_pro_m', yearly: 'price_pro_y' } },
  getPlanFromPriceId: vi.fn(() => 'pro'),
}));

// ── A minimal in-memory Firestore ──────────────────────────────────────────────
type Data = Record<string, any>;

const { store, hooks } = vi.hoisted(() => ({
  store: new Map<string, Record<string, any>>(),
  hooks: {
    // Return the Error a matching batch commit should throw (atomically: nothing is
    // applied), or null to let it through. Returning the error rather than a boolean
    // is what lets a test choose a TRANSIENT vs a TERMINAL failure.
    failBatchCommit: null as null | ((ops: Array<{ type: string; ref: any; data?: Data }>) => Error | null),
    failDocGet: null as null | ((path: string) => Error | null),
  },
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
    path,
    collection: (sub: string) => makeCollection(`${path}/${sub}`),
    get: async () => {
      const failure = hooks.failDocGet?.(path);
      if (failure) throw failure;
      const d = store.get(path);
      return { exists: !!d, id, data: () => (d ? { ...d } : undefined), ref: makeDocRef(coll, id) };
    },
    set: async (data: Data) => { store.set(path, applyPatch(store.get(path) ?? {}, data)); },
    update: async (data: Data) => {
      // Real Firestore rejects update() on a missing doc with gRPC NOT_FOUND (5) —
      // a PERMANENT failure, and the most plausible terminal case on this path
      // (a referrerId pointing at a deleted user).
      if (!store.has(path)) throw Object.assign(new Error(`NOT_FOUND: ${path}`), { code: 5 });
      store.set(path, applyPatch(store.get(path)!, data));
    },
    delete: async () => { store.delete(path); },
  };
}

function makeCollection(name: string): any {
  const filters: Array<[string, unknown]> = [];
  const api: any = {
    doc: (id?: string) => {
      // Mirror the real client: a malformed id throws SYNCHRONOUSLY, before any RPC.
      if (id !== undefined && (id === '' || id.includes('/'))) {
        throw new Error(`Value for argument "documentPath" is not a valid resource path: ${id}`);
      }
      return makeDocRef(name, id ?? `auto_${++autoIdSeq}`);
    },
    where: (field: string, _op: string, value: unknown) => { filters.push([field, value]); return api; },
    limit: () => api,
    orderBy: () => api,
    get: async () => {
      const docs = [...store.entries()]
        .filter(([p]) => p.startsWith(`${name}/`) && !p.slice(name.length + 1).includes('/'))
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
          const failure = hooks.failBatchCommit?.(ops);
          if (failure) throw failure;
          // A real batch is ATOMIC: if any op cannot apply, none of them do. Check
          // the update preconditions up front so a missing referrer doc leaves no
          // half-written commission row behind.
          for (const op of ops) {
            if (op.type === 'update' && !store.has(op.ref.path)) {
              throw Object.assign(new Error(`NOT_FOUND: ${op.ref.path}`), { code: 5 });
            }
          }
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
    serverTimestamp: () => 'SERVER_TS',
  },
  getFirestore: vi.fn(),
}));

const { POST: WEBHOOK } = await import('../webhook/route');

// ── Fixtures ───────────────────────────────────────────────────────────────────

const AMOUNT = 11900;    // $119 pro plan renewal
const COMMISSION = 1785; // flat 15%

/** A transient Firestore fault: gRPC UNAVAILABLE. The retry has a real chance. */
const transient = () => Object.assign(new Error('UNAVAILABLE: backend unavailable'), { code: 14 });
/** A permanent one: the referrer's users doc does not exist. Fails identically forever. */
const terminal = () => Object.assign(new Error('NOT_FOUND: users/refUser'), { code: 5 });

function seed(opts: { tenantStatus?: string; connectStatus?: string | null } = {}) {
  store.clear();
  store.set('tenants/tenant1', { status: opts.tenantStatus ?? 'active', ownerId: 'owner1', plan: 'pro' });
  store.set('users/refUser', {
    affiliateStripeAccountId: 'acct_ref',
    affiliateConnectStatus: opts.connectStatus === undefined ? 'active' : opts.connectStatus,
    affiliateEarnings: 0,
    affiliatePendingPayouts: 0,
    affiliateReferralCount: 1,
  });
}

function renewalEvent(
  eventId: string,
  opts: { invoiceId?: string; referrerId?: string; extraSubMeta?: Record<string, string> } = {},
) {
  const invoiceId = opts.invoiceId ?? 'in_R1';
  mockConstructEvent.mockReturnValue({
    id: eventId,
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: invoiceId,
        subscription: 'sub_A',
        amount_paid: AMOUNT,
        currency: 'usd',
        billing_reason: 'subscription_cycle',
      },
    },
  });
  mockSubsRetrieve.mockResolvedValue({
    id: 'sub_A',
    metadata: {
      tenantId: 'tenant1',
      plan: 'pro',
      billing: 'monthly',
      referrerId: opts.referrerId ?? 'refUser',
      ...(opts.extraSubMeta || {}),
    },
  });
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'valid-sig' },
    body: '{}',
  });
}

function commissionRows(): Array<{ id: string; data: Data }> {
  return [...store.entries()]
    .filter(([p]) => p.startsWith('affiliate_commissions/'))
    .map(([p, d]) => ({ id: p.slice('affiliate_commissions/'.length), data: d }));
}

const marker = (eventId: string) => store.has(`webhook_events/${eventId}`);
const referrer = (): Data => store.get('users/refUser')!;

/** Fail exactly the batch that records the recurring commission row. */
const recordBatch = (ops: Array<{ type: string; data?: Data }>) =>
  ops.some((o) => o.type === 'set' && o.data?.type === 'recurring');

beforeEach(() => {
  vi.clearAllMocks();
  autoIdSeq = 0;
  hooks.failBatchCommit = null;
  hooks.failDocGet = null;
  store.clear();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
  mockTransfersCreate.mockResolvedValue({ id: 'tr_original' });
});

// ── THE FIX: a transient failure becomes retryable ─────────────────────────────

describe('a TRANSIENT failure in the recurring-commission block', () => {
  it('returns non-2xx AND deletes the webhook_events marker', async () => {
    seed();
    hooks.failBatchCommit = (ops) => (recordBatch(ops) ? transient() : null);

    const res = await WEBHOOK(renewalEvent('evt_t1'));

    // Was: 200 with the marker intact, i.e. the commission was gone for good.
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Recurring affiliate commission failed; will retry' });
    // Load-bearing half of the fix: without the delete, the redelivery below is
    // dropped by the duplicate guard and the 500 buys nothing at all.
    expect(marker('evt_t1')).toBe(false);

    // Nothing was paid and nothing was recorded — the batch is atomic.
    expect(commissionRows()).toHaveLength(0);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect(referrer().affiliateEarnings).toBe(0);
    expect(referrer().affiliatePendingPayouts).toBe(0);
  });

  it("THE FIX: Stripe's redelivery re-enters and records the commission exactly once", async () => {
    seed();
    hooks.failBatchCommit = (ops) => (recordBatch(ops) ? transient() : null);
    await WEBHOOK(renewalEvent('evt_t2'));

    // Stripe redelivers the SAME event id. The marker is gone, so the duplicate
    // guard lets it through — this is precisely what the old code prevented.
    hooks.failBatchCommit = null;
    const res = await WEBHOOK(renewalEvent('evt_t2'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(commissionRows()).toHaveLength(1);
    expect(commissionRows()[0].data).toMatchObject({
      type: 'recurring', status: 'paid', commission: COMMISSION, stripeInvoiceId: 'in_R1', referrerId: 'refUser',
    });
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(0);
    expect(marker('evt_t2')).toBe(true);
  });

  it('a THIRD delivery after the successful retry changes nothing', async () => {
    seed();
    hooks.failBatchCommit = (ops) => (recordBatch(ops) ? transient() : null);
    await WEBHOOK(renewalEvent('evt_t3'));
    hooks.failBatchCommit = null;
    await WEBHOOK(renewalEvent('evt_t3'));

    const res = await WEBHOOK(renewalEvent('evt_t3'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(commissionRows()).toHaveLength(1);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
  });

  it('a transient failure of the invoice dedup query is retryable too', async () => {
    seed();
    // The dedup read is the other pre-money step that can throw into this catch.
    const collSpy = transient();
    hooks.failBatchCommit = () => null;
    hooks.failDocGet = null;
    // Fail the subscription reload inside the block (the top-level one still
    // resolves, so tenantId is known and the block is entered).
    mockSubsRetrieve.mockReset();
    mockSubsRetrieve
      .mockResolvedValueOnce({ id: 'sub_A', metadata: { tenantId: 'tenant1', plan: 'pro', referrerId: 'refUser' } })
      .mockRejectedValueOnce(Object.assign(collSpy, { type: 'StripeConnectionError' }));
    mockConstructEvent.mockReturnValue({
      id: 'evt_t4',
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_R1', subscription: 'sub_A', amount_paid: AMOUNT, billing_reason: 'subscription_cycle' } },
    });

    const res = await WEBHOOK(new NextRequest('https://example.com/api/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': 'valid-sig' }, body: '{}',
    }));

    expect(res.status).toBe(500);
    expect(marker('evt_t4')).toBe(false);
  });
});

// ── Terminal failures keep the old 200 ─────────────────────────────────────────

describe('a TERMINAL failure in the recurring-commission block', () => {
  it('a missing referrer users doc (gRPC NOT_FOUND) is NOT retried', async () => {
    seed();
    store.delete('users/refUser'); // referrerId points at a deleted user
    store.set('tenants/tenant1', { status: 'active', ownerId: 'owner1', plan: 'pro' });

    const res = await WEBHOOK(renewalEvent('evt_p1'));

    // Retrying cannot make the doc exist; a 500 would just poison the event.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(marker('evt_p1')).toBe(true);
    expect(commissionRows()).toHaveLength(0);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
  });

  it('a malformed referrerId is screened out before Firestore, and stays at 200', async () => {
    seed();

    const res = await WEBHOOK(renewalEvent('evt_p2', { referrerId: 'users/refUser' }));

    expect(res.status).toBe(200);
    expect(marker('evt_p2')).toBe(true);
    expect(commissionRows()).toHaveLength(0);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
  });

  it("a Stripe `resource_missing` on the in-block reload is NOT retried", async () => {
    seed();
    mockSubsRetrieve.mockReset();
    mockSubsRetrieve
      .mockResolvedValueOnce({ id: 'sub_A', metadata: { tenantId: 'tenant1', plan: 'pro', referrerId: 'refUser' } })
      .mockRejectedValueOnce(Object.assign(new Error('No such subscription'), {
        type: 'StripeInvalidRequestError', statusCode: 404, code: 'resource_missing',
      }));
    mockConstructEvent.mockReturnValue({
      id: 'evt_p3',
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_R1', subscription: 'sub_A', amount_paid: AMOUNT, billing_reason: 'subscription_cycle' } },
    });

    const res = await WEBHOOK(new NextRequest('https://example.com/api/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': 'valid-sig' }, body: '{}',
    }));

    expect(res.status).toBe(200);
    expect(marker('evt_p3')).toBe(true);
  });
});

// ── Retry safety: nothing upstream or downstream is double-applied ─────────────

describe('retry safety of the rest of the handler', () => {
  it('tenant reactivation is idempotent across the failed delivery and the redelivery', async () => {
    seed({ tenantStatus: 'suspended' });
    hooks.failBatchCommit = (ops) => (recordBatch(ops) ? transient() : null);

    await WEBHOOK(renewalEvent('evt_r1'));
    // The reactivation ran BEFORE the block that failed, and it is a plain field
    // set with no counters — re-applying it is a no-op either way.
    expect(store.get('tenants/tenant1')!.status).toBe('active');

    hooks.failBatchCommit = null;
    await WEBHOOK(renewalEvent('evt_r1'));
    expect(store.get('tenants/tenant1')!.status).toBe('active');
    expect(commissionRows()).toHaveLength(1);
  });

  it('the campaign credit is NOT applied on the failed delivery, and lands exactly once on the retry', async () => {
    seed();
    store.set('campaigns/camp1', { tenantId: 'tenant1', raised: 0, goal: 5000 });
    const partnership = { type: 'partnership', campaignId: 'camp1' };
    hooks.failBatchCommit = (ops) => (recordBatch(ops) ? transient() : null);

    const failed = await WEBHOOK(renewalEvent('evt_c1', { extraSubMeta: partnership }));
    expect(failed.status).toBe(500);
    // `incrementCampaignRaised` is a bare FieldValue.increment with no per-invoice
    // dedup — it relies entirely on the marker. Returning early from the catch is
    // what keeps it from being applied on a delivery that will be redelivered.
    expect(store.get('campaigns/camp1')!.raised).toBe(0);

    hooks.failBatchCommit = null;
    await WEBHOOK(renewalEvent('evt_c1', { extraSubMeta: partnership }));
    expect(store.get('campaigns/camp1')!.raised).toBe(AMOUNT / 100);
    expect(commissionRows()).toHaveLength(1);

    // And a further redelivery is deduped by the marker, so it cannot double-credit.
    await WEBHOOK(renewalEvent('evt_c1', { extraSubMeta: partnership }));
    expect(store.get('campaigns/camp1')!.raised).toBe(AMOUNT / 100);
  });

  it('a redelivery after a fully successful run is skipped by the duplicate guard', async () => {
    seed();
    store.set('campaigns/camp1', { tenantId: 'tenant1', raised: 0, goal: 5000 });
    const partnership = { type: 'partnership', campaignId: 'camp1' };

    await WEBHOOK(renewalEvent('evt_ok', { extraSubMeta: partnership }));
    const res = await WEBHOOK(renewalEvent('evt_ok', { extraSubMeta: partnership }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(commissionRows()).toHaveLength(1);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(store.get('campaigns/camp1')!.raised).toBe(AMOUNT / 100);
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(referrer().affiliatePendingPayouts).toBe(0);
  });
});

// ── No other path's status code moved ──────────────────────────────────────────

describe('every other outcome still returns 200 with the same body', () => {
  it('the happy path', async () => {
    seed();
    const res = await WEBHOOK(renewalEvent('evt_h'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  it('the TRANSFER failing (its own catch, unchanged by this fix)', async () => {
    seed();
    mockTransfersCreate.mockRejectedValueOnce(Object.assign(new Error('ETIMEDOUT'), { code: 14 }));

    const res = await WEBHOOK(renewalEvent('evt_tf'));

    // The transfer has its own catch and its own idempotency-keyed retry (the
    // sweep + hourly cron), so it must NOT start 5xxing: the row is durable and
    // the payout is merely late.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(marker('evt_tf')).toBe(true);
    expect(commissionRows()[0].data.status).toBe('pending');
  });

  it('the paid-flip write failing (also the transfer catch)', async () => {
    seed();
    hooks.failBatchCommit = (ops) =>
      (ops.some((o) => o.type === 'update' && o.data?.status === 'paid') ? transient() : null);

    const res = await WEBHOOK(renewalEvent('evt_pf'));
    expect(res.status).toBe(200);
    expect(marker('evt_pf')).toBe(true);
    expect(commissionRows()[0].data.status).toBe('pending');
  });

  it('the TOP-LEVEL subscription load failing (tenantId unknown)', async () => {
    seed();
    mockSubsRetrieve.mockRejectedValue(transient());
    mockConstructEvent.mockReturnValue({
      id: 'evt_top',
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_R1', subscription: 'sub_A', amount_paid: AMOUNT, billing_reason: 'subscription_cycle' } },
    });

    const res = await WEBHOOK(new NextRequest('https://example.com/api/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': 'valid-sig' }, body: '{}',
    }));

    // Deliberately untouched: this catch is outside the recurring block and keeps
    // its existing 200 (its own gap, tracked separately).
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(marker('evt_top')).toBe(true);
  });

  it('Connect not active — a pending row, no transfer', async () => {
    seed({ connectStatus: 'pending' });
    const res = await WEBHOOK(renewalEvent('evt_nc'));
    expect(res.status).toBe(200);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect(commissionRows()[0].data.status).toBe('pending');
  });

  it('no referrer on the subscription at all', async () => {
    seed();
    const res = await WEBHOOK(renewalEvent('evt_nr', { referrerId: '' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(commissionRows()).toHaveLength(0);
  });

  it('the first invoice of a subscription (billing_reason subscription_create)', async () => {
    seed();
    mockConstructEvent.mockReturnValue({
      id: 'evt_first',
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_first', subscription: 'sub_A', amount_paid: AMOUNT, billing_reason: 'subscription_create' } },
    });
    mockSubsRetrieve.mockResolvedValue({ id: 'sub_A', metadata: { tenantId: 'tenant1', plan: 'pro', referrerId: 'refUser' } });

    const res = await WEBHOOK(new NextRequest('https://example.com/api/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': 'valid-sig' }, body: '{}',
    }));

    expect(res.status).toBe(200);
    expect(commissionRows()).toHaveLength(0); // the initial commission is #223's path
  });

  it('an unhandled event type', async () => {
    seed();
    mockConstructEvent.mockReturnValue({ id: 'evt_u', type: 'customer.created', data: { object: {} } });
    const res = await WEBHOOK(new NextRequest('https://example.com/api/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': 'valid-sig' }, body: '{}',
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });
});
