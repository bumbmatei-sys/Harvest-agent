import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockConstructEvent, mockSubsRetrieve } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockSubsRetrieve: vi.fn(),
}));
const { mockDocGet, mockDocSet, mockDocUpdate, mockDocDelete, mockCollGet, mockAdd } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
  mockDocDelete: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn().mockResolvedValue({ docs: [] }),
  mockAdd: vi.fn().mockResolvedValue({ id: 'new1' }),
}));

function makeCollRef(): any {
  const coll: any = { doc: vi.fn(() => makeDocRef()), add: mockAdd, get: mockCollGet };
  coll.where = vi.fn(() => coll);
  coll.limit = vi.fn(() => coll);
  coll.orderBy = vi.fn(() => coll);
  return coll;
}
function makeDocRef(): any {
  return {
    get: mockDocGet, set: mockDocSet, update: mockDocUpdate, delete: mockDocDelete,
    collection: vi.fn(() => makeCollRef()),
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
  adminDb: { collection: vi.fn(() => makeCollRef()) },
  adminAuth: { getUser: vi.fn(), getUserByEmail: vi.fn(), createUser: vi.fn(), createCustomToken: vi.fn() },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TS'), increment: vi.fn((n: number) => ({ __increment: n })) },
  getFirestore: vi.fn(),
}));

vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: vi.fn() }));
vi.mock('@/lib/ai-utils', () => ({ generateAccessCode: vi.fn(() => 'CODE-1') }));
vi.mock('@/lib/stripe-config', () => ({ PLAN_PRICES: {}, getPlanFromPriceId: vi.fn() }));
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,x') } }));

const { POST } = await import('../webhook/route');

function makeRequest(): NextRequest {
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}',
  });
}

// One-time campaign gift: /api/stripe/donate hardcodes type 'partnership' and puts the
// widget's campaignId into the PaymentIntent metadata. amount_received is CENTS (5000 = $50).
function oneTimeEvent(meta: Record<string, unknown>, id = 'evt_ot_1') {
  return {
    id, type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_1', amount_received: 5000, currency: 'usd', metadata: meta } },
  };
}
// Monthly campaign gift — first payment arrives as a subscription checkout completing.
function subCompletedEvent(id = 'evt_m1') {
  return {
    id, type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', subscription: 'sub_partner', mode: 'subscription', amount_total: 5000, metadata: { tenantId: 't1' } } },
  };
}
// Monthly campaign gift — a renewal (or the first invoice) posts invoice.payment_succeeded.
function invoiceEvent(over: Record<string, unknown>, id = 'evt_inv_1') {
  return {
    id, type: 'invoice.payment_succeeded',
    data: { object: { id: 'in_1', subscription: 'sub_partner', amount_paid: 5000, ...over } },
  };
}

// True if any campaigns/{id}.update() carried a `raised` increment.
const raisedUpdates = () =>
  mockDocUpdate.mock.calls.filter(([arg]) => (arg as any)?.raised !== undefined);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
  delete process.env.RESEND_API_KEY;
  mockDocGet.mockResolvedValue({ exists: false }); // default: new event / missing doc
  mockCollGet.mockResolvedValue({ docs: [] });
  // Partnership subscription toward campaign 'camp1', $50/mo. Used by the monthly paths.
  mockSubsRetrieve.mockResolvedValue({
    id: 'sub_partner', currency: 'usd',
    metadata: { type: 'partnership', tenantId: 't1', campaignId: 'camp1', donationType: 'monthly', plan: 'pro' },
    items: { data: [{ price: { unit_amount: 5000 } }] },
  });
});

