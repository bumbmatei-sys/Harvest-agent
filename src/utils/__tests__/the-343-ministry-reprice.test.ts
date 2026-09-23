import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// `catalogue.ts` consumes the validated `dodoConfig`, so config.ts evaluates on
// import and the three required variables must exist first. Hoisted above the
// static imports below by vitest — the same idiom as dodo-catalogue.test.ts.
// `test_mode` is chosen deliberately: `DODO_LIVE_CATALOGUE` is exported
// directly and does not depend on the active environment, so the live figures
// are still read while nothing here can touch a live-mode code path.
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
  ceilToCent,
  discountClaim,
  discountClaimShape,
  formatPlanMonthlyHeadline,
  formatPlanPrice,
  getPlanFeatures,
  isPricedPlan,
  planPriceUsd,
  planTermMonthlyDisplayed,
} from '../plan-features';
import type { PricedPlan } from '../../types/tenant.types';
import { PLATFORM_FEE_MAP } from '../../lib/stripe-connect';
import { DODO_LIVE_CATALOGUE, catalogueEntry, termPriceUsd } from '../../lib/dodo/catalogue';
import { planWritesIn } from '../../__tests__/the-291-client-plan-write.test';

/* ─────────────────────────────────────────────────────────────────────────────
 * THE-343 — Ministry drops from $80 to $60.
 *
 * The founder: "I want to move the ministry plan from 80 to 60 because we cut
 * too many features. I'll put 60 as early bird price and as we add more
 * features I will increase the price." SMS, Newsletter, QuickBooks and the
 * Gmail connection were all hidden this week; Ministry lost the most of the
 * three tiers, so $80 no longer matched what it delivers.
 *
 *   monthly    60   the founder's number
 *   quarterly  162  60 x 3 = 180, less exactly 10% — the same shape the other
 *                   two tiers already had (54/60 and 108/120)
 *   yearly     564  60 x 12 = 720, less 21.67% — better than the advertised 20,
 *                   and 564 / 12 = 47 EXACTLY
 *
 * 🔴 A REPRICE IS NOT AN ENTITLEMENT CHANGE, and most of this file is about
 * that: the feature matrix, the caps, the platform fee and the webhook's sole
 * ownership of `plan` are all asserted UNMOVED. A tenant already on `max` pays
 * less at renewal and loses nothing.
 *
 * ✅ AND DODO HAS SINCE BEEN REPRICED TOO — THE-344. When this ticket landed,
 * the three live products carried the superseded amounts and that gap was
 * recorded, and asserted from both sides, in `dodo-catalogue.test.ts`. THE-344
 * read them back at this ticket's figures, with the 14-day trial and the
 * billing intervals intact, so the sections below assert AGREEMENT.
 *
 * 🔴 SUPERSEDED BY THE-372. The founder put Ministry back to $80, applied in
 * Dodo first and verified live, with the quarter and year at $216 and $752 —
 * THIS ticket's discount RATIOS kept exactly (2.7x and 9.4x monthly). Every
 * assertion below that named this ticket's figures now names the current ones
 * and says so where it moved; the entitlement no-regression pins, the stripper
 * and the derivation sweeps are unchanged, because they were never about the
 * $60. `THE-372.ministry-80.test.ts` owns the new guards.
 * ───────────────────────────────────────────────────────────────────────────*/

const REPO = resolve(__dirname, '../../..');
const PLAN_FEATURES_PATH = resolve(REPO, 'src/utils/plan-features.ts');

