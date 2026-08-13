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
  annualPriceUsd,
  catalogueEntry,
  monthlyPriceUsd,
  productIdFor,
  resolvePlanFromProductId,
} from '../catalogue';
import { ANNUAL_BILLED_MONTHS, PLAN_PRICING } from '@/utils/plan-features';
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
 *  2. DERIVATION. The annual figures are computed from ANNUAL_BILLED_MONTHS
 *     rather than typed. A literal that happens to be correct today passes
 *     every value assertion and drifts the moment the constant changes, so the
 *     source itself is scanned.
 *  3. SELECTION. The active catalogue follows the validated
 *     `dodoConfig.environment` and nothing else — no env read in catalogue.ts,
 *     no `??`, no third mode.
 *
 * The fixtures below were read back from Dodo's API — the test-mode products on
 * 2026-08-11 and the LIVE products on 2026-08-13 (`products.retrieve` on each
 * id, 16 checks per product, zero failures). They are transcribed from Dodo's
 * responses, NOT computed from this repo's constants, which is what makes them
 * an independent check rather than a restatement of the code.
 */

type VerifiedProduct = { plan: TenantPlan; period: BillingPeriod; id: string; name: string; cents: number; interval: string };

/** What Dodo's TEST MODE has on these products. Transcribed from the API response. */
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
 * authenticated live API response of 2026-08-13, NOT from catalogue.ts.
 *
 * 🔴 A live id transposed or mistyped in the catalogue is a real card charged
 * at the wrong price. These six lines are the independent record it is checked
 * against, character for character.
 */
const DODO_LIVE_PRODUCTS_AS_VERIFIED = [
  { plan: 'plus', period: 'monthly', id: 'pdt_0NlJZKKU2AQSSH7E4ziKA', name: 'Harvest Individual - Monthly', cents: 4900, interval: 'Month' },
  { plan: 'plus', period: 'yearly', id: 'pdt_0NlJZMLLKZ5SVGEoSGDdk', name: 'Harvest Individual - Annual', cents: 44100, interval: 'Year' },
  { plan: 'pro', period: 'monthly', id: 'pdt_0NlJZMOMhmZWiG6UVDl8I', name: 'Harvest Small Team - Monthly', cents: 9900, interval: 'Month' },
  { plan: 'pro', period: 'yearly', id: 'pdt_0NlJZMRWL8tuAZseUIRTP', name: 'Harvest Small Team - Annual', cents: 89100, interval: 'Year' },
  { plan: 'max', period: 'monthly', id: 'pdt_0NlJZMUUiT36FGMoiFXgl', name: 'Harvest Ministry - Monthly', cents: 19900, interval: 'Month' },
  { plan: 'max', period: 'yearly', id: 'pdt_0NlJZMXTnpRBAwTfBVpPs', name: 'Harvest Ministry - Annual', cents: 179100, interval: 'Year' },
] as const satisfies readonly VerifiedProduct[];

const catalogueIds = (catalogue: typeof DODO_TEST_CATALOGUE): string[] =>
  Object.values(catalogue).flatMap((periods) => Object.values(periods).map((entry) => entry.productId));

// ── The test catalogue: the six verified test-mode products ──────────────────

describe('the test catalogue holds exactly the six verified test-mode products', () => {
  it.each(DODO_TEST_PRODUCTS_AS_VERIFIED)(
    '$name ($plan/$period) maps to $id at $cents minor units',
    ({ plan, period, id, cents }) => {
      // Under this file's test_mode env the active catalogue IS the test
      // catalogue, so the public lookups are exercised directly.
      expect(productIdFor(plan, period)).toBe(id);
      expect(catalogueEntry(plan, period).priceMinorUnits).toBe(cents);
      expect(catalogueEntry(plan, period).priceUsd).toBe(cents / 100);
    },
  );

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
  it('each catalogue has six entries and reuses no id', () => {
    for (const catalogue of [DODO_TEST_CATALOGUE, DODO_LIVE_CATALOGUE]) {
      const ids = catalogueIds(catalogue);
      expect(ids).toHaveLength(6);
      expect(new Set(ids).size).toBe(6); // no id reused across two plans
    }
  });

  it('live and test ids never overlap', () => {
    const testIds = new Set(catalogueIds(DODO_TEST_CATALOGUE));
    const liveIds = catalogueIds(DODO_LIVE_CATALOGUE);
    for (const id of liveIds) expect(testIds.has(id)).toBe(false);
    expect(new Set([...testIds, ...liveIds]).size).toBe(12);
  });
});

// ── Prices, in both catalogues ───────────────────────────────────────────────

describe('prices resolve to 49/441 · 99/891 · 199/1791', () => {
  it.each([
    ['plus', 49, 441],
    ['pro', 99, 891],
    ['max', 199, 1791],
  ] as const)('%s is $%i monthly and $%i annually', (plan, monthly, annual) => {
    expect(monthlyPriceUsd(plan)).toBe(monthly);
    expect(annualPriceUsd(plan)).toBe(annual);
    expect(catalogueEntry(plan, 'monthly').priceUsd).toBe(monthly);
    expect(catalogueEntry(plan, 'yearly').priceUsd).toBe(annual);
  });

  it.each([
    ['plus', 49, 441],
    ['pro', 99, 891],
    ['max', 199, 1791],
  ] as const)('live prices resolve to $%i monthly and $%i annually for %s', (plan, monthly, annual) => {
    expect(DODO_LIVE_CATALOGUE[plan].monthly.priceUsd).toBe(monthly);
    expect(DODO_LIVE_CATALOGUE[plan].yearly.priceUsd).toBe(annual);
  });

  it.each(['plus', 'pro', 'max'] as const)(
    "%s's annual price is monthly × ANNUAL_BILLED_MONTHS",
    (plan) => {
      expect(annualPriceUsd(plan)).toBe(PLAN_PRICING[plan].monthlyUsd * ANNUAL_BILLED_MONTHS);
    },
  );

  it.each(['plus', 'pro', 'max'] as const)(
    "%s's Dodo annual price agrees with the price the app publishes",
    (plan) => {
      // The catalogue derives from monthlyUsd; PLAN_PRICING states yearlyUsd
      // separately. If those two ever disagree, the app advertises one number and
      // Dodo charges another.
      expect(annualPriceUsd(plan)).toBe(PLAN_PRICING[plan].yearlyUsd);
    },
  );

  it('tracks ANNUAL_BILLED_MONTHS if it changes, rather than pinning 9', () => {
    // Proves the relationship is live arithmetic and not coincidences: the
    // ratio holds by construction on every tier, in BOTH catalogues.
    for (const catalogue of [DODO_TEST_CATALOGUE, DODO_LIVE_CATALOGUE]) {
      for (const plan of ['plus', 'pro', 'max'] as const) {
        expect(catalogue[plan].yearly.priceUsd / catalogue[plan].monthly.priceUsd).toBe(
          ANNUAL_BILLED_MONTHS,
        );
      }
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

  it('derives from ANNUAL_BILLED_MONTHS in its code, not just in a comment', () => {
    expect(codeOnly).toContain('ANNUAL_BILLED_MONTHS');
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

  it('round-trips every entry of the active catalogue', () => {
    for (const [plan, periods] of Object.entries(DODO_TEST_CATALOGUE)) {
      for (const [period, entry] of Object.entries(periods)) {
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
