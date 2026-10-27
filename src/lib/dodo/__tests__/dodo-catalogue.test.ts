import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '@/__tests__/__fixtures__/the-346-strip-comments';

// catalogue.ts consumes the validated dodoConfig, so config.ts evaluates on
// import and the three required variables must exist first. Hoisted above the
// static imports below by vitest.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

import {
  DODO_LEGACY_LIVE_PRODUCTS,
  DODO_LEGACY_TEST_PRODUCTS,
  DODO_LIVE_CATALOGUE,
  DODO_TEST_CATALOGUE,
  DODO_TRIAL_DAYS,
  allCatalogueProductIds,
  allLegacyProductIds,
  DODO_PRODUCT_UNMAPPED,
  DODO_TERM_FREQUENCY,
  catalogueEntry,
  legacyTierForProductId,
  offerableTerms,
  productIdFor,
  requireProductId,
  resolvePlanFromProductId,
  termPriceUsd,
} from '../catalogue';
import { PLAN_PRICING, planPriceUsd } from '@/utils/plan-features';
import type { LegacyPlanId, PricedPlan } from '@/types/tenant.types';
import type { BillingPeriod } from '../provider';

/**
 * The Dodo catalogues for the two-plan price list: Church and Ministry, each on
 * a monthly and a yearly product.
 *
 * Four independent things are pinned here, because they fail differently.
 *
 *  1. VALUES. Each `(plan, period)` resolves to the right LIVE product id at the
 *     right price. A drifted product id is a SILENT failure: checkout succeeds,
 *     the church is charged, and the amount is wrong. The fixture below is typed
 *     out from the product ids the founder created in Dodo on 2026-10-27, not
 *     computed from this repo's constants, which is what makes it an independent
 *     check rather than a restatement of the code.
 *  2. THE TEST-MODE GAP. No test-mode Church or Ministry product exists yet, so
 *     every test-mode cell is `DODO_PRODUCT_UNMAPPED` and a test-mode checkout
 *     for either plan is REFUSED, never quietly pointed at a retired product.
 *  3. LEGACY RECOGNITION. The retired products (plus / pro / max) stay active in
 *     Dodo, so a subscription on one must still resolve to a plan (plus and pro
 *     to Church, max to Ministry) while none of them can ever be offered.
 *  4. SELECTION. The active catalogue follows the validated
 *     `dodoConfig.environment` and nothing else: no env read in catalogue.ts, no
 *     `??`, no third mode.
 */

type VerifiedProduct = { plan: PricedPlan; period: BillingPeriod; id: string; label: string; cents: number; interval: string };

/**
 * The four LIVE products, typed from the ids created in Dodo on 2026-10-27 (14-day
 * trial; the two Ministry products carry the same three add-ons the retired `max`
 * product did). `plan_key` in their Dodo metadata is `church` / `ministry` and
 * `billing_period` is `monthly` / `annual`; neither field is read by the app,
 * which resolves a subscription by `product_id` alone.
 *
 * 🔴 A live id transposed or mistyped in the catalogue is a real card charged at
 * the wrong price. These four lines are the independent record it is checked
 * against, character for character.
 */
const DODO_LIVE_PRODUCTS_AS_VERIFIED = [
  { plan: 'church', period: 'monthly', id: 'pdt_0NqdacJTREPtSJuqtPCjm', label: 'Church monthly', cents: 3000, interval: 'Month' },
  { plan: 'church', period: 'yearly', id: 'pdt_0NqdacQf9gvgmw6DU7449', label: 'Church annual', cents: 30000, interval: 'Year' },
  { plan: 'ministry', period: 'monthly', id: 'pdt_0NqdacWLx9z6CKsGRIKCW', label: 'Ministry monthly', cents: 9000, interval: 'Month' },
  { plan: 'ministry', period: 'yearly', id: 'pdt_0Nqdaca89LIHeUvrNxXwZ', label: 'Ministry annual', cents: 90000, interval: 'Year' },
] as const satisfies readonly VerifiedProduct[];

type LegacyFixture = { id: string; legacyTier: LegacyPlanId; plan: PricedPlan; period: BillingPeriod };

/**
 * The retired LIVE products (created 2026-08-13). They stay active in Dodo, so a
 * subscription may still be on one.
 */
