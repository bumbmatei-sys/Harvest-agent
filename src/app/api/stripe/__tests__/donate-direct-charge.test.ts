import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-145 — a donation must be charged ON THE CHURCH, not on Harvest.
 *
 * Donations used to be DESTINATION charges: the card was charged on the Harvest
 * platform account and the money swept to the church via
 * `transfer_data.destination`. Stripe is explicit about what that means — "If you
 * want your platform to be responsible for Stripe fees, refunds, and chargebacks,
 * use destination charges" — so a disputed gift was debited from HARVEST's
 * balance, on a gift Harvest earns 0% on. It also made Harvest the business of
 * record, which contradicts the recorded reason Stripe was kept for donations at
 * all: a merchant-of-record structure is incompatible with 501(c)(3) donor
 * substantiation.
 *
 * DIRECT charges fix both. Stripe: "For connected accounts that use direct
 * charges, Stripe always attempts to debit disputed amounts from the connected
 * account's balance." The Checkout Session is created AS the connected account —
 * the `Stripe-Account` header, i.e. the `{ stripeAccount }` request-options
 * argument — and there is no transfer, because the money is already the church's.
 *
 * 🔴 THIS SUPERSEDES `donate-settlement-merchant.test.ts` (#315 / THE-144). That
 * suite pinned `on_behalf_of` and its capability-gated fallback. `on_behalf_of`
 * names a settlement merchant on an INDIRECT charge; on a direct charge the
 * connected account already IS the merchant, so the parameter — and the whole
 * `stripeConnectStatus` proxy, the deliberate under-application and the
 * `donate-settlement-merchant-fallback` capture that went with it — is dead. The
 * tests here that are not about `on_behalf_of` are carried over unchanged.
 *
 * ─── What is real here and what is faked ────────────────────────────────────
 *
 * Mocked: the Stripe client, Firebase, `verifyAuth` (which is Firebase token
 * verification), and `@sentry/nextjs`.
 *
 * NOT mocked, deliberately:
 *   - `@/lib/stripe-connect` — the REAL `PLATFORM_FEE_MAP`. The no-regression
 *     test below is worthless against a fabricated fee table; it has to pin the
 *     rate a donor is actually charged.
 *   - `@/lib/tenant-lifecycle` — the REAL giving gate and status resolution, so
 *     these donations get through the same door a live one does.
 *   - `@/lib/money-path-sentry` — so the tag/context shape that actually reaches
 *     Sentry is what gets asserted, not a stand-in.
 *
 * Targets are named by LABEL, never by value pattern. A regex for `acct_` cannot
 * tell the request-options scope from a `transfer_data.destination` — and those
 * two being different is the entire point of this change.
 */

// PLATFORM_TENANT_ID is read at module load — pin it before importing the route.
process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID = 'harvest';

// ── The two accounts, named so assertions read as claims ─────────────────────
/** The church's own Stripe Connect account — who the gift is charged ON. */
const CHURCH_ACCOUNT = 'acct_church_grace';
/** A church on a live subdomain. */
const CHURCH_TENANT = 'bumb';
/** The platform/apex "tenant" — not a real subdomain. */
const PLATFORM_TENANT = 'harvest';
/** $50.00, in MINOR UNITS. The route takes cents; the receipt renders dollars. */
const GIFT_CENTS = 5000;

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: mockCaptureException }));

const { mockVerifyAuth } = vi.hoisted(() => ({ mockVerifyAuth: vi.fn() }));
const { mockSessionsCreate } = vi.hoisted(() => ({ mockSessionsCreate: vi.fn() }));
const { docs } = vi.hoisted(() => ({
  docs: { tenants: new Map<string, any>(), tenant_private: new Map<string, any>() } as Record<string, Map<string, any>>,
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockSessionsCreate } };
  },
}));

vi.mock('@/lib/api-auth', () => ({ verifyAuth: mockVerifyAuth }));

// Dispatches on COLLECTION, so `tenants/{id}` and `tenant_private/{id}` are
// genuinely separate documents. The route reads the Connect account id off the
// private doc — a shared stub would let a route that read the wrong doc pass.
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = docs[name]?.get(id);
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  },
}));

