/**
 * THE-315 — every guard that expires when its own ticket merges.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three guards in two days blocked every unrelated PR in this repo, and all
 * three shared one shape: AN ASSERTION ABOUT THE CURRENT BRANCH'S DIFF, IN THE
 * NON-EMPTY DIRECTION. "this suite is in the diff", "a course source file was
 * changed". Each was written to stop a scoped sweep degrading into a no-op,
 * which is a real and correct intent — but each tied that claim to a condition
 * that only holds while its own ticket is UNMERGED. They pass in their own PR,
 * so nobody notices until the NEXT unrelated PR goes red for a reason that has
 * nothing to do with it.
 *
 *   · THE-312's sweep self-check   — went red when #448 merged, amended in #450
 *   · THE-311's "a course file was changed" — red when #447 merged, fixed in #453
 *   · tailwind-v4's "the sweep's own files left the set" — retired on the base
 *     package.json's tailwind major, which is the same idea reached first
 *
 * 🔴 THE PROMISE THIS FILE KEEPS. #453's docblock in
 * `THE-311.course-palette.test.ts` says, of the third occurrence: "which is why
 * the sweep in section 16 below now looks for the pattern across the whole
 * suite rather than waiting for a fourth." THERE IS NO SECTION 16. That file
 * ends at section 13. The repo-wide sweep was described in a landed comment and
 * never written, so the pattern is still only caught by whoever reads the
 * comment. This is that sweep, and it lives in a file of its own because it is
 * about every suite, not about courses.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DISTINCTION THE DETECTOR IS BUILT ON
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Not every `git diff` in a test is this defect. The direction is what decides:
 *
 *   · NON-EMPTY ("the diff contains X", "more than zero files changed") — this
 *     is the expiring shape. It is TRUE on the ticket's own branch and FALSE
 *     for every branch after it merges. This is what the detector hunts.
 *
 *   · EMPTY ("this file is not in the diff") — a freeze. It gets MORE true when
 *     the ticket merges, never less, so it cannot expire and cannot go red for
 *     an unrelated PR unless that PR really does edit the frozen file, which is
 *     the guard doing its job. THE-282, THE-305 and AdminSettings.regroup are
 *     full of these deliberately. Not flagged.
 *
 * ⚠️ `git cat-file -e <baseRef>:<path>` is the FIXED shape, not a symptom. It
 * asks the BASE REF whether it already carries a file. That is independent of
 * what the branch changed, so it keeps its full force for the whole window it
 * can have any — while the ticket is unmerged the base does not carry the file,
 * the gate is open, and a branch that swept nothing still fails.
 *
 * 🔴 AND IT IS DELIBERATELY NOT THE DIFF. The tempting fix is to copy the
 * neighbouring escape hatch — "if this file is not in the diff, skip". That
 * hatch is right for a sweep, and WRONG here, because the assertion being
 * gated IS "this file is in the diff": `if (not in diff) return; expect(in
 * diff)` is vacuous by construction. A guard that cannot fail is worse than the
 * failure it replaces, because it looks green while what it polices rots. Both
 * #450 and #453 record reaching for the base ref for exactly this reason.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const SELF = 'src/__tests__/THE-315.branch-diff-guards.test.ts';

const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const git = (args: string[]) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * The commit this branch is measured against. Copied rather than imported, for
 * the same reason THE-311 copies it from THE-282: those files are suites, not
 * modules, and importing one runs it twice. The fallback chain is the same, and
 * for the same CI reason — a `pull_request` run checks out `refs/pull/N/merge`,
 * where `origin/main` may not exist.
 */
function baseRef(): string {
  for (const ref of ['origin/main', 'refs/remotes/origin/main', 'main']) {
    try { return git(['rev-parse', '--verify', `${ref}^{commit}`]).trim(); } catch { /* next */ }
  }
  try {
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
    if (parents.length === 3) return parents[1];
  } catch { /* fall through */ }
  throw new Error('the base commit could not be resolved, so a branch-diff sweep would measure nothing');
}

