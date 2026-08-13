import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextRequest } from 'next/server';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * THE-131 — a paying church can see when it will be charged.
 *
 * The Dodo branch of `/api/billing/invoices` returned `currentPeriodEnd: null`,
 * so the Billing & Payments screen rendered "No active subscription" under Next
 * Billing to a church whose card was being charged every month. A church that
 * cannot see its renewal date cannot budget for it, and a surprise charge is the
 * single most common trigger for a chargeback.
 *
 * ─── What is asserted, and what is deliberately NOT ──────────────────────────
 *
 * The DATE is now read from Dodo, which is the only authority on it. The AMOUNT
 * is not, and that is the other half of this file's job to pin: Dodo reports the
 * catalogue price (`recurring_pre_tax_amount` with `currency: 'USD'`) but applies
 * adaptive currency at charge time — verified on the live API 2026-08-13, where a
 * 4900/USD subscription's own payment settled in RON. Nothing on the subscription
 * says which currency the card will see, so this route must never assert one.
 *
 * Targets are named by LABEL throughout — `nextAmount`, `currentPeriodEnd`, the
 * stub's own method names — never by matching a value or a date format, so a
 * regex cannot accidentally pass against the wrong field.
 *
 * The real `resolveBillingOwnership` and the real `toBillingSubscription` run;
 * only the Dodo SDK client, Stripe, Firebase and the owner gate are stubbed.
 */

// ── Stubs: the processors' clients and the owner gate, nothing else ──────────

const { mockInvoicesList, mockSubRetrieve } = vi.hoisted(() => ({
  mockInvoicesList: vi.fn(),
  mockSubRetrieve: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    invoices = { list: mockInvoicesList };
    subscriptions = { retrieve: mockSubRetrieve };
  },
}));

const { mockRequireOwner } = vi.hoisted(() => ({ mockRequireOwner: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireOwner: mockRequireOwner }));

const { mockGetTenantPrivate } = vi.hoisted(() => ({ mockGetTenantPrivate: vi.fn() }));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: mockGetTenantPrivate }));

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock('@/utils/auth-fetch', () => ({ authFetch: mockAuthFetch }));

// The plan section owns its own network and processor logic; this file is about
// the renewal card above it.
vi.mock('@/components/settings/PlanUpgradeSection', () => ({
  default: () => React.createElement('div', { 'data-testid': 'plan-upgrade-section' }),
}));

// `@/lib/dodo/config` throws at import time without these. Set before the module
// graph below is pulled in.
process.env.DODO_PAYMENTS_API_KEY = 'k';
process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('x').toString('base64');
process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';

const { __setDodoClientForTests } = await import('@/lib/dodo/dodo-provider');
const { GET: invoices } = await import('@/app/api/billing/invoices/route');
const { default: BillingAndPayments } = await import('@/components/BillingAndPayments');

/**
 * The Dodo SDK surface, every method a spy.
 *
 * Written out in full — including the ones this path must never touch — so that
 * "nothing here can create or modify a subscription" is a checked claim about
 * CALLS rather than a claim about which methods happen to be defined.
 */
function makeDodoClient() {
  return {
    subscriptions: {
      retrieve: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      changePlan: vi.fn(),
      previewChangePlan: vi.fn(),
    },
    checkoutSessions: { create: vi.fn() },
    customers: { customerPortal: { create: vi.fn() } },
    payments: { list: vi.fn() },
  };
}

type DodoClientStub = ReturnType<typeof makeDodoClient>;
let dodo: DodoClientStub;

/** Every Dodo method that changes something. None may be called on a read. */
const mutatingDodoCalls = (client: DodoClientStub) => [
  ['subscriptions.create', client.subscriptions.create],
  ['subscriptions.update', client.subscriptions.update],
  ['subscriptions.changePlan', client.subscriptions.changePlan],
  ['subscriptions.previewChangePlan', client.subscriptions.previewChangePlan],
  ['checkoutSessions.create', client.checkoutSessions.create],
  ['customers.customerPortal.create', client.customers.customerPortal.create],
] as const;

/** A real test-catalogue product id, so the real plan resolution actually runs. */
const DODO_TEST_PRODUCT = 'pdt_0NlAMMZk44L0tL8lcLX6M';

