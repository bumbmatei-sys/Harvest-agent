import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-79 — every billing action goes to the processor that owns the subscription.
 *
 * 🔴 The bug these tests exist for: with `DODO_BILLING_ENABLED` on, signup creates
 * a DODO subscription while every other billing path still posted to Stripe. A
 * church that signed up through Dodo and then upgraded ended up with a live Dodo
 * subscription AND a new Stripe subscription — two processors, one product, two
 * card charges. For a church treasurer that is a trust failure, not a ticket.
 */

// ── Stripe: one mock surface covering every route under test ────────────────
const {
  mockSessionsCreate,
  mockCustomersRetrieve,
  mockCustomersCreate,
  mockCustomersList,
  mockPortalCreate,
  mockSubRetrieve,
  mockSubItemUpdate,
  mockSubItemCreate,
} = vi.hoisted(() => ({
  mockSessionsCreate: vi.fn(),
  mockCustomersRetrieve: vi.fn(),
  mockCustomersCreate: vi.fn(),
  mockCustomersList: vi.fn(),
  mockPortalCreate: vi.fn(),
  mockSubRetrieve: vi.fn(),
  mockSubItemUpdate: vi.fn(),
  mockSubItemCreate: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockSessionsCreate } };
    customers = { retrieve: mockCustomersRetrieve, create: mockCustomersCreate, list: mockCustomersList };
    billingPortal = { sessions: { create: mockPortalCreate } };
    subscriptions = { retrieve: mockSubRetrieve };
    subscriptionItems = { update: mockSubItemUpdate, create: mockSubItemCreate };
  },
}));

// THE-80 moved these routes off `requireAuth`/`requireAdmin` onto the owner and
// tenant-admin gates. This suite is about PROCESSOR ROUTING, not authorisation,
// so every gate is stubbed to a caller who passes; who is refused is asserted in
// `billing-auth-gates.test.ts`.
const { mockRequireAuth, mockRequireAdmin, mockRequireOwner, mockRequireTenantAdmin } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRequireAdmin: vi.fn(),
  mockRequireOwner: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireAuth: mockRequireAuth,
  requireAdmin: mockRequireAdmin,
  requireOwner: mockRequireOwner,
  requireTenantAdmin: mockRequireTenantAdmin,
}));

// The one thing under test: what the tenant's private doc says about ownership.
const { mockGetTenantPrivate } = vi.hoisted(() => ({ mockGetTenantPrivate: vi.fn() }));
vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: mockGetTenantPrivate,
  tenantPrivateRef: vi.fn(() => ({ set: vi.fn().mockResolvedValue(undefined) })),
}));

const { mockDocGet, mockDocUpdate, mockCollGet } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn(),
}));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ get: mockDocGet, update: mockDocUpdate, set: vi.fn() })),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: mockCollGet,
    })),
  },
}));

// `@/lib/dodo/config` throws at import time when the sandbox variables are
// absent, so the provider is mocked rather than loaded. That is also what makes
// "did we call Dodo, with which customer" directly assertable.
const { mockDodoPortalCreate } = vi.hoisted(() => ({ mockDodoPortalCreate: vi.fn() }));
vi.mock('@/lib/dodo/dodo-provider', () => ({
  dodoBillingProvider: { id: 'dodo', createCustomerPortal: mockDodoPortalCreate },
}));

vi.mock('@/lib/billing', () => ({
  PLAN_PRICES: {
    plus: { monthly: 'price_plus_m', yearly: 'price_plus_y' },
    pro: { monthly: 'price_pro_m', yearly: 'price_pro_y' },
    max: { monthly: 'price_max_m', yearly: 'price_max_y' },
    ultra: { monthly: 'price_ultra_m', yearly: 'price_ultra_y' },
  },
  AI_ASSISTANT_MONTHLY: 'price_ai_m',
}));

