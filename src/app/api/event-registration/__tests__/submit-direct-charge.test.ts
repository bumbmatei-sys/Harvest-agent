import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-154 — a paid event ticket must be charged ON THE CHURCH, not on Harvest.
 *
 * Tickets were the LAST destination charge in the codebase. The card was charged
 * on the Harvest platform account and the money swept to the church via
 * `transfer_data.destination`, which is exactly what Stripe says it is: "If you
 * want your platform to be responsible for Stripe fees, refunds, and chargebacks,
 * use destination charges." So a disputed TICKET was debited from HARVEST's
 * balance — on a sale Harvest earns 0% of — and Harvest was the merchant of
 * record on every ministry's ticket sales.
 *
 * DIRECT charges fix both. Stripe: "For connected accounts that use direct
 * charges, Stripe always attempts to debit disputed amounts from the connected
 * account's balance." The Checkout Session is created AS the connected account —
 * the `Stripe-Account` header, i.e. the `{ stripeAccount }` request-options
 * argument — and there is no transfer, because the money is already the church's.
 * PR 316 did precisely this for donations (donate-direct-charge.test.ts); this is
 * the same change for the one money path it was scoped away from.
 *
 * ⚠️ The other half of THE-154 is the WEBHOOK: a session created on the connected
 * account completes on the Connect endpoint, so the handler that confirms the
 * registration moved with it. That half is pinned in
 * src/app/api/stripe/__tests__/connect-webhook-event-registration.test.ts.
 *
 * ─── What is real here and what is faked ────────────────────────────────────
 *
 * Mocked: the Stripe client, Firebase, `getTenantPrivate`, `verifyAuth` (which is
 * Firebase token verification), Twilio, Resend and QRCode.
 *
 * NOT mocked, deliberately: `@/lib/stripe-connect` — the REAL `PLATFORM_FEE_MAP`.
 * The no-regression test below is worthless against a fabricated fee table; it has
 * to pin the fee an attendee is actually charged.
 *
 * Targets are named by LABEL, never by value pattern. A regex for `acct_` cannot
 * tell the request-options scope from a `transfer_data.destination` — and those
 * two being different is the entire point of this change.
 */

// ── The account, named so assertions read as claims ──────────────────────────
/** The church's own Stripe Connect account — who the ticket is charged ON. */
const CHURCH_ACCOUNT = 'acct_church_grace';
/** $50.00, in MINOR UNITS. The route takes cents; only the email renders dollars. */
const TICKET_CENTS = 5000;

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockCheckoutCreate } = vi.hoisted(() => ({ mockCheckoutCreate: vi.fn() }));
const { mockVerifyAuth } = vi.hoisted(() => ({ mockVerifyAuth: vi.fn() }));
const { mockGetTenantPrivate } = vi.hoisted(() => ({ mockGetTenantPrivate: vi.fn() }));
const { mockSendAutomatedSms } = vi.hoisted(() => ({ mockSendAutomatedSms: vi.fn() }));
const { mockDocGet, mockDocSet, mockDocUpdate, mockDocDelete, mockCollGet, mockAdd } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
  mockDocDelete: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn(),
  mockAdd: vi.fn(),
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

vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn(() => makeCollRef()) } }));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: mockGetTenantPrivate }));
vi.mock('@/lib/api-auth', () => ({ verifyAuth: mockVerifyAuth }));
vi.mock('@/lib/sms-send', () => ({ sendAutomatedSms: mockSendAutomatedSms }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
}));
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

/** The Checkout Session PARAMS — what is being bought. */
const lastSessionArgs = () => mockCheckoutCreate.mock.calls[0][0] as any;
/**
 * The Checkout Session REQUEST OPTIONS — WHO the session is created as. This is
 * the second positional argument; stripe-node turns `stripeAccount` into the
 * `Stripe-Account` header, and that header is what makes the charge direct.
 */
const lastRequestOptions = () => mockCheckoutCreate.mock.calls[0][1] as any;

const PAID_EVENT = {
  status: 'published',
  registrationEnabled: true,
  title: 'Benefit Gala',
  ticketTypes: [{ id: 'tt1', name: 'General', price: TICKET_CENTS, capacity: null, order: 0 }],
  waitlistEnabled: false,
};

const baseBody = {
  tenantId: 't1', eventId: 'e1', ticketTypeId: 'tt1',
  firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com',
};

