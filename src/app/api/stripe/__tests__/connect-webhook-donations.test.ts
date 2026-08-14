import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-145 — the Connect endpoint records the donation.
 *
 * Donations are now DIRECT charges created on the church's connected account, so
 * Stripe delivers their lifecycle events to the CONNECT endpoint rather than the
 * platform one. Stripe's own scoping table puts "direct charges paid to connected
 * accounts" and "updates to Invoices and Subscriptions that connected accounts
 * charge their customers using direct charges" in the Connected accounts scope,
 * and their guidance on this exact symptom is blunt: "The production webhook was
 * configured for simple account events instead of Connect events. Configure the
 * production webhook to listen for Connect events to receive the
 * `checkout.session.completed` event."
 *
 * 🔴 WHY THIS SUITE IS THE OTHER HALF OF THE PR. If the charge change shipped
 * without it, every donation would succeed at Stripe and Harvest would record
 * NOTHING — no CRM activity, no receipt PDF, no `totalDonated`, no donor profile.
 * That is worse than the destination charges it replaces. So these tests assert
 * the writes actually land, not merely that a handler was entered.
 *
 * ─── What is real here and what is faked ────────────────────────────────────
 *
 * Firestore is a STATEFUL double (same approach as
 * webhook-campaign-credit-idempotency.test.ts): `store` really holds documents,
 * `FieldValue.increment` is really applied, and queries really filter. So
 * `totalDonated` is an actual running total and a duplicate receipt is an actual
 * second document — a double-write shows up as 100 where 50 is correct, not as an
 * extra call on a spy.
 *
 * Mocked: the Stripe client, Firebase, the receipt PDF/emailer, the affiliate
 * commission sweep (unit-tested in its own suite — here we assert WIRING).
 *
 * NOT mocked, deliberately: `@/lib/stripe-connect-status` (the real
 * `deriveConnectStatus`, so test 11 pins the real status mapping) and
 * `@/lib/donation-webhook` (the real recorders — the whole point is that the
 * Connect endpoint drives the SAME bookkeeping the platform endpoint drives).
 *
 * Targets are named by LABEL, never by value pattern.
 */

// ── Named subjects, so assertions read as claims ─────────────────────────────
/** The church's own Stripe account. Every donation Stripe read must be scoped here. */
const CHURCH_ACCOUNT = 'acct_church_grace';
/** The tenant that receives the money. Resolved from metadata, NOT from event.account. */
const CHURCH_TENANT = 't1';
/** A logged-in member of that tenant who gives. */
const DONOR_UID = 'member1';
const DONOR_EMAIL = 'member@grace.org';
/** $50.00 in MINOR UNITS, as Stripe sends it. */
const GIFT_CENTS = 5000;
/** ...which is $50 in the DOLLARS the CRM stores. */
const GIFT_DOLLARS = 50;

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockConstructEvent, mockSubsRetrieve, mockIssueReceipt, mockSweep } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockSubsRetrieve: vi.fn(),
  mockIssueReceipt: vi.fn().mockResolvedValue(undefined),
  mockSweep: vi.fn().mockResolvedValue({ swept: 0, total: 0 }),
}));

// Stateful, path-aware Firestore double.
const { store, hooks } = vi.hoisted(() => ({
  store: new Map<string, any>(),
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
    subscriptions = { retrieve: mockSubsRetrieve };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => makeCollRef(name), batch: () => makeBatch() },
  getReceiptsBucket: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    increment: vi.fn((n: number) => ({ __increment: n })),
  },
}));

vi.mock('@/lib/donation-receipt', () => ({ issueDonationReceipt: mockIssueReceipt }));
vi.mock('@/lib/affiliate-payout', () => ({ sweepPendingAffiliateCommissions: mockSweep }));

const { POST } = await import('../connect/webhook/route');

function makeRequest(): NextRequest {
  return new NextRequest('https://example.com/api/stripe/connect/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig' },
    body: '{}',
  });
}