const { POST: checkout } = await import('@/app/api/stripe/checkout/route');
const { POST: portal } = await import('@/app/api/stripe/portal/route');
const { POST: updateQuantity } = await import('@/app/api/stripe/update-quantity/route');
const { POST: addChurchBilling } = await import('@/app/api/churches/add-billing/route');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(path: string, body: object): NextRequest {
  return new NextRequest(`https://example.com/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://theharvest.app' },
    body: JSON.stringify(body),
  });
}

/** A tenant billed through Dodo — signed up after DODO_BILLING_ENABLED went on. */
const DODO_TENANT = {
  billingProcessor: 'dodo',
  dodoCustomerId: 'cus_dodo_1',
  dodoSubscriptionId: 'sub_dodo_1',
  dodoProductId: 'pdt_max_monthly',
};

/** A tenant billed through Stripe — every tenant that exists today. */
const STRIPE_TENANT = {
  stripeCustomerId: 'cus_stripe_1',
  stripeSubscriptionId: 'sub_stripe_1',
};

/** Every Stripe call that could create or alter a subscription. */
function stripeWriteCalls() {
  return [
    ...mockSessionsCreate.mock.calls,
    ...mockCustomersCreate.mock.calls,
    ...mockSubItemCreate.mock.calls,
    ...mockSubItemUpdate.mock.calls,
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';

  const CALLER = { uid: 'u1', email: 'admin@grace.org', tenantId: 'grace', isSuperAdmin: false };
  mockRequireAuth.mockResolvedValue(CALLER);
  mockRequireAdmin.mockResolvedValue(CALLER);
  mockRequireTenantAdmin.mockResolvedValue(CALLER);
  mockRequireOwner.mockResolvedValue({
    user: CALLER,
    tenantId: 'grace',
    tenantData: { name: 'Grace Chapel', plan: 'ultra' },
  });

  mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe/session' });
  mockCustomersRetrieve.mockResolvedValue({ id: 'cus_stripe_1', deleted: false });
  mockCustomersCreate.mockResolvedValue({ id: 'cus_created' });
  mockCustomersList.mockResolvedValue({ data: [] });
  mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe/portal' });
  mockSubRetrieve.mockResolvedValue({ items: { data: [{ id: 'si_1' }] } });
  mockSubItemUpdate.mockResolvedValue({ id: 'si_1' });
  mockSubItemCreate.mockResolvedValue({ id: 'si_new' });
  mockDodoPortalCreate.mockResolvedValue({ url: 'https://test.dodopayments.com/portal/abc' });

  mockDocGet.mockResolvedValue({ exists: true, data: () => ({ name: 'Grace Chapel', plan: 'ultra' }) });
  mockCollGet.mockResolvedValue({ empty: false, size: 3, docs: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] });
});

// ─── Test 1: THE regression test for the whole issue ────────────────────────

describe('plan change routes to the processor that owns the subscription', () => {
  it('creates NO Stripe subscription when a Dodo-owned tenant changes plan', async () => {
    mockGetTenantPrivate.mockResolvedValue(DODO_TENANT);

    const res = await checkout(makeRequest('stripe/checkout', {
      plan: 'max', billing: 'monthly', tenantId: 'grace',
    }));

    // 🔴 The whole bug in one assertion: nothing on Stripe is created or touched.
    expect(mockSessionsCreate).not.toHaveBeenCalled();
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(stripeWriteCalls()).toHaveLength(0);

    // And the admin is TOLD, visibly — not left with a silent no-op.
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/not available yet/i);
  });

  it('guards BEFORE getValidCustomerId, so no Stripe customer is persisted either', async () => {
    // getValidCustomerId creates AND STORES a Stripe customer when none is found.
    // Running it for a Dodo tenant would write stripeCustomerId onto that tenant
    // and make it look like it belonged to both processors from then on.
    mockGetTenantPrivate.mockResolvedValue(DODO_TENANT);

    await checkout(makeRequest('stripe/checkout', { plan: 'pro', billing: 'yearly', tenantId: 'grace' }));

    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(mockCustomersRetrieve).not.toHaveBeenCalled();
  });

  // ── Test 2: the Stripe path is untouched. ────────────────────────────────
  it('behaves exactly as before for a Stripe-owned tenant', async () => {
    mockGetTenantPrivate.mockResolvedValue(STRIPE_TENANT);

    const res = await checkout(makeRequest('stripe/checkout', {
      plan: 'max', billing: 'yearly', tenantId: 'grace',
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe/session' });

    const args = mockSessionsCreate.mock.calls[0][0] as any;
    expect(args.customer).toBe('cus_stripe_1');
    expect(args.line_items[0].price).toBe('price_max_y');
    expect(args.subscription_data.metadata).toMatchObject({ tenantId: 'grace', plan: 'max', billing: 'yearly' });
    // Still no trial on a plan change — unchanged behaviour.
    expect(args.subscription_data.trial_period_days).toBeUndefined();
  });

  // ── Test 5: a tenant with neither identifier. ────────────────────────────
  it('lets a tenant with NEITHER identifier subscribe through Stripe (documented rule)', async () => {
    // Nothing to double-bill against, and this is the only path a legacy free
    // tenant has to become a paying one. Blocking it would be a regression.
    mockGetTenantPrivate.mockResolvedValue({});

    const res = await checkout(makeRequest('stripe/checkout', {
      plan: 'plus', billing: 'monthly', tenantId: 'grace',
    }));

    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('blocks a tenant carrying identifiers from BOTH processors', async () => {
    mockGetTenantPrivate.mockResolvedValue({ ...STRIPE_TENANT, ...DODO_TENANT });

    const res = await checkout(makeRequest('stripe/checkout', {
      plan: 'max', billing: 'monthly', tenantId: 'grace',
    }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/more than one payment processor/i);
    expect(stripeWriteCalls()).toHaveLength(0);
  });

  it('does not touch the NEW-MINISTRY signup path, which has no tenant to own it', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u9', email: 'new@pastor.org', tenantId: null, isSuperAdmin: false });
    mockGetTenantPrivate.mockResolvedValue({});

    const res = await checkout(makeRequest('stripe/checkout', {
      plan: 'pro', billing: 'monthly', ministryName: 'New Life',
    }));

    expect(res.status).toBe(200);
    const args = mockSessionsCreate.mock.calls[0][0] as any;
    expect(args.subscription_data.metadata.newTenant).toBe('true');
    expect(args.subscription_data.trial_period_days).toBe(7);
  });
});

// ─── Test 4: cancellation. NON-NEGOTIABLE. ─────────────────────────────────

describe('the billing portal — the only way an admin can cancel', () => {
  it('opens the DODO portal for a Dodo-owned tenant, so cancellation works', async () => {
    mockGetTenantPrivate.mockResolvedValue(DODO_TENANT);

    const res = await portal(makeRequest('stripe/portal', { tenantId: 'grace' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://test.dodopayments.com/portal/abc' });

    // Routed to Dodo, against THIS tenant's own customer…
    expect(mockDodoPortalCreate).toHaveBeenCalledWith({
      customerId: 'cus_dodo_1',
      returnUrl: 'https://theharvest.app/?dodo=portal_return',
    });
    // …and Stripe's portal was never opened.
    expect(mockPortalCreate).not.toHaveBeenCalled();
  });

  it('never blocks a Dodo tenant out of the portal — refusing here would trap them', async () => {
    // The one action that must not be refused. Whatever else this change blocks,
    // an admin must always be able to reach the surface that cancels.
    mockGetTenantPrivate.mockResolvedValue(DODO_TENANT);
    const res = await portal(makeRequest('stripe/portal', { tenantId: 'grace' }));
    expect(res.status).not.toBe(409);
    expect(res.status).toBe(200);
  });

  it('still opens the STRIPE portal for a Stripe-owned tenant, unchanged', async () => {
    mockGetTenantPrivate.mockResolvedValue(STRIPE_TENANT);

    const res = await portal(makeRequest('stripe/portal', { tenantId: 'grace' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://billing.stripe/portal' });
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_stripe_1',
      return_url: 'https://theharvest.app/?stripe=portal_return',
    });
    expect(mockDodoPortalCreate).not.toHaveBeenCalled();
  });

  it('lets a CONFLICTING tenant still reach the portal via the declared processor', async () => {
    // Every other path refuses this tenant. Refusing here too would leave a church
    // that is already billed twice unable to cancel either subscription.
    mockGetTenantPrivate.mockResolvedValue({ ...STRIPE_TENANT, ...DODO_TENANT });

    const res = await portal(makeRequest('stripe/portal', { tenantId: 'grace' }));

    expect(res.status).toBe(200);
    expect(mockDodoPortalCreate).toHaveBeenCalled();
  });

  it('refuses honestly, and does NOT fall through to Stripe, when the Dodo customer id is missing', async () => {
    mockGetTenantPrivate.mockResolvedValue({ billingProcessor: 'dodo', dodoSubscriptionId: 'sub_dodo_1' });

    const res = await portal(makeRequest('stripe/portal', { tenantId: 'grace' }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/contact support/i);
    expect(mockPortalCreate).not.toHaveBeenCalled();
  });
});

// ─── Test 3: an unbuilt action refuses visibly. ────────────────────────────

describe('unbuilt Dodo actions refuse — never a silent no-op, never a Stripe call', () => {
  it('refuses a seat-quantity update for a Dodo-owned tenant', async () => {
    mockGetTenantPrivate.mockResolvedValue(DODO_TENANT);

    const res = await updateQuantity(makeRequest('stripe/update-quantity', { tenantId: 'grace' }));

    expect(res.status).toBe(409);
    const body = await res.json();
    // Visible: a message, not a 200-with-success:true that the caller ignores.
    expect(body.error).toMatch(/not available yet/i);
    expect(body.success).toBeUndefined();
    expect(mockSubItemUpdate).not.toHaveBeenCalled();
    expect(mockSubRetrieve).not.toHaveBeenCalled();
  });

  it('refuses per-church billing for a Dodo-owned tenant', async () => {
    mockGetTenantPrivate.mockResolvedValue(DODO_TENANT);
    // Ministry plan, 3 churches — the case that WOULD have created a $10/mo line.
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ plan: 'ultra' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 'grace' }) });

    const res = await addChurchBilling(makeRequest('churches/add-billing', {
      tenantId: 'grace', churchId: 'c9', churchName: 'Second Campus',
    }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not available yet/i);
    expect(mockSubItemCreate).not.toHaveBeenCalled();
  });

  it('still adds per-church billing for a Stripe-owned Ministry tenant', async () => {
    mockGetTenantPrivate.mockResolvedValue(STRIPE_TENANT);
    mockDocGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ plan: 'ultra' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ tenantId: 'grace' }) });

    const res = await addChurchBilling(makeRequest('churches/add-billing', {
      tenantId: 'grace', churchId: 'c9', churchName: 'Second Campus',
    }));

    expect(res.status).toBe(200);
    expect(mockSubItemCreate).toHaveBeenCalledTimes(1);
    expect((mockSubItemCreate.mock.calls[0][0] as any).subscription).toBe('sub_stripe_1');
  });

  it('still updates seat quantity for a Stripe-owned Ministry tenant', async () => {
    mockGetTenantPrivate.mockResolvedValue(STRIPE_TENANT);

    const res = await updateQuantity(makeRequest('stripe/update-quantity', { tenantId: 'grace' }));

    expect(res.status).toBe(200);
    expect(mockSubItemUpdate).toHaveBeenCalledWith('si_1', { quantity: 3 });
  });
});
