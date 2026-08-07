import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * AFFILIATE COMMISSIONS END 12 MONTHS AFTER THE REFERRED CHURCH'S SIGNUP.
 *
 * Founder decision: 15% of what each referred church pays, for the first 12 months
 * from their signup — not forever. Before this there was no time dimension in the
 * affiliate code at all, so a referral paid out for as long as Stripe kept charging.
 *
 * These drive the rule END-TO-END through the real webhook handler against an
 * in-memory Firestore (the harness from webhook-recurring-affiliate-idempotency),
 * so the assertions are about actual doc state and actual counter arithmetic.
 *
 * THE FAILURE MODE THESE EXIST FOR is not the extra commission — that one is cheap
 * and visible. It is the commission that SHOULD exist and is silently skipped: an
 * affiliate quietly stopping being paid in month 6 because of a timezone, a missing
 * anchor, or a null date read as expired. So most of this file is about what must
 * STILL pay.
 *
 * Two invariants the cap must not break, pinned below:
 *   - it gates WHETHER a row is created, never a stored `commission` amount
 *     (the legacy 20% row still pays 20%);
 *   - it never touches `affiliateReferralCount`.
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
type Data = Record<string, any>;

const { store } = vi.hoisted(() => ({ store: new Map<string, Record<string, any>>() }));

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
const { addMonthsUtc } = await import('@/lib/affiliate-commission-window');

// ── Fixtures ───────────────────────────────────────────────────────────────────

const AMOUNT = 11900;    // $119 pro plan renewal
const COMMISSION = 1785; // flat 15%

/** Signup: Jan 1 2025 midnight UTC. Window therefore closes Jan 1 2026 midnight UTC. */
const SIGNUP_ISO = '2025-01-01T00:00:00.000Z';
const SIGNUP_MS = Date.parse(SIGNUP_ISO);
const SIGNUP_SECS = Math.floor(SIGNUP_MS / 1000);
const WINDOW_END_ISO = '2026-01-01T00:00:00.000Z';

/** Unix seconds for the start of the Nth month of service (month 1 == the anchor). */
const monthStartSecs = (month: number, anchorMs = SIGNUP_MS) =>
  Math.floor(addMonthsUtc(anchorMs, month - 1) / 1000);

function seed(opts: { connectStatus?: string | null } = {}) {
  store.clear();
  store.set('tenants/tenant1', { status: 'active', ownerId: 'owner1', plan: 'pro' });
  store.set('users/refUser', {
    affiliateStripeAccountId: 'acct_ref',
    affiliateConnectStatus: opts.connectStatus === undefined ? 'active' : opts.connectStatus,
    affiliateEarnings: 0,
    affiliatePendingPayouts: 0,
    affiliateReferralCount: 1, // counted once, on the initial commission
  });
}

/**
 * A renewal invoice for the Nth month of service on a referred subscription.
 *
 * `subscriptionStartDate` is what the 12-month window anchors on — Stripe's
 * "when this subscription was FIRST created", i.e. the church's signup. Set
 * `omitAnchor` to model a subscription carrying no anchor field at all (a
 * destructuring default cannot express that, since it swallows an explicit
 * `undefined`).
 */
function renewalEvent(opts: {
  eventId: string;
  month: number;
  invoiceId?: string;
  amountPaid?: number;
  subscriptionStartDate?: number | string | null;
  omitAnchor?: boolean;
  anchorMs?: number;
  useLinePeriod?: boolean;
}): NextRequest {
  const {
    eventId, month, invoiceId = `in_m${month}`, amountPaid = AMOUNT,
    subscriptionStartDate = SIGNUP_SECS, omitAnchor = false,
    anchorMs = SIGNUP_MS, useLinePeriod = false,
  } = opts;
  const periodStart = monthStartSecs(month, anchorMs);
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
        ...(useLinePeriod
          ? { lines: { data: [{ period: { start: periodStart, end: monthStartSecs(month + 1, anchorMs) } }] } }
          : { period_start: periodStart }),
      },
    },
  });
  mockSubsRetrieve.mockResolvedValue({
    id: 'sub_A',
    ...(omitAnchor ? {} : { start_date: subscriptionStartDate }),
    metadata: { tenantId: 'tenant1', plan: 'pro', billing: 'monthly', referrerId: 'refUser' },
  });
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'valid-sig' },
    body: '{}',
  });
}

