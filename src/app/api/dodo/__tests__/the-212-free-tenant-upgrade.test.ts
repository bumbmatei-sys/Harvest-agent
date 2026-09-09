import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-212 — a free tenant can convert, and it converts through Dodo.
 *
 * ─── The defect these tests pin ──────────────────────────────────────────────
 *
 * 🔴 A Forever Free tenant is provisioned with NO billing identifiers at all —
 * `lib/free-provisioning.ts` lists every field it deliberately omits. So
 * `resolveBillingOwnership` answers `reason: 'none'`, and
 * `/api/billing/invoices` reports that tenant as `processor: 'stripe'`, which
 * is simply the default it falls through to when it finds no Stripe customer.
 *
 * Both upgrade surfaces read that answer, took the `proc !== 'dodo'` arm, and
 * posted to `/api/stripe/checkout` — which resolves a Stripe PRICE ID out of
 * `lib/billing.ts`'s `PLAN_PRICES`. Dodo has products and no price-ID concept
 * at all, so the "price id" in the founder's error was the proof that the wrong
 * processor had been reached, not a missing catalogue entry.
 *
 * ⚠️ THESE TESTS DRIVE THE REAL PROVIDER AND THE REAL CATALOGUE. Only the Dodo
 * SDK client is stubbed (through `__setDodoClientForTests`, the module's own
 * seam), so what is asserted below is the whole chain the money takes: route →
 * `createPlanCheckout` → `requireProductId(plan, period)` → the live catalogue.
 * Mocking the provider would have let a route that resolved a PRICE pass.
 *
 * ⚠️ LIVE MODE, deliberately. Quarterly is `DODO_PRODUCT_UNMAPPED` in test mode
 * (no test-mode quarterly product exists), so nine combinations can only be
 * nine in the catalogue a real card is charged against.
 *
 * 🔴 EVERY EXPECTED PRODUCT ID IS READ FROM THE CATALOGUE, never typed here.
 * A test that repeats the ids is a second source of truth that drifts silently,
 * and a drifted id paired with a real checkout is a charge at the wrong price.
 */

vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_live_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'live_mode';
});

const {
  mockRequireAuth, mockRequireOwner, mockTenantGet, mockPrivateGet, mockPrivateSet,
  mockCheckoutCreate, mockPortalCreate, mockStripeSessionsCreate, mockStripeCustomersCreate,
  mockStripeCustomersRetrieve, mockStripeInvoicesList, mockGetTenantPrivate,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRequireOwner: vi.fn(),
  mockTenantGet: vi.fn(),
  mockPrivateGet: vi.fn(),
  mockPrivateSet: vi.fn().mockResolvedValue(undefined),
  mockCheckoutCreate: vi.fn(),
  mockPortalCreate: vi.fn(),
  mockStripeSessionsCreate: vi.fn(),
  mockStripeCustomersCreate: vi.fn(),
  mockStripeCustomersRetrieve: vi.fn(),
  mockStripeInvoicesList: vi.fn(),
  mockGetTenantPrivate: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireAuth: mockRequireAuth,
  requireOwner: mockRequireOwner,
  requireAdmin: vi.fn(),
  requireTenantAdmin: vi.fn(),
}));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({ doc: () => ({ get: mockTenantGet, set: vi.fn(), update: vi.fn() }) }),
  },
}));
vi.mock('@/lib/tenant-private', () => ({
  tenantPrivateRef: () => ({ get: mockPrivateGet, set: mockPrivateSet }),
  getTenantPrivate: mockGetTenantPrivate,
}));
vi.mock('@/lib/affiliate-referrer', () => ({
  resolveAffiliateReferrer: async (id: unknown) => ({ referrerId: typeof id === 'string' ? id : null }),
  logReferralCapture: vi.fn(),
}));
vi.mock('@/lib/money-path-sentry', () => ({
  captureMoneyPathError: vi.fn(),
  captureHandledError: vi.fn(),
}));
vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { create: mockStripeSessionsCreate } };
    customers = {
      create: mockStripeCustomersCreate,
      retrieve: mockStripeCustomersRetrieve,
      list: vi.fn().mockResolvedValue({ data: [] }),
    };
    invoices = { list: mockStripeInvoicesList };
    billingPortal = { sessions: { create: mockStripeSessionsCreate } };
  },
}));

