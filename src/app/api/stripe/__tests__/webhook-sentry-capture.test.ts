import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Sentry instrumentation of the webhook's silent money-path failures.
 *
 * This suite is primarily an ANTI-REGRESSION suite: the instrumentation is purely
 * additive, so every scenario below asserts the exact status code and response
 * body the handler returned before it, alongside the capture. `@sentry/nextjs` is
 * mocked but `@/lib/money-path-sentry` is NOT, so the tag/context shape that
 * actually reaches Sentry is what gets asserted.
 */

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: mockCaptureException }));

const { mockConstructEvent, mockSubRetrieve, mockTransferCreate, mockChargeRetrieve } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockSubRetrieve: vi.fn(),
  mockTransferCreate: vi.fn(),
  mockChargeRetrieve: vi.fn(),
}));
const { mockDocGet, mockDocSet, mockDocUpdate, mockDocDelete, mockCollGet, mockAdd, mockIssueReceipt } =
  vi.hoisted(() => ({
    mockDocGet: vi.fn(),
    mockDocSet: vi.fn().mockResolvedValue(undefined),
    mockDocUpdate: vi.fn().mockResolvedValue(undefined),
    mockDocDelete: vi.fn().mockResolvedValue(undefined),
    mockCollGet: vi.fn(),
    mockAdd: vi.fn(),
    mockIssueReceipt: vi.fn().mockResolvedValue(undefined),
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
    subscriptions = { retrieve: mockSubRetrieve, cancel: vi.fn(), update: vi.fn() };
    customers = { retrieve: vi.fn() };
    transfers = { create: mockTransferCreate };
    charges = { retrieve: mockChargeRetrieve };
    refunds = { create: vi.fn() };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => makeCollRef()), batch: vi.fn(() => ({ update: vi.fn(), delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) })) },
  adminAuth: { getUser: vi.fn(), getUserByEmail: vi.fn(), createUser: vi.fn(), createCustomToken: vi.fn() },
  getReceiptsBucket: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TS'), increment: vi.fn((n: number) => ({ __increment: n })) },
  getFirestore: vi.fn(),
}));

vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: vi.fn() }));
vi.mock('@/lib/ai-utils', () => ({ generateAccessCode: vi.fn(() => 'CODE-1') }));
vi.mock('@/lib/stripe-config', () => ({ PLAN_PRICES: {}, getPlanFromPriceId: vi.fn() }));
vi.mock('@/lib/donation-receipt', () => ({ issueDonationReceipt: mockIssueReceipt }));
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,x') } }));

const { POST } = await import('../webhook/route');

function makeRequest(): NextRequest {
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}',
  });
}

/** The capture whose `step` tag matches, or undefined. */
function captureForStep(step: string): { error: unknown; context: any } | undefined {
  const call = mockCaptureException.mock.calls.find((c) => c[1]?.tags?.step === step);
  return call ? { error: call[0], context: call[1] } : undefined;
}

/** Every `step` tag captured during this test, in call order. */
function capturedSteps(): string[] {
  return mockCaptureException.mock.calls.map((c) => c[1]?.tags?.step);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollGet.mockResolvedValue({ empty: true, docs: [] });
  mockAdd.mockResolvedValue({ id: 'doc_new' });
  mockDocSet.mockResolvedValue(undefined);
  mockDocUpdate.mockResolvedValue(undefined);
  mockDocDelete.mockResolvedValue(undefined);
  mockTransferCreate.mockResolvedValue({ id: 'tr_1' });
});

