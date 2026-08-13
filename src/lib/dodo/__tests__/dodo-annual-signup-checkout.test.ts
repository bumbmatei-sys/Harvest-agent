import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { catalogueEntry, productIdFor, resolvePlanFromProductId, annualPriceUsd } from '../catalogue';
import type { BillingPeriod } from '../provider';
import { readSignupBillingPeriod, type SignupBillingPeriod } from '@/utils/signup-checkout';
import { PLAN_ORDER } from '@/utils/plan-features';

/**
 * THE-88 (app half), server side: an annual signup buys the annual PRODUCT.
 *
 * The client tests pin what leaves the browser; these pin what the money path
 * does with it, through the REAL modules — the real route (so its `readPeriod`
 * is the validator under test), the real `dodo-provider` (so the product id in
 * the cart is looked up, not asserted about), and the real catalogue (so the id
 * is the catalogue's own, never a computed guess). Only the Dodo SDK client is
 * stubbed, at the seam the provider exposes for exactly this.
 */

const SRC = resolve(__dirname, '../../..');

// Hoisted above the static imports: the catalogue consumes the validated
// dodoConfig, so config.ts evaluates when '../catalogue' is imported and the
// three required variables must already exist.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'k';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('x').toString('base64');
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * POST a body at the real /api/dodo/checkout with the flag in a given position
 * and the SDK stubbed. Returns the response and the SDK's create spy.
 */
async function postSignupCheckout(
  body: Record<string, unknown>,
  { flag = true }: { flag?: boolean } = {},
) {
  vi.resetModules();
  vi.doMock('@/utils/plan-features', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/utils/plan-features')>()),
    DODO_BILLING_ENABLED: flag,
  }));
  vi.doMock('@/lib/api-auth', () => ({
    requireAuth: vi.fn().mockResolvedValue({
      uid: 'uid_1', email: 'pastor@grace.org', tenantId: null, isSuperAdmin: false,
    }),
  }));
  vi.doMock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: vi.fn() }));
  vi.doMock('@/lib/affiliate-referrer', () => ({
    resolveAffiliateReferrer: vi.fn(async () => ({ referrerId: null })),
    logReferralCapture: vi.fn(),
  }));

  const createSession = vi.fn(async () => ({
    session_id: 'cks_1',
    checkout_url: 'https://checkout.dodo/x',
  }));
  const providerMod = await import('@/lib/dodo/dodo-provider');
  providerMod.__setDodoClientForTests({
    checkoutSessions: { create: createSession },
  } as never);

  const { NextRequest } = await import('next/server');
  const { POST } = await import('@/app/api/dodo/checkout/route');
  const res = await POST(
    new NextRequest('https://theharvest.app/api/dodo/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
  );

  providerMod.__setDodoClientForTests(null);
  vi.doUnmock('@/utils/plan-features');
  vi.doUnmock('@/lib/api-auth');
  vi.doUnmock('@/lib/money-path-sentry');
  vi.doUnmock('@/lib/affiliate-referrer');
  vi.resetModules();
  return { res, createSession };
}

describe('signup carrying the annual period buys the annual product', () => {
  it('puts the catalogue product for (pro, yearly) in the cart — looked up, not guessed', async () => {
    const { res, createSession } = await postSignupCheckout({
      plan: 'pro', billing: 'yearly', ministryName: 'Grace Chapel',
    });

    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
    const cart = (createSession.mock.calls[0] as unknown[])[0] as {
      product_cart: Array<{ product_id: string; quantity: number }>;
      metadata: Record<string, string>;
    };

    // The id in the cart is the catalogue's own entry for the annual term…
    expect(cart.product_cart).toEqual([
      { product_id: catalogueEntry('pro', 'yearly').productId, quantity: 1 },
    ]);
    expect(cart.product_cart[0].product_id).toBe(productIdFor('pro', 'yearly'));
    // …and it round-trips through the reverse lookup the webhook will use, so
    // the tenant this checkout provisions can be named annual after the fact.
    expect(resolvePlanFromProductId(cart.product_cart[0].product_id)).toEqual({
      plan: 'pro', period: 'yearly',
    });
    // The metadata the webhook receives carries the period alongside the plan.
    expect(cart.metadata.billing).toBe('yearly');
    expect(cart.metadata.plan).toBe('pro');
  });

  it('still buys the monthly product when the body says monthly — no regression', async () => {
    const { res, createSession } = await postSignupCheckout({
      plan: 'plus', billing: 'monthly', ministryName: 'Hope',
    });
    expect(res.status).toBe(200);
    const cart = (createSession.mock.calls[0] as unknown[])[0] as {
      product_cart: Array<{ product_id: string }>;
    };
    expect(cart.product_cart[0].product_id).toBe(productIdFor('plus', 'monthly'));
  });
});

