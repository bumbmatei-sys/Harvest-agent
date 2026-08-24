import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The Dodo config module refuses to load without its three variables — by
// design, so a build cannot silently bill the wrong catalogue. Hoisted above
// the static imports by vitest. `live_mode` is what DODO_LIVE_CATALOGUE's ids
// and prices are asserted against below.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'live_mode';
});

import {
  ADVERTISED_DISCOUNT_PCT,
  BILLING_TERMS,
  DISCOUNTED_TERMS,
  PLAN_ORDER,
  PLAN_PRICING,
  PRICED_PLAN_ORDER,
  TERM_MONTHS,
  actualSavingPct,
  discountClaim,
  discountClaimShape,
  getPlanFeatures,
  planPriceUsd,
} from '../plan-features';
import { DODO_LIVE_CATALOGUE } from '@/lib/dodo/catalogue';
import type { BillingTerm } from '../plan-features';
import type { PricedPlan } from '@/types/tenant.types';

/* ─────────────────────────────────────────────────────────────────────────────
 * THE-222 — $20 / $40 / $80, and the yearly claim goes flat.
 *
 * The nine prices verified against the authenticated live Dodo API on
 * 2026-08-24 (2000 / 4900 / 16500 minor units on Individual, and so on). Ids,
 * 14-day trials, the `saas` tax category and add-on attachment were all
 * confirmed unchanged in the same read — only the amounts moved.
 *
 * 🔴 THE REPRICE SHIFTS THE TABLE DOWN A TIER, and that is the whole hazard.
 * Small Team's new quarterly and yearly ($99 / $329) are the pair Individual
 * used to carry, and Ministry's new pair ($199 / $659) is Small Team's old one.
 * Five figures therefore changed MEANING rather than retiring, so every
 * assertion below names a tier AND a term; not one of them is a bare digit.
 * ───────────────────────────────────────────────────────────────────────────*/

/** The nine, written out independently of the table under test. */
const NEW_TABLE: Record<PricedPlan, Record<BillingTerm, number>> = {
  plus: { monthly: 20, quarterly: 49, yearly: 165 },
  pro: { monthly: 40, quarterly: 99, yearly: 329 },
  max: { monthly: 80, quarterly: 199, yearly: 659 },
};

/** The table THE-222 replaced. Kept for the derivation proof in test 4 — it is
 *  the only way to show the claim rule answers differently for two tables. */
const OLD_TABLE: Record<PricedPlan, Record<BillingTerm, number>> = {
  plus: { monthly: 39, quarterly: 99, yearly: 329 },
  pro: { monthly: 79, quarterly: 199, yearly: 659 },
  max: { monthly: 159, quarterly: 399, yearly: 1329 },
};

/* ── 1 ─────────────────────────────────────────────────────────────────────── */
describe('the nine plan prices match the new table exactly', () => {
  it.each(
    (Object.keys(NEW_TABLE) as PricedPlan[]).flatMap((plan) =>
      BILLING_TERMS.map((term) => [plan, term] as const),
    ),
  )('%s on %s', (plan, term) => {
    expect(planPriceUsd(plan, term)).toBe(NEW_TABLE[plan][term]);
    expect(PLAN_PRICING[plan][term]).toBe(NEW_TABLE[plan][term]);
  });

  it('and the Dodo catalogue quotes the same nine, per tier and per term', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        expect(DODO_LIVE_CATALOGUE[plan][term].priceUsd, `${plan}/${term}`)
          .toBe(NEW_TABLE[plan][term]);
        expect(DODO_LIVE_CATALOGUE[plan][term].priceMinorUnits, `${plan}/${term} minor units`)
          .toBe(NEW_TABLE[plan][term] * 100);
      }
    }
  });

  it('🔴 did not merely shift the old rows down a tier', () => {
    // The five figures that survived did so attached to a DIFFERENT tier. If a
    // reprice had copied rows instead of repricing them, Individual would still
    // hold $99/$329 and every one of these would still pass on the old table —
    // so the monthly column, which nothing inherited, is asserted too.
    expect(planPriceUsd('pro', 'quarterly')).toBe(OLD_TABLE.plus.quarterly);
    expect(planPriceUsd('pro', 'yearly')).toBe(OLD_TABLE.plus.yearly);
    expect(planPriceUsd('max', 'quarterly')).toBe(OLD_TABLE.pro.quarterly);
    expect(planPriceUsd('max', 'yearly')).toBe(OLD_TABLE.pro.yearly);
    // …and no tier kept its own old row.
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        expect(planPriceUsd(plan, term), `${plan} ${term} never moved`)
          .not.toBe(OLD_TABLE[plan][term]);
      }
    }
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────── */
describe('yearly claims a flat 30% and quarterly a flat 15%', () => {
  it('both terms are flat, and yearly no longer hedges', () => {
    expect(discountClaimShape('quarterly')).toBe('flat');
    expect(discountClaimShape('yearly')).toBe('flat');
    expect(discountClaim('quarterly')).toBe('Save 15%');
    expect(discountClaim('yearly')).toBe('Save 30%');
    for (const term of DISCOUNTED_TERMS) {
      expect(discountClaim(term), `${term} still hedges`).not.toContain('up to');
    }
  });

  it('the advertised percentages themselves are unchanged at 15 and 30', () => {
    // THE-222 moves the PRICES, never the badge. The wording changed because
    // the prices cleared the badge, not because the badge was lowered to fit.
    expect(ADVERTISED_DISCOUNT_PCT).toEqual({ quarterly: 15, yearly: 30 });
  });
});

