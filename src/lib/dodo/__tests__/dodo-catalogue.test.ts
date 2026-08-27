import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// catalogue.ts consumes the validated dodoConfig, so config.ts evaluates on
// import and the three required variables must exist first. Hoisted above the
// static imports below by vitest.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

import {
  DODO_LIVE_CATALOGUE,
  DODO_TEST_CATALOGUE,
  DODO_TRIAL_DAYS,
  allCatalogueProductIds,
  DODO_PRODUCT_UNMAPPED,
  catalogueEntry,
  offerableTerms,
  productIdFor,
  requireProductId,
  resolvePlanFromProductId,
  termPriceUsd,
} from '../catalogue';
import { BILLING_TERMS, PLAN_PRICING, planPriceUsd } from '@/utils/plan-features';
import type { TenantPlan } from '@/types/tenant.types';
import type { BillingPeriod } from '../provider';

/**
 * The Dodo catalogues: six test products, six live products, and the prices
 * they charge.
 *
 * Three independent things are pinned here, because they fail differently.
 *
 *  1. VALUES. Each `(plan, period)` resolves to the right product id at the
 *     right price, in each mode. A drifted product id is a SILENT failure —
 *     checkout succeeds, the church is charged, and the amount is wrong.
 *     Nothing about that is visible in a log.
 *  2. DERIVATION. Every price is READ FROM `PLAN_PRICING` rather than typed
 *     here. (It used to be computed from ANNUAL_BILLED_MONTHS; that multiplier
 *     is gone — the discounts no longer divide into whole months — so the table
 *     is the source and this module reads it.) A literal that happens to be
 *     correct today passes every value assertion and drifts the moment the
 *     table changes, so the source itself is scanned.
 *  3. SELECTION. The active catalogue follows the validated
 *     `dodoConfig.environment` and nothing else — no env read in catalogue.ts,
 *     no `??`, no third mode.
 *
 * The fixtures below were read back from Dodo's API — the test-mode products on
 * 2026-08-11, and all NINE live products re-read on 2026-08-20 for THE-195
 * (`products.retrieve` on each id). They are transcribed from Dodo's responses,
 * NOT computed from this repo's constants, which is what makes them an
 * independent check rather than a restatement of the code.
 */

type VerifiedProduct = { plan: TenantPlan; period: BillingPeriod; id: string; name: string; cents: number; interval: string };

/**
 * What Dodo's TEST MODE has on these products, transcribed from the API
 * response of 2026-08-11.
 *
 * ⚠️ THESE CENTS ARE THE OLD PRICES, AND THAT IS THE POINT. The six test-mode
 * products were created before THE-195 repriced everything, and no test-mode
 * QUARTERLY product was ever created. The catalogue's entries take `priceUsd`
 * from the CURRENT table like every other entry, so under test mode the app's
 * published figure and Dodo's stored figure genuinely disagree.
 *
 * That divergence is recorded here rather than papered over with a second price
 * table, and it is safe for exactly one reason: `dodoConfig.environment` is
 * `live_mode` for anything a real card touches, and the live catalogue IS
 * verified figure-for-figure below. What must not happen is this file quietly
 * asserting the old prices and thereby claiming test mode is in step when it is
 * not.
 */
const DODO_TEST_PRODUCTS_AS_VERIFIED = [
  { plan: 'plus', period: 'monthly', id: 'pdt_0NlAMMZk44L0tL8lcLX6M', name: 'Harvest Individual - Monthly', cents: 4900, interval: 'Month' },
  { plan: 'plus', period: 'yearly', id: 'pdt_0NlAMMeWwZDSlfNdti8FD', name: 'Harvest Individual - Annual', cents: 44100, interval: 'Year' },
  { plan: 'pro', period: 'monthly', id: 'pdt_0NlAMMhi90q5Ovk6QBzcf', name: 'Harvest Small Team - Monthly', cents: 9900, interval: 'Month' },
  { plan: 'pro', period: 'yearly', id: 'pdt_0NlAMMlsVKeYG8ukapmzE', name: 'Harvest Small Team - Annual', cents: 89100, interval: 'Year' },
  { plan: 'max', period: 'monthly', id: 'pdt_0NlAMMp4QndR3qPzlD8sG', name: 'Harvest Ministry - Monthly', cents: 19900, interval: 'Month' },
  { plan: 'max', period: 'yearly', id: 'pdt_0NlAMMsQBzMvRVNCY7zws', name: 'Harvest Ministry - Annual', cents: 179100, interval: 'Year' },
] as const satisfies readonly VerifiedProduct[];