/** The metadata /api/stripe/donate stamps on a gift. */
function donationMetadata(over: Record<string, string> = {}) {
  return {
    type: 'partnership',
    tenantId: CHURCH_TENANT,
    donationType: 'one-time',
    donorUserId: DONOR_UID,
    donorEmail: DONOR_EMAIL,
    donorName: 'Sam Member',
    campaignId: '',
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

const oneTimeGift = (id = 'evt_pi_1', piId = 'pi_1') =>
  connectEvent(id, 'payment_intent.succeeded', {
    id: piId, amount_received: GIFT_CENTS, currency: 'usd', metadata: donationMetadata(),
  });

const monthlyFirstGift = (id = 'evt_cs_1') =>
  connectEvent(id, 'checkout.session.completed', {
    id: 'cs_1', subscription: 'sub_1', amount_total: GIFT_CENTS,
    customer_details: { email: DONOR_EMAIL },
  });

const monthlyRenewal = (id = 'evt_inv_1', invoiceId = 'in_1') =>
  connectEvent(id, 'invoice.payment_succeeded', {
    id: invoiceId, subscription: 'sub_1', amount_paid: GIFT_CENTS,
    currency: 'usd', billing_reason: 'subscription_cycle',
  });

// ── Readers over the real stored state ───────────────────────────────────────
const receipts = () =>
  [...store.entries()]
    .filter(([k, v]) => k.startsWith(`tenants/${CHURCH_TENANT}/invoices/`) && v?.type === 'donation_receipt')
    .map(([, v]) => v);
const donationActivities = () =>
  [...store.entries()]
    .filter(([k, v]) => k.startsWith('contactActivities/') && v?.type === 'donation')
    .map(([, v]) => v);
const donorTotal = () => store.get(`users/${DONOR_UID}`)?.totalDonated ?? 0;

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  addCounter = 0;
  hooks.failWrite = null;
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_mock';
  mockIssueReceipt.mockResolvedValue(undefined);
  mockSweep.mockResolvedValue({ swept: 0, total: 0 });

  // The church, and a member of it who gives.
  store.set(`tenants/${CHURCH_TENANT}`, { name: 'Grace Community Church' });
  store.set(`users/${DONOR_UID}`, { tenantId: CHURCH_TENANT, displayName: 'Sam Member' });

  // The donation subscription lives on the CONNECTED account now.
  mockSubsRetrieve.mockResolvedValue({
    id: 'sub_1',
    currency: 'usd',
    items: { data: [{ price: { unit_amount: GIFT_CENTS } }] },
    metadata: donationMetadata({ donationType: 'monthly' }),
  });
});