/** A paid new-church checkout carrying a referral. Drives the INITIAL commission. */
function checkoutEvent(eventId: string): NextRequest {
  mockConstructEvent.mockReturnValue({
    id: eventId,
    type: 'checkout.session.completed',
    data: { object: { subscription: 'sub_A', customer: 'cus_1', amount_total: AMOUNT } },
  });
  mockSubsRetrieve.mockResolvedValue({
    id: 'sub_A',
    start_date: SIGNUP_SECS,
    metadata: { tenantId: 'tenant1', plan: 'pro', billing: 'monthly', referrerId: 'refUser' },
    current_period_end: 1800000000,
  });
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'valid-sig' },
    body: '{}',
  });
}

const rows = (): Array<{ id: string; data: Data }> =>
  [...store.entries()]
    .filter(([p]) => p.startsWith('affiliate_commissions/'))
    .map(([p, d]) => ({ id: p.slice('affiliate_commissions/'.length), data: d }));

const rowsOfType = (type: string) => rows().filter(r => r.data.type === type);
/** Rows that actually pay the affiliate something. */
const earningRows = () => rows().filter(r => Number(r.data.commission) > 0);
const referrer = (): Data => store.get('users/refUser')!;

let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
const loggedText = () =>
  [...warnSpy.mock.calls, ...logSpy.mock.calls].map(c => c.map(String).join(' ')).join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  autoIdSeq = 0;
  store.clear();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
  process.env.CRON_SECRET = 'cron_secret';
  mockTransfersCreate.mockResolvedValue({ id: 'tr_1' });
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  logSpy.mockRestore();
});

// ── INSIDE THE WINDOW: what must still pay ──────────────────────────────────────

describe('inside the 12-month window, commissions are created as before', () => {
  it('month 1 invoice creates a commission', async () => {
    seed();
    const res = await WEBHOOK(renewalEvent({ eventId: 'evt_1', month: 1 }));

    expect(res.status).toBe(200);
    expect(earningRows()).toHaveLength(1);
    expect(earningRows()[0].data).toMatchObject({
      type: 'recurring', commission: COMMISSION, status: 'paid', stripeInvoiceId: 'in_m1',
    });
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
    expect(rowsOfType('expired')).toHaveLength(0);
  });

  it('month 11 invoice creates a commission', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_11', month: 11 }));

    expect(earningRows()).toHaveLength(1);
    expect(earningRows()[0].data.commission).toBe(COMMISSION);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(rowsOfType('expired')).toHaveLength(0);
  });

  /**
   * THE BOUNDARY, asserted at the exact edge. Documented choice: the twelfth month
   * of service is INCLUSIVE and the 12-month anniversary instant is EXCLUSIVE, so
   * month 12 pays and month 13 does not. Shortening the window to 11 months (or
   * lengthening it to 13) must fail THIS test.
   */
  it('month 12 invoice creates a commission — the window is inclusive of month 12', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_12', month: 12 }));

    expect(rowsOfType('expired'), 'month 12 must NOT be treated as expired').toHaveLength(0);
    expect(earningRows()).toHaveLength(1);
    expect(earningRows()[0].data).toMatchObject({ type: 'recurring', commission: COMMISSION });
    // Month 12's period starts Dec 1 2025 — inside a window that closes Jan 1 2026.
    expect(earningRows()[0].data.invoicePeriodStartAt).toBe('2025-12-01T00:00:00.000Z');
    expect(earningRows()[0].data.commissionWindowEndsAt).toBe(WINDOW_END_ISO);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
  });

  it('records the window it applied on the row, so the affiliate sees the real cutoff', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_stamp', month: 3 }));

    expect(earningRows()[0].data).toMatchObject({
      commissionWindowMonths: 12,
      commissionWindowAnchorAt: SIGNUP_ISO,
      commissionWindowEndsAt: WINDOW_END_ISO,
      invoicePeriodStartAt: '2025-03-01T00:00:00.000Z',
    });
  });

  it('reads the period from invoice LINE items too, not just invoice.period_start', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_lines', month: 11, useLinePeriod: true }));

    expect(earningRows()).toHaveLength(1);
    expect(earningRows()[0].data.invoicePeriodStartAt).toBe('2025-11-01T00:00:00.000Z');
  });
});

