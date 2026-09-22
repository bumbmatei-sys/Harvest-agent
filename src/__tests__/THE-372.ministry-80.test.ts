/**
 * THE-372 — Ministry back to $80, and the early-bird label goes.
 *
 * The founder named $80 monthly. The quarter and the year were DERIVED to keep
 * Ministry's existing discount ratios exactly — quarterly 2.7x monthly and
 * annual 9.4x monthly, the ratios THE-343's figures had — which gives $216 and
 * $752. All three were applied to the live Dodo products FIRST and verified;
 * this repo follows Dodo, not the other way round. Individual, Small Team, the
 * add-ons and every cap are untouched.
 *
 * The label: "no early bird price label." In this repo there never was one —
 * the label lived only on the marketing site's Ministry card, and the only
 * occurrence here is the founder's THE-343 brief, quoted in that ticket's own
 * test docblock. This suite sweeps the shipped source and the context files
 * for every spelling anyway, so the app cannot grow one either.
 *
 * WHERE THE PRICE LIVES IN THIS REPO: `PLAN_PRICING` in
 * `src/utils/plan-features.ts` is the only table. Every surface — the plan
 * cards, `/api/plans`, the Dodo catalogue's minor units, the checkout route —
 * derives from it. The marketing site carries its own transcription under a
 * module-scope contract that fails its prerender on any disagreement.
 *
 * GUARD HYGIENE: every content grep runs over parser-stripped source (the
 * shared THE-346 stripper, imported), every self-matching needle is assembled
 * from fragments, nothing shells out or reads the branch's diff, no line
 * number is pinned and no date is used at all.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// `catalogue.ts` reads the validated Dodo config on import; the same idiom as
// dodo-catalogue.test.ts. Test mode: the LIVE catalogue is exported directly
// and does not depend on the active environment.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

import { DODO_LIVE_CATALOGUE, DODO_TRIAL_DAYS, termPriceUsd } from '@/lib/dodo/catalogue';
import { formatCents } from '@/lib/donation-history';
import {
  BILLING_TERMS,
  PLAN_PRICING,
  PRICED_PLAN_ORDER,
  UNLIMITED_CAP,
  formatPlanMonthlyHeadline,
  formatPlanPrice,
  getPlanFeatures,
  planPriceUsd,
  type BillingTerm,
} from '@/utils/plan-features';
import type { TenantPlan } from '@/types/tenant.types';
import { stripComments } from './__fixtures__/the-346-strip-comments';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

/**
 * The three live Ministry products, transcribed from Dodo after the founder
 * repriced them — NOT from `PLAN_PRICING`, so asserting the two equal is a
 * check and not a restatement. Minor units; the unit is in the field name.
 */
const DODO_MINISTRY_LIVE: ReadonlyArray<{ term: BillingTerm; productId: string; priceCents: number }> = [
  { term: 'monthly', productId: 'pdt_0NlJZMUUiT36FGMoiFXgl', priceCents: 8000 },
  { term: 'quarterly', productId: 'pdt_0NloCatUWEkEUq1usWJ0n', priceCents: 21600 },
  { term: 'yearly', productId: 'pdt_0NlJZMXTnpRBAwTfBVpPs', priceCents: 75200 },
];

/** All nine, written out: an equality check against a table derived from
 *  `PLAN_PRICING` could never fail. No row is excluded. */
const ALL_NINE_USD = {
  plus: { monthly: 20, quarterly: 54, yearly: 190 },
  pro: { monthly: 40, quarterly: 108, yearly: 380 },
  max: { monthly: 80, quarterly: 216, yearly: 752 },
} as const;

/* ── the swept tree ───────────────────────────────────────────────────────── */

/** Every non-test TypeScript module under src/ — what renders and what runs. */
function shippedModules(dir = path.join(REPO, 'src')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) {
      return name === '__tests__' || name === '__fixtures__' || name === 'node_modules' ? [] : shippedModules(abs);
    }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [path.relative(REPO, abs).split(path.sep).join('/')];
  });
}

