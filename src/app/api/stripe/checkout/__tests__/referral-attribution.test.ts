import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AFFILIATE_PROGRAM_ENABLED } from '@/utils/plan-features';

/**
 * The server half of `?ref=` attribution, with AFFILIATE_PROGRAM_ENABLED === false.
 *
 * Hiding the programme hides UI. It must not touch the money path: a
 * `referrerId` that arrives on a checkout call still has to land in
 * `subscription_data.metadata`, because that is the only place the Stripe
 * webhook can read it from when it writes the commission row, and #253's
 * 12-month window is measured from that subscription's `start_date`. A signup
 * that checks out without the stamp is unattributable forever.
 *
 * Deliberately a separate file from route.test.ts: that file covers trial
 * scoping and the retired add-on, and nothing in it is changed by this PR.
 */
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
  },
  AI_ASSISTANT_MONTHLY: 'price_ai_m',
}));

const { POST } = await import('../route');

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
  mockCustomersRetrieve.mockResolvedValue({ id: 'cus_stored', deleted: false });
  mockCollGet.mockResolvedValue({ empty: true, docs: [] });
});

describe('POST /api/stripe/checkout — referral attribution with the programme hidden', () => {
  it('the programme really is hidden — otherwise the rest of this file proves nothing', () => {
    expect(AFFILIATE_PROGRAM_ENABLED).toBe(false);
  });

  it('stamps referrerId into the existing-tenant subscription metadata', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u3', email: 'admin@t.org', tenantId: 'tenant1', isSuperAdmin: false });
    mockDocGet.mockResolvedValue({ data: () => ({ stripeCustomerId: 'cus_stored', name: 'Tenant One' }) });

    const res = await POST(makeRequest({
      plan: 'max', billing: 'yearly', tenantId: 'tenant1', referrerId: 'affiliate-uid-1',
    }));
    expect(res.status).toBe(200);

    expect(lastSessionArgs().subscription_data.metadata).toEqual(
      expect.objectContaining({ referrerId: 'affiliate-uid-1' }),
    );
  });

  it('stamps referrerId into the NEW-MINISTRY signup metadata — the signup an old link produces', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u2', email: 'pastor@grace.org', tenantId: null, isSuperAdmin: false });

    const res = await POST(makeRequest({
      plan: 'pro', billing: 'monthly', ministryName: 'Grace Church', referrerId: 'affiliate-uid-1',
    }));
    expect(res.status).toBe(200);

    const meta = lastSessionArgs().subscription_data.metadata;
    expect(meta).toEqual(expect.objectContaining({ newTenant: 'true', referrerId: 'affiliate-uid-1' }));
  });

  it('resolves a short affiliate CODE to the affiliate uid before stamping', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u3', email: 'admin@t.org', tenantId: 'tenant1', isSuperAdmin: false });
    mockDocGet.mockResolvedValue({ data: () => ({ stripeCustomerId: 'cus_stored', name: 'Tenant One' }) });
    // users.where('affiliateCode','==','SHORTC') → the affiliate's user doc.
    mockCollGet.mockResolvedValue({ empty: false, docs: [{ id: 'affiliate-uid-1' }] });

    const res = await POST(makeRequest({
      plan: 'pro', billing: 'monthly', tenantId: 'tenant1', referrerId: 'SHORTC',
    }));
    expect(res.status).toBe(200);

    expect(lastSessionArgs().subscription_data.metadata.referrerId).toBe('affiliate-uid-1');
  });

  it('omits referrerId when the call carries none — no empty attribution', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u3', email: 'admin@t.org', tenantId: 'tenant1', isSuperAdmin: false });
    mockDocGet.mockResolvedValue({ data: () => ({ stripeCustomerId: 'cus_stored', name: 'Tenant One' }) });

    const res = await POST(makeRequest({ plan: 'max', billing: 'yearly', tenantId: 'tenant1' }));
    expect(res.status).toBe(200);

    expect(lastSessionArgs().subscription_data.metadata).not.toHaveProperty('referrerId');
  });
});
