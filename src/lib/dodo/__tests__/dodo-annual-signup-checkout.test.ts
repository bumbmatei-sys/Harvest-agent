import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { catalogueEntry, productIdFor, resolvePlanFromProductId, termPriceUsd } from '../catalogue';
import type { BillingPeriod } from '../provider';
import { readSignupBillingPeriod, type SignupBillingPeriod } from '@/utils/signup-checkout';
import { BILLING_TERMS, PRICED_PLAN_ORDER } from '@/utils/plan-features';

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

  /* ─── THE-195 TEST 6 ──────────────────────────────────────────────────── */
  it('the billing lane accepts monthly, quarterly and yearly', () => {
    expect(readSignupBillingPeriod('monthly')).toBe('monthly');
    expect(readSignupBillingPeriod('quarterly')).toBe('quarterly');
    expect(readSignupBillingPeriod('yearly')).toBe('yearly');
    // The accepted set IS the priced set — read, never restated.
    for (const term of BILLING_TERMS) expect(readSignupBillingPeriod(term)).toBe(term);
  });

  /* ─── 🔴 THE-195 TEST 7: THE REVENUE GUARD ────────────────────────────────
     Widening the allowlist to a third term must not widen what an UNTRUSTED
     value can select. Everything outside the three real terms still lands on
     monthly — the most expensive per-month term, and the one a signup carrying
     no period has always meant. */
  it('an untrusted billing value still falls back to monthly', () => {
    const forged = [
      'annual',        // Dodo's vocabulary — the original silent mis-sell
      'quarter', 'Quarterly', 'QUARTERLY', ' quarterly', 'quarterly ',
      'weekly', 'daily', 'lifetime', 'free', 'YEARLY', 'yearly ',
      '', null, undefined, 9, 0, {}, [], ['quarterly'], true, NaN,
    ];
    for (const bad of forged) {
      expect(readSignupBillingPeriod(bad), `"${String(bad)}" did not fail closed`).toBe('monthly');
    }
  });

  it('never lets a forged value select the cheapest per-month term', () => {
    // The shape of the hazard, stated as an invariant rather than a list: the
    // fallback must be the term with the HIGHEST per-month cost, so that
    // failing closed can never be cheaper than choosing honestly.
    const perMonth = (term: (typeof BILLING_TERMS)[number]) =>
      termPriceUsd('plus', term) / (term === 'monthly' ? 1 : term === 'quarterly' ? 3 : 12);
    const dearest = [...BILLING_TERMS].sort((a, b) => perMonth(b) - perMonth(a))[0];
    expect(readSignupBillingPeriod('definitely-not-a-term')).toBe(dearest);
    expect(dearest).toBe('monthly');
  });
});

describe('no plan price appears as a literal in the signup surfaces', () => {
  const touched = [
    'components/ChurchOnboarding.tsx',
    'components/OnboardingGate.tsx',
    'utils/signup-checkout.ts',
  ];

  // The forbidden figures are DERIVED from the catalogue, not typed here — the
  // same discipline this test enforces. Whole-USD and minor-unit forms both.
  // 🔴 PRICED_PLAN_ORDER, and NOT a cast. This read
  // `(PLAN_ORDER as readonly ('plus'|'pro'|'max')[])` — a hand-written copy of
  // the tier list, asserted over the real one. THE-200 added the Forever Free
  // tier to PLAN_ORDER, the cast went on lying about the element type, and
  // `termPriceUsd('free', …)` threw at COLLECTION time on a tier that has no
  // price row. The cast is what turned a compile error into a crash; the
  // derived list cannot drift from the pricing table it indexes.
  const forbidden = PRICED_PLAN_ORDER.flatMap((plan) =>
    BILLING_TERMS.flatMap((term) => [termPriceUsd(plan, term), termPriceUsd(plan, term) * 100]),
  );

  /**
   * 🔴 A NUMBER IS ONLY A PRICE WHERE IT SITS IN A MONEY POSITION (THE-222).
   *
   * This scan used to fire on the bare digits. That worked while the cheapest
   * plan was $39, and it broke the moment THE-222 made the tiers $20 / $40 /
   * $80 — because those figures, and their minor-unit forms 2000 / 4000 /
   * 8000, collide with things every React file is full of:
   *
   *   className="… sm:py-20"    Tailwind's spacing scale (ChurchOnboarding)
   *   elapsed += 2000           a poll interval in milliseconds (OnboardingGate)
   *
   * Neither can bill a church. Both failed this test on the day of the reprice,
   * and neither file so much as imports a pricing symbol. A rule that fails on
   * a padding class is a rule that gets switched off rather than obeyed, and
   * this repo has already settled the principle elsewhere: the sweep in
   * dodo-quarterly-term.test.ts distinguishes $99-the-quarterly-price from
   * other 99s by CONTEXT rather than by string match.
   *
   * So the question this asks is not "does the number appear" but "does it
   * appear where money goes". There are exactly two such places:
   *
   *   $20            a figure rendered to a church
   *   priceUsd: 20   a figure handed to a processor
   *
   * A typed plan price reaches a human or a card through one of those two; a
   * grid gap, a z-index and a setTimeout delay reach neither.
   */
  const MONEY_KEY = String.raw`(?:price|amount|cents|total|subtotal|usd|minorunits?|minor_units?|unit_amount)`;

  const moneyPositions = (literal: number) => [
    // Rendered: `$20`, `$20/mo`, `` `$${…}` `` never matches — only a typed one.
    new RegExp(String.raw`\$${literal}(?![\d.])`, 'i'),
    // Handed over: `priceUsd: 20`, `amount = 2000`, `unit_amount: 2000`.
    new RegExp(String.raw`${MONEY_KEY}\w*\s*[:=]\s*${literal}(?![\d.])`, 'i'),
  ];

  it.each(touched)('%s derives every figure it needs and writes none', (rel) => {
    const codeOnly = readFileSync(join(SRC, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    for (const literal of forbidden) {
      for (const position of moneyPositions(literal)) {
        expect(
          position.test(codeOnly),
          `${rel} writes ${literal} in a money position (${position.source}) — ` +
            'every plan price is read from PLAN_PRICING, always',
        ).toBe(false);
      }
    }
  });

  /**
   * 🔴 THE SCAN ABOVE, PROVED TO HAVE TEETH — by mutation, since narrowing a
   * rule is exactly the kind of change that can quietly neuter it.
   *
   * Both money positions are exercised against a real current price, and the
   * two shapes that broke on the reprice are exercised too: they must NOT
   * match, or the narrowing did not actually happen.
   */
  it('still catches a typed price, and still ignores a padding class and a timer', () => {
    const price = termPriceUsd('plus', 'monthly');
    const cents = price * 100;
    const matches = (src: string, literal: number) =>
      moneyPositions(literal).some((re) => re.test(src));

    // Caught: rendered, and handed to a processor.
    expect(matches(`<span>$${price}/mo</span>`, price)).toBe(true);
    expect(matches(`const body = { priceUsd: ${price} };`, price)).toBe(true);
    expect(matches(`const body = { unit_amount: ${cents} };`, cents)).toBe(true);
    expect(matches(`let amount = ${cents}`, cents)).toBe(true);

    // Ignored: the two real false positives THE-222 produced.
    expect(matches('className="px-5 py-14 sm:py-20"', price)).toBe(false);
    expect(matches(`elapsed += ${cents};`, cents)).toBe(false);
    expect(matches(`setTimeout(poll, ${cents});`, cents)).toBe(false);
  });
});
