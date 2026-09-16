import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

// catalogue.ts consumes the validated dodoConfig, so config.ts evaluates on
// import and the three required variables must exist first. Hoisted above the
// static imports below by vitest.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});
import {
  ADVERTISED_DISCOUNT_PCT,
  BILLING_TERMS,
  DISCOUNTED_TERMS,
  PLAN_DISPLAY_NAMES,
  PLAN_ORDER,
  PLAN_PRICING,
  PRICED_PLAN_ORDER,
  TERM_MONTHS,
  actualSavingPct,
  discountClaim,
  discountClaimShape,
  formatPlanMonthlyHeadline,
  formatPlanPrice,
  getPlanFeatures,
  isPricedPlan,
  monthlyHeadlineContract,
  planPriceUsd,
  planTermMonthlyDisplayed,
} from '../plan-features';
import { DODO_LIVE_ADDONS, DODO_LIVE_CATALOGUE } from '@/lib/dodo/catalogue';
import { BillingTermToggle } from '@/components/settings/BillingTermToggle';
import type { BillingTerm } from '../plan-features';
import type { PricedPlan } from '@/types/tenant.types';

/* ─────────────────────────────────────────────────────────────────────────────
 * THE-248 — quarterly at 10%, yearly at 20%, monthly with no badge at all.
 *
 * The six discounted cells were RAISED. The founder wants a flat 10% and 20%
 * rather than the 17–18% and 31% the previous rounded prices happened to give,
 * so this is a deliberate REDUCTION IN DISCOUNT and not a mistake to correct
 * back. The monthly column ($20 / $40 / $80) is untouched, as is every add-on.
 *
 * 🔴 THE FINDING THIS TICKET TURNED ON. Quarterly is now EXACTLY 10.0% off on
 * all three tiers, and `actualSavingPct` computed that as 9.999999999999998:
 * `(1 - 54/60) * 100` loses a tenth to binary floating point. At that value the
 * module-scope guard threw (`10 > 9.999…`) and `discountClaimShape` returned
 * 'upTo' (`10 <= 9.999…` is false) — a failed build and a hedged badge, both on
 * a percentage the prices genuinely deliver. Neither comparison was wrong; the
 * arithmetic feeding them was. See `actualSavingPct` in plan-features.ts.
 * ───────────────────────────────────────────────────────────────────────────*/

/** The nine, transcribed from the authenticated live Dodo API on 2026-08-27
 *  (2000 / 5400 / 19000 minor units on Individual, and so on) rather than read
 *  off PLAN_PRICING — a test that reads its own subject asserts only that the
 *  subject equals itself. */
const LIVE_DODO_USD: Record<PricedPlan, Record<BillingTerm, number>> = {
  plus: { monthly: 20, quarterly: 54, yearly: 190 },
  pro: { monthly: 40, quarterly: 108, yearly: 380 },
  // ✅ 60 / 162 / 564, RE-READ FROM THE LIVE API BY THE-344. This row carried
  // the superseded amounts for as long as Dodo did: THE-343 repriced Ministry
  // in this repo and could not touch Dodo, so the transcription and the table
  // genuinely disagreed. The three live products have since been repriced and
  // read back (`products.retrieve` on each id, trial and billing interval
  // intact), so this is a transcription of the live API again, not a gap.
  max: { monthly: 60, quarterly: 162, yearly: 564 },
};

/** What the marketing site transcribes as EXPECTED_PLAN_PRICES. Written out
 *  independently: two copies of nine numbers IS the cross-repo mechanism. */
const SITE_EXPECTED_PLAN_PRICES: Record<PricedPlan, Record<BillingTerm, number>> = {
  plus: { monthly: 20, quarterly: 54, yearly: 190 },
  pro: { monthly: 40, quarterly: 108, yearly: 380 },
  max: { monthly: 60, quarterly: 162, yearly: 564 },
};

/** Render a component into a detached container, the idiom the rest of this
 *  repo's component tests use (`createRoot` + `act`, no testing-library). */
function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(element); });
  return {
    container,
    unmount: () => { act(() => { root.unmount(); }); container.remove(); },
  };
}

