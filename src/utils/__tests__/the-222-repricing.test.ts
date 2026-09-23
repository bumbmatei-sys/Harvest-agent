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
 *
 * ⚠️ THE-248 SUPERSEDED THE PRICE HALF OF THIS TICKET. The monthly column is
 * still THE-222's; the six discounted cells were RAISED to align the discounts
 * on a flat 10% and 20%. So this file carries three tables — before THE-222,
 * what THE-222 shipped, and what is live — and every assertion says which. The
 * historical proofs are kept against THE-222's own table and its own advertised
 * percentages, because a historical proof that silently re-points at today's
 * constants stops proving anything. The live nine are pinned in
 * the-248-discount-alignment.test.ts.
 * ───────────────────────────────────────────────────────────────────────────*/

/** What THE-222 itself shipped. HISTORY — do not reprice. */
const THE_222_TABLE: Record<PricedPlan, Record<BillingTerm, number>> = {
  plus: { monthly: 20, quarterly: 49, yearly: 165 },
  pro: { monthly: 40, quarterly: 99, yearly: 329 },
  max: { monthly: 80, quarterly: 199, yearly: 659 },
};

/** What this repo PUBLISHES, written out independently of the table under test.
 *
 *  ⚠️ WAS "what is live", then briefly was not. THE-248's nine were verified
 *  against the authenticated live Dodo API on 2026-08-27 and the two agreed.
 *  THE-343 separated them by repricing Ministry HERE ahead of Dodo, and
 *  THE-344 brought them back together by repricing the three live products and
 *  reading them back. The two readings are the same sentence again; what Dodo
 *  charges is pinned per product id in `dodo-catalogue.test.ts`, which owns it. */
const NEW_TABLE: Record<PricedPlan, Record<BillingTerm, number>> = {
  plus: { monthly: 20, quarterly: 54, yearly: 190 },
  pro: { monthly: 40, quarterly: 108, yearly: 380 },
  max: { monthly: 80, quarterly: 216, yearly: 752 },
};

/** What THE-222 advertised. Stated here rather than read from the live constant
 *  so the derivation proof below keeps testing the RULE now the percentages
 *  have moved — which is exactly what THE-248 did to them. */
const THE_222_ADVERTISED = { quarterly: 15, yearly: 30 } as const;

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
    // THE-222's own hazard, pinned against THE-222's table: five figures
    // survived that reprice attached to a DIFFERENT tier. If it had copied rows
    // instead of repricing them, Individual would still have held $99/$329.
    expect(THE_222_TABLE.pro.quarterly).toBe(OLD_TABLE.plus.quarterly);
    expect(THE_222_TABLE.pro.yearly).toBe(OLD_TABLE.plus.yearly);
    expect(THE_222_TABLE.max.quarterly).toBe(OLD_TABLE.pro.quarterly);
    expect(THE_222_TABLE.max.yearly).toBe(OLD_TABLE.pro.yearly);
    // …and no tier kept its own old row, on either reprice.
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        expect(planPriceUsd(plan, term), `${plan} ${term} never moved`)
          .not.toBe(OLD_TABLE[plan][term]);
      }
    }
    // 🔴 THE-248 INHERITED NOTHING AT ALL. Its six new figures appear on no
    // tier and no term of either earlier table, so — unlike THE-222 — no live
    // discounted price can be confused with a figure some other tier used to
    // carry. The monthly column is deliberately excluded: it did not move.
    const historic = new Set(
      [OLD_TABLE, THE_222_TABLE].flatMap((t) =>
        PRICED_PLAN_ORDER.flatMap((plan) => BILLING_TERMS.map((term) => t[plan][term])),
      ),
    );
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of DISCOUNTED_TERMS) {
        const price = planPriceUsd(plan, term);
        expect(historic.has(price), `${plan} ${term} ($${price}) is an inherited figure`).toBe(false);
      }
    }
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────── */
describe('quarterly claims a flat 10% and yearly a flat 20%', () => {
  it('both terms are flat, and neither hedges', () => {
    expect(discountClaimShape('quarterly')).toBe('flat');
    expect(discountClaimShape('yearly')).toBe('flat');
    expect(discountClaim('quarterly')).toBe('Save 10%');
    expect(discountClaim('yearly')).toBe('Save 20%');
    for (const term of DISCOUNTED_TERMS) {
      expect(discountClaim(term), `${term} still hedges`).not.toContain('up to');
    }
  });

  it('the advertised percentages are 10 and 20, and BOTH moved with the prices', () => {
    // ⚠️ THE OPPOSITE OF THE-222, WHICH MOVED PRICES AND NOT THE BADGE.
    // THE-248 moves both, deliberately: the founder chose the percentages
    // first — 10 on a quarter, 20 on a year — and the prices were set to
    // deliver them. That is why every tier lands on the same saving.
    expect(ADVERTISED_DISCOUNT_PCT).toEqual({ quarterly: 10, yearly: 20 });
  });
});