const MODULES = shippedModules();
const CODE = new Map(MODULES.map((rel) => [rel, stripComments(read(rel))]));
/** The context files an agent or a person reads before touching prices. */
const DOCS = ['AGENTS.md', 'CLAUDE.md', 'README.md'];

/* Assembled from fragments, so no file that greps for them can match itself. */
const D = '$';
const RETIRED_DOLLARS: ReadonlyArray<[RegExp, string]> = [
  [new RegExp(`\\${D}${'6'}${'0'}(?!\\d|[.,]\\d)`), 'the retired Ministry month'],
  [new RegExp(`\\${D}${'16'}${'2'}(?!\\d|[.,]\\d)`), 'the retired Ministry quarter'],
  [new RegExp(`\\${D}${'56'}${'4'}(?!\\d|[.,]\\d)`), 'the retired Ministry year'],
  [new RegExp(`\\${D}${'4'}${'7'}(?!\\d|[.,]\\d)`), 'the retired Ministry yearly headline'],
];
const RETIRED_TABLE: RegExp = new RegExp(
  `max\\s*:\\s*(?:Object\\.freeze\\()?\\{\\s*${'month'}ly\\s*:\\s*${'6'}0\\b`,
);
const RETIRED_MINOR = ['6' + '000', '162' + '00', '564' + '00'];

function retiredHits(files: ReadonlyMap<string, string>): string[] {
  const hits: string[] = [];
  for (const [rel, code] of files) {
    for (const [re, why] of RETIRED_DOLLARS) if (re.test(code)) hits.push(`${rel}: ${why}`);
    if (RETIRED_TABLE.test(code)) hits.push(`${rel}: a price table holding the retired Ministry month`);
  }
  return hits;
}

/** Every spelling of an offer label found in either repo, or plausibly next. */
const OFFER_LABELS: readonly string[] = [
  ['early', ' ', 'bird'], ['early', '-', 'bird'], ['early', '', 'bird'], ['early', '_', 'bird'],
  ['found', 'ing price'], ['found', 'ing member'], ['found', 'ers price'], ['found', "er's price"],
  ['laun', 'ch price'], ['laun', 'ch pricing'], ['laun', 'ch offer'], ['laun', 'ch special'],
  ['intro', 'ductory'], ['intro', ' price'], ['intro', ' offer'],
  ['limited', ' time'], ['limited', '-time'], ['special', ' offer'],
  ['promo', ' price'], ['promo', 'tional price'], ['beta', ' price'],
].map((p) => p.join(''));

function offerLabelHits(files: ReadonlyMap<string, string>): string[] {
  const hits: string[] = [];
  for (const [rel, text] of files) {
    const lower = text.toLowerCase();
    for (const label of OFFER_LABELS) if (lower.includes(label)) hits.push(`${rel}: "${label}"`);
  }
  return hits;
}