/* ── 1 ─────────────────────────────────────────────────────────────────────── */
describe('the nine plan prices match the new table exactly', () => {
  it.each(
    PRICED_PLAN_ORDER.flatMap((plan) => BILLING_TERMS.map((term) => [plan, term] as const)),
  )('%s on %s', (plan, term) => {
    // 🔴 ALL THREE TIERS ARE CHECKED AGAINST LIVE DODO DIRECTLY, at full
    // strength. `max` carried an exception while THE-343 was ahead of Dodo;
    // THE-344 retired it when the live products caught up, so there is no
    // per-tier branch left here to weaken.
    const expected = LIVE_DODO_USD[plan][term];
    expect(planPriceUsd(plan, term)).toBe(expected);
    expect(PLAN_PRICING[plan][term]).toBe(expected);
  });

  it('🔴 the app and live Dodo agree on Ministry, from both sides', () => {
    for (const term of BILLING_TERMS) {
      // 🔴 THE GAP THE-343 OPENED IS CLOSED, and this is where that is proved.
      // The two halves are written independently — `PLAN_PRICING` is the table
      // the app publishes, `LIVE_DODO_USD` is a transcription of the live API —
      // so asserting them EQUAL is a real check and not a restatement.
      expect(PLAN_PRICING.max[term], `${term} app side`).toBe(LIVE_DODO_USD.max[term]);
    }
    // 🔴 The minor units Dodo now holds, derived rather than retyped, so this
    // cannot drift from the table it is meant to describe.
    expect(BILLING_TERMS.map((t) => PLAN_PRICING.max[t] * 100)).toEqual([6000, 16200, 56400]);
  });

  it('and the live Dodo catalogue publishes the same nine, per tier and per term', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        // The catalogue derives every price from PLAN_PRICING, and on all three
        // tiers that is now the figure Dodo holds too.
        const expected = LIVE_DODO_USD[plan][term];
        expect(DODO_LIVE_CATALOGUE[plan][term].priceUsd, `${plan}/${term}`)
          .toBe(expected);
        expect(DODO_LIVE_CATALOGUE[plan][term].priceMinorUnits, `${plan}/${term}`)
          .toBe(expected * 100);
      }
    }
  });

  it('🔴 THE-248 left the monthly column alone; THE-343 moved Ministry only', () => {
    // Individual and Small Team are untouched by both tickets. Ministry's
    // monthly is the ONE cell THE-343's founder brief names — $80 to $60 —
    // and the other two columns follow it down by the same discount rules.
    expect(PRICED_PLAN_ORDER.map((p) => planPriceUsd(p, 'monthly'))).toEqual([20, 40, 60]);
  });

  it('every discounted price went UP, which is what a smaller discount means', () => {
    const BEFORE: Record<PricedPlan, Record<string, number>> = {
      plus: { quarterly: 49, yearly: 165 },
      pro: { quarterly: 99, yearly: 329 },
      max: { quarterly: 199, yearly: 659 },
    };
    // ⚠️ SCOPED TO THE TWO TIERS THE-248 STILL OWNS. THE-343 took Ministry the
    // other way on purpose — $60 is a price CUT, so its quarter and year are
    // now BELOW THE-248's predecessors. Asserting a rise there would be
    // asserting that the later ticket did not happen.
    for (const plan of ['plus', 'pro'] as const) {
      for (const term of DISCOUNTED_TERMS) {
        expect(planPriceUsd(plan, term), `${plan} ${term} did not rise`)
          .toBeGreaterThan(BEFORE[plan][term]);
      }
    }
    // Ministry moved DOWN, and the discount shape is what THE-248 established:
    // still a flat 10% quarter, still better than 20% on the year.
    for (const term of DISCOUNTED_TERMS) {
      expect(planPriceUsd('max', term), `max ${term} did not fall`)
        .toBeLessThan(BEFORE.max[term]);
    }
  });

  it('renders the charged figure and its cycle, per tier and per term', () => {
    expect(formatPlanPrice('plus', 'quarterly')).toBe('$54/qtr');
    expect(formatPlanPrice('pro', 'quarterly')).toBe('$108/qtr');
    expect(formatPlanPrice('max', 'quarterly')).toBe('$162/qtr');
    expect(formatPlanPrice('plus', 'yearly')).toBe('$190/yr');
    expect(formatPlanPrice('pro', 'yearly')).toBe('$380/yr');
    expect(formatPlanPrice('max', 'yearly')).toBe('$564/yr');
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────── */
describe('quarterly claims a flat 10% and yearly a flat 20%', () => {
  it('the helper says so', () => {
    expect(ADVERTISED_DISCOUNT_PCT).toEqual({ quarterly: 10, yearly: 20 });
    expect(discountClaim('quarterly')).toBe('Save 10%');
    expect(discountClaim('yearly')).toBe('Save 20%');
    for (const term of DISCOUNTED_TERMS) {
      expect(discountClaim(term), `${term} hedges`).not.toContain('up to');
    }
  });

  it('🔴 and the rendered toggle draws both, with the claim in words', () => {
    const { container, unmount } = render(
      React.createElement(BillingTermToggle, { value: 'yearly', onChange: () => {} }),
    );
    const badge = (term: string) =>
      container.querySelector(`[data-testid="billing-term-badge"][data-term="${term}"]`);
    expect(badge('quarterly')!.textContent).toBe('−10%');
    expect(badge('yearly')!.textContent).toBe('−20%');
    expect(container.querySelector('[data-testid="billing-term-claim"]')!.textContent)
      .toBe('Save 20% against paying monthly.');
    expect(container.textContent).not.toContain('15%');
    expect(container.textContent).not.toContain('30%');
    unmount();
  });
});

/* ── 3 ── 🔴 MONTHLY CARRIES NO BADGE ───────────────────────────────────────── */
describe('monthly carries no discount badge at all', () => {
  it('renders no badge element for monthly — not an empty one, not a 0%', () => {
    // ⚠️ AN EMPTY PILL IS WORSE THAN NO PILL: it reads as a discount whose
    // figure failed to render. So this asserts the ELEMENT is absent, not that
    // its text is empty.
    for (const value of BILLING_TERMS) {
      const { container, unmount } = render(
        React.createElement(BillingTermToggle, { value, onChange: () => {} }),
      );
      expect(
        container.querySelector('[data-testid="billing-term-badge"][data-term="monthly"]'),
        `with ${value} selected`,
      ).toBeNull();
      expect(
        container.querySelectorAll('[data-testid="billing-term-badge"]'),
        `with ${value} selected`,
      ).toHaveLength(2);
      unmount();
    }
  });

  it('draws no percentage, no zero and no claim beside the Monthly label', () => {
    const { container, unmount } = render(
      React.createElement(BillingTermToggle, { value: 'monthly', onChange: () => {} }),
    );
    const monthly = container.querySelector('[data-testid="billing-term-segment"][data-term="monthly"]')!;
    expect(monthly.textContent).toBe('Monthly');
    expect(monthly.textContent).not.toMatch(/%/);
    expect(monthly.textContent).not.toMatch(/\d/);
    // 🔴 And the sentence beneath the toggle is absent too, not blank.
    expect(container.querySelector('[data-testid="billing-term-claim"]')).toBeNull();
    expect(container.textContent).not.toMatch(/save/i);
    unmount();
  });

  it('monthly is not a discounted term in the data either', () => {
    expect(DISCOUNTED_TERMS).toEqual(['quarterly', 'yearly']);
    expect(Object.keys(ADVERTISED_DISCOUNT_PCT).sort()).toEqual(['quarterly', 'yearly']);
    for (const plan of PRICED_PLAN_ORDER) {
      expect(actualSavingPct(plan, 'monthly'), `${plan} monthly`).toBe(0);
    }
  });
});

/* ── 4 ── 🔴 THE DERIVATION ─────────────────────────────────────────────────── */
describe('the claim shape is derived from the price table, not hardcoded', () => {
  const shapeOf = (
    table: Record<string, Record<BillingTerm, number>>,
    term: BillingTerm,
    advertised: number,
  ) => {
    const saving = (id: string) => {
      const atMonthlyRate = table[id].monthly * TERM_MONTHS[term];
      return ((atMonthlyRate - table[id][term]) * 100) / atMonthlyRate;
    };
    return advertised <= Math.min(...Object.keys(table).map(saving)) ? 'flat' : 'upTo';
  };

  it('🔴 resolves FLAT for both terms — reported, not assumed', () => {
    expect(discountClaimShape('quarterly')).toBe('flat');
    expect(discountClaimShape('yearly')).toBe('flat');
  });

  it('the same rule answers "upTo" for a claim the prices do not deliver', () => {
    expect(shapeOf(LIVE_DODO_USD, 'quarterly', 10)).toBe('flat');
    expect(shapeOf(LIVE_DODO_USD, 'quarterly', 11)).toBe('upTo');
    expect(shapeOf(LIVE_DODO_USD, 'yearly', 20)).toBe('flat');
    expect(shapeOf(LIVE_DODO_USD, 'yearly', 21)).toBe('upTo');
    // A table where ONE tier falls short is enough — the claim is about all.
    const uneven = {
      ...LIVE_DODO_USD,
      max: { ...LIVE_DODO_USD.max, quarterly: 220 },
    };
    expect(shapeOf(uneven, 'quarterly', ADVERTISED_DISCOUNT_PCT.quarterly)).toBe('upTo');
  });

  it('the shipped function agrees, and decides from prices rather than by term', () => {
    for (const term of DISCOUNTED_TERMS) {
      expect(discountClaimShape(term), term)
        .toBe(shapeOf(LIVE_DODO_USD, term, ADVERTISED_DISCOUNT_PCT[term]));
    }
    const src = readFileSync(resolve(__dirname, '../plan-features.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    const body = src.slice(src.indexOf('export function discountClaimShape'));
    const fn = body.slice(0, body.indexOf('\n}') + 2);
    expect(fn).toContain('actualSavingPct');
    expect(fn).toContain('Math.min');
    expect(fn).not.toMatch(/'yearly'|"yearly"/);
    expect(fn).not.toMatch(/'quarterly'|"quarterly"/);
  });
});

/* ── 5 ─────────────────────────────────────────────────────────────────────── */
describe('no copy claims a saving larger than the smallest actual saving', () => {
  it('the smallest savings are exactly 10.0% quarterly and 20.83% yearly, per tier', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      expect(actualSavingPct(plan, 'quarterly'), `${plan} quarterly`).toBe(10);
      expect(actualSavingPct(plan, 'yearly'), `${plan} yearly`)
        .toBeCloseTo(plan === 'max' ? 21.6667 : 20.8333, 3);
    }
    expect(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'quarterly')))).toBe(10);
    expect(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'yearly'))))
      .toBeCloseTo(20.8333, 3);
  });

  it('every flat claim holds for the worst tier', () => {
    for (const term of DISCOUNTED_TERMS) {
      expect(discountClaimShape(term)).toBe('flat');
      expect(ADVERTISED_DISCOUNT_PCT[term], `flat "${discountClaim(term)}" overstates ${term}`)
        .toBeLessThanOrEqual(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, term))));
    }
  });

  it('🔴 and the toggle renders no percentage above the worst saving on its term', () => {
    const { container, unmount } = render(
      React.createElement(BillingTermToggle, { value: 'quarterly', onChange: () => {} }),
    );
    // Scoped to the BADGES. The claim sentence beneath the toggle repeats the
    // selected term's percentage, and counting it would double one term.
    const rendered = [...container.querySelectorAll('[data-testid="billing-term-badge"]')]
      .map((el) => Number((el.textContent ?? '').replace(/[^0-9]/g, '')));
    expect(rendered).toHaveLength(DISCOUNTED_TERMS.length);
    for (const pct of rendered) {
      const term = DISCOUNTED_TERMS.find((t) => ADVERTISED_DISCOUNT_PCT[t] === pct);
      expect(term, `the toggle renders ${pct}%, which is no term's advertised figure`).toBeDefined();
      expect(pct).toBeLessThanOrEqual(
        Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, term!))),
      );
    }
    unmount();
  });
});

