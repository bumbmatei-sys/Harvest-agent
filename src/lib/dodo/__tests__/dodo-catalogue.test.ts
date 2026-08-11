import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
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
 * The Dodo catalogue: six products, and the prices they charge.
 *
 * Two independent things are pinned here, because they fail differently.
 *
 *  1. VALUES. Each `(plan, period)` resolves to the right product id at the right
 *     price. A drifted product id is a SILENT failure — checkout succeeds, the
 *     church is charged, and the amount is wrong. Nothing about that is visible
 *     in a log.
 *  2. DERIVATION. The annual figures are computed from ANNUAL_BILLED_MONTHS
 *     rather than typed. A literal that happens to be correct today passes every
 *     value assertion and drifts the moment the constant changes, so the source
 *     itself is scanned.
 *
 * The prices in FIXTURES below were read back from the LIVE Dodo test-mode API on
 * 2026-08-11 (`products.retrieve` on each of the six ids). They are transcribed
 * from Dodo's response, NOT computed from this repo's constants, which is what
 * makes them an independent check rather than a restatement of the code.
 */

/** What Dodo actually has on these products. Transcribed from the API response. */
const DODO_PRODUCTS_AS_VERIFIED = [
  { plan: 'plus', period: 'monthly', id: 'pdt_0NlAMMZk44L0tL8lcLX6M', name: 'Harvest Individual - Monthly', cents: 4900, interval: 'Month' },
  { plan: 'plus', period: 'yearly', id: 'pdt_0NlAMMeWwZDSlfNdti8FD', name: 'Harvest Individual - Annual', cents: 44100, interval: 'Year' },
  { plan: 'pro', period: 'monthly', id: 'pdt_0NlAMMhi90q5Ovk6QBzcf', name: 'Harvest Small Team - Monthly', cents: 9900, interval: 'Month' },
  { plan: 'pro', period: 'yearly', id: 'pdt_0NlAMMlsVKeYG8ukapmzE', name: 'Harvest Small Team - Annual', cents: 89100, interval: 'Year' },
  { plan: 'max', period: 'monthly', id: 'pdt_0NlAMMp4QndR3qPzlD8sG', name: 'Harvest Ministry - Monthly', cents: 19900, interval: 'Month' },
  { plan: 'max', period: 'yearly', id: 'pdt_0NlAMMsQBzMvRVNCY7zws', name: 'Harvest Ministry - Annual', cents: 179100, interval: 'Year' },
] as const satisfies readonly { plan: TenantPlan; period: BillingPeriod; id: string; name: string; cents: number; interval: string }[];

// ── Test 1 + 10: the six products, at the right prices ───────────────────────

describe('the Dodo catalogue holds exactly the six verified products', () => {
  it('has six entries — three plans × monthly/annual, and no more', () => {
    const ids = allCatalogueProductIds();
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6); // no id reused across two plans
  });

  it.each(DODO_PRODUCTS_AS_VERIFIED)(
    '$name ($plan/$period) maps to $id at $cents minor units',
    ({ plan, period, id, cents }) => {
      expect(productIdFor(plan, period)).toBe(id);
      expect(catalogueEntry(plan, period).priceMinorUnits).toBe(cents);
      expect(catalogueEntry(plan, period).priceUsd).toBe(cents / 100);
    },
  );

  it('carries the 14-day trial Dodo has configured on every product', () => {
    expect(DODO_TRIAL_DAYS).toBe(14);
    for (const { plan, period } of DODO_PRODUCTS_AS_VERIFIED) {
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
    // Proves the relationship is live arithmetic and not three coincidences: the
    // ratio holds by construction on every tier.
    for (const plan of ['plus', 'pro', 'max'] as const) {
      expect(annualPriceUsd(plan) / monthlyPriceUsd(plan)).toBe(ANNUAL_BILLED_MONTHS);
    }
  });
});

// ── Test 10: the annual figures are DERIVED, not typed ───────────────────────

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
    // catalogue exists to avoid repeating. There is no env read here at all.
    expect(codeOnly).not.toContain('process.env');
    expect(codeOnly).not.toContain('??');
  });
});

// ── The reverse lookup the subscription webhook depends on ───────────────────

describe('resolvePlanFromProductId — product id back to a plan', () => {
  it.each(DODO_PRODUCTS_AS_VERIFIED)('resolves $id to $plan/$period', ({ plan, period, id }) => {
    expect(resolvePlanFromProductId(id)).toEqual({ plan, period });
  });

  it('round-trips every entry in the catalogue', () => {
    for (const [plan, periods] of Object.entries(DODO_TEST_CATALOGUE)) {
      for (const [period, entry] of Object.entries(periods)) {
        expect(resolvePlanFromProductId(entry.productId)).toEqual({ plan, period });
      }
    }
  });

  it('returns null for anything not ours rather than defaulting to a plan', () => {
    // An add-on product (REP-5), a live-mode id, a Stripe price, a typo. Every
    // one of them must be "unknown", never "the cheapest plan" — defaulting here
    // would silently grant a tier nobody paid for.
    expect(resolvePlanFromProductId('pdt_not_ours')).toBeNull();
    expect(resolvePlanFromProductId('price_1TjKTb1YKkcSbTf3kxXDuq5X')).toBeNull();
    expect(resolvePlanFromProductId('')).toBeNull();
  });
});
