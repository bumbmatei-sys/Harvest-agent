import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The donation half of the shared-fee guarantee.
 *
 * donate-route.test.ts deliberately mocks `PLATFORM_FEE_MAP` with fabricated
 * rates so its redirect/metadata assertions do not move when pricing changes.
 * That leaves the REAL rate uncovered on the donation path, which is exactly
 * the number a repricing gets wrong. This file is the complement: it imports
 * the real `@/lib/stripe-config` and pins what a donor on Small Team (pro)
 * actually gets charged, on both the one-time and the monthly branch.
 *
 * The paid-event-ticket half — the other importer of the same map — is pinned
 * in src/app/api/event-registration/__tests__/submit-route.test.ts.
 */

process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID = 'harvest';

const { mockVerifyAuth } = vi.hoisted(() => ({ mockVerifyAuth: vi.fn() }));
const { mockSessionsCreate } = vi.hoisted(() => ({
  mockSessionsCreate: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe/x' }),
}));
const { mockTenantGet } = vi.hoisted(() => ({ mockTenantGet: vi.fn() }));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockSessionsCreate } };
  },
}));
vi.mock('@/lib/api-auth', () => ({ verifyAuth: mockVerifyAuth }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockTenantGet })) })) },
}));
// NOTE: @/lib/stripe-config is intentionally NOT mocked here.

const { POST } = await import('../donate/route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/stripe/donate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const lastSessionArgs = () => mockSessionsCreate.mock.calls[0][0] as any;

function tenantOnPlan(plan: string) {
  mockTenantGet.mockResolvedValue({
    exists: true,
    data: () => ({ stripeConnectAccountId: 'acct_T', plan }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'theharvest.app';
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';
  mockVerifyAuth.mockResolvedValue(null);
  mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe/x' });
  tenantOnPlan('pro');
});

describe('POST /api/stripe/donate — real platform fee per plan', () => {
  it('deducts 1.5% from a one-time donation on Small Team (pro)', async () => {
    // $100.00 gift → $1.50 platform fee, $98.50 to the church (98.5% retention).
    const res = await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'one-time' }));
    expect(res.status).toBe(200);
    expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(150);
  });

  it('sets application_fee_percent to 1.5 on a monthly donation on Small Team (pro)', async () => {
    // Subscriptions take a percent, not a fixed amount: feePercent * 100.
    await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'monthly' }));
    expect(lastSessionArgs().subscription_data.application_fee_percent).toBe(1.5);
  });

  it('deducts 1.5% on Individual (plus) — same rate as Small Team', async () => {
    tenantOnPlan('plus');
    await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'one-time' }));
    expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(150);
  });

  it('deducts 1% on Community (max)', async () => {
    tenantOnPlan('max');
    await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'one-time' }));
    expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(100);
  });

  it('deducts nothing on Ministry (ultra) — the church keeps the whole gift', async () => {
    tenantOnPlan('ultra');
    await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'one-time' }));
    expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);
  });
});
