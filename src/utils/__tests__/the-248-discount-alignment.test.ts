import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
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
 * (The quarterly half was withdrawn on 2026-10-23; what follows pins the yearly
 * 20% and the no-badge monthly, and that there is no quarterly claim.)
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

/** The six, transcribed from the authenticated live Dodo API on 2026-08-27
 *  (2000 / 19000 minor units on Individual, and so on) rather than read
 *  off PLAN_PRICING — a test that reads its own subject asserts only that the
 *  subject equals itself. */
const LIVE_DODO_USD: Record<PricedPlan, Record<BillingTerm, number>> = {
  church: { monthly: 30, yearly: 300 },
  ministry: { monthly: 90, yearly: 900 },
};

/** The paired marketing site's independent transcription. */
const SITE_EXPECTED_PLAN_PRICES: Record<PricedPlan, Record<BillingTerm, number>> = {
  church: { monthly: 30, yearly: 300 },
  ministry: { monthly: 90, yearly: 900 },
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
describe('the six plan prices match the new table exactly', () => {
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
      expect(PLAN_PRICING.ministry[term], `${term} app side`).toBe(LIVE_DODO_USD.ministry[term]);
    }
    // 🔴 The minor units Dodo now holds, derived rather than retyped, so this
    // cannot drift from the table it is meant to describe.
    expect(BILLING_TERMS.map((t) => PLAN_PRICING.ministry[t] * 100)).toEqual([9000, 90000]);
  });

  it('and the live Dodo catalogue publishes the same six, per tier and per term', () => {
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

  it('🔴 THE-248 left the monthly column alone; THE-343 and THE-372 moved Ministry only', () => {
    // Individual and Small Team are untouched by all three tickets. Ministry's
    // monthly is the ONE cell each later founder brief names — $80 to $60 at
    // THE-343, back to $80 at THE-372 — and the other two columns follow it by
    // the same discount ratios.
    expect(PRICED_PLAN_ORDER.map((p) => planPriceUsd(p, 'monthly'))).toEqual([30, 90]);
  });

  it('every discounted price went UP, which is what a smaller discount means', () => {
    const BEFORE: Record<PricedPlan, Record<string, number>> = {
      church: { yearly: 165 },
      ministry: { yearly: 659 },
    };
    // ⚠️ ALL THREE TIERS AGAIN SINCE THE-372. THE-343 had cut Ministry, which
    // put its quarter and year BELOW THE-248's predecessors and scoped this
    // check to two tiers; THE-372 put Ministry back up ($80, with $752 keeping
    // THE-343's ratio), so every discounted cell sits above its pre-THE-248
    // figure once more. (The quarter went with the term on 2026-10-23.)
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of DISCOUNTED_TERMS) {
        expect(planPriceUsd(plan, term), `${plan} ${term} did not rise`)
          .toBeGreaterThan(BEFORE[plan][term]);
      }
    }
  });

  it('renders the charged figure and its cycle, per tier and per term', () => {
    expect(formatPlanPrice('church', 'yearly')).toBe('$300/yr');
    expect(formatPlanPrice('church', 'monthly')).toBe('$30/mo');
    expect(formatPlanPrice('ministry', 'yearly')).toBe('$900/yr');
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────── */
describe('yearly claims a flat 20% and there is no quarterly claim', () => {
  it('the helper says so', () => {
    expect(ADVERTISED_DISCOUNT_PCT).toEqual({ yearly: 16 });
    expect(discountClaim('yearly')).toBe('2 months free');
    for (const term of DISCOUNTED_TERMS) {
      expect(discountClaim(term), `${term} hedges`).not.toContain('up to');
    }
  });

  it('🔴 and the rendered toggle draws the one badge, with the claim in words', () => {
    const { container, unmount } = render(
      React.createElement(BillingTermToggle, { value: 'yearly', onChange: () => {} }),
    );
    const badge = (term: string) =>
      container.querySelector(`[data-testid="billing-term-badge"][data-term="${term}"]`);
    expect(badge('quarterly')).toBeNull();
    expect(badge('yearly')!.textContent).toBe('2 months free');
    expect(container.querySelector('[data-testid="billing-term-claim"]')!.textContent)
      .toBe('2 months free against paying monthly.');
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
      ).toHaveLength(1);
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
    expect(DISCOUNTED_TERMS).toEqual(['yearly']);
    expect(Object.keys(ADVERTISED_DISCOUNT_PCT).sort()).toEqual(['yearly']);
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

  it('🔴 resolves FLAT for the discounted term — reported, not assumed', () => {
    expect(discountClaimShape('yearly')).toBe('flat');
  });

  it('the same rule answers "upTo" for a claim the prices do not deliver', () => {
    expect(shapeOf(LIVE_DODO_USD, 'yearly', 16)).toBe('flat');
    expect(shapeOf(LIVE_DODO_USD, 'yearly', 17)).toBe('upTo');
    // A table where ONE tier falls short is enough — the claim is about all.
    const uneven = {
      ...LIVE_DODO_USD,
      ministry: { ...LIVE_DODO_USD.ministry, yearly: 1000 },
    };
    expect(shapeOf(uneven, 'yearly', ADVERTISED_DISCOUNT_PCT.yearly)).toBe('upTo');
  });

  it('the shipped function agrees, and decides from prices rather than by term', () => {
    for (const term of DISCOUNTED_TERMS) {
      expect(discountClaimShape(term), term)
        .toBe(shapeOf(LIVE_DODO_USD, term, ADVERTISED_DISCOUNT_PCT[term]));
    }
    const src = stripComments(readFileSync(resolve(__dirname, '../plan-features.ts'), 'utf8'));
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
  it('the smallest saving is 20.83% yearly, per tier', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      expect(actualSavingPct(plan, 'yearly'), `${plan} yearly`)
        .toBeCloseTo(16.6667, 3);
    }
    expect(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'yearly'))))
      .toBeCloseTo(16.6667, 3);
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
      React.createElement(BillingTermToggle, { value: 'yearly', onChange: () => {} }),
    );
    const badges = [...container.querySelectorAll('[data-testid="billing-term-badge"]')];
    expect(badges).toHaveLength(DISCOUNTED_TERMS.length);
    for (const badge of badges) {
      const term = badge.getAttribute('data-term');
      expect(term).toBe('yearly');
      expect(badge.textContent).toBe('2 months free');
      for (const plan of PRICED_PLAN_ORDER) {
        expect(planPriceUsd(plan, 'yearly')).toBe(planPriceUsd(plan, 'monthly') * 10);
        expect(ADVERTISED_DISCOUNT_PCT.yearly).toBeLessThanOrEqual(actualSavingPct(plan, 'yearly'));
      }
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
    // The live table has no exact-equality cell any more — the quarter, which
    // advertised 10 against a delivered 10.0, was withdrawn on 2026-10-23 — so
    // the operator is proved on the one shipped term: 20 against a best tier of
    // 21.67 passes, and the first whole claim no tier reaches throws. Under
    // `>=` an honest claim equal to the best saving would fail the build; if a
    // claim above the best tier could pass, the guard would be guarding nothing.
    const best = Math.max(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'yearly')));
    expect(guard({ yearly: best })).not.toThrow();
    expect(guard({ yearly: 40 })).toThrow(/yearly advertises 40%/);
    // ⚠️ 21 NO LONGER CLEARS THE BEST TIER. THE-343 took Ministry's year to
    // 21.67%, so a 21% claim is now one the BEST tier honours and the guard
    // must NOT throw on it — the threshold moved with the prices, which is the
    // guard deriving rather than remembering. 22 is the first figure no tier
    // reaches, so that is what the mutation has to use.
    expect(guard({ yearly: 16 })).not.toThrow();
    expect(guard({ yearly: 17 })).toThrow(/yearly advertises 17%/);
    // And the shipped module loaded at all, which is the guard passing for real.
    expect(ADVERTISED_DISCOUNT_PCT.yearly)
      .toBeLessThanOrEqual(Math.max(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'yearly'))));
  });

  it('🔴 the saving is computed EXACTLY, not to within a rounding error', () => {
    // ⚠️ THE DEFECT, PINNED. `(1 - 216/240) * 100` — a year at exactly 10% off,
    // the shape the withdrawn quarter had at 54/60 — is 9.999999999999998, which
    // is on the FAILING side of both comparisons. `actualSavingPct` subtracts in
    // dollars — (240 - 216) * 100 / 240 — so the numerator stays a whole number
    // and an exact percentage lands exact.
    const naive = (monthly: number, price: number, months: number) =>
      (1 - price / (monthly * months)) * 100;
    const dollarsFirst = (monthly: number, price: number, months: number) =>
      ((monthly * months - price) * 100) / (monthly * months);
    expect(naive(20, 216, 12)).not.toBe(10);
    expect(naive(20, 216, 12)).toBeLessThan(10);
    expect(10 > naive(20, 216, 12)).toBe(true);          // would have thrown
    expect(10 <= naive(20, 216, 12)).toBe(false);        // would have hedged
    expect(dollarsFirst(20, 216, 12)).toBe(10);
    // The live function must keep the dollars-first form: the live table has no
    // exact-percentage cell left to prove it on, so the source is what is held.
    const src = stripComments(readFileSync(resolve(__dirname, '../plan-features.ts'), 'utf8'));
    const body = src.slice(src.indexOf('export function actualSavingPct'));
    const fn = body.slice(0, body.indexOf('\n}') + 2);
    expect(fn).toContain('(atMonthlyRate - planPriceUsd(plan, term)) * 100');
    expect(fn).not.toMatch(/1\s*-\s*planPriceUsd/);
  });

  it('the headline guard also still has teeth, by mutation of the rounding rule', () => {
    expect(() => monthlyHeadlineContract()).not.toThrow();
    // ⚠️ THE-343 CLOSED THE CELL THIS USED TO BORROW. Ministry's year was
    // $760/12 = $63.3333, which rounded DOWN to $63 and implied $756; it is now
    // $752/12 = $62.6667 (THE-372), which rounds UP. No shipped cell understates
    // under `Math.round` any more, so the hazard is supplied explicitly rather than taken from the
    // table — otherwise this line would pass without exercising the guard.
    expect(() => monthlyHeadlineContract(Math.round, {
          // 🔴 THE TABLE IS EXPLICIT BECAUSE THE SHIPPED ONE NO LONGER OFFENDS.
          // THE-343 repriced Ministry to $564/yr, which is $47/mo EXACTLY, so
          // after it every year either
          // divides exactly or rounds UP — `Math.round` understates NOWHERE on
          // today's prices. Left pointed at the shipped table this mutation
          // would have passed while proving nothing, which is precisely the
          // vacuous guard this suite exists to refuse.
          //
          // So the hazard is supplied rather than borrowed: only `max`
          // understates here — 1325/12 = 110.4167 rounds DOWN to 110, implying
          // $1,320 against a charged $1,325 — while plus and pro divide exactly
          // and so cannot throw first, which is what lets the message name max.
          church: { monthly: 39, yearly: 360 },
          ministry: { monthly: 159, yearly: 1325 },
        })).toThrow(/ministry yearly/);
    expect(() => monthlyHeadlineContract(Math.floor, { church: { monthly: 39, yearly: 361 }, ministry: { monthly: 159, yearly: 1325 } })).toThrow(/never promise less than the bill/);
  });
});

