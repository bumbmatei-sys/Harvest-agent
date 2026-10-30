// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Church and Ministry have no Dodo TEST-mode product yet, so in test mode every
 * (plan, term) cell is `DODO_PRODUCT_UNMAPPED`. A checkout for either plan must be
 * REFUSED with the gap named, and Dodo must never be asked for a session: a test
 * environment that quietly carted a retired product would charge yesterday's price
 * for today's plan.
 *
 * This drives the REAL route, the REAL provider and the REAL catalogue. Only the Dodo
 * SDK client is stubbed (through the provider's own seam), so a stub that always
 * succeeds cannot hide a route that resolved some other product.
 */

vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

const { mockRequireAuth, mockCheckoutCreate } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockCheckoutCreate: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireAuth: mockRequireAuth,
  requireOwner: vi.fn(),
  requireAdmin: vi.fn(),
  requireTenantAdmin: vi.fn(),
}));
vi.mock('@/lib/affiliate-referrer', () => ({
  resolveAffiliateReferrer: async () => ({ referrerId: null }),
  logReferralCapture: vi.fn(),
}));
vi.mock('@/lib/money-path-sentry', () => ({
  captureMoneyPathError: vi.fn(),
  captureHandledError: vi.fn(),
}));

const { POST } = await import('@/app/api/dodo/checkout/route');
const { __setDodoClientForTests } = await import('@/lib/dodo/dodo-provider');
const { DODO_TEST_CATALOGUE, DODO_PRODUCT_UNMAPPED } = await import('@/lib/dodo/catalogue');
const { PRICED_PLAN_ORDER, BILLING_TERMS } = await import('@/utils/plan-features');

const post = (body: object) =>
  new NextRequest('https://theharvest.app/api/dodo/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://theharvest.app' },
    body: JSON.stringify(body),
  });

const EVERY_COMBINATION = PRICED_PLAN_ORDER.flatMap((plan) => BILLING_TERMS.map((term) => ({ plan, term })));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockRequireAuth.mockResolvedValue({
    uid: 'u1', email: 'pastor@grace.example', tenantId: null, isAdmin: false, isSuperAdmin: false,
  });
  mockCheckoutCreate.mockResolvedValue({ session_id: 'sess_1', checkout_url: 'https://dodo/checkout/1' });
  __setDodoClientForTests({ checkoutSessions: { create: mockCheckoutCreate } } as never);
});

describe('a test-mode signup checkout for the new plans is refused, not substituted', () => {
  it('the premise: every Church and Ministry cell is unmapped in test mode', () => {
    for (const { plan, term } of EVERY_COMBINATION) {
      expect(DODO_TEST_CATALOGUE[plan][term].productId, `${plan}/${term}`).toBe(DODO_PRODUCT_UNMAPPED);
    }
  });

  it.each(EVERY_COMBINATION)('refuses $plan on $term, names the gap and never reaches Dodo', async ({ plan, term }) => {
    const res = await POST(post({ plan, billing: term, ministryName: 'Grace Community Church' }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(new RegExp(`no ${term} product for plan "${plan}" in test_mode`));
    expect(mockCheckoutCreate, 'a checkout session was requested for an unmapped plan').not.toHaveBeenCalled();
  });

  it.each(['plus', 'pro', 'max'])('does not fall back to the retired %s product either', async (retired) => {
    const res = await POST(post({ plan: retired, billing: 'monthly', ministryName: 'Grace Community Church' }));

    expect(res.status).toBe(400);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });
});

vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }), set: vi.fn(async () => {}) }) }) } }));
