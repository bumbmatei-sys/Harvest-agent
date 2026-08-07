import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-30 — a campaign's `raised` total must be credited exactly ONCE per payment.
 *
 * `incrementCampaignRaised` used to end in a bare `FieldValue.increment` with no
 * per-payment dedup, leaning entirely on the `webhook_events/{event.id}` marker. That
 * marker is deliberately DELETED when the handler throws, so the live sequence was:
 *
 *   invoice.payment_succeeded
 *     → incrementCampaignRaised     (campaign credited)
 *     → recordPartnershipRenewalDonation throws
 *     → outer catch deletes the marker, returns 500
 *     → Stripe redelivers → marker gone → credited a SECOND time for one payment.
 *
 * The tests below run that exact sequence, plus the two sibling call sites, against a
 * stateful Firestore double: `store` really holds documents, `set`/`delete` really
 * mutate it, and `FieldValue.increment` is really applied — so `campaigns/camp1.raised`
 * is an actual running total rather than a count of update() calls. A double-credit
 * shows up as 100 where 50 is correct.
 */

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockConstructEvent, mockSubsRetrieve, mockIssueReceipt } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockSubsRetrieve: vi.fn(),
  mockIssueReceipt: vi.fn().mockResolvedValue(undefined),
}));

// Stateful, path-aware Firestore double.
const { store, hooks } = vi.hoisted(() => ({
  store: new Map<string, any>(),
  // failOn(path) → that write throws once, modelling a transient Firestore failure.
  hooks: { failWrite: null as null | ((path: string) => boolean) },
}));

let addCounter = 0;

/** Apply a write payload to a stored doc, honouring the FieldValue sentinels. */
function applyData(existing: any, data: any): any {
  const next = { ...(existing || {}) };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && '__increment' in (v as any)) {
      next[k] = (typeof next[k] === 'number' ? next[k] : 0) + (v as any).__increment;
    } else {
      next[k] = v;
    }
  }
  return next;
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => ({
      exists: store.has(path),
      data: () => store.get(path),
      id: path.split('/').pop(),
    }),
    set: async (data: any) => {
      if (hooks.failWrite?.(path)) throw new Error(`simulated Firestore failure at ${path}`);
      store.set(path, applyData(undefined, data));
    },
    update: async (data: any) => {
      if (hooks.failWrite?.(path)) throw new Error(`simulated Firestore failure at ${path}`);
      store.set(path, applyData(store.get(path), data));
    },
    delete: async () => { store.delete(path); },
    collection: (sub: string) => makeCollRef(`${path}/${sub}`),
  };
}

function makeCollRef(path: string): any {
  const filters: Array<[string, string, unknown]> = [];
  const coll: any = {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    add: async (data: any) => {
      if (hooks.failWrite?.(path)) throw new Error(`simulated Firestore failure at ${path}`);
      const id = `gen${++addCounter}`;
      store.set(`${path}/${id}`, applyData(undefined, data));
      return makeDocRef(`${path}/${id}`);
    },
    // Direct children of `path` matching every equality filter.
    get: async () => {
      const docs = [...store.entries()]
        .filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
        .filter(([, v]) => filters.every(([f, , val]) => v?.[f] === val))
        .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v, ref: makeDocRef(k) }));
      return { docs, empty: docs.length === 0 };
    },
  };
  coll.where = (f: string, op: string, v: unknown) => { filters.push([f, op, v]); return coll; };
  coll.limit = () => coll;
  coll.orderBy = () => coll;
  return coll;
}

// Batched writes are applied only on commit, and all-or-nothing: if any op throws,
// the store is left exactly as it was — which is what makes the atomicity test real.
function makeBatch(): any {
  const ops: Array<{ type: 'set' | 'update'; ref: any; data: any }> = [];
  return {
    set: (ref: any, data: any) => { ops.push({ type: 'set', ref, data }); },
    update: (ref: any, data: any) => { ops.push({ type: 'update', ref, data }); },
    commit: async () => {
      const snapshot = new Map(store);
      try {
        for (const op of ops) {
          if (op.type === 'set') await op.ref.set(op.data);
          else await op.ref.update(op.data);
        }
      } catch (e) {
        store.clear();
        for (const [k, v] of snapshot) store.set(k, v);
        throw e;
      }
    },
  };
}

vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mockConstructEvent };
    subscriptions = { retrieve: mockSubsRetrieve, cancel: vi.fn(), update: vi.fn() };
    customers = { retrieve: vi.fn() };
    transfers = { create: vi.fn() };
    charges = { retrieve: vi.fn() };
    refunds = { create: vi.fn() };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => makeCollRef(name), batch: () => makeBatch() },
  adminAuth: { getUser: vi.fn(), getUserByEmail: vi.fn(), createUser: vi.fn(), createCustomToken: vi.fn() },
  getReceiptsBucket: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
  getFirestore: vi.fn(),
}));

vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: vi.fn() }));
vi.mock('@/lib/ai-utils', () => ({ generateAccessCode: vi.fn(() => 'CODE-1') }));
vi.mock('@/lib/billing', () => ({ PLAN_PRICES: {}, getPlanFromPriceId: vi.fn() }));
vi.mock('@/lib/donation-receipt', () => ({ issueDonationReceipt: mockIssueReceipt }));
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,x') } }));

const { POST } = await import('../webhook/route');

function makeRequest(): NextRequest {
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}',
  });
}

const PARTNERSHIP_META = {
  type: 'partnership', tenantId: 't1', donationType: 'monthly', plan: 'pro',
  campaignId: 'camp1', donorName: 'Pat Partner',
  donorEmail: 'partner@example.com', donorUserId: 'u1',
  donationChurchName: 'Grace Chapel',
};

/** Monthly renewal → invoice.payment_succeeded (site 2). */
function invoiceEvent(over: Record<string, unknown> = {}, eventId = 'evt_inv_1') {
  return {
    id: eventId, type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: 'in_1', subscription: 'sub_partner', amount_paid: 5000, currency: 'usd',
        billing_reason: 'subscription_cycle', ...over,
      },
    },
  };
}

/** One-time gift → payment_intent.succeeded (site 3). */
function oneTimeEvent(over: Record<string, unknown> = {}, eventId = 'evt_pi_1') {
  return {
    id: eventId, type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_1', amount_received: 5000, currency: 'usd',
        metadata: { type: 'partnership', tenantId: 't1', campaignId: 'camp1', donorEmail: 'giver@example.com' },
        ...over,
      },
    },
  };
}

/** A monthly subscription's FIRST payment → checkout.session.completed (site 1). */
function checkoutEvent(over: Record<string, unknown> = {}, eventId = 'evt_cs_1') {
  return {
    id: eventId, type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1', subscription: 'sub_partner', mode: 'subscription',
        amount_total: 5000, metadata: { tenantId: 't1' }, ...over,
      },
    },
  };
}

const raised = () => store.get('campaigns/camp1')?.raised;
const creditIds = (campaign = 'camp1') =>
  [...store.keys()]
    .filter(k => k.startsWith(`campaigns/${campaign}/credits/`))
    .map(k => k.split('/').pop());

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
  delete process.env.RESEND_API_KEY;
  store.clear();
  addCounter = 0;
  hooks.failWrite = null;
  store.set('tenants/t1', { name: 'Grace Chapel', status: 'active' });
  store.set('campaigns/camp1', { tenantId: 't1', goal: 5000, raised: 0 });
  store.set('campaigns/campX', { tenantId: 't2', goal: 1000, raised: 0 });
  store.set('users/u1', { displayName: 'Pat Partner' });
  mockSubsRetrieve.mockResolvedValue({
    id: 'sub_partner', currency: 'usd', metadata: PARTNERSHIP_META,
    items: { data: [{ price: { unit_amount: 5000 } }] },
  });
});

