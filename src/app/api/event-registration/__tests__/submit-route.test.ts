import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockCheckoutCreate } = vi.hoisted(() => ({
  mockCheckoutCreate: vi.fn(),
}));

const { mockVerifyAuth } = vi.hoisted(() => ({
  mockVerifyAuth: vi.fn(),
}));

// The route delegates all SMS behaviour to sendAutomatedSms — the single source
// of the per-trigger enabled flag, template text and smsLogs record. The route's
// only jobs are: call it with the right trigger/phone/tokens, and never let it
// affect the registration response.
const { mockSendAutomatedSms } = vi.hoisted(() => ({
  mockSendAutomatedSms: vi.fn().mockResolvedValue(undefined),
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

/**
 * ─── THE-351 — WHY THIS SUITE PINS THE RAIL BRANCH ON ─────────────────────────
 *
 * 🔴 THIS FILE IS THE RECORD OF THE STRIPE PATH, AND THAT PATH IS NOW DORMANT
 * RATHER THAN GONE.
 *
 * THE-351 un-gates paid tickets on MANUAL terms: while
 * `MANUAL_EVENT_PAYMENTS_ENABLED` is true and `PAID_EVENTS_ENABLED` is false,
 * the route registers a priced seat IMMEDIATELY as unpaid and never reaches
 * Checkout at all — the church collects through its own PayPal and confirms by
 * hand. With the shipped values, every assertion below would be testing a
 * branch nothing enters.
 *
 * ⚠️ DELETING THEM WOULD BE THE WRONG ANSWER, AND IT IS THE ANSWER THIS MOCK
 * EXISTS TO REFUSE. THE-345's whole discipline is that nothing is deleted to
 * hide a feature — "set the value to true and every surface comes back exactly
 * as it was" — and these tests are what makes that promise checkable. So the
 * suite pins `manualConfirmationMode()` OFF and keeps proving that the direct
 * charge, the platform fee, the metadata, the rollback and the free-ticket
 * bypass are all still exactly right for the day a rail returns.
 *
 * ⚠️ The same idiom `stripe-config-split.test.ts` already uses for
 * `@/lib/stripe-connect-feature`. THE-351's own coverage of the MANUAL branch
 * lives in `THE-351.manual-payment.*`.
 */
vi.mock('@/lib/paid-events-feature', async (orig) => {
  const real = await (orig() as Promise<Record<string, unknown>>);
  return { ...real, manualConfirmationMode: () => false };
});

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockCheckoutCreate } };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => makeCollRef()) },
}));

// The Connect account id moved to the server-only tenant_private doc — the
// route reads it via getTenantPrivate (plan still comes from the tenant doc).
const { mockGetTenantPrivate } = vi.hoisted(() => ({ mockGetTenantPrivate: vi.fn() }));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: mockGetTenantPrivate }));

// Identity link is resolved from the verified token, never the request body.
vi.mock('@/lib/api-auth', () => ({ verifyAuth: mockVerifyAuth }));

vi.mock('@/lib/sms-send', () => ({ sendAutomatedSms: mockSendAutomatedSms }));

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
  mockGetTenantPrivate.mockResolvedValue({ stripeConnectAccountId: 'acct_T' });
  mockCollGet.mockResolvedValue({ docs: [] });
  // .add() returns a DocumentReference (has .id AND .delete() for rollback).
  mockAdd.mockResolvedValue({ id: 'pending1', delete: mockDocDelete });
  mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' });
  // Default: logged-out visitor (no token) → verifyAuth returns null.
  mockVerifyAuth.mockResolvedValue(null);
  mockSendAutomatedSms.mockResolvedValue(undefined);
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

    // DIRECT charge on the tenant's connected account (THE-154), platform fee
    // 0% — the whole ticket price goes to the church, and so does the dispute
    // liability. The charge-type claims themselves are pinned in
    // submit-direct-charge.test.ts.
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        success_url: expect.stringContaining('/event/e1?registration=success'),
        cancel_url: expect.stringContaining('/event/e1?registration=cancel'),
        payment_intent_data: expect.objectContaining({
          application_fee_amount: 0,
          metadata: expect.objectContaining({ type: 'event_registration', registrationId: 'pending1' }),
        }),
        metadata: expect.objectContaining({
          type: 'event_registration', tenantId: 't1', eventId: 'e1', ticketTypeId: 'tt1', registrationId: 'pending1',
        }),
      }),
      { stripeAccount: 'acct_T' },
    );
  });

  it('deducts NOTHING on Small Team (pro) — the same PLATFORM_FEE_MAP the donation path uses', async () => {
    // The paid-ticket half of the shared-fee guarantee. `PLATFORM_FEE_MAP` feeds
    // BOTH this route and /api/stripe/donate, so a fee change lands on tickets
    // and donations together — intended, and pinned on both sides. The donation
    // side lives in src/app/api/stripe/__tests__/donate-platform-fee.test.ts.
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => PAID_EVENT }) // event
      .mockResolvedValueOnce({ exists: true, data: () => ({ stripeConnectAccountId: 'acct_T', plan: 'pro' }) }); // tenant

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(200);
    // $50.00 ticket → $0.00 platform fee, the full $50.00 to the church.
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent_data: expect.objectContaining({ application_fee_amount: 0 }),
      }),
      expect.anything(),
    );
  });

  it('deducts nothing on Ministry (max) either — 0% on every tier', async () => {
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => PAID_EVENT })
      .mockResolvedValueOnce({ exists: true, data: () => ({ stripeConnectAccountId: 'acct_T', plan: 'max' }) });
    await POST(makeRequest(baseBody));
    expect(mockCheckoutCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payment_intent_data: expect.objectContaining({ application_fee_amount: 0 }),
      }),
      expect.anything(),
    );
  });

  it('returns a clean 400 (never a free confirmation) when the tenant has no Connect account', async () => {
    mockGetTenantPrivate.mockResolvedValue({}); // no stripeConnectAccountId
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => PAID_EVENT }) // event
      .mockResolvedValueOnce({ exists: true, data: () => ({ plan: 'plus' }) }); // tenant

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

