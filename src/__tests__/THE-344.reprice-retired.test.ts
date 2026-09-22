/**
 * THE-344 — a divergence record that outlived its divergence.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE DEFECT
 *
 * THE-343 repriced Ministry to $60 / $162 / $564 in `PLAN_PRICING`. It could
 * not reprice Dodo, whose products are edited by hand, so it left a deliberate,
 * self-documenting record of the gap: a second table beside the live fixture,
 * asserted from both sides, and three exclusion branches that lifted the three
 * Ministry products out of the catalogue suite's strict equality check.
 *
 * ⚠️ SUPERSEDED IN ITS FIGURES BY THE-372, which put Ministry back to $80
 * (8000 / 21600 / 75200 minor units, applied in Dodo first). The record this
 * file retires stays retired and no exclusion came back; what moved is the
 * table of live amounts below and the set of SUPERSEDED amounts the prose and
 * code sweeps hunt for.
 *
 * That record was correct on the day it was written. It is not correct now: the
 * three live products have been repriced and read back from the authenticated
 * live API at 6000 / 16200 / 56400, so it described a gap that no longer
 * existed — and, because the three rows were EXCLUDED from the strict check
 * while it stood, it also suppressed the one assertion that would have noticed.
 *
 * ⚠️ AND IT COULD NEVER HAVE SELF-ALERTED. Its docblock promised that "the day
 * the founder updates the three products, those assertions fail". They could
 * not: both halves of every such assertion were fixture literals in the same
 * file, so it compared a transcription against a transcription and stayed green
 * no matter what Dodo did. This is the CARTO shape exactly — a comment true
 * when written that quietly became a lie — and it is why the checks below are
 * value checks over source, not a promise in prose.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ HOW THIS FILE AVOIDS THE WAYS ITS PREDECESSORS FAILED
 *
 * THIRTEEN guards in this series passed a planted defect. Each is answered:
 *
 *   · two read a DOCBLOCK rather than the code — one 700 lines from the gate it
 *     believed it was checking → every CODE assertion here runs over `codeOf()`,
 *     which strips block and line comments, and section 0 proves the stripper
 *     does not eat the files it is pointed at.
 *   · one passed with its own gate DELETED because the assertion's message
 *     contained the string it grepped for → every needle naming the retired
 *     record is ASSEMBLED AT RUN TIME, so this file cannot satisfy its own
 *     sweep by quoting it.
 *   · two were VACUOUS because an empty slice made them trivially true → every
 *     sweep asserts its own population is non-empty, and section 1 proves its
 *     matcher fires on a planted string.
 *   · one measured a whole file where the first match sat above every use →
 *     the live fixture is PARSED out of its own array literal, row by row, and
 *     the row count is itself asserted.
 *
 * 🔴 THE PROSE IS SWEPT TOO, AND SEPARATELY. `codeOf()` is the right reader for
 * "is the gate still in the code"; it is the WRONG reader for "does a comment
 * still claim something untrue", because it deletes exactly the text in
 * question. Section 7 therefore reads the inverse — comments ONLY — over the
 * five files that carried the record. Nothing in this repo swept prose for a
 * stale claim before, and a stale comment is what cost a whole ticket at CARTO.
 *
 * 🔴 NOTHING HERE ASKS WHAT THE CURRENT BRANCH CHANGED. No child process, no
 * version-control invocation, no diff — `#454` is the standing sweep and
 * `THE-315.branch-diff-guards.test.ts` is its detector. No line number is
 * pinned: THE-331 pinned `AdminCommunity.tsx:491`, a deletion shifted it to
 * `:311`, and the suite would have measured whatever landed there. Every line
 * number in THE-344's own description moved when the record was deleted.
 *
 * ⚠️ `firestore.rules` IS DELIBERATELY NOT PINNED HERE. 62 suites already reach
 * the shared accepted-digest register for it on every CI run; a 63rd would add
 * no protection and would cost edits to THE-322's and THE-325's counted
 * populations for a ticket that changes test fixtures only. What section 12
 * does assert is the thing that actually went wrong twice — that THE-344
 * records no `firestore.rules` digest of its own, which is what turned THE-325
 * red for THE-333 and again for THE-341.
 *
 * 🔴 AND THIS DOCBLOCK ONCE SPELLED THAT REGISTER'S MODULE NAME while
 * explaining why it does not use it — which REGISTERED THIS FILE AS A PINNER,
 * because THE-325 counts pinning suites by that substring. Three register
 * assertions went red. It is the docblock-quotes-the-gate hazard exactly, and
 * it landed on the file whose own needles are assembled to avoid it. Recorded
 * rather than quietly fixed: the module is described here, never named.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// `catalogue.ts` consumes the validated `dodoConfig`, so config.ts evaluates on
// import and the three required variables must exist first. Hoisted above the
// static imports below by vitest — the same idiom as dodo-catalogue.test.ts.
// `test_mode` is deliberate: `DODO_LIVE_CATALOGUE` is exported directly and
// does not depend on the active environment, so the live figures are still read
// while nothing here can touch a live-mode code path.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

import { DODO_LIVE_CATALOGUE, DODO_TRIAL_DAYS, termPriceUsd } from '@/lib/dodo/catalogue';
import { BILLING_TERMS, PLAN_PRICING, PRICED_PLAN_ORDER, planPriceUsd } from '@/utils/plan-features';

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');

/**
 * Source with block and line comments stripped — the CODE, not the prose.
 *
 * ⚠️ The `//` arm requires a non-`:` character before the slashes so a
 * `https://` inside a string literal is not read as a comment. That is the bug
 * behind `86bbxkawp`, where an inherited stripper ate ~150 lines of a real file
 * from its first URL onward. Section 0 asserts the damage is bounded on every
 * file this suite reads.
 */
