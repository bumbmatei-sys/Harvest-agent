// @vitest-environment node
//
// Nothing here needs a DOM. Every question is answered from SOURCE ON DISK or
// from a module import; the one question that needs a layout engine — "how tall
// is that button" — lives in `THE-357.admin-sms-controls.layout.test.tsx`, in
// real Chromium. `happy-dom` has no layout engine, so a source-only test would
// pass on a broken button.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { stripComments } from './__fixtures__/the-346-strip-comments';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';
import { ownershipFailure } from './__fixtures__/ownership-register';

/**
 * THE-357 — three things reported and never swept.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS TICKET IS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three small, unrelated fixes, bundled because each is a few lines and none
 * touches the others' files:
 *
 *   1. `THE-311.course-palette.test.ts` §8 read the current branch's diff and
 *      its premise expired when THE-311 landed in #447.
 *   2. The giving share sheet still promised card giving was "coming soon".
 *   3. `AdminSms`'s five Buttons measured 25.38–36.25px above `sm`, under
 *      Rule 4's 38px floor — measured by #500 and deliberately not swept.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE FINDING THAT IS WORTH MORE THAN ANY OF THE THREE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * #454 (`THE-315.branch-diff-guards.test.ts`) is a STANDING SWEEP against the
 * expiring-branch-diff-guard pattern, and it has now missed two instances —
 * THE-315 §2 (found by #482) and THE-311 §8 (found by #496), both by an agent
 * doing unrelated work. The known blind spot, card `86bbvhaky`, is that its
 * detector needs the read and the `execFileSync` in ONE declaration, so a read
 * one call away slips through.
 *
 * 🔴 CLOSING THAT BLIND SPOT WOULD NOT HAVE CAUGHT THE-311 §8, and section 3
 * below establishes it by behaviour rather than by reading. The blind spot is
 * in the BINDING step. §8's three assertions fail at the DIRECTION step, which
 * is a separate and larger hole:
 *
 *   · #454's `NON_EMPTY` matches `toContain`, `toMatch`, `toBeGreaterThan`,
 *     `not.toEqual([])` and `not.toHaveLength(0)`. §8's three assertions are
 *     all `toEqual([])` — the EMPTY direction — and #454's header says so
 *     deliberately: "EMPTY … a freeze. It gets MORE true when the ticket
 *     merges, never less, so it cannot expire … Not flagged."
 *   · THE-322's stronger dataflow version asserts it outright, on a planted
 *     sample: "a freeze was flagged, and a freeze is not the defect".
 *
 * ⚠️ THAT PREMISE IS WRONG, AND THE REPO ALREADY KNEW IT TWICE OVER. A
 * diff-based freeze does not get more true when its ticket merges; it gets
 * BROADER, and into a claim its ticket never made. "THE-311 did not modify
 * `AdminCourseEditor.tsx`" is about THE-311's branch; from #447 the same
 * expression means "no branch may ever modify `AdminCourseEditor.tsx`". Two
 * later tickets retired exactly this shape by hand and wrote down why:
 *
 *   · THE-338, in THE-311 §5 — "It read `changed('src/app/globals.css', …)`
 *     must be empty — an assertion about whatever branch is running, so it goes
 *     red on any later PR that legitimately edits the palette."
 *   · THE-319, in THE-311's `ui/progress` section — "What is replaced is
 *     `changed(the-272 guard) === []`. That was a claim about the current
 *     branch's DIFF, and it is the shape THE-315 (#454) exists to catch."
 *
 * 🔴 THAT LAST SENTENCE IS THE CONTRADICTION IN ONE LINE: THE-319 believed #454
 * catches an empty-direction diff freeze. It does not, and never has.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE COST, WHICH IS WHY CLOSING IT IS ITS OWN TICKET
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Section 3 runs the detector #454 would need and pins what it finds:
 * TWENTY-THREE assertions across FIVE suites, after this ticket removed three.
 * They are not interchangeable and cannot be swept in a batch — each needs the
 * same judgement THE-338 and THE-319 each applied once:
 *
 *   · Some are genuinely branch-scoped and CORRECT, and retiring them would be
 *     the bug. `THE-311`'s `touched.filter((f) => !SWEPT.includes(f))` says
 *     "every course source file THIS branch changed is in the swept set", which
 *     is true and useful on every branch forever.
 *   · Some have an obvious content replacement (`changed('src/components/ui/')`
 *     is already covered by the primitive digest ledgers).
 *   · Some have none, and the honest outcome is retirement — which #450 and
 *     #453 both reached, and which this ticket reached for one of the three.
 *
 * ⚠️ SO THE OUTCOME HERE IS A REPORT WITH A PIN, NOT A REWRITE. #454's detector
 * is NOT changed by this ticket: widening its direction would light up
 * twenty-three findings it has no register for and turn `main` red for
 * everyone, which is the exact failure this whole series exists to stop. The
 * finding is pinned instead, so the count cannot grow quietly and the ticket
 * that takes it inherits the list rather than rediscovering it.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
/** 🔴 THE PARSER-BASED STRIPPER (#496), IMPORTED AND NEVER COPIED. The regex one
 *  it replaced ate 154 lines of one file, 85 of them code, across 89 files. */
const code = (rel: string) => stripComments(read(rel));
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Every production file THE-357 edits. Three, and the list is the claim. */
const EDITED_SOURCE = [
  'src/components/donations/giving-share.ts',
  'src/components/donations/GivingShareSheet.tsx',
  'src/components/AdminSms.tsx',
] as const;

/** Every suite THE-357 adds. */
const ADDED_SUITES = [
  'src/__tests__/THE-357.guards.test.ts',
  'src/components/__tests__/THE-357.admin-sms-controls.layout.test.tsx',
] as const;

