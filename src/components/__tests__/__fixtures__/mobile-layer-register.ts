/**
 * THE-323 · The append register for the sub-640px CLASS-LAYER fixtures.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `settings-freeze-register.ts` (THE-312) gave the FILE-DIGEST pins an append
 * path, and `__fixtures__/ownership/` (THE-322) gave the composition-ownership
 * digests one. Neither reaches the third pin on the same files: the class-layer
 * fixture.
 *
 * A layer fixture is a JSON array of `index\ttag\tunprefixed-classes` lines,
 * extracted by `class-inventory.ts#mobileLayer` and compared BY EXACT EQUALITY:
 *
 *     expect(mobileLayer(host)).toEqual(MOBILE_FIXTURE);
 *
 * That is the right assertion and it says something no digest pin says — that
 * the phone rendering did not move. What it has never had is a way to say "this
 * change WAS deliberate". `toEqual` against a literal array has exactly one
 * escape: OVERWRITE the fixture, which destroys the very record it is. So the
 * only two options a later ticket has are "change nothing" and "erase the pin",
 * and both are wrong.
 *
 * 🔴 THIS IS WHAT STOPPED THE-321. It composed `PersonalInformationModal.tsx`
 * from the installed primitives, found every control on that screen renders on
 * a phone — so composing anything means SUBSTITUTING the fixture rather than
 * adding to it — and reverted the whole pass rather than overwrite the pin. It
 * was right to. This module is the missing third option.
 *
 * 🔴 IT IS NOT A LOOSENING. It removes no pin and relaxes no comparison. The
 * fixture on disk stays the BASELINE, byte for byte. A later ticket that moves
 * the phone rendering records the layer it moved it TO — the whole layer, as a
 * file of its own — alongside the ticket, the reason and the digest that binds
 * the two together. A layer that is NEITHER the baseline NOR a recorded one
 * still fails, which is the entire threat the fixture was built for and is
 * asserted directly in `THE-323.personal-information-unlock.test.tsx`.
 *
 * ── The shape, and why it is this shape ─────────────────────────────────────
 *
 * `{ file, ticket, why, digest }` per entry, with `validateRegister()` refusing
 * one that is missing a ticket, carries a reason under `MIN_REASON_LENGTH`, or
 * has no digest — the same four fields and the same three refusals as
 * `settings-freeze-register.ts#RECORDED_EDITS`, which is what the ticket asked
 * for and what every reader of this repo already knows how to read.
 *
 * ⚠️ STORED ONE FILE PER TICKET, not in one shared array — the ONE change from
 * THE-312's shape, and it is THE-322's finding rather than a preference.
 * THE-312's `RECORDED_EDITS` is a single literal every composing PR must append
 * to, and THE-317, THE-320 and THE-321 conflicted on the equivalent map in
 * sequence: four rebases for four PRs that touched entirely different files.
 * A ticket here adds `mobile-layer/THE-nnn.json` and conflicts with nobody. The
 * ticket is read from the FILENAME, exactly as `ownership-register.ts` reads
 * it, so it cannot disagree with the file it is written in.
 *
 * 🔴 THE RECORDED LAYER IS STORED IN FULL, AND THIS IS THE POINT.
 *
 * A digest alone WOULD be a loosening, and quietly: the fixture's real value is
 * that a reviewer sees WHICH classes moved, line by line, in the diff. Replace
 * that with a hash and review sees an opaque 64 characters and a paragraph of
 * prose asserting it is fine. So an entry carries `layer` — the complete
 * recorded class layer — and `digest` is `sha256` OF THAT LAYER. The record is
 * a diffable file; the digest is what stops the two drifting apart. An entry
 * whose digest does not match its own layer is a hard failure, never a skip:
 * see {@link validateRegister}.
 *
 * ── How a future ticket records a layer change ──────────────────────────────
 *
 *   1. Make the change to the component.
 *   2. Print the layer the component now renders, and its digest:
 *        the suite's failure message contains both — run it and copy them.
 *   3. Create `__fixtures__/mobile-layer/THE-nnn.json` — YOUR ticket, nobody
 *      else's — as
 *        { "ticket": "THE-nnn",
 *          "entries": [{ "file": "<the component>", "why": "<what moved and
 *                        why it is safe, 80+ chars>", "digest": "<sha256>",
 *                        "layer": [ ...every line... ] }] }
 *   4. If your ticket already has a file, APPEND to its `entries`. Do not touch
 *      another ticket's file, do not replace a digest that is already there,
 *      and DO NOT OVERWRITE THE BASELINE FIXTURE — that is the one edit this
 *      module exists to make unnecessary.
 *
 * ⚠️ Nothing here shells out to git, at assertion time or at all. A depth-1
 * clone has no base revision to read, and a test that needs an object database
 * fails for reasons that are not about the code. Everything is read from disk.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Repo root, from `src/components/__tests__/__fixtures__/`. */