describe('webhook — campaign.raised increment (fundraising progress bar)', () => {
  it('one-time gift increments campaigns/{id}.raised by the DOLLAR amount (5000 cents → +50)', async () => {
    mockConstructEvent.mockReturnValue(oneTimeEvent({ type: 'partnership', tenantId: 't1', campaignId: 'camp1' }));
    mockDocGet
      .mockResolvedValueOnce({ exists: false })                                     // webhook_events dedup → new
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1', goal: 5000, raised: 0 }) }); // campaign doc

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // DOLLARS, matching how `goal` is stored — a $50 gift moves the bar by $50, not
    // $5,000 (raw cents). Anything but 50 here reproduces the progress-bar unit bug.
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ raised: { __increment: 50 } }),
    );
    expect(raisedUpdates()).toHaveLength(1);
  });

  it('does NOT touch any campaign when the gift carries no campaignId', async () => {
    mockConstructEvent.mockReturnValue(oneTimeEvent({ type: 'partnership', tenantId: 't1' })); // no campaignId
    mockDocGet.mockResolvedValueOnce({ exists: false }); // dedup only

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // The helper returns before reading any campaign — only the dedup doc was fetched.
    expect(mockDocGet).toHaveBeenCalledTimes(1);
    expect(raisedUpdates()).toHaveLength(0);
  });

  it('is idempotent: a redelivered payment_intent.succeeded does not double-count raised', async () => {
    mockConstructEvent.mockReturnValue(oneTimeEvent({ type: 'partnership', tenantId: 't1', campaignId: 'camp1' }));

    // First delivery → credited once.
    mockDocGet
      .mockResolvedValueOnce({ exists: false })                                   // dedup → new
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1' }) }); // campaign
    await POST(makeRequest());

    // Redelivery of the SAME event → webhook_events marker short-circuits it.
    mockDocGet.mockResolvedValueOnce({ exists: true }); // already processed
    const res = await POST(makeRequest());
    expect((await res.json()).duplicate).toBe(true);

    expect(raisedUpdates()).toHaveLength(1); // still exactly one increment
  });

  it('skips (no throw, still 200) when the campaignId no longer resolves to a campaign', async () => {
    mockConstructEvent.mockReturnValue(oneTimeEvent({ type: 'partnership', tenantId: 't1', campaignId: 'ghost' }));
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // dedup
      .mockResolvedValueOnce({ exists: false }); // campaign missing (deleted)

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(raisedUpdates()).toHaveLength(0);
  });

  it('refuses to credit a campaign owned by a different tenant than the one paid', async () => {
    mockConstructEvent.mockReturnValue(oneTimeEvent({ type: 'partnership', tenantId: 't1', campaignId: 'campX' }));
    mockDocGet
      .mockResolvedValueOnce({ exists: false })                                   // dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't2' }) }); // campaign belongs to t2, not t1

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(raisedUpdates()).toHaveLength(0);
  });

  it('monthly FIRST payment (checkout.session.completed) increments raised by the dollar amount', async () => {
    mockConstructEvent.mockReturnValue(subCompletedEvent());
    mockDocGet
      .mockResolvedValueOnce({ exists: false })                                   // dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Grace' }) })   // tenant (churchName lookup)
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1' }) }); // campaign

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ raised: { __increment: 50 } }),
    );
    expect(raisedUpdates()).toHaveLength(1);
  });

  it('monthly RENEWAL (invoice.payment_succeeded, subscription_cycle) increments raised', async () => {
    mockConstructEvent.mockReturnValue(invoiceEvent({ billing_reason: 'subscription_cycle', amount_paid: 5000 }));
    mockDocGet
      .mockResolvedValueOnce({ exists: false })                                     // dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) })  // tenant (reactivation check)
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1' }) });   // campaign

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ raised: { __increment: 50 } }),
    );
    expect(raisedUpdates()).toHaveLength(1);
  });

  it('does NOT double-count the opening month: the first invoice (subscription_create) is skipped', async () => {
    // Stripe fires BOTH checkout.session.completed AND invoice.payment_succeeded
    // (billing_reason 'subscription_create') for a new subscription. The initial gift
    // is credited by the former, so the latter must NOT credit it again.
    mockConstructEvent.mockReturnValue(invoiceEvent({ billing_reason: 'subscription_create', amount_paid: 5000 }));
    mockDocGet
      .mockResolvedValueOnce({ exists: false })                                    // dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) }); // tenant (reactivation check)

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(raisedUpdates()).toHaveLength(0);
  });
});
