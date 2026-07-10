import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockConstructEvent, mockRefundsCreate } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockRefundsCreate: vi.fn().mockResolvedValue({ id: 're_1' }),
}));

const { mockDocGet, mockDocSet, mockDocUpdate, mockDocDelete, mockCollGet, mockAdd } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
  mockDocDelete: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn().mockResolvedValue({ docs: [] }),
  mockAdd: vi.fn().mockResolvedValue({ id: 'act1' }),
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
    refunds = { create: mockRefundsCreate };
    subscriptions = { retrieve: vi.fn(), cancel: vi.fn(), update: vi.fn() };
    customers = { retrieve: vi.fn() };
    transfers = { create: vi.fn() };
    charges = { retrieve: vi.fn() };
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
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,x') } }));

const { POST } = await import('../webhook/route');

function makeRequest(): NextRequest {
  return new NextRequest('https://example.com/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}',
  });
}
function makeEvent(type: string, object: object, id = 'evt_reg_1') {
  return { id, type, data: { object } };
}

const REG_META = {
  type: 'event_registration', tenantId: 't1', eventId: 'e1', ticketTypeId: 'tt1',
  registrationId: 'reg1', discountCode: '',
};
const completedSession = (over: Record<string, unknown> = {}) => ({
  id: 'cs_1', subscription: null, payment_intent: 'pi_123', amount_total: 5000,
  metadata: REG_META, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
  delete process.env.RESEND_API_KEY;
  mockCollGet.mockResolvedValue({ docs: [] });
});

describe('webhook — paid event ticket confirmation', () => {
  it('confirms the pending registration on checkout.session.completed', async () => {
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', completedSession()));
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // webhook_events dedup → new
      .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'pending_payment', email: 'a@b.co', firstName: 'Sam', ticketCode: 'ABC123', amount: 5000 }) }) // reg
      .mockResolvedValueOnce({ exists: true, data: () => ({ title: 'Gala', ticketTypes: [{ id: 'tt1', name: 'GA', capacity: null }] }) }); // event

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed', stripePaymentIntentId: 'pi_123', amountPaid: 5000 }),
    );
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('does NOT re-confirm on redelivery (webhook_events dedup)', async () => {
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', completedSession()));
    mockDocGet.mockResolvedValueOnce({ exists: true }); // already processed

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  it('no-ops when the registration is already confirmed (defense-in-depth)', async () => {
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', completedSession()));
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'confirmed' }) }); // reg already confirmed

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).not.toHaveBeenCalled(); // no second confirm
    expect(mockRefundsCreate).not.toHaveBeenCalled(); // and no refund
  });

  it('refunds (idempotently) and cancels when the event sold out during checkout — never keeps the money', async () => {
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', completedSession()));
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'pending_payment', email: 'a@b.co', amount: 5000 }) }) // reg
      .mockResolvedValueOnce({ exists: true, data: () => ({ title: 'Gala', ticketTypes: [{ id: 'tt1', name: 'GA', capacity: 1 }] }) }); // event, cap 1
    // Capacity re-check query → already 1 confirmed seat for this type.
    mockCollGet.mockResolvedValue({ docs: [{ data: () => ({ ticketTypeId: 'tt1', status: 'confirmed' }) }] });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_123' },
      expect.objectContaining({ idempotencyKey: 'evt_reg_refund_reg1' }),
    );
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled', refunded: true, refundReason: 'sold_out' }),
    );
    expect(mockDocUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
  });

  it('marks a pending registration expired on checkout.session.expired', async () => {
    mockConstructEvent.mockReturnValue(makeEvent('checkout.session.expired', { id: 'cs_1', metadata: REG_META }));
    mockDocGet
      .mockResolvedValueOnce({ exists: false }) // dedup
      .mockResolvedValueOnce({ exists: true, data: () => ({ status: 'pending_payment' }) }); // reg

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});