describe('POST /api/event-registration/submit — multi-attendee quantity (BUG 5)', () => {
  it('charges price × headcount and records quantity for a paid multi-attendee registration', async () => {
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => PAID_EVENT }) // event
      .mockResolvedValueOnce({ exists: true, data: () => ({ stripeConnectAccountId: 'acct_T', plan: 'plus' }) }); // tenant

    const res = await POST(makeRequest({ ...baseBody, additionalAttendees: [{ name: 'Bob Lee' }] }));
    expect(res.status).toBe(200);

    // 2 attendees × $50 = $100 charge; pending reg records quantity 2 (not 1).
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_payment', amount: 10000, quantity: 2 }),
    );
    // The charge reflects the full headcount; the platform fee is 0 on every
    // tier, so it stays 0 however many attendees are on the registration.
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent_data: expect.objectContaining({ application_fee_amount: 0 }),
        line_items: [expect.objectContaining({
          price_data: expect.objectContaining({ unit_amount: 10000 }),
        })],
      }),
      expect.anything(),
    );
  });

  it('ignores blank additional-attendee rows (no phantom seats or charge)', async () => {
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => PAID_EVENT })
      .mockResolvedValueOnce({ exists: true, data: () => ({ stripeConnectAccountId: 'acct_T', plan: 'plus' }) });

    const res = await POST(makeRequest({ ...baseBody, additionalAttendees: [{ name: '   ' }, { name: '' }] }));
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_payment', amount: 5000, quantity: 1 }),
    );
  });

  it('a free event still works with multiple attendees ($0, quantity reflects headcount)', async () => {
    const freeEvent = { ...PAID_EVENT, ticketTypes: [{ id: 'tt1', name: 'Free', price: 0, capacity: null, order: 0 }] };
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => freeEvent });

    const res = await POST(makeRequest({ ...baseBody, additionalAttendees: [{ name: 'Bob' }, { name: 'Cara' }] }));
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed', amount: 0, quantity: 3 }),
    );
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('counts SEATS for capacity — a party that does not fit is rejected (no waitlist)', async () => {
    const capEvent = {
      ...PAID_EVENT,
      ticketTypes: [{ id: 'tt1', name: 'General', price: 5000, capacity: 3, order: 0 }],
      waitlistEnabled: false,
    };
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => capEvent }); // event
    // 2 seats already confirmed (one couple). A new couple (2) → 2 + 2 = 4 > 3.
    mockCollGet.mockResolvedValueOnce({
      docs: [{ data: () => ({ ticketTypeId: 'tt1', status: 'confirmed', quantity: 2 }) }],
    });

    const res = await POST(makeRequest({ ...baseBody, additionalAttendees: [{ name: 'Bob' }] }));
    expect(res.status).toBe(410);
    expect((await res.json()).error).toMatch(/sold out/i);
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('POST /api/event-registration/submit — automated SMS (event_registration trigger)', () => {
  // Mid-day UTC so the date renders as Aug 2 in any plausible test timezone.
  const FREE_EVENT = {
    ...PAID_EVENT,
    title: 'Summer Picnic',
    startDate: { toDate: () => new Date('2026-08-02T12:00:00Z') },
    ticketTypes: [{ id: 'tt1', name: 'Free', price: 0, capacity: null, order: 0 }],
  };

  it('fires the trigger with {name}/{event}/{date} when a phone was supplied', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => FREE_EVENT });

    const res = await POST(makeRequest({ ...baseBody, phone: '+15551234567' }));
    expect(res.status).toBe(200);

    expect(mockSendAutomatedSms).toHaveBeenCalledTimes(1);
    expect(mockSendAutomatedSms).toHaveBeenCalledWith(
      't1',
      'event_registration',
      '+15551234567',
      { name: 'Sam', event: 'Summer Picnic', date: 'Aug 2, 2026' },
    );
  });

  it('does NOT fire when the (optional) phone is absent', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => FREE_EVENT });

    const res = await POST(makeRequest(baseBody)); // no phone field
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockSendAutomatedSms).not.toHaveBeenCalled();
  });

  it('does NOT fire when the phone is blank/whitespace', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => FREE_EVENT });

    const res = await POST(makeRequest({ ...baseBody, phone: '   ' }));
    expect(res.status).toBe(200);
    expect(mockSendAutomatedSms).not.toHaveBeenCalled();
  });

  it('does NOT fire for a waitlisted entry — the template says "you\'re registered"', async () => {
    const capEvent = {
      ...FREE_EVENT,
      ticketTypes: [{ id: 'tt1', name: 'Free', price: 0, capacity: 1, order: 0 }],
      waitlistEnabled: true,
    };
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => capEvent });
    mockCollGet.mockResolvedValueOnce({
      docs: [{ data: () => ({ ticketTypeId: 'tt1', status: 'confirmed', quantity: 1 }) }],
    });

    const res = await POST(makeRequest({ ...baseBody, phone: '+15551234567' }));
    expect(res.status).toBe(200);
    expect((await res.json()).waitlisted).toBe(true);
    expect(mockSendAutomatedSms).not.toHaveBeenCalled();
  });

  it('does not add its own enable check — the trigger being off is sendAutomatedSms\'s job', async () => {
    // A disabled trigger is a no-op INSIDE sendAutomatedSms (see twilio.test.ts).
    // The route must still call it unconditionally, or the trigger would be
    // double-gated and impossible to turn on.
    mockSendAutomatedSms.mockResolvedValue(undefined);
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => FREE_EVENT });

    await POST(makeRequest({ ...baseBody, phone: '+15551234567' }));
    expect(mockSendAutomatedSms).toHaveBeenCalledTimes(1);
  });

  it('a failed send does not break or alter the registration response', async () => {
    // sendAutomatedSms swallows Twilio failures (logs status:'failed') and
    // resolves — the registration must be entirely unaffected.
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => FREE_EVENT });

    const res = await POST(makeRequest({ ...baseBody, phone: '+15551234567' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.ticketCode).toBeTruthy();
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed', phone: '+15551234567' }),
    );
  });

  it('is not attempted on the paid path — the webhook confirms those, not this route', async () => {
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => PAID_EVENT })
      .mockResolvedValueOnce({ exists: true, data: () => ({ stripeConnectAccountId: 'acct_T', plan: 'plus' }) });

    const res = await POST(makeRequest({ ...baseBody, phone: '+15551234567' }));
    expect(res.status).toBe(200);
    expect(mockSendAutomatedSms).not.toHaveBeenCalled();
  });
});