/* ── 4 ── 🔴 THE GUARD ─────────────────────────────────────────────────────── */
describe('the claim shape is derived from the price table, not hardcoded', () => {
  /** The shipped rule, restated over an arbitrary table. */
  const shapeOf = (table: Record<PricedPlan, Record<BillingTerm, number>>, term: 'quarterly' | 'yearly') => {
    const saving = (plan: PricedPlan) =>
      (1 - table[plan][term] / (table[plan].monthly * TERM_MONTHS[term])) * 100;
    const worst = Math.min(...(Object.keys(table) as PricedPlan[]).map(saving));
    return ADVERTISED_DISCOUNT_PCT[term] <= worst ? 'flat' : 'upTo';
  };

  it('🔴 the SAME rule answers differently for the old table and the new one', () => {
    // This is the proof that the shape is computed rather than stated. A
    // hardcoded 'flat' would be right for the new table by luck; only a rule
    // that is sensitive to prices returns 'upTo' for the table THE-222
    // replaced, where Individual's year saved 29.70% against an advertised 30%.
    expect(shapeOf(OLD_TABLE, 'yearly')).toBe('upTo');
    expect(shapeOf(NEW_TABLE, 'yearly')).toBe('flat');
    // Quarterly was flat under both, so it cannot carry this proof on its own.
    expect(shapeOf(OLD_TABLE, 'quarterly')).toBe('flat');
    expect(shapeOf(NEW_TABLE, 'quarterly')).toBe('flat');
  });

  it('and the shipped function agrees with that rule on the live table', () => {
    for (const term of DISCOUNTED_TERMS) {
      expect(discountClaimShape(term), `${term}`).toBe(shapeOf(NEW_TABLE, term));
    }
  });

  it('the source computes the shape and states neither answer per term', () => {
    const src = readFileSync(resolve(__dirname, '../plan-features.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    const body = src.slice(src.indexOf('export function discountClaimShape'));
    const fn = body.slice(0, body.indexOf('\n}') + 2);
    // It reads the prices…
    expect(fn).toContain('actualSavingPct');
    expect(fn).toContain('Math.min');
    expect(fn).toContain('ADVERTISED_DISCOUNT_PCT[term]');
    // …and does not decide by term.
    expect(fn).not.toMatch(/'yearly'|"yearly"/);
    expect(fn).not.toMatch(/'quarterly'|"quarterly"/);
  });
});

/* ── 5 ─────────────────────────────────────────────────────────────────────── */
describe('no copy claims a saving larger than the smallest actual saving', () => {
  it('every flat claim is true of the WORST tier, not just the best', () => {
    for (const term of DISCOUNTED_TERMS) {
      const worst = Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, term)));
      expect(discountClaimShape(term)).toBe('flat');
      expect(ADVERTISED_DISCOUNT_PCT[term], `flat "${discountClaim(term)}" overstates ${term}`)
        .toBeLessThanOrEqual(worst);
    }
  });

  it('the smallest actual savings are 17.08% quarterly and 31.25% yearly', () => {
    // Named, with the tier each belongs to — the margin the flat claim rests on
    // is the worst tier's, and quarterly's worst is Ministry while yearly's is
    // Individual. They are not the same tier, which is why both are pinned.
    expect(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'quarterly'))))
      .toBeCloseTo(17.0833, 3);
    expect(actualSavingPct('max', 'quarterly')).toBeCloseTo(17.0833, 3);
    expect(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'yearly'))))
      .toBeCloseTo(31.25, 3);
    expect(actualSavingPct('plus', 'yearly')).toBeCloseTo(31.25, 3);
  });

  it('the per-tier savings, to one decimal', () => {
    expect(PRICED_PLAN_ORDER.map((p) => Number(actualSavingPct(p, 'quarterly').toFixed(1))))
      .toEqual([18.3, 17.5, 17.1]);
    expect(PRICED_PLAN_ORDER.map((p) => Number(actualSavingPct(p, 'yearly').toFixed(1))))
      .toEqual([31.3, 31.5, 31.4]);
  });
});

