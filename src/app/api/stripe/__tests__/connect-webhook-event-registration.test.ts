import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-154 — the Connect endpoint confirms the paid ticket.
 *
 * Paid tickets are now DIRECT charges created on the church's connected account,
 * so Stripe delivers `checkout.session.completed` to the CONNECT endpoint rather
 * than the platform one. Stripe's own scoping table puts "direct charges paid to
 * connected accounts" in the Connected accounts scope.
 *
 * 🔴 WHY THIS SUITE IS THE OTHER HALF OF THE PR. If the charge change shipped
 * without it, a ticket would be PAID FOR and the registration never confirmed:
 * the `pending_payment` doc the submit route wrote would just sit there, no
 * ticket code issued, no confirmation email sent, and the attendee turned away at
 * the door. That is worse than the destination charge it replaces. So these tests
 * assert the writes actually land, not merely that a handler was entered.
 *
 * ─── What is real here and what is faked ────────────────────────────────────
 *
 * Firestore is a STATEFUL double (same approach as
 * connect-webhook-donations.test.ts): `store` really holds documents, so a
 * double-confirm shows up as an actual second write to a doc that is already
 * `confirmed`, not as an extra call on a spy.
 *
 * Mocked: the Stripe client, Firebase, Resend, QRCode, the affiliate sweep and
 * Sentry.
 *
 * NOT mocked, deliberately: `@/lib/event-registration-webhook` — the REAL
 * handler. The whole point of the change is that the Connect endpoint drives the
 * SAME bookkeeping the platform endpoint drove, so a stub here would test nothing.
 *
 * Targets are named by LABEL, never by value pattern.
 */

// ── Named subjects, so assertions read as claims ─────────────────────────────
/** The church's own Stripe account. Every ticket Stripe call must be scoped here. */
const CHURCH_ACCOUNT = 'acct_church_grace';
/** The tenant that sold the ticket. Resolved from metadata, NOT from event.account. */
const CHURCH_TENANT = 't1';
/** $50.00 in MINOR UNITS, as Stripe sends it. */
const TICKET_CENTS = 5000;
/** The code on the attendee's QR ticket. */
const TICKET_CODE = 'ABC12345';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockConstructEvent, mockRefundsCreate, mockSubsRetrieve, mockSweep, mockEmailSend } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockRefundsCreate: vi.fn().mockResolvedValue({ id: 're_1' }),
  mockSubsRetrieve: vi.fn(),
  mockSweep: vi.fn().mockResolvedValue({ swept: 0, total: 0 }),
  mockEmailSend: vi.fn().mockResolvedValue({ id: 'em_1' }),
}));

// Stateful, path-aware Firestore double.
const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));
let addCounter = 0;

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => ({
      exists: store.has(path),
      data: () => store.get(path),
      id: path.split('/').pop(),
    }),
    set: async (data: any) => { store.set(path, { ...(store.get(path) || {}), ...data }); },
    update: async (data: any) => { store.set(path, { ...(store.get(path) || {}), ...data }); },
    delete: async () => { store.delete(path); },
    collection: (sub: string) => makeCollRef(`${path}/${sub}`),
  };
}

function makeCollRef(path: string): any {
  const filters: Array<[string, unknown]> = [];
  const coll: any = {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    add: async (data: any) => {
      const id = `gen${++addCounter}`;
      store.set(`${path}/${id}`, data);
      return makeDocRef(`${path}/${id}`);
    },
    get: async () => {
      const docs = [...store.entries()]
        .filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
        .filter(([, v]) => filters.every(([f, val]) => v?.[f] === val))
        .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v, ref: makeDocRef(k) }));
      return { docs, empty: docs.length === 0 };
    },
  };
  coll.where = (f: string, _op: string, v: unknown) => { filters.push([f, v]); return coll; };
  coll.limit = () => coll;
  coll.orderBy = () => coll;
  return coll;
}

vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mockConstructEvent };
    refunds = { create: mockRefundsCreate };
    subscriptions = { retrieve: mockSubsRetrieve };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => makeCollRef(name), batch: () => ({ update: vi.fn(), set: vi.fn(), commit: vi.fn() }) },
  getReceiptsBucket: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
}));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/donation-receipt', () => ({ issueDonationReceipt: vi.fn() }));
vi.mock('@/lib/affiliate-payout', () => ({ sweepPendingAffiliateCommissions: mockSweep }));
// A class, not an arrow: the handler calls `new Resend(key)`.
vi.mock('resend', () => ({ Resend: class { emails = { send: mockEmailSend }; } }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,x') } }));

const { POST } = await import('../connect/webhook/route');

function makeRequest(): NextRequest {
  return new NextRequest('https://example.com/api/stripe/connect/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig' },
    body: '{}',
  });
}

