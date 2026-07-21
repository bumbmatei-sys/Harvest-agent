import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks (must be defined before vi.mock calls) ───────────────────
const {
  mockSessionsCreate,
  mockCustomersRetrieve,
  mockCustomersCreate,
  mockCustomersList,
} = vi.hoisted(() => ({
  mockSessionsCreate: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe/x' }),
  mockCustomersRetrieve: vi.fn(),
  mockCustomersCreate: vi.fn().mockResolvedValue({ id: 'cus_created' }),
  mockCustomersList: vi.fn().mockResolvedValue({ data: [] }),
}));

const { mockRequireAuth } = vi.hoisted(() => ({ mockRequireAuth: vi.fn() }));

const { mockDocGet, mockDocSet, mockDocUpdate, mockCollGet } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockSessionsCreate } };
    customers = { retrieve: mockCustomersRetrieve, create: mockCustomersCreate, list: mockCustomersList };
  },
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ get: mockDocGet, set: mockDocSet, update: mockDocUpdate })),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: mockCollGet,
    })),
  },
}));

vi.mock('@/lib/stripe-config', () => ({
  PLAN_PRICES: {
    plus: { monthly: 'price_plus_m', yearly: 'price_plus_y' },
    pro: { monthly: 'price_pro_m', yearly: 'price_pro_y' },
    max: { monthly: 'price_max_m', yearly: 'price_max_y' },
    ultra: { monthly: 'price_ultra_m', yearly: 'price_ultra_y' },
  },
  AI_ASSISTANT_MONTHLY: 'price_ai_m',
}));

const { POST } = await import('../route');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://theharvest.app' },
    body: JSON.stringify(body),
  });
}

const lastSessionArgs = () => mockSessionsCreate.mock.calls[0][0] as any;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';
  mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe/x' });
  mockCustomersList.mockResolvedValue({ data: [] });
  mockCustomersCreate.mockResolvedValue({ id: 'cus_created' });
  // A stored customer that still resolves in this Stripe mode (so getValidCustomerId
  // reuses it and never falls through to customers.create).
  mockCustomersRetrieve.mockResolvedValue({ id: 'cus_stored', deleted: false });
});

// ── The 7-day trial belongs to the new-ministry signup session ONLY ─────────
describe('POST /api/stripe/checkout — 7-day trial scoping', () => {
  it('adds trial_period_days: 7 to the NEW-MINISTRY signup session (newTenant discriminator)', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u2', email: 'pastor@grace.org', tenantId: null, isSuperAdmin: false });

    const res = await POST(makeRequest({ plan: 'pro', billing: 'monthly', ministryName: 'Grace Church' }));
    expect(res.status).toBe(200);

    const args = lastSessionArgs();
    // The trial — captured up front (Checkout still collects the card).
    expect(args.subscription_data.trial_period_days).toBe(7);
    // …and this really is the new-signup session: the newTenant marker is present.
    expect(args.subscription_data.metadata).toEqual(
      expect.objectContaining({ newTenant: 'true', plan: 'pro', billing: 'monthly' }),
    );
    expect(args.line_items[0].price).toBe('price_pro_m');
  });

  // The AI Assistant add-on is retired (AI_TELEGRAM_ASSISTANT_ENABLED === false):
  // the add-on branch is disabled before any Stripe call, so no checkout session —
  // trialed or otherwise — can be created. This locks the money path closed.
  it('rejects the AI-assistant add-on checkout as no longer available (no session created)', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u1', email: 'admin@t.org', tenantId: 'tenant1', isSuperAdmin: false });
    mockDocGet.mockResolvedValue({ data: () => ({ aiAssistantCustomerId: 'cus_stored' }) });

    const res = await POST(makeRequest({ addOn: 'ai-assistant', tenantId: 'tenant1' }));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/no longer available/i);
    // No Stripe checkout session is ever created for the retired add-on.
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('does NOT add a trial to the existing-tenant plan-change session', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u3', email: 'admin@t.org', tenantId: 'tenant1', isSuperAdmin: false });
    // getValidCustomerId reads the tenant doc for a stored stripeCustomerId.
    mockDocGet.mockResolvedValue({ data: () => ({ stripeCustomerId: 'cus_stored', name: 'Tenant One' }) });

    const res = await POST(makeRequest({ plan: 'max', billing: 'yearly', tenantId: 'tenant1' }));
    expect(res.status).toBe(200);

    const args = lastSessionArgs();
    expect(args.subscription_data.trial_period_days).toBeUndefined();
    // Confirm this is the plan-change session: tenantId metadata, no newTenant marker.
    expect(args.subscription_data.metadata).toEqual(
      expect.objectContaining({ tenantId: 'tenant1', plan: 'max', billing: 'yearly' }),
    );
    expect(args.subscription_data.metadata.newTenant).toBeUndefined();
  });
});
