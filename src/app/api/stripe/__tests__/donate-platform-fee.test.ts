import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The donation half of the shared-fee guarantee.
 *
 * donate-route.test.ts deliberately mocks `PLATFORM_FEE_MAP` with fabricated
 * rates so its redirect/metadata assertions do not move when pricing changes.
 * That leaves the REAL rate uncovered on the donation path, which is exactly
 * the number a repricing gets wrong. This file is the complement: it imports
 * the real `@/lib/stripe-connect` and pins what a donor on each tier actually
 * gets charged, on both the one-time and the monthly branch.
 *
 * Every tier is 0% now. Asserting that on the real `application_fee_amount` /
 * `application_fee_percent` Stripe receives — not just on the map — is the
 * point: the map being zero and the church actually keeping the whole gift are
 * two different claims, and only the second one is the promise.
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

// ── THE-256 ────────────────────────────────────────────────────────────────
// This suite pins what Stripe Connect DOES, so it runs with the master switch
// ON. That is the hide-not-delete guarantee expressed as a test: every rule
// below — the 0% fee on every tier, as an amount one-time and a percent monthly — still holds, unchanged, the moment
// STRIPE_CONNECT_ENABLED goes back to true. That the same route answers 503
// while the switch is OFF is asserted in the-256-stripe-connect-hidden.test.ts.
vi.mock('@/lib/stripe-connect-feature', () => ({
  STRIPE_CONNECT_ENABLED: true,
  STRIPE_CONNECT_HIDDEN_MESSAGE: 'Temporarily unavailable',
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockSessionsCreate } };
  },
}));
vi.mock('@/lib/api-auth', () => ({ verifyAuth: mockVerifyAuth }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockTenantGet })) })) },
}));
// NOTE: @/lib/stripe-connect is intentionally NOT mocked here.

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
  it.each(['plus', 'pro', 'max'] as const)(
    'deducts NOTHING from a one-time donation on %s — the church keeps the whole gift',
    async (plan) => {
      // $100.00 gift → $0.00 platform fee, all $100.00 to the church.
      tenantOnPlan(plan);
      const res = await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'one-time' }));
      expect(res.status).toBe(200);
      expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);
    }
  );

  it.each(['plus', 'pro', 'max'] as const)(
    'sets application_fee_percent to 0 on a monthly donation on %s',
    async (plan) => {
      // Subscriptions take a percent, not a fixed amount: feePercent * 100.
      tenantOnPlan(plan);
      await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'monthly' }));
      expect(lastSessionArgs().subscription_data.application_fee_percent).toBe(0);
    }
  );

  it('takes nothing from a large gift either — 0% is a rate, not a rounding artifact', async () => {
    // A $10,000 gift. At any of the old rates (1%, 1.5%) this would be 10000–15000
    // cents, so a fee sneaking back cannot hide inside Math.round here.
    tenantOnPlan('max');
    await POST(makeRequest({ amount: 1_000_000, tenantId: 'bumb', donationType: 'one-time' }));
    expect(lastSessionArgs().payment_intent_data.application_fee_amount).toBe(0);
  });
});