/** The metadata the submit route stamps on a paid ticket's Checkout Session. */
function ticketMetadata(over: Record<string, string> = {}) {
  return {
    type: 'event_registration',
    tenantId: CHURCH_TENANT,
    eventId: 'e1',
    ticketTypeId: 'tt1',
    registrationId: 'reg1',
    discountCode: '',
    userId: '',
    ...over,
  };
}

/**
 * A Connect-scoped event. `account` is what Stripe sets on every delivery to a
 * Connect endpoint, and it is the ONLY source of the account scope.
 */
function connectEvent(id: string, type: string, object: any) {
  return { id, type, account: CHURCH_ACCOUNT, data: { object } };
}

const ticketSession = (over: Record<string, unknown> = {}) => ({
  id: 'cs_1',
  subscription: null,
  payment_intent: 'pi_123',
  amount_total: TICKET_CENTS,
  metadata: ticketMetadata(),
  ...over,
});

/** Seed a pending paid registration and its event. */
function seedPendingTicket(opts: { capacity?: number | null; quantity?: number } = {}) {
  const { capacity = null, quantity = 1 } = opts;
  store.set(`tenants/${CHURCH_TENANT}`, { name: 'Grace Community Church' });
  store.set(`tenants/${CHURCH_TENANT}/events/e1`, {
    title: 'Benefit Gala',
    ticketTypes: [{ id: 'tt1', name: 'General', capacity }],
  });
  store.set(`tenants/${CHURCH_TENANT}/registrations/reg1`, {
    eventId: 'e1',
    tenantId: CHURCH_TENANT,
    ticketTypeId: 'tt1',
    status: 'pending_payment',
    email: 'sam@example.com',
    firstName: 'Sam',
    ticketCode: TICKET_CODE,
    amount: TICKET_CENTS,
    quantity,
  });
}

const registration = () => store.get(`tenants/${CHURCH_TENANT}/registrations/reg1`);
/** Every confirmation email actually handed to Resend. */
const confirmationEmails = () =>
  mockEmailSend.mock.calls.filter(([msg]: any[]) => /registration for/i.test(msg?.subject || ''));

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  addCounter = 0;
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_mock';
  process.env.RESEND_API_KEY = 're_test_mock';
  mockRefundsCreate.mockResolvedValue({ id: 're_1' });
  mockEmailSend.mockResolvedValue({ id: 'em_1' });
});