const THE311 = 'src/components/course/__tests__/THE-311.course-palette.test.ts';
const THE315 = 'src/__tests__/THE-315.branch-diff-guards.test.ts';
const THE322 = 'src/__tests__/THE-322.ownership-register.test.ts';
const SHARE = 'src/components/donations/giving-share.ts';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — THE-311 §8 no longer asserts anything about the current branch's diff
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * §8's boundaries, found by its own heading rather than by a line number.
 *
 * 🔴 NOT `THE311:534`. THE-331 pinned `AdminCommunity.tsx:491` and a deletion
 * shifted that surface to `:311`, so the suite would have measured whatever
 * landed there instead of failing.
 */
function sectionEight(): string {
  const src = code(THE311);
  const start = src.indexOf("describe('8 ");
  const end = src.indexOf("describe('9 ", start);
  if (start === -1 || end === -1) {
    throw new Error('THE-311 §8 could not be located by its heading — it was renamed or removed');
  }
  return src.slice(start, end);
}

describe('1 · THE-311 §8 asserts nothing about the current branch’s diff', () => {
  it('the section is still there to be checked', () => {
    // A locator that silently found nothing would make every claim below
    // vacuous — the shape #492 found three of in one PR.
    const s = sectionEight();
    expect(s.length, '§8 collapsed to nothing').toBeGreaterThan(400);
    expect(s, '§8 stopped being about THE-305’s header').toContain('THE-305');
  });

  it('\u{1F534} it reads neither the diff helper nor the diff list', () => {
    /* ⚠️ Both names, because this file's own diff read is a two-step: `CHANGED`
       is the list and `changed(...)` is the prefix filter over it. A section
       that called either is asking what the current branch touched. */
    const s = sectionEight();
    expect(s, '§8 calls `changed(...)` again — that is a read of this branch’s diff')
      .not.toMatch(/(^|[^.\w$-])changed\s*\(/);
    expect(s, '§8 reads CHANGED again').not.toMatch(/(^|[^.\w$-])CHANGED([^\w$-]|$)/);
    expect(s, '§8 reads the one-hop `touched` binding again')
      .not.toMatch(/(^|[^.\w$-])touched([^\w$-]|$)/);
  });

  it('and the rest of the file still has a diff read, so the check is not passing on an empty file', () => {
    // 🔴 NON-VACUITY. If THE-311 stopped reading the diff altogether the
    // assertions above would be trivially true. It still does, in §5-§7, §10
    // and §13 — and one of those is the registered, base-ref-gated assertion
    // #454 knows about.
    expect(code(THE311), 'THE-311 no longer reads the diff at all — §8’s claim proves nothing')
      .toMatch(/(^|[^.\w$-])changed\s*\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — its intent is preserved in the fixed shape, or honestly retired
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · §8’s three claims survive, by content', () => {
  /**
   * Each row: what §8 claimed, and the assertion that now owns it. Every one is
   * RE-EXPRESSED; none is retired, because each had a real content property
   * underneath it. The register is here rather than in prose so a claim cannot
   * be dropped quietly.
   */
  const CLAIMS: ReadonlyArray<readonly [claim: string, anchor: string]> = [
    [
      'THE-311 did not modify THE-305’s header (was: the editor is not in this branch’s diff)',
      "expect(editor, 'the editor stopped publishing THE-305\\'s header through the shared API')",
    ],
    [
      'the migration never reached the editor (was: the same diff read)',
      ".not.toContain('course.constants')",
    ],
    [
      'THE-305’s measured-geometry suite still measures (was: it is byte-identical to the base)',
      "expect(layout, 'THE-305 stopped measuring at all five widths')",
    ],
    [
      'exactly ONE THE-305 guard carries THE-311’s amendment (was: the diff holds no other THE-305 file)',
      "expect(guards.filter((f) => src(f).includes('AMENDED BY THE-311')),",
    ],
    [
      'and the amendment kept THE-305’s own claim rather than deleting it',
      "expect(guard, 'the amendment is not recorded with its ticket').toContain('AMENDED BY THE-311');",
    ],
  ];

  it.each(CLAIMS.map((r) => [r[0], r[1]] as const))('%s', (_claim, anchor) => {
    expect(sectionEight(), `the assertion that owns this claim is gone from §8:\n  ${anchor}`)
      .toContain(anchor);
  });

  it('\u{1F534} and each of them is answerable on ANY branch, which is the whole point', () => {
    /* The four files §8 now reads are all on disk on every branch, so the
       section has an answer whether or not this PR opened any of them —
       which is precisely what the diff read could not manage. */
    for (const rel of [
      'src/components/AdminCourseEditor.tsx',
      'src/components/__tests__/THE-305.course-editor-header.layout.test.tsx',
      'src/components/__tests__/THE-305.course-editor-header.test.tsx',
    ]) {
      expect(statSync(path.join(ROOT, rel)).isFile(), `${rel} is gone`).toBe(true);
    }
    // And the amendment marker really is on exactly one THE-305 guard, so the
    // discovery is doing work rather than describing an empty set.
    const guards = readdirSync(path.join(ROOT, 'src/components/__tests__'))
      .filter((f) => f.startsWith('THE-305.'));
    expect(guards.length, 'THE-305’s guards vanished').toBeGreaterThanOrEqual(3);
    expect(guards.filter((f) => read(`src/components/__tests__/${f}`).includes('AMENDED BY THE-311')))
      .toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — would #454 catch it once the blind spot is closed?  NO.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 EVERY NEEDLE BELOW IS ASSEMBLED FROM FRAGMENTS.
 *
 * This sweep runs over EVERY suite in the repo, including its own file, and
 * both it and #454's detector read source with STRING LITERALS INTACT. A
 * literal here would bind every identifier downstream of it to a "diff read"
 * and the sweep would flag its own furniture — and #496 found two of its own
 * guards self-matching for exactly this reason. A guard that fails merely
 * because it SPELLS the thing it forbids is a guard nobody can write.
 */
const DIFF_READ = new RegExp(
  ["['\"`]di" + "ff['\"`]", 'gi' + 't diff', '--name' + '-only', '--diff' + '-filter',
    "ls-" + "files['\"`]?\\s*,\\s*['\"`]--oth" + "ers", 'gi' + 't status'].join('|'),
);

/** A seed also has to RUN git, not just talk about it — #454's own rule. */
const RUNS_GIT = /exec(?:File)?Sync\s*\(/;

/** The EMPTY direction — the one #454 and THE-322 both deliberately exclude. */
const EMPTY_MATCHERS = ['.to' + 'Equal([])', '.to' + 'HaveLength(0)'];

/**
 * #454's NON-EMPTY direction, spelled here so the two can be compared
 * BEHAVIOURALLY rather than by reading its header.
 *
 * ⚠️ It is a COPY, and the last case in this section is what stops it drifting:
 * #454's own regex literal must still spell each of these, or this comparison
 * is measuring a detector that no longer exists.
 */
const NON_EMPTY_MATCHERS = [
  '.to' + 'Contain(', '.to' + 'Match(', '.toBe' + 'GreaterThan(',
  '.not.to' + 'Equal([])', '.not.to' + 'HaveLength(0)',
];

/**
 * String literals blanked, newlines and length preserved — #454's own step, and
 * not cosmetic: `changed` is a bound name in one suite AND an ordinary English
 * word, so `expect(sha, `${rel} changed`)` reads as a reference to it and that
 * one match once spread a binding across three suites.
 */
function blankStrings(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) if (out[i] !== '\n') out[i] = ' ';
  };
  for (let i = 0; i < src.length; i += 1) {
    const q = src[i];
    if (q !== "'" && q !== '"' && q !== '`') continue;
    let j = i + 1;
    let run = i + 1;
    for (; j < src.length; j += 1) {
      if (src[j] === '\\') { j += 1; continue; }
      if (q === '`' && src[j] === '$' && src[j + 1] === '{') {
        blank(run, j);
        let depth = 1;
        j += 2;
        while (j < src.length && depth > 0) {
          if (src[j] === '{') depth += 1;
          else if (src[j] === '}') depth -= 1;
          j += 1;
        }
        run = j;
        j -= 1;
        continue;
      }
      if (src[j] === q) break;
      if (q !== '`' && src[j] === '\n') break;
    }
    blank(run, Math.min(j, src.length));
    i = j;
  }
  return out.join('');
}

/** The whole declaration statement at `i`, read by balancing delimiters. */
function statementAt(lines: readonly string[], i: number): string {
  let depth = 0;
  const out: string[] = [];
  for (let n = i; n < lines.length && n < i + 40; n += 1) {
    out.push(lines[n]);
    for (const ch of lines[n]) {
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth -= 1;
    }
    if (depth <= 0 && /[;}]\s*$/.test(lines[n])) return out.join('\n');
    if (depth <= 0 && n > i && lines[n].trim() === '') return out.join('\n');
  }
  return lines[i];
}

const refers = (id: string, text: string) =>
  new RegExp(`(^|[^.\\w$-])${id}([^\\w$-]|$)`).test(text);

/**
 * #454's DETECTOR, RE-IMPLEMENTED WITH ONE VARIABLE EXPOSED: the direction.
 *
 * 🔴 EVERYTHING ELSE IS ITS OWN — the same `DIFF_READ` markers, the same
 * "a seed must also RUN git" rule, the same string blanking, the same
 * declaration statement, the same ONE HOP and no more. That is deliberate and
 * it is the whole experiment: with the dataflow held fixed, the only thing
 * standing between #454 and THE-311 §8 is which matchers it looks for.
 *
 * ⚠️ SO THIS IS NOT A SECOND SWEEP AND MUST NOT BECOME ONE. #454 keeps the
 * NON-EMPTY half and its register; this exists to MEASURE the other half and
 * report it. See the file header for why widening #454 itself is its own
 * ticket.
 */
export function branchDiffAssertions(
  src: string,
  matchers: readonly string[] = EMPTY_MATCHERS,
): string[] {
  if (!RUNS_GIT.test(src)) return [];
  const stripped = stripComments(src);
  if (!DIFF_READ.test(stripped)) return [];
  const lines = stripped.split('\n');
  /** The same code with string CONTENT blanked — what the HOP reads. */
  const flow = blankStrings(stripped).split('\n');
  const decls = lines.map((line, i) => {
    const m = line.match(/(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/);
    // The SEED is read with strings INTACT — the git argv is a string array.
    return m ? { name: m[1], seed: statementAt(lines, i), hop: statementAt(flow, i) } : null;
  });
  const bound = new Set<string>();
  for (const d of decls) if (d && DIFF_READ.test(d.seed) && RUNS_GIT.test(d.seed)) bound.add(d.name);
  const seeds = [...bound];
  // \U0001F534 ONE HOP, AND NOT MORE — #454's rule, and its reason: to a fixpoint an
  // unscoped loop variable picks up a parameter three hundred lines away, and
  // this repo's suites report dozens of phantom findings that way.
  for (const d of decls) {
    if (d && !bound.has(d.name) && seeds.some((id) => refers(id, d.hop))) bound.add(d.name);
  }
  if (!bound.size) return [];
  const found: string[] = [];
  lines.forEach((line, i) => {
    if (!matchers.some((m) => line.includes(m))) return;
    let start = i;
    while (start > 0 && !/expect\s*\(/.test(lines[start])) start -= 1;
    if (!/expect\s*\(/.test(lines.slice(start, i + 1).join('\n'))) return;
    // Read with strings blanked: an assertion MESSAGE mentioning a bound name
    // is prose, not a use of it.
    const via = [...bound].find((id) => refers(id, flow.slice(start, i + 1).join('\n')));
    if (via) found.push(`${start + 1} (via \`${via}\`)  ${src.split('\n')[start].trim().slice(0, 120)}`);
  });
  return found;
}

/**
 * Every suite in `src`, walked off the FILESYSTEM.
 *
 * ⚠️ NOT `gi` + `t ls-files`. THE-315's sweep scans tracked files only, and
 * THE-347's CI went red because a full run happened BEFORE the files were
 * staged — a guard whose reach depends on whether you have committed yet is a
 * guard that lies to the person writing it. A walk sees this file before it is
 * staged.
 */
function suites(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
      return /\.test\.[cm]?[jt]sx?$/.test(e.name) ? [p] : [];
    });
  return walk(path.join(ROOT, 'src'))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .sort();
}

/**
 * 🔴 THE FINDING, PINNED. The suites that still hold an EMPTY-direction
 * assertion over the current branch's diff, and how many each holds — under
 * #454's OWN dataflow, so this is what #454 would report the day someone
 * widened its direction and nothing else.
 *
 * ⚠️ THIS IS A REPORT, NOT A BAN. Some of these are correct and must stay —
 * see the file header. It is pinned so the number cannot grow quietly and so
 * the ticket that takes this inherits the list.
 */
const EMPTY_DIRECTION_FREEZES: Readonly<Record<string, number>> = {
  'src/components/__tests__/THE-277.signups-split.test.tsx': 1,
  'src/components/__tests__/THE-305.course-editor-header.test.tsx': 9,
  'src/components/__tests__/THE-305.install-reachable.test.tsx': 1,
  'src/components/course/__tests__/THE-282.course-status.test.tsx': 4,
  'src/components/course/__tests__/THE-311.course-palette.test.ts': 8,
};

const EMPTY_DIRECTION_TOTAL = 23;

describe('3 · #454 would NOT catch §8 even with its blind spot closed', () => {
  /**
   * 🔴 PROVED ON PLANTED SAMPLES, BY BEHAVIOUR — THE-315's own lesson. Its
   * first gate-proof passed with the gate deleted because the assertion's own
   * message contained the string it grepped for.
   *
   * ⚠️ THE SAMPLE IDENTIFIERS ARE NAMES THIS FILE DOES NOT USE, for the reason
   * in the `DIFF_READ` note: a sample spelling a real binding here would tie the
   * sample's variable to this file's own declarations.
   */
  const seed = "const sweptPaths = () => execFileSync('git', [" + "'di" + "ff', '--name" + "-only', base]);";
  const freezeDirect = [seed, 'expect(sweptPaths())', '.to' + 'Equal([]);'].join('\n');
  const freezeOneHop = [seed, 'const swept = sweptPaths();', 'expect(swept)', '.to' + 'Equal([]);'].join('\n');
  const expiring = [seed, 'const swept = sweptPaths();', 'expect(swept)', '.to' + 'Contain(SELF);'].join('\n');
  const unrelated = ['const suiteNames = listSuites();', 'expect(suiteNames)', '.to' + 'Equal([]);'].join('\n');

  it('\u{1F534} § 8’s shape is flagged in the EMPTY direction, direct and one hop', () => {
    expect(branchDiffAssertions(freezeDirect), 'a direct EMPTY-direction freeze on the diff is missed')
      .not.toEqual([]);
    expect(branchDiffAssertions(freezeOneHop),
      'ONE HOP from the read is missed — and one hop is exactly what §8 was: `changed(...)` is a '
      + 'filter over `CHANGED`, which is the direct read').not.toEqual([]);
    expect(branchDiffAssertions(unrelated), 'an assertion that never reads the diff was flagged')
      .toEqual([]);
  });

  it('\u{1F534} and #454’s direction does NOT flag it — which is the second blind spot', () => {
    /* The same detector, the same samples, the same ONE-HOP dataflow #454
       already has. Only the DIRECTION is swapped. It answers nothing on either
       freeze and answers on the expiring one, so the difference is the
       direction and not the dataflow — and the known binding blind spot
       (card 86bbvhaky) was never what let §8 through. */
    expect(branchDiffAssertions(freezeDirect, NON_EMPTY_MATCHERS),
      '#454’s direction now flags a freeze — re-read this ticket’s report').toEqual([]);
    expect(branchDiffAssertions(freezeOneHop, NON_EMPTY_MATCHERS),
      '#454’s direction now flags a freeze one hop from the read').toEqual([]);
    expect(branchDiffAssertions(expiring, NON_EMPTY_MATCHERS),
      '#454’s direction stopped catching the shape it exists for').not.toEqual([]);
  });

  it('\u{1F534} both sweeps SAY they exempt it, so this is design and not an oversight', () => {
    // #454's own header and THE-322's planted case, quoted from the PROSE — so
    // the day either one changes its mind this report goes red instead of
    // going quietly stale. Read unstripped, because a docblock is the claim.
    expect(read(THE315), '#454 stopped declaring the EMPTY direction exempt')
      .toContain('a freeze. It gets MORE true when');
    expect(read(THE315), '#454 stopped saying an EMPTY-direction read cannot expire')
      .toContain('the ticket merges, never less, so it cannot expire');
    expect(read(THE315), '#454 stopped exempting the EMPTY direction from its detector')
      .toContain('full of these deliberately. Not flagged.');
    expect(read(THE322), 'THE-322 stopped asserting that a freeze is not the defect')
      .toContain('a freeze was flagged, and a freeze is not the defect');
    // And #454's matcher list really is the one copied above, so the
    // behavioural comparison is not measuring a detector that has moved on.
    // ⚠️ Each right-hand side is how #454's own regex literal SPELLS that
    // matcher, assembled for the reason at the head of this section.
    const SPELLED_IN_454: ReadonlyArray<readonly [string, string]> = [
      ['.to' + 'Contain(', '\\.to' + 'Contain\\('],
      ['.to' + 'Match(', '\\.to' + 'Match\\('],
      ['.toBe' + 'GreaterThan(', '\\.toBe' + 'GreaterThan'],
      ['.not.to' + 'Equal([])', '\\.not\\.to' + 'Equal\\('],
      ['.not.to' + 'HaveLength(0)', '\\.not\\.to' + 'HaveLength\\('],
    ];
    expect(SPELLED_IN_454.map(([m]) => m), 'the two matcher lists drifted apart')
      .toEqual([...NON_EMPTY_MATCHERS]);
    for (const [matcher, spelling] of SPELLED_IN_454) {
      expect(read(THE315).includes(spelling),
        `#454’s NON_EMPTY no longer spells ${matcher} — the copy above has drifted`).toBe(true);
    }
  });

  it('\u{1F534} the cost of closing it: the finding, pinned per suite', () => {
    /* 🔴 THE HANDOVER. Widening #454's direction would light up every one of
       these at once, with no register to absorb them, and turn `main` red for
       everyone — which is the failure this whole series exists to stop. So the
       set is recorded here and #454 is left alone.

       ⚠️ NOT ALL OF THESE ARE DEFECTS. THE-311's `touched.filter(...)`
       containment check is genuinely branch-scoped and correct on every branch;
       so is #454's own `strays` assertion. Each needs the judgement THE-338 and
       THE-319 each applied once, which is what makes this its own ticket rather
       than a sweep. */
    const found: Record<string, number> = {};
    for (const file of suites()) {
      const n = branchDiffAssertions(read(file)).length;
      if (n) found[file] = n;
    }
    expect(found, 'the EMPTY-direction finding moved. If you RETIRED one, drop the count here with '
      + 'your ticket and your reason. If you ADDED one, ask first whether it is a claim about YOUR '
      + 'branch that stops being true the day it merges — that is the defect this whole series '
      + 'exists for.').toEqual(EMPTY_DIRECTION_FREEZES);
    expect(Object.values(found).reduce((a, b) => a + b, 0),
      'the total moved — see the message above').toBe(EMPTY_DIRECTION_TOTAL);
  });

  it('the sweep really looked at the whole repo, so an empty finding would be a bug', () => {
    expect(suites().length, 'the suite walk collapsed').toBeGreaterThan(300);
    expect(suites(), 'the walk missed this very file').toContain(ADDED_SUITES[0]);
  });

  it('\u{1F534} and §8’s three are GONE from that finding, which is this ticket’s half of it', () => {
    // Before this ticket THE-311 carried eleven; it carries eight. The three
    // that went are §8's, and section 1 proves the section reads no diff at all.
    expect(branchDiffAssertions(read(THE311)).length,
      'THE-311’s EMPTY-direction count moved').toBe(EMPTY_DIRECTION_FREEZES[THE311]);
    expect(branchDiffAssertions(read(THE311)).filter((f) => /THE-305/.test(f)),
      '§8’s diff reads are back').toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — no other EXPIRED branch-diff guard, and THE-357 adds none
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · no expired branch-diff guard remains, and this ticket writes none', () => {
  it('\u{1F534} #454’s standing sweep is still in the tree, and still registers every finding', () => {
    // The NON-EMPTY half is #454's job and it still does it — this ticket does
    // not duplicate it, and the assertion that it is still there is what stops
    // "THE-357 covers this now" becoming a reason to delete it.
    expect(code(THE315), '#454’s register is gone').toContain('export const REGISTER');
    expect(code(THE315), '#454 stopped failing on an unregistered finding')
      .toContain('and NO branch-diff assertion is unregistered');
  });

  it('\u{1F534} THE-357’s own suites read no diff, in either direction', () => {
    /* 🔴 THE RULE APPLIED TO ITSELF. A ticket that came to retire a branch-diff
       guard must not ship one — #454 shipped a fourth while removing three, and
       had to gate it. These two files ask git nothing at all: every question
       here is answered from disk or from a module import, so there is no diff
       to read and nothing to expire. */
    const banned = ['exec' + 'Sync(', 'spawn' + 'Sync(', 'node:child' + '_process', 'gi' + 't diff'];
    for (const file of ADDED_SUITES) {
      for (const needle of banned) {
        expect(read(file), `${file} reaches for \`${needle}\``).not.toContain(needle);
      }
      expect(branchDiffAssertions(read(file)), `${file} ships an EMPTY-direction diff freeze`).toEqual([]);
      expect(branchDiffAssertions(read(file), NON_EMPTY_MATCHERS),
        `${file} ships a NON-EMPTY branch-diff assertion`).toEqual([]);
    }
  });

  it('and no suite it edits is pinned to a line number', () => {
    // 🔴 THE-331 pinned `AdminCommunity.tsx:491`; a deletion shifted the surface
    // to `:311` and the suite would have measured whatever landed there.
    for (const file of [...ADDED_SUITES, THE311]) {
      expect(code(file), `${file} pins a line number`)
        .not.toMatch(/\.tsx?:\d+\s*['"`)]|:\s*\d+\s*\/\/\s*line/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5-7 — the share sheet says something true
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every rendered string in a file: single-line literals only, in comment-stripped
 * source.
 *
 * ⚠️ SINGLE-LINE DELIBERATELY. A first draft let a template literal run across
 * newlines and one match swallowed ninety lines of `GivingShareSheet.tsx`,
 * reporting the whole component body as a promise about card giving. A literal
 * that spans lines is a class string or a code fence, not a sentence.
 */
const literalsOf = (rel: string): string[] =>
  [...code(rel).matchAll(/'([^'\\\n]{12,})'|"([^"\\\n]{12,})"|`([^`\\$\n]{12,})`/g)]
    .map((m) => m[1] ?? m[2] ?? m[3]);

/**
 * Anything that promises a money rail is on its way back.
 *
 * ⚠️ A TIMEFRAME IS ONLY A PROMISE WHEN IT LOOKS FORWARD. A first draft took
 * THE-350's `\\bdays?\\b` straight across, and on a repo-wide sweep that flagged
 * `InsightFeed`'s "Giving could not be read for the last seven days." — an ERROR
 * state, and the opposite of a promise. THE-350 applied that clause to one known
 * string; a sweep needs the forward-looking shape.
 */
const PROMISE = new RegExp([
  'coming soon', 'back soon', 'shortly', 'in the meantime', 'for now', 'until then',
  '\\bsoon\\b', 'temporar', 'migrat', '\\b20\\d{2}\\b',
  '\\bin (?:a|the|a few|the next)\\s+(?:days?|weeks?|months?)\\b',
].join('|'), 'i');

/** …about money, as opposed to an unbuilt tab. */
const MONEY = /card giving|stripe|giving|donat|payment|\bgive\b/i;

/** Every shipped source file — no test, no primitive, walked off disk. */
function sourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__tests__' ? [] : walk(p);
      return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
    });
  return walk(path.join(ROOT, 'src'))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .sort();
}

describe('5 · no surface says card giving is "coming soon"', () => {
  /**
   * \u{1F534} A REAL SWEEP, NAMED PER FILE — not a hand-list. Every shipped source
   * file in `src` is read, every single-line string literal in it is taken, and
   * one that talks about money AND promises is a finding. The result is pinned,
   * so a new promise anywhere in the app fails here with its file and its
   * sentence rather than waiting for someone to notice.
   *
   * ⚠️ "coming soon" ELSEWHERE IS NOT THIS TICKET'S. `AdminDashboard.tsx` and
   * `MainApp.tsx` render "<tab> content coming soon" for unbuilt TABS, and
   * `newsletter-feature.ts` records the founder's own "put SMS and newsletter to
   * coming soon". Those are features that genuinely are not built, not a money
   * rail that is closed, so `MONEY` is what separates them.
   */
  const REPORTED: Readonly<Record<string, readonly string[]>> = {
    /* \u{1F534} REPORTED, NOT FIXED — a DIFFERENT surface, a different feature switch
       and a different ticket's copy. `PAID_EVENTS_HIDDEN_MESSAGE` (THE-345) ends
       "Pricing returns here as soon as payments are back." That is about EVENT
       payments rather than card giving, it names no date and states a condition
       rather than a plan — but "as soon as" still reads as a promise, and the
       platform account it would depend on is the same closed one. Pinned to its
       exact text so this report cannot go stale: the ticket that corrects it will
       have to move this line and say why, which is how THE-350 handed the share
       sheet to THE-357. */
    'src/lib/paid-events-feature.ts': ['Pricing returns here as soon as payments are back.'],
  };

  it('\u{1F534} the sweep over every shipped source file', () => {
    const found: Record<string, string[]> = {};
    for (const rel of sourceFiles()) {
      const hits = literalsOf(rel).filter((v) => MONEY.test(v) && PROMISE.test(v));
      if (hits.length) found[rel] = hits;
    }
    expect(found, 'a surface promises a money rail is coming back. If it is TRUE, say what is true '
      + 'instead; if it is not, remove it. If it is genuinely another ticket\'s, pin it in REPORTED '
      + 'above with its exact text and your reason — the way THE-350 pinned the share sheet for this '
      + 'one.').toEqual(REPORTED);
  });

  it('\u{1F534} and the sweep fires on the sentence this ticket removed — planted, not inferred', () => {
    // If the sweep above cannot see the exact copy that was there, it is not
    // checking anything. Asserted on both halves of the test: the promise, and
    // the money word that separates it from an unbuilt tab.
    const WAS = 'Card giving through Stripe Connect is coming soon. Until then, these are the ways '
      + 'your members can give.';
    expect(PROMISE.test(WAS), 'the sweep does not fire on the copy this ticket removed').toBe(true);
    expect(MONEY.test(WAS), 'the sweep no longer recognises this as a money surface').toBe(true);
    // And an unbuilt tab is correctly NOT a finding, which is why the app's
    // three other "coming soon" lines are not swept up.
    expect(MONEY.test('Inbox coming soon.'), 'an unbuilt tab is being read as a money surface')
      .toBe(false);
  });

  it('the sweep really read the whole tree, so an empty finding would be a bug', () => {
    expect(sourceFiles().length, 'the source walk collapsed').toBeGreaterThan(200);
    expect(sourceFiles(), 'the walk missed the file this ticket fixed').toContain(SHARE);
    expect(literalsOf(SHARE).length, 'no literal was read out of the share module')
      .toBeGreaterThan(0);
  });
});

describe('6 · no surface gives a date or implies a migration is in progress', () => {
  it('\u{1F534} the share sheet’s own copy', async () => {
    const { GIVING_SHARE_CARD_GIVING_OFF } = await import('@/components/donations/giving-share');
    expect(GIVING_SHARE_CARD_GIVING_OFF, 'the share sheet promises again').not.toMatch(PROMISE);
  });

  it('and the constant no longer says "soon" in its own NAME either', () => {
    // A name is not a surface, but it is read by everyone who opens the module
    // and it was the same promise one layer down.
    expect(code(SHARE), 'the renamed export is gone').toContain('GIVING_SHARE_CARD_GIVING_OFF');
    expect(code(SHARE), 'the old promising name came back').not.toContain('GIVING_SHARE_STRIPE_SOON');
    expect(code('src/components/donations/GivingShareSheet.tsx'), 'the sheet renders the old name')
      .not.toContain('GIVING_SHARE_STRIPE_SOON');
  });
});

describe('7 · what replaces it is TRUE', () => {
  it('\u{1F534} clause by clause, against the tree', async () => {
    const { GIVING_SHARE_CARD_GIVING_OFF } = await import('@/components/donations/giving-share');
    expect(GIVING_SHARE_CARD_GIVING_OFF).toBe(
      'Card giving inside the app is off. These are the ways your members can give, and a gift you '
      + 'record in the CRM counts on your dashboard, in accounting and on your giving statements.',
    );

    // 🔴 CLAIM 1 — "Card giving inside the app is off."
    const { STRIPE_CONNECT_ENABLED } = await import('@/lib/stripe-connect-feature');
    expect(STRIPE_CONNECT_ENABLED, 'the sentence says card giving is off while it is on').toBe(false);

    // 🔴 CLAIM 2 — "These are the ways your members can give." The sheet renders
    // the church's published links directly above this line, re-validated by
    // `readGivingLinks`, and the payload has no other way in.
    const sheet = code('src/components/donations/GivingShareSheet.tsx');
    expect(sheet, 'the sheet stopped rendering the church’s links').toMatch(/payload\.links/);
    expect(code(SHARE), 'the payload stopped re-validating the links').toContain('readGivingLinks(config)');

    // 🔴 CLAIM 3 — "a gift you record in the CRM counts on your dashboard, in
    // accounting and on your giving statements". THE-350 built that path; this
    // asserts the same three links it does.
    expect(code('src/components/AdminCRM.tsx')).toMatch(/authFetch\('\/api\/donations\/manual'/);
    expect(code('src/lib/manual-donation.ts')).toMatch(/type:\s*'donation_receipt'/);
  });

  it('\u{1F534} and the sentence is still a SENTENCE — no control, no flag read', () => {
    /* THE-256's property, unchanged by this ticket and the reason the copy lives
       in a module rather than behind a switch: reading the Connect flag here
       would make this a gated live control the moment the flag flips. */
    expect(code(SHARE), 'the share module imports the Connect switch')
      .not.toMatch(/import[^;]*stripe-connect-feature/);
    expect(code(SHARE), 'the share module reads the Connect flag').not.toMatch(/\bSTRIPE_CONNECT_ENABLED\b/);
    expect(code('src/components/donations/GivingShareSheet.tsx'), 'the sheet reads the Connect flag')
      .not.toMatch(/\bSTRIPE_CONNECT_ENABLED\b/);
  });

  it('the portal route’s note is still a COMMENT and still only reported', () => {
    /* ⚠️ REPORTED, NOT FIXED — the ticket said so in terms. "…be unavailable. It
       gets its honest name when the Stripe path is retired" is a docblock
       explaining why the ROUTE PATH is still spelled `/api/stripe/portal`. No
       church reads it. Asserted to be exactly that, so it stays prose. */
    const portal = 'src/app/api/stripe/portal/route.ts';
    expect(read(portal), 'the portal note is gone — the report is stale')
      .toMatch(/It gets its honest name when the Stripe path is retired/);
    expect(code(portal), 'the portal note became user-facing copy').not.toMatch(/It gets its honest name/);
  });

  it('the three "coming soon" lines that are NOT about card giving are still there, and still not ours', () => {
    /* ⚠️ Pinned rather than described, so the report cannot go stale. Each is
       about a feature that genuinely is not built — an unbuilt admin tab, an
       unbuilt member tab, and the founder's own instruction about SMS and the
       newsletter. None of them is a claim about money. */
    expect(code('src/components/AdminDashboard.tsx'), 'the unbuilt-tab placeholder moved')
      .toContain("|| 'Inbox'} coming soon.");
    expect(code('src/components/MainApp.tsx'), 'the member unbuilt-tab placeholders moved')
      .toContain('content coming soon.');
    expect(read('src/lib/newsletter-feature.ts'), 'the newsletter note moved')
      .toContain('put SMS and newsletter to coming soon');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 — the-313-guards is not weakened
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('8 · the-313-guards is not weakened', () => {
  const THE313 = 'src/__tests__/the-313-guards.test.ts';

  it('\u{1F534} giving-share.ts is still in THE-313’s UNTOUCHED set, at an APPENDED value', () => {
    const guard = code(THE313);
    expect(guard, 'giving-share.ts left THE-313’s untouched set').toContain(SHARE);
    // THE-313's own recorded value is still accepted. Substituting it is the
    // move that took `main` down for everyone when #434 did it.
    expect(guard, 'THE-313’s own digest for giving-share.ts was REPLACED, not appended to')
      .toContain('b28d762c711c016c57f593b83d70f131fe92f8418395a34bf1e644b06a1ae01b');
    // And the file on disk is at THE-357's appended value.
    expect(sha256(readFileSync(path.join(ROOT, SHARE))),
      'giving-share.ts is not at the digest THE-357 recorded')
      .toBe('cb82182d615d85a737709dc049734bc1906c4801bd1ac73e9f5ba477f0dc8ba9');
    expect(guard, 'THE-357’s appended value is not recorded in THE-313’s set')
      .toContain('cb82182d615d85a737709dc049734bc1906c4801bd1ac73e9f5ba477f0dc8ba9');
  });

  it('\u{1F534} and the guard still REFUSES an unrecorded value, which is the whole threat', () => {
    /* The mechanism, proven rather than described: the accepted list for this
       file has exactly the two recorded values and nothing else, so a third
       state — anyone editing the file without recording it — still fails. */
    const guard = code(THE313);
    const at = guard.indexOf(SHARE);
    const block = guard.slice(at, guard.indexOf('];', at));
    const digests = [...block.matchAll(/'([0-9a-f]{64})'/g)].map((m) => m[1]);
    expect(digests, 'the accepted set for giving-share.ts is not the two recorded values').toEqual([
      'b28d762c711c016c57f593b83d70f131fe92f8418395a34bf1e644b06a1ae01b',
      'cb82182d615d85a737709dc049734bc1906c4801bd1ac73e9f5ba477f0dc8ba9',
    ]);
    expect(guard, 'the assertion that compares the digest is gone').toContain('accepted.find(([digest]) => digest === actual)');
  });

  it('\u{1F534} and WHAT the pin exists for is byte-identical, which is why the append is legitimate', () => {
    /* 🔴 THE ENTRY'S OWN WORDS: "do NOT reuse `giving-share.ts`'s URL builder or
       loosen its host validation." THE-357 changes one exported sentence and its
       name; the security surface is pinned here VERBATIM so the append is
       checked rather than asserted in a PR body. */
    const src = code(SHARE);
    expect(src, 'the apex this module will emit changed')
      .toContain("export const HARVEST_APEX = 'theharvest.app';");
    expect(src, 'the public giving path changed').toContain("export const GIVING_PATH = '/giving';");
    expect(src, 'the DNS label rule was loosened')
      .toContain('const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;');
    for (const rule of [
      "if (parsed.protocol !== 'https:') return null;",
      'if (parsed.username || parsed.password) return null;',
      'if (parsed.port) return null;',
      'if (!host.endsWith(`.${HARVEST_APEX}`)) return null;',
      'if (host.split(\'.\').length !== HARVEST_APEX.split(\'.\').length + 1) return null;',
    ]) {
      expect(src, `a host-validation rule was loosened or removed:\n  ${rule}`).toContain(rule);
    }
    expect(src, 'the payload grew a seam a caller could push an unvalidated URL through')
      .toContain('const links = readGivingLinks(config);');
    expect(src, 'the module started importing something other than the validator')
      .toMatch(/from '\.\/giving-providers';/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 — the house rules
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('9 · no colour hardcoded, no emoji added, no new token or dependency', () => {
  it.each(EDITED_SOURCE)('%s adds no colour literal', (rel) => {
    // The two donation files were at zero and stay at zero; AdminSms is asserted
    // at zero by THE-327's own budget and this ticket does not move it.
    const src = code(rel);
    expect((src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length, `${rel} spells a raw colour`).toBe(0);
    expect((src.match(/\b(?:rgba?|hsla?)\s*\(/g) ?? []).length, `${rel} spells an rgb()/hsl() colour`).toBe(0);
    expect(src, `${rel} spells a raw Tailwind scale`).not.toMatch(/\bdivide-stone-\d|\b(?:bg|text|border)-(?:stone|zinc|slate|neutral|gray)-\d/);
  });

  it.each([...EDITED_SOURCE, ...ADDED_SUITES])('%s renders no emoji', (rel) => {
    /* ⚠️ Comments carry the repo's severity marks; RENDERED copy may not, so the
       source is stripped before the sweep. U+FE0F is stripped rather than
       matched — matched, it splits every marker in two. */
    const src = stripComments(read(rel)).replace(/️/g, '');
    expect(src.match(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/gu) ?? [], `${rel} renders an emoji`)
      .toEqual([]);
  });

  it('\u{1F534} no new token, component or dependency', () => {
    // THE-274 pins the lockfile to an EXACT LENGTH with no append path, so a
    // dependency is not an option even if one were wanted.
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).length + Object.keys(pkg.devDependencies).length,
      'a dependency was added').toBe(89);
    // No primitive was installed, and none was adopted that is not already
    // recorded — AdminSms's ten are unchanged and `accordion` is still absent.
    expect(readdirSync(path.join(ROOT, 'src/components/ui')).filter((f) => f.endsWith('.tsx')),
      'a primitive was installed or removed').toHaveLength(43);
    expect(readdirSync(path.join(ROOT, 'src/components/ui')).includes('accordion.tsx'),
      'accordion appeared').toBe(false);
    // Rule 4's tokens are adopted, not extended: no new density name exists.
    expect(code('src/components/layout/form-layout.ts'), 'a density token was added')
      .toContain("action: 'sm:h-[40px] sm:py-0',");
  });

  it('no fixture is anchored near today, and no fake clock is installed', () => {
    /* 🔴 A fixture dated near the run date passes today and fails on the day the
       window moves. These suites carry no date at all, which is the strongest
       form of that — and no `toFake` either, so nothing here depends on a clock
       whose `Date` entry is load-bearing elsewhere. */
    for (const rel of ADDED_SUITES) {
      const src = code(rel);
      expect(src, `${rel} anchors a fixture to a date`).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
      expect(src, `${rel} installs a fake clock`)
        .not.toMatch(new RegExp(['useFake' + 'Timers', 'to' + 'Fake'].join('|')));
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10 — the files this ticket may not touch
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('10 · firestore.rules, the indexes file, functions/ and layout.tsx are byte-identical', () => {
  it('\u{1F534} firestore.rules — it AUTO-DEPLOYS TO PRODUCTION on merge', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('firestore.indexes.json', () => {
    /* ⚠️ It does NOT deploy — `deploy-rules.yml` runs `firestore:rules,storage`
       only — so an index added here would be inert and the query that needed it
       would throw `failed-precondition` in production. THE-313 recorded the
       value; this ticket adds no query at all. */
    expect(sha256(readFileSync(path.join(ROOT, 'firestore.indexes.json'))))
      .toBe('8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0');
  });

  it('functions/ — file for file', () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, 'functions'));
    const files = out.sort();
    expect(files).toHaveLength(5);
    expect(sha256(files.map((f) => `${f}:${sha256(readFileSync(path.join(ROOT, f)))}`).join('\n')))
      .toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });

  it('src/app/layout.tsx — at a digest a ticket recorded, not at whatever this branch left', () => {
    /* ⚠️ ASKED OF THE OWNERSHIP REGISTER, never of the diff: "not in the diff
       against main" is a statement about which branch you are on, and it stopped
       being true of several of these files the moment another ticket
       legitimately landed on them. The register says the same thing about
       CONTENT and is true on any branch. */
    expect(ownershipFailure('src/app/layout.tsx'),
      'layout.tsx is at a digest no ticket recorded').toBeNull();
  });

  it('and nothing this ticket adds or edits mentions them', () => {
    for (const rel of [...EDITED_SOURCE, ...ADDED_SUITES.slice(1)]) {
      expect(code(rel), `${rel} reaches for firestore.rules or functions/`)
        .not.toMatch(/firestore\.rules|['"]\.\.?\/functions\//);
    }
  });
});