// ── The transfer path ────────────────────────────────────────────────────────
describe('recurring affiliate transfer failure', () => {
  /** invoice.payment_succeeded for a referred tenant whose payout bounces. */
  function arrangeFailedRecurringTransfer() {
    mockConstructEvent.mockReturnValue({
      id: 'evt_inv_1', type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_1', amount_paid: 10000, currency: 'usd', subscription: 'sub_1', billing_reason: 'subscription_cycle' } },
    });
    mockSubRetrieve.mockResolvedValue({ id: 'sub_1', metadata: { tenantId: 't1', referrerId: 'ref1', plan: 'pro' } });
    mockDocGet
      .mockResolvedValueOnce({ exists: false })                                        // webhook_events dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) })     // tenant (not suspended)
      .mockResolvedValueOnce({ exists: true, data: () => ({                            // referrer, payout-ready
        affiliateStripeAccountId: 'acct_1', affiliateConnectStatus: 'active',
      }) });
    mockTransferCreate.mockRejectedValue(new Error('insufficient funds'));
  }

  it('captures the failure with the recurring-affiliate-transfer step at error level', async () => {
    arrangeFailedRecurringTransfer();

    await POST(makeRequest());

    const captured = captureForStep('recurring-affiliate-transfer');
    expect(captured).toBeDefined();
    expect((captured!.error as Error).message).toBe('insufficient funds');
    expect(captured!.context.level).toBe('error');
    expect(captured!.context.tags).toEqual(expect.objectContaining({
      money_path: 'true',
      stripe_event_type: 'invoice.payment_succeeded',
    }));
    // Identifiers sufficient to find the transfer in Stripe and the tenant in Firestore.
    expect(captured!.context.contexts.money_path).toEqual(expect.objectContaining({
      tenantId: 't1', stripeEventId: 'evt_inv_1', invoiceId: 'in_1',
      subscriptionId: 'sub_1', referrerId: 'ref1',
    }));
  });

  it('still returns 200 { received: true } and still banks the commission as pending', async () => {
    arrangeFailedRecurringTransfer();

    const res = await POST(makeRequest());

    // Unchanged behaviour: Stripe is told the event succeeded, exactly as before.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    // Unchanged behaviour: the commission is recorded pending for the retry sweep.
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      referrerId: 'ref1', tenantId: 't1', status: 'pending', type: 'recurring',
      stripeInvoiceId: 'in_1', commission: 1500,
    }));
    // Unchanged behaviour: the idempotency marker is NOT undone on a 200.
    expect(mockDocDelete).not.toHaveBeenCalled();
  });
});

// ── The receipt path ─────────────────────────────────────────────────────────
describe('donation receipt write failure', () => {
  const DONOR_EMAIL = 'jane.donor@example.com';
  const DONOR_NAME = 'Jane Donor';

  /**
   * A one-time partnership gift whose `invoices` donation-receipt write fails.
   * That write has no local catch, so it throws to the handler's outer catch —
   * which is the report for the whole uninstrumented middle of the handler.
   */
  function arrangeFailedReceiptWrite() {
    mockConstructEvent.mockReturnValue({
      id: 'evt_pi_1', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', amount_received: 5000, currency: 'usd',
        metadata: { type: 'partnership', tenantId: 't1', donorEmail: DONOR_EMAIL, donorName: DONOR_NAME } } },
    });
    mockDocGet
      .mockResolvedValueOnce({ exists: false })                                    // webhook_events dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Grace' }) });   // tenant (receipt)
    mockAdd
      .mockResolvedValueOnce({ id: 'contact_1' })                                  // CRM contact
      .mockResolvedValueOnce({ id: 'activity_1' })                                 // CRM activity
      .mockRejectedValueOnce(new Error('firestore unavailable'));                   // the receipt write
  }

  it('captures the failure with the stripe-webhook-handler step at error level', async () => {
    arrangeFailedReceiptWrite();

    await POST(makeRequest());

    const captured = captureForStep('stripe-webhook-handler');
    expect(captured).toBeDefined();
    expect((captured!.error as Error).message).toBe('firestore unavailable');
    expect(captured!.context.level).toBe('error');
    expect(captured!.context.contexts.money_path).toEqual({
      step: 'stripe-webhook-handler',
      stripeEventId: 'evt_pi_1',
      stripeEventType: 'payment_intent.succeeded',
    });
  });

  it('still returns 500 { error: "Webhook handler failed" } and still undoes the marker for retry', async () => {
    arrangeFailedReceiptWrite();

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Webhook handler failed' });
    // The load-bearing retry semantics: marker deleted so Stripe's retry re-processes.
    expect(mockDocDelete).toHaveBeenCalledTimes(1);
  });

  it('attaches no donor PII, even though the event carries the donor email and name', async () => {
    arrangeFailedReceiptWrite();

    await POST(makeRequest());

    const captured = captureForStep('stripe-webhook-handler')!;
    const serialized = JSON.stringify(captured.context);
    expect(serialized).not.toContain(DONOR_EMAIL);
    expect(serialized).not.toContain(DONOR_NAME);
    expect(serialized).not.toContain('5000');
    // No `extra`/`user` channel through which PII could arrive later either.
    expect(captured.context.extra).toBeUndefined();
    expect(captured.context.user).toBeUndefined();
  });
});