// ── PAST THE WINDOW ─────────────────────────────────────────────────────────────

describe('past the 12-month window, no commission is created', () => {
  /**
   * Removing the window check must fail THIS test — it is the only place a
   * commission is asserted absent for an ordinary, fully-resolvable renewal.
   */
  it('month 13 invoice creates NO commission and moves no money', async () => {
    seed();
    const res = await WEBHOOK(renewalEvent({ eventId: 'evt_13', month: 13 }));

    expect(res.status).toBe(200);
    expect(earningRows(), 'month 13 is past 12 months from signup').toHaveLength(0);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    // Counters untouched: nothing was earned, so nothing is owed.
    expect(referrer().affiliateEarnings).toBe(0);
    expect(referrer().affiliatePendingPayouts).toBe(0);
  });

  /**
   * Expiry must be EXPLICIT, not incidental. #250 twice fixed a path that decided
   * not to act and then fell through to a bare `return`, leaving nobody able to
   * tell "we decided no" from "we crashed". So the skip leaves a durable row.
   */
  it('records WHY it skipped, in a durable row — not a silent return', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_13r', month: 13 }));

    const marker = rowsOfType('expired');
    expect(marker, 'the skip must leave a durable record').toHaveLength(1);
    expect(marker[0].data).toMatchObject({
      referrerId: 'refUser',
      tenantId: 'tenant1',
      commission: 0,
      status: 'cancelled',
      type: 'expired',
      skippedReason: 'window-elapsed',
      stripeInvoiceId: 'in_m13',
      uncommissionedAmount: AMOUNT,
      commissionWindowMonths: 12,
      commissionWindowAnchorAt: SIGNUP_ISO,
      commissionWindowEndsAt: WINDOW_END_ISO,
      invoicePeriodStartAt: '2026-01-01T00:00:00.000Z',
    });
    // Says so in the log as well, with the numbers it decided from.
    expect(loggedText()).toMatch(/SKIPPED.*refUser/s);
    expect(loggedText()).toContain(WINDOW_END_ISO);
  });

  it('the marker is invisible to the payout paths — no $0 transfer is ever attempted', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_13s', month: 13 }));

    // `status: 'cancelled'` (not 'pending') keeps it out of both retry paths, which
    // would otherwise try — and fail — a zero-amount transfer on it forever.
    await sweepPendingAffiliateCommissions({
      stripe: { transfers: { create: mockTransfersCreate } } as any,
      referrerId: 'refUser',
      connectAccountId: 'acct_ref',
    });
    const cron = await CRON(new NextRequest('https://example.com/api/affiliate/retry-transfers', {
      method: 'POST', headers: { authorization: 'Bearer cron_secret' },
    }));

    expect(await cron.json()).toEqual(expect.objectContaining({ message: 'No pending commissions' }));
    expect(mockTransfersCreate).not.toHaveBeenCalled();
  });

  it('a month-24 invoice is skipped the same way', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_24', month: 24 }));

    expect(earningRows()).toHaveLength(0);
    expect(rowsOfType('expired')).toHaveLength(1);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
  });

  it('does NOT decrement affiliateReferralCount — a closed window is still a converted referral', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_13c', month: 13 }));

    expect(referrer().affiliateReferralCount).toBe(1);
  });
});

// ── THE INVOICE PERIOD GOVERNS, NOT THE DELIVERY TIME ───────────────────────────