/**
 * 🔴 SOURCE WITH COMMENTS STRIPPED, AND THIS FILE CANNOT BE READ ANY OTHER WAY.
 *
 * `plan-features.ts` is ~1,600 lines and MOSTLY PROSE. Every price, every tier
 * name and every rule appears repeatedly in block comments that explain them —
 * so a content grep over the raw file matches a docblock and passes while the
 * code says something else. Thirteen guards in this series shipped a planted
 * defect that way, one of them reading a docblock seven hundred lines from the
 * code it believed it was checking.
 *
 * ⚠️ VERIFIED, NOT INHERITED. The stripper is proved below — on a fixture whose
 * every case is written out, and on the real file — before anything is grepped.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") { mode = 'sq'; out += c; i++; continue; }
      if (c === '"') { mode = 'dq'; out += c; i++; continue; }
      if (c === '`') { mode = 'tpl'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; }
      i++; continue;
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; }
      if (c === '\n') out += c;   // newlines kept, so nothing shifts
      i++; continue;
    }
    out += c;
    if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) {
      mode = 'code';
    }
    i++;
  }
  return out;
}

const PLAN_FEATURES_SRC = readFileSync(PLAN_FEATURES_PATH, 'utf8');
const PLAN_FEATURES_CODE = stripComments(PLAN_FEATURES_SRC);

/* ── 0 · the stripper, before anything is grepped through it ──────────────── */
describe('🔴 the comment stripper is verified before any guard relies on it', () => {
  it('removes comments, keeps code, and keeps comment-like text inside strings', () => {
    expect(stripComments('const a = 1; // gone\nconst b = 2;')).toBe('const a = 1; \nconst b = 2;');
    expect(stripComments('const a = /* gone */ 1;')).toBe('const a =  1;');
    expect(stripComments("const s = '// not a comment';")).toBe("const s = '// not a comment';");
    expect(stripComments('const s = "/* not a comment */";')).toBe('const s = "/* not a comment */";');
    expect(stripComments('const s = `a // b /* c */`;')).toBe('const s = `a // b /* c */`;');
    expect(stripComments("const s = 'it\\'s // fine';")).toBe("const s = 'it\\'s // fine';");
    expect(stripComments('a\n/* one\ntwo */\nb')).toBe('a\n\n\nb');
  });

  it('🔴 EATS NOTHING OF THE REAL FILE — it only DELETES, and not too much', () => {
    // Card 86bbxkawp: an inherited stripper in this series removed ~150 lines of
    // its subject and its guards went quiet. Four independent properties.

    // (a) The line count is preserved, so nothing shifts and no block vanished.
    expect(PLAN_FEATURES_CODE.split('\n').length, 'the stripper changed the line count')
      .toBe(PLAN_FEATURES_SRC.split('\n').length);

    // (b) 🔴 THE OUTPUT IS A SUBSEQUENCE OF THE INPUT — every character it emits
    //     appears in the original, in order. A stripper that rewrote, reordered
    //     or duplicated anything fails here however little it removed.
    let i = 0;
    for (const ch of PLAN_FEATURES_CODE) {
      const at = PLAN_FEATURES_SRC.indexOf(ch, i);
      expect(at, 'the stripper emitted a character the source does not contain, in order')
        .toBeGreaterThanOrEqual(0);
      i = at + 1;
    }

    // (c) 🔴 AND IT DID NOT DELETE TOO MUCH — anchors spread across the whole
    //     file, IN FILE ORDER, so a stripper that ate a 150-line region cannot
    //     pass by keeping only the top.
    const ANCHORS = [
      'export const PLAN_PRICING',
      'export function planPriceUsd(',
      'export function isPricedPlan(',
      'export function ceilToCent(',
      'export function monthlyHeadlineContract(',
      'export function actualSavingPct(',
      'export const ADVERTISED_DISCOUNT_PCT',
      'export function discountClaimShape(',
      'export function getPlanFeatures(',
      'export const PLAN_DISPLAY_NAMES',
      'export const PLAN_ORDER',
      'export function formatPlanPrice(',
    ];
    let prev = -1;
    for (const a of ANCHORS) {
      const at = PLAN_FEATURES_CODE.indexOf(a);
      expect(at, `the stripper ate the region around "${a}"`).toBeGreaterThan(-1);
      expect(at, `"${a}" is out of order after stripping`).toBeGreaterThan(prev);
      prev = at;
    }

    // (d) A volume floor, and idempotency.
    const nonEmpty = PLAN_FEATURES_CODE.split('\n').filter((l) => l.trim()).length;
    expect(nonEmpty, 'the stripper removed far more than the comments').toBeGreaterThan(300);
    expect(stripComments(PLAN_FEATURES_CODE)).toBe(PLAN_FEATURES_CODE);
  });

  it('🔴 and it really does hide a comment — proved on this very file', () => {
    // A phrase that exists ONLY in prose here. If it survives the strip, the
    // strip is not working and every source guard below is worthless.
    expect(PLAN_FEATURES_SRC, 'the premise moved').toContain('DO NOT COMPUTE A BADGE FROM THIS TABLE');
    expect(PLAN_FEATURES_CODE, 'a comment survived the strip')
      .not.toContain('DO NOT COMPUTE A BADGE FROM THIS TABLE');
  });
});