/* ── 1 ──────────────────────────────────────────────────────────────────────── */
describe('1 · Ministry is $80 monthly, $216 quarterly, $752 annual — and matches Dodo', () => {
  it('in PLAN_PRICING, the one table', () => {
    expect(PLAN_PRICING.max).toEqual({ monthly: 80, quarterly: 216, yearly: 752 });
  });

  it('and every live Ministry product charges exactly that, product id by product id', () => {
    for (const { term, productId, priceCents } of DODO_MINISTRY_LIVE) {
      const entry = DODO_LIVE_CATALOGUE.max[term];
      expect(entry.productId, `${term} product id`).toBe(productId);
      expect(entry.priceMinorUnits, `${term} minor units`).toBe(priceCents);
      expect(planPriceUsd('max', term) * 100, `${term} app side`).toBe(priceCents);
      expect(termPriceUsd('max', term), `${term} catalogue`).toBe(priceCents / 100);
      // The unit crosses to dollars through the one formatter, never by hand.
      expect(formatCents(entry.priceMinorUnits)).toBe(`$${planPriceUsd('max', term)}.00`);
      // All three keep the 14-day free trial.
      expect(entry.trialDays, `${term} trial`).toBe(DODO_TRIAL_DAYS);
    }
    expect(DODO_TRIAL_DAYS).toBe(14);
  });

  it('the quarter and year keep Ministry\'s discount RATIOS exactly — 2.7x and 9.4x', () => {
    // Integer arithmetic, so no float can round a wrong figure into a pass.
    expect(PLAN_PRICING.max.quarterly * 10).toBe(PLAN_PRICING.max.monthly * 27);
    expect(PLAN_PRICING.max.yearly * 10).toBe(PLAN_PRICING.max.monthly * 94);
  });

  it('and the app renders it that way — charged figure and per-month headline', () => {
    expect(formatPlanPrice('max', 'monthly')).toBe('$80/mo');
    expect(formatPlanPrice('max', 'quarterly')).toBe('$216/qtr');
    expect(formatPlanPrice('max', 'yearly')).toBe('$752/yr');
    expect(formatPlanMonthlyHeadline('max', 'quarterly')).toBe('$72');
    // $752 / 12 = $62.6667, CEILED at the cent: never implies less than the bill.
    expect(formatPlanMonthlyHeadline('max', 'yearly')).toBe('$62.67');
  });
});

/* ── 2 ──────────────────────────────────────────────────────────────────────── */
describe('2 · Individual and Small Team are unchanged', () => {
  it('six cells, enumerated, in the table and in the live catalogue', () => {
    expect(PLAN_PRICING.plus).toEqual({ monthly: 20, quarterly: 54, yearly: 190 });
    expect(PLAN_PRICING.pro).toEqual({ monthly: 40, quarterly: 108, yearly: 380 });
    for (const plan of ['plus', 'pro'] as const) {
      for (const term of BILLING_TERMS) {
        expect(DODO_LIVE_CATALOGUE[plan][term].priceMinorUnits).toBe(ALL_NINE_USD[plan][term] * 100);
      }
    }
  });
});

/* ── 3 ──────────────────────────────────────────────────────────────────────── */
describe('3 · no surface shows a Ministry price of $60, $162 or $564', () => {
  it('the sweep reads a real population, parser-stripped', () => {
    expect(MODULES.length, 'the sweep found almost nothing — it is vacuous').toBeGreaterThan(300);
    expect(MODULES).toContain('src/utils/plan-features.ts');
    expect(MODULES).toContain('src/lib/dodo/catalogue.ts');
    expect(MODULES.some((m) => /\.test\.tsx?$/.test(m)), 'a test file is being read as source').toBe(false);
    // Proved on the real table file: its prose names Ministry's retired figures
    // as history nowhere, but it DOES carry `$60` as Individual's three-month
    // comparison, in a comment — which the stripped text must not.
    const sixty = RETIRED_DOLLARS[0][0];
    expect(read('src/utils/plan-features.ts')).toMatch(sixty);
    expect(CODE.get('src/utils/plan-features.ts')).not.toMatch(sixty);
  });

  it('no shipped module prints or holds a retired Ministry figure', () => {
    expect(retiredHits(CODE)).toEqual([]);
  });

  it('and the pricing modules carry none of the retired minor units', () => {
    for (const rel of ['src/utils/plan-features.ts', 'src/lib/dodo/catalogue.ts', 'src/app/api/plans/route.ts']) {
      for (const digits of RETIRED_MINOR) {
        expect(CODE.get(rel), `${rel} writes ${digits}`).not.toMatch(new RegExp(`(?<![\\w.])${digits}(?![\\w.])`));
      }
    }
  });

  it('and no COMMENT in shipped source restates the retired quarter or year', () => {
    // A deliberately RAW read, scoped so it cannot repeat the marketing site's
    // CI failure — which read a TEST file and matched a figure inside a comment
    // explaining it. Non-test modules only, and only $162 and $564: Ministry's
    // retired quarter and year, legitimate nowhere. A stale comment saying
    // Ministry costs $564 is how the next reader restores it.
    const hits = MODULES.filter((rel) => RETIRED_DOLLARS.slice(1, 3).some(([re]) => re.test(read(rel))));
    expect(hits).toEqual([]);
  });

  it('THE MUTATIONS — code is caught, a comment is not by the stripped sweep', () => {
    const one = (src: string) => retiredHits(new Map([['src/planted.ts', stripComments(src)]]));
    expect(one(`// Ministry was ${D}564 a year\nexport const a = 1;`)).toEqual([]);
    expect(one(`export const s = 'Ministry, ${D}564/yr';`)).toHaveLength(1);
    expect(one(`export const s = 'Ministry is ${D}${'6'}0/mo';`)).toHaveLength(1);
    expect(one(`export const t = { max: { ${'month'}ly: ${'6'}0, quarterly: 1, yearly: 2 } };`)).toHaveLength(1);
    expect(one(`export const s = '${D}${'4'}${'7'}/mo';`)).toHaveLength(1);
    // And it does not fire on a figure that merely starts the same way.
    expect(one(`export const s = '${D}600 raised, ${D}1,620, ${D}47.50';`)).toEqual([]);
  });
});