describe('a late-delivered invoice is judged on its PERIOD, not on when it arrives', () => {
  it('a month-11 invoice whose webhook fires in month 14 still creates a commission', async () => {
    seed();
    // Stripe retries a delivery for weeks, and dunning can settle an invoice long
    // after its period. Nothing in the gate reads a wall clock or a delivery time,
    // so this arrives "in month 14" and is still a month-11 invoice.
    await WEBHOOK(renewalEvent({ eventId: 'evt_late', month: 11, invoiceId: 'in_late_m11' }));

    expect(rowsOfType('expired'), 'a month-11 period must never be read as expired').toHaveLength(0);
    expect(earningRows()).toHaveLength(1);
    expect(earningRows()[0].data).toMatchObject({
      commission: COMMISSION,
      stripeInvoiceId: 'in_late_m11',
      invoicePeriodStartAt: '2025-11-01T00:00:00.000Z',
    });
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
  });

  it('a month-11 commission banked pending is still swept in month 14, un-regated', async () => {
    // The payout paths deliberately do NOT re-check the window: the row only exists
    // because the window allowed it at creation time. Re-checking here is exactly how
    // a legitimately-earned commission would be silently withheld.
    seed({ connectStatus: 'pending' });
    await WEBHOOK(renewalEvent({ eventId: 'evt_late_p', month: 11 }));
    expect(earningRows()[0].data.status).toBe('pending');

    store.set('users/refUser', { ...referrer(), affiliateConnectStatus: 'active' });
    const result = await sweepPendingAffiliateCommissions({
      stripe: { transfers: { create: mockTransfersCreate } } as any,
      referrerId: 'refUser',
      connectAccountId: 'acct_ref',
    });

    expect(result).toEqual({ total: 1, swept: 1 });
    expect(mockTransfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: COMMISSION }),
      expect.objectContaining({ idempotencyKey: affiliateSweepIdempotencyKey(earningRows()[0].id) }),
    );
    expect(earningRows()[0].data.status).toBe('paid');
  });
});

// ── THE FAIL-SAFE DIRECTION ─────────────────────────────────────────────────────

describe('a missing or unparseable anchor PAYS, loudly — it is never read as expired', () => {
  /**
   * THE DOCUMENTED FAIL-SAFE. Inverting it — treating an unresolvable window as
   * expired — must fail THIS test. An affiliate silently unpaid from month 6 is the
   * expensive failure; one extra row a human can find and reverse is the cheap one.
   */
  it('a MISSING anchor pays the commission and logs loudly', async () => {
    seed();
    // No `start_date` at all, and a period five years past any plausible window.
    await WEBHOOK(renewalEvent({ eventId: 'evt_noanchor', month: 60, omitAnchor: true }));

    expect(rowsOfType('expired'), 'a missing anchor must NOT be treated as expired').toHaveLength(0);
    expect(earningRows(), 'the commission must still be created').toHaveLength(1);
    expect(earningRows()[0].data.commission).toBe(COMMISSION);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(referrer().affiliateEarnings).toBe(COMMISSION);

    // Loud: paying without being able to prove the window is open must never be quiet.
    expect(loggedText()).toMatch(/window UNRESOLVED/i);
    expect(loggedText()).toContain('anchor-unresolved');
    expect(loggedText()).toMatch(/PAYING/);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['a non-numeric string', 'signup-day'],
    ['null', null],
  ])('an UNPARSEABLE anchor (%s) pays the commission and logs loudly', async (label, bad) => {
    seed();
    await WEBHOOK(renewalEvent({
      eventId: `evt_bad_${String(label).replace(/\W/g, '')}`,
      month: 60,
      subscriptionStartDate: bad as any,
    }));

    expect(rowsOfType('expired'), `${label} must not be read as expired`).toHaveLength(0);
    expect(earningRows()).toHaveLength(1);
    expect(loggedText()).toMatch(/window UNRESOLVED/i);
  });

  it('an anchor with NO resolvable invoice period pays too', async () => {
    seed();
    mockConstructEvent.mockReturnValue({
      id: 'evt_noperiod',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_noperiod', subscription: 'sub_A', amount_paid: AMOUNT,
          currency: 'usd', billing_reason: 'subscription_cycle',
          // No period_start and no lines — nothing to compare the anchor against.
        },
      },
    });
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_A', start_date: SIGNUP_SECS,
      metadata: { tenantId: 'tenant1', plan: 'pro', referrerId: 'refUser' },
    });

    await WEBHOOK(new NextRequest('https://example.com/api/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': 'valid-sig' }, body: '{}',
    }));

    expect(earningRows()).toHaveLength(1);
    expect(loggedText()).toContain('period-unresolved');
  });

  it('a NORMAL in-window renewal is quiet — the loud log means something is wrong', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_quiet', month: 5 }));

    expect(earningRows()).toHaveLength(1);
    expect(loggedText()).not.toMatch(/UNRESOLVED/i);
  });
});