const LEGACY_LIVE_PRODUCTS = [
  { id: 'pdt_0NlJZKKU2AQSSH7E4ziKA', legacyTier: 'plus', plan: 'church', period: 'monthly' },
  { id: 'pdt_0NlJZMLLKZ5SVGEoSGDdk', legacyTier: 'plus', plan: 'church', period: 'yearly' },
  { id: 'pdt_0NlJZMOMhmZWiG6UVDl8I', legacyTier: 'pro', plan: 'church', period: 'monthly' },
  { id: 'pdt_0NlJZMRWL8tuAZseUIRTP', legacyTier: 'pro', plan: 'church', period: 'yearly' },
  { id: 'pdt_0NlJZMUUiT36FGMoiFXgl', legacyTier: 'max', plan: 'ministry', period: 'monthly' },
  { id: 'pdt_0NlJZMXTnpRBAwTfBVpPs', legacyTier: 'max', plan: 'ministry', period: 'yearly' },
] as const satisfies readonly LegacyFixture[];

/** The retired TEST-mode products (created 2026-08-11). */
const LEGACY_TEST_PRODUCTS = [
  { id: 'pdt_0NlAMMZk44L0tL8lcLX6M', legacyTier: 'plus', plan: 'church', period: 'monthly' },
  { id: 'pdt_0NlAMMeWwZDSlfNdti8FD', legacyTier: 'plus', plan: 'church', period: 'yearly' },
  { id: 'pdt_0NlAMMhi90q5Ovk6QBzcf', legacyTier: 'pro', plan: 'church', period: 'monthly' },
  { id: 'pdt_0NlAMMlsVKeYG8ukapmzE', legacyTier: 'pro', plan: 'church', period: 'yearly' },
  { id: 'pdt_0NlAMMp4QndR3qPzlD8sG', legacyTier: 'max', plan: 'ministry', period: 'monthly' },
  { id: 'pdt_0NlAMMsQBzMvRVNCY7zws', legacyTier: 'max', plan: 'ministry', period: 'yearly' },
] as const satisfies readonly LegacyFixture[];

/**
 * 🔴 THE THREE QUARTERLY PRODUCTS, ARCHIVED IN DODO ON 2026-10-23. A BAN LIST and
 * not a fixture: no catalogue may name them in either mode, and a webhook
 * carrying one must resolve to nothing rather than to a plan.
 */
const DODO_ARCHIVED_QUARTERLY_IDS = [
  'pdt_0NloCamoWgvgYDih2UETS',
  'pdt_0NloCaqg1QPMAlkfDnlOe',
  'pdt_0NloCatUWEkEUq1usWJ0n',
] as const;

const PLANS: readonly PricedPlan[] = ['church', 'ministry'];

const catalogueIds = (catalogue: typeof DODO_TEST_CATALOGUE): string[] =>
  Object.values(catalogue).flatMap((periods) =>
    Object.values(periods)
      .map((entry) => entry.productId)
      .filter((id): id is string => id !== DODO_PRODUCT_UNMAPPED),
  );

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

// ── The test catalogue: nothing mapped, so nothing can be sold ───────────────

describe('the test catalogue maps no Church or Ministry product yet', () => {
  it('has the two plans and the two terms, every cell unmapped', () => {
    expect(Object.keys(DODO_TEST_CATALOGUE)).toEqual(['church', 'ministry']);
    for (const plan of PLANS) {
      expect(Object.keys(DODO_TEST_CATALOGUE[plan])).toEqual(['monthly', 'yearly']);
      for (const period of ['monthly', 'yearly'] as const) {
        expect(DODO_TEST_CATALOGUE[plan][period].productId).toBe(DODO_PRODUCT_UNMAPPED);
      }
    }
    expect(catalogueIds(DODO_TEST_CATALOGUE)).toEqual([]);
  });

  it('🔴 a test-mode checkout for either plan is REFUSED, and offers no term at all', () => {
    // Under this file's test_mode env the active catalogue IS the test
    // catalogue. `null` is "this build cannot sell that", and `requireProductId`
    // is what every checkout path calls: it throws, naming the gap, instead of
    // substituting another term or a retired product.
    for (const plan of PLANS) {
      expect(offerableTerms(plan)).toEqual([]);
      for (const period of ['monthly', 'yearly'] as const) {
        expect(productIdFor(plan, period)).toBeNull();
        expect(() => requireProductId(plan, period)).toThrow(new RegExp(`no ${period} product for plan "${plan}" in test_mode`));
      }
    }
    expect(allCatalogueProductIds()).toEqual([]);
  });

  it('carries the TODO that says what is missing, once per cell', () => {
    const source = readFileSync(resolve(__dirname, '../catalogue.ts'), 'utf8');
    const todo = 'TODO(dodo): create test-mode Church/Ministry products';
    expect(source.split(todo).length - 1).toBe(4);
  });

  it('still publishes the current table price for the cells it cannot sell', () => {
    for (const plan of PLANS) {
      for (const period of ['monthly', 'yearly'] as const) {
        expect(catalogueEntry(plan, period).priceUsd).toBe(planPriceUsd(plan, period));
      }
    }
  });

  it("labels annual entries with Dodo's own word for the period, not the app's", () => {
    expect(catalogueEntry('ministry', 'yearly').dodoBillingPeriod).toBe('annual');
    expect(catalogueEntry('ministry', 'monthly').dodoBillingPeriod).toBe('monthly');
  });

  it('carries the 14-day trial on every entry', () => {
    expect(DODO_TRIAL_DAYS).toBe(14);
    for (const plan of PLANS) {
      for (const period of ['monthly', 'yearly'] as const) {
        expect(catalogueEntry(plan, period).trialDays).toBe(14);
      }
    }
  });
});