const codeOfString = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const codeOf = (rel: string): string => codeOfString(read(rel));

/**
 * The INVERSE reader: comments ONLY, block and line, with the same `https://`
 * guard. Section 7 is the one sweep in this file that must see the prose,
 * because the claim it hunts lives nowhere else.
 */
const commentsOfString = (src: string): string => {
  const blocks = src.match(/\/\*[\s\S]*?\*\//g) ?? [];
  const lines = src.replace(/\/\*[\s\S]*?\*\//g, '').match(/(?:^|[^:])\/\/.*$/gm) ?? [];
  return [...blocks, ...lines].join('\n');
};
const commentsOf = (rel: string): string => commentsOfString(read(rel));

/**
 * Every single-, double- and backtick-quoted literal, for the third reader
 * section 7 needs: the prose that lives in CODE. A `describe` name, an `it`
 * name and an `expect` message are all read as English by whoever runs the
 * suite, and none of them is visible to a comment reader.
 */
const STRING_LITERAL =
  /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

/** Every TypeScript module under `src/`, the population every sweep runs over. */
const walkSrc = (dir = path.join(REPO_ROOT, 'src')): string[] =>
  readdirSync(dir).flatMap((name) => {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) return walkSrc(abs);
    return /\.tsx?$/.test(abs) ? [path.relative(REPO_ROOT, abs).split(path.sep).join('/')] : [];
  });

const CATALOGUE_SUITE = 'src/lib/dodo/__tests__/dodo-catalogue.test.ts';
const SELF = 'src/__tests__/THE-344.reprice-retired.test.ts';

/**
 * The five files that carried the retired record — three in code, two in prose
 * only. Named explicitly rather than discovered, so a file dropping off the
 * list is a visible edit rather than a silently smaller sweep.
 */
const DIVERGENCE_FILES = [
  CATALOGUE_SUITE,
  'src/lib/dodo/__tests__/dodo-quarterly-term.test.ts',
  'src/utils/__tests__/the-222-repricing.test.ts',
  'src/utils/__tests__/the-248-discount-alignment.test.ts',
  'src/utils/__tests__/the-343-ministry-reprice.test.ts',
] as const;

/**
 * ⚠️ SELF IS DELIBERATELY NOT IN THE LIST ABOVE, and the reason is mechanical
 * rather than a courtesy. Section 7's non-vacuity fixtures ARE the retired
 * prose — they have to be, or the patterns could not be shown to match — and
 * the comment reader is a regex, not a parser, so a `//` inside a string
 * literal reads to it as a comment. Sweeping this file would flag its own
 * evidence. Its hygiene is covered instead by sections 9-11, and THE-315 and
 * THE-325 both exclude themselves from their own sweeps for the same reason.
 */
const READER_FILES = [...DIVERGENCE_FILES, SELF] as const;

/**
 * 🔴 THE NEEDLES, ASSEMBLED AT RUN TIME. Spelling either of these here would
 * plant the very string the sweeps hunt for inside the file that hunts it — the
 * failure that already let one guard in this series pass with its gate deleted.
 */
const RETIRED_RECORD = ['PENDING', 'DODO', 'REPRICE'].join('_');
const RETIRED_DERIVED = ['DODO', 'LIVE', 'IN', 'STEP'].join('_');

/**
 * 🔴 WHAT THE LIVE DODO API RETURNED, per product id — transcribed by THE-344
 * from `products.retrieve` on each of the nine live ids, NOT read off this
 * repo's constants. A test that reads its own subject asserts only that the
 * subject equals itself; this is the independent half.
 *
 * The three Ministry ids were re-read AFTER the reprice and confirmed at these
 * amounts with `trial_period_days: 14`, `trial_type: 'free'`, `currency: USD`,
 * `tax_inclusive: false`, `tax_category: saas` and their billing frequencies
 * (1 Month, 3 Month, 1 Year) unchanged. The six Individual and Small Team
 * products were re-read in the same pass and had not moved.
 */
const LIVE_DODO_MINOR = [
  { plan: 'plus', period: 'monthly', id: 'pdt_0NlJZKKU2AQSSH7E4ziKA', cents: 2000 },
  { plan: 'plus', period: 'quarterly', id: 'pdt_0NloCamoWgvgYDih2UETS', cents: 5400 },
  { plan: 'plus', period: 'yearly', id: 'pdt_0NlJZMLLKZ5SVGEoSGDdk', cents: 19000 },
  { plan: 'pro', period: 'monthly', id: 'pdt_0NlJZMOMhmZWiG6UVDl8I', cents: 4000 },
  { plan: 'pro', period: 'quarterly', id: 'pdt_0NloCaqg1QPMAlkfDnlOe', cents: 10800 },
  { plan: 'pro', period: 'yearly', id: 'pdt_0NlJZMRWL8tuAZseUIRTP', cents: 38000 },
  // ⚠️ MOVED AT THE-372: Ministry back to $80, with the quarter and year at
  // $216 / $752 keeping THE-343's ratios. The founder applied all three in the
  // live Dodo products first and verified them, trial intact.
  { plan: 'max', period: 'monthly', id: 'pdt_0NlJZMUUiT36FGMoiFXgl', cents: 8000 },
  { plan: 'max', period: 'quarterly', id: 'pdt_0NloCatUWEkEUq1usWJ0n', cents: 21600 },
  { plan: 'max', period: 'yearly', id: 'pdt_0NlJZMXTnpRBAwTfBVpPs', cents: 75200 },
] as const;

/** The three Ministry ids, by term — the products THE-344 repriced. */
const MINISTRY = LIVE_DODO_MINOR.filter((p) => p.plan === 'max');
/** The six nobody touched. */
const UNTOUCHED = LIVE_DODO_MINOR.filter((p) => p.plan !== 'max');

/**
 * The live fixture rows, PARSED out of the catalogue suite's own array literal
 * rather than imported — the array is a file-local const, and re-typing it here
 * would make this a copy of the thing it checks instead of a reading of it.
 *
 * ⚠️ Comment-stripped first, and sliced to the LIVE array specifically: the
 * test-mode array above it has the identical row shape and carries deliberately
 * stale amounts, so a sweep of the whole file would read the wrong six rows.
 */
type FixtureRow = { plan: string; period: string; id: string; name: string; cents: number };

const liveFixtureRows = (): FixtureRow[] => {
  const code = codeOf(CATALOGUE_SUITE);
  const open = code.indexOf('const DODO_LIVE_PRODUCTS_AS_VERIFIED = [');
  expect(open, 'the live fixture array is no longer declared under its own name')
    .toBeGreaterThan(-1);
  const close = code.indexOf('\n]', open);
  expect(close, 'the live fixture array is never closed').toBeGreaterThan(open);
  const body = code.slice(open, close);
  const row =
    /\{\s*plan:\s*'([a-z]+)',\s*period:\s*'([a-z]+)',\s*id:\s*'([^']+)',\s*name:\s*'([^']*)',\s*cents:\s*(\d+),/g;
  const out: FixtureRow[] = [];
  for (const m of body.matchAll(row)) {
    out.push({ plan: m[1], period: m[2], id: m[3], name: m[4], cents: Number(m[5]) });
  }
  return out;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 0 — the readers work before anything is asserted with them
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('0 · the comment stripper and its inverse are sound', () => {
  it('🔴 strips comments without eating the code around a URL', () => {
    const sample = [
      "const a = 1; // trailing",
      "/* block\n   spanning */",
      "const url = 'https://example.test/x';",
      'const b = 2;',
    ].join('\n');
    const code = codeOfString(sample);
    expect(code, 'a trailing line comment survived').not.toContain('trailing');
    expect(code, 'a block comment survived').not.toContain('spanning');
    expect(code, 'the stripper ate the code after a URL').toContain("'https://example.test/x'");
    expect(code, 'the stripper ate the line after a URL').toContain('const b = 2;');
  });

  it('🔴 and the inverse keeps the prose and drops the code', () => {
    const sample = ["const a = 1; // trailing", '/* block */', "const u = 'https://x.test';"].join('\n');
    const prose = commentsOfString(sample);
    expect(prose, 'a line comment was lost').toContain('trailing');
    expect(prose, 'a block comment was lost').toContain('block');
    expect(prose, 'a URL was mistaken for a comment').not.toContain('x.test');
  });

  it('🔴 neither reader guts a real file it is pointed at', () => {
    for (const rel of READER_FILES) {
      const raw = read(rel);
      // `86bbxkawp`: an inherited stripper ate ~150 lines from the first URL on.
      // A file that is mostly prose still keeps a substantial body of code.
      expect(codeOf(rel).length, `${rel} was gutted by the stripper`)
        .toBeGreaterThan(raw.length / 8);
      expect(commentsOf(rel).length, `${rel} yielded no prose at all`).toBeGreaterThan(200);
    }
    expect(DIVERGENCE_FILES.length, 'the file list emptied').toBe(5);
    expect(READER_FILES.length, 'the reader list emptied').toBe(6);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — the retired record is gone from every module's CODE
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('1 · the pending-reprice record no longer exists', () => {
  it('🔴 no module under src/ names it in code', () => {
    const modules = walkSrc();
    expect(modules.length, 'the sweep found no modules — it would pass on an empty set')
      .toBeGreaterThan(200);
    const carriers = modules.filter((rel) => codeOf(rel).includes(RETIRED_RECORD));
    expect(carriers, `the retired record is back in code:\n  ${carriers.join('\n  ')}`).toEqual([]);
  });

  it('🔴 nor the list that was derived by excluding the three Ministry rows', () => {
    const carriers = walkSrc().filter((rel) => codeOf(rel).includes(RETIRED_DERIVED));
    expect(carriers, `the exclusion list is back:\n  ${carriers.join('\n  ')}`).toEqual([]);
  });

  it('🔴 and the sweep is not vacuous — it fires on a planted occurrence', () => {
    // The failure mode both needles exist to prevent: a matcher that cannot
    // match, passing forever. Planted in a string, never in this file's prose.
    const planted = `const ${RETIRED_RECORD} = [];\nconst ${RETIRED_DERIVED} = [];`;
    expect(codeOfString(planted).includes(RETIRED_RECORD)).toBe(true);
    expect(codeOfString(planted).includes(RETIRED_DERIVED)).toBe(true);
    // And it reads CODE: the same text inside a comment is not a code carrier.
    expect(codeOfString(`// ${RETIRED_RECORD}`).includes(RETIRED_RECORD)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — all nine live products are in the STRICT equality check
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('2 · no exclusion branch lifts a product out of the strict check', () => {
  it('🔴 the catalogue suite filters nothing out of its live fixture', () => {
    const code = codeOf(CATALOGUE_SUITE);
    expect(code, 'the live fixture is being filtered again')
      .not.toMatch(/DODO_LIVE_PRODUCTS_AS_VERIFIED\s*\.\s*filter/);
    expect(code, 'a row is being skipped inside the strict check')
      .not.toMatch(/\.some\(\s*\(\s*q\s*\)\s*=>\s*q\.id\s*===/);
  });

  it('🔴 every parameterised live check names the FULL fixture', () => {
    const code = codeOf(CATALOGUE_SUITE);
    const overFull = [...code.matchAll(/it\.each\(\s*DODO_LIVE_PRODUCTS_AS_VERIFIED\s*\)/g)];
    // The id-and-price pin, the minor-units check and the app-agreement check.
    expect(overFull.length, 'a live it.each stopped iterating the full fixture')
      .toBeGreaterThanOrEqual(3);
    // And no it.each runs over anything else derived from it.
    const anyEach = [...code.matchAll(/it\.each\(\s*([A-Z_][A-Z0-9_]*)\s*\)/g)].map((m) => m[1]);
    for (const name of anyEach) {
      expect(['DODO_LIVE_PRODUCTS_AS_VERIFIED', 'DODO_TEST_PRODUCTS_AS_VERIFIED'], `it.each runs over ${name}`)
        .toContain(name);
    }
  });

  it('🔴 and the equality really holds for all nine, not just the six', () => {
    for (const { plan, period, id, cents } of LIVE_DODO_MINOR) {
      const entry = DODO_LIVE_CATALOGUE[plan][period];
      expect(entry.productId, `${plan}/${period} product id`).toBe(id);
      expect(entry.priceMinorUnits, `${plan}/${period} minor units`).toBe(cents);
      expect(entry.priceUsd, `${plan}/${period} usd`).toBe(cents / 100);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — the fixture holds what Dodo charges, named per product (THE-372's since)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('3 · the live fixture transcribes what Dodo now charges', () => {
  it('🔴 it still has exactly nine rows, one per live product', () => {
    const rows = liveFixtureRows();
    expect(rows.length, 'the live fixture no longer has nine rows').toBe(9);
    expect(new Set(rows.map((r) => r.id)).size, 'an id is repeated').toBe(9);
  });

  it.each(MINISTRY)('🔴 $id ($plan/$period) is transcribed at $cents', ({ id, cents }) => {
    const row = liveFixtureRows().find((r) => r.id === id);
    expect(row, `${id} is no longer in the live fixture`).toBeDefined();
    expect(row?.cents, `${row?.name ?? id} is transcribed at ${row?.cents}, not ${cents} — ` +
      're-read the product from the live Dodo API before changing this').toBe(cents);
  });

  it('🔴 and the three Ministry rows carry the ids they were read from', () => {
    const rows = liveFixtureRows().filter((r) => r.plan === 'max');
    expect(rows.map((r) => r.id)).toEqual(MINISTRY.map((p) => p.id));
    expect(rows.map((r) => r.cents)).toEqual([8000, 21600, 75200]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — the app and the catalogue agree on every one of the nine
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('4 · all nine prices agree across the app, the catalogue and Dodo', () => {
  it.each(LIVE_DODO_MINOR)(
    '$plan/$period is $cents minor units everywhere',
    ({ plan, period, cents }) => {
      // The table every app surface renders...
      expect(PLAN_PRICING[plan][period], 'PLAN_PRICING').toBe(cents / 100);
      expect(planPriceUsd(plan, period), 'planPriceUsd').toBe(cents / 100);
      // ...the catalogue a checkout cart is built from...
      expect(termPriceUsd(plan, period), 'termPriceUsd').toBe(cents / 100);
      expect(DODO_LIVE_CATALOGUE[plan][period].priceMinorUnits, 'catalogue minor units').toBe(cents);
      // ...and the fixture transcribed from the live API.
      expect(liveFixtureRows().find((r) => r.plan === plan && r.period === period)?.cents,
        'the live fixture').toBe(cents);
    },
  );

  it('🔴 the enumeration really is all nine, not a subset that agrees', () => {
    expect(LIVE_DODO_MINOR.length).toBe(9);
    const covered = new Set(LIVE_DODO_MINOR.map((p) => `${p.plan}/${p.period}`));
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        expect(covered.has(`${plan}/${term}`), `${plan}/${term} is not enumerated`).toBe(true);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — the trial period is still asserted, per product
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('5 · the trial survives, and is still checked', () => {
  it('🔴 every live entry still carries the 14-day trial', () => {
    // 🔴 THE FIELD `products.update` SILENTLY WIPES. It replaces the entire
    // price object, so a reprice that does not resend `trial_period_days`
    // removes the trial and nothing anywhere says so. All three Ministry
    // products were re-read after the update with the trial intact.
    expect(DODO_TRIAL_DAYS).toBe(14);
    for (const { plan, period } of LIVE_DODO_MINOR) {
      expect(DODO_LIVE_CATALOGUE[plan][period].trialDays, `${plan}/${period} trial`).toBe(14);
    }
  });

  it('🔴 and the catalogue suite still ASSERTS it — the check was not dropped', () => {
    // Whitespace-normalised so reformatting does not read as a deletion, and
    // comment-stripped so a docblock describing the check cannot stand in for
    // it. Both forms must survive: the live entries and the test entries.
    const flat = codeOf(CATALOGUE_SUITE).replace(/\s+/g, ' ');
    expect(flat, 'the live trial assertion is gone')
      .toContain('expect(DODO_LIVE_CATALOGUE[plan][period].trialDays).toBe(14)');
    expect(flat, 'the test-mode trial assertion is gone')
      .toContain('expect(catalogueEntry(plan, period).trialDays).toBe(14)');
    expect(flat, 'the constant itself is no longer pinned')
      .toContain('expect(DODO_TRIAL_DAYS).toBe(14)');
  });

  it('🔴 the billing intervals the same update would have replaced are intact', () => {
    expect(DODO_LIVE_CATALOGUE.max.monthly.dodoBillingPeriod).toBe('monthly');
    expect(DODO_LIVE_CATALOGUE.max.quarterly.dodoBillingPeriod).toBe('quarterly');
    expect(DODO_LIVE_CATALOGUE.max.yearly.dodoBillingPeriod).toBe('annual');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — plus and pro were not touched
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('6 · Individual and Small Team are unmoved', () => {
  it.each(UNTOUCHED)('$plan/$period is still $cents at $id', ({ plan, period, id, cents }) => {
    // Nobody repriced these, so a divergence here would mean something else
    // changed — which is why they are enumerated rather than derived.
    expect(DODO_LIVE_CATALOGUE[plan][period].productId).toBe(id);
    expect(DODO_LIVE_CATALOGUE[plan][period].priceMinorUnits).toBe(cents);
    expect(PLAN_PRICING[plan][period]).toBe(cents / 100);
    expect(liveFixtureRows().find((r) => r.id === id)?.cents).toBe(cents);
  });

  it('🔴 and the two tiers still read exactly as they did', () => {
    expect(PLAN_PRICING.plus).toEqual({ monthly: 20, quarterly: 54, yearly: 190 });
    expect(PLAN_PRICING.pro).toEqual({ monthly: 40, quarterly: 108, yearly: 380 });
    expect(UNTOUCHED.length, 'the no-regression set shrank').toBe(6);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 — no COMMENT describes a divergence that no longer exists
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('7 · the prose says nothing the code stopped being true', () => {
  /**
   * Each claim is present-tense about LIVE Dodo. The test-mode divergence in
   * the catalogue suite is real and still described there, so the patterns are
   * chosen not to reach it: they anchor on the hand-edit that closed this gap
   * and on the superseded minor units, neither of which test mode ever used.
   *
   * ⚠️ THE SUPERSEDED UNITS MOVED AT THE-372. Ministry is back at 8000 /
   * 21600 / 75200, so those are CURRENT figures now and cannot be a stale
   * claim; the superseded set is THE-343's (the three it retires) plus
   * THE-248's annual, which never came back.
   */
  const CLAIMS: ReadonlyArray<readonly [RegExp, string]> = [
    [new RegExp(RETIRED_RECORD), 'names the retired record'],
    [/until\s+the\s+founder/i, 'says something waits on the founder'],
    [/founder\s+(?:updates?|must\s+set|has\s+not|changes?\s+it)/i, 'says the founder has still to act'],
    [/not\s+yet\s+(?:in\s+dodo|repriced|made)/i, 'says the reprice has not happened'],
    [/\b(?:is|are)\s+(?:still\s+)?ahead\s+of\s+(?:live\s+)?dodo/i, 'says the app is ahead of Dodo'],
    [/\b(?:6000|16200|56400|76000)\b/, 'restates a superseded Ministry amount'],
  ];

  it.each(DIVERGENCE_FILES)('%s describes no gap that has been closed', (rel) => {
    const prose = commentsOf(rel);
    expect(prose.length, `${rel} yielded no comments — the sweep would pass on nothing`)
      .toBeGreaterThan(200);
    for (const [pattern, why] of CLAIMS) {
      const hit = prose.match(pattern);
      expect(hit?.[0] ?? null,
        `${rel} ${why}: "${hit?.[0] ?? ''}". The three Ministry products were repriced and read ` +
        'back from the live API; a comment that still describes the gap is the CARTO defect.')
        .toBeNull();
    }
  });

  it.each(DIVERGENCE_FILES)('%s names no such gap in a title or a message either', (rel) => {
    // 🔴 A TEST TITLE IS PROSE THAT LIVES IN CODE, so `commentsOf` cannot see
    // it and `codeOf` keeps it. It is read by whoever runs the suite and by
    // whoever reads a CI log, which makes a stale one exactly as misleading as
    // a stale comment — this sweep found `the exact minor-unit amounts the
    // founder must set in Dodo` still standing after the founder had set them.
    const literals = [...codeOf(rel).matchAll(STRING_LITERAL)]
      .map((m) => m[1] ?? m[2] ?? m[3] ?? '');
    expect(literals.length, `${rel} yielded no string literals to sweep`)
      .toBeGreaterThan(20);
    for (const text of literals) {
      for (const [pattern, why] of CLAIMS) {
        const hit = text.match(pattern);
        expect(hit?.[0] ?? null,
          `${rel} ${why} in a title or message: "${text}"`).toBeNull();
      }
    }
  });

  it('🔴 and the claim patterns are not vacuous — each fires on the prose it retired', () => {
    const retired = [
      `/* the divergence is recorded in ${RETIRED_RECORD} below */`,
      '// until the founder updates them by hand',
      '// the founder updates them by hand',
      '// the reprice is not yet in Dodo',
      '// the app is AHEAD of live Dodo on all three',
      '// the live products still hold 6000 / 16200 / 56400',
    ];
    expect(retired.length).toBe(CLAIMS.length);
    for (const [i, [pattern]] of CLAIMS.entries()) {
      expect(commentsOfString(retired[i]), `claim ${i} no longer matches the prose it retired`)
        .toMatch(pattern);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 — no price literal outside the catalogue and the pricing table
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('8 · prices are derived, not restated', () => {
  it('🔴 the superseded Ministry minor units appear in no pricing module', () => {
    // Scoped to the pricing and Dodo surface on purpose: `6000` is a real
    // figure elsewhere in this repo — toast and lookup timeouts carry it — and
    // a repo-wide sweep for it would flag those and be deleted by whoever it
    // blocked. ⚠️ The superseded set moved at THE-372: 8000 / 21600 are
    // Ministry's current units again (see the claim table above).
    for (const rel of [...DIVERGENCE_FILES, 'src/lib/dodo/catalogue.ts', 'src/utils/plan-features.ts']) {
      for (const digits of ['6000', '16200', '56400', '76000']) {
        expect(codeOf(rel), `${rel} still writes the superseded amount ${digits}`)
          .not.toMatch(new RegExp(`(?<![\\w.])${digits}(?![\\w.])`));
      }
    }
  });

  it('🔴 the standing sweep for restated prices is still in place and populated', () => {
    // THE-248 owns it. This asserts it was not weakened while the fixture moved
    // — its population floor and its list of swept figures both survive.
    const code = codeOf('src/utils/__tests__/the-248-discount-alignment.test.ts');
    expect(code, "THE-248's restated-price sweep lost its population floor")
      .toContain('expect(modules.length).toBeGreaterThan(50)');
    expect(code, "THE-248's restated-price sweep stopped naming the figures")
      .toMatch(/it\.each\(\[\s*'54',\s*'108',\s*'216',\s*'190',\s*'380',\s*'760'\s*\]\)/);
  });

  it('🔴 the catalogue still derives every price rather than typing one', () => {
    const code = codeOf('src/lib/dodo/catalogue.ts');
    expect(code, 'catalogue.ts stopped reading the price table').toContain('planPriceUsd');
    for (const { cents } of MINISTRY) {
      expect(code, `catalogue.ts writes ${cents} as a literal — prices derive from PLAN_PRICING`)
        .not.toMatch(new RegExp(`(?<![\\w.])${cents}(?![\\w.])`));
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9-11 — this suite obeys the rules it enforces
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('9-11 · the guards’ own hygiene', () => {
  it('🔴 no test in this ticket pins a LINE NUMBER', () => {
    // THE-331 pinned AdminCommunity.tsx:491; a deletion shifted it to :311 and
    // the suite would have measured whatever landed there. Every line number in
    // THE-344's description moved when the retired record was deleted.
    const code = codeOf(SELF);
    expect(code, 'a path:line locator').not.toMatch(/\.tsx?:\d+/);
    expect(code, 'an indexed line lookup').not.toMatch(/split\(\s*['"]\\n['"]\s*\)\s*\[\s*\d+\s*\]/);
  });

  it('🔴 no fixture in this ticket is pinned to a date near today', () => {
    // #468's turned main red for everyone; THE-324 left one four days out that
    // would have failed SILENTLY. This suite reads files and compares amounts —
    // it constructs no date at all, which is the strongest form of the claim.
    const code = codeOf(SELF);
    expect(code, 'a literal date').not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    expect(code, 'a clock read').not.toMatch(/new Date\(|Date\.now\(/);
  });

  it('🔴 no guard in this PR asserts anything about the current branch’s diff', () => {
    // #454 is the standing sweep and THE-315 is its detector; THE-315's own
    // section 2 once contained exactly this. ⚠️ The needles are ASSEMBLED AT
    // RUN TIME: a guard whose assertion message contains the string it greps
    // for passes with its gate deleted, which has happened once in this series.
    const vcs = ['g', 'i', 't'].join('');
    const proc = ['child', '_', 'process'].join('');
    const code = codeOf(SELF);
    expect(code.includes(proc), 'this suite imports a process spawner').toBe(false);
    expect(code.includes(`${vcs} diff`), 'this suite reads a diff').toBe(false);
    expect(code.includes(['exec', 'Sync'].join('')), 'this suite shells out').toBe(false);
    expect(code.includes(['changed', 'Since'].join('')), 'this suite asks what the branch changed')
      .toBe(false);
  });

  it('🔴 the self-check above is not vacuous — it can see this file', () => {
    expect(codeOf(SELF).length).toBeGreaterThan(2000);
    expect(codeOf(SELF)).toContain('liveFixtureRows');
  });

  it('🔴 every file this ticket touched is LF, not CRLF', () => {
    // THE-268's guard catches it repo-wide; this is the same claim scoped to
    // the files THE-344 rewrote, so a stray CRLF is named here by path.
    for (const rel of READER_FILES) {
      expect(read(rel).includes('\r\n'), `${rel} was written with CRLF endings`).toBe(false);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 12 — the files this ticket must not go near
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('12 · nothing outside the test fixtures moved', () => {
  /**
   * Recorded ONCE, here, by the ticket that must not move them — and
   * deliberately NOT in the shared ownership register, where a `firestore.rules`
   * digest turned THE-325 red for two tickets running.
   */
  const BASELINE = {
    layout: 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f',
    indexes: '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0',
    functionsTree: '1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7',
    compositeIndexes: 10,
  } as const;

  /** Every file under `functions/`, hashed as a tree — a new file is a change. */
  const functionsTree = (): string => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).sort().flatMap((name) => {
        const abs = path.join(dir, name);
        if (statSync(abs).isDirectory()) {
          return name === 'node_modules' || name === 'lib' ? [] : walk(abs);
        }
        return [abs];
      });
    const files = walk(path.join(REPO_ROOT, 'functions'));
    expect(files.length, 'the functions tree walk found nothing').toBeGreaterThan(0);
    return sha256(
      files
        .map((abs) => `${path.relative(REPO_ROOT, abs).split(path.sep).join('/')}:${sha256(readFileSync(abs))}`)
        .join('\n'),
    );
  };

  it('🔴 src/app/layout.tsx is byte-identical', () => {
    expect(sha256(readFileSync(path.join(REPO_ROOT, 'src/app/layout.tsx')))).toBe(BASELINE.layout);
  });

  it('🔴 firestore.indexes.json is byte-identical, and adds no composite index', () => {
    expect(sha256(readFileSync(path.join(REPO_ROOT, 'firestore.indexes.json')))).toBe(BASELINE.indexes);
    const parsed = JSON.parse(read('firestore.indexes.json')) as { indexes?: unknown[] };
    expect(parsed.indexes?.length).toBe(BASELINE.compositeIndexes);
  });

  it('🔴 functions/ is byte-identical, file for file', () => {
    expect(functionsTree()).toBe(BASELINE.functionsTree);
  });

  it('🔴 THE-344 records NO firestore.rules digest in the ownership register', () => {
    // 🔴 THE EXACT MISTAKE THAT TURNED THE-325 RED TWICE. THE-333 recorded one,
    // THE-341 recorded one, and neither ticket went near the file. THE-344 does
    // not either, so it records nothing for it — and the 62 suites that pin
    // `firestore.rules` through the shared module keep doing so untouched.
    const record = JSON.parse(
      read('src/__tests__/__fixtures__/ownership/THE-344.json'),
    ) as { ticket: string; entries: { file: string }[] };
    expect(record.ticket).toBe('THE-344');
    expect(record.entries.map((e) => e.file), 'THE-344 recorded a file it does not own')
      .not.toContain('firestore.rules');
    expect(record.entries.length, 'the register record is empty — it should carry what moved')
      .toBeGreaterThan(0);
  });

  it('🔴 and this ticket adds no dependency — the lockfile is untouched', () => {
    // THE-274 pins the lockfile to an exact length with no append point.
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect(name, 'a dependency name is empty').not.toBe('');
    }
    expect(codeOf(SELF), 'this suite imports something outside the repo and node')
      .not.toMatch(/from\s+'(?!@\/|node:|vitest|\.)/);
  });
});