/** Does the BASE REF already carry `rel`? The stand-down signal — see the header. */
function landedOnBase(rel: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${baseRef()}:${rel}`],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The detector
 * ═══════════════════════════════════════════════════════════════════════════ */



/**
 * String literals blanked, so a MESSAGE that happens to contain a bound name
 * cannot spread the binding. Newlines and length are preserved so line numbers
 * still line up.
 *
 * ⚠️ THIS IS NOT COSMETIC. `changed` is a bound name in the tailwind suite and
 * also an ordinary English word: `expect(sha, `${rel} changed`)` reads as a
 * reference to it, and through the transitive step that one match spread the
 * binding across three suites and produced thirty-six phantom findings.
 * Template INTERPOLATIONS are kept — `${changed}` is a real reference.
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

/**
 * The whole declaration STATEMENT beginning at `i` — the initializer, or a
 * function's body — read by balancing delimiters rather than by taking a fixed
 * number of lines.
 *
 * ⚠️ A fixed window is what a first draft used, and it is far too loose: any
 * declaration within ten lines of one already bound picks the binding up, and
 * on this repo that spread from three findings to two hundred and twenty-four.
 * A binding has to come from the declaration's OWN text.
 */
const STATEMENT_CAP = 40;

function statementAt(lines: string[], i: number): string {
  let depth = 0;
  const out: string[] = [];
  for (let n = i; n < lines.length && n < i + STATEMENT_CAP; n += 1) {
    out.push(lines[n]);
    for (const ch of lines[n]) {
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth -= 1;
    }
    if (depth <= 0 && /[;}]\s*$/.test(lines[n])) return out.join('\n');
    if (depth <= 0 && n > i && lines[n].trim() === '') return out.join('\n');
  }
  // ⚠️ Never closed inside the cap, so this is not a statement we can read —
  // a 200-line table declaration once swallowed an unrelated helper forty lines
  // below it and seeded the whole file. An unreadable statement binds nothing.
  return lines[i];
}

/** Every tracked suite in the repo. */
const SUITES: string[] = git(['ls-files', 'src'])
  .split('\n')
  .filter((f) => /\.test\.[cm]?[jt]sx?$/.test(f))
  .sort();

/** Block comments and line comments blanked, so a docblock DESCRIBING the
 *  defect is never mistaken for one. Newlines are preserved so line numbers
 *  survive the strip — the register anchors on them being right. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

/** A read of the current branch's diff or working state. */
const DIFF_READ = /['"`]diff['"`]|git diff|--name-only|--diff-filter|ls-files['"`]?\s*,\s*['"`]--others|git status|['"`]status['"`]\s*\]/;

/**
 * A seed also has to RUN git, not just talk about it.
 *
 * ⚠️ `AdminMinistry.desktop-layout` builds the message "run `git diff <rev> --
 * <file>` to see what moved". That is a hint printed to whoever reads a
 * failure, not a read of the diff, and without this the detector flagged nine
 * assertions in that suite for a sentence.
 */
const RUNS_GIT = /exec(?:File)?Sync\s*\(/;

/**
 * A reference to `id` in expression position.
 *
 * ⚠️ NOT a bare `\b` word boundary. That matched `text` inside the regex
 * literal `/\.text-strong\s*\{/` and inside a CSS class name, which is how a
 * palette assertion in the tailwind suite came to be reported as a branch-diff
 * guard. A member access or a hyphenated word is not a use of the binding.
 */
const refers = (id: string, text: string) =>
  new RegExp(`(^|[^.\\w$-])${id}([^\\w$-]|$)`).test(text);

/** The NON-EMPTY direction — see the header for why the empty one is not it. */
const NON_EMPTY = /\.toBeGreaterThan(?:OrEqual)?\(\s*0?\s*\)|\.toBeGreaterThan\(\s*\d+\s*\)|\.toContain\(|\.toMatch\(|\.not\.toEqual\(\s*\[\s*\]\s*\)|\.not\.toHaveLength\(\s*0\s*\)|\.toHaveLength\(\s*[1-9]/;

export interface Finding {
  file: string;
  line: number;
  /** The assertion, trimmed — the register anchors on this, not on the number. */
  text: string;
  /** The diff-bound identifier that made it a finding. */
  via: string;
}

/**
 * Every assertion in the repo that reads the current branch's diff or working
 * state and asserts it NON-EMPTY.
 *
 * Identifiers are bound to a diff read by looking at the declaration and the
 * few lines that follow it, which is how every one of these is actually written
 * in this repo — `const CHANGED = [...git(['diff', ...]), ...]`, `const
 * changedSince = (...) => execFileSync('git', ['diff', ...])`. A binding that
 * hid the read behind three more indirections would be missed; the register
 * below is the backstop for that, because it also fails when an entry it names
 * has GONE.
 */
export function findBranchDiffAssertions(files: string[] = SUITES): Finding[] {
  const found: Finding[] = [];
  for (const file of files) {
    const raw = read(file);
    if (!/exec(?:File)?Sync/.test(raw)) continue;
    const code = stripComments(raw);
    if (!DIFF_READ.test(code)) continue;
    const lines = code.split('\n');
    /** The same code with string CONTENT blanked — what dataflow reads. */
    const flow = blankStrings(code).split('\n');

    /**
     * Identifiers bound to a diff read, to a FIXPOINT. The direct binding is
     * `const CHANGED = [...git(['diff', ...])]`; the transitive one is
     * `const touched = CHANGED.filter(...)`, and it is not optional — THE-311's
     * expired assertion was written on `touched`, one hop from the read, and a
     * detector that only saw the direct binding would have missed the very
     * guard that took CI down repo-wide.
     */
    const bound = new Set<string>();
    const decls = lines.map((line, i) => {
      const m = line.match(/(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/);
      // The SEED is read with strings intact — the git argv is a string array.
      // The HOP is read with them blanked, for the reason in `blankStrings`.
      return m ? { name: m[1], seed: statementAt(lines, i), hop: statementAt(flow, i) } : null;
    });
    /**
     * 🔴 ONE HOP, AND NOT MORE. These files have no scoping — a loop variable
     * `rel` bound from the diff also matches the PARAMETER `rel` of an
     * unrelated helper three hundred lines away, and to a fixpoint that chain
     * ran seed -> rel -> gitShow -> basePkg and reported the tailwind suite's
     * own retirement check as an unregistered guard. One hop is what every real
     * occurrence needs and all any of them has ever used:
     *
     *   · THE-311  `const touched = CHANGED.filter(...)`   — one hop
     *   · THE-312  `const paths = changed();`              — one hop
     *   · tailwind `const changed = execSync('git diff …')` — the seed itself
     *
     * A guard written at two hops would be missed, and REGISTER is the backstop
     * for that: it also fails when an entry it names has gone.
     */
    for (const d of decls) {
      if (d && DIFF_READ.test(d.seed) && RUNS_GIT.test(d.seed)) bound.add(d.name);
    }
    const seeds = [...bound];
    for (const d of decls) {
      if (d && !bound.has(d.name) && seeds.some((id) => refers(id, d.hop))) bound.add(d.name);
    }
    if (!bound.size) continue;

    lines.forEach((line, i) => {
      if (!NON_EMPTY.test(line)) return;
      // The assertion may span lines: take the statement from the nearest
      // `expect(` at or above this line.
      let start = i;
      while (start > 0 && !/expect\s*\(/.test(lines[start])) start -= 1;
      const statement = lines.slice(start, i + 1).join('\n');
      if (!/expect\s*\(/.test(statement)) return;
      // Read with strings blanked: an assertion MESSAGE mentioning a bound name
      // is prose, not a use of it.
      const via = [...bound].find((id) => refers(id, flow.slice(start, i + 1).join('\n')));
      if (!via) return;
      found.push({
        file,
        line: start + 1,
        text: raw.split('\n')[start].trim(),
        via,
      });
    });
  }
  return found;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — the register
 * ═══════════════════════════════════════════════════════════════════════════ */

type Verdict =
  /** Has a landed-check or escape hatch that the base ref, not the diff, decides. */
  | 'retired'
  /** Genuinely needs the diff and cannot expire — must say why. */
  | 'branch-scoped';

interface Entry {
  file: string;
  /** A stable substring of the assertion. NOT a line number: those drift, and a
   *  register that drifts silently is the rot this file exists to catch. */
  anchor: string;
  ticket: string;
  verdict: Verdict;
  /** The literal gate in the file — what stands the assertion down. */
  gate: string;
  /** The literal base-ref read the gate is decided by. 🔴 NOT the diff: see the
   *  file header for why gating a "the diff contains X" claim on the diff is
   *  vacuous by construction. */
  baseRefRead: string;
  reason: string;
}

/**
 * ⚠️ APPEND, NEVER SUBSTITUTE. `main` went red once because a PR replaced a
 * pinned digest instead of adding beside it; the same rule holds here. A new
 * branch-diff assertion is a new entry with its own ticket and its own reason.
 * Rewriting an existing entry to make a failure go away is the failure.
 */
export const REGISTER: readonly Entry[] = [
  {
    file: 'src/components/course/__tests__/THE-311.course-palette.test.ts',
    anchor: 'no course source file was changed — the sweep would prove nothing',
    ticket: 'THE-311',
    verdict: 'retired',
    gate: 'if (!landedOnBase())',
    baseRefRead: "'cat-file', '-e', `${baseRef()}:${SELF}`",
    reason:
      'Only THE-311\'s own branch changes a course source file, so from #447 this was false for every '
      + 'later PR and CI went red repo-wide. #453 retired it on the base ref. What stops the scoping '
      + 'degrading into a no-op is the three assertions above it, none of which reads the diff: SWEPT '
      + 'must still contain course.constants.ts, must still hold ten files, and must still hold no test '
      + 'file — and the `touched` containment check still runs unconditionally.',
  },
  {
    file: 'src/components/__tests__/THE-312.settings-freeze-registers.test.tsx',
    anchor: 'the diff does not contain this suite, so the sweep skipped itself',
    ticket: 'THE-312',
    verdict: 'retired',
    gate: 'if (landedOnBase()) {',
    baseRefRead: "'cat-file', '-e', `${baseRef()}:${SELF}`",
    reason:
      'Required THIS SUITE to be in the diff against origin/main, which stopped being true the moment '
      + '#448 landed. #450 amended it on the base ref. Merged, the MACHINERY is proven directly '
      + 'instead — `changed()` must still answer and `isTestFile` must still tell a source path from a '
      + 'test path — so the actual way this could become a no-op still fails there.',
  },
  {
    file: 'src/__tests__/tailwind-v4-migration.test.ts',
    anchor: 'own files left the set — this is measuring nothing',
    ticket: 'THE-261',
    verdict: 'retired',
    gate: 'the base is already on v4 — this sweep is history and has nothing left to measure',
    baseRefRead: "gitShow(base, 'package.json')",
    reason:
      'The earliest of the three, and it reached the right answer first: it retires on CONTENT READ '
      + 'FROM THE BASE REF (is the base still on v4?) rather than on the diff, and states its own '
      + 'absence instead of passing silently. Once the migration is on main every later branch\'s base '
      + 'is already v4-spelled and the comparison would degrade into "no source file may ever differ '
      + 'from main again".',
  },
  {
    file: SELF,
    anchor: 'and this sweep is itself gated on the base ref',
    ticket: 'THE-315',
    verdict: 'retired',
    gate: "if (landedOnBase(self)) return { stoodDown: 'landed' };",
    baseRefRead: "execFileSync('git', ['cat-file', '-e', `${baseRef()}:${rel}`]",
    reason:
      'Section 7\'s own no-source-file sweep. It is a branch-diff assertion like any other and is held '
      + 'to the same rule it enforces — see section 7, which asserts that this very entry is gated.',
  },
];

describe('1 · every branch-diff assertion is retired, base-ref-gated, or justified', () => {
  const findings = findBranchDiffAssertions();
  const entryFor = (f: Finding) =>
    REGISTER.find((e) => e.file === f.file && f.text.includes(e.anchor));

  it('the detector still finds something — an empty sweep would prove nothing', () => {
    // 🔴 The no-op check this whole file is about, applied to itself. It reads
    // the TREE, not the diff, so it cannot expire: these three suites are all
    // on `main`, and a detector that stopped detecting would pass every stray.
    expect(SUITES.length, 'the suite list collapsed').toBeGreaterThan(300);
    expect(findings.map((f) => f.file).sort(), 'the detector no longer finds the three known guards')
      .toEqual([
        'src/__tests__/tailwind-v4-migration.test.ts',
        'src/components/__tests__/THE-312.settings-freeze-registers.test.tsx',
        'src/components/course/__tests__/THE-311.course-palette.test.ts',
      ]);
  });

  it.each(REGISTER.map((e) => [`${e.ticket} — ${e.file.split('/').pop()}`, e] as const))(
    '%s is registered, still present, and gated',
    (_name, entry) => {
      // Still present: a register naming an assertion that has GONE is a
      // register that has rotted, and it says so rather than passing silently.
      //
      // ⚠️ Anchored on the file's CONTENT, not on a detector finding. Section
      // 7's own entry is here because it reads the diff, but its assertion is
      // in the EMPTY direction, so the detector correctly does not flag it —
      // and an entry that could only be validated by a finding would have to
      // exempt it, which is the one exemption this file must not grant itself.
      expect(read(entry.file), `${entry.ticket}: no assertion matches this anchor any more — `
        + 'it was edited or removed, so this entry must be updated with its ticket and reason')
        .toContain(entry.anchor);

      // Gated: the case must stand the assertion down on something OTHER than
      // the diff, and for every entry here that something is the base ref.
      const src = read(entry.file);
      expect(src, `${entry.ticket}: the gate \`${entry.gate}\` is gone — the assertion is live again `
        + 'for every branch, which is exactly how this defect reaches an unrelated PR')
        .toContain(entry.gate);
      expect(src, `${entry.ticket}: the gate no longer reads the BASE REF (\`${entry.baseRefRead}\`). `
        + 'Gating a "the diff contains X" claim on the diff is vacuous by construction')
        .toContain(entry.baseRefRead);
      expect(entry.reason.length, `${entry.ticket}: a register entry needs a real reason`)
        .toBeGreaterThan(80);
      expect(entry.ticket).toMatch(/^THE-\d+$/);
    },
  );

  it('and NO branch-diff assertion is unregistered', () => {
    const strays = findBranchDiffAssertions()
      .filter((f) => !entryFor(f))
      .map((f) => `${f.file}:${f.line}  (via \`${f.via}\`)\n      ${f.text}`);
    expect(strays, 'a branch-diff assertion is not in REGISTER. It asserts the CURRENT BRANCH\'S DIFF '
      + 'is non-empty, which stops being true the moment its own ticket merges — and then every '
      + 'unrelated PR goes red for a reason that has nothing to do with it. Gate it on the BASE REF '
      + '(`git cat-file -e <base>:<path>`), never on the diff, then append an entry here:\n  '
      + strays.join('\n  ')).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2-3 — the two cases that were red
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · a PR touching NO course file passes the course emoji sweep', () => {
  const THE311 = 'src/components/course/__tests__/THE-311.course-palette.test.ts';

  it('THE-311 is on the base ref, so its expired premise stands down', () => {
    // 🔴 THE CASE THAT WAS RED. #447 put this suite on `main`; from that commit
    // `touched.length > 0` was false for every PR that did not happen to edit
    // a course file. The gate is the base ref, so this is decided by history
    // rather than by what this branch happens to contain.
    expect(landedOnBase(THE311), 'THE-311 is not on the base ref — the premise has not expired yet')
      .toBe(true);
  });

  it('and this very branch is that PR — it touches no course source file', () => {
    const touched = changedPaths().filter((f) =>
      (f === 'src/utils/course.constants.ts' || f.startsWith('src/components/course/'))
      && !f.includes('__tests__'));
    expect(touched, 'THE-315 changed a course source file, so it is no longer the case under test')
      .toEqual([]);
  });

  it('the stand-down is decided by the base ref and NOT by the diff', () => {
    const src = read(THE311);
    expect(src, 'THE-311 lost its base-ref gate').toContain("'cat-file', '-e', `${baseRef()}:${SELF}`");
    // ⚠️ The vacuous fix, explicitly refused: `if (not in diff) return; expect(in diff)`.
    expect(src, 'THE-311 gates the premise on CHANGED, which makes it vacuous by construction')
      .not.toMatch(/if\s*\(\s*!?\s*CHANGED\.(?:includes|some|length)[^)]*\)\s*return/);
  });
});

describe('3 · a PR touching no settings file passes THE-312\'s suite', () => {
  const THE312 = 'src/components/__tests__/THE-312.settings-freeze-registers.test.tsx';

  it('THE-312 is on the base ref, so #450\'s amendment stands its sweep down', () => {
    expect(landedOnBase(THE312), 'THE-312 is not on the base ref').toBe(true);
  });

  it('and #450\'s amendment is still the base-ref one, not a diff-shaped rewrite', () => {
    const src = read(THE312);
    expect(src, 'THE-312 lost its base-ref gate').toContain("'cat-file', '-e', `${baseRef()}:${SELF}`");
    expect(src, "THE-312's stand-down stopped being the base ref").toContain('if (landedOnBase()) {');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — each retired assertion still asserts its real property
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · each retired assertion still asserts its real property', () => {
  it('THE-311: the sweep is still scoped, non-empty and test-free, and containment still runs', () => {
    const src = read('src/components/course/__tests__/THE-311.course-palette.test.ts');
    // None of these four reads the diff, and all four run unconditionally.
    expect(src).toContain("expect(SWEPT, 'course.constants.ts fell out of the sweep').toContain(CONSTANTS)");
    expect(src).toContain("expect(SWEPT.length, 'the course source area shrank').toBeGreaterThanOrEqual(10)");
    expect(src).toContain("expect(SWEPT.filter((f) => f.includes('__tests__')), 'a test file is being swept').toEqual([])");
    expect(src, 'the containment check went behind the gate — a later branch that DOES change a '
      + 'course source file must still have it swept')
      .toContain("expect(touched.filter((f) => !SWEPT.includes(f)), 'a changed course source file is not swept').toEqual([])");
  });

  it('THE-312: the machinery is proven directly once the window has closed', () => {
    const src = read('src/components/__tests__/THE-312.settings-freeze-registers.test.tsx');
    expect(src).toContain("'changed() no longer answers, so the sweep cannot run'");
    expect(src).toContain("'isTestFile calls a source file a test — the sweep would pass over anything'");
    expect(src).toContain("'isTestFile no longer recognises a suite under __tests__'");
  });

  it('tailwind-v4: it states its own absence rather than passing silently', () => {
    const src = read('src/__tests__/tailwind-v4-migration.test.ts');
    expect(src).toContain('the base is already on v4 — this sweep is history and has nothing left to measure');
    expect(src, 'the v3-spelling scan over the whole tree is what stands on its own')
      .toContain('an application file changed by more than the v4 utility rename');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5-6 — the course emoji sweep, re-derived independently
 * ═══════════════════════════════════════════════════════════════════════════ */

const CONSTANTS = 'src/utils/course.constants.ts';

/** THE-311's swept set, re-derived here rather than imported — importing that
 *  file would run its suite twice. */
const SWEPT: string[] = [
  CONSTANTS,
  ...readdirSync(path.join(ROOT, 'src/components/course'), { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => `src/components/course/${e.name}`),
].sort();

/** U+FE0F is stripped, not matched: matched, it splits every marker in two and
 *  no allowlist can hold the orphan half. Dingbats (U+2600-27BF) are
 *  deliberately out — the repo's check and cross marks are not emoji. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/gu;
const strip = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*$/gm, ' ').replace(/\uFE0F/g, '');
const codeOf = (rel: string) => strip(read(rel));

describe('5 · the course emoji sweep still fails on a real emoji in course source', () => {
  it.each(SWEPT)('%s carries no emoji', (file) => {
    expect(codeOf(file).match(EMOJI) ?? [],
      `${file} renders an emoji — lucide-react is already imported`).toEqual([]);
  });

  it('and the sweep fires on a rendered glyph, so the stripping is not swallowing it', () => {
    // 🔴 The mutation this file must survive: put a real emoji in course source
    // and the case above fails. Proven here on a synthetic line so the proof
    // does not depend on anyone actually breaking the source.
    const withGlyph = codeOf(CONSTANTS) + '\nexport const X = "\u{1F534}";';
    expect(withGlyph.match(EMOJI) ?? [], 'the sweep does not fire on a rendered glyph').toHaveLength(1);
    // And a marker inside a comment is still tolerated, which is what makes the
    // repo's severity marks legal.
    const inComment = strip(read(CONSTANTS) + '\n// \u{1F534} a severity marker\n');
    expect(inComment.match(EMOJI) ?? [], 'a comment marker is no longer stripped').toEqual([]);
  });
});

describe('6 · the swept set is still non-empty and still excludes test files', () => {
  it('holds course.constants.ts, at least ten files, and no test file', () => {
    expect(SWEPT, 'course.constants.ts fell out of the sweep').toContain(CONSTANTS);
    expect(SWEPT.length, 'the course source area shrank').toBeGreaterThanOrEqual(10);
    expect(SWEPT.filter((f) => f.includes('__tests__')), 'a test file is being swept').toEqual([]);
  });

  it('and THE-311 still sweeps the same set, so the two cannot drift apart', () => {
    const src = read('src/components/course/__tests__/THE-311.course-palette.test.ts');
    expect(src).toContain("readdirSync(path.join(ROOT, 'src/components/course')");
    expect(src).toContain("const CONSTANTS = 'src/utils/course.constants.ts'");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 — no source file appears in this diff  (AND IT IS GATED ON THE BASE REF)
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The diff PLUS untracked files. `git diff` alone misses a file that has been
 *  added but not staged, and a NEW source file is exactly as much of a
 *  source-file-in-the-diff as an edited one. */
function changedPaths(): string[] {
  const lines = (args: string[]) => git(args).split('\n').filter(Boolean);
  return [...new Set([
    ...lines(['diff', '--name-only', baseRef()]),
    ...lines(['ls-files', '--others', '--exclude-standard']),
  ])].sort();
}

const isTestFile = (p: string) => /(^|\/)__tests__\//.test(p) || /\.test\.[cm]?[jt]sx?$/.test(p);

/**
 * 🔴 THE SELF-REFERENTIAL ONE. This is a branch-diff assertion — the exact
 * shape this file exists to retire — so it is held to its own rule. It stands
 * down on `landedOnBase`, and REGISTER carries an entry for it. Left ungated it
 * would be a permanent freeze on every source file in the repo: a fourth
 * occurrence, shipped by the ticket that came to remove three.
 *
 * ⚠️ THE GATE IS THE BASE REF, NOT THE DIFF, for the reason in the file header:
 * `if (this file is not in the diff) return` re-arms the sweep for any LATER
 * branch that edits this suite and freezes that branch's whole tree to test
 * files. THE-312 hit exactly that, and #450 records it.
 *
 * 🔴 WHY THIS RETURNS A REASON RATHER THAN AN ARRAY, and why it takes `self`.
 * The gate has to be PROVABLE, and the first draft proved it by grepping this
 * file for `if (landedOnBase(SELF)) return;` — which passed with the gate
 * deleted, because the assertion's own message contains that text. A guard
 * satisfied by its own source is exactly the "cannot fail" trap in the header,
 * reproduced while writing the file that polices it. So the two stand-downs are
 * DISTINGUISHABLE and the sweep can be pointed at another path: aimed at a file
 * already on the base ref it must answer `landed`, and with the gate removed it
 * answers `not-in-diff` instead. Behaviour, not text.
 */
type SweepResult = { stoodDown: 'landed' | 'not-in-diff' } | { offenders: string[] };

function sourceFilesInDiff(self: string = SELF): SweepResult {
  if (landedOnBase(self)) return { stoodDown: 'landed' };
  const paths = changedPaths();
  if (!paths.includes(self)) return { stoodDown: 'not-in-diff' };
  return { offenders: paths.filter((p) => !isTestFile(p)) };
}

describe('7 · no source file appears in this diff', () => {
  it('every path in the diff is a test file', () => {
    const result = sourceFilesInDiff();
    if ('stoodDown' in result) return;
    expect(result.offenders, 'THE-315 changes only test files, but these are not:\n  '
      + result.offenders.join('\n  ')).toEqual([]);
  });

  it('🔴 and this sweep is itself gated on the base ref — it is not a fourth freeze', () => {
    // Aimed at a suite that IS on the base ref. Only the gate can produce
    // `landed`; with it gone the sweep falls through to `not-in-diff`, so this
    // fails rather than being satisfied by the word appearing in this file.
    const onBase = 'src/components/course/__tests__/THE-311.course-palette.test.ts';
    expect(landedOnBase(onBase), 'the fixture suite is not on the base ref').toBe(true);
    expect(sourceFilesInDiff(onBase),
      'section 7 lost its base-ref gate — an ungated whole-tree freeze on every source file in the '
      + 'repo is the bug this ticket came to fix, reproduced by the ticket fixing it')
      .toEqual({ stoodDown: 'landed' });
    expect(REGISTER.some((e) => e.file === SELF && e.verdict === 'retired'),
      'THE-315 exempted its own sweep from the register it enforces').toBe(true);
  });

  it('and the machinery still answers, so the sweep cannot be a silent no-op', () => {
    expect(Array.isArray(changedPaths()), 'changedPaths() no longer answers').toBe(true);
    expect(isTestFile('src/components/AdminSettings.tsx'),
      'isTestFile calls a source file a test — the sweep would pass over anything').toBe(false);
    expect(isTestFile(SELF), 'isTestFile no longer recognises a suite under __tests__').toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 — every protected property is still asserted somewhere
 * ═══════════════════════════════════════════════════════════════════════════ */

const THE312 = 'src/components/__tests__/THE-312.settings-freeze-registers.test.tsx';
const THE311 = 'src/components/course/__tests__/THE-311.course-palette.test.ts';
const THE305 = 'src/components/__tests__/THE-305.install-reachable.test.tsx';

/**
 * ⚠️ Each row names the property and the assertion that OWNS it. This is a
 * meta-check, not a copy: re-asserting the eight delete-flow messages here
 * would create a second place for them to drift. What it catches is the
 * assertion GOING — which is the only way retiring a guard could quietly cost
 * the repo one of these.
 */
const DELETE_FLOW_MESSAGES = [
  'You are not signed in. Sign in again and retry.',
  'Could not reach the server. Check your connection and try again.',
  'Your account and sign-in have been deleted. Signing you out now.',
  'For your security, confirm your password to finish deleting your account.',
  'Enter your password to continue.',
  'Incorrect password. Try again.',
] as const;

const PROTECTED: readonly (readonly [string, string, string])[] = [
  // 🔴 The six verbatim messages ONE BY ONE, plus the count that carries the
  // two interpolated ones to eight. Naming the guard's `it.each` title instead
  // was the first draft, and dropping a message from the list left that title
  // untouched — so the row passed while the property it names was gone.
  ...DELETE_FLOW_MESSAGES.map((m) =>
    [`the delete-flow outcome message "${m}"`, THE312, m] as const),
  ['the eight delete-flow outcomes are still asserted as a set', THE312,
    'the outcome message "%s" is still asserted'],
  ['the delete-flow branch count (8 outcomes + 2 clears)', THE312, 'toBe(10); // 8 outcomes + 2 clears'],
  ['DELETE_CONFIRM_COPY, deep-equal to the live derivation', THE312, 'deriveErasureCopy(MEMBER_DATA_MAP)'],
  ["autosave's exclusions", THE312, 'AUTOSAVE_EXCLUDED'],
  ["autosave's visible failure", THE312, 'a failed save stays VISIBLE'],
  ['the three switched-off feature switches', THE312, 'the three switched-off sections are still asserted off'],
  ['assertSendOnlyGmailScopes failing closed', THE312, 'assertSendOnlyGmailScopes is still asserted to fail closed'],
  ['the add-on `||` lift', THE312, 'the add-on lift is `||`, never assignment'],
  ['the client-side `plan` sweep', THE312, 'nothing writes `plan` from the client'],
  ['the no-price-literal rule', THE312, 'no price literals — prices go through formatPlanPrice'],
  ["the install control's reachability", THE312, 'the install control is still asserted reachable'],
  ["regroup's 10-class allowlist", THE312, "regroup's 10-class allowlist is unchanged"],
  ['the settings freeze register', THE312, 'validateRegister'],
  ['the course emoji sweep', THE311, 'no emoji in the course source'],
  ['the install control is not gated on beforeinstallprompt', THE305, 'beforeinstallprompt'],
];

describe('8 · every protected property is still asserted somewhere', () => {
  it.each(PROTECTED.map((r) => [r[0], r] as const))('%s', (_name, [property, file, anchor]) => {
    expect(read(file), `${property}: the assertion that owns it is gone from ${file}`)
      .toContain(anchor);
  });

  it('and the list itself has not been quietly shortened', () => {
    // An entry silently dropped from PROTECTED would make its row vacuous, so
    // the count is pinned the way the repo pins every other allowlist.
    expect(PROTECTED).toHaveLength(21);
    expect(DELETE_FLOW_MESSAGES).toHaveLength(6); // + 2 interpolated = the eight
    expect(new Set(PROTECTED.map((r) => r[0])).size, 'a duplicate row is padding the count')
      .toBe(PROTECTED.length);
  });
});