// ── The live catalogue: the four verified live products ──────────────────────

describe('every live product id is pinned exactly as created in Dodo', () => {
  it.each(DODO_LIVE_PRODUCTS_AS_VERIFIED)(
    '$label ($plan/$period) maps to $id at $cents minor units',
    ({ plan, period, id, cents }) => {
      const entry = DODO_LIVE_CATALOGUE[plan][period];
      // 🔴 THE ID IS PINNED FOR ALL FOUR, unconditionally.
      expect(entry.productId).toBe(id);
      expect(entry.priceMinorUnits).toBe(cents);
      expect(entry.priceUsd).toBe(cents / 100);
      // Both sides of the pair the whole file exists for: what Dodo charges,
      // and what every app surface publishes.
      expect(planPriceUsd(plan, period)).toBe(cents / 100);
      expect(termPriceUsd(plan, period)).toBe(cents / 100);
    },
  );

  it.each(DODO_LIVE_PRODUCTS_AS_VERIFIED)(
    '$plan/$period publishes the independently transcribed Dodo amount',
    ({ plan, period, cents }) => {
      expect(PLAN_PRICING[plan][period]).toBe(cents / 100);
      expect(DODO_LIVE_CATALOGUE[plan][period].priceMinorUnits).toBe(cents);
    },
  );

  it.each(DODO_LIVE_PRODUCTS_AS_VERIFIED)(
    '$plan/$period retains the configured trial',
    ({ plan, period }) => {
      expect(DODO_LIVE_CATALOGUE[plan][period].trialDays).toBe(14);
    },
  );

  it('has exactly two plans and two terms, and no row for a retired tier', () => {
    expect(Object.keys(DODO_LIVE_CATALOGUE)).toEqual(['church', 'ministry']);
    for (const plan of PLANS) {
      expect(Object.keys(DODO_LIVE_CATALOGUE[plan])).toEqual(['monthly', 'yearly']);
    }
  });

  it('the trial is 14 days and annual is labelled the way Dodo labels it', () => {
    for (const { plan, period } of DODO_LIVE_PRODUCTS_AS_VERIFIED) {
      expect(DODO_LIVE_CATALOGUE[plan][period].trialDays).toBe(14);
    }
    expect(DODO_LIVE_CATALOGUE.ministry.yearly.dodoBillingPeriod).toBe('annual');
    expect(DODO_LIVE_CATALOGUE.church.monthly.dodoBillingPeriod).toBe('monthly');
  });

  it('🔴 names none of the archived quarterly products, and no retired product is OFFERED', () => {
    const offered = catalogueIds(DODO_LIVE_CATALOGUE);
    for (const id of DODO_ARCHIVED_QUARTERLY_IDS) {
      expect(offered, `the live catalogue names archived product ${id}`).not.toContain(id);
    }
    for (const { id } of [...LEGACY_LIVE_PRODUCTS, ...LEGACY_TEST_PRODUCTS]) {
      expect(offered, `the live catalogue OFFERS retired product ${id}`).not.toContain(id);
      expect(catalogueIds(DODO_TEST_CATALOGUE)).not.toContain(id);
    }
  });
});