/** The renewal instant, exactly as the live API reports one. */
const NEXT_BILLING_ISO = '2026-08-27T17:30:55.750287Z';
const NEXT_BILLING_UNIX = Math.floor(Date.parse(NEXT_BILLING_ISO) / 1000);

/**
 * A live Dodo subscription payload. Carries the catalogue amount and currency
 * precisely because the assertions below are that they do NOT reach the client.
 */
const DODO_SUBSCRIPTION = {
  subscription_id: 'sub_dodo_1',
  status: 'active',
  product_id: DODO_TEST_PRODUCT,
  next_billing_date: NEXT_BILLING_ISO,
  cancel_at_next_billing_date: false,
  trial_period_days: 14,
  created_at: '2026-07-27T17:30:55.750287Z',
  recurring_pre_tax_amount: 4900,
  currency: 'USD',
  customer: { customer_id: 'cus_dodo_1' },
  metadata: { plan: 'plus' },
};

const DODO_TENANT = {
  billingProcessor: 'dodo',
  dodoCustomerId: 'cus_dodo_1',
  dodoSubscriptionId: 'sub_dodo_1',
};
const STRIPE_TENANT = { stripeCustomerId: 'cus_stripe_1', stripeSubscriptionId: 'sub_stripe_1' };
/** Live identifiers on BOTH sides — the fingerprint of a double-billed tenant. */
const CONFLICTED_TENANT = { ...STRIPE_TENANT, ...DODO_TENANT };

const request = () =>
  new NextRequest('https://example.com/api/billing/invoices', { method: 'GET' });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';

  dodo = makeDodoClient();
  dodo.subscriptions.retrieve.mockResolvedValue(DODO_SUBSCRIPTION);
  __setDodoClientForTests(dodo as never);

  mockRequireOwner.mockResolvedValue({
    user: { uid: 'u1' },
    tenantId: 'grace',
    tenantData: { name: 'Grace Chapel', plan: 'max', status: 'active' },
  });
  mockInvoicesList.mockResolvedValue({ data: [] });
  mockSubRetrieve.mockResolvedValue({
    items: {
      data: [{ current_period_end: 1790000000, quantity: 1, price: { unit_amount: 9900, currency: 'usd' } }],
    },
    cancel_at_period_end: false,
  });
});

