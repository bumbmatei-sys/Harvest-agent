import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockConstructEvent, mockSubRetrieve } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockSubRetrieve: vi.fn(),
}));
const { mockDocGet, mockDocSet, mockDocUpdate, mockDocDelete, mockCollGet, mockAdd, mockIssueReceipt } =
  vi.hoisted(() => ({
    mockDocGet: vi.fn(),
    mockDocSet: vi.fn().mockResolvedValue(undefined),
    mockDocUpdate: vi.fn().mockResolvedValue(undefined),
    mockDocDelete: vi.fn().mockResolvedValue(undefined),
    mockCollGet: vi.fn().mockResolvedValue({ docs: [] }),
    mockAdd: vi.fn().mockResolvedValue({ id: 'inv_new' }),
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
    transfers = { create: vi.fn() };
    charges = { retrieve: vi.fn() };
    refunds = { create: vi.fn() };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => makeCollRef()) },
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollGet.mockResolvedValue({ docs: [] });
  mockAdd.mockResolvedValue({ id: 'inv_new' });
});

describe('donation receipt wiring — one-time payment_intent.succeeded', () => {
  it('creates the invoice and calls issueDonationReceipt with cents + the invoice ref', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_pi_1', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', amount_received: 5000, currency: 'usd',
        metadata: { type: 'partnership', tenantId: 't1', donorUserId: 'u1', donorEmail: 'sam@x.co', donorName: 'Sam' } } },
    });
    mockDocGet
      .mockResolvedValueOnce({ exists: false })                                   // webhook_events dedup → new
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 't1' }) })  // donor user
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Grace' }) });  // tenant (receipt)

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // Invoice still created in CENTS.
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'donation_receipt', amount: 5000, status: 'pending' }),
    );
    // Receipt helper invoked with cents + the created invoice ref.
    expect(mockIssueReceipt).toHaveBeenCalledTimes(1);
    const arg = mockIssueReceipt.mock.calls[0][0];
    expect(arg).toEqual(expect.objectContaining({
      tenantId: 't1', donorEmail: 'sam@x.co', amountCents: 5000, currency: 'usd',
    }));
    expect(arg.invoiceRef).toEqual({ id: 'inv_new' });
  });

  it('does not fire a receipt on a redelivered (duplicate) event', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_pi_1', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', amount_received: 5000, currency: 'usd',
        metadata: { type: 'partnership', tenantId: 't1', donorEmail: 'sam@x.co' } } },
    });
    mockDocGet.mockResolvedValueOnce({ exists: true }); // already processed

    const res = await POST(makeRequest());
    expect((await res.json()).duplicate).toBe(true);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockIssueReceipt).not.toHaveBeenCalled();
  });
});

describe('donation receipt wiring — recurring first partnership charge (checkout.session.completed)', () => {
  it('creates the invoice and calls issueDonationReceipt for the monthly partnership', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_cs_1', type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_1', mode: 'subscription', subscription: 'sub_1',
        amount_total: 2500, customer_details: { email: 'partner@x.co' },
        metadata: { type: 'partnership', tenantId: 't1', donorUserId: 'u2', donorEmail: 'partner@x.co', donorName: 'Pat' },
      } },
    });
    mockSubRetrieve.mockResolvedValue({
      id: 'sub_1', currency: 'usd',
      metadata: { type: 'partnership', tenantId: 't1', donorUserId: 'u2', donorEmail: 'partner@x.co' },
      items: { data: [{ price: { unit_amount: 2500 } }] },
    });
    // tenant lookups return a church name; user/other docs default to exists:false.
    mockDocGet.mockImplementation(async () => ({ exists: true, data: () => ({ name: 'Grace' }) }));
    mockDocGet.mockResolvedValueOnce({ exists: false }); // webhook_events dedup → new

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // A donation_receipt invoice was created in CENTS and the helper was called.
    const receiptInvoice = mockAdd.mock.calls.find(([a]) => (a as any)?.type === 'donation_receipt');
    expect(receiptInvoice?.[0]).toEqual(expect.objectContaining({ amount: 2500, status: 'pending' }));
    expect(mockIssueReceipt).toHaveBeenCalledTimes(1);
    expect(mockIssueReceipt.mock.calls[0][0]).toEqual(expect.objectContaining({
      tenantId: 't1', donorEmail: 'partner@x.co', amountCents: 2500,
    }));
  });
});