describe('the catalogues are disjoint and complete', () => {
  it('the live catalogue names four distinct ids and the test catalogue none', () => {
    const ids = catalogueIds(DODO_LIVE_CATALOGUE);
    expect(ids.length).toBe(4);
    expect(new Set(ids).size).toBe(4);
    expect(catalogueIds(DODO_TEST_CATALOGUE).length).toBe(0);
  });

  it('offered, retired-live and retired-test ids never overlap', () => {
    const groups = [
      catalogueIds(DODO_LIVE_CATALOGUE),
      Object.keys(DODO_LEGACY_LIVE_PRODUCTS),
      Object.keys(DODO_LEGACY_TEST_PRODUCTS),
    ];
    const all = groups.flat();
    expect(all.length).toBe(4 + 6 + 6);
    expect(new Set(all).size).toBe(all.length);
  });
});

// ── Prices ───────────────────────────────────────────────────────────────────

describe('prices resolve to the four figures in the table', () => {
  it.each([
    ['church', 30, 300],
    ['ministry', 90, 900],
  ] as const)('%s is $%i monthly and $%i annually', (plan, monthly, annual) => {
    expect(termPriceUsd(plan, 'monthly')).toBe(monthly);
    expect(termPriceUsd(plan, 'yearly')).toBe(annual);
    expect(catalogueEntry(plan, 'monthly').priceUsd).toBe(monthly);
    expect(catalogueEntry(plan, 'yearly').priceUsd).toBe(annual);
    expect(PLAN_PRICING[plan]).toEqual({ monthly, yearly: annual });
    for (const [period, price] of [['monthly', monthly], ['yearly', annual]] as const) {
      expect(DODO_LIVE_CATALOGUE[plan][period].priceUsd).toBe(price);
      expect(DODO_LIVE_CATALOGUE[plan][period].priceMinorUnits).toBe(price * 100);
      expect(catalogueEntry(plan, period).priceMinorUnits).toBe(price * 100);
    }
  });

  it('a year is exactly ten months of the monthly price: "2 months free"', () => {
    for (const plan of PLANS) {
      expect(DODO_LIVE_CATALOGUE[plan].yearly.priceUsd).toBe(DODO_LIVE_CATALOGUE[plan].monthly.priceUsd * 10);
    }
  });

  it('cycles monthly products monthly and yearly products yearly, and nothing else', () => {
    expect(DODO_TERM_FREQUENCY).toEqual({
      monthly: { count: 1, interval: 'Month' },
      yearly: { count: 1, interval: 'Year' },
    });
    for (const { period, interval } of DODO_LIVE_PRODUCTS_AS_VERIFIED) {
      expect(interval).toBe(period === 'yearly' ? 'Year' : 'Month');
    }
  });
});

// ── The figures are READ from the table, not typed ───────────────────────────

describe('prices are read in source, not written as literals', () => {
  const cataloguePath = resolve(__dirname, '../catalogue.ts');

  /** Strip comments before scanning: only executable source is subject to the rule. */
  const codeOnly = stripComments(readFileSync(cataloguePath, 'utf8'));

  it.each([3000, 9000, 30000, 90000, 300, 900])(
    'does not contain %i as a literal anywhere in its code',
    (literal) => {
      // Bounded so a product id cannot trip it.
      const asLiteral = new RegExp(`(?<![\\w.])${literal}(?![\\w.])`);
      expect(
        asLiteral.test(codeOnly),
        `catalogue.ts writes ${literal} as a literal. Prices must be read from PLAN_PRICING: ` +
          'a typed-out figure is a second source of truth that drifts silently and bills the wrong amount.',
      ).toBe(false);
    },
  );

  it('reads the price table in its code, not just in a comment', () => {
    expect(codeOnly).toContain('planPriceUsd');
  });

  it('reads no environment variable and has no ?? fallback — #207 in one line', () => {
    expect(codeOnly).not.toContain('process.env');
    expect(codeOnly).not.toContain('??');
    expect(codeOnly).toContain('dodoConfig');
  });
});

// ── The reverse lookup the subscription webhook depends on ───────────────────