export const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** Where the per-ticket records live. Adding one is the whole append path. */
export const LAYER_DIR = path.join(__dirname, 'mobile-layer');

/**
 * The components whose sub-640px layer this register can record, and the
 * baseline fixture each is pinned against.
 *
 * ⚠️ ONE ENTRY, DELIBERATELY. Eleven suites in this repo pin a layer this way
 * and every one of them has the same missing append path — but rewiring a suite
 * is an edit to a file this ticket does not own, and THE-324 is in flight on
 * one of them. THE-323 unlocks the file THE-321 was stopped on; the mechanism
 * generalises to the other ten by adding a line here and one call there, and
 * `validateRegister` refuses an entry for a component that is not listed, so
 * the list cannot quietly widen either.
 */
export const PINNED_LAYERS: Readonly<Record<string, string>> = {
  'src/components/PersonalInformationModal.tsx':
    'src/components/__tests__/__fixtures__/PersonalInformationModal.mobile-layer.json',
};

/**
 * One deliberate, recorded change to a pinned class layer.
 *
 * 🔴 All five fields are load-bearing. `layer` is the record — the thing a
 * reviewer actually reads; `digest` is what binds the record to itself, so the
 * prose and the classes cannot drift apart; `ticket` and `why` are what make it
 * reviewable at all. `source` names the per-ticket file in every failure.
 */
export type RecordedLayer = {
  /** Repo-relative path of the COMPONENT, exactly as `PINNED_LAYERS` spells it. */
  readonly file: string;
  /** The ticket that moved it — `THE-nnn` or `#nnn`. Read from the filename. */
  readonly ticket: string;
  /** What moved on a phone and why it was safe. Prose, not a shrug. */
  readonly why: string;
  /** sha256 of `layer`, per {@link layerDigest}. */
  readonly digest: string;
  /** The complete sub-640px layer as that ticket left it. */
  readonly layer: readonly string[];
  /** The per-ticket file this entry was read from. */
  readonly source: string;
};

