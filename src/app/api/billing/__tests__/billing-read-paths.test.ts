import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-79 — the billing READ paths, for a tenant Stripe does not own.
 *
 * Neither route can double-charge anyone: they only read. They are here because
 * answering a Dodo-billed church out of Stripe's ledger does something worse than
 * failing — it succeeds, and reports "No payments yet" and "Total paid $0.00" to
 * an owner who is being charged every month. That is the screen a treasurer
 * checks first when reconciling two card charges against one contract.
 */

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

const { GET: invoices } = await import('@/app/api/billing/invoices/route');
const { POST: statement } = await import('@/app/api/billing/statement/route');

const DODO_TENANT = {
  billingProcessor: 'dodo',
  dodoCustomerId: 'cus_dodo_1',
  dodoSubscriptionId: 'sub_dodo_1',
};
const STRIPE_TENANT = { stripeCustomerId: 'cus_stripe_1', stripeSubscriptionId: 'sub_stripe_1' };

function makeRequest(path: string): NextRequest {
  return new NextRequest(`https://example.com/api/billing/${path}`, {
    method: path === 'invoices' ? 'GET' : 'POST',
    ...(path === 'invoices' ? {} : { headers: { 'content-type': 'application/json' }, body: '{}' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  mockRequireOwner.mockResolvedValue({
    user: { uid: 'u1' },
    tenantId: 'grace',
    tenantData: { name: 'Grace Chapel', plan: 'max', status: 'active' },
  });
  mockInvoicesList.mockResolvedValue({ data: [] });
  mockSubRetrieve.mockResolvedValue({
    items: { data: [{ current_period_end: 1790000000, quantity: 1, price: { unit_amount: 9900, currency: 'usd' } }] },
    cancel_at_period_end: false,
  });
});

describe('GET /api/billing/invoices', () => {
  it('does not answer for Stripe when the tenant is billed by Dodo', async () => {
    mockGetTenantPrivate.mockResolvedValue(DODO_TENANT);

    const res = await invoices(makeRequest('invoices'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.processor).toBe('dodo');
    // The plan and status come from the tenant doc and ARE true for this tenant…
    expect(body.subscription).toMatchObject({ plan: 'max', status: 'active' });
    // …while the client is told where the real history lives, so the empty table
    // does not render as "No payments yet." to someone who is paying.
    expect(body.historySource).toBe('portal');
    // Stripe's ledger is never consulted.
    expect(mockInvoicesList).not.toHaveBeenCalled();
    expect(mockSubRetrieve).not.toHaveBeenCalled();
  });

  it('is unchanged for a Stripe-owned tenant', async () => {
    mockGetTenantPrivate.mockResolvedValue(STRIPE_TENANT);
    mockInvoicesList.mockResolvedValue({
      data: [{ id: 'in_1', created: 1780000000, amount_paid: 9900, total: 9900, currency: 'usd', status: 'paid', invoice_pdf: 'https://x/pdf', hosted_invoice_url: 'https://x/h' }],
    });

    const res = await invoices(makeRequest('invoices'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.processor).toBe('stripe');
    expect(body.historySource).toBeUndefined();
    expect(body.invoices).toHaveLength(1);
    expect(body.subscription).toMatchObject({ plan: 'max', currentPeriodEnd: 1790000000, nextAmount: 9900 });
    expect(mockInvoicesList).toHaveBeenCalledWith({ customer: 'cus_stripe_1', limit: 100 });
  });

  it('still reports an unbilled tenant as having no subscription', async () => {
    mockGetTenantPrivate.mockResolvedValue({});
    const body = await (await invoices(makeRequest('invoices'))).json();
    expect(body).toEqual({ processor: 'stripe', subscription: null, invoices: [] });
  });
});

describe('POST /api/billing/statement', () => {
  it('refuses rather than hand a Dodo-billed church a PDF saying they paid $0.00', async () => {
    mockGetTenantPrivate.mockResolvedValue(DODO_TENANT);

    const res = await statement(makeRequest('statement'));

    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).not.toContain('application/pdf');
    const body = await res.json();
    expect(body.error).toMatch(/Dodo Payments/);
    expect(body.error).toMatch(/Manage subscription/);
    expect(mockInvoicesList).not.toHaveBeenCalled();
  });

  it('still generates the PDF for a Stripe-owned tenant', async () => {
    mockGetTenantPrivate.mockResolvedValue(STRIPE_TENANT);

    const res = await statement(makeRequest('statement'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(mockInvoicesList).toHaveBeenCalledWith({ customer: 'cus_stripe_1', limit: 100 });
  });
});