/* ── 1 & 2 · the table ────────────────────────────────────────────────────── */
describe('1 & 2 · PLAN_PRICING.max is exactly what THE-372 restored, and nothing else moved', () => {
  it('max is exactly { monthly: 80, quarterly: 216, yearly: 752 } (moved at THE-372)', () => {
    expect(PLAN_PRICING.max).toEqual({ monthly: 80, quarterly: 216, yearly: 752 });
  });

  it('🔴 plus and pro are UNCHANGED — enumerated, every cell', () => {
    expect(PLAN_PRICING.plus).toEqual({ monthly: 20, quarterly: 54, yearly: 190 });
    expect(PLAN_PRICING.pro).toEqual({ monthly: 40, quarterly: 108, yearly: 380 });
    // As one object too, so a FOURTH tier cannot appear unnoticed.
    expect(PLAN_PRICING).toEqual({
      plus: { monthly: 20, quarterly: 54, yearly: 190 },
      pro: { monthly: 40, quarterly: 108, yearly: 380 },
      max: { monthly: 80, quarterly: 216, yearly: 752 },
    });
  });

  it('the table is still frozen, so nothing can reprice a tier at runtime', () => {
    expect(Object.isFrozen(PLAN_PRICING)).toBe(true);
    for (const plan of PRICED_PLAN_ORDER) expect(Object.isFrozen(PLAN_PRICING[plan])).toBe(true);
  });

  it('THE-343 was a cut on every term; THE-372 reversed it on month and quarter, and the year stays below THE-248', () => {
    // ⚠️ INVERTED AT THE-372. THE-343 cut all three from THE-248's 80 / 216 /
    // 760. THE-372 restored the month and the quarter exactly and derived the
    // year from THE-343's ratio, so it lands at 752 — still $8 under 760.
    const THE_248 = { monthly: 80, quarterly: 216, yearly: 760 } as const;
    expect(PLAN_PRICING.max.monthly).toBe(THE_248.monthly);
    expect(PLAN_PRICING.max.quarterly).toBe(THE_248.quarterly);
    expect(PLAN_PRICING.max.yearly).toBeLessThan(THE_248.yearly);
  });
});