/**
 * What Dodo's LIVE MODE has on these products. Transcribed from the
 * authenticated live API response of 2026-08-27, NOT from catalogue.ts.
 *
 * 🔴 THE-248 RAISED THE SIX DISCOUNTED AMOUNTS AND NOTHING ELSE. The quarters
 * were 4900 / 9900 / 19900 and the years 16500 / 32900 / 65900. Every id, the
 * three monthly amounts, the 14-day trials, the `saas` tax category and add-on
 * attachment were confirmed unchanged in the same read.
 *
 * ⚠️ THE TEST-MODE LIST ABOVE IS DELIBERATELY NOT IN STEP and did not move:
 * 4900 there is Individual MONTHLY on a stale test product, not Individual's
 * quarter. Two different products, the same four digits — which is exactly why
 * each row here is anchored to its product id.
 *
 * 🔴 A live id transposed or mistyped in the catalogue is a real card charged
 * at the wrong price. These nine lines are the independent record it is checked
 * against, character for character.
 */
const DODO_LIVE_PRODUCTS_AS_VERIFIED = [
  { plan: 'plus', period: 'monthly', id: 'pdt_0NlJZKKU2AQSSH7E4ziKA', name: 'Harvest Individual - Monthly', cents: 2000, interval: 'Month' },
  { plan: 'plus', period: 'quarterly', id: 'pdt_0NloCamoWgvgYDih2UETS', name: 'Harvest Individual - Quarterly', cents: 5400, interval: 'Month' },
  { plan: 'plus', period: 'yearly', id: 'pdt_0NlJZMLLKZ5SVGEoSGDdk', name: 'Harvest Individual - Annual', cents: 19000, interval: 'Year' },
  { plan: 'pro', period: 'monthly', id: 'pdt_0NlJZMOMhmZWiG6UVDl8I', name: 'Harvest Small Team - Monthly', cents: 4000, interval: 'Month' },
  { plan: 'pro', period: 'quarterly', id: 'pdt_0NloCaqg1QPMAlkfDnlOe', name: 'Harvest Small Team - Quarterly', cents: 10800, interval: 'Month' },
  { plan: 'pro', period: 'yearly', id: 'pdt_0NlJZMRWL8tuAZseUIRTP', name: 'Harvest Small Team - Annual', cents: 38000, interval: 'Year' },
  { plan: 'max', period: 'monthly', id: 'pdt_0NlJZMUUiT36FGMoiFXgl', name: 'Harvest Ministry - Monthly', cents: 8000, interval: 'Month' },
  { plan: 'max', period: 'quarterly', id: 'pdt_0NloCatUWEkEUq1usWJ0n', name: 'Harvest Ministry - Quarterly', cents: 21600, interval: 'Month' },
  { plan: 'max', period: 'yearly', id: 'pdt_0NlJZMXTnpRBAwTfBVpPs', name: 'Harvest Ministry - Annual', cents: 76000, interval: 'Year' },
] as const satisfies readonly VerifiedProduct[];

/**
 * 🔴 QUARTERLY IS `3 × Month`, NOT A QUARTER INTERVAL — Dodo has no such
 * interval. Read back from the live API with the prices above. This is why a
 * quarterly product carries the MONTHLY add-on ids: Dodo charges an add-on on
 * its product's cycle, and this product cycles in months.
 */
const DODO_LIVE_QUARTERLY_FREQUENCY = { count: 3, interval: 'Month' } as const;

const catalogueIds = (catalogue: typeof DODO_TEST_CATALOGUE): string[] =>
  Object.values(catalogue).flatMap((periods) =>
    Object.values(periods)
      .map((entry) => entry.productId)
      .filter((id): id is string => id !== DODO_PRODUCT_UNMAPPED),
  );

// ── The test catalogue: the six verified test-mode products ──────────────────