// ── THE INITIAL COMMISSION IS NEVER GATED ───────────────────────────────────────

describe('the initial commission at signup is never blocked by the window', () => {
  it('a paid signup creates its initial commission and pays it', async () => {
    // The initial commission is created by the checkout that STARTS the subscription,
    // so its period is the anchor instant — zero months have elapsed. The window is
    // deliberately not applied here: gating it would add a way to silently kill the
    // highest-value payout in the system for a case that cannot occur.
    seed();
    store.set('users/refUser', { ...referrer(), affiliateReferralCount: 0 });

    const res = await WEBHOOK(checkoutEvent('evt_signup'));

    expect(res.status).toBe(200);
    expect(rowsOfType('expired'), 'signup must never be treated as expired').toHaveLength(0);
    expect(rowsOfType('initial')).toHaveLength(1);
    expect(rowsOfType('initial')[0].data).toMatchObject({ commission: COMMISSION, status: 'paid' });
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    // The referral converted, so the count moves — exactly as before this change.
    expect(referrer().affiliateReferralCount).toBe(1);
  });

  it('stamps its own window on the row so the clock is visible from day one', async () => {
    seed();
    await WEBHOOK(checkoutEvent('evt_signup_stamp'));

    const row = rowsOfType('initial')[0].data;
    expect(row.commissionWindowAnchorAt).toBe(row.createdAt);
    expect(Date.parse(row.commissionWindowEndsAt)).toBe(
      addMonthsUtc(Date.parse(row.createdAt), 12),
    );
  });
});

// ── A LAPSE DOES NOT EXTEND THE WINDOW ──────────────────────────────────────────

describe('a lapsed-and-resumed subscription does not extend the window', () => {
  /**
   * The clock is anchored on a stored TIMESTAMP, not on a count of commissions, so
   * months in which nothing was billed are not banked and cannot be made up later.
   * Removing the window check must fail THIS test.
   */
  it('a lapsed-and-resumed subscription does not extend the window past 12 months from signup', async () => {
    seed();
    // Months 1-2 bill normally.
    await WEBHOOK(renewalEvent({ eventId: 'evt_l1', month: 1 }));
    await WEBHOOK(renewalEvent({ eventId: 'evt_l2', month: 2 }));
    expect(earningRows()).toHaveLength(2);

    // Months 3-12: payment fails / the church pauses. Nothing is billed, so nothing
    // is earned — and critically, nothing is BANKED for later either.

    // Month 13: they resume and pay. `start_date` is unchanged by a lapse and resume,
    // so the window still closes 12 months after SIGNUP, not 12 billed months later.
    await WEBHOOK(renewalEvent({ eventId: 'evt_l13', month: 13, invoiceId: 'in_resume_m13' }));

    expect(earningRows(), 'the resumed invoice must NOT earn a 3rd commission').toHaveLength(2);
    expect(rowsOfType('expired')).toHaveLength(1);
    expect(rowsOfType('expired')[0].data).toMatchObject({
      stripeInvoiceId: 'in_resume_m13',
      skippedReason: 'window-elapsed',
      commissionWindowEndsAt: WINDOW_END_ISO,
    });
    // Only the two in-window renewals were ever paid.
    expect(mockTransfersCreate).toHaveBeenCalledTimes(2);
    expect(referrer().affiliateEarnings).toBe(COMMISSION * 2);
  });

  it('the clock is a timestamp, not a counter: 3 paid months do not buy 9 more', async () => {
    seed();
    for (const m of [1, 6, 12]) {
      await WEBHOOK(renewalEvent({ eventId: `evt_cnt_${m}`, month: m }));
    }
    expect(earningRows()).toHaveLength(3);

    // A commission COUNTER at 3 would happily allow 9 more. The timestamp does not.
    await WEBHOOK(renewalEvent({ eventId: 'evt_cnt_13', month: 13 }));
    expect(earningRows()).toHaveLength(3);
    expect(rowsOfType('expired')).toHaveLength(1);
  });
});

