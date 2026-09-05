import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import UNTOUCHED from './__fixtures__/the-286-untouched.json';
import {
  FROZEN_FILES,
  MIN_REASON_LENGTH,
  RECORDED_EDITS,
  REPO_ROOT,
  acceptedFor,
  freezeFailure,
  freezeFailureFor,
  sha256File,
  validateRegister,
  type RecordedEdit,
} from './__fixtures__/settings-freeze-register';

/**
 * THE-312 — six guards froze the settings screens with no way through.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE-310 was asked to redesign the settings and My Profile screens. It planted
 * a one-comment-line edit in each of five files, ran the suite, watched ELEVEN
 * assertions across SIX files go red, and stopped before writing a line. It was
 * right to. Every one of those guards was correct on the ticket that wrote it —
 * each was told "do not touch AdminSettings", each obeyed, each pinned it — and
 * together they made four surfaces unmodifiable, because not one of them had a
 * way to record a DELIBERATE change.
 *
 * 🔴 This ticket adds an APPEND PATH to each guard and REMOVES NOT ONE PIN. The
 * proof that it is a register and not a hole is test 3 below: an unrecorded
 * edit to each of the five files must still fail.
 *
 * 🔴 THE-312 CHANGES ONLY TEST FILES. Test 7 sweeps the diff and asserts it.
 */