/* ── 4 ──────────────────────────────────────────────────────────────────────── */
describe('4 · no early-bird or equivalent label, in any shipped module or context file', () => {
  it('no spelling appears in stripped code, or anywhere in AGENTS.md, CLAUDE.md or README.md', () => {
    const texts = new Map<string, string>([...CODE, ...DOCS.map((d) => [d, read(d)] as [string, string])]);
    expect(offerLabelHits(texts)).toEqual([]);
  });

  it('THE MUTATION — each spelling THE-343 used is caught, and names its file', () => {
    const at = (code: string) => offerLabelHits(new Map([['src/components/Planted.tsx', code]]));
    expect(at(`<span>${['EARLY', 'BIRD'].join(' ')}</span>`))
      .toEqual([`src/components/Planted.tsx: "${['early', 'bird'].join(' ')}"`]);
    expect(at(`{ ${['early', 'Bird'].join('')}: true }`)).toHaveLength(1);
    expect(at(`'${['Early', 'bird'].join('-')} price'`)).toHaveLength(1);
    expect(at(`'An ${'intro'}ductory offer'`)).toHaveLength(1);
  });
});

/* ── 5 ──────────────────────────────────────────────────────────────────────── */
describe('5 · no crossed-out or "was" price — $80 is the price, not a discount', () => {
  it('no plan-price surface can strike or "was" a figure', () => {
    const surfaces = [
      'src/components/settings/PlanUpgradeSection.tsx',
      'src/components/AdminTenants.tsx',
      'src/app/api/plans/route.ts',
      'src/utils/plan-features.ts',
      'src/lib/dodo/catalogue.ts',
    ];
    for (const rel of surfaces) {
      const code = CODE.get(rel);
      expect(code, `${rel} is not swept`).toBeDefined();
      expect(code, `${rel} strikes a figure`).not.toMatch(/line-through|<s>|<del[\s>]|<strike/);
      expect(code, `${rel} prints a "was" figure`).not.toMatch(/\bwas \$|regular price|originally \$/i);
    }
  });

  it('THE MUTATION — a struck "was $60" is caught', () => {
    const planted = stripComments(`export const X = () => <s className="line-through">was ${D}60</s>;`);
    expect(/line-through|<s>|<del[\s>]|<strike/.test(planted)).toBe(true);
    expect(/\bwas \$/i.test(planted)).toBe(true);
  });
});