/* ── 3 & 4 · the discounts ────────────────────────────────────────────────── */
describe('3 & 4 · the delivered discounts, and the validator', () => {
  it('🔴 quarterly is EXACTLY 10% off on all three tiers', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      expect(actualSavingPct(plan, 'quarterly'), `${plan} quarterly`).toBe(10);
      // Stated as arithmetic too, so the claim is legible without the helper.
      expect(planPriceUsd(plan, 'quarterly')).toBe(planPriceUsd(plan, 'monthly') * 3 * 0.9);
    }
  });

  it('🔴 THE DELIVERED YEARLY PERCENTAGES, per tier — Ministry now differs', () => {
    // The figures this ticket has to report. Individual and Small Team are
    // unchanged at 190/240 and 380/480; Ministry was 564/720 and since THE-372
    // is 752/960 — the same ratio, so the same percentage.
    expect(actualSavingPct('plus', 'yearly')).toBeCloseTo(20.8333, 4);
    expect(actualSavingPct('pro', 'yearly')).toBeCloseTo(20.8333, 4);
    expect(actualSavingPct('max', 'yearly')).toBeCloseTo(21.6667, 4);
    // 🔴 THE ADVERTISED CLAIM RESTS ON THE WORST TIER, and Ministry saving MORE
    // cannot raise it. This is the assertion that keeps "Save 20%" honest.
    expect(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'yearly'))))
      .toBeCloseTo(20.8333, 4);
    expect(Math.max(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'yearly'))))
      .toBeCloseTo(21.6667, 4);
  });

  it('🔴 the module-scope validator PASSES — proved by the module having loaded', () => {
    // The guard runs at import. If it threw, nothing in this file would run at
    // all — so this assertion is really about the wording it feeds.
    expect(ADVERTISED_DISCOUNT_PCT).toEqual({ quarterly: 10, yearly: 20 });
    expect(discountClaimShape('quarterly')).toBe('flat');
    expect(discountClaimShape('yearly')).toBe('flat');
    expect(discountClaim('quarterly')).toBe('Save 10%');
    expect(discountClaim('yearly')).toBe('Save 20%');
    for (const term of DISCOUNTED_TERMS) {
      expect(discountClaim(term), `${term} hedged`).not.toContain('up to');
      // No advertised figure exceeds even the BEST tier — the guard's own rule.
      expect(ADVERTISED_DISCOUNT_PCT[term])
        .toBeLessThanOrEqual(Math.max(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, term))));
      // Nor the worst, which is what lets it be stated flat.
      expect(ADVERTISED_DISCOUNT_PCT[term])
        .toBeLessThanOrEqual(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, term))));
    }
  });

  it('🔴 and the advertised figures were NOT bent to make the validator pass', () => {
    // The STOP condition on this ticket: if the validator had thrown, the fix
    // was never to lower the advertised percentage. Both are still the
    // founder's round numbers, and the source still STORES rather than computes.
    expect(ADVERTISED_DISCOUNT_PCT.quarterly).toBe(10);
    expect(ADVERTISED_DISCOUNT_PCT.yearly).toBe(20);
    const decl = PLAN_FEATURES_CODE.slice(
      PLAN_FEATURES_CODE.indexOf('export const ADVERTISED_DISCOUNT_PCT'),
    ).slice(0, 200);
    expect(decl.length, 'the declaration slice is empty — this guard would be vacuous')
      .toBeGreaterThan(50);
    expect(decl).toContain('quarterly: 10');
    expect(decl).toContain('yearly: 20');
    // Not derived from the prices: no call into the saving helper here.
    expect(decl).not.toContain('actualSavingPct');
  });
});