describe('the test catalogue holds exactly the six verified test-mode products', () => {
  it.each(DODO_TEST_PRODUCTS_AS_VERIFIED)(
    '$name ($plan/$period) maps to $id',
    ({ plan, period, id }) => {
      // Under this file's test_mode env the active catalogue IS the test
      // catalogue, so the public lookups are exercised directly.
      expect(productIdFor(plan, period)).toBe(id);
      expect(requireProductId(plan, period)).toBe(id);
    },
  );

  it("publishes the CURRENT table price, which test mode's Dodo products predate", () => {
    // ⚠️ The recorded divergence, asserted rather than hidden. Every entry takes
    // its price from `PLAN_PRICING`; the test-mode products in Dodo still hold
    // the pre-THE-195 figures. Asserting BOTH sides means the day someone
    // recreates the test catalogue, this test fails and tells them to update the
    // fixture — instead of the mismatch living on as folklore.
    for (const { plan, period, cents } of DODO_TEST_PRODUCTS_AS_VERIFIED) {
      expect(catalogueEntry(plan, period).priceUsd).toBe(planPriceUsd(plan, period));
      expect(catalogueEntry(plan, period).priceUsd).not.toBe(cents / 100);
    }
  });

  it('🔴 refuses to sell a term test mode has no product for, rather than substituting one', () => {
    // The three quarterly products were created in LIVE mode only. No id was
    // invented for test mode, so the term is UNMAPPED and every purchase path
    // must refuse — falling back to another term would charge a church that
    // chose quarterly for a whole year.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      expect(productIdFor(plan, 'quarterly')).toBe(DODO_PRODUCT_UNMAPPED);
      expect(() => requireProductId(plan, 'quarterly')).toThrow(/not sellable in this mode/);
      expect(offerableTerms(plan)).toEqual(['monthly', 'yearly']);
      expect(requireProductId(plan, 'monthly')).toBeTruthy();
      expect(requireProductId(plan, 'yearly')).toBeTruthy();
    }
  });

  it('carries the 14-day trial Dodo has configured on every product', () => {
    expect(DODO_TRIAL_DAYS).toBe(14);
    for (const { plan, period } of DODO_TEST_PRODUCTS_AS_VERIFIED) {
      expect(catalogueEntry(plan, period).trialDays).toBe(14);
    }
  });

  it("labels annual entries with Dodo's own word for the period, not the app's", () => {
    // The catalogue metadata in Dodo says `annual`; the app says `yearly`. The
    // two vocabularies meet here and nowhere else.
    expect(catalogueEntry('max', 'yearly').dodoBillingPeriod).toBe('annual');
    expect(catalogueEntry('max', 'monthly').dodoBillingPeriod).toBe('monthly');
  });
});

// ── The live catalogue: the six verified live products ───────────────────────

describe('every live product id is pinned exactly as verified against Dodo', () => {
  it.each(DODO_LIVE_PRODUCTS_AS_VERIFIED)(
    '$name ($plan/$period) maps to $id at $cents minor units',
    ({ plan, period, id, cents }) => {
      const entry = DODO_LIVE_CATALOGUE[plan][period];
      expect(entry.productId).toBe(id);
      expect(entry.priceMinorUnits).toBe(cents);
      expect(entry.priceUsd).toBe(cents / 100);
    },
  );

  it('the trial is 14 days on every live entry', () => {
    for (const { plan, period } of DODO_LIVE_PRODUCTS_AS_VERIFIED) {
      expect(DODO_LIVE_CATALOGUE[plan][period].trialDays).toBe(14);
    }
  });

  it("labels live annual entries with Dodo's own word for the period", () => {
    expect(DODO_LIVE_CATALOGUE.max.yearly.dodoBillingPeriod).toBe('annual');
    expect(DODO_LIVE_CATALOGUE.max.monthly.dodoBillingPeriod).toBe('monthly');
  });
});

describe('the two catalogues are disjoint and complete', () => {
  it('each catalogue names only mapped ids and reuses none', () => {
    for (const catalogue of [DODO_TEST_CATALOGUE, DODO_LIVE_CATALOGUE]) {
      const ids = catalogueIds(catalogue);
      // Six in test (quarterly is unmapped), nine in live.
      expect(ids.length).toBe(catalogue === DODO_LIVE_CATALOGUE ? 9 : 6);
      expect(new Set(ids).size).toBe(ids.length); // no id reused across two plans or terms
    }
  });

  it('live and test ids never overlap', () => {
    const testIds = catalogueIds(DODO_TEST_CATALOGUE);
    const liveIds = catalogueIds(DODO_LIVE_CATALOGUE);
    const testSet = new Set(testIds);
    for (const id of liveIds) expect(testSet.has(id)).toBe(false);
    expect(new Set([...testIds, ...liveIds]).size).toBe(testIds.length + liveIds.length);
  });
});