const ROOT = REPO_ROOT;
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Each guard, the file it freezes, and where its append path now is. */
const GUARDS = [
  {
    guard: 'THE-296 · AdminSettings.tsx itself is untouched',
    suite: 'src/components/__tests__/THE-296.settings-sections.test.tsx',
    freezes: [FROZEN_FILES.adminSettings],
    baselines: { [FROZEN_FILES.adminSettings]: 'fa75caa9825fd36b1d12ae3472405e005469abe282bd2e26b1177ae6bd7885d9' },
  },
  {
    guard: 'THE-300 · this slice did not touch AdminSettings or its suite',
    suite: 'src/components/__tests__/THE-300.billing-surface.test.tsx',
    freezes: [FROZEN_FILES.adminSettings, FROZEN_FILES.regroupSuite],
    baselines: {
      [FROZEN_FILES.adminSettings]: 'fa75caa9825fd36b1d12ae3472405e005469abe282bd2e26b1177ae6bd7885d9',
      [FROZEN_FILES.regroupSuite]: '21c298f212d32cb93f66d41fb5a5d3804712c2a571c5ad482acd11b2edda9784',
    },
  },
  {
    guard: 'THE-286/296/300 · the chrome is untouched (UNTOUCHED.chrome)',
    suite: 'src/components/__tests__/THE-286.settings-chrome-autosave.test.tsx',
    freezes: [FROZEN_FILES.sectionHeading, FROZEN_FILES.settingsAccordion],
    baselines: UNTOUCHED.chrome as Record<string, string>,
  },
  {
    guard: 'THE-286/296 · protected-flow digests (UNTOUCHED.protectedFlows)',
    suite: 'src/components/__tests__/THE-286.settings-chrome-autosave.test.tsx',
    freezes: [FROZEN_FILES.personalInformationModal],
    baselines: UNTOUCHED.protectedFlows as Record<string, string>,
  },
  {
    guard: 'THE-292 · PersonalInformationModal.tsx is byte-identical',
    suite: 'src/components/__tests__/THE-292.country-prompt.test.tsx',
    freezes: [FROZEN_FILES.personalInformationModal],
    baselines: { [FROZEN_FILES.personalInformationModal]: 'c62dd16e810bd1d75bd3bc6e3cae1ee698fdcf4d9ec67d870dc833d76b1b1975' },
  },
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — each of the six guards has a documented append path
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('1 · each of the six guards has a documented append path', () => {
  it.each(GUARDS.map((g) => [g.guard, g] as const))(
    '%s routes its digest through the register',
    (_name, g) => {
      const src = read(g.suite);
      expect(src, `${g.suite} no longer imports the register`)
        .toContain("from './__fixtures__/settings-freeze-register'");
      expect(src, `${g.suite} stopped calling freezeFailure — its pin has no append path`)
        .toContain('freezeFailure(');
      // And the file it freezes is one the register knows, so an entry for it
      // is accepted rather than rejected as "not one of the frozen files".
      for (const file of g.freezes) {
        expect(Object.values(FROZEN_FILES), `${file} is frozen but the register does not know it`)
          .toContain(file);
      }
    },
  );

  it("THE-305's three are answered behaviourally, not by a register", () => {
    // 🔴 They are not digests. They run `git diff --name-only origin/main` and
    // assert the file does not appear, so they fail on ANY edit at ANY value
    // and no digest register can reach them. Each was replaced by an assertion
    // of the property it was standing in for — see test 5.
    const install = read('src/components/__tests__/THE-305.install-reachable.test.tsx');
    const editor = read('src/components/__tests__/THE-305.course-editor-header.test.tsx');
    for (const [name, src] of [['install-reachable', install], ['course-editor-header', editor]] as const) {
      expect(src, `${name} still freezes Profile.tsx by diff`)
        .not.toMatch(/changedSince\([^)]*['"]src\/components\/Profile\.tsx['"]/s);
      expect(src, `${name} still freezes PersonalInformationModal.tsx by diff`)
        .not.toMatch(/changedSince\([^)]*['"]src\/components\/PersonalInformationModal\.tsx['"]/s);
    }
  });

  it('the register documents how to append, in the file a blocked ticket will open', () => {
    const reg = read('src/components/__tests__/__fixtures__/settings-freeze-register.ts');
    for (const marker of ['How a future ticket records an edit', 'RECORDED_EDITS', 'createHash', 'APPENDED, NEVER SUBSTITUTED']) {
      expect(reg, `the register stopped documenting "${marker}"`).toContain(marker);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — each register requires a TICKET and a REASON per entry
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('2 · each register requires a ticket AND a reason per entry, not a bare hash', () => {
  const DIGEST = 'a'.repeat(64);
  const REASON = 'x'.repeat(MIN_REASON_LENGTH + 1);
  const good: RecordedEdit = { file: FROZEN_FILES.adminSettings, ticket: 'THE-999', why: REASON, digest: DIGEST };

  it('the register as checked in is valid', () => {
    expect(validateRegister(), validateRegister().join('\n')).toEqual([]);
  });

  it('a complete entry is accepted', () => {
    expect(validateRegister([good])).toEqual([]);
  });

  it('an entry with no ticket is refused', () => {
    expect(validateRegister([{ ...good, ticket: '' }]).join(' ')).toMatch(/no ticket/);
    expect(validateRegister([{ ...good, ticket: 'because' }]).join(' ')).toMatch(/no ticket/);
  });

  it('an entry with no reason — a bare hash — is refused', () => {
    expect(validateRegister([{ ...good, why: '' }]).join(' ')).toMatch(/no reason/);
    expect(validateRegister([{ ...good, why: 'cleanup' }]).join(' ')).toMatch(/no reason/);
  });

  it('🔴 an entry with no digest is refused — that would exempt the file entirely', () => {
    expect(validateRegister([{ ...good, digest: '' }]).join(' ')).toMatch(/no sha256 digest/);
    expect(validateRegister([{ ...good, digest: 'deadbeef' }]).join(' ')).toMatch(/no sha256 digest/);
  });

  it('an entry naming a file no guard freezes is refused', () => {
    expect(validateRegister([{ ...good, file: 'src/components/AdminDashboard.tsx' }]).join(' '))
      .toMatch(/not one of the frozen files/);
  });

  it('the reason floor is the one EDITED_SINCE_MEASUREMENT already sets', () => {
    expect(MIN_REASON_LENGTH).toBe(80);
    expect(read('src/components/__tests__/THE-286.settings-chrome-autosave.test.tsx'))
      .toContain('toBeGreaterThan(80)');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — 🔴 an UNRECORDED one-line edit to each of the five files still fails
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('3 · an UNRECORDED one-line edit still fails, per file', () => {
  /**
   * 🔴 THE TEST THAT PROVES THIS IS A REGISTER AND NOT A HOLE.
   *
   * It takes each file's REAL bytes, appends the one comment line THE-310
   * planted, and asks the register what it makes of the result. Rejection is
   * the only acceptable answer. Nothing is written to disk: the mechanism is
   * pure, so the proof does not need to vandalise the tree to run in CI.
   * (The same edit was also planted on disk during development and the eleven
   * assertions went red exactly as before — see the PR body.)
   */
  const PLANTED = '\n// THE-312 probe\n';
  const FIVE: ReadonlyArray<readonly [label: string, file: string, baseline: string]> = [
    ['AdminSettings.tsx', FROZEN_FILES.adminSettings, 'fa75caa9825fd36b1d12ae3472405e005469abe282bd2e26b1177ae6bd7885d9'],
    ['SectionHeading.tsx', FROZEN_FILES.sectionHeading, (UNTOUCHED.chrome as Record<string, string>)[FROZEN_FILES.sectionHeading]],
    ['SettingsAccordion.tsx', FROZEN_FILES.settingsAccordion, (UNTOUCHED.chrome as Record<string, string>)[FROZEN_FILES.settingsAccordion]],
    ['Profile.tsx', FROZEN_FILES.profile, '5dc505b0b508b583f71f4a16da8cb55c29236327605a31940cec03c79ee22ae9'],
    ['PersonalInformationModal.tsx', FROZEN_FILES.personalInformationModal, 'c62dd16e810bd1d75bd3bc6e3cae1ee698fdcf4d9ec67d870dc833d76b1b1975'],
  ];

  it.each(FIVE)('an unrecorded edit to %s is rejected', (label, file, baseline) => {
    const edited = createHash('sha256')
      .update(Buffer.concat([readFileSync(path.join(ROOT, file)), Buffer.from(PLANTED)]))
      .digest('hex');
    const failure = freezeFailureFor(file, baseline, edited);
    expect(failure, `🔴 an unrecorded edit to ${label} PASSED — that is a loophole, not a register`)
      .not.toBeNull();
    expect(failure!, 'the failure does not name the file').toContain(file);
    expect(failure!, 'the failure does not say how to record the change').toContain('RECORDED_EDITS');
  });

  it('and an unrecorded edit is rejected even when SOME OTHER file is recorded', () => {
    // A register keyed on the wrong file must not launder an edit to this one.
    const other: RecordedEdit = {
      file: FROZEN_FILES.settingsAccordion,
      ticket: 'THE-999',
      why: 'x'.repeat(MIN_REASON_LENGTH + 1),
      digest: 'b'.repeat(64),
    };
    expect(freezeFailureFor(FROZEN_FILES.adminSettings, 'c'.repeat(64), 'd'.repeat(64), [other])).not.toBeNull();
  });

  /**
   * ⚠️ THROUGH THE REGISTER, not against the literal directly. A raw
   * `toBe(baseline)` here would be a SEVENTH freeze with no append path —
   * shipped by the very ticket whose job is to remove them — and would block
   * the redesign from this suite the moment it recorded an edit anywhere else.
   */
  it('every one of the five is at an accepted digest right now — THE-312 edited no source file', () => {
    for (const [label, file, baseline] of FIVE) {
      expect(freezeFailure(file, baseline), `${label} is at an unrecorded digest`).toBeNull();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — a RECORDED edit passes
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('4 · a RECORDED edit passes — the register works', () => {
  it.each(Object.values(FROZEN_FILES))('a recorded edit to %s is accepted', (file) => {
    const edited = createHash('sha256')
      .update(Buffer.concat([readFileSync(path.join(ROOT, file)), Buffer.from('\n// recorded\n')]))
      .digest('hex');
    const entry: RecordedEdit = {
      file,
      ticket: 'THE-999',
      why:
        'The redesign ticket moved this surface deliberately, and this entry is the record: '
        + 'the digest below is the state it left the file in, and every guard on it accepts '
        + 'that value and nothing else.',
      digest: edited,
    };
    expect(validateRegister([entry])).toEqual([]);
    expect(freezeFailureFor(file, 'e'.repeat(64), edited, [entry])).toBeNull();
    // And the baseline is still accepted alongside it — APPENDED, not substituted.
    expect(freezeFailureFor(file, 'e'.repeat(64), 'e'.repeat(64), [entry])).toBeNull();
    // But a THIRD value, recorded by nobody, is not.
    expect(freezeFailureFor(file, 'e'.repeat(64), 'f'.repeat(64), [entry])).not.toBeNull();
  });

  it('the accepted set names its provenance, entry by entry', () => {
    const entry: RecordedEdit = {
      file: FROZEN_FILES.adminSettings,
      ticket: 'THE-999',
      why: 'A stated reason long enough to be a real one, describing what changed and why it was safe to change it.',
      digest: 'a'.repeat(64),
    };
    const accepted = acceptedFor(FROZEN_FILES.adminSettings, 'b'.repeat(64), [entry]);
    expect(accepted).toHaveLength(2);
    expect(accepted[0][1]).toContain('baseline');
    expect(accepted[1][1]).toContain('THE-999');
    expect(accepted[1][1]).toContain('safe to change it');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — THE-305's three assert their real property behaviourally
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("5 · THE-305's three guards assert their real property behaviourally", () => {
  const INSTALL = 'src/components/__tests__/THE-305.install-reachable.test.tsx';
  const EDITOR = 'src/components/__tests__/THE-305.course-editor-header.test.tsx';

  it('install-reachable · the delete flow is asserted by content, not by freezing the file', () => {
    const src = read(INSTALL);
    // The old "still spells all eight outcome messages and the confirm copy"
    // asserted NEITHER — it grepped for two identifiers. THE-292's standard:
    // no half-guards. These are the properties, stated.
    expect(src).toContain('Incorrect password. Try again.');
    expect(src).toContain('Your account and sign-in have been deleted. Signing you out now.');
    expect(src).toContain("type DeleteFlowState = 'idle' | 'deleting' | 'reauth' | 'error' | 'done'");
    expect(src).toContain('reauthenticateWithCredential');
    expect(src).toContain('/api/account/delete');
    expect(src).toContain('deriveErasureCopy(MEMBER_DATA_MAP)');
  });

  it('install-reachable · the install control is asserted by MOUNTING Profile, not by freezing it', () => {
    const src = read(INSTALL);
    expect(src).toContain('installControl(await settings())');
    expect(src, 'the "not gated on beforeinstallprompt" claim is gone').toContain('beforeinstallprompt');
  });

  it('course-editor-header · the editor is asserted not to reach into the settings surfaces', () => {
    const src = read(EDITOR);
    expect(src).toContain('reaches into neither settings surface');
    // And the five files that are genuinely a parallel ticket's stay frozen —
    // THE-312 unlocks the settings surfaces and nothing else.
    for (const still of ['AdminForms.tsx', 'AdminFundraising.tsx', 'AdminDonations.tsx',
                         'AdminAccounting.tsx', 'PublicPledge.tsx']) {
      expect(src, `${still} was unlocked, which is outside this ticket`).toContain(still);
    }
  });

  it('🔵 and none of the three needed the file frozen — reported, with the reason', () => {
    // The finding, asserted so it cannot rot: each of THE-305's three was a
    // stand-in for a property that is directly assertable. None required
    // byte-identity, so no surface is reported back as un-editable on their
    // account.
    expect(read(INSTALL)).toContain('THE-312 REPLACED TWO FILE-LEVEL FREEZES WITH THE PROPERTY THEY WERE FOR');
    expect(read(EDITOR)).toContain('THE-312 NARROWED THIS FREEZE TO THE FILES IT IS ACTUALLY ABOUT');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — tests can be added to AdminSettings.regroup.test.tsx
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('6 · tests can be added to AdminSettings.regroup.test.tsx', () => {
  it("THE-300's self-pin on that suite now has an append path", () => {
    const src = read('src/components/__tests__/THE-300.billing-surface.test.tsx');
    expect(src).toMatch(
      /freezeFailure\(\s*'src\/components\/__tests__\/AdminSettings\.regroup\.test\.tsx',/,
    );
  });

  it('and an added test would be accepted once recorded', () => {
    const withTest = createHash('sha256')
      .update(Buffer.concat([
        readFileSync(path.join(ROOT, FROZEN_FILES.regroupSuite)),
        Buffer.from("\nit('a new case', () => { expect(1).toBe(1); });\n"),
      ]))
      .digest('hex');
    const entry: RecordedEdit = {
      file: FROZEN_FILES.regroupSuite,
      ticket: 'THE-999',
      why: 'Added a case to the regroup suite. THE-300 pinned this file to stop the suite being WEAKENED; '
        + 'adding a case strengthens it, and the digest below records the state it was added in.',
      digest: withTest,
    };
    expect(validateRegister([entry])).toEqual([]);
    expect(freezeFailureFor(FROZEN_FILES.regroupSuite,
      '21c298f212d32cb93f66d41fb5a5d3804712c2a571c5ad482acd11b2edda9784', withTest, [entry])).toBeNull();
    // Unrecorded, it is still refused — so a WEAKENING still has to be declared.
    expect(freezeFailureFor(FROZEN_FILES.regroupSuite,
      '21c298f212d32cb93f66d41fb5a5d3804712c2a571c5ad482acd11b2edda9784', withTest)).not.toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 — 🔴 no source file appears in this diff
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('7 · no source file appears in this diff', () => {
  /**
   * ⚠️ `git diff --name-only` against the base ref, run ONCE here and nowhere
   * else, and never `git show`. THE-277's guard shells out to `git diff HEAD`
   * and so fails on uncommitted changes and passes once committed; this one
   * compares against the base ref, which is the mechanism THE-305 already uses.
   *
   * 🔴 AND IT RETIRES ITSELF. A permanent `git diff origin/main` sweep over the
   * whole tree is a freeze on every source file in the repo — precisely the
   * defect this ticket exists to remove, and it would be absurd to ship a new
   * one while removing six. So the sweep runs only while THIS SUITE is itself
   * part of the diff, i.e. on THE-312's own branch. Once THE-312 lands, the
   * suite is in the base ref, the sweep has no PR left to police, and it stands
   * down — leaving the register (which every ticket after this one uses) as the
   * thing that guards the surfaces.
   */
  function baseRef(): string {
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    for (const ref of ['origin/main', 'refs/remotes/origin/main', 'main']) {
      try { return git(['rev-parse', '--verify', `${ref}^{commit}`]); } catch { /* next */ }
    }
    try {
      const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/);
      if (parents.length === 3) return parents[1];
    } catch { /* fall through */ }
    throw new Error('the base commit could not be resolved, so "only test files changed" would measure nothing');
  }

  const SELF = 'src/components/__tests__/THE-312.settings-freeze-registers.test.tsx';

  /** A path is TEST SUPPORT if it is a spec or lives under a __tests__ tree. */
  const isTestFile = (p: string) =>
    /(^|\/)__tests__\//.test(p) || /\.test\.[cm]?[jt]sx?$/.test(p);

  /**
   * The diff, PLUS untracked files. ⚠️ `git diff` alone misses a file that has
   * been added but not staged — and a NEW source file is exactly as much of a
   * source-file-in-the-diff as an edited one.
   */
  const changed = (): string[] => {
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    return [...new Set([
      ...git(['diff', '--name-only', baseRef()]),
      ...git(['ls-files', '--others', '--exclude-standard']),
    ])].sort();
  };

  /**
   * Has THE-312 LANDED? i.e. does the base ref already carry this suite?
   *
   * 🔴 THE STAND-DOWN SIGNAL, AND IT IS DELIBERATELY NOT `changed()`.
   *
   * The block header above sets out this sweep's lifecycle: "Once THE-312
   * lands, the suite is in the base ref, the sweep has no PR left to police,
   * and it stands down." Asking the DIFF whether this file is in it looked like
   * the same question and is not: it re-arms the sweep for any LATER branch
   * that edits this suite, and freezes that branch's whole tree to test files.
   *
   * ⚠️ THAT IS NOT HYPOTHETICAL — IT IS THE FIRST TICKET TO USE THE REGISTER.
   * The append path this module exists to provide can only be used by editing
   * `RECORDED_EDITS`, and the case below asserts what the register may contain,
   * so a ticket that records an edit MUST touch this suite. Under the old
   * signal that ticket inherited "every path in the diff is a test file" and
   * could not also change a source file — which is every real ticket. THE-314
   * is the first to hit it.
   *
   * The base ref is independent of the diff, so the guard keeps its FULL force
   * for the whole window it can have any: while THE-312 is unmerged the base
   * ref does not carry this file, this returns false, and the sweep runs.
   */
  const landedOnBase = (): boolean => {
    try {
      execFileSync('git', ['cat-file', '-e', `${baseRef()}:${SELF}`], {
        cwd: ROOT,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return true;
    } catch {
      return false;
    }
  };

  it('every path in the diff is a test file', () => {
    // 🔴 STOOD DOWN ON THE BASE REF, not on the diff — see `landedOnBase()`.
    // THE-312 has landed, so there is no PR left to police and the surfaces are
    // guarded by the register, asserted in the next case. The diff-based signal
    // this replaces re-armed the sweep for any later branch that edited this
    // suite, which is exactly what using the register requires.
    if (landedOnBase()) return;
    const paths = changed();
    if (!paths.includes(SELF)) return;
    const offenders = paths.filter((p) => !isTestFile(p));
    expect(offenders, `THE-312 changes only test files, but these are not:\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });

  it('and the five surfaces are at register-accepted digests', () => {
    // 🔴 Through the register, so this is not a seventh freeze. On THE-312's own
    // branch the register is empty, so this says exactly "unchanged".
    for (const [file, baseline] of [
      [FROZEN_FILES.adminSettings, 'fa75caa9825fd36b1d12ae3472405e005469abe282bd2e26b1177ae6bd7885d9'],
      [FROZEN_FILES.sectionHeading, (UNTOUCHED.chrome as Record<string, string>)[FROZEN_FILES.sectionHeading]],
      [FROZEN_FILES.settingsAccordion, (UNTOUCHED.chrome as Record<string, string>)[FROZEN_FILES.settingsAccordion]],
      [FROZEN_FILES.profile, '5dc505b0b508b583f71f4a16da8cb55c29236327605a31940cec03c79ee22ae9'],
      [FROZEN_FILES.personalInformationModal, 'c62dd16e810bd1d75bd3bc6e3cae1ee698fdcf4d9ec67d870dc833d76b1b1975'],
    ] as const) {
      expect(freezeFailure(file, baseline)).toBeNull();
    }
  });

  it('the sweep is live on this branch — it has not quietly become a no-op', () => {
    /**
     * ⚠️ AMENDED. As first written this assertion could only ever hold while
     * THE-312 was UNMERGED: it required THIS SUITE to be in the diff against
     * `origin/main`, which stops being true the moment THE-312 lands — and it
     * landed in #448. So `main` went red the instant it merged, and so did the
     * next branch cut from it, for a reason that has nothing to do with either.
     *
     * 🔴 THE CLAIM IS KEPT, NOT DROPPED, AND NOT LOOSENED. What it exists to
     * prevent is the escape hatch in the case above silently swallowing the
     * sweep. That is still asserted, in each of the two states that exist:
     *
     *   • THE-312 UNMERGED — this suite IS in the diff, so the sweep above must
     *     have run over it. Byte-for-byte the original check.
     *   • THE-312 MERGED — there is nothing left to sweep, which is exactly
     *     what the hatch says and is now true rather than a bug. So the
     *     MACHINERY is proven directly instead: `changed()` must still answer,
     *     and `isTestFile` must still tell a source path from a test path. A
     *     classifier that had rotted into answering `true` to everything — the
     *     actual way this could become a no-op — fails right here.
     *
     * ⚠️ WHY THIS IS FIXED IN A PR OF ITS OWN. Section 7's other assertion
     * sweeps the diff only WHEN THIS FILE IS IN IT, and demands every path in
     * that diff be a test file. That is right for THE-312's own branch and
     * inherited by any later branch that edits this file — so a ticket which
     * touches source AND fixes this would have had to loosen that rule too.
     * This branch touches nothing but this suite, so the rule holds unchanged.
     */
    // 🔴 RETIRED ONCE THE-312 HAS LANDED, and #448 is when that happened —
    // the same conclusion #451 reaches, by the same signal and under the same
    // name, so the two reconcile mechanically if both land.
    if (landedOnBase()) {
      // The window has closed. The MACHINERY is proven directly instead, so a
      // classifier rotted into answering `true` to everything — the actual way
      // this could become a no-op — still fails here.
      expect(Array.isArray(changed()), 'changed() no longer answers, so the sweep cannot run').toBe(true);
      expect(isTestFile('src/components/AdminSettings.tsx'),
        'isTestFile calls a source file a test — the sweep would pass over anything').toBe(false);
      expect(isTestFile(SELF), 'isTestFile no longer recognises a suite under __tests__').toBe(true);
      return;
    }
    const paths = changed();
    expect(paths, 'the diff does not contain this suite, so the sweep skipped itself').toContain(SELF);
    expect(Array.isArray(paths), 'changed() no longer answers, so the sweep cannot run').toBe(true);
    expect(isTestFile('src/components/AdminSettings.tsx'),
      'isTestFile calls a source file a test — the sweep would pass over anything').toBe(false);
    expect(isTestFile(SELF), 'isTestFile no longer recognises a suite under __tests__').toBe(true);
  });

  it('the register itself carries no THE-312 edit', () => {
    /* ⚠️ THE SAME LIFECYCLE THE SIBLING ASSERTION ABOVE HAD, and the same
       treatment — kept, not dropped. This read `toEqual([])`, which was true for
       exactly as long as THE-312 was the newest ticket, and which FORBIDS THE
       MECHANISM THIS WHOLE MODULE EXISTS TO PROVIDE: the register's own docblock
       says "the next ticket to move one of these files appends here", so the
       first ticket to use the append path would have failed here for using it.
       THE-314 is that ticket.

       🔴 THE CLAIM IS UNCHANGED AND STILL CHECKABLE FOREVER. What THE-312
       asserts about itself is that it edits no source file and therefore records
       no edit of its own — and that stays true however many later tickets
       append. It also keeps real force: it is exactly the assertion that catches
       an edit smuggled in under a merged ticket's name, which is the one way a
       recorded edit could pretend to have been reviewed when it was not.

       The register's own validation — a mandatory digest, a ticket matching
       TICKET_RE and a reason over MIN_REASON_LENGTH on every entry — is
       asserted separately above and is what keeps the LATER entries honest. */
    expect(RECORDED_EDITS.filter((e) => e.ticket === 'THE-312'),
      'THE-312 edits no source file, so it records none').toEqual([]);
    // And the register is still validated as a whole, entry by entry, so a
    // later append cannot be a bare hash with no story.
    expect(() => validateRegister(RECORDED_EDITS)).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8-13 — nothing the guards protect was weakened
 * ═══════════════════════════════════════════════════════════════════════════ */
const THE286 = 'src/components/__tests__/THE-286.settings-chrome-autosave.test.tsx';
const THE296 = 'src/components/__tests__/THE-296.settings-sections.test.tsx';
const THE300 = 'src/components/__tests__/THE-300.billing-surface.test.tsx';

describe('8 · the account-deletion flow is still fully asserted', () => {
  const EIGHT = [
    'You are not signed in. Sign in again and retry.',
    'Could not reach the server. Check your connection and try again.',
    'Your account and sign-in have been deleted. Signing you out now.',
    'For your security, confirm your password to finish deleting your account.',
    'Enter your password to continue.',
    'Incorrect password. Try again.',
  ];

  it.each(EIGHT)('the outcome message "%s" is still asserted', (message) => {
    expect(read(THE286), 'an outcome message left the guard').toContain(message);
  });

  it('the two interpolated branches are still counted, so all EIGHT are covered', () => {
    // 6 verbatim + 2 multi-line ones counted by setter calls = 8 outcomes.
    expect(read(THE286)).toContain('toBe(10); // 8 outcomes + 2 clears');
  });

  it('the state machine, the silent-failure fix and the re-auth path are still asserted', () => {
    const src = read(THE286);
    expect(src).toContain("type DeleteFlowState = 'idle' | 'deleting' | 'reauth' | 'error' | 'done'");
    expect(src).toContain('reauthenticateWithCredential');
    expect(src).toContain('handleReauthAndDelete');
    expect(src).toContain('/api/account/delete');
  });

  it('DELETE_CONFIRM_COPY is still asserted deep-equal to the live MEMBER_DATA_MAP derivation', () => {
    expect(read(THE286)).toContain('deriveErasureCopy(MEMBER_DATA_MAP)');
    expect(read(THE286)).toContain('assertCopyCoversMap(MEMBER_DATA_MAP)');
  });

  it('and the modal still carries every one of them', () => {
    const modal = read(FROZEN_FILES.personalInformationModal);
    for (const message of EIGHT) expect(modal).toContain(message);
    expect([...modal.matchAll(/setDeleteMessage\(/g)]).toHaveLength(10);
  });
});

describe('9 · autosave, its exclusions and its visible failure are still asserted', () => {
  it('the 2000ms debounce, the blur flush and the saveSeq staleness guard', () => {
    const src = read(THE286);
    expect(src, 'the debounce is no longer asserted').toMatch(/2000/);
    expect(src, 'the blur flush is no longer asserted').toMatch(/blur/i);
    // ⚠️ The guard is `AdminDocs.saveSeq`'s idiom, extracted into autosave.ts as
    // a monotonic `seq` ref: an older in-flight save may not raise an alarm
    // about a value a newer one already saved. Asserted by its behaviour.
    expect(src, 'the staleness guard is no longer asserted')
      .toContain('a stale failure cannot raise an alarm about a value already saved');
    const autosave = read('src/components/settings/autosave.ts');
    expect(autosave, 'the monotonic sequence guard left autosave.ts').toContain('const seq = useRef(0)');
    expect(autosave).toContain('const isLatest = () => seq.current === mine;');
    expect(autosave, 'the guard stopped citing where it came from').toContain('AdminDocs.saveSeq');
  });

  it('🔴 a failed save stays VISIBLE — it is not swallowed into a console line', () => {
    const src = read(THE286);
    expect(src, 'the visible-failure assertion is gone')
      .toContain('a failed autosave left no visible marker in the field');
    // And it is asserted by MOUNTING and reading the DOM — role="alert", so it
    // reaches a screen reader — not by grepping the source for a word.
    expect(src, 'the failure marker stopped being read out of the DOM')
      .toContain('host.querySelector(\'[role="alert"]\')');
    expect(src, 'the edit-survives claim is gone').toContain('THE EDIT SURVIVES');
    expect(src, 'the marker is allowed to be transient again')
      .toContain('the marker persists — it is not a transient that clears itself');
  });

  it('the exclusion list — plan, add-ons and the billing term do not autosave', () => {
    const src = read(THE286) + read(THE300);
    expect(src).toContain('AUTOSAVE_EXCLUDED');
    for (const excluded of ['PlanUpgradeSection', 'AddOnsSection', 'BillingTermToggle']) {
      expect(src, `${excluded} left the autosave exclusion list`).toContain(excluded);
    }
  });
});

describe('10 · the three switched-off sections are still asserted off', () => {
  /**
   * 🔴 Asserted as the TERNARY THAT CHOOSES, not as the switch spelled as a
   * word. Deleting the switch from the JSX leaves the identifier behind in the
   * import, so a guard that greps for the name would still pass on a section
   * that had been switched back on.
   */
  it('PaymentSection — Stripe Connect, by the expression that mounts the panel', () => {
    const src = read(THE286);
    expect(src, 'the Stripe Connect master switch is no longer asserted false')
      .toContain('STRIPE_CONNECT_ENABLED\\s*=\\s*false');
    expect(src, 'the ternary that chooses the panel is no longer asserted')
      .toContain('STRIPE_CONNECT_ENABLED\\s*\\?\\s*<StripeConnectPanel\\s*\\/>');
    expect(src, 'the unavailable state is no longer asserted').toContain('STRIPE_CONNECT_HIDDEN_MESSAGE');
  });

  it('DomainSection — custom domains, by the hidden branch', () => {
    const src = read(THE286);
    expect(src, 'the custom-domain master switch is no longer asserted false')
      .toContain('CUSTOM_DOMAIN_ENABLED\\s*=\\s*false');
    expect(src, 'the hidden branch is no longer asserted').toContain('!CUSTOM_DOMAIN_ENABLED\\s*\\?');
  });

  it('SmsSection — the row still follows its switch (THE-250)', () => {
    expect(read(THE300), 'the SMS row stopped being asserted against its switch')
      .toContain('hidden:\\s*!SMS_FEATURE_ENABLED');
  });

  it('and all three switches are still false in the source', () => {
    expect(read('src/lib/stripe-connect-feature.ts')).toMatch(/STRIPE_CONNECT_ENABLED\s*=\s*false/);
    expect(read('src/lib/custom-domain-feature.ts')).toMatch(/CUSTOM_DOMAIN_ENABLED\s*=\s*false/);
    expect(read(FROZEN_FILES.adminSettings)).toMatch(/hidden:\s*!SMS_FEATURE_ENABLED/);
  });
});

describe('11 · assertSendOnlyGmailScopes is still asserted to fail closed', () => {
  it('🔴 it fails CLOSED — Harvest must never hold a scope that can read a church inbox', async () => {
    const { assertSendOnlyGmailScopes, GMAIL_SEND_SCOPE } = await import('@/lib/gmail-scopes');
    const cfg = (scopes: string[] | null) => ({ toolkitSlug: 'gmail', isComposioManaged: true, scopes });

    // 🔴 FAILS CLOSED. No declared scopes means Composio's defaults, which read
    // mail — so silence must throw, not pass.
    expect(() => assertSendOnlyGmailScopes(cfg(null))).toThrow(/fail|no OAuth scopes/i);
    expect(() => assertSendOnlyGmailScopes(cfg([]))).toThrow();

    // Every inbox-reading scope is a refusal, not a warning.
    for (const reading of [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.metadata',
      'https://mail.google.com/',
    ]) {
      expect(() => assertSendOnlyGmailScopes(cfg([GMAIL_SEND_SCOPE, reading])),
        `${reading} is no longer refused`).toThrow(/beyond send-only/);
    }

    // A config that only asked for identity scopes would connect and then fail
    // every send — also a refusal.
    expect(() => assertSendOnlyGmailScopes(cfg(['https://www.googleapis.com/auth/userinfo.email'])))
      .toThrow(/missing/);

    // And send-only is accepted.
    expect(assertSendOnlyGmailScopes(cfg([GMAIL_SEND_SCOPE]))).toEqual([GMAIL_SEND_SCOPE]);
  });

  it('and its own suite still asserts it', () => {
    const suites = readdirSync(path.join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
      .filter((p) => /\.test\.[jt]sx?$/.test(p))
      .filter((p) => read(path.join('src', p)).includes('assertSendOnlyGmailScopes'));
    expect(suites.length, 'nothing asserts assertSendOnlyGmailScopes any more').toBeGreaterThan(0);
  });
});

describe('12 · the add-on lift, the plan-write sweep and the no-price-literal rule', () => {
  it('🔴 the add-on lift is `||`, never assignment', async () => {
    const src = read(THE300);
    expect(src, "THE-300's entitlement-lift section is gone")
      .toContain('the add-on entitlement lift is still `||`, never assignment');
    expect(src, 'the lift is no longer RUN, only read')
      .toContain('RUN, not read: the lift really behaves as a lift in every direction');

    // 🔴 And run it here too — a source match alone would pass a defect that
    // moved the lift somewhere else. #436 shipped two guards a planted defect
    // walked straight through.
    const { getEffectiveFeatures, getPlanFeatures, PLAN_ORDER, NO_ADDONS } =
      await import('@/utils/plan-features');
    const held = { ...NO_ADDONS, aiAssistant: 1 };
    for (const tier of PLAN_ORDER) {
      const base = getPlanFeatures(tier);
      // Holding the add-on ALWAYS grants it.
      expect(getEffectiveFeatures(tier, held).aiChat, `${tier} did not gain aiChat`).toBe(true);
      // And NOT holding it never takes away what the base tier already had —
      // exactly what turning the `||` into an assignment would do.
      expect(getEffectiveFeatures(tier, NO_ADDONS).aiChat,
        `${tier} lost its base aiChat — the lift became an assignment`).toBe(base.aiChat);
    }
    // The lift is not vacuous: some tier lacks it in the base.
    expect(PLAN_ORDER.filter((t) => !getPlanFeatures(t).aiChat).length).toBeGreaterThan(0);
  });

  it("nothing writes `plan` from the client — #434's widened sweep is still swept", () => {
    const src = read(THE286);
    expect(src).toContain('no client module writes a `plan` field to Firestore');
    expect(src).toContain('updateDoc|setDoc');
  });

  it('no price literals — prices go through formatPlanPrice', () => {
    const src = read(THE286);
    expect(src).toContain('formatPlanPrice(planId, billingPeriod)');
    expect(src).toContain('a price literal is back in the plan card');
    expect(read('src/components/settings/PlanUpgradeSection.tsx'))
      .toContain('formatPlanPrice(planId, billingPeriod)');
  });
});

describe('13 · the install control is still asserted reachable', () => {
  it('and still asserted not to be gated on beforeinstallprompt', () => {
    const src = read('src/components/__tests__/THE-305.install-reachable.test.tsx');
    expect(src).toContain('beforeinstallprompt');
    expect(src).toContain('treats the native prompt as an upgrade, never as a precondition');
    expect(src).toContain('does not mount the control behind an install-event listener');
    expect(read(FROZEN_FILES.profile), 'the install row left the settings surface')
      .toContain('InstallAppModal');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 14-15 — the things that must NOT move
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("14 · regroup's 10-class allowlist is unchanged", () => {
  /**
   * ⚠️ REPORTED FOR THE REDESIGN TICKET, NOT CHANGED.
   *
   * `AdminSettings.regroup.test.tsx`'s first test allowlists every unprefixed
   * class on the page root, the region wrappers and the headings to a fixed
   * 10-item list, and requires everything else be `sm:`/`lg:`. That is why the
   * mobile accordion skeleton is frozen BY DESIGN, and it is left exactly as it
   * is. The redesign will have to live in the row cards.
   */
  it('the suite is at a digest THE-300 accepts — through the register, not against it', () => {
    // 🔴 `freezeFailure`, NOT a bare `toBe`. A hard pin here would re-freeze the
    // regroup suite from THE-312's own file and flatly contradict test 6, which
    // exists so tests CAN be added to it.
    expect(
      freezeFailure(FROZEN_FILES.regroupSuite,
        '21c298f212d32cb93f66d41fb5a5d3804712c2a571c5ad482acd11b2edda9784'),
      'THE-312 does not touch the regroup suite',
    ).toBeNull();
  });

  it('and the allowlist is still exactly the same ten unprefixed classes', () => {
    const src = read(FROZEN_FILES.regroupSuite);
    const block = src.match(
      /is a new unprefixed class[\s\S]{0,200}?\n\s*\)\.toContain\(cls\)/,
    );
    expect(src, 'the unprefixed-class allowlist could not be found').toContain(
      'is a new unprefixed class — that is how a desktop change reaches a phone',
    );
    expect(block, 'the allowlist assertion no longer reads the element\'s own classes').not.toBeNull();
    // Pinned WHOLE, in order: widening it is an edit to the next few lines.
    expect(src).toContain(
      "['hidden', 'space-y-6', 'space-y-2.5', 'px-4', 'text-[11px]', 'font-semibold',\n"
      + "             'uppercase', 'tracking-[0.16em]', 'text-faint', 'text-danger']",
    );
    // And everything else must still be gated at sm/lg.
    expect(src, 'the sm:/lg: requirement is gone').toContain('is not gated at sm/lg');
  });
});

describe('15 · firestore.rules and functions/ are byte-identical', () => {
  it.each(Object.entries(UNTOUCHED.rulesAndFunctions))('%s is unchanged', (rel, digest) => {
    expect(sha256File(rel), `${rel} changed — THE-312 must not open it`).toBe(digest);
  });

  it('functions/ has grown no file', () => {
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
    expect(out.sort()).toHaveLength(5);
  });
});