describe('THE-30 — campaign credit is idempotent per payment', () => {
  it('renewal: a failure AFTER the credit, then a redelivery, credits the campaign only once', async () => {
    // Delivery 1: the credit lands, then recordPartnershipRenewalDonation's receipt
    // write dies. The outer catch deletes the webhook_events marker and 500s — the
    // exact interleaving THE-30 reports.
    mockConstructEvent.mockReturnValue(invoiceEvent());
    hooks.failWrite = (path) => path === 'tenants/t1/invoices';

    const first = await POST(makeRequest());
    expect(first.status).toBe(500);
    expect(raised()).toBe(50);                       // credited on this attempt
    expect(store.has('webhook_events/evt_inv_1')).toBe(false); // marker undone → Stripe WILL redeliver

    // Delivery 2: same invoice, marker gone, receipt write now succeeds. Before the
    // fix this second pass ran the bare increment again and `raised` reached 100.
    hooks.failWrite = null;
    const second = await POST(makeRequest());
    expect(second.status).toBe(200);

    expect(raised()).toBe(50);                       // ONE payment, ONE credit
    expect(creditIds()).toEqual(['in_1']);           // keyed by invoice id
    // The retry still completed the work that had been lost.
    expect([...store.keys()].some(k => k.startsWith('tenants/t1/invoices/'))).toBe(true);
  });

  it('renewal: two DIFFERENT invoices are both credited (dedup is per payment, not per campaign)', async () => {
    mockConstructEvent.mockReturnValue(invoiceEvent({ id: 'in_jan' }, 'evt_jan'));
    expect((await POST(makeRequest())).status).toBe(200);

    mockConstructEvent.mockReturnValue(invoiceEvent({ id: 'in_feb' }, 'evt_feb'));
    expect((await POST(makeRequest())).status).toBe(200);

    expect(raised()).toBe(100);
    expect(creditIds().sort()).toEqual(['in_feb', 'in_jan']);
  });

  it('one-time gift: a redelivery with the marker gone credits the payment intent once', async () => {
    mockConstructEvent.mockReturnValue(oneTimeEvent());
    expect((await POST(makeRequest())).status).toBe(200);
    expect(raised()).toBe(50);
    expect(creditIds()).toEqual(['pi_1']);           // keyed by payment-intent id

    // Simulate the marker being undone by an unrelated failure, then a redelivery.
    store.delete('webhook_events/evt_pi_1');
    expect((await POST(makeRequest())).status).toBe(200);
    expect(raised()).toBe(50);
  });

  it('one-time gift: two DIFFERENT payment intents are both credited', async () => {
    mockConstructEvent.mockReturnValue(oneTimeEvent({ id: 'pi_a' }, 'evt_a'));
    await POST(makeRequest());
    mockConstructEvent.mockReturnValue(oneTimeEvent({ id: 'pi_b' }, 'evt_b'));
    await POST(makeRequest());

    expect(raised()).toBe(100);
    expect(creditIds().sort()).toEqual(['pi_a', 'pi_b']);
  });

  it("monthly first payment: keyed by the CHECKOUT SESSION id, and a redelivery doesn't double it", async () => {
    mockConstructEvent.mockReturnValue(checkoutEvent());
    expect((await POST(makeRequest())).status).toBe(200);
    expect(raised()).toBe(50);
    expect(creditIds()).toEqual(['cs_1']);           // keyed by checkout-session id

    store.delete('webhook_events/evt_cs_1');
    expect((await POST(makeRequest())).status).toBe(200);
    expect(raised()).toBe(50);
  });

  it('the opening month is not counted twice across the two DISTINCT events that cover it', async () => {
    // checkout.session.completed credits the first month (key cs_1)...
    mockConstructEvent.mockReturnValue(checkoutEvent());
    await POST(makeRequest());
    // ...and its `subscription_create` invoice must not credit it again. Different
    // event, different payment id — the billing_reason skip is what stops it.
    mockConstructEvent.mockReturnValue(invoiceEvent({ billing_reason: 'subscription_create' }, 'evt_inv_create'));
    await POST(makeRequest());

    expect(raised()).toBe(50);
    expect(creditIds()).toEqual(['cs_1']);
  });

  it('the increment and its dedup marker are one atomic batch — a failed commit writes neither', async () => {
    mockConstructEvent.mockReturnValue(oneTimeEvent());
    hooks.failWrite = (path) => path === 'campaigns/camp1';

    expect((await POST(makeRequest())).status).toBe(500);
    // Neither half landed, so the redelivery is free to credit for real — no silent
    // under-credit from a marker that outlived a failed increment.
    expect(raised()).toBe(0);
    expect(creditIds()).toEqual([]);

    hooks.failWrite = null;
    expect((await POST(makeRequest())).status).toBe(200);
    expect(raised()).toBe(50);
  });

  it('still skips a missing campaign, and writes no credit marker for it', async () => {
    mockConstructEvent.mockReturnValue(oneTimeEvent({
      metadata: { type: 'partnership', tenantId: 't1', campaignId: 'ghost' },
    }));
    expect((await POST(makeRequest())).status).toBe(200);
    expect(raised()).toBe(0);
    expect(creditIds('ghost')).toEqual([]);
  });

  it("still refuses a campaign owned by another tenant, and writes no credit marker for it", async () => {
    mockConstructEvent.mockReturnValue(oneTimeEvent({
      metadata: { type: 'partnership', tenantId: 't1', campaignId: 'campX' }, // campX belongs to t2
    }));
    expect((await POST(makeRequest())).status).toBe(200);
    expect(store.get('campaigns/campX').raised).toBe(0);
    expect(creditIds('campX')).toEqual([]);
  });

  it('records nothing when the payment carries no id to dedup on', async () => {
    mockConstructEvent.mockReturnValue(invoiceEvent({ id: undefined }, 'evt_no_id'));
    expect((await POST(makeRequest())).status).toBe(200);
    expect(raised()).toBe(0);
    expect(creditIds()).toEqual([]);
  });
});