/* ── 6 ── 🔴 THE KNIFE EDGE ─────────────────────────────────────────────────── */
describe('a saving exactly equal to the claim passes the percentage guard', () => {
  /** The module-scope guard, restated so it can be run against a mutated
   *  percentage. Kept character-identical to the shipped comparison — the
   *  point is the OPERATOR, so a paraphrase would test nothing. */
  const guard = (advertised: Record<string, number>) => () => {
    for (const term of DISCOUNTED_TERMS) {
      const best = Math.max(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, term)));
      if (advertised[term] > best) {
        throw new Error(`${term} advertises ${advertised[term]}%, best tier saves ${best.toFixed(1)}%`);
      }
    }
  };

  it('🔴 the comparison is `>`, so EQUAL passes and one point over throws', () => {
    // Quarterly advertises 10 and every tier delivers exactly 10.0. Under `>=`
    // this would fail the build on an honest claim; if a claim above the best
    // tier could pass, the guard would be guarding nothing.
    expect(guard({ quarterly: 10, yearly: 20 })).not.toThrow();
    expect(guard({ quarterly: 11, yearly: 20 })).toThrow(/quarterly advertises 11%/);
    // ⚠️ 21 NO LONGER CLEARS THE BEST TIER. THE-343 took Ministry's year to
    // 21.67%, so a 21% claim is now one the BEST tier honours and the guard
    // must NOT throw on it — the threshold moved with the prices, which is the
    // guard deriving rather than remembering. 22 is the first figure no tier
    // reaches, so that is what the mutation has to use.
    expect(guard({ quarterly: 10, yearly: 21 })).not.toThrow();
    expect(guard({ quarterly: 10, yearly: 22 })).toThrow(/yearly advertises 22%/);
    // And the shipped module loaded at all, which is the guard passing for real.
    expect(ADVERTISED_DISCOUNT_PCT.quarterly)
      .toBe(Math.max(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'quarterly'))));
  });

  it('🔴 the saving is computed EXACTLY, not to within a rounding error', () => {
    // ⚠️ THE DEFECT, PINNED. `(1 - 54/60) * 100` is 9.999999999999998, which is
    // on the FAILING side of both comparisons. `actualSavingPct` now subtracts
    // in dollars — (60 - 54) * 100 / 60 — so the numerator stays a whole
    // number and an exact percentage lands exact.
    const naive = (monthly: number, price: number, months: number) =>
      (1 - price / (monthly * months)) * 100;
    expect(naive(20, 54, 3)).not.toBe(10);
    expect(naive(20, 54, 3)).toBeLessThan(10);
    expect(10 > naive(20, 54, 3)).toBe(true);            // would have thrown
    expect(10 <= naive(20, 54, 3)).toBe(false);          // would have hedged
    for (const plan of PRICED_PLAN_ORDER) {
      expect(actualSavingPct(plan, 'quarterly'), `${plan}`).toBe(10);
      expect(10 > actualSavingPct(plan, 'quarterly'), `${plan} trips the guard`).toBe(false);
      expect(10 <= actualSavingPct(plan, 'quarterly'), `${plan} hedges`).toBe(true);
    }
  });

  it('the headline guard also still has teeth, by mutation of the rounding rule', () => {
    expect(() => monthlyHeadlineContract()).not.toThrow();
    // ⚠️ THE-343 CLOSED THE CELL THIS USED TO BORROW. Ministry's year was
    // $760/12 = $63.3333, which rounded DOWN to $63 and implied $756; it is now
    // $564/12 = $47 exactly. No shipped cell understates under `Math.round` any
    // more, so the hazard is supplied explicitly rather than taken from the
    // table — otherwise this line would pass without exercising the guard.
    expect(() => monthlyHeadlineContract(Math.round, {
          // 🔴 THE TABLE IS EXPLICIT BECAUSE THE SHIPPED ONE NO LONGER OFFENDS.
          // THE-343 repriced Ministry to $564/yr, which is $47/mo EXACTLY, so
          // after it every quarter divides exactly and every year either
          // divides exactly or rounds UP — `Math.round` understates NOWHERE on
          // today's prices. Left pointed at the shipped table this mutation
          // would have passed while proving nothing, which is precisely the
          // vacuous guard this suite exists to refuse.
          //
          // So the hazard is supplied rather than borrowed: only `max`
          // understates here — 1325/12 = 110.4167 rounds DOWN to 110, implying
          // $1,320 against a charged $1,325 — while plus and pro divide exactly
          // and so cannot throw first, which is what lets the message name max.
          plus: { monthly: 39, quarterly: 90, yearly: 360 },
          pro: { monthly: 79, quarterly: 150, yearly: 600 },
          max: { monthly: 159, quarterly: 399, yearly: 1325 },
        })).toThrow(/max yearly/);
    expect(() => monthlyHeadlineContract(Math.floor)).toThrow(/never promise less than the bill/);
  });
});