/* ── 5 · the monthly equivalent ───────────────────────────────────────────── */
describe("5 · Ministry's monthly equivalent", () => {
  it('752 / 12 is CEILED to $62.67 — THE-343\'s clean $47 moved at THE-372', () => {
    // THE-343 chose 564 because 564 / 12 is exactly 47. THE-372's 752 is not a
    // whole multiple of twelve, so the headline carries cents again, and the
    // ceiling is what keeps it from promising less than the bill.
    expect(PLAN_PRICING.max.yearly / 12).toBeCloseTo(62.6667, 4);
    expect(planTermMonthlyDisplayed('max', 'yearly')).toBe(62.67);
    expect(formatPlanMonthlyHeadline('max', 'yearly')).toBe('$62.67');
    expect(planTermMonthlyDisplayed('max', 'yearly') * 12).toBeGreaterThanOrEqual(PLAN_PRICING.max.yearly);
  });

  it('🔴 THE ROUNDING TRAP 564 WAS CHOSEN TO AVOID, stated as arithmetic', () => {
    // The "natural" 20.83%-off figure is 570, and 570 / 12 is 47.5 — a decimal
    // sitting exactly on the half-cent boundary. Under a rounding rule that
    // resolves .5 upward it becomes 48, implying $576 against a charged $570:
    // a headline that OVERSTATES what the church actually pays.
    expect(570 / 12).toBe(47.5);
    expect(Math.round(47.5)).toBe(48);
    expect(48 * 12).toBe(576);
    expect(576).toBeGreaterThan(570);
    // 🔴 THIS REPO CEILS TO THE CENT rather than rounding, so 570 would print
    // $47.50 — honest, but a decimal on the card. The rule, not the figure, is
    // what this still guards now that THE-372's figure carries cents anyway.
    expect(ceilToCent(570 / 12)).toBe(47.5);
    expect(Number.isInteger(ceilToCent(570 / 12))).toBe(false);
    expect(Number.isInteger(ceilToCent(564 / 12))).toBe(true);
  });

  it('the other two tiers keep the cents they already had', () => {
    expect(formatPlanMonthlyHeadline('plus', 'yearly')).toBe('$15.84');
    expect(formatPlanMonthlyHeadline('pro', 'yearly')).toBe('$31.67');
    // All three quarters still divide exactly.
    expect(formatPlanMonthlyHeadline('plus', 'quarterly')).toBe('$18');
    expect(formatPlanMonthlyHeadline('pro', 'quarterly')).toBe('$36');
    expect(formatPlanMonthlyHeadline('max', 'quarterly')).toBe('$72');
  });

  it('🔴 and no headline promises less than the bill, on any tier or term', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        const implied = planTermMonthlyDisplayed(plan, term) * TERM_MONTHS[term];
        expect(implied, `${plan} ${term} understates the bill`)
          .toBeGreaterThanOrEqual(planPriceUsd(plan, term) - 1e-9);
      }
    }
  });
});

/* ── 6 · every displayed price is derived ─────────────────────────────────── */
describe('6 · no price literal on a surface — every figure goes through the helpers', () => {
  it('formatPlanPrice renders the charged figure and its cycle, per tier and term', () => {
    expect(formatPlanPrice('max', 'monthly')).toBe('$80/mo');
    expect(formatPlanPrice('max', 'quarterly')).toBe('$216/qtr');
    expect(formatPlanPrice('max', 'yearly')).toBe('$752/yr');
    expect(formatPlanPrice('plus', 'monthly')).toBe('$20/mo');
    expect(formatPlanPrice('pro', 'yearly')).toBe('$380/yr');
    // Free has no price and no cycle.
    expect(formatPlanPrice('free', 'monthly')).toBe('Free');
  });

  it('🔴 REPO-WIDE SWEEP: no rendered file spells a plan price as a literal', () => {
    // Every surface must read PLAN_PRICING. A hardcoded "$60" renders correctly
    // today and silently outlives the next reprice — which is the entire failure
    // mode this ticket is an instance of.
    //
    // 🔴 RUN OVER COMMENT-STRIPPED SOURCE, and scoped to STRING LITERALS. Bare
    // numbers are everywhere and legitimate (`fontSize: 60`, a 162-item array);
    // what can never be right is a currency figure sitting in text a user reads.
    const PRICES = PRICED_PLAN_ORDER.flatMap((p) => BILLING_TERMS.map((t) => String(PLAN_PRICING[p][t])));
    const offenders: string[] = [];
    let scanned = 0;
    (function walk(dir: string) {
      for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === '__tests__' || e === '__fixtures__') continue;
        const abs = join(dir, e);
        if (statSync(abs).isDirectory()) { walk(abs); continue; }
        if (!/\.(ts|tsx)$/.test(abs) || /\.test\.tsx?$/.test(abs)) continue;
        scanned++;
        const code = stripComments(readFileSync(abs, 'utf8'));
        const literals = [
          ...code.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'/g),
          ...code.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g),
          ...code.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/g),
        ].map((m) => m[1]);
        for (const lit of literals) {
          for (const price of PRICES) {
            if (new RegExp(`\\$${price}(?![\\d.])`).test(lit)) {
              offenders.push(`${abs}: "${lit}"`);
            }
          }
        }
      }
    })(resolve(REPO, 'src'));
    expect(scanned, 'the sweep walked nothing — it would be vacuous').toBeGreaterThan(200);
    expect(offenders, 'a plan price is spelled as a literal in a rendered file').toEqual([]);
  });

  it('🔴 THE MUTATION — the sweep really would catch a planted literal', () => {
    // Proved on the sweep's own predicate, so it cannot be vacuous.
    const catches = (lit: string) =>
      PRICED_PLAN_ORDER.flatMap((p) => BILLING_TERMS.map((t) => String(PLAN_PRICING[p][t])))
        .some((price) => new RegExp(`\\$${price}(?![\\d.])`).test(lit));
    expect(catches('Ministry is $80/mo'), 'a planted $80 would not be caught').toBe(true);
    expect(catches('billed as $752 every 12 months'), 'a planted $752 would not be caught').toBe(true);
    expect(catches('$216/qtr'), 'a planted $216 would not be caught').toBe(true);
    // And it does NOT fire on things that are not plan prices.
    expect(catches('borderRadius 60'), 'a bare number was read as a price').toBe(false);
    expect(catches('$600 raised'), 'a longer figure was read as a price').toBe(false);
  });
});