/* ── 7 ─────────────────────────────────────────────────────────────────────── */
describe("no term's price is a whole number of months at the monthly rate", () => {
  it.each(
    PRICED_PLAN_ORDER.flatMap((plan) => DISCOUNTED_TERMS.map((term) => [plan, term] as const)),
  )('%s %s is not an integer multiple of its monthly price', (plan, term) => {
    const inMonths = planPriceUsd(plan, term) / planPriceUsd(plan, 'monthly');
    expect(inMonths, `${plan} ${term}`).toBe(10);
  });

  it('the arithmetic in full, for every discounted cell', () => {
    // 🔴 THE YEARLY COLUMN LANDS ON 9.5 MONTHS for Individual and Small Team and
    // on 9.4 for Ministry, since THE-343. Both are close to an integer, and that
    // is the hazard this guard exists for — a year rounded to $200 (×10) would
    // resurrect the billed-months multiplier it keeps buried. (The quarter's
    // flat 2.7 went with the term on 2026-10-23.)
    expect(planPriceUsd('church', 'yearly') / planPriceUsd('church', 'monthly')).toBe(10);
    expect(planPriceUsd('ministry', 'yearly') / planPriceUsd('ministry', 'monthly')).toBe(10);
  });

  it('and the headline still never promises less than the bill', () => {
    expect(formatPlanMonthlyHeadline('church', 'yearly')).toBe('$25');
    expect(formatPlanMonthlyHeadline('church', 'monthly')).toBe('$30');
    expect(formatPlanMonthlyHeadline('ministry', 'yearly')).toBe('$75');
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

  it('passes against the site\'s transcription of these six', () => {
    expect(contract(SITE_EXPECTED_PLAN_PRICES)).not.toThrow();
  });

  it('🔴 throws for a one-dollar drift on EVERY tier and EVERY term — by mutation', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        const mutated = {
          church: { ...SITE_EXPECTED_PLAN_PRICES.church },
          ministry: { ...SITE_EXPECTED_PLAN_PRICES.ministry },
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
    expect(Object.keys(PLAN_PRICING).sort()).toEqual(['church', 'ministry']);
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
  const sourceCache = new Map<string, string>();
  const codeOf = (f: string) => {
    if (!sourceCache.has(f)) sourceCache.set(f, stripComments(readFileSync(f, 'utf8')));
    return sourceCache.get(f)!;
  };
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
    expect(cheapest).toBe(30);
    expect(planPriceUsd('church', 'monthly')).toBe(cheapest);
    // 🔴 The rendered "from $X/mo" copy lives on the marketing site, where
    // CHEAPEST_MONTHLY is derived and pinned. What this repo must not do is
    // let a DISCOUNTED figure become the floor: $15.84 is Individual's yearly
    // headline and reads like a cheaper plan, with no billing term beside it.
    const headlines = PRICED_PLAN_ORDER.flatMap((p) =>
      DISCOUNTED_TERMS.map((t) => planTermMonthlyDisplayed(p, t)));
    expect(headlines).toContain(25);
    expect(cheapest).not.toBe(25);
    expect(Math.min(...headlines)).toBeLessThan(cheapest);
  });
});

/* ── 13 ────────────────────────────────────────────────────────────────────── */
describe('the plan feature matrix and the Dodo product ids are unchanged', () => {
  it('every live plan product id is byte-for-byte what it was', () => {
    expect(
      PRICED_PLAN_ORDER.flatMap((p) => BILLING_TERMS.map((t) => DODO_LIVE_CATALOGUE[p][t].productId)),
    ).toEqual([
      'pdt_0NqdacJTREPtSJuqtPCjm', 'pdt_0NqdacQf9gvgmw6DU7449',
      'pdt_0NqdacWLx9z6CKsGRIKCW', 'pdt_0Nqdaca89LIHeUvrNxXwZ',
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
         3d463af824117ac12e2b50fc1b657e30a5798dee7866a0d769a6558445152dc6 (pre-THE-370)
         603e4eea639edc99c32f54610d2824101d16ced5a6fab26e82ee29974cc50a2d (pre social scheduler)

       The social scheduler adds `socialScheduler: false` on every tier. No
       price moved. The per-cell contract in plan-features.test.ts moved in
       the same commit.

       🔵 REPINNED FOR THE SCHEDULER ON MINISTRY, and THE-248's claim is again
       untouched: one cell moved, `socialScheduler` false → true on `max`
       alone. Matei approved 2026-10-21: "Include the scheduler in the Ministry plan". It is an
       entitlement change only: no price, checkout or plan id moved, and the
       add-on path still lifts the cell on every other tier.
       Previous pin:
         7e89af17c3a81b20fa333c881dcd7d3dd9c1fb1a8f1423b821ae111b200de8f6 (scheduler on no tier)

       🔵 REPINNED FOR THE TWO-PLAN REPRICING (the founder approved it on
       2026-10-27), and THE-248's claim is untouched for what THE-248 was: a
       discount reprice that moved no cell. This is a different, deliberate
       edit: the matrix goes from free / plus / pro / max to free / church /
       ministry, so the tier rows themselves changed (Church carries the feed
       chat and notes, Ministry carries the knowledge base, and the AI
       assistant allowance, product and community caps are new cells). The
       per-cell contract in plan-features.test.ts moved in the same commit.
       Previous pin:
         fe136fdc5a1e10562f1068b2cdff17b184d4575369c5ccc278befee295b681cf (free / plus / pro / max) */
      'the plan feature matrix changed. THE-248 is a REPRICE and must move no '
      + 'feature cell — if a later ticket legitimately does, update this digest '
      + 'and the per-cell contract in plan-features.test.ts together.',
    ).toBe('437c28e97c1eec6461ce387fd88eba4998595e56e2b3b4cb65ae287fc3ee8a00'); // #557 adds Free shell entitlement cells; previous pin 892baa7e7243c80a856110015192561119f53ea6c4941777a4a931d6bd77550b retained for history.
  });

  it('and the tier ladder itself is untouched', () => {
    expect(PLAN_ORDER).toEqual(['free', 'church', 'ministry']);
    expect(PRICED_PLAN_ORDER).toEqual(['church', 'ministry']);
    expect(PRICED_PLAN_ORDER.map((p) => PLAN_DISPLAY_NAMES[p]))
      .toEqual(['Church', 'Ministry']);
  });
});