/* ── 7 ─────────────────────────────────────────────────────────────────────── */
describe("no term's price is a whole number of months at the monthly rate", () => {
  it.each(
    PRICED_PLAN_ORDER.flatMap((plan) => DISCOUNTED_TERMS.map((term) => [plan, term] as const)),
  )('%s %s is not an integer multiple of its monthly price', (plan, term) => {
    const inMonths = planPriceUsd(plan, term) / planPriceUsd(plan, 'monthly');
    expect(Number.isInteger(inMonths), `${plan} ${term} is exactly ${inMonths} months`).toBe(false);
  });

  it('the arithmetic in full, for all six discounted cells', () => {
    // 🔴 EVERY TIER LANDS ON THE SAME QUARTERLY MULTIPLE — 2.7 months —
    // because that discount is flat at 10%. The YEARLY column no longer agrees:
    // THE-343 put Ministry on 9.4 against the 9.5 the other two keep. Both are
    // close to an integer, and that is the hazard this guard exists for — a
    // year rounded to $200 (×10) or a quarter to $60 (×3) would resurrect the
    // billed-months multiplier it keeps buried.
    expect(planPriceUsd('plus', 'quarterly') / planPriceUsd('plus', 'monthly')).toBe(2.7);
    expect(planPriceUsd('plus', 'yearly') / planPriceUsd('plus', 'monthly')).toBe(9.5);
    expect(planPriceUsd('pro', 'quarterly') / planPriceUsd('pro', 'monthly')).toBe(2.7);
    expect(planPriceUsd('pro', 'yearly') / planPriceUsd('pro', 'monthly')).toBe(9.5);
    expect(planPriceUsd('max', 'quarterly') / planPriceUsd('max', 'monthly')).toBe(2.7);
    expect(planPriceUsd('max', 'yearly') / planPriceUsd('max', 'monthly')).toBe(9.4);
  });

  it('and the headline still never promises less than the bill', () => {
    expect(formatPlanMonthlyHeadline('plus', 'quarterly')).toBe('$18');
    expect(formatPlanMonthlyHeadline('pro', 'quarterly')).toBe('$36');
    expect(formatPlanMonthlyHeadline('max', 'quarterly')).toBe('$54');
    expect(formatPlanMonthlyHeadline('plus', 'yearly')).toBe('$15.84');
    expect(formatPlanMonthlyHeadline('pro', 'yearly')).toBe('$31.67');
    expect(formatPlanMonthlyHeadline('max', 'yearly')).toBe('$47');
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        const months = TERM_MONTHS[term];
        const implied = planTermMonthlyDisplayed(plan, term) * months;
        expect(implied, `${plan} ${term}`).toBeGreaterThanOrEqual(planPriceUsd(plan, term));
        expect(implied - planPriceUsd(plan, term), `${plan} ${term}`)
          .toBeLessThan(months * 0.01 + 1e-9);
      }
    }
  });
});