/* ── 7 ─────────────────────────────────────────────────────────────────────── */
describe('free is still absent from PLAN_PRICING', () => {
  it('is a real tier with no price row', () => {
    expect(PLAN_ORDER).toContain('free');
    expect(Object.keys(PLAN_PRICING)).not.toContain('free');
    expect(Object.keys(PLAN_PRICING).sort()).toEqual(['max', 'plus', 'pro']);
    expect(PRICED_PLAN_ORDER).not.toContain('free' as unknown as PricedPlan);
  });
});

/* ── 8 ─────────────────────────────────────────────────────────────────────── */
describe("no term's price is a whole number of months at the monthly rate", () => {
  it.each(
    PRICED_PLAN_ORDER.flatMap((plan) => DISCOUNTED_TERMS.map((term) => [plan, term] as const)),
  )('%s %s is not an integer multiple of its monthly price', (plan, term) => {
    const inMonths = planPriceUsd(plan, term) / planPriceUsd(plan, 'monthly');
    expect(Number.isInteger(inMonths), `${plan} ${term} is exactly ${inMonths} months`).toBe(false);
  });

  it('the arithmetic in full, for all six discounted cells', () => {
    // Written out so the numbers are readable in review rather than inferred:
    // 49/20, 165/20, 99/40, 329/40, 199/80, 659/80.
    expect(planPriceUsd('plus', 'quarterly') / planPriceUsd('plus', 'monthly')).toBe(2.45);
    expect(planPriceUsd('plus', 'yearly') / planPriceUsd('plus', 'monthly')).toBe(8.25);
    expect(planPriceUsd('pro', 'quarterly') / planPriceUsd('pro', 'monthly')).toBe(2.475);
    expect(planPriceUsd('pro', 'yearly') / planPriceUsd('pro', 'monthly')).toBe(8.225);
    expect(planPriceUsd('max', 'quarterly') / planPriceUsd('max', 'monthly')).toBe(2.4875);
    expect(planPriceUsd('max', 'yearly') / planPriceUsd('max', 'monthly')).toBe(8.2375);
  });
});

/* ── 11 ────────────────────────────────────────────────────────────────────── */
describe('the plan feature matrix and the Dodo product ids are unchanged', () => {
  it('every tier still entitles exactly what it did — prices changed, access did not', () => {
    // A sample of load-bearing cells across all four tiers, named individually.
    // Entitlements are what a reprice must never touch.
    expect(getPlanFeatures('free').fundraising).toBe(false);
    expect(getPlanFeatures('free').newsFeed).toBe(false);
    expect(getPlanFeatures('free').maxContacts).toBe(500);
    expect(getPlanFeatures('plus').maxContacts).toBe(150);
    expect(getPlanFeatures('plus').maxAdmins).toBe(2);
    expect(getPlanFeatures('plus').fundraising).toBe(true);
    expect(getPlanFeatures('pro').maxContacts).toBe(500);
    expect(getPlanFeatures('pro').checkInSystem).toBe(true);
    expect(getPlanFeatures('max').communityGroups).toBe(true);
    expect(getPlanFeatures('max').customBranding).toBe(true);
  });

  it('the nine live product ids are exactly as verified', () => {
    const IDS: Record<PricedPlan, Record<BillingTerm, string>> = {
      plus: {
        monthly: 'pdt_0NlJZKKU2AQSSH7E4ziKA',
        quarterly: 'pdt_0NloCamoWgvgYDih2UETS',
        yearly: 'pdt_0NlJZMLLKZ5SVGEoSGDdk',
      },
      pro: {
        monthly: 'pdt_0NlJZMOMhmZWiG6UVDl8I',
        quarterly: 'pdt_0NloCaqg1QPMAlkfDnlOe',
        yearly: 'pdt_0NlJZMRWL8tuAZseUIRTP',
      },
      max: {
        monthly: 'pdt_0NlJZMUUiT36FGMoiFXgl',
        quarterly: 'pdt_0NloCatUWEkEUq1usWJ0n',
        yearly: 'pdt_0NlJZMXTnpRBAwTfBVpPs',
      },
    };
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        expect(DODO_LIVE_CATALOGUE[plan][term].productId, `${plan}/${term}`)
          .toBe(IDS[plan][term]);
      }
    }
  });
});