describe('connect webhook — paid event tickets (THE-154)', () => {
  it('a ticket event on the Connect endpoint confirms the registration and issues the code', async () => {
    // 🔴 THE OTHER HALF OF THE PR. Without this branch the ticket is paid for and
    // the pending registration is never touched — no code, no email, no seat.
    seedPendingTicket();
    mockConstructEvent.mockReturnValue(connectEvent('evt_1', 'checkout.session.completed', ticketSession()));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const reg = registration();
    expect(reg.status).toBe('confirmed');
    expect(reg.stripePaymentIntentId).toBe('pi_123');
    expect(reg.amountPaid).toBe(TICKET_CENTS);
    expect(reg.confirmedAt).toBeTruthy();

    // The attendee actually receives their ticket code.
    expect(confirmationEmails()).toHaveLength(1);
    expect(confirmationEmails()[0][0].html).toContain(TICKET_CODE);
    expect(confirmationEmails()[0][0].to).toBe('sam@example.com');
  });

  it('retains the userId the submit route carried in metadata', async () => {
    // The metadata key exists so the handler can link the confirmed seat to the
    // buyer's in-app "My Events" even if the pending doc were ever re-created.
    seedPendingTicket();
    mockConstructEvent.mockReturnValue(connectEvent('evt_1', 'checkout.session.completed',
      ticketSession({ metadata: ticketMetadata({ userId: 'user_9' }) })));

    await POST(makeRequest());
    expect(registration().userId).toBe('user_9');
  });

  it('a redelivered event does not confirm twice or send two emails', async () => {
    seedPendingTicket();

    // First delivery — the real confirmation.
    mockConstructEvent.mockReturnValue(connectEvent('evt_1', 'checkout.session.completed', ticketSession()));
    await POST(makeRequest());
    expect(registration().status).toBe('confirmed');
    const firstConfirmedAt = registration().confirmedAt;
    expect(confirmationEmails()).toHaveLength(1);

    // Same event id again → stopped by the `webhook_events` marker.
    const dupRes = await POST(makeRequest());
    expect((await dupRes.json()).duplicate).toBe(true);

    // 🔴 And a DIFFERENT event id for the same money — the case the marker cannot
    // catch, and the one a direct charge makes real (a session emits more than
    // one event, and Stripe's own redelivery can arrive re-keyed). The status
    // guard is what has to hold: no second confirm, no second ticket email.
    mockConstructEvent.mockReturnValue(connectEvent('evt_2', 'checkout.session.completed', ticketSession()));
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(registration().status).toBe('confirmed');
    expect(registration().confirmedAt).toBe(firstConfirmedAt); // never re-stamped
    expect(confirmationEmails()).toHaveLength(1);              // exactly one ticket
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('every Stripe read in the handler is scoped to the connected account', async () => {
    // 🔴 The oversold path is the ONLY Stripe call the handler makes, and on a
    // direct charge that PaymentIntent belongs to the CHURCH. A platform-scoped
    // refund 404s — silently, because it sits inside the handler — and the payer
    // would lose both their seat and their money.
    seedPendingTicket({ capacity: 1 });
    // Someone else took the last seat while this payer was in Checkout.
    store.set(`tenants/${CHURCH_TENANT}/registrations/other`, {
      eventId: 'e1', ticketTypeId: 'tt1', status: 'confirmed', quantity: 1,
    });
    mockConstructEvent.mockReturnValue(connectEvent('evt_1', 'checkout.session.completed', ticketSession()));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    const [params, options] = mockRefundsCreate.mock.calls[0];
    expect(params).toEqual({ payment_intent: 'pi_123' });
    // Scoped to the church…
    expect(options.stripeAccount).toBe(CHURCH_ACCOUNT);
    // …and still idempotent, so a redelivery cannot refund twice. Both live in
    // the SAME options object; adding one must not displace the other.
    expect(options.idempotencyKey).toBe('evt_reg_refund_reg1');

    // The seat is cancelled, not confirmed — the money never stays with a seat
    // the attendee cannot have.
    expect(registration().status).toBe('cancelled');
    expect(registration().refundReason).toBe('sold_out');
  });

  it('the ticket branch runs before the subscription branch — no subscription read at all', async () => {
    // A ticket is a one-time payment with no subscription. Checked after the
    // donation branch it would fall out at the `!subscriptionId` guard and be
    // silently dropped; and `subscriptions.retrieve` must never be reached for
    // one, scoped or not.
    seedPendingTicket();
    mockConstructEvent.mockReturnValue(connectEvent('evt_1', 'checkout.session.completed', ticketSession()));

    await POST(makeRequest());
    expect(mockSubsRetrieve).not.toHaveBeenCalled();
    expect(registration().status).toBe('confirmed');
  });

  it('consumes the discount code exactly once on confirm', async () => {
    // The paid path defers the usage increment to confirmation (the free path
    // does it at submit). A capped code that never records its use is redeemable
    // past its limit.
    seedPendingTicket();
    store.set(`tenants/${CHURCH_TENANT}/events/e1`, {
      title: 'Benefit Gala',
      ticketTypes: [{ id: 'tt1', name: 'General', capacity: null }],
      discountCodes: [{ code: 'EARLY', usedCount: 0 }],
    });
    mockConstructEvent.mockReturnValue(connectEvent('evt_1', 'checkout.session.completed',
      ticketSession({ metadata: ticketMetadata({ discountCode: 'EARLY' }) })));

    await POST(makeRequest());
    expect(store.get(`tenants/${CHURCH_TENANT}/events/e1`).discountCodes).toEqual([
      { code: 'EARLY', usedCount: 1 },
    ]);

    // A second delivery under a fresh event id must not consume it again.
    mockConstructEvent.mockReturnValue(connectEvent('evt_2', 'checkout.session.completed',
      ticketSession({ metadata: ticketMetadata({ discountCode: 'EARLY' }) })));
    await POST(makeRequest());
    expect(store.get(`tenants/${CHURCH_TENANT}/events/e1`).discountCodes).toEqual([
      { code: 'EARLY', usedCount: 1 },
    ]);
  });

  it('a non-Harvest session on the church’s account is ignored', async () => {
    // A connected account may run Checkout of its own. Only a Harvest ticket
    // carries `type: 'event_registration'`.
    seedPendingTicket();
    mockConstructEvent.mockReturnValue(connectEvent('evt_1', 'checkout.session.completed',
      ticketSession({ metadata: { type: 'something_else' } })));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(registration().status).toBe('pending_payment');
    expect(confirmationEmails()).toHaveLength(0);
  });

  it('marks an abandoned ticket Checkout expired on this endpoint too', async () => {
    // Housekeeping only — a pending reg holds no capacity and no discount. NOTE:
    // the live Connect endpoint is not yet subscribed to
    // `checkout.session.expired`; the handler is here so enabling it is a
    // dashboard change rather than a deploy.
    seedPendingTicket();
    mockConstructEvent.mockReturnValue(connectEvent('evt_1', 'checkout.session.expired',
      { id: 'cs_1', metadata: ticketMetadata() }));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(registration().status).toBe('expired');
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('never expires a seat that was already confirmed', async () => {
    seedPendingTicket();
    store.set(`tenants/${CHURCH_TENANT}/registrations/reg1`, { ...registration(), status: 'confirmed' });
    mockConstructEvent.mockReturnValue(connectEvent('evt_1', 'checkout.session.expired',
      { id: 'cs_1', metadata: ticketMetadata() }));

    await POST(makeRequest());
    expect(registration().status).toBe('confirmed');
  });
});