// ── THE STORED COMMISSION AMOUNT IS NEVER TOUCHED ───────────────────────────────

describe('the window gates WHETHER a commission exists, never a stored amount', () => {
  it('the legacy 20% row still pays 20% — the stored value is read, never recomputed', async () => {
    seed();
    // A real legacy row, banked at the old 20% ultra rate, pending because Connect
    // was not active when it was earned. 20% of $119 = $23.80, not the flat 15%.
    const legacyCommission = Math.round(AMOUNT * 0.2); // 2380
    expect(legacyCommission).not.toBe(COMMISSION);
    store.set('affiliate_commissions/legacy20', {
      referrerId: 'refUser',
      tenantId: 'tenant1',
      plan: 'ultra',
      amount: AMOUNT,
      commission: legacyCommission,
      status: 'pending',
      type: 'recurring',
      stripeSubscriptionId: 'sub_legacy',
      stripeInvoiceId: 'in_legacy',
      createdAt: '2024-02-01T00:00:00.000Z',
      // Deliberately carries no window fields at all — it predates them.
    });
    store.set('users/refUser', { ...referrer(), affiliatePendingPayouts: legacyCommission });

    const result = await sweepPendingAffiliateCommissions({
      stripe: { transfers: { create: mockTransfersCreate } } as any,
      referrerId: 'refUser',
      connectAccountId: 'acct_ref',
    });

    expect(result).toEqual({ total: 1, swept: 1 });
    expect(mockTransfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: legacyCommission }),
      expect.anything(),
    );
    expect(store.get('affiliate_commissions/legacy20')!.commission).toBe(legacyCommission);
    expect(store.get('affiliate_commissions/legacy20')!.status).toBe('paid');
  });

  it('an in-window commission is still exactly 15% of amount_paid', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_rate', month: 6, amountPaid: 29900 }));

    expect(earningRows()[0].data).toMatchObject({ amount: 29900, commission: 4485 });
  });
});

// ── IDEMPOTENCY IS PRESERVED ────────────────────────────────────────────────────

describe('idempotency survives the window check', () => {
  it('replaying an IN-window invoice creates exactly one commission', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_dup_a', month: 4, invoiceId: 'in_dup' }));
    // A distinct event id for the SAME invoice gets past the webhook_events marker,
    // so this exercises the `stripeInvoiceId` dedup guard.
    await WEBHOOK(renewalEvent({ eventId: 'evt_dup_b', month: 4, invoiceId: 'in_dup' }));

    expect(earningRows()).toHaveLength(1);
    expect(mockTransfersCreate).toHaveBeenCalledTimes(1);
    expect(referrer().affiliateEarnings).toBe(COMMISSION);
  });

  it('replaying an OUT-of-window invoice creates no commission and no second marker', async () => {
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_dupx_a', month: 13, invoiceId: 'in_dupx' }));
    await WEBHOOK(renewalEvent({ eventId: 'evt_dupx_b', month: 13, invoiceId: 'in_dupx' }));

    expect(earningRows()).toHaveLength(0);
    // The marker carries `stripeInvoiceId`, so the existing dedup guard makes the
    // replay a complete no-op rather than piling up a marker per redelivery.
    expect(rowsOfType('expired')).toHaveLength(1);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect(referrer().affiliateEarnings).toBe(0);
  });

  it('an in-window invoice that follows an expired one on the same subscription is unaffected', async () => {
    // Order matters: the expiry marker must not poison the per-invoice dedup for a
    // DIFFERENT invoice. (Backdated corrections do arrive out of order.)
    seed();
    await WEBHOOK(renewalEvent({ eventId: 'evt_ord_13', month: 13, invoiceId: 'in_ord13' }));
    await WEBHOOK(renewalEvent({ eventId: 'evt_ord_9', month: 9, invoiceId: 'in_ord9' }));

    expect(earningRows()).toHaveLength(1);
    expect(earningRows()[0].data.stripeInvoiceId).toBe('in_ord9');
    expect(rowsOfType('expired')).toHaveLength(1);
  });
});
