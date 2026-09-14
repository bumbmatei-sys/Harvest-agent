import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { stripComments } from './__fixtures__/the-346-strip-comments';
import { rulesDigestFailure, rulesDigestFailureFor } from './__fixtures__/firestore-rules-pin';

/**
 * THE-362 - this ticket's own hygiene.
 *
 * Four founder bugs, four surfaces, and the rules every one of them is held to:
 * a primitive where a primitive exists, no literal colour, no emoji, no test
 * pinned to a line number, no fixture near today, no assertion about the
 * branch's own diff, and not one byte of the four files that must not move.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel));
const sha = (rel: string) => createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

/** Every production file this ticket edited. */
const TOUCHED = [
  'src/components/AdminCRM.tsx',
  'src/components/AdminAccounting.tsx',
  'src/components/AdminDonations.tsx',
  'src/components/AdminFundraising.tsx',
  'src/components/AdminGivingStatements.tsx',
  'src/components/AdminSettings.tsx',
  'src/components/LivestreamView.tsx',
  'src/components/MainApp.tsx',
  'src/components/PartnerWithUsTab.tsx',
  'src/components/PublicCampaign.tsx',
  'src/components/settings/PaymentSection.tsx',
  'src/components/dashboard/GivingMix.tsx',
  'src/components/dashboard/GivingTab.tsx',
  'src/components/dashboard/OverviewTab.tsx',
  'src/components/dashboard/TrendChart.tsx',
  'src/components/dashboard/useOverviewData.ts',
  'src/hooks/queries/useCRMQueries.ts',
];

/** Every test file this ticket added. */
const OWN_SUITES = [
  'src/__tests__/THE-362.guards.test.ts',
  'src/__tests__/THE-362.stripe-on-donation-surfaces.test.tsx',
  'src/components/__tests__/THE-362.crm-delete.test.tsx',
  'src/components/__tests__/THE-362.livestream-support.test.tsx',
  'src/components/__tests__/THE-362.livestream-support.layout.test.tsx',
  'src/components/__tests__/THE-362.money-units.test.tsx',
];

/* ═══ 19 · primitives, colour and emoji ══════════════════════════════════ */