describe('resolvePlanFromProductId — product id back to a plan', () => {
  it.each(LEGACY_TEST_PRODUCTS)(
    'resolves retired test product $id ($legacyTier/$period) to $plan/$period in test mode',
    ({ id, legacyTier, plan, period }) => {
      expect(resolvePlanFromProductId(id)).toEqual({ plan, period });
      expect(legacyTierForProductId(id)).toBe(legacyTier);
    },
  );

  it('maps plus and pro to Church and max to Ministry, and never to a retired tier name', () => {
    for (const { id, legacyTier } of LEGACY_TEST_PRODUCTS) {
      const resolved = resolvePlanFromProductId(id);
      expect(resolved?.plan).toBe(legacyTier === 'max' ? 'ministry' : 'church');
    }
  });

  it('every retired product of the active mode is recognised and none is offered', () => {
    expect(new Set(allLegacyProductIds())).toEqual(new Set(LEGACY_TEST_PRODUCTS.map((p) => p.id)));
    expect(allCatalogueProductIds()).toEqual([]);
    expect(Object.keys(DODO_LEGACY_TEST_PRODUCTS).length).toBe(6);
    expect(Object.keys(DODO_LEGACY_LIVE_PRODUCTS).length).toBe(6);
  });

  it('returns null for a foreign id rather than defaulting to a plan', () => {
    // An add-on product, a Stripe price, a typo — and, just as foreign, a LIVE
    // product id while this build runs in test mode. Every one of them must be
    // "unknown", never "the cheapest plan".
    expect(resolvePlanFromProductId('pdt_not_ours')).toBeNull();
    expect(resolvePlanFromProductId('price_1TjKTb1YKkcSbTf3kxXDuq5X')).toBeNull();
    expect(resolvePlanFromProductId('')).toBeNull();
    expect(legacyTierForProductId('')).toBeNull();
    for (const { id } of [...DODO_LIVE_PRODUCTS_AS_VERIFIED, ...LEGACY_LIVE_PRODUCTS]) {
      expect(resolvePlanFromProductId(id)).toBeNull();
    }
  });

  it('🔴 resolves an archived quarterly product to nothing, in either mode', async () => {
    for (const id of DODO_ARCHIVED_QUARTERLY_IDS) {
      expect(resolvePlanFromProductId(id)).toBeNull();
    }
    const live = await withEnvironment('live_mode');
    for (const id of DODO_ARCHIVED_QUARTERLY_IDS) {
      expect(live.resolvePlanFromProductId(id), `${id} still resolves in live mode`).toBeNull();
    }
  });
});

// ── Selection: the active catalogue follows the validated environment ────────

describe('the active catalogue follows DODO_PAYMENTS_ENVIRONMENT', () => {
  it('selects the live catalogue under live_mode and resolves the new AND the retired products', async () => {
    const live = await withEnvironment('live_mode');
    for (const { plan, period, id } of DODO_LIVE_PRODUCTS_AS_VERIFIED) {
      expect(live.productIdFor(plan, period)).toBe(id);
      expect(live.requireProductId(plan, period)).toBe(id);
      expect(live.resolvePlanFromProductId(id)).toEqual({ plan, period });
      expect(live.legacyTierForProductId(id)).toBeNull();
    }
    expect(new Set(live.allCatalogueProductIds())).toEqual(
      new Set(DODO_LIVE_PRODUCTS_AS_VERIFIED.map((product) => product.id)),
    );
    expect(live.offerableTerms('church')).toEqual(['monthly', 'yearly']);
    expect(live.offerableTerms('ministry')).toEqual(['monthly', 'yearly']);

    // 🔴 A legacy subscription still resolves, to the tier it became…
    for (const { id, legacyTier, plan, period } of LEGACY_LIVE_PRODUCTS) {
      expect(live.resolvePlanFromProductId(id)).toEqual({ plan, period });
      expect(live.legacyTierForProductId(id)).toBe(legacyTier);
    }
    // …and can never be put in a cart.
    const offered = new Set(live.allCatalogueProductIds());
    for (const { id } of LEGACY_LIVE_PRODUCTS) expect(offered.has(id)).toBe(false);

    // Test-mode ids are FOREIGN under live mode, by decision.
    for (const { id } of LEGACY_TEST_PRODUCTS) {
      expect(live.resolvePlanFromProductId(id)).toBeNull();
    }
  });

  it('selects the test catalogue under test_mode: nothing offered, retired products recognised', async () => {
    const test = await withEnvironment('test_mode');
    for (const plan of PLANS) {
      expect(test.offerableTerms(plan)).toEqual([]);
      expect(() => test.requireProductId(plan, 'monthly')).toThrow();
    }
    for (const { id, plan, period } of LEGACY_TEST_PRODUCTS) {
      expect(test.resolvePlanFromProductId(id)).toEqual({ plan, period });
    }
  });
});