/** A ticket reference the register will accept. */
const TICKET_RE = /^(?:THE-\d+|#\d+)$/;

/**
 * The floor `settings-freeze-register.ts` already sets for a reason, which is
 * itself the floor `EDITED_SINCE_MEASUREMENT` set. Long enough that "n/a",
 * "see ticket" and "cleanup" do not clear it.
 */
export const MIN_REASON_LENGTH = 80;

/** A sha256 hex digest. */
const DIGEST_RE = /^[0-9a-f]{64}$/;

/**
 * The digest of a class layer.
 *
 * ⚠️ Over the LINES JOINED BY `\n`, not over a JSON encoding — so a record
 * reformatted by a different JSON printer, or re-indented, still carries the
 * same digest. What the pin is about is the classes, not the file's whitespace.
 */
export const layerDigest = (layer: readonly string[]): string =>
  createHash('sha256').update(layer.join('\n')).digest('hex');

/** The baseline layer a component is pinned against, read from its fixture. */
export const baselineLayer = (file: string): readonly string[] => {
  const fixture = PINNED_LAYERS[file];
  if (!fixture) throw new Error(`${file} has no pinned layer fixture`);
  return JSON.parse(readFileSync(path.join(REPO_ROOT, fixture), 'utf8')) as string[];
};

type RawEntry = { file?: unknown; why?: unknown; digest?: unknown; layer?: unknown };
type RawFile = { ticket?: unknown; entries?: unknown };

/**
 * Every per-ticket file in the directory, sorted so the union is deterministic
 * and a failure message reads the same on every machine.
 *
 * 🔴 A FILE THAT WILL NOT PARSE THROWS. Skipping it would silently shrink the
 * accepted set, and a guard that quietly stops accepting is a guard that gets
 * deleted by whoever it blocks.
 */
export function layerFiles(dir: string = LAYER_DIR): string[] {
  // ⚠️ A MISSING DIRECTORY THROWS TOO, for the same reason. `mobile-layer/`
  // is checked in — its README is what keeps it in git while it holds no
  // record — so its absence means the append path was deleted, not that
  // nothing has been recorded yet. Answering "nothing is recorded" to that
  // question is how a register quietly becomes a no-op.
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

/**
 * The union of every per-ticket record. This is what the guard reads.
 *
 * ⚠️ The ticket comes from the FILENAME rather than the body, so a record
 * cannot claim a ticket other than the one it is filed under. A body `ticket`
 * that disagrees is reported by {@link validateRegister} rather than ignored.
 */
export function loadRegister(dir: string = LAYER_DIR): RecordedLayer[] {
  const out: RecordedLayer[] = [];
  for (const name of layerFiles(dir)) {
    const source = path.join('src/components/__tests__/__fixtures__/mobile-layer', name);
    const raw = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as RawFile;
    const ticket = name.replace(/\.json$/, '');
    const entries = Array.isArray(raw.entries) ? (raw.entries as RawEntry[]) : [];
    // 🔴 A BODY THAT DISAGREES WITH ITS OWN FILENAME THROWS, rather than being
    // silently corrected to one or the other. Which of the two is wrong is not
    // knowable from here, and a record filed under one ticket while claiming
    // another is exactly the provenance this register exists to keep.
    if (raw.ticket !== undefined && raw.ticket !== ticket) {
      throw new Error(
        `${source} is filed under ${ticket} but its body says ${String(raw.ticket)}`,
      );
    }
    for (const e of entries) {
      out.push({
        file: typeof e.file === 'string' ? e.file : '',
        ticket,
        why: typeof e.why === 'string' ? e.why : '',
        digest: typeof e.digest === 'string' ? e.digest : '',
        layer: Array.isArray(e.layer) ? (e.layer as string[]) : [],
        source,
      });
    }
  }
  return out;
}

/**
 * Everything wrong with `register`, one string per problem. Empty means every
 * entry names a pinned component, a ticket, a reason and a digest — and that
 * the digest is the digest of the layer sitting beside it.
 *
 * 🔴 This is the assertion that keeps the register a record. Drop the ticket,
 * the reason or the digest check and `THE-323.personal-information-unlock`
 * goes red.
 */
export function validateRegister(
  register: ReadonlyArray<RecordedLayer> = loadRegister(),
): string[] {
  const problems: string[] = [];
  register.forEach((entry, i) => {
    const at = `${entry.source || `register[${i}]`} (${entry.file || '<no file>'})`;
    if (!entry.file) problems.push(`${at}: no file`);
    else if (!(entry.file in PINNED_LAYERS))
      problems.push(`${at}: not one of the components whose layer is pinned`);
    if (!entry.ticket || !TICKET_RE.test(entry.ticket))
      problems.push(`${at}: no ticket — an entry without one is anonymous`);
    if (!entry.why || entry.why.length < MIN_REASON_LENGTH)
      problems.push(
        `${at}: no reason (needs ${MIN_REASON_LENGTH}+ chars) — a bare hash is a loophole, not a record`,
      );
    if (!entry.digest || !DIGEST_RE.test(entry.digest))
      problems.push(
        `${at}: no sha256 digest — an entry without one exempts the layer from its pin entirely`,
      );
    else if (entry.layer.length === 0)
      problems.push(`${at}: a digest with no layer beside it — the record is not reviewable`);
    else if (layerDigest(entry.layer) !== entry.digest)
      problems.push(
        `${at}: the digest does not match the layer recorded beside it ` +
        `(recorded ${entry.digest}, layer is ${layerDigest(entry.layer)}) — ` +
        'the prose and the classes have drifted apart',
      );
  });
  return problems;
}

/**
 * Every layer a guard on `file` accepts: the `baseline` fixture it already
 * spells, plus each recorded layer for that component.
 *
 * ⚠️ The baseline is never replaced, only joined.
 */
export function acceptedFor(
  file: string,
  baseline: readonly string[],
  register: ReadonlyArray<RecordedLayer> = loadRegister(),
): ReadonlyArray<readonly [digest: string, layer: readonly string[], source: string]> {
  return [
    [layerDigest(baseline), baseline, 'the baseline fixture this guard was cut from'] as const,
    ...register
      .filter((e) => e.file === file)
      .map((e) => [e.digest, e.layer, `${e.ticket} (${e.source}) — ${e.why}`] as const),
  ];
}

/** The first `n` lines that differ between two layers, as a readable diff. */
function firstDifferences(
  expected: readonly string[],
  actual: readonly string[],
  n = 8,
): string[] {
  const out: string[] = [];
  const len = Math.max(expected.length, actual.length);
  for (let i = 0; i < len && out.length < n; i++) {
    if (expected[i] === actual[i]) continue;
    out.push(`    - ${expected[i] ?? '<absent>'}`);
    out.push(`    + ${actual[i] ?? '<absent>'}`);
  }
  return out;
}

/**
 * `null` when `actual` is an accepted layer for `file`; otherwise the failure
 * message, naming the component, what its layer is at, every layer that would
 * have been fine, the first differences against the closest one, and how to
 * record the change.
 *
 * Pure — takes the layer rather than rendering anything — so the register's own
 * suite can prove an unrecorded layer is rejected without touching a component.
 */
export function layerFailureFor(
  file: string,
  baseline: readonly string[],
  actual: readonly string[],
  register: ReadonlyArray<RecordedLayer> = loadRegister(),
): string | null {
  const accepted = acceptedFor(file, baseline, register);
  const actualDigest = layerDigest(actual);
  if (accepted.some(([digest]) => digest === actualDigest)) return null;
  return (
    `${file} renders a sub-640px class layer at ${actualDigest}, which is none of:\n  ` +
    accepted.map(([d, , why]) => `${d} (${why})`).join('\n  ') +
    `\n\nAgainst the baseline, the first lines that differ are:\n` +
    firstDifferences(baseline, actual).join('\n') +
    `\n\n🔴 If this change was deliberate, RECORD it: add ` +
    `src/components/__tests__/__fixtures__/mobile-layer/THE-nnn.json with ` +
    `{ ticket, entries: [{ file, why, digest, layer }] } — the layer in full and ` +
    `its sha256 as the digest. Do not overwrite the baseline fixture and do not ` +
    `delete this assertion.\n\nThe layer it is at, to record:\n` +
    JSON.stringify(actual, null, 2)
  );
}

/**
 * `null` when the component's rendered layer is accepted, otherwise the failure
 * message. This is what a pinned suite calls, passing what it just rendered.
 */
export function layerFailure(
  file: string,
  actual: readonly string[],
  register: ReadonlyArray<RecordedLayer> = loadRegister(),
): string | null {
  return layerFailureFor(file, baselineLayer(file), actual, register);
}