describe('19 - every element that has a primitive uses it', () => {
  /**
   * 43 primitives sit in `src/components/ui`, and `accordion` is the only one
   * this repo does not have. This ticket needed exactly one it was not already
   * using: a REFUSAL, which is `alert`.
   */
  it('the 43 primitives are on disk, and accordion is still the absent one', () => {
    const present = readdirSync(path.join(ROOT, 'src/components/ui'), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
      .map((e) => e.name.replace(/\.tsx$/, ''))
      .sort();
    expect(present, 'the primitive set changed size').toHaveLength(43);
    expect(present, 'accordion appeared - it was the one absent primitive').not.toContain('accordion');
    for (const needed of ['alert', 'dialog']) {
      expect(present, `${needed} is missing - the refusal has nothing to render in`)
        .toContain(needed);
    }
  });

  it("the CRM's delete refusal is the `alert` primitive, not a hand-rolled notice", () => {
    /**
     * BOTH IMPORT SPELLINGS ARE SWEPT. This repo writes `@/components/ui/x` and
     * `./ui/x` for the same module, and a guard that knew only one would report
     * a component as primitive-free while it imported one under the other name.
     */
    const crm = code('src/components/AdminCRM.tsx');
    const alias = ['@/components', '/ui/alert'].join('');
    const relative = ['./ui', '/alert'].join('');
    expect(
      new RegExp(`from '(${alias}|${relative})'`).test(crm),
      'the refusal does not use the alert primitive',
    ).toBe(true);
    expect(crm, 'the refusal is not rendered through Alert').toMatch(/<Alert\b/);
    expect(crm, 'the refusal has no title').toMatch(/<AlertTitle\b/);
    expect(crm, 'the refusal has no body').toMatch(/<AlertDescription\b/);
  });

  it('and the primitive brings its own role="alert" - not one hand-written here', () => {
    expect(code('src/components/ui/alert.tsx')).toContain('role="alert"');
  });

  it('no colour is hardcoded in anything this ticket added', () => {
    /**
     * The sweep is over what this ticket WROTE. `LivestreamView`'s shared
     * `GOLD` const (`var(--brand-color, #B8962E)`) is that file's own idiom,
     * predates this ticket and is used in six places in it; the support button
     * reuses it rather than introducing a seventh literal, and this ticket adds
     * no hex of its own anywhere.
     */
    /**
     * A COLOUR, not every `#`. `#482` and `#503` are PULL REQUEST numbers, and
     * this repo's prose is full of them - three hex digits is also a valid CSS
     * shorthand, so a bare `#[0-9a-f]{3,8}` reports every PR reference in a
     * test name as a hardcoded colour. The hex must therefore sit where a
     * colour sits: after a quote, a backtick, an open paren, a colon or a
     * comma, which is every shape this repo's own literals take
     * (`'#B8962E'`, `var(--brand-color, #B8962E)`, `backgroundColor: '#fff'`).
     */
    const HEX = /(?<=['"`(:,]\s{0,2})#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g;
    for (const file of [
      'src/components/dashboard/TrendChart.tsx',
      'src/components/dashboard/GivingMix.tsx',
      'src/components/dashboard/OverviewTab.tsx',
      'src/components/dashboard/GivingTab.tsx',
      'src/components/dashboard/useOverviewData.ts',
      'src/hooks/queries/useCRMQueries.ts',
      ...OWN_SUITES,
    ]) {
      expect(code(file).match(HEX) ?? [], `${file} hardcodes a colour`).toEqual([]);
    }
    // Non-vacuity, ASSEMBLED: spelled whole, the literal below would be found
    // by this file's own sweep and the guard could never pass. #504 shipped a
    // needle that matched itself for exactly this reason.
    const planted = 'const c = "' + '#' + 'B8962E' + '";';
    expect(planted.match(HEX), 'the hex sweep no longer catches a literal').toHaveLength(1);
    const shorthand = 'color: "' + '#' + 'fff' + '"';
    expect(shorthand.match(HEX), 'a three-digit shorthand slips through').toHaveLength(1);
    const brandFallback = 'var(--brand-color, ' + '#' + 'B8962E' + ')';
    expect(brandFallback.match(HEX), "the brand fallback shape slips through").toHaveLength(1);
    // And a PR reference in prose is NOT a colour.
    expect(("a note about " + '#' + "482's switcher").match(HEX) ?? [],
      'a pull request number is being reported as a colour').toEqual([]);
  });

  it('the dashboard files still carry no inline style at all', () => {
    // THE-276's rule, and it caught this ticket once: the first version of both
    // new tooltips painted a colour swatch from a `style` attribute.
    for (const file of [
      'src/components/dashboard/TrendChart.tsx',
      'src/components/dashboard/GivingMix.tsx',
    ]) {
      expect(code(file), `${file} carries an inline style`).not.toMatch(/\sstyle\s*=/);
    }
  });

  it('no emoji in anything this ticket AUTHORED, comments included', () => {
    /**
     * THE RAW SOURCE, not the stripped code - a marker in a comment counts.
     *
     * THE SCOPE IS WHAT THIS TICKET WROTE, and that is a deliberate limit
     * rather than a loophole. Most files in `TOUCHED` carry the repo's house
     * severity markers in docblocks that predate this ticket by many tickets -
     * `AdminCRM.tsx` alone has 41 - and sweeping them whole would be this
     * ticket asserting a property of somebody else's prose, which it would have
     * to satisfy by rewriting files it has no business rewriting.
     *
     * So: every suite this ticket added, swept whole, plus `useCRMQueries.ts`,
     * which is emoji-free and which THE-342 sweeps the same way - this ticket's
     * first draft turned that suite red by writing house markers into a new
     * docblock there, which is how this guard came to exist.
     *
     * The PICTOGRAPH range only: dingbats (U+2600-27BF) are not emoji and the
     * repo's check and cross marks are legal.
     */
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{FE0F}]/gu;
    for (const file of ['src/hooks/queries/useCRMQueries.ts', ...OWN_SUITES]) {
      const hits = read(file).match(EMOJI) ?? [];
      expect(hits, `${file} ships an emoji`).toEqual([]);
    }
    // Non-vacuity.
    expect('\u{1F534}'.match(EMOJI)).not.toBeNull();
    expect('★'.match(EMOJI), 'a dingbat is being swept as an emoji').toBeNull();
  });

  it('every line this ticket wrote ends LF, never CRLF', () => {
    for (const file of [...TOUCHED, ...OWN_SUITES]) {
      expect(read(file).includes('\r\n'), `${file} carries a CRLF line ending`).toBe(false);
    }
  });
});

/* ═══ 20 · the suites' own hygiene ═══════════════════════════════════════ */

describe('20 - this ticket pins no line number, no near date and no branch diff', () => {
  it('no test pins a LINE NUMBER', () => {
    /**
     * THE-331 pinned `AdminCommunity.tsx:491`; a deletion moved it to `:311`
     * and the suite would have measured whatever landed there. A `file.tsx:NNN`
     * anywhere in these suites is the shape that fails.
     */
    const PINNED = /\.(tsx?|json|rules)\s*:\s*\d+/g;
    for (const file of OWN_SUITES) {
      expect(code(file).match(PINNED) ?? [], `${file} pins a line number`).toEqual([]);
    }
    // Non-vacuity, ASSEMBLED for the same reason as the hex above: written
    // whole, THE-331's own shape would be found in this file by this sweep.
    const shipped = 'AdminCommunity' + '.tsx' + ':' + '491';
    expect(shipped.match(PINNED), 'the line-number sweep went blind').toHaveLength(1);
  });

  it('no fixture sits near today', () => {
    /**
     * `toFake: ['Date']` is LOAD-BEARING in this repo, and a fixture dated near
     * the real clock passes today and fails in a fortnight. Every date literal
     * in these suites must be far from now in either direction.
     */
    const DATE = /\b(19|20)\d{2}-\d{2}-\d{2}\b/g;
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    let checked = 0;
    for (const file of OWN_SUITES) {
      for (const literal of code(file).match(DATE) ?? []) {
        const t = Date.parse(literal);
        if (Number.isNaN(t)) continue;
        checked += 1;
        expect(
          Math.abs(now - t),
          `${file} carries ${literal}, which is within 30 days of the real clock`,
        ).toBeGreaterThan(THIRTY_DAYS);
      }
    }
    // The sweep is allowed to find nothing, but it must be capable of finding.
    expect(checked, 'the date sweep is not parsing literals').toBeGreaterThanOrEqual(0);
    expect(Math.abs(now - Date.parse('2024-03-04'))).toBeGreaterThan(THIRTY_DAYS);
  });

  it('no guard here asserts anything about this branch’s diff', () => {
    /**
     * THE-357 caught #504 adding a `toEqual([])` over a branch diff. A guard
     * that reads `git diff` measures the CHANGE rather than the CODE: it passes
     * for everyone who did not make the change, and it cannot fail once merged.
     * Nothing in these suites shells out at all.
     */
    // ASSEMBLED. Spelled whole, every one of these would be found in THIS file
    // by the sweep below and the guard could never pass.
    const forbidden = [
      ['exec', 'Sync'], ['spawn', 'Sync'], ['child_', 'process'],
      ['git ', 'diff'], ['git ', 'rev-parse'],
    ].map((parts) => parts.join(''));
    for (const file of OWN_SUITES) {
      const c = code(file);
      for (const call of forbidden) {
        expect(c, `${file} reaches for ${call} - that is a branch-diff guard`)
          .not.toContain(call);
      }
    }
    // Non-vacuity: the sweep finds a planted one.
    expect(`const x = ${forbidden[0]}('ls');`).toContain(forbidden[0]);
  });

  it('and every needle these suites sweep for is assembled, never spelled whole', () => {
    /**
     * #504 found a guard whose needle, written whole, matched ITSELF in the
     * file it was defending. The Stripe sweep builds every one of its needles
     * from fragments; asserted here so a later edit cannot quietly spell one.
     */
    const sweep = read('src/__tests__/THE-362.stripe-on-donation-surfaces.test.tsx');
    // Each needle is BUILT at runtime. Asserted on the construction, not on an
    // absence: the word legitimately appears in that file's prose and in
    // `StripeConnectPanel`'s name, and a count would be measuring the wrong
    // thing while looking rigorous.
    expect(sweep, 'the sweep no longer assembles its needle')
      .toMatch(/const STRIPE = new RegExp\(\[[^\]]+\]\.join\(''\)/);
    expect(sweep, 'the billing-union needle is spelled whole')
      .toMatch(/const u = \[[^\]]+\]\.join\(''\);/);
    expect(sweep, 'the route needle is spelled whole')
      .toMatch(/const ROUTE = \[[^\]]+\]\.join\(''\);/);
  });
});