describe('THE-131: the renewal date on a Dodo-billed church', () => {
  it('a Dodo tenant is told when its next payment falls', async () => {
    mockGetTenantPrivate.mockResolvedValue(DODO_TENANT);

    const body = await (await invoices(request())).json();

    // The date Dodo holds, in the unit this route already publishes.
    expect(body.subscription.currentPeriodEnd).toBe(NEXT_BILLING_UNIX);
    // It was read for THIS tenant's subscription, not any other.
    expect(dodo.subscriptions.retrieve).toHaveBeenCalledWith('sub_dodo_1');
    // …and the rest of the Dodo answer is unchanged.
    expect(body.processor).toBe('dodo');
    expect(body.subscription).toMatchObject({ plan: 'max', status: 'active' });
    expect(body.historySource).toBe('portal');
  });

  it('a Dodo tenant is never shown an amount in a currency it will not be charged', async () => {
    mockGetTenantPrivate.mockResolvedValue(DODO_TENANT);

    const body = await (await invoices(request())).json();

    // Dodo handed this route 4900 and 'USD' on the payload above. Neither may be
    // published as a charge: the settlement currency is decided at charge time
    // and the subscription does not carry it.
    expect(body.subscription.nextAmount).toBeNull();
    // Named by label rather than by value: no key on the response may carry the
    // processor's amount, whatever it happens to be called.
    const published = Object.values(body.subscription);
    expect(published).not.toContain(DODO_SUBSCRIPTION.recurring_pre_tax_amount);
    // The date still landed — omitting the amount is not omitting the answer.
    expect(body.subscription.currentPeriodEnd).toBe(NEXT_BILLING_UNIX);
  });

  it("a Stripe tenant's billing response is unchanged", async () => {
    mockGetTenantPrivate.mockResolvedValue(STRIPE_TENANT);
    mockInvoicesList.mockResolvedValue({
      data: [
        {
          id: 'in_1', created: 1780000000, amount_paid: 9900, total: 9900,
          currency: 'usd', status: 'paid',
          invoice_pdf: 'https://x/pdf', hosted_invoice_url: 'https://x/h',
        },
      ],
    });

    const body = await (await invoices(request())).json();

    expect(body.processor).toBe('stripe');
    expect(body.subscription).toEqual({
      plan: 'max',
      status: 'active',
      currentPeriodEnd: 1790000000,
      nextAmount: 9900,
      currency: 'usd',
      cancelAtPeriodEnd: false,
    });
    expect(body.invoices).toHaveLength(1);
    expect(body.historySource).toBeUndefined();
    expect(mockInvoicesList).toHaveBeenCalledWith({ customer: 'cus_stripe_1', limit: 100 });
    // Stripe's tenant never reaches Dodo at all.
    expect(dodo.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it('a Dodo API failure still returns plan and status', async () => {
    mockGetTenantPrivate.mockResolvedValue(DODO_TENANT);
    dodo.subscriptions.retrieve.mockRejectedValue(new Error('dodo is down'));

    const res = await invoices(request());
    const body = await res.json();

    // The screen still renders: the outage costs the DATE, not the page.
    expect(res.status).toBe(200);
    expect(body.processor).toBe('dodo');
    expect(body.subscription).toMatchObject({ plan: 'max', status: 'active' });
    expect(body.subscription.currentPeriodEnd).toBeNull();
    expect(body.historySource).toBe('portal');
  });

  it('a conflicted tenant is treated exactly as before', async () => {
    mockGetTenantPrivate.mockResolvedValue(CONFLICTED_TENANT);

    const body = await (await invoices(request())).json();

    // A tenant carrying live identifiers on both sides has no single true
    // renewal date, so it is asked for from neither processor.
    expect(body.processor).toBeNull();
    expect(body.subscription).toEqual({
      plan: 'max',
      status: 'active',
      currentPeriodEnd: null,
      nextAmount: null,
      currency: 'usd',
      cancelAtPeriodEnd: false,
    });
    expect(body.historySource).toBe('portal');
    expect(dodo.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mockSubRetrieve).not.toHaveBeenCalled();
  });

  it('nothing in this path can create or modify a subscription', async () => {
    for (const priv of [DODO_TENANT, CONFLICTED_TENANT, STRIPE_TENANT, {}]) {
      mockGetTenantPrivate.mockResolvedValue(priv);
      const res = await invoices(request());
      expect(res.status).toBe(200);
    }

    for (const [label, spy] of mutatingDodoCalls(dodo)) {
      expect(spy, label).not.toHaveBeenCalled();
    }
    // The only Dodo call this route may make is the subscription GET.
    expect(dodo.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(dodo.payments.list).not.toHaveBeenCalled();
  });

  it('a tenant with no Dodo subscription id degrades instead of erroring', async () => {
    // `resolveBillingOwnership` accepts `dodoCustomerId` alone as proof of Dodo
    // ownership, so this tenant is Dodo's with nothing to look up.
    mockGetTenantPrivate.mockResolvedValue({ billingProcessor: 'dodo', dodoCustomerId: 'cus_dodo_1' });

    const res = await invoices(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.processor).toBe('dodo');
    expect(body.subscription).toMatchObject({ plan: 'max', status: 'active' });
    expect(body.subscription.currentPeriodEnd).toBeNull();
    // No id means no call — not a call with undefined.
    expect(dodo.subscriptions.retrieve).not.toHaveBeenCalled();
  });
});

describe('THE-131: the billing screen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('the renewal line renders on the billing screen when a date is present', async () => {
    mockAuthFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        processor: 'dodo',
        subscription: {
          plan: 'max',
          status: 'active',
          currentPeriodEnd: NEXT_BILLING_UNIX,
          nextAmount: null,
          currency: 'usd',
          cancelAtPeriodEnd: false,
        },
        invoices: [],
        historySource: 'portal',
      }),
    });

    await act(async () => {
      root.render(
        <BillingAndPayments currentPlan="max" tenantId="grace" email="o@example.com" />,
      );
    });

    // Formatted the same way the component formats it, rather than pinned to a
    // literal — the claim is that the date reaches the screen, not that it is
    // rendered in one particular locale's spelling.
    const expected = new Date(NEXT_BILLING_UNIX * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    const text = container.textContent || '';

    expect(text).toContain(expected);
    // It is presented as the next charge, and the "nothing here" copy is gone.
    expect(text).toContain('Next Billing');
    expect(text).not.toContain('No active subscription');
    // No amount is asserted alongside it.
    expect(text).not.toMatch(/\$\d/);
  });
});