/* ── 7 · free is still a tier and not a price ─────────────────────────────── */
describe('7 · free is still ABSENT from PLAN_PRICING — no-regression', () => {
  it('it is a real tier with no price row', () => {
    expect(PLAN_ORDER).toContain('free');
    expect(Object.keys(PLAN_PRICING).sort()).toEqual(['max', 'plus', 'pro']);
    expect(isPricedPlan('free')).toBe(false);
    expect(PRICED_PLAN_ORDER).not.toContain('free' as unknown as PricedPlan);
    // 🔴 NOT A $0 ROW. Three zeros would say "billed, at nothing".
    expect((PLAN_PRICING as Record<string, unknown>).free).toBeUndefined();
  });
});

/* ── 8 · an existing max tenant ───────────────────────────────────────────── */
describe('8 · an existing max tenant is NOT re-entitled, downgraded or disturbed', () => {
  it('🔴 every feature cell on max is what it was before the reprice', () => {
    // A price is not an entitlement. This enumerates the tier's whole feature
    // set rather than sampling it, so a reprice that quietly took something
    // away — the very thing a price CUT invites — fails here.
    const max = getPlanFeatures('max');
    const plus = getPlanFeatures('plus');
    const pro = getPlanFeatures('pro');

    // Caps first: the numbers a tenant would notice immediately.
    // ⚠️ `maxContacts` 2,000 → 4,000 IN THE-370, which is a CAP RAISE and not
    // this reprice's doing. THE-343's claim — a price cut took nothing away —
    // is unaffected and is strengthened: the cap went UP afterwards, never down.
    expect(max.maxContacts).toBe(4_000);
    expect(max.maxAdmins).toBe(15);
    expect(max.maxCourses).toBe(15);

    // 🔴 AND MAX IS STILL THE TOP TIER ON EVERY BOOLEAN — derived, so a new
    // cell added later is covered without editing this test. A cheaper Ministry
    // that lost a capability the tiers below keep would fail here.
    for (const [cell, value] of Object.entries(max)) {
      if (typeof value !== 'boolean') continue;
      const below = [plus, pro] as unknown as Record<string, unknown>[];
      for (const lower of below) {
        if (lower[cell] === true) {
          expect(value, `max lost "${cell}", which a cheaper tier still has`).toBe(true);
        }
      }
    }
    for (const [cell, value] of Object.entries(max)) {
      if (typeof value !== 'number') continue;
      expect(value, `max's "${cell}" cap fell below Individual's`)
        .toBeGreaterThanOrEqual((plus as unknown as Record<string, number>)[cell]);
      expect(value, `max's "${cell}" cap fell below Small Team's`)
        .toBeGreaterThanOrEqual((pro as unknown as Record<string, number>)[cell]);
    }
  });

  it('🔴 the tier keeps its identity — name, order and priced status', () => {
    expect(PLAN_DISPLAY_NAMES.max).toBe('Ministry');
    expect(PLAN_ORDER).toEqual(['free', 'plus', 'pro', 'max']);
    expect(PLAN_ORDER.indexOf('max')).toBe(PLAN_ORDER.length - 1);
    expect(isPricedPlan('max')).toBe(true);
  });

  it('🔴 nothing in the reprice reaches an entitlement path', () => {
    // The price table and the feature matrix are separate structures, and the
    // matrix must not read a price. If it did, repricing a tier would move what
    // that tier can do — which is precisely what must never happen.
    const matrix = PLAN_FEATURES_CODE.slice(
      PLAN_FEATURES_CODE.indexOf('export function getPlanFeatures('),
    ).slice(0, 2000);
    expect(matrix.length, 'the getPlanFeatures slice is empty — this guard would be vacuous')
      .toBeGreaterThan(200);
    expect(matrix).not.toContain('PLAN_PRICING');
    expect(matrix).not.toContain('planPriceUsd');
  });
});