// ── Prices, in both catalogues ───────────────────────────────────────────────

describe('prices resolve to the nine figures in the table', () => {
  it.each([
    ['plus', 20, 54, 190],
    ['pro', 40, 108, 380],
    ['max', 80, 216, 760],
  ] as const)('%s is $%i monthly, $%i quarterly and $%i annually', (plan, monthly, quarterly, annual) => {
    expect(termPriceUsd(plan, 'monthly')).toBe(monthly);
    expect(termPriceUsd(plan, 'quarterly')).toBe(quarterly);
    expect(termPriceUsd(plan, 'yearly')).toBe(annual);
    expect(catalogueEntry(plan, 'monthly').priceUsd).toBe(monthly);
    expect(catalogueEntry(plan, 'quarterly').priceUsd).toBe(quarterly);
    expect(catalogueEntry(plan, 'yearly').priceUsd).toBe(annual);
  });

  it.each(DODO_LIVE_PRODUCTS_AS_VERIFIED)(
    'live $name ($plan/$period) publishes $$cents minor units',
    ({ plan, period, cents }) => {
      expect(DODO_LIVE_CATALOGUE[plan][period].priceUsd).toBe(cents / 100);
      expect(DODO_LIVE_CATALOGUE[plan][period].priceMinorUnits).toBe(cents);
    },
  );

  it.each(DODO_LIVE_PRODUCTS_AS_VERIFIED)(
    '$name ($plan/$period) agrees with the price the app publishes',
    ({ plan, period, cents }) => {
      // 🔴 The whole point. `PLAN_PRICING` is what every app surface renders and
      // what the marketing site's cross-repo contract compares against; `cents`
      // above is what Dodo will actually charge a card. If those two disagree,
      // the app advertises one number and the church is billed another.
      expect(planPriceUsd(plan, period)).toBe(cents / 100);
      expect(termPriceUsd(plan, period)).toBe(cents / 100);
    },
  );

  it('🔴 reads the price table rather than deriving from a multiplier', () => {
    // ANNUAL_BILLED_MONTHS is gone: 20% off a year is x9.6 months and 10% off a
    // quarter is x2.55, so there is no integer to name. What replaced it is a
    // stored table, and this proves the catalogue READS it — no term's price is
    // a whole number of months at the monthly rate, so no multiplier could have
    // produced these figures.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      for (const term of ['quarterly', 'yearly'] as const) {
        const inMonths =
          DODO_LIVE_CATALOGUE[plan][term].priceUsd / DODO_LIVE_CATALOGUE[plan].monthly.priceUsd;
        expect(Number.isInteger(inMonths), `${plan} ${term} is exactly ${inMonths} months`).toBe(false);
      }
    }
  });

  it('bills quarterly as three MONTHLY cycles, which is why it carries monthly add-ons', () => {
    // Verified against the live API: `payment_frequency_count: 3,
    // payment_frequency_interval: 'Month'`. Dodo has no quarter interval.
    expect(DODO_LIVE_QUARTERLY_FREQUENCY).toEqual({ count: 3, interval: 'Month' });
    for (const { plan, period, interval } of DODO_LIVE_PRODUCTS_AS_VERIFIED) {
      if (period === 'quarterly') expect(interval).toBe('Month');
    }
  });
});

// ── The annual figures are DERIVED, not typed ────────────────────────────────