const { POST: firstSubscriptionPOST } = await import('@/app/api/dodo/first-subscription/route');
const { POST: dodoCheckoutPOST } = await import('@/app/api/dodo/checkout/route');
const { POST: stripeCheckoutPOST } = await import('@/app/api/stripe/checkout/route');
const { POST: portalPOST } = await import('@/app/api/stripe/portal/route');
const { __setDodoClientForTests } = await import('@/lib/dodo/dodo-provider');
const { DODO_LIVE_CATALOGUE, DODO_ACTIVE_CATALOGUE } = await import('@/lib/dodo/catalogue');
const { PLAN_PRICING, PRICED_PLAN_ORDER, BILLING_TERMS, PLAN_ORDER } =
  await import('@/utils/plan-features');
const { PLAN_PRICES } = await import('@/lib/billing');

type Plan = (typeof PRICED_PLAN_ORDER)[number];
type Term = (typeof BILLING_TERMS)[number];

/** Every (plan, term) pair the app sells — nine of them, derived, never listed. */
const EVERY_COMBINATION: { plan: Plan; term: Term }[] = PRICED_PLAN_ORDER.flatMap((plan) =>
  BILLING_TERMS.map((term) => ({ plan, term })),
);

const post = (url: string, body: object) =>
  new NextRequest(`https://example.com/${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://grace.theharvest.app' },
    body: JSON.stringify(body),
  });

/** The signed-in owner of a free tenant, which is who presses Upgrade. */
function asOwnerOfFreeTenant() {
  mockRequireAuth.mockResolvedValue({
    uid: 'u1', email: 'pastor@grace.example', tenantId: 't1', isAdmin: true, isSuperAdmin: false,
  });
  mockRequireOwner.mockResolvedValue({
    user: { uid: 'u1' }, tenantId: 't1', tenantData: { name: 'Grace', plan: 'free' },
  });
  mockTenantGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'free', name: 'Grace' }) });
  mockPrivateGet.mockResolvedValue({ exists: true, data: () => ({ adminEmails: ['pastor@grace.example'] }) });
  mockGetTenantPrivate.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  mockCheckoutCreate.mockResolvedValue({ session_id: 'sess_1', checkout_url: 'https://dodo/checkout/1' });
  mockPortalCreate.mockResolvedValue({ link: 'https://dodo/portal/1' });
  mockStripeSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe/session' });
  mockStripeCustomersCreate.mockResolvedValue({ id: 'cus_new' });
  mockStripeCustomersRetrieve.mockResolvedValue({ id: 'cus_stripe_1' });
  mockStripeInvoicesList.mockResolvedValue({ data: [] });
  __setDodoClientForTests({
    checkoutSessions: { create: mockCheckoutCreate },
    customers: { customerPortal: { create: mockPortalCreate } },
  } as never);
  asOwnerOfFreeTenant();
});

// ── 1 ────────────────────────────────────────────────────────────────────────
describe('a free tenant can start an upgrade to each paid tier on each term', () => {
  it.each(EVERY_COMBINATION)(
    'starts a Dodo checkout for $plan on $term',
    async ({ plan, term }) => {
      const res = await firstSubscriptionPOST(
        post('api/dodo/first-subscription', { plan, billing: term }),
      );

      expect(res.status, `${plan}/${term} must be startable`).toBe(200);
      expect(await res.json()).toEqual({ url: 'https://dodo/checkout/1', reference: 'sess_1' });

      // The cart Dodo was handed, for THIS pair. The id is read out of the
      // catalogue by (plan, term) — the same two facts the request carried.
      const cart = mockCheckoutCreate.mock.calls[0][0].product_cart;
      expect(cart).toEqual([
        { product_id: DODO_LIVE_CATALOGUE[plan][term].productId, quantity: 1 },
      ]);
    },
  );

  it('covers all nine combinations, and the catalogue can name a product for every one', () => {
    expect(EVERY_COMBINATION).toHaveLength(9);
    for (const { plan, term } of EVERY_COMBINATION) {
      expect(DODO_ACTIVE_CATALOGUE[plan][term].productId, `${plan}/${term}`).toBeTruthy();
    }
  });

  it('stamps firstSubscription, never newTenant, so no second church is built', async () => {
    await firstSubscriptionPOST(post('api/dodo/first-subscription', { plan: 'pro', billing: 'yearly' }));

    const metadata = mockCheckoutCreate.mock.calls[0][0].metadata;
    expect(metadata).toMatchObject({ firstSubscription: 'true', tenantId: 't1', userId: 'u1' });
    expect(metadata.newTenant).toBeUndefined();
  });

  it('sends no trial override, so the product’s own 14-day trial applies (THE-208)', async () => {
    await firstSubscriptionPOST(post('api/dodo/first-subscription', { plan: 'plus', billing: 'monthly' }));

    // Absent, not `undefined` and not zero: an explicit value is a request to
    // CHANGE the trial, and the trial lives on the product by decision.
    expect(mockCheckoutCreate.mock.calls[0][0]).not.toHaveProperty('subscription_data');
  });
});

// ── 2 ────────────────────────────────────────────────────────────────────────
describe('the upgrade resolves a product from plan and term, not from a price', () => {
  it('carts the product the (plan, term) pair maps to, for every pair', async () => {
    for (const { plan, term } of EVERY_COMBINATION) {
      mockCheckoutCreate.mockClear();
      await firstSubscriptionPOST(post('api/dodo/first-subscription', { plan, billing: term }));

      const body = mockCheckoutCreate.mock.calls[0][0];
      expect(body.product_cart[0].product_id, `${plan}/${term}`).toBe(
        DODO_ACTIVE_CATALOGUE[plan][term].productId,
      );
    }
  });

  it('never sends a price, an amount or a currency to the processor', async () => {
    await firstSubscriptionPOST(post('api/dodo/first-subscription', { plan: 'max', billing: 'quarterly' }));

    // 🔴 Dodo puts the price ON the product. A checkout body that named a
    // price, an amount or a currency would mean the app had decided what to
    // charge — the defect that produces a charge at a figure Dodo never agreed.
    const body = mockCheckoutCreate.mock.calls[0][0];
    const keys = JSON.stringify(body).toLowerCase();
    for (const forbidden of ['price', 'amount', 'currency', 'unit_amount']) {
      expect(keys, `checkout body must not carry "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('refuses a plan the pricing table has no row for, rather than resolving nothing', async () => {
    // The tier with no price must not reach a product lookup at all. This is
    // the THE-200 defect class — a derived plan list that went one entry too
    // wide — and it is what "resolve from plan + term" depends on staying true.
    const res = await firstSubscriptionPOST(
      post('api/dodo/first-subscription', { plan: 'free', billing: 'monthly' }),
    );

    expect(res.status).toBe(400);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });
});

