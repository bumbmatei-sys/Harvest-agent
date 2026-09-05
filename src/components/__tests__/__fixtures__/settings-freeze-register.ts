/**
 * THE-312 · The append register for the settings-screen freeze guards.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Four surfaces — `AdminSettings.tsx`, the two chrome files, and
 * `PersonalInformationModal.tsx` — plus `Profile.tsx` were pinned
 * byte-identical by eleven assertions spread across six suites. Each pin was
 * correct on the ticket that wrote it ("do not touch AdminSettings"), and none
 * of them had a way to say "this change WAS deliberate". Together they made the
 * files unmodifiable: THE-310 was asked to redesign the settings and My Profile
 * screens, planted a one-comment-line edit in each file, watched 11 assertions
 * go red, and stopped before writing a line. It was right to.
 *
 * 🔴 THIS MODULE IS NOT A LOOSENING. It does not remove a single pin. It gives
 * each pin an APPEND PATH: a future ticket records the digest it is moving the
 * file to, ALONGSIDE the ticket number and the reason, and the guard accepts
 * that value and nothing else. A change nobody recorded still fails — which is
 * the whole threat these guards were built for and is asserted directly in
 * `THE-312.settings-freeze-registers.test.tsx`.
 *
 * ── The shape, and why it is this shape ─────────────────────────────────────
 *
 * A SET of accepted digests per file, each carrying its provenance, exactly as
 * `the-302-guards.test.ts`, `the-294-activity-guards.test.ts` and
 * `the-291-client-plan-write.test.ts` already spell it, and requiring a stated
 * TICKET and REASON per entry the way `EDITED_SINCE_MEASUREMENT` does in
 * `THE-286.settings-chrome-autosave.test.tsx` and
 * `admin-data-screens.desktop-layout.test.tsx`.
 *
 * 🔴 APPENDED, NEVER SUBSTITUTED. `main` was red for everyone the week #434
 * replaced a digest instead of adding one. The baseline each guard already
 * spells stays exactly where it is; a recorded edit is an ADDITIONAL accepted
 * value. A digest that is NEITHER — i.e. an edit nobody wrote down — still
 * fails.
 *
 * 🔴 A DIGEST IS MANDATORY on every entry. An entry that named only a file and
 * a ticket would exempt that file from its pin entirely and accept any future
 * content, which is a hole and not a record. `validateRegister()` refuses one,
 * and the ticket and the reason are required for the same reason: a bare hash
 * with no story is a loophole with a checksum on it.
 *
 * ── How a future ticket records an edit ─────────────────────────────────────
 *
 *   1. Make the change to the source file.
 *   2. Take its digest:
 *        node -e "console.log(require('crypto').createHash('sha256')
 *          .update(require('fs').readFileSync('<path>')).digest('hex'))"
 *   3. APPEND an entry to `RECORDED_EDITS` below with that digest, your ticket
 *      and a reason that says what changed and why it was safe. Do not touch
 *      the entries already there and do not edit a baseline literal in a suite.
 *   4. Re-run the suite. Every guard on that file now accepts the new value and
 *      only the new value.
 *
 * ⚠️ Nothing here shells out to git at assertion time. A depth-1 clone has no
 * base revision to `git show`, and a test that needs an object database is a
 * test that fails for reasons that are not about the code. Digests are compared
 * against the file on disk, which needs nothing but `fs`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Repo root, from `src/components/__tests__/__fixtures__/`. */
export const REPO_ROOT = path.resolve(__dirname, '../../../..');

export const sha256File = (rel: string): string =>
  createHash('sha256').update(readFileSync(path.join(REPO_ROOT, rel))).digest('hex');

/**
 * One deliberate, recorded change to a frozen file.
 *
 * 🔴 All four fields are load-bearing. `digest` is what makes this a record
 * rather than an exemption; `ticket` and `why` are what make it reviewable.
 */
export type RecordedEdit = {
  /** Repo-relative path, exactly as the guards spell it. */
  readonly file: string;
  /** The ticket that made the change — `THE-nnn` or `#nnn`. */
  readonly ticket: string;
  /** What changed and why it was safe. Prose, not a shrug. */
  readonly why: string;
  /** sha256 of the file AS THAT TICKET LEFT IT. */
  readonly digest: string;
};

/** The five files these guards freeze, and which is which. */
export const FROZEN_FILES = {
  adminSettings: 'src/components/AdminSettings.tsx',
  sectionHeading: 'src/components/settings/SectionHeading.tsx',
  settingsAccordion: 'src/components/settings/SettingsAccordion.tsx',
  profile: 'src/components/Profile.tsx',
  personalInformationModal: 'src/components/PersonalInformationModal.tsx',
  /** Not a source file, but pinned by THE-300 all the same — see below. */
  regroupSuite: 'src/components/__tests__/AdminSettings.regroup.test.tsx',
} as const;

/**
 * 🔴 THE REGISTER. Empty on THE-312, and that is correct: THE-312 records no
 * edit because THE-312 edits no source file. The next ticket to move one of
 * these files appends here.
 *
 * ⚠️ Do not add an entry "in advance" or "to unblock". An entry whose digest
 * does not match some real state of the file buys nothing and is dead weight
 * a later reader has to disprove.
 */