describe('an unrecognised period never reaches a product lookup', () => {
  it.each(['weekly', 'annual', 'YEARLY', 42, null])(
    'billing=%s is refused by the real readPeriod with a 400, and no session is created',
    async (bad) => {
      const { res, createSession } = await postSignupCheckout({
        plan: 'pro', billing: bad, ministryName: 'Grace Chapel',
      });
      expect(res.status).toBe(400);
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it('a body with NO billing at all is refused too — the monthly default lives in the client, the server never guesses', async () => {
    const { res, createSession } = await postSignupCheckout({
      plan: 'pro', ministryName: 'Grace Chapel',
    });
    expect(res.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe('with DODO_BILLING_ENABLED off, the path refuses', () => {
  it('returns 503 for an annual signup without touching the catalogue or the SDK', async () => {
    const { res, createSession } = await postSignupCheckout(
      { plan: 'pro', billing: 'yearly', ministryName: 'Grace Chapel' },
      { flag: false },
    );
    expect(res.status).toBe(503);
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("the client-side period vocabulary IS the provider's BillingPeriod", () => {
  it('the two types are mutually assignable, so they cannot drift apart', () => {
    // Compile-time pins, both directions: if either side ever grows or loses a
    // word, one of these two lines stops typechecking.
    const toProvider: BillingPeriod = 'yearly' as SignupBillingPeriod;
    const fromProvider: SignupBillingPeriod = 'yearly' as BillingPeriod;
    expect(toProvider).toBe('yearly');
    expect(fromProvider).toBe('yearly');
  });

  it('readSignupBillingPeriod passes exactly the two real periods and fails everything else closed', () => {
    expect(readSignupBillingPeriod('monthly')).toBe('monthly');
    expect(readSignupBillingPeriod('yearly')).toBe('yearly');
    for (const bad of ['annual', 'weekly', 'YEARLY', '', null, undefined, 9, {}]) {
      expect(readSignupBillingPeriod(bad)).toBe('monthly');
    }
  });
});

describe('no annual price appears as a literal in the signup surfaces', () => {
  const touched = [
    'components/ChurchOnboarding.tsx',
    'components/OnboardingGate.tsx',
    'utils/signup-checkout.ts',
  ];

  // The forbidden figures are DERIVED from the catalogue, not typed here — the
  // same discipline this test enforces. Whole-USD and minor-unit forms both.
  const forbidden = (PLAN_ORDER as readonly ('plus' | 'pro' | 'max')[]).flatMap((plan) => [
    annualPriceUsd(plan),
    annualPriceUsd(plan) * 100,
  ]);

  it.each(touched)('%s derives every figure it needs and writes none', (rel) => {
    const codeOnly = readFileSync(join(SRC, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    for (const literal of forbidden) {
      const asLiteral = new RegExp(`(?<![\\w.])${literal}(?![\\w.])`);
      expect(
        asLiteral.test(codeOnly),
        `${rel} writes ${literal} as a literal — annual figures derive from ANNUAL_BILLED_MONTHS, always`,
      ).toBe(false);
    }
  });
});