/* ── 9 · the webhook is still the single writer of `plan` ─────────────────── */
describe('9 · nothing writes `plan` from the client — no-regression on #434', () => {
  it('🔴 no client-side plan write came back with the reprice', () => {
    // Reuses THE-291's own detector rather than a second, weaker one. A reprice
    // has no business anywhere near the write path, and this says so.
    const offenders: string[] = [];
    let scanned = 0;
    (function walk(dir: string) {
      for (const e of readdirSync(dir)) {
        if (e === 'node_modules') continue;
        const abs = join(dir, e);
        if (statSync(abs).isDirectory()) { walk(abs); continue; }
        if (!/\.(ts|tsx)$/.test(abs) || /\.test\.tsx?$/.test(abs)) continue;
        if (abs.includes(`${'app'}/api/`)) continue;   // the webhook's own side
        scanned++;
        const found = planWritesIn(readFileSync(abs, 'utf8'));
        if (found.length) offenders.push(`${abs}: ${found.join(', ')}`);
      }
    })(resolve(REPO, 'src'));
    expect(scanned, 'the sweep walked nothing').toBeGreaterThan(200);
    expect(offenders, 'a client-side plan write returned').toEqual([]);
  });

  it('🔴 THE MUTATION — the detector is not vacuous, it catches a planted write', () => {
    // The detector only looks at files that import the client SDK, so the
    // planted source has to carry that import to be a fair mutation.
    const planted = [
      "import { doc, updateDoc } from 'firebase/firestore';",
      "await updateDoc(doc(db, 'tenants', id), { plan: 'max' });",
    ].join('\n');
    expect(planWritesIn(planted), 'a planted client-side plan write was not caught')
      .not.toEqual([]);
    // And it does NOT fire on a file that merely mentions the word.
    expect(planWritesIn([
      "import { doc, updateDoc } from 'firebase/firestore';",
      "await updateDoc(doc(db, 'tenants', id), { planRequested: 'max' });",
    ].join('\n'))).toEqual([]);
  });
});

/* ── 10 · the platform fee ────────────────────────────────────────────────── */
describe('10 · PLATFORM_FEE_MAP is still zero on every tier', () => {
  it('🔴 zero platform donation fees, untouched by the reprice', () => {
    expect(PLATFORM_FEE_MAP).toEqual({ plus: 0, pro: 0, max: 0 });
    for (const plan of PRICED_PLAN_ORDER) {
      expect(PLATFORM_FEE_MAP[plan], `${plan} grew a platform fee`).toBe(0);
    }
  });
});