export const RECORDED_EDITS: ReadonlyArray<RecordedEdit> = [
  {
    file: 'src/components/AdminSettings.tsx',
    ticket: 'THE-314',
    why:
      'The SMS settings row lost its vendor from the LABEL, "SMS (Twilio)" to "SMS", and its '
      + 'explanatory comment moved from inside the row object to above it. Harvest stopped asking '
      + 'churches to bring their own carrier account and started RESELLING on one of its own, so '
      + 'there is no vendor a church has ever heard of and naming one on this row would send an '
      + 'admin looking for a login that does not exist. NO ROW WAS ADDED OR REMOVED, no `group` '
      + 'changed, and no `hidden:` clause changed — the row still reads the master switch and then '
      + "the FEATURE cell, which is exactly why SMS could be made Ministry-only without touching "
      + 'that line: `smsAutomation` went false on plus and pro and the row followed the matrix. '
      + 'The comment moved because THE-296 reads the id → content mapping with a 400-character '
      + 'window between them, and a comment inside the object pushed `content:` out of range.',
    digest: 'a66900fd4b53dd109e97f733e7b7f6bfe18b530d7da666b5165def09546df476',
  },
  {
    file: 'src/components/__tests__/AdminSettings.regroup.test.tsx',
    ticket: 'THE-314',
    why:
      "Section (a3) followed the row it guards. It asserted the SMS section still calls "
      + "'/api/sms/config' and '/api/sms/test' and still exports BYO_CREDENTIALS_NOTE; the panel is "
      + 'no longer a Twilio credential form but the number purchase panel, so it calls '
      + "'/api/sms/numbers' and exports RESOLD_NUMBER_NOTE and RELEASE_WARNING. The CLAIM is "
      + 'unchanged and still asserted: the section owns its endpoints, states whose money is being '
      + 'spent, and reads the master switch rather than declaring its own. Nothing was removed — '
      + 'the release warning is an assertion this file did not have before, and it exists because '
      + 'the vendor documents no port-out, so releasing a number is irreversible.',
    digest: 'a0afe604b79bf19a5c8ce538992db49601319b258606e99f07709ce5358f5d41',
  },
];

/** A ticket reference the register will accept. */
const TICKET_RE = /^(?:THE-\d+|#\d+)$/;

/**
 * The floor `EDITED_SINCE_MEASUREMENT` already sets for an exemption reason.
 * Long enough that "n/a", "see ticket" and "cleanup" do not clear it.
 */
export const MIN_REASON_LENGTH = 80;

/** A sha256 hex digest. */
const DIGEST_RE = /^[0-9a-f]{64}$/;

/**
 * Everything wrong with `register`, one string per problem. Empty means every
 * entry names a file, a ticket, a reason and a digest.
 *
 * 🔴 This is the assertion that keeps the register a record. Drop the ticket
 * or the reason check and `THE-312.settings-freeze-registers.test.tsx` goes red.
 */
export function validateRegister(
  register: ReadonlyArray<RecordedEdit> = RECORDED_EDITS,
): string[] {
  const problems: string[] = [];
  const known = new Set<string>(Object.values(FROZEN_FILES));
  register.forEach((entry, i) => {
    const at = `RECORDED_EDITS[${i}] (${entry.file || '<no file>'})`;
    if (!entry.file) problems.push(`${at}: no file`);
    else if (!known.has(entry.file)) problems.push(`${at}: not one of the frozen files`);
    if (!entry.ticket || !TICKET_RE.test(entry.ticket))
      problems.push(`${at}: no ticket — an entry without one is anonymous`);
    if (!entry.why || entry.why.length < MIN_REASON_LENGTH)
      problems.push(
        `${at}: no reason (needs ${MIN_REASON_LENGTH}+ chars) — a bare hash is a loophole, not a record`,
      );
    if (!entry.digest || !DIGEST_RE.test(entry.digest))
      problems.push(
        `${at}: no sha256 digest — an entry without one exempts the file from its pin entirely`,
      );
  });
  return problems;
}

/**
 * Every digest a guard on `file` accepts: the `baseline` it already spells,
 * plus each recorded edit to that file.
 *
 * ⚠️ The baseline is never replaced, only joined.
 */
export function acceptedFor(
  file: string,
  baseline: string,
  register: ReadonlyArray<RecordedEdit> = RECORDED_EDITS,
): ReadonlyArray<readonly [digest: string, source: string]> {
  return [
    [baseline, 'the baseline this guard recorded from origin/main'] as const,
    ...register
      .filter((e) => e.file === file)
      .map((e) => [e.digest, `${e.ticket} — ${e.why}`] as const),
  ];
}

/**
 * `null` when `actual` is accepted for `file`; otherwise the failure message,
 * naming the file, what it is at, and every value that would have been fine.
 *
 * Pure — takes the digest rather than reading disk — so the register's own
 * suite can prove an unrecorded value is rejected without touching a source
 * file.
 */
export function freezeFailureFor(
  file: string,
  baseline: string,
  actual: string,
  register: ReadonlyArray<RecordedEdit> = RECORDED_EDITS,
): string | null {
  const accepted = acceptedFor(file, baseline, register);
  if (accepted.some(([digest]) => digest === actual)) return null;
  return (
    `${file} is at ${actual}, which is none of:\n  ` +
    accepted.map(([d, why]) => `${d} (${why})`).join('\n  ') +
    `\n\n🔴 If this change was deliberate, RECORD it: append { file, ticket, why, digest } ` +
    `to RECORDED_EDITS in src/components/__tests__/__fixtures__/settings-freeze-register.ts. ` +
    `Do not delete this assertion and do not replace the baseline literal.`
  );
}

/**
 * `null` when the file on disk is at an accepted digest, otherwise the failure
 * message. This is what the six guards call.
 */
export function freezeFailure(
  file: string,
  baseline: string,
  register: ReadonlyArray<RecordedEdit> = RECORDED_EDITS,
): string | null {
  return freezeFailureFor(file, baseline, sha256File(file), register);
}