describe('Connect webhook — donations are recorded here now (THE-145)', () => {
  it('a donation event on the Connect endpoint writes the CRM activity, the receipt and the total', async () => {
    mockConstructEvent.mockReturnValue(oneTimeGift());

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // The tax line — CENTS, because giving-statements and QuickBooks read it that way.
    expect(receipts()).toHaveLength(1);
    expect(receipts()[0]).toMatchObject({
      type: 'donation_receipt',
      recipientEmail: DONOR_EMAIL,
      amount: GIFT_CENTS,
      relatedId: 'pi_1',
    });
    // ...and the PDF/thank-you actually got issued, not just the row written.
    expect(mockIssueReceipt).toHaveBeenCalledTimes(1);

    // The CRM timeline entry — DOLLARS, and carrying tenantId or the CRM filters it out.
    expect(donationActivities()).toHaveLength(1);
    expect(donationActivities()[0]).toMatchObject({
      tenantId: CHURCH_TENANT, type: 'donation', amount: GIFT_DOLLARS, contactId: DONOR_UID,
    });

    // The donor's own running total — DOLLARS.
    expect(donorTotal()).toBe(GIFT_DOLLARS);
  });

  it('a monthly first payment on the Connect endpoint is recorded the same way', async () => {
    mockConstructEvent.mockReturnValue(monthlyFirstGift());

    expect((await POST(makeRequest())).status).toBe(200);

    expect(receipts()).toHaveLength(1);
    expect(receipts()[0]).toMatchObject({ amount: GIFT_CENTS, relatedId: 'sub_1' });
    expect(donorTotal()).toBe(GIFT_DOLLARS);
    // The partnership pointer, without which Profile shows "no active partnership"
    // and cancel-partnership can't find the subscription.
    expect(store.get(`users/${DONOR_UID}`)).toMatchObject({
      donationSubscriptionId: 'sub_1',
      donationAmount: GIFT_DOLLARS,
      donationChurchId: CHURCH_TENANT,
    });
  });

  it('a monthly RENEWAL on the Connect endpoint is recorded too', async () => {
    // Without this a monthly partner's giving statement shows one month forever
    // and their totalDonated freezes after the opening gift.
    mockConstructEvent.mockReturnValue(monthlyRenewal());

    expect((await POST(makeRequest())).status).toBe(200);

    expect(receipts()).toHaveLength(1);
    expect(receipts()[0]).toMatchObject({ amount: GIFT_CENTS, relatedId: 'in_1' });
    expect(donorTotal()).toBe(GIFT_DOLLARS);
  });

  it('the opening month is not recorded twice by its own subscription_create invoice', async () => {
    mockConstructEvent.mockReturnValue(monthlyFirstGift());
    await POST(makeRequest());

    // Stripe emits BOTH events for month one. They are distinct event ids, so the
    // webhook_events marker cannot dedup across them — the billing_reason skip is
    // what stops the opening gift counting twice.
    mockConstructEvent.mockReturnValue(
      connectEvent('evt_inv_create', 'invoice.payment_succeeded', {
        id: 'in_create', subscription: 'sub_1', amount_paid: GIFT_CENTS,
        currency: 'usd', billing_reason: 'subscription_create',
      }),
    );
    expect((await POST(makeRequest())).status).toBe(200);

    expect(receipts()).toHaveLength(1);
    expect(donorTotal()).toBe(GIFT_DOLLARS);
  });

  it('a one-time gift is not recorded twice by its own checkout.session.completed', async () => {
    // A one-time donation emits a session event AND a PaymentIntent event, both to
    // this endpoint. Only the PaymentIntent carries the partnership metadata, and
    // only it records — otherwise every one-time gift would count double.
    mockConstructEvent.mockReturnValue(
      connectEvent('evt_cs_onetime', 'checkout.session.completed', {
        id: 'cs_onetime', subscription: null, amount_total: GIFT_CENTS,
      }),
    );
    expect((await POST(makeRequest())).status).toBe(200);
    expect(receipts()).toHaveLength(0);
    expect(donorTotal()).toBe(0);

    mockConstructEvent.mockReturnValue(oneTimeGift());
    expect((await POST(makeRequest())).status).toBe(200);
    expect(receipts()).toHaveLength(1);
    expect(donorTotal()).toBe(GIFT_DOLLARS);
  });

  it('a redelivered donation event does not write a second receipt or double the total', async () => {
    mockConstructEvent.mockReturnValue(oneTimeGift());
    expect((await POST(makeRequest())).status).toBe(200);
    expect(receipts()).toHaveLength(1);
    expect(donorTotal()).toBe(GIFT_DOLLARS);

    // (a) Plain redelivery — Stripe resends the SAME event id. The
    //     webhook_events marker turns it away before any handler runs.
    expect((await POST(makeRequest())).status).toBe(200);
    expect(receipts()).toHaveLength(1);
    expect(donorTotal()).toBe(GIFT_DOLLARS);

    // (b) 🔴 THE CASE THE MARKER CANNOT COVER. The marker is deliberately DELETED
    //     when a handler throws, so a failure after the receipt landed sends the
    //     same money event back around with the marker gone. Without a
    //     per-payment gate, `FieldValue.increment` would credit the donor twice
    //     and the annual giving statement would carry a duplicate tax line.
    store.delete('webhook_events/evt_pi_1');
    expect((await POST(makeRequest())).status).toBe(200);
    expect(receipts()).toHaveLength(1);
    expect(donorTotal()).toBe(GIFT_DOLLARS);
  });

  it('a redelivered MONTHLY first payment does not double either', async () => {
    mockConstructEvent.mockReturnValue(monthlyFirstGift());
    expect((await POST(makeRequest())).status).toBe(200);
    expect(donorTotal()).toBe(GIFT_DOLLARS);

    store.delete('webhook_events/evt_cs_1');
    expect((await POST(makeRequest())).status).toBe(200);
    expect(receipts()).toHaveLength(1);
    expect(donorTotal()).toBe(GIFT_DOLLARS);
  });

  it('every Stripe read in the donation handler is scoped to the connected account', async () => {
    // 🔴 On a direct charge the Session, the PaymentIntent, the Subscription and
    // the Invoice all live on the CONNECTED account. A platform-scoped retrieve
    // 404s — silently, inside a try — so the gift would be recorded as nothing.
    // stripe-node takes (id, params, options) positionally: the account scope only
    // becomes the Stripe-Account header from the THIRD argument.
    mockConstructEvent.mockReturnValue(monthlyFirstGift());
    await POST(makeRequest());

    expect(mockSubsRetrieve).toHaveBeenCalledTimes(1);
    expect(mockSubsRetrieve.mock.calls[0][2]).toEqual({ stripeAccount: CHURCH_ACCOUNT });

    // The renewal path reads the subscription too, and must scope it identically.
    mockSubsRetrieve.mockClear();
    mockConstructEvent.mockReturnValue(monthlyRenewal());
    await POST(makeRequest());

    expect(mockSubsRetrieve).toHaveBeenCalledTimes(1);
    expect(mockSubsRetrieve.mock.calls[0][2]).toEqual({ stripeAccount: CHURCH_ACCOUNT });

    // EVERY read, not just the ones a happy-path test happens to reach: no call
    // anywhere in the suite may go out unscoped.
    for (const call of mockSubsRetrieve.mock.calls) {
      expect(call[2]).toEqual({ stripeAccount: CHURCH_ACCOUNT });
    }
  });

  it('the tenant comes from metadata, not from the account the event arrived on', async () => {
    // event.account is the CHURCH'S STRIPE ACCOUNT (acct_…), never a tenant id.
    // Resolving the tenant from it would write every donation to a tenant that
    // does not exist.
    mockConstructEvent.mockReturnValue(oneTimeGift());
    await POST(makeRequest());

    expect(receipts()).toHaveLength(1);
    expect(store.has(`tenants/${CHURCH_ACCOUNT}/invoices`)).toBe(false);
    expect(donationActivities()[0]).toMatchObject({ tenantId: CHURCH_TENANT });
  });

  it('a subscription that is not a Harvest donation is left alone', async () => {
    // A connected account may run subscriptions of its own. Only Harvest gifts
    // carry `type: 'partnership'`.
    mockSubsRetrieve.mockResolvedValue({ id: 'sub_theirs', currency: 'usd', metadata: {} });
    mockConstructEvent.mockReturnValue(monthlyFirstGift('evt_cs_theirs'));

    expect((await POST(makeRequest())).status).toBe(200);
    expect(receipts()).toHaveLength(0);
    expect(donorTotal()).toBe(0);
  });

  it('a subscription that cannot be loaded is retried, not silently dropped', async () => {
    // A partner's opening gift with no metadata is unrecordable. 5xx + marker undo
    // so Stripe redelivers, rather than a 200 that loses the gift forever.
    mockSubsRetrieve.mockRejectedValue(new Error('connection reset'));
    mockConstructEvent.mockReturnValue(monthlyFirstGift());

    expect((await POST(makeRequest())).status).toBe(503);
    expect(store.has('webhook_events/evt_cs_1')).toBe(false);
  });
});