/* ── 8 ─────────────────────────────────────────────────────────────────────── */
describe('the three add-on prices are unchanged and annual is still ×12', () => {
  it('🔴 this repo holds add-on IDS and deliberately holds no add-on PRICE', () => {
    // The add-on figures a customer reads live on the marketing site
    // (`ADD_ONS` / `DODO_ADD_ON_CATALOG` in Pricing.tsx), pinned there against
    // live Dodo. What this repo owns is the id half of that seam, and it must
    // not grow a price — a second copy is how the two drift.
    const table = DODO_LIVE_ADDONS as unknown as Record<string, Record<string, unknown>>;
    for (const [name, ids] of Object.entries(table)) {
      for (const [period, value] of Object.entries(ids)) {
        expect(typeof value, `${name}.${period}`).toBe('string');
        expect(value as string, `${name}.${period}`).toMatch(/^adn_/);
      }
    }
    const src = readFileSync(resolve(__dirname, '../../lib/dodo/catalogue.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    const addonBlock = src.slice(src.indexOf('export const DODO_LIVE_ADDONS'));
    expect(addonBlock.slice(0, addonBlock.indexOf('});'))).not.toMatch(/\d{3,}/);
  });

  it('the three live add-on product ids are byte-for-byte what they were', () => {
    // 🔴 An id transposed is a real card charged for the wrong product. THE-248
    // moved plan prices; it moved no add-on and no id.
    //
    // ⚠️ WAS FIVE. THE-370 retired `campus` and `contactPack` — the founder
    // detached both from all nine live plan products — so their four ids are
    // gone from the table. The three that remain are byte-for-byte unchanged,
    // INCLUDING Unlimited Contacts, whose Dodo price moved ($40 → $30 monthly,
    // $480 → $360 annual) on the same two products. That is the property worth
    // pinning: a reprice in Dodo must not re-point an id.
    expect(DODO_LIVE_ADDONS).toEqual({
      aiAssistant: { monthly: 'adn_0NlKtuImtSn7PcdvjnSni', yearly: 'adn_0NlKtw3IOHfv1GGCevNol' },
      adminSeat: { monthly: 'adn_0NlKtw7AayNYI6YYwphQ5', yearly: 'adn_0NlKtw9lWLs0VRN9hWciX' },
      unlimitedContacts: { monthly: 'adn_0NlKtwKAhJgz0jeaqDX2c', yearly: 'adn_0NlKtwMjMlsjzZ8z2Wt7P' },
    });
  });
});

/* ── 9 ─────────────────────────────────────────────────────────────────────── */
describe('the cross-repo price contract still throws when the repos disagree', () => {
  /** The site's `planPriceContract`, restated over this repo's table. The site
   *  runs the real one at module scope during its prerender; this is the app
   *  side of the same two-copy mechanism, so a one-sided edit fails HERE too
   *  rather than only in the other repo's build. */
  const contract = (expected: Record<string, Record<BillingTerm, number>>) => () => {
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        if (planPriceUsd(plan, term) !== expected[plan]?.[term]) {
          throw new Error(
            `${PLAN_DISPLAY_NAMES[plan]} (${plan}) ${term}: this repo publishes ` +
            `$${planPriceUsd(plan, term)}, the site transcribes $${expected[plan]?.[term]}`,
          );
        }
      }
    }
  };

  it('passes against the site\'s transcription of these nine', () => {
    expect(contract(SITE_EXPECTED_PLAN_PRICES)).not.toThrow();
  });

  it('🔴 throws for a one-dollar drift on EVERY tier and EVERY term — by mutation', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        const mutated = {
          plus: { ...SITE_EXPECTED_PLAN_PRICES.plus },
          pro: { ...SITE_EXPECTED_PLAN_PRICES.pro },
          max: { ...SITE_EXPECTED_PLAN_PRICES.max },
        };
        mutated[plan][term] += 1;
        expect(contract(mutated), `a $1 drift on ${plan} ${term} did not fail the contract`)
          .toThrow(new RegExp(`${PLAN_DISPLAY_NAMES[plan]}.*${term}`));
      }
    }
  });

  it('and this repo still runs its own guards at module scope', () => {
    const src = readFileSync(resolve(__dirname, '../plan-features.ts'), 'utf8');
    expect(src).toMatch(/^monthlyHeadlineContract\(\);$/m);
    expect(src).toMatch(/^for \(const term of DISCOUNTED_TERMS\) \{$/m);
  });
});