describe('annual figures are derived in source, not written as literals', () => {
  const cataloguePath = resolve(__dirname, '../catalogue.ts');

  /**
   * Strip comments before scanning.
   *
   * The docblock deliberately lists the published prices ("$441/yr") so a reader
   * can see the catalogue at a glance; that is documentation, not a second source
   * of truth. Only executable source is subject to the rule below.
   */
  const codeOnly = readFileSync(cataloguePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  it.each([441, 891, 1791, 44100, 89100, 179100])(
    'does not contain %i as a literal anywhere in its code',
    (literal) => {
      // Bounded so a product id such as pdt_0NlAMMZk44L0tL8lcLX6M cannot trip it.
      const asLiteral = new RegExp(`(?<![\\w.])${literal}(?![\\w.])`);
      expect(
        asLiteral.test(codeOnly),
        `catalogue.ts writes ${literal} as a literal. Annual prices must be derived ` +
          'from ANNUAL_BILLED_MONTHS — a typed-out annual figure is a second source ' +
          'of truth that drifts silently and bills the wrong amount.',
      ).toBe(false);
    },
  );

  it('reads the price table in its code, not just in a comment', () => {
    expect(codeOnly).toContain('planPriceUsd');
  });

  it('reads no environment variable and has no ?? fallback — #207 in one line', () => {
    // billing.ts's `process.env.X ?? 'price_test_...'` is the defect this
    // catalogue exists to avoid repeating. There is no env read here at all:
    // the live/test selection consumes the already-validated dodoConfig from
    // config.ts, which is the one module allowed to touch the environment.
    expect(codeOnly).not.toContain('process.env');
    expect(codeOnly).not.toContain('??');
    expect(codeOnly).toContain('dodoConfig');
  });
});

// ── The reverse lookup the subscription webhook depends on ───────────────────

describe('resolvePlanFromProductId — product id back to a plan', () => {
  it.each(DODO_TEST_PRODUCTS_AS_VERIFIED)('resolves $id to $plan/$period in test mode', ({ plan, period, id }) => {
    expect(resolvePlanFromProductId(id)).toEqual({ plan, period });
  });

  it('round-trips every MAPPED entry of the active catalogue', () => {
    for (const [plan, periods] of Object.entries(DODO_TEST_CATALOGUE)) {
      for (const [period, entry] of Object.entries(periods)) {
        // An unmapped term has no id to round-trip. Skipping it here is not a
        // hole: `resolvePlanFromProductId` is separately pinned below to refuse
        // a null rather than treat two gaps as a match.
        if (entry.productId === DODO_PRODUCT_UNMAPPED) continue;
        expect(resolvePlanFromProductId(entry.productId)).toEqual({ plan, period });
      }
    }
    expect(new Set(allCatalogueProductIds())).toEqual(new Set(catalogueIds(DODO_TEST_CATALOGUE)));
  });

  it('returns null for a foreign id rather than defaulting to a plan', () => {
    // An add-on product (REP-5), a Stripe price, a typo — and, just as foreign,
    // a LIVE product id while this build runs in test mode. Every one of them
    // must be "unknown", never "the cheapest plan" — defaulting here would
    // silently grant a tier nobody paid for.
    expect(resolvePlanFromProductId('pdt_not_ours')).toBeNull();
    expect(resolvePlanFromProductId('price_1TjKTb1YKkcSbTf3kxXDuq5X')).toBeNull();
    expect(resolvePlanFromProductId('')).toBeNull();
    for (const { id } of DODO_LIVE_PRODUCTS_AS_VERIFIED) {
      expect(resolvePlanFromProductId(id)).toBeNull();
    }
  });
});

// ── Selection: the active catalogue follows the validated environment ────────

describe('the active catalogue follows DODO_PAYMENTS_ENVIRONMENT', () => {
  const withEnvironment = async (mode: string) => {
    vi.resetModules();
    const previous = process.env.DODO_PAYMENTS_ENVIRONMENT;
    process.env.DODO_PAYMENTS_ENVIRONMENT = mode;
    try {
      return await import('../catalogue');
    } finally {
      process.env.DODO_PAYMENTS_ENVIRONMENT = previous;
      vi.resetModules();
    }
  };

  it('selects the live catalogue under live_mode, and resolves only it', async () => {
    const live = await withEnvironment('live_mode');
    for (const { plan, period, id } of DODO_LIVE_PRODUCTS_AS_VERIFIED) {
      expect(live.productIdFor(plan, period)).toBe(id);
      // Round-trip of the active (live) catalogue.
      expect(live.resolvePlanFromProductId(id)).toEqual({ plan, period });
    }
    expect(new Set(live.allCatalogueProductIds())).toEqual(
      new Set(DODO_LIVE_PRODUCTS_AS_VERIFIED.map((product) => product.id)),
    );
    // Test-mode ids are FOREIGN under live mode, by decision: every test-mode
    // tenant is a cancelled test artifact, and a live deployment that treated a
    // test product id as valid would be a bug surface.
    for (const { id } of DODO_TEST_PRODUCTS_AS_VERIFIED) {
      expect(live.resolvePlanFromProductId(id)).toBeNull();
    }
  });

  it('selects the test catalogue under test_mode', async () => {
    const test = await withEnvironment('test_mode');
    for (const { plan, period, id } of DODO_TEST_PRODUCTS_AS_VERIFIED) {
      expect(test.productIdFor(plan, period)).toBe(id);
    }
  });
});