/* ── Dodo · the window this ticket opened, and THE-344 closed ─────────────── */
describe('the Dodo reprice, which THE-344 completed', () => {
  /** 🔴 WHAT THE LIVE PRODUCTS HOLD, transcribed from the authenticated live
   *  API by THE-344 (`products.retrieve` on each id) rather than derived from
   *  this repo. `live` carried the superseded amounts while THE-343 was out in
   *  front; it is now the same figure the app publishes, which is what makes
   *  asserting the two EQUAL a check rather than a restatement.
   *  ⚠️ MOVED AT THE-372: the founder repriced the three products to $80 /
   *  $216 / $752 in Dodo first and verified them; the app followed. */
  const MINISTRY = {
    monthly: { live: 8000, app: 8000, id: 'pdt_0NlJZMUUiT36FGMoiFXgl' },
    quarterly: { live: 21600, app: 21600, id: 'pdt_0NloCatUWEkEUq1usWJ0n' },
    yearly: { live: 75200, app: 75200, id: 'pdt_0NlJZMXTnpRBAwTfBVpPs' },
  } as const;

  it('🔴 the catalogue derives its price from PLAN_PRICING — no literal to edit', () => {
    // The answer to "what does catalogue.ts need?": NOTHING. Every entry takes
    // its figure from the table, so the reprice moved it with no edit at all.
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        expect(termPriceUsd(plan, term)).toBe(planPriceUsd(plan, term));
        expect(catalogueEntry(plan, term).priceUsd).toBe(planPriceUsd(plan, term));
      }
    }
  });

  it('🔴 the exact minor-unit amounts Dodo now holds, per product id', () => {
    for (const term of BILLING_TERMS) {
      const entry = DODO_LIVE_CATALOGUE.max[term];
      expect(entry.productId, `${term} product id moved`).toBe(MINISTRY[term].id);
      expect(entry.priceMinorUnits, `${term} app-side minor units`).toBe(MINISTRY[term].app);
    }
    expect(BILLING_TERMS.map((t) => DODO_LIVE_CATALOGUE.max[t].priceMinorUnits))
      .toEqual([8000, 21600, 75200]);
  });

  it('🔴 and the window is CLOSED: the app and live Dodo agree on all three', () => {
    // THE-343 opened a real window — the app advertised $60 while Dodo would
    // have charged $80 — and it was harmless only because there are no paying
    // customers on max. THE-344 closed it by repricing the three products and
    // reading them back. This asserts the agreement directly; a partial update,
    // which is the failure mode that actually matters, fails here per term.
    for (const term of BILLING_TERMS) {
      expect(MINISTRY[term].app, `${term} still diverges from live Dodo`)
        .toBe(MINISTRY[term].live);
      expect(DODO_LIVE_CATALOGUE.max[term].priceMinorUnits, `${term} live side`)
        .toBe(MINISTRY[term].live);
    }
  });

  it('the trial and the billing interval are untouched by the reprice', () => {
    // `products.update` replaces the WHOLE price object, so these are the
    // fields that get wiped if they are not resent. THE-344 re-read all three
    // products after the update and confirmed `trial_period_days: 14`,
    // `trial_type: 'free'` and the 1 Month / 3 Month / 1 Year frequencies
    // survived; this is the app-side half of that check.
    for (const term of BILLING_TERMS) {
      expect(DODO_LIVE_CATALOGUE.max[term].trialDays, `${term} trial`).toBe(14);
    }
    expect(DODO_LIVE_CATALOGUE.max.yearly.dodoBillingPeriod).toBe('annual');
    expect(DODO_LIVE_CATALOGUE.max.quarterly.dodoBillingPeriod).toBe('quarterly');
    expect(DODO_LIVE_CATALOGUE.max.monthly.dodoBillingPeriod).toBe('monthly');
  });
});