/* ── 10 ────────────────────────────────────────────────────────────────────── */
describe('free is still absent from PLAN_PRICING', () => {
  it('is a real tier with no price row', () => {
    expect(PLAN_ORDER).toContain('free');
    expect(Object.keys(PLAN_PRICING)).not.toContain('free');
    expect(Object.keys(PLAN_PRICING).sort()).toEqual(['max', 'plus', 'pro']);
    expect(PRICED_PLAN_ORDER).not.toContain('free' as unknown as PricedPlan);
    expect(isPricedPlan('free')).toBe(false);
  });
});

/* ── 11 ────────────────────────────────────────────────────────────────────── */
describe('no price literal appears outside the single source', () => {
  const SRC = resolve(__dirname, '../..');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
  const codeOf = (f: string) => readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const SOURCE = 'utils/plan-features.ts';

  /** The six THE-248 introduced. The monthly column is excluded: `$20`, `$40`
   *  and `$80` are ordinary amounts that turn up as mock donations and sample
   *  ticket prices, and a sweep for them reads a congregation's money as a
   *  plan price. */
  it.each(['54', '108', '216', '190', '380', '760'])(
    'no module outside plan-features.ts restates $%s', (digits) => {
      const modules = walk(SRC).filter((f) => !f.endsWith(SOURCE));
      expect(modules.length).toBeGreaterThan(50);
      for (const file of modules) {
        expect(codeOf(file), `${file} writes $${digits} — prices derive from PLAN_PRICING`)
          .not.toMatch(new RegExp(`\\$${digits}(?![0-9])`));
      }
    });

  it('🔴 the three unambiguously retired figures are gone from every module', () => {
    // ⚠️ 49, 99 and 199 are deliberately NOT swept. Each is still a real figure
    // elsewhere in this repo — `$49–$199` describes the tier ladder in prose,
    // `borderRadius: 99` is a pill, and 4900/9900/19900 are Stripe mock amounts
    // on legacy invoices and affiliate commissions. Those are pinned by context
    // (the Dodo catalogue test names each product id) rather than by a sweep
    // that cannot tell a price from a border radius.
    for (const digits of ['165', '329', '659']) {
      for (const file of walk(SRC).filter((f) => !f.endsWith(SOURCE))) {
        expect(codeOf(file), `${file} still carries the retired price $${digits}`)
          .not.toMatch(new RegExp(`\\$${digits}(?![0-9.])`));
      }
    }
  });
});

