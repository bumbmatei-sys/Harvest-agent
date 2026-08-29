import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * 🔴 THE FREE TIER HAS NO DONATE PAGE — the server-side half. (THE-202)
 *
 * `free.fundraising` is false in the feature matrix, and THE-202 hides the Give
 * tab in MainApp. Neither of those is a gate. This route is deliberately
 * reachable WITHOUT authentication so an anonymous donor can give, which means
 * anyone holding the URL can POST to it — a hidden tab stops nobody. This file
 * pins the refusal at the only place it can be enforced.
 *
 * What is actually being asserted, in order of what matters:
 *
 *   1. No Checkout Session is created. `expect(mockSessionsCreate).not.toHaveBeenCalled()`
 *      is the claim; the 403 is merely how it is reported. A route that
 *      answered 403 AFTER opening a session would pass a status-code assertion
 *      and still have taken the donor's money.
 *   2. The refusal is the PLAN, not the setup. The free tenant in these tests
 *      carries a live `stripeConnectAccountId`, so "not set up for payments"
 *      (400) cannot be what is being observed.
 *   3. Every priced tier still reaches a session. A gate that refused everyone
 *      would satisfy 1 and 2 and break giving for every paying church.
 *
 * Nothing here hardcodes 'free'. The tier under test is DERIVED from the matrix
 * — the tiers with `fundraising: false` are refused and the tiers with it true
 * are not — so if the founder ever turns fundraising on for free, this file
 * fails and states which tier moved, instead of silently pinning yesterday's
 * product decision.
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
// below — THE-202's free-tier refusal, ahead of any Stripe object — still holds, unchanged, the moment
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

const { POST } = await import('../donate/route');
const { GIVING_UNAVAILABLE_MESSAGE } = await import('@/lib/tenant-lifecycle');
const { getPlanFeatures, PLAN_ORDER } = await import('@/utils/plan-features');

/**
 * The tiers this test drives, derived rather than listed. `PLAN_ORDER` is every
 * tier including free; splitting it on the matrix cell is what keeps the two
 * groups honest if the cell ever moves.
 */
const REFUSED = PLAN_ORDER.filter((p) => getPlanFeatures(p).fundraising === false);
const ALLOWED = PLAN_ORDER.filter((p) => getPlanFeatures(p).fundraising === true);

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/stripe/donate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * A tenant on `plan` that IS set up for payments. The Connect account is the
 * important part: without it the route answers 400 at the next branch down, and
 * a test asserting "the donation did not go through" would pass for the wrong
 * reason.
 */
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
});

describe('POST /api/stripe/donate — a tier without fundraising cannot take a gift', () => {
  it('the matrix actually splits the tiers, so neither group below is empty', () => {
    // Both `it.each` blocks pass vacuously on an empty array. This is what
    // stops that: the split must be a real one, and free must be on the
    // refused side of it.
    expect(REFUSED.length, 'no tier has fundraising:false — the gate under test is unreachable').toBeGreaterThan(0);
    expect(ALLOWED.length, 'no tier has fundraising:true — giving is broken for everyone').toBeGreaterThan(0);
    expect(REFUSED).toContain('free');
  });

  it.each(REFUSED)('refuses a one-time gift on %s WITHOUT creating a Checkout Session', async (plan) => {
    tenantOnPlan(plan);
    const res = await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'one-time' }));

    // The real assertion: Stripe was never reached.
    expect(mockSessionsCreate, 'a session was opened for a tier with no donate page').not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it.each(REFUSED)('refuses a MONTHLY gift on %s too — the gate sits above both branches', async (plan) => {
    tenantOnPlan(plan);
    const res = await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'monthly' }));

    expect(mockSessionsCreate).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it('refuses a very large gift too — this is a plan gate, not an amount threshold', async () => {
    tenantOnPlan('free');
    const res = await POST(makeRequest({ amount: 1_000_000, tenantId: 'bumb', donationType: 'one-time' }));

    expect(mockSessionsCreate).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it('tells the donor nothing about the church’s subscription tier', async () => {
    tenantOnPlan('free');
    const res = await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'one-time' }));
    const body = await res.json();

    // Reuses the existing lifecycle copy verbatim rather than writing a second
    // refusal string: the reader is a donor, and which plan a church is on is
    // not theirs to be told.
    expect(body).toEqual({ error: GIVING_UNAVAILABLE_MESSAGE });
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/free|plan|tier|upgrade|subscription/);
  });

  it('refuses even though the tenant IS set up for payments, so it is the plan that refused', async () => {
    // Same fixture as every other test here — stated as its own assertion so
    // the 400 "has not set up payments yet" branch cannot be mistaken for this
    // one if the ordering in the route ever changes.
    tenantOnPlan('free');
    const res = await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'one-time' }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).not.toMatch(/set up payments/i);
  });
});

describe('POST /api/stripe/donate — every tier that DOES have fundraising still works', () => {
  it.each(ALLOWED)('opens a Checkout Session on %s, exactly as before', async (plan) => {
    tenantOnPlan(plan);
    const res = await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'one-time' }));

    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it.each(ALLOWED)('opens a monthly Checkout Session on %s', async (plan) => {
    tenantOnPlan(plan);
    await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'monthly' }));

    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('an unknown plan string still gives, because the route defaults it to a paid tier', async () => {
    // The route reads `tenantData.plan || 'plus'`. A tenant doc with no plan at
    // all is an EXISTING church whose field was never written, not a free
    // signup — failing that closed would stop real donations, so it stays open
    // and is pinned here so the default cannot drift to 'free' unnoticed.
    tenantOnPlan('');
    const res = await POST(makeRequest({ amount: 10000, tenantId: 'bumb', donationType: 'one-time' }));

    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });
});