// ── 3 ────────────────────────────────────────────────────────────────────────
describe('no path resolves a Stripe price for a Dodo tenant', () => {
  it('refuses a free tenant at /api/stripe/checkout before any Stripe call', async () => {
    const res = await stripeCheckoutPOST(
      post('api/stripe/checkout', { plan: 'plus', billing: 'monthly', tenantId: 't1' }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no subscription yet/i);
    expect(mockStripeSessionsCreate).not.toHaveBeenCalled();
  });

  it('persists no Stripe customer on a free tenant, so its billing record stays clean', async () => {
    // 🔴 `getValidCustomerId` creates AND STORES a customer BEFORE the session
    // is built, so even a failed upgrade used to leave `stripeCustomerId` on a
    // church that has never paid Stripe — which then reads as
    // `reason: 'conflict'` the moment it buys through Dodo, freezing its plan
    // changes and its add-ons. The refusal must land ahead of that write.
    await stripeCheckoutPOST(
      post('api/stripe/checkout', { plan: 'max', billing: 'yearly', tenantId: 't1' }),
    );

    expect(mockStripeCustomersCreate).not.toHaveBeenCalled();
    expect(mockStripeCustomersRetrieve).not.toHaveBeenCalled();
    expect(mockPrivateSet).not.toHaveBeenCalled();
  });

  it('refuses a Dodo-owned tenant at /api/stripe/checkout, unchanged', async () => {
    mockRequireOwner.mockResolvedValue({
      user: { uid: 'u1' }, tenantId: 't1', tenantData: { name: 'Grace', plan: 'pro' },
    });
    mockGetTenantPrivate.mockResolvedValue({
      billingProcessor: 'dodo', dodoCustomerId: 'cus_dodo', dodoSubscriptionId: 'sub_dodo',
    });

    const res = await stripeCheckoutPOST(
      post('api/stripe/checkout', { plan: 'max', billing: 'monthly', tenantId: 't1' }),
    );

    expect(res.status).toBe(409);
    expect(mockStripeSessionsCreate).not.toHaveBeenCalled();
  });

  it('the free upgrade route never reads the Stripe price table', async () => {
    // Every Stripe price id this app knows, and none of them may appear in what
    // the Dodo checkout was handed. Read from `PLAN_PRICES`, never typed — the
    // targets are named by their table, not matched by a value pattern.
    const everyStripePriceId = Object.values(PLAN_PRICES).flatMap((row) => [row.monthly, row.yearly]);

    for (const { plan, term } of EVERY_COMBINATION) {
      mockCheckoutCreate.mockClear();
      await firstSubscriptionPOST(post('api/dodo/first-subscription', { plan, billing: term }));
      const body = JSON.stringify(mockCheckoutCreate.mock.calls[0][0]);
      for (const priceId of everyStripePriceId) {
        expect(body, `${plan}/${term} must not carry a Stripe price`).not.toContain(priceId);
      }
    }
  });
});

// ── 5 (route half) ───────────────────────────────────────────────────────────
describe('a paid Dodo tenant’s manage action reaches Dodo’s portal, not Stripe', () => {
  it('opens the Dodo hosted portal for a Dodo-owned tenant', async () => {
    mockRequireOwner.mockResolvedValue({
      user: { uid: 'u1' }, tenantId: 't1', tenantData: { name: 'Grace', plan: 'max' },
    });
    mockGetTenantPrivate.mockResolvedValue({
      billingProcessor: 'dodo', dodoCustomerId: 'cus_dodo_1', dodoSubscriptionId: 'sub_dodo_1',
    });

    const res = await portalPOST(post('api/stripe/portal', { tenantId: 't1' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://dodo/portal/1' });
    expect(mockPortalCreate).toHaveBeenCalledWith('cus_dodo_1', expect.anything());
    // THE ONLY WAY OUT must not be Stripe's for a church Stripe does not bill.
    expect(mockStripeSessionsCreate).not.toHaveBeenCalled();
  });

  it('still opens Stripe’s portal for a Stripe-owned tenant', async () => {
    mockRequireOwner.mockResolvedValue({
      user: { uid: 'u1' }, tenantId: 't1', tenantData: { name: 'Grace', plan: 'max' },
    });
    mockGetTenantPrivate.mockResolvedValue({
      billingProcessor: 'stripe', stripeCustomerId: 'cus_stripe_1', stripeSubscriptionId: 'sub_stripe_1',
    });

    const res = await portalPOST(post('api/stripe/portal', { tenantId: 't1' }));

    expect(res.status).toBe(200);
    expect(mockPortalCreate).not.toHaveBeenCalled();
    expect(mockStripeSessionsCreate).toHaveBeenCalledTimes(1);
  });
});

// ── 6 ────────────────────────────────────────────────────────────────────────
describe('the checkout route still refuses when tenantId is set', () => {
  it('refuses a body carrying a tenantId, so no church opens a second subscription', async () => {
    // 🔴 THE CALLER BELONGS TO NOTHING, deliberately. The route carries a
    // SECOND 400 a few lines below this guard — "You already belong to an
    // organization" — and a caller who has a tenant is refused by that one
    // whether or not the tenantId guard exists. Asserting a 400 against such a
    // caller is a test that passes with the guard deleted. So the signer-up
    // here has no tenant of their own, and the only thing left that can refuse
    // the request is the guard under test.
    mockRequireAuth.mockResolvedValue({
      uid: 'u9', email: 'new@example.com', tenantId: null, isAdmin: false, isSuperAdmin: false,
    });

    const res = await dodoCheckoutPOST(
      post('api/dodo/checkout', { plan: 'pro', billing: 'monthly', tenantId: 't1', ministryName: 'Grace' }),
    );

    expect(res.status).toBe(400);
    // Named, not merely a status: this must be THIS refusal.
    expect((await res.json()).error).toMatch(/new ministries only/i);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('and it refuses one even from a super admin, who is exempt from the other guard', async () => {
    // The apex super admin passes "you already belong to an organization" by
    // design. If the tenantId guard were the one carrying that case, this is
    // the request that would create the second subscription.
    mockRequireAuth.mockResolvedValue({
      uid: 'root', email: 'root@example.com', tenantId: null, isAdmin: true, isSuperAdmin: true,
    });

    const res = await dodoCheckoutPOST(
      post('api/dodo/checkout', { plan: 'max', billing: 'yearly', tenantId: 't1', ministryName: 'Grace' }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/new ministries only/i);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('and the first-subscription route is its exact inverse: it requires one', async () => {
    // The two guards cannot both accept the same request, which is what keeps
    // the double charge prevented while the free tier can still convert.
    mockRequireAuth.mockResolvedValue({
      uid: 'u1', email: 'a@b.c', tenantId: null, isAdmin: true, isSuperAdmin: false,
    });

    const res = await firstSubscriptionPOST(
      post('api/dodo/first-subscription', { plan: 'pro', billing: 'monthly' }),
    );

    expect(res.status).toBe(400);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('and it refuses a tenant that already has a subscription, on either processor', async () => {
    for (const held of [{ dodoSubscriptionId: 'sub_1' }, { stripeSubscriptionId: 'sub_1' }]) {
      mockCheckoutCreate.mockClear();
      mockPrivateGet.mockResolvedValue({ exists: true, data: () => held });

      const res = await firstSubscriptionPOST(
        post('api/dodo/first-subscription', { plan: 'pro', billing: 'monthly' }),
      );

      expect(res.status, JSON.stringify(held)).toBe(400);
      expect(mockCheckoutCreate).not.toHaveBeenCalled();
    }
  });
});

// ── 8 (route half) ───────────────────────────────────────────────────────────
describe('the webhook is still the only writer of plan', () => {
  it('the upgrade route writes nothing at all — it returns a checkout url', async () => {
    const res = await firstSubscriptionPOST(
      post('api/dodo/first-subscription', { plan: 'max', billing: 'yearly' }),
    );

    expect(res.status).toBe(200);
    // No tenant write, no private write. The tier lands on `subscription.active`.
    expect(mockPrivateSet).not.toHaveBeenCalled();
  });
});

// ── 9 ────────────────────────────────────────────────────────────────────────
describe('no price changed and free is still absent from PLAN_PRICING', () => {
  it('holds the nine published prices', () => {
    expect(PLAN_PRICING).toEqual({
      plus: { monthly: 20, quarterly: 54, yearly: 190 },
      pro: { monthly: 40, quarterly: 108, yearly: 380 },
      // ⚠️ THE-343 repriced Ministry ($80→$60, with the quarter and year
      // following at the same 10% / >20% discounts). `plus` and `pro` are
      // enumerated so a reprice that overreached its brief still fails here.
      max: { monthly: 60, quarterly: 162, yearly: 564 },
    });
  });

  it('has no row for the free tier, and the tier still exists', () => {
    // Both halves matter: free must be a real tier (it is what a tenant is
    // provisioned on) and must have no price row (the whole contract).
    expect(PLAN_ORDER).toContain('free');
    expect(Object.keys(PLAN_PRICING)).not.toContain('free');
    expect(PRICED_PLAN_ORDER).not.toContain('free');
  });

  it('and every catalogue entry still quotes the table, not a literal', () => {
    for (const { plan, term } of EVERY_COMBINATION) {
      expect(DODO_ACTIVE_CATALOGUE[plan][term].priceUsd, `${plan}/${term}`).toBe(
        PLAN_PRICING[plan][term],
      );
    }
  });
});