/* ── 6 ──────────────────────────────────────────────────────────────────────── */
describe('6 · all nine prices pass the strict equality check — no exclusion', () => {
  it('every cell, against the table written above and the live catalogue', () => {
    let cells = 0;
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        expect(PLAN_PRICING[plan][term], `${plan}/${term}`).toBe(ALL_NINE_USD[plan][term]);
        expect(DODO_LIVE_CATALOGUE[plan][term].priceMinorUnits, `${plan}/${term} live`)
          .toBe(ALL_NINE_USD[plan][term] * 100);
        cells += 1;
      }
    }
    expect(cells).toBe(9);
  });

  it('and the retired exclusion record is not back in any module, test or not', () => {
    // Assembled: the identifier THE-344 retired.
    const retired = ['PENDING', 'DODO', 'REPRICE'].join('_');
    const all = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const abs = path.join(dir, n);
      return statSync(abs).isDirectory() ? all(abs) : /\.tsx?$/.test(n) ? [abs] : [];
    });
    const carriers = all(path.join(REPO, 'src')).filter((abs) => stripComments(readFileSync(abs, 'utf8')).includes(retired));
    expect(carriers).toEqual([]);
  });
});

/* ── 7 ──────────────────────────────────────────────────────────────────────── */
describe('7 · the add-ons are untouched — and this repo carries no add-on price', () => {
  it('the catalogue maps add-ons to meanings and states no figure for any of them', () => {
    const code = CODE.get('src/lib/dodo/catalogue.ts')!;
    // AI Assistant $20, Admin Seat $10, Unlimited Contacts $30 / $360 are
    // quoted by the marketing site and settled in Dodo; none may be copied here.
    for (const cents of ['2000', '1000', '3000', '36000']) {
      expect(code, `catalogue.ts writes an add-on amount ${cents}`).not.toMatch(new RegExp(`(?<![\\w.])${cents}(?![\\w.])`));
    }
  });
});

/* ── 8 ──────────────────────────────────────────────────────────────────────── */
describe('8 · contact and campus caps are unchanged (THE-370)', () => {
  it('contacts 500 / 500 / 2,000 / 4,000; campuses 0 on free, unlimited on every paid tier', () => {
    const caps = (['free', 'plus', 'pro', 'max'] as TenantPlan[]).map((p) => {
      const f = getPlanFeatures(p);
      return [p, f.maxContacts, f.maxChurches];
    });
    expect(caps).toEqual([
      ['free', 500, 0],
      ['plus', 500, UNLIMITED_CAP],
      ['pro', 2_000, UNLIMITED_CAP],
      ['max', 4_000, UNLIMITED_CAP],
    ]);
  });

  it('and an UNKNOWN plan still falls back to plus — closed, never to Ministry', () => {
    expect(getPlanFeatures('not-a-plan' as TenantPlan)).toEqual(getPlanFeatures('plus'));
  });
});

/* ── 10 ─────────────────────────────────────────────────────────────────────── */
describe('10 · AGENTS.md and CLAUDE.md state no price — they point at the table', () => {
  it('neither restates a plan price, old or new, and AGENTS.md names PLAN_PRICING', () => {
    const figures = ['20', '40', '60', '80', '54', '108', '162', '216', '190', '380', '564', '752', '760'];
    for (const doc of ['AGENTS.md', 'CLAUDE.md']) {
      const text = read(doc);
      for (const f of figures) {
        expect(text, `${doc} quotes $${f}`).not.toMatch(new RegExp(`\\$${f}(?![\\d,])`));
      }
    }
    expect(read('AGENTS.md')).toContain('`PLAN_PRICING` for the nine prices');
  });
});

/* ── 12 ─────────────────────────────────────────────────────────────────────── */
describe('12 · this suite obeys the rules it enforces', () => {
  const SELF = stripComments(read('src/__tests__/THE-372.ministry-80.test.ts'));

  it('pins no line number, reads no diff, shells out to nothing, uses no date', () => {
    expect(SELF).not.toMatch(/\.tsx?:\d+['"`]/);
    expect(SELF).not.toMatch(new RegExp(['child', 'process'].join('_')));
    expect(SELF).not.toMatch(new RegExp(['exec', 'Sync'].join('')));
    expect(SELF).not.toMatch(new RegExp(['new ', 'Date'].join('')));
    expect(SELF).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });

  it('carries no emoji and no CRLF', () => {
    const raw = read('src/__tests__/THE-372.ministry-80.test.ts');
    expect(raw).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(raw).not.toContain('\r');
  });
});