// ── Previously silent: the dispute charge lookup ──────────────────────────────
describe('dispute charge lookup failure (was swallowed with no log at all)', () => {
  function arrangeFailedChargeLookup() {
    mockConstructEvent.mockReturnValue({
      id: 'evt_dp_1', type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', metadata: {}, charge: 'ch_1' } },
    });
    mockChargeRetrieve.mockRejectedValue(new Error('no such charge'));
  }

  it('captures the failure with the dispute-charge-lookup step at error level', async () => {
    arrangeFailedChargeLookup();

    await POST(makeRequest());

    const captured = captureForStep('dispute-charge-lookup');
    expect(captured).toBeDefined();
    expect(captured!.context.level).toBe('error');
    expect(captured!.context.contexts.money_path).toEqual(expect.objectContaining({
      stripeEventId: 'evt_dp_1', disputeId: 'dp_1', chargeId: 'ch_1',
    }));
  });

  it('still returns 200 { received: true } and still leaves the tenant untouched', async () => {
    arrangeFailedChargeLookup();

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    // The tenant was never resolved, so — as before — nothing is marked disputed.
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });
});

// ── The 503 retry path must keep its exact contract ──────────────────────────
describe('subscription metadata load failure', () => {
  function arrangeFailedMetadataLoad() {
    mockConstructEvent.mockReturnValue({
      id: 'evt_cs_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', subscription: 'sub_x', metadata: {} } },
    });
    mockSubRetrieve.mockRejectedValue(new Error('stripe timeout'));
  }

  it('captures at warning level, since Stripe will redeliver the event', async () => {
    arrangeFailedMetadataLoad();

    await POST(makeRequest());

    const captured = captureForStep('subscription-metadata-load');
    expect(captured).toBeDefined();
    expect(captured!.context.level).toBe('warning');
    expect(captured!.context.contexts.money_path).toEqual(expect.objectContaining({
      stripeEventId: 'evt_cs_1', subscriptionId: 'sub_x',
    }));
  });

  it('still returns 503 with the exact same body, and still undoes the marker', async () => {
    arrangeFailedMetadataLoad();

    const res = await POST(makeRequest());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Could not load subscription metadata; will retry' });
    expect(mockDocDelete).toHaveBeenCalledTimes(1);
  });
});

describe('invoice.payment_succeeded subscription load failure', () => {
  function arrangeFailedInvoiceSubLoad() {
    mockConstructEvent.mockReturnValue({
      id: 'evt_inv_2', type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_2', amount_paid: 5000, currency: 'usd', subscription: 'sub_2', billing_reason: 'subscription_cycle' } },
    });
    mockSubRetrieve.mockRejectedValue(new Error('stripe timeout'));
  }

  it('captures at error level — the handler 200s, so nothing will retry it', async () => {
    arrangeFailedInvoiceSubLoad();

    await POST(makeRequest());

    const captured = captureForStep('invoice-payment-succeeded-subscription-load');
    expect(captured).toBeDefined();
    expect(captured!.context.level).toBe('error');
    expect(captured!.context.contexts.money_path).toEqual(expect.objectContaining({
      stripeEventId: 'evt_inv_2', subscriptionId: 'sub_2', invoiceId: 'in_2',
    }));
  });

  it('still returns 200 { received: true } with no tenant work done', async () => {
    arrangeFailedInvoiceSubLoad();

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

// ── No capture when nothing failed ───────────────────────────────────────────
describe('successful events are not reported', () => {
  it('captures nothing on a clean invoice.payment_succeeded with a paid commission', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_inv_3', type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_3', amount_paid: 10000, currency: 'usd', subscription: 'sub_3', billing_reason: 'subscription_cycle' } },
    });
    mockSubRetrieve.mockResolvedValue({ id: 'sub_3', metadata: { tenantId: 't1', referrerId: 'ref1', plan: 'pro' } });
    mockDocGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({
        affiliateStripeAccountId: 'acct_1', affiliateConnectStatus: 'active',
      }) });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(capturedSteps()).toEqual([]);
  });

  it('captures nothing on a redelivered (duplicate) event', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_inv_4', type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_4', amount_paid: 5000, subscription: 'sub_4' } },
    });
    mockDocGet.mockResolvedValueOnce({ exists: true }); // already processed

    const res = await POST(makeRequest());

    expect((await res.json()).duplicate).toBe(true);
    expect(capturedSteps()).toEqual([]);
  });
});