describe('Connect webhook — account.updated is undisturbed', () => {
  const accountUpdated = (over: Record<string, unknown> = {}) => ({
    id: 'evt_acct_1',
    type: 'account.updated',
    account: CHURCH_ACCOUNT,
    data: {
      object: {
        id: CHURCH_ACCOUNT, charges_enabled: true, payouts_enabled: true,
        requirements: { currently_due: [] }, ...over,
      },
    },
  });

  it('account.updated still syncs status and sweeps affiliate commissions', async () => {
    // The account id lives on the server-only private doc; the status goes on the
    // public tenant doc. The SAME account also powers affiliate payouts.
    store.set(`tenant_private/${CHURCH_TENANT}`, { stripeConnectAccountId: CHURCH_ACCOUNT });
    store.set('users/affiliate1', { affiliateStripeAccountId: CHURCH_ACCOUNT });
    mockConstructEvent.mockReturnValue(accountUpdated());

    expect((await POST(makeRequest())).status).toBe(200);

    // Status synced onto the tenant...
    expect(store.get(`tenants/${CHURCH_TENANT}`)).toMatchObject({ stripeConnectStatus: 'active' });
    // ...and mirrored onto every linked affiliate user.
    expect(store.get('users/affiliate1')).toMatchObject({ affiliateConnectStatus: 'active' });
    // ...and the pending commissions swept, on activation, for that user.
    expect(mockSweep).toHaveBeenCalledTimes(1);
    expect(mockSweep.mock.calls[0][0]).toMatchObject({
      referrerId: 'affiliate1',
      connectAccountId: CHURCH_ACCOUNT,
    });
  });

  it('a non-active account syncs its status but is not swept', async () => {
    // 'restricted'/'pending' are not payout-ready — sweeping them would push money
    // at an account that cannot receive it. Real `deriveConnectStatus` decides.
    store.set(`tenant_private/${CHURCH_TENANT}`, { stripeConnectAccountId: CHURCH_ACCOUNT });
    store.set('users/affiliate1', { affiliateStripeAccountId: CHURCH_ACCOUNT });
    mockConstructEvent.mockReturnValue(accountUpdated({
      charges_enabled: true, payouts_enabled: false,
      requirements: { currently_due: ['external_account'] },
    }));

    expect((await POST(makeRequest())).status).toBe(200);

    expect(store.get(`tenants/${CHURCH_TENANT}`)).toMatchObject({ stripeConnectStatus: 'restricted' });
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('the donation cases did not steal account.updated’s unknown-account path', async () => {
    // No tenant AND no affiliate user → a benign unknown account, 200 so Stripe
    // stops retrying. Adding donation cases must not have changed that.
    mockConstructEvent.mockReturnValue(accountUpdated());

    expect((await POST(makeRequest())).status).toBe(200);
    expect(mockSweep).not.toHaveBeenCalled();
  });
});