describe('POST /api/event-registration/submit — userId identity link', () => {
  const freeEvent = {
    ...PAID_EVENT,
    ticketTypes: [{ id: 'tt1', name: 'Free', price: 0, capacity: null, order: 0 }],
  };

  it('stamps the VERIFIED userId on a free confirmed registration when authenticated', async () => {
    mockVerifyAuth.mockResolvedValue({ uid: 'user_9', email: 'sam@example.com' });
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => freeEvent });

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed', amount: 0, userId: 'user_9' }),
    );
  });

  it('stamps the verified userId on the pending doc AND the Checkout metadata for a paid ticket', async () => {
    mockVerifyAuth.mockResolvedValue({ uid: 'user_9', email: 'sam@example.com' });
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => PAID_EVENT }) // event
      .mockResolvedValueOnce({ exists: true, data: () => ({ stripeConnectAccountId: 'acct_T', plan: 'plus' }) }); // tenant

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(200);

    // Pending reg carries the uid…
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_payment', userId: 'user_9' }),
    );
    // …and so does the Checkout metadata, so the webhook keeps it on confirm.
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ userId: 'user_9' }),
        payment_intent_data: expect.objectContaining({
          metadata: expect.objectContaining({ userId: 'user_9' }),
        }),
      }),
      expect.anything(),
    );
  });

  it('leaves userId null for a logged-out registration (public path unchanged)', async () => {
    mockVerifyAuth.mockResolvedValue(null);
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => freeEvent });

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', userId: null }));
  });

  it('NEVER trusts a client-sent userId — only the verified token counts', async () => {
    mockVerifyAuth.mockResolvedValue(null); // no valid token
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => freeEvent });

    // Attacker tries to inject someone else's uid in the body.
    const res = await POST(makeRequest({ ...baseBody, userId: 'victim_uid' }));
    expect(res.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
    expect(mockAdd).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'victim_uid' }));
  });
});