const { POST } = await import('../donate/route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/stripe/donate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The Checkout Session PARAMS — what is being bought. */
const lastSessionArgs = () => mockSessionsCreate.mock.calls[0][0] as any;
/**
 * The Checkout Session REQUEST OPTIONS — WHO the session is created as. This is
 * the second positional argument; stripe-node turns `stripeAccount` into the
 * `Stripe-Account` header, and that header is what makes the charge direct.
 */
const lastRequestOptions = () => mockSessionsCreate.mock.calls[0][1] as any;

/**
 * Seed a church. The Connect account id lives on the server-only private doc.
 */
function seedChurch(opts: { tenantId?: string; plan?: string; connectStatus?: string | undefined } = {}) {
  const { tenantId = CHURCH_TENANT, plan = 'pro' } = opts;
  // `in`, not a default parameter: a church whose tenant doc carries NO
  // stripeConnectStatus at all is a case under test.
  const connectStatus = 'connectStatus' in opts ? opts.connectStatus : 'active';
  docs.tenants.set(tenantId, {
    name: 'Grace Community Church',
    plan,
    status: 'active',
    ...(connectStatus === undefined ? {} : { stripeConnectStatus: connectStatus }),
  });
  docs.tenant_private.set(tenantId, { stripeConnectAccountId: CHURCH_ACCOUNT });
}

/** Every money-path capture Sentry actually received. */
const moneyPathCaptures = () =>
  mockCaptureException.mock.calls.filter(([, ctx]: any[]) => ctx?.tags?.money_path === 'true');

beforeEach(() => {
  vi.clearAllMocks();
  docs.tenants.clear();
  docs.tenant_private.clear();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'theharvest.app';
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';
  mockVerifyAuth.mockResolvedValue(null); // anonymous donor by default
  mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe/x' });
  seedChurch();
});

describe('POST /api/stripe/donate — charged on the church (THE-145)', () => {
  it('a one-time donation is charged on the church, not on the platform', async () => {
    const res = await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    expect(res.status).toBe(200);

    // 🔴 The session is created AS the church. Without this the charge lands on
    // the platform account and Harvest wears the chargeback.
    expect(lastRequestOptions()).toEqual({ stripeAccount: CHURCH_ACCOUNT });
  });

  it('a monthly donation is charged on the church, not on the platform', async () => {
    const res = await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
    expect(res.status).toBe(200);

    // A monthly partner's card is charged every month forever — a dispute on the
    // eleventh renewal must debit the church, same as on the first.
    expect(lastRequestOptions()).toEqual({ stripeAccount: CHURCH_ACCOUNT });
  });

  it('no transfer_data is sent on either path', async () => {
    // 🔴 THE REGRESSION TEST. `transfer_data` is what made this a DESTINATION
    // charge — money taken on the platform and swept over, with the platform
    // carrying fees, refunds and chargebacks. On a direct charge there is nothing
    // to transfer: the funds are the church's when the card clears. Sending both
    // is not "belt and braces", it is the old charge type back.
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    expect(lastSessionArgs().payment_intent_data).not.toHaveProperty('transfer_data');

    mockSessionsCreate.mockClear();
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
    expect(lastSessionArgs().subscription_data).not.toHaveProperty('transfer_data');
  });

  it('no on_behalf_of is sent on either path', async () => {
    // `on_behalf_of` names a settlement merchant on an INDIRECT charge. On a
    // direct charge the connected account already IS the merchant, so the
    // parameter is meaningless here — and #315's capability gate, which existed
    // only to decide whether it was safe to send, is dead with it.
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    expect(lastSessionArgs().payment_intent_data).not.toHaveProperty('on_behalf_of');

    mockSessionsCreate.mockClear();
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
    expect(lastSessionArgs().subscription_data).not.toHaveProperty('on_behalf_of');
  });

  it('a church that never reached Connect status active is charged directly all the same', async () => {
    // #315 gated `on_behalf_of` on `stripeConnectStatus === 'active'` because
    // sending it to an account without a payments capability is an API error, and
    // it raised `donate-settlement-merchant-fallback` whenever it under-applied.
    // Direct charges have no such gate: the church either can take charges or the
    // Session fails outright at Stripe. So no status branch survives here — and
    // no alert fires on a healthy gift.
    for (const connectStatus of ['pending', 'restricted', undefined]) {
      mockSessionsCreate.mockClear();
      mockCaptureException.mockClear();
      seedChurch({ connectStatus });

      const res = await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
      expect(res.status).toBe(200);
      expect(lastRequestOptions()).toEqual({ stripeAccount: CHURCH_ACCOUNT });
      expect(moneyPathCaptures()).toHaveLength(0);
    }
  });

  it('the platform fee is still zero on both paths', async () => {
    // 🔴 THE NO-REGRESSION TEST. PLATFORM_FEE_MAP is the REAL one — every tier is
    // 0, and moving to direct charges must not have disturbed that on any of
    // them. Direct charges support application fees exactly as destination
    // charges did; what changed is who is charged, not what Harvest keeps.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      mockSessionsCreate.mockClear();
      seedChurch({ plan });
      await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
      expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);

      mockSessionsCreate.mockClear();
      await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
      expect(lastSessionArgs().subscription_data.application_fee_percent).toBe(0);
    }

    // And zero is a RATE, not a rounding artifact: at any of the old rates a
    // $10,000 gift would carry a four-figure fee that Math.round cannot hide.
    mockSessionsCreate.mockClear();
    seedChurch({ plan: 'max' });
    await POST(makeRequest({ amount: 1_000_000, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);
  });

  it('the one-time path still uses a fixed fee and the monthly path a percent', async () => {
    // The two branches take DIFFERENT fee mechanisms deliberately:
    // `application_fee_amount` is only valid on one-time PaymentIntents, and
    // Stripe requires a PERCENT on subscriptions ("You can't set a subscription's
    // recurring application fee as a flat amount"). Unifying them breaks the
    // monthly branch outright, so pin that they stay distinct.
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    const paymentIntent = lastSessionArgs().payment_intent_data;
    expect(paymentIntent).toHaveProperty('application_fee_amount');
    expect(paymentIntent).not.toHaveProperty('application_fee_percent');

    mockSessionsCreate.mockClear();
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
    const subscription = lastSessionArgs().subscription_data;
    expect(subscription).toHaveProperty('application_fee_percent');
    expect(subscription).not.toHaveProperty('application_fee_amount');
  });

  it('every metadata key the webhook reads is unchanged', async () => {
    mockVerifyAuth.mockResolvedValue({ uid: 'member1', email: 'member@grace.org' });

    // One-time: the webhook's payment_intent.succeeded handler reads these to
    // record the gift and link the donor to their CRM contact. The handler moved
    // endpoints in this change; the keys it reads did NOT.
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time', campaignId: 'c1', donorName: 'Ada' }));
    expect(lastSessionArgs().payment_intent_data.metadata).toEqual({
      tenantId: CHURCH_TENANT,
      type: 'partnership',
      donationType: 'one-time',
      campaignId: 'c1',
      donorName: 'Ada',
      donorEmail: 'member@grace.org',
      donorUserId: 'member1',
    });

    mockSessionsCreate.mockClear();
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly', campaignId: 'c1', donorName: 'Ada' }));
    const subscriptionMetadata = lastSessionArgs().subscription_data.metadata;
    expect(subscriptionMetadata).toEqual({
      // 🔴 `type: 'partnership'` must survive: checkout.session.completed has to
      // recognise this as a donation BEFORE the plan-change path, which would
      // otherwise read `plan` and cancel the tenant's own subscription.
      type: 'partnership',
      tenantId: CHURCH_TENANT,
      donationType: 'monthly',
      plan: 'pro',
      campaignId: 'c1',
      donorName: 'Ada',
      donorEmail: 'member@grace.org',
      donorUserId: 'member1',
      donationChurchName: 'Grace Community Church',
    });

    // Nothing about the charge type leaked into metadata — the account scope is a
    // request header, not a key the webhook has to learn.
    expect(subscriptionMetadata).not.toHaveProperty('stripeAccount');
  });

  it('amounts are still sent in minor units', async () => {
    // This has shipped as a 100× error before. `unit_amount` is CENTS; the
    // receipt is what renders dollars.
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    expect(lastSessionArgs().line_items[0].price_data.unit_amount).toBe(GIFT_CENTS);

    mockSessionsCreate.mockClear();
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
    const monthlyPrice = lastSessionArgs().line_items[0].price_data;
    expect(monthlyPrice.unit_amount).toBe(GIFT_CENTS);
    expect(monthlyPrice.recurring).toEqual({ interval: 'month' });
  });

  it('the price stays inline — nothing has to exist on the church’s account first', async () => {
    // A `price` ID would have to be created on the connected account before the
    // first gift could be taken. `price_data` creates the Price and Product on
    // whichever account the session is created on, so a church can receive a
    // donation the moment it finishes onboarding.
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    const lineItem = lastSessionArgs().line_items[0];
    expect(lineItem).toHaveProperty('price_data');
    expect(lineItem).not.toHaveProperty('price');

    mockSessionsCreate.mockClear();
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly' }));
    const monthlyLineItem = lastSessionArgs().line_items[0];
    expect(monthlyLineItem).toHaveProperty('price_data');
    expect(monthlyLineItem).not.toHaveProperty('price');
  });

  it('the monthly path needs no pre-existing Customer on the connected account', async () => {
    // Checkout mints the Customer on whichever account the session is created on.
    // Passing a PLATFORM customer id would be the thing that broke — that customer
    // does not exist on the church's account. Only `customer_email` is sent, which
    // is a prefill, not a reference.
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'monthly', donorEmail: 'partner@example.org' }));
    const args = lastSessionArgs();
    expect(args).not.toHaveProperty('customer');
    expect(args.customer_email).toBe('partner@example.org');
  });

  it('the platform tenant branch is unchanged', async () => {
    // The platform/apex "tenant" has no real subdomain, so its donations stay on
    // the apex while a church's return to its own subdomain. The charge-type
    // change sits well away from this and must not have perturbed it.
    seedChurch({ tenantId: PLATFORM_TENANT });
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: PLATFORM_TENANT, donationType: 'one-time' }));
    let args = lastSessionArgs();
    expect(args.success_url).toBe('https://theharvest.app/?donation=success');
    expect(args.cancel_url).toBe('https://theharvest.app/?donation=cancel');

    mockSessionsCreate.mockClear();
    await POST(makeRequest({ amount: GIFT_CENTS, tenantId: CHURCH_TENANT, donationType: 'one-time' }));
    args = lastSessionArgs();
    expect(args.success_url).toBe('https://bumb.theharvest.app/?donation=success');
    expect(args.cancel_url).toBe('https://bumb.theharvest.app/?donation=cancel');
  });
});