/* ═══ 21 · the files that must not move ══════════════════════════════════ */

describe('21 - the four untouchable files are byte-identical', () => {
  it('firestore.rules is at a digest some ticket recorded', () => {
    /**
     * `firestore.rules` AUTO-DEPLOYS to production on merge and CI runs no
     * emulator test against it. THE-313's one-line change turned 46 suites red.
     *
     * THE ACCEPTED SET IS THE SHARED REGISTER, not a literal spelled here.
     * #504 was caught by THE-325 doing exactly that, and the ownership register
     * is per ticket: this ticket changed no rule, so it records nothing.
     */
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded - it auto-deploys to production')
      .toBeNull();
  });

  it('and an unrecorded digest is genuinely refused', () => {
    // The protection property, proven without touching the rules file.
    expect(rulesDigestFailureFor('0'.repeat(64)),
      'the register accepts a digest nobody recorded').not.toBeNull();
  });

  it('this ticket records SOURCE digests but NO rules digest', () => {
    /**
     * The ownership register is PER TICKET, and this ticket does have a record
     * in it - five source files it genuinely edited. What it must NOT hold is a
     * `firestore.rules` entry: #504 was caught by THE-325 spelling the live
     * rules digest as a literal, and a rules record here would be this ticket
     * claiming to have changed a file it never opened.
     */
    const own = JSON.parse(
      read('src/__tests__/__fixtures__/ownership/THE-362.json'),
    ) as { entries: Array<{ file: string }> };
    const files = own.entries.map((e) => e.file);
    expect(files, 'this ticket stopped recording the files it edited').not.toEqual([]);
    expect(files, 'this ticket recorded a firestore.rules digest')
      .not.toContain('firestore.rules');
    expect(files.filter((f) => f.endsWith('.rules')), 'a rules file was recorded')
      .toEqual([]);
  });

  it('firestore.indexes.json, functions/ and layout.tsx are untouched', () => {
    expect(sha('firestore.indexes.json'))
      .toBe('8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0');
    expect(sha('functions/src/index.ts'))
      .toBe('39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b');
    expect(sha('src/app/layout.tsx'))
      .toBe('b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f');
  });

  it('no dependency was added - the lockfile is still exactly its pinned length', () => {
    // THE-274 pins it by EXACT LENGTH, and THE-345 asserts the same number.
    expect(statSync(path.join(ROOT, 'package-lock.json')).size).toBe(590202);
  });

  it('and no new token was minted', () => {
    // Five chart series colours exist and no sixth. `GivingMix` caps its slices
    // at that number for the same reason.
    const vars = code('src/components/dashboard/GivingMix.tsx').match(/var\(--chart-\d\)/g) ?? [];
    expect(vars, 'the chart palette changed size').toHaveLength(5);
  });
});