/** Seed the reads a paid registration makes: the event doc, then the tenant doc. */
function seedPaid(plan = 'plus', event: object = PAID_EVENT) {
  mockDocGet
    .mockResolvedValueOnce({ exists: true, data: () => event })       // event
    .mockResolvedValueOnce({ exists: true, data: () => ({ plan }) }); // tenant (plan only)
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  delete process.env.RESEND_API_KEY;
  // The Connect account id lives on the server-only tenant_private doc.
  mockGetTenantPrivate.mockResolvedValue({ stripeConnectAccountId: CHURCH_ACCOUNT });
  mockCollGet.mockResolvedValue({ docs: [] });
  // .add() returns a DocumentReference (has .id AND .delete() for rollback).
  mockAdd.mockResolvedValue({ id: 'pending1', delete: mockDocDelete });
  mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' });
  mockVerifyAuth.mockResolvedValue(null);
  mockSendAutomatedSms.mockResolvedValue(undefined);
});

describe('POST /api/event-registration/submit — charged on the church (THE-154)', () => {
  it('a paid ticket is charged on the church, not on the platform', async () => {
    seedPaid();
    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(200);

    // 🔴 The session is created AS the church. Without this the charge lands on
    // the platform account and Harvest wears the chargeback on a ticket it
    // earns nothing from.
    expect(lastRequestOptions()).toEqual({ stripeAccount: CHURCH_ACCOUNT });
  });

  it('no transfer_data is sent', async () => {
    // 🔴 THE REGRESSION TEST. `transfer_data` is what made this a DESTINATION
    // charge — money taken on the platform and swept over, with the platform
    // carrying fees, refunds and chargebacks. On a direct charge there is
    // nothing to transfer: the funds are the church's when the card clears.
    // Sending both is not "belt and braces", it is the old charge type back.
    seedPaid();
    await POST(makeRequest(baseBody));
    expect(lastSessionArgs().payment_intent_data).not.toHaveProperty('transfer_data');
    // And not smuggled in at the top level either.
    expect(lastSessionArgs()).not.toHaveProperty('transfer_data');
  });

  it('no on_behalf_of is sent', async () => {
    // `on_behalf_of` names a settlement merchant on an INDIRECT charge. On a
    // direct charge the connected account already IS the merchant, so the
    // parameter is meaningless here — the same conclusion PR 316 reached for
    // donations. It was never on this route; it must not arrive as a
    // "replacement" for transfer_data.
    seedPaid();
    await POST(makeRequest(baseBody));
    expect(lastSessionArgs().payment_intent_data).not.toHaveProperty('on_behalf_of');
  });

  it('the platform fee is unchanged from what it was before', async () => {
    // 🔴 THE NO-REGRESSION TEST. PLATFORM_FEE_MAP is the REAL one — every tier
    // is 0, and moving to direct charges must not have disturbed that on any of
    // them. Direct charges support application fees exactly as destination
    // charges did; what changed is who is charged, not what Harvest keeps.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      mockCheckoutCreate.mockClear();
      mockDocGet.mockReset();
      seedPaid(plan);
      await POST(makeRequest(baseBody));
      expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);
    }

    // And zero is a RATE, not a rounding artifact: at any non-zero rate a
    // $10,000 ticket order would carry a fee that Math.round cannot hide.
    mockCheckoutCreate.mockClear();
    mockDocGet.mockReset();
    seedPaid('max', {
      ...PAID_EVENT,
      ticketTypes: [{ id: 'tt1', name: 'Table', price: 1_000_000, capacity: null, order: 0 }],
    });
    await POST(makeRequest(baseBody));
    expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);
  });

  it('the fee mechanism itself is unchanged — a fixed amount, not a percent', async () => {
    // A one-time payment takes `application_fee_amount`; `application_fee_percent`
    // is the subscription-only parameter (the donate route's monthly branch).
    // Swapping them here would silently stop charging the fee at all, which is
    // invisible while the rate is 0.
    seedPaid();
    await POST(makeRequest(baseBody));
    const paymentIntent = lastSessionArgs().payment_intent_data;
    expect(paymentIntent).toHaveProperty('application_fee_amount');
    expect(paymentIntent).not.toHaveProperty('application_fee_percent');
  });

  it('every metadata key the handler reads is unchanged', async () => {
    // The webhook handler reads exactly these to finalize the registration. It
    // MOVED ENDPOINTS in this change; the keys it reads did NOT. `userId` is
    // carried so the handler can retain it even if the pending doc is re-created.
    mockVerifyAuth.mockResolvedValue({ uid: 'user_9', email: 'sam@example.com' });
    seedPaid('plus', {
      ...PAID_EVENT,
      discountCodes: [{ code: 'EARLY', type: 'fixed', value: 500, maxUses: null, usedCount: 0 }],
    });

    await POST(makeRequest({ ...baseBody, discountCode: 'EARLY' }));
    const expected = {
      type: 'event_registration',
      tenantId: 't1',
      eventId: 'e1',
      ticketTypeId: 'tt1',
      registrationId: 'pending1',
      discountCode: 'EARLY',
      userId: 'user_9',
    };
    // Both copies: the session's own metadata is what
    // `checkout.session.completed` carries, and the PaymentIntent's is what any
    // charge-level lookup sees. They were identical before and stay identical.
    expect(lastSessionArgs().metadata).toEqual(expected);
    expect(lastSessionArgs().payment_intent_data.metadata).toEqual(expected);

    // Nothing about the charge type leaked into metadata — the account scope is
    // a request header, not a key the handler has to learn.
    expect(lastSessionArgs().metadata).not.toHaveProperty('stripeAccount');
  });

  it('the amount is still minor units and still a single line item', async () => {
    // 🔴 The single-line-item design is deliberate: `quantity: 1` with a NET unit
    // amount (price × headcount − discount) keeps the charge and the fee exact
    // when a discount applies. A real `quantity` would reintroduce the rounding
    // this avoids. And `unit_amount` is CENTS — this class of bug has shipped as
    // a 100× error before.
    seedPaid('plus', {
      ...PAID_EVENT,
      discountCodes: [{ code: 'EARLY', type: 'fixed', value: 500, maxUses: null, usedCount: 0 }],
    });

    // 2 attendees × $50.00 − $5.00 discount = $95.00.
    await POST(makeRequest({
      ...baseBody, discountCode: 'EARLY', additionalAttendees: [{ name: 'Bob Lee' }],
    }));

    const lineItems = lastSessionArgs().line_items;
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].quantity).toBe(1);
    expect(lineItems[0].price_data.unit_amount).toBe(9500);
    expect(lineItems[0].price_data.currency).toBe('usd');
  });

  it('the price stays inline — nothing has to exist on the church’s account first', async () => {
    // A `price` ID would have to be provisioned on the connected account before
    // the first ticket could be sold. `price_data` creates the Price and Product
    // on whichever account the session is created on, so a church can sell a
    // ticket the moment it finishes onboarding. (PR 316 established this for
    // donations; a direct charge does not change it.)
    seedPaid();
    await POST(makeRequest(baseBody));
    const lineItem = lastSessionArgs().line_items[0];
    expect(lineItem).toHaveProperty('price_data');
    expect(lineItem).not.toHaveProperty('price');
    // No pre-existing Customer either — only a `customer_email` prefill.
    expect(lastSessionArgs()).not.toHaveProperty('customer');
  });

  it('a failed session still deletes the orphaned pending registration', async () => {
    // The pending doc is written BEFORE the session so the metadata can carry its
    // id. If Checkout then fails, that row must not linger as a registration
    // nobody can pay for. Unchanged by the charge-type move — and worth pinning,
    // because the failure now happens on a different account.
    seedPaid('pro');
    mockCheckoutCreate.mockRejectedValueOnce(new Error('stripe down'));

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(500);
    expect(mockAdd).toHaveBeenCalledTimes(1);       // pending written…
    expect(mockDocDelete).toHaveBeenCalledTimes(1); // …then rolled back
  });

  it('a free ticket path is unaffected — no Stripe at all, confirmed immediately', async () => {
    // A $0 ticket never touches Connect, so the charge type cannot reach it. It
    // is still confirmed inline with a ticket code, exactly as before.
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ...PAID_EVENT, ticketTypes: [{ id: 'tt1', name: 'Free', price: 0, capacity: null, order: 0 }] }),
    });

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.ticketCode).toBeTruthy();
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', amount: 0 }));
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('a ticket discounted to $0 is free too — still no Stripe', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        ...PAID_EVENT,
        discountCodes: [{ code: 'FREE100', type: 'percent', value: 100, maxUses: null, usedCount: 0 }],
      }),
    });

    const res = await POST(makeRequest({ ...baseBody, discountCode: 'FREE100' }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('a church with no Connect account is refused — never charged on the platform instead', async () => {
    // There is no platform fallback for a direct charge, and there must not be
    // one: charging the attendee on Harvest's account is the defect, not a
    // graceful degradation.
    mockGetTenantPrivate.mockResolvedValue({}); // no stripeConnectAccountId
    seedPaid();

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/set up payments/i);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
