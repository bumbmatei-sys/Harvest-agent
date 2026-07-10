import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockCheckoutCreate } = vi.hoisted(() => ({
  mockCheckoutCreate: vi.fn(),
}));

const { mockDocGet, mockDocSet, mockDocUpdate, mockDocDelete, mockCollGet, mockAdd } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
  mockDocDelete: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn().mockResolvedValue({ docs: [] }),
  mockAdd: vi.fn().mockResolvedValue({ id: 'pending1' }),
}));

// Recursive doc/collection mock so nested subcollections
// (tenants/{id}/registrations/{id}, tenants/{id}/events/{id}) resolve.
function makeCollRef(): any {
  const coll: any = {
    doc: vi.fn(() => makeDocRef()),
    add: mockAdd,
    get: mockCollGet,
  };
  coll.where = vi.fn(() => coll);
  coll.limit = vi.fn(() => coll);
  coll.orderBy = vi.fn(() => coll);
  return coll;
}
function makeDocRef(): any {
  return {
    get: mockDocGet,
    set: mockDocSet,
    update: mockDocUpdate,
    delete: mockDocDelete,
    collection: vi.fn(() => makeCollRef()),
  };
}

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockCheckoutCreate } };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => makeCollRef()) },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
}));

// Email + QR are best-effort and gated on RESEND_API_KEY (left unset in tests).
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,x') } }));

const { POST } = await import('../submit/route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://grace.theharvest.app/api/event-registration/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'grace.theharvest.app' },
    body: JSON.stringify(body),
  });
}

const PAID_EVENT = {
  status: 'published',
  registrationEnabled: true,
  title: 'Benefit Gala',
  ticketTypes: [{ id: 'tt1', name: 'General', price: 5000, capacity: null, order: 0 }],
  waitlistEnabled: false,
};

const baseBody = {
  tenantId: 't1', eventId: 'e1', ticketTypeId: 'tt1',
  firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  delete process.env.RESEND_API_KEY;
  mockCollGet.mockResolvedValue({ docs: [] });
  // .add() returns a DocumentReference (has .id AND .delete() for rollback).
  mockAdd.mockResolvedValue({ id: 'pending1', delete: mockDocDelete });
  mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' });
});

describe('POST /api/event-registration/submit — paid tickets', () => {
  it('creates a Stripe Checkout session + pending_payment reg, returns the url, and does NOT confirm', async () => {
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => PAID_EVENT }) // event
      .mockResolvedValueOnce({ exists: true, data: () => ({ stripeConnectAccountId: 'acct_T', plan: 'plus' }) }); // tenant

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.test/cs_1' });

    // The registration is written as pending — never confirmed here.
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_payment', amount: 5000, waitlisted: false }),
    );
    expect(mockAdd).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));

    // Destination charge to the tenant's connected account, platform fee 15% (plus).
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        success_url: expect.stringContaining('/event/e1?registration=success'),
        cancel_url: expect.stringContaining('/event/e1?registration=cancel'),
        payment_intent_data: expect.objectContaining({
          transfer_data: { destination: 'acct_T' },
          application_fee_amount: 750,
          metadata: expect.objectContaining({ type: 'event_registration', registrationId: 'pending1' }),
        }),
        metadata: expect.objectContaining({
          type: 'event_registration', tenantId: 't1', eventId: 'e1', ticketTypeId: 'tt1', registrationId: 'pending1',
        }),
      }),
    );
  });

  it('returns a clean 400 (never a free confirmation) when the tenant has no Connect account', async () => {
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => PAID_EVENT }) // event
      .mockResolvedValueOnce({ exists: true, data: () => ({ plan: 'plus' }) }); // tenant, no stripeConnectAccountId

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/set up payments/i);
    // No charge attempted and no registration written at all.
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('rolls back the pending registration if Checkout session creation fails', async () => {
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => PAID_EVENT })
      .mockResolvedValueOnce({ exists: true, data: () => ({ stripeConnectAccountId: 'acct_T', plan: 'pro' }) });
    mockCheckoutCreate.mockRejectedValueOnce(new Error('stripe down'));

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(500);
    expect(mockAdd).toHaveBeenCalledTimes(1);      // pending written…
    expect(mockDocDelete).toHaveBeenCalledTimes(1); // …then rolled back
  });
});

describe('POST /api/event-registration/submit — free tickets (unchanged)', () => {
  it('confirms a $0 ticket immediately and returns the ticket code (no Stripe)', async () => {
    const freeEvent = {
      ...PAID_EVENT,
      ticketTypes: [{ id: 'tt1', name: 'Free', price: 0, capacity: null, order: 0 }],
    };
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => freeEvent });

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.ticketCode).toBeTruthy();
    expect(body.waitlisted).toBe(false);

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', amount: 0 }));
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('treats a ticket discounted to $0 as free (no Stripe)', async () => {
    const discountEvent = {
      ...PAID_EVENT,
      discountCodes: [{ code: 'FREE100', type: 'percent', value: 100, maxUses: null, usedCount: 0 }],
    };
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => discountEvent });

    const res = await POST(makeRequest({ ...baseBody, discountCode: 'FREE100' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', amount: 0 }));
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });
});