/* ── 4 ── 🔴 THE GUARD ─────────────────────────────────────────────────────── */
describe('the claim shape is derived from the price table, not hardcoded', () => {
  /** The shipped rule, restated over an arbitrary table. */
  const shapeOf = (
    table: Record<PricedPlan, Record<BillingTerm, number>>,
    term: 'quarterly' | 'yearly',
    advertised: number,
  ) => {
    const saving = (plan: PricedPlan) => {
      const atMonthlyRate = table[plan].monthly * TERM_MONTHS[term];
      return ((atMonthlyRate - table[plan][term]) * 100) / atMonthlyRate;
    };
    const worst = Math.min(...(Object.keys(table) as PricedPlan[]).map(saving));
    return advertised <= worst ? 'flat' : 'upTo';
  };

  it('🔴 the SAME rule answers differently for the old table and the new one', () => {
    // This is the proof that the shape is computed rather than stated. A
    // hardcoded 'flat' would be right for the live table by luck; only a rule
    // that is sensitive to prices returns 'upTo' for the table THE-222
    // replaced, where Individual's year saved 29.70% against an advertised 30%.
    //
    // ⚠️ THE PERCENTAGE IS PASSED IN, and THE-248 is why. This read the live
    // ADVERTISED_DISCOUNT_PCT, so when the advertised yearly figure dropped
    // from 30 to 20 the "old" table started clearing it and the proof inverted
    // — a historical comparison quietly re-pointed at a constant that had moved
    // under it. Each table is judged against the percentage IT shipped with.
    expect(shapeOf(OLD_TABLE, 'yearly', THE_222_ADVERTISED.yearly)).toBe('upTo');
    expect(shapeOf(THE_222_TABLE, 'yearly', THE_222_ADVERTISED.yearly)).toBe('flat');
    // Quarterly was flat under both, so it cannot carry this proof on its own.
    expect(shapeOf(OLD_TABLE, 'quarterly', THE_222_ADVERTISED.quarterly)).toBe('flat');
    expect(shapeOf(THE_222_TABLE, 'quarterly', THE_222_ADVERTISED.quarterly)).toBe('flat');
    // 🔴 AND IT STILL SAYS 'upTo' WHEN IT SHOULD, on the LIVE table. One point
    // over the live quarterly saving — which is exactly 10 — is the smallest
    // claim that must hedge, and it proves the rule is not pinned to 'flat'.
    expect(shapeOf(NEW_TABLE, 'quarterly', ADVERTISED_DISCOUNT_PCT.quarterly)).toBe('flat');
    expect(shapeOf(NEW_TABLE, 'quarterly', 11)).toBe('upTo');
    expect(shapeOf(NEW_TABLE, 'yearly', ADVERTISED_DISCOUNT_PCT.yearly)).toBe('flat');
    expect(shapeOf(NEW_TABLE, 'yearly', 21)).toBe('upTo');
  });

  it('and the shipped function agrees with that rule on the live table', () => {
    for (const term of DISCOUNTED_TERMS) {
      expect(discountClaimShape(term), `${term}`)
        .toBe(shapeOf(NEW_TABLE, term, ADVERTISED_DISCOUNT_PCT[term]));
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

  it('the smallest actual savings are exactly 10% quarterly and 20.83% yearly', () => {
    // 🔴 THE QUARTERLY COLUMN HAS NO "WORST" TIER; THE YEARLY COLUMN HAS ONE
    // AGAIN. THE-222's worst quarterly tier was Ministry and its worst yearly
    // tier was Individual — different tiers, which is why both were pinned.
    // THE-248 flattened both columns. THE-343 repriced Ministry alone, which
    // leaves quarterly flat and puts Ministry AHEAD on the year (21.67 against
    // 20.83), so the yearly minimum is once more a claim about the other two.
    // Every tier is still pinned individually: a min/max pair alone would pass
    // even if one tier had drifted.
    for (const plan of PRICED_PLAN_ORDER) {
      expect(actualSavingPct(plan, 'quarterly'), `${plan} quarterly`).toBe(10);
      expect(actualSavingPct(plan, 'yearly'), `${plan} yearly`)
        .toBeCloseTo(plan === 'max' ? 21.6667 : 20.8333, 3);
    }
    expect(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'quarterly')))).toBe(10);
    expect(Math.max(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'quarterly')))).toBe(10);
    // 🔴 THE MINIMUM IS WHAT THE ADVERTISED 20% RESTS ON, and Ministry saving
    // more may not raise it — so it is still 20.83, not 21.67.
    expect(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'yearly'))))
      .toBeCloseTo(20.8333, 3);
  });

  it('the per-tier savings, to one decimal', () => {
    expect(PRICED_PLAN_ORDER.map((p) => Number(actualSavingPct(p, 'quarterly').toFixed(1))))
      .toEqual([10.0, 10.0, 10.0]);
    expect(PRICED_PLAN_ORDER.map((p) => Number(actualSavingPct(p, 'yearly').toFixed(1))))
      .toEqual([20.8, 20.8, 21.7]);
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
    // 54/20, 190/20, 108/40, 380/40, 162/60, 564/60.
    //
    // 🔴 THE QUARTERLY MULTIPLE IS THE SAME ON EVERY TIER — 2.7 months —
    // because that discount is flat at 10%. The yearly multiple is 9.5 on
    // Individual and Small Team and 9.4 on Ministry since THE-343. All three
    // are within a half-month of an integer, which is a much closer call than
    // the six distinct multiples THE-222 produced: a reprice that rounded a
    // year to $200 (×10) or a quarter to $60 (×3) would resurrect the
    // multiplier abstraction this guard exists to keep buried.
    expect(planPriceUsd('plus', 'quarterly') / planPriceUsd('plus', 'monthly')).toBe(2.7);
    expect(planPriceUsd('plus', 'yearly') / planPriceUsd('plus', 'monthly')).toBe(9.5);
    expect(planPriceUsd('pro', 'quarterly') / planPriceUsd('pro', 'monthly')).toBe(2.7);
    expect(planPriceUsd('pro', 'yearly') / planPriceUsd('pro', 'monthly')).toBe(9.5);
    expect(planPriceUsd('max', 'quarterly') / planPriceUsd('max', 'monthly')).toBe(2.7);
    expect(planPriceUsd('max', 'yearly') / planPriceUsd('max', 'monthly')).toBe(9.4);
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
    // ⚠️ THE CONTACT CAPS MOVED IN THE-370, WHICH IS A CAP CHANGE AND NOT A
    // REPRICE. THE-222's claim — "prices changed, access did not" — is about
    // THE-222 and is unaffected; these three are transcribed to their current
    // values so this row keeps guarding every OTHER cell named here.
    expect(getPlanFeatures('plus').maxContacts).toBe(500);
    expect(getPlanFeatures('plus').maxAdmins).toBe(2);
    expect(getPlanFeatures('plus').fundraising).toBe(true);
    expect(getPlanFeatures('pro').maxContacts).toBe(2_000);
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