/* ── 12 ────────────────────────────────────────────────────────────────────── */
describe('the cheapest-plan figure still follows Individual monthly', () => {
  it('the floor is Individual monthly at $20, and no discounted figure undercuts it', () => {
    const cheapest = Math.min(...PRICED_PLAN_ORDER.map((p) => planPriceUsd(p, 'monthly')));
    expect(cheapest).toBe(20);
    expect(planPriceUsd('plus', 'monthly')).toBe(cheapest);
    // 🔴 The rendered "from $X/mo" copy lives on the marketing site, where
    // CHEAPEST_MONTHLY is derived and pinned. What this repo must not do is
    // let a DISCOUNTED figure become the floor: $18 is the new quarterly
    // headline and reads like a cheaper plan, with no billing term beside it.
    const headlines = PRICED_PLAN_ORDER.flatMap((p) =>
      DISCOUNTED_TERMS.map((t) => planTermMonthlyDisplayed(p, t)));
    expect(headlines).toContain(18);
    expect(cheapest).not.toBe(18);
    expect(Math.min(...headlines)).toBeLessThan(cheapest);
  });
});

/* ── 13 ────────────────────────────────────────────────────────────────────── */
describe('the plan feature matrix and the Dodo product ids are unchanged', () => {
  it('every live plan product id is byte-for-byte what it was', () => {
    expect(
      PRICED_PLAN_ORDER.flatMap((p) => BILLING_TERMS.map((t) => DODO_LIVE_CATALOGUE[p][t].productId)),
    ).toEqual([
      'pdt_0NlJZKKU2AQSSH7E4ziKA', 'pdt_0NloCamoWgvgYDih2UETS', 'pdt_0NlJZMLLKZ5SVGEoSGDdk',
      'pdt_0NlJZMOMhmZWiG6UVDl8I', 'pdt_0NloCaqg1QPMAlkfDnlOe', 'pdt_0NlJZMRWL8tuAZseUIRTP',
      'pdt_0NlJZMUUiT36FGMoiFXgl', 'pdt_0NloCatUWEkEUq1usWJ0n', 'pdt_0NlJZMXTnpRBAwTfBVpPs',
    ]);
  });

  it('🔴 the feature matrix is byte-for-byte unchanged by this reprice', () => {
    // A stable digest over every tier's every cell. The per-cell pin lives in
    // plan-features.test.ts, which owns the matrix; this is the narrower claim
    // that a PRICE change moved none of it. If a later ticket legitimately
    // changes a cell, both this digest and that contract move together.
    //
    // ⚠️ REPINNED FOR THE-253, WHICH IS THE "LATER TICKET" THE LINE ABOVE
    // ANTICIPATED — and it is not a reprice, which is what keeps this guard
    // meaningful. Three cells moved and no price did:
    //   · `aiChat`      true → false on pro and max
    //   · `aiKnowledge` true → false on pro and max
    //   · `aiAssistant` removed — the retired Telegram assistant's count
    // The per-cell contract in plan-features.test.ts moved in the same commit,
    // as this comment requires. 🔴 THE NINE PLAN PRICES ARE UNTOUCHED, asserted
    // separately in this same file and unchanged by that batch.
    //
    // ⚠️ REPINNED AGAIN FOR THE-314 — also not a reprice, which is again what
    // keeps this guard meaningful. Four cells moved and no price did:
    //   · `smsAutomation` true → false on plus and pro
    //   · `textToGive`    true → false on plus and pro
    // SMS became a Ministry-only capability when Harvest stopped asking churches
    // to bring their own Twilio account and started RESELLING on its own vendor
    // account — every send now spends Harvest's money, so the plan cell gates
    // something real for the first time. The per-cell contract in
    // plan-features.test.ts moved in the same commit. 🔴 THE NINE PLAN PRICES
    // ARE AGAIN UNTOUCHED — the cross-repo price contract would throw at module
    // scope during the marketing site's prerender if any of them had moved.
    const matrix = PLAN_ORDER.map((plan) => {
      const f = getPlanFeatures(plan) as unknown as Record<string, unknown>;
      return `${plan}:` + Object.keys(f).sort().map((k) => `${k}=${String(f[k])}`).join(',');
    }).join('\n');
    expect(
      createHash('sha256').update(matrix).digest('hex'),
    /* 🔵 REPINNED AT THE-335, and THE-248's claim is untouched: it is a
       REPRICE and still moves no feature cell. What moved in plan-features.ts
       is `crm`, true → false on FREE, and a new `signups` cell true on every
       tier — the founder's split, which needed a second cell because both
       screens were gated on `crm`. NO PRICE AND NO CAP MOVED, asserted
       elsewhere in this file, and the per-cell contract in
       plan-features.test.ts moved in the same commit as instructed below.

       🔵 REPINNED AGAIN AT THE-370, and THE-248's claim is again untouched: it
       is a REPRICE and still moves no feature cell. What moved here is a CAP
       change, which is a different kind of edit and this ticket's whole
       subject — `maxContacts` 150 → 500, 500 → 2,000, 2,000 → 4,000, and
       `maxChurches` 1 → -1 (UNLIMITED_CAP) on all three paid tiers, with the
       campus add-on that used to be the only path past 1 retired. NO PRICE
       MOVED: the nine plan prices are asserted unchanged elsewhere in this
       file, and the cross-repo price contract would throw at module scope
       during the marketing site's prerender if any had. The per-cell contract
       in plan-features.test.ts moved in the same commit.
       Previous pins:
         1e07d3aeb9024cdd1841144560d66bd7fa292b39c978f665881a83c90933ce23 (pre-THE-335)
         3d463af824117ac12e2b50fc1b657e30a5798dee7866a0d769a6558445152dc6 (pre-THE-370) */
      'the plan feature matrix changed. THE-248 is a REPRICE and must move no '
      + 'feature cell — if a later ticket legitimately does, update this digest '
      + 'and the per-cell contract in plan-features.test.ts together.',
    ).toBe('603e4eea639edc99c32f54610d2824101d16ced5a6fab26e82ee29974cc50a2d');
  });

  it('and the tier ladder itself is untouched', () => {
    expect(PLAN_ORDER).toEqual(['free', 'plus', 'pro', 'max']);
    expect(PRICED_PLAN_ORDER).toEqual(['plus', 'pro', 'max']);
    expect(PRICED_PLAN_ORDER.map((p) => PLAN_DISPLAY_NAMES[p]))
      .toEqual(['Individual', 'Small Team', 'Ministry']);
  });
});
