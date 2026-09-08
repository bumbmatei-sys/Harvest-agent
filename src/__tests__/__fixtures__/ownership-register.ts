/**
 * THE-322 · The per-ticket ownership register.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `src/__tests__/THE-319.composition-guards.test.ts` carried a `NOT_OURS` map:
 * one accepted-digest SET per file, recording which ticket owns each component.
 * It was correct, and it was SHARED. Every PR that composed a component had to
 * append its digest to that one map, so THE-317, THE-320 and THE-321 conflicted
 * on it in sequence and each rebase created the next conflict — four rebases
 * for four PRs that touched entirely different source files.
 *
 * 🔴 THIS MODULE IS NOT A LOOSENING. It moves the SAME entries, digest for
 * digest, out of one shared literal and into one file PER TICKET under
 * `__fixtures__/ownership/`. A loader unions them at run time, so the guard
 * accepts exactly what it accepted before. A component whose digest matches no
 * accepted entry still fails, which is the whole threat the map was built for.
 *
 * ── The shape, and why it is this shape ─────────────────────────────────────
 *
 * A DIRECTORY, not a generated index. A new ticket adds
 * `__fixtures__/ownership/THE-nnn.json` and edits nothing that already exists,
 * so two tickets recording different files never touch a common file. A
 * generated index would have the same property only as long as nobody hand-
 * edits it, and would need a generator, a check that the generator was run,
 * and a source of truth for what to do when it was not.
 *
 * ⚠️ JSON rather than a TypeScript module per ticket, because the union has to
 * be discovered from the DIRECTORY. A module-per-ticket needs either a shared
 * index — the file this ticket exists to remove — or `import.meta.glob`, whose
 * types are not in this repo's `tsconfig` `types` allow-list and which could
 * only be added by editing `tsconfig.json`, a source file. `readdirSync` needs
 * nothing but `fs` and is what every guard in this repo already uses.
 *
 * 🔴 A DIGEST, A TICKET AND A REASON ARE ALL MANDATORY, exactly as
 * `settings-freeze-register.ts` requires them and for the identical reason: an
 * entry naming only a file and a ticket would exempt that file from its pin
 * entirely and accept any future content, which is a hole and not a record. A
 * bare hash with no story is a loophole with a checksum on it.
 *
 * ── How a ticket records ownership ──────────────────────────────────────────
 *
 *   1. Take the digest of the file as your ticket leaves it:
 *        node -e "console.log(require('crypto').createHash('sha256')
 *          .update(require('fs').readFileSync('<path>')).digest('hex'))"
 *   2. Create `src/__tests__/__fixtures__/ownership/THE-nnn.json` — YOUR
 *      ticket, nobody else's — with `{ ticket, entries: [{ file, digest, why }] }`.
 *   3. If your ticket already has a file, append to its `entries`. Do not touch
 *      another ticket's file and do not replace a digest that is already there.
 *
 * ⚠️ Nothing here shells out to git at assertion time. A depth-1 clone has no
 * base revision to read, and a test that needs an object database is a test
 * that fails for reasons that are not about the code. Digests are compared
 * against the file on disk, which needs nothing but `fs`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Repo root, from `src/__tests__/__fixtures__/`. */
export const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Where the per-ticket files live. Adding one is the whole append path. */
export const OWNERSHIP_DIR = path.join(__dirname, 'ownership');

export const sha256File = (rel: string): string =>
  createHash('sha256').update(readFileSync(path.join(REPO_ROOT, rel))).digest('hex');

/**
 * One accepted state of a file a ticket does NOT own — or, for the ticket that
 * does own it, the state that ticket left it in.
 *
 * 🔴 All four fields are load-bearing. `digest` is what makes this a record
 * rather than an exemption; `ticket` and `why` are what make it reviewable.
 */
export type OwnershipEntry = {
  /** Repo-relative path, exactly as the guards spell it. */
  readonly file: string;
  /** The ticket that recorded it — `THE-nnn` or `#nnn`. From the filename. */
  readonly ticket: string;
  /** What this digest is and why it is accepted. Prose, not a shrug. */
  readonly why: string;
  /** sha256 of the file in the state this entry accepts. */
  readonly digest: string;
  /** The per-ticket file this entry was read from — named in every failure. */
  readonly source: string;
};

/** A ticket reference the register will accept. */
const TICKET_RE = /^(?:THE-\d+|#\d+)$/;

/**
 * The floor `settings-freeze-register.ts` already sets for a reason. Long
 * enough that "n/a", "see ticket" and "cleanup" do not clear it.
 */
export const MIN_REASON_LENGTH = 80;

/** A sha256 hex digest. */
const DIGEST_RE = /^[0-9a-f]{64}$/;

type RawFile = {
  ticket?: unknown;
  entries?: unknown;
};

/**
 * Every per-ticket file in the directory, newest name last. Sorted so the union
 * is deterministic and a failure message reads the same on every machine.
 *
 * 🔴 A FILE THAT WILL NOT PARSE THROWS. Skipping it would silently shrink the
 * accepted set, and a guard that quietly stops accepting is a guard that gets
 * deleted by whoever it blocks.
 */
export function ownershipFiles(dir: string = OWNERSHIP_DIR): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

/**
 * The union of every per-ticket file. This is what the guard reads, and it is
 * the ONLY place the union is formed — no index, no generated file.
 */
export function loadOwnership(dir: string = OWNERSHIP_DIR): OwnershipEntry[] {
  const out: OwnershipEntry[] = [];
  for (const name of ownershipFiles(dir)) {
    const ticket = name.replace(/\.json$/, '');
    let parsed: RawFile;
    try {
      parsed = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as RawFile;
    } catch (e) {
      throw new Error(`${name}: the ownership record does not parse — ${(e as Error).message}`);
    }
    if (parsed.ticket !== ticket) {
      throw new Error(
        `${name}: declares ticket ${String(parsed.ticket)} — a per-ticket file must be named for `
        + 'the ticket it carries, or two tickets can quietly share one file again',
      );
    }
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    for (const raw of entries) {
      const e = (raw ?? {}) as Record<string, unknown>;
      out.push({
        file: typeof e.file === 'string' ? e.file : '',
        digest: typeof e.digest === 'string' ? e.digest : '',
        why: typeof e.why === 'string' ? e.why : '',
        ticket,
        source: name,
      });
    }
  }
  return out;
}

/**
 * Everything wrong with `register`, one string per problem. Empty means every
 * entry names a file, a ticket, a reason and a digest.
 *
 * 🔴 This is the assertion that keeps the register a record rather than an
 * exemption list. Drop the ticket or the reason check and
 * `THE-322.ownership-register.test.ts` goes red.
 */
export function validateOwnership(
  register: ReadonlyArray<OwnershipEntry> = loadOwnership(),
): string[] {
  const problems: string[] = [];
  register.forEach((entry, i) => {
    const at = `${entry.source || '<no source>'}[${i}] (${entry.file || '<no file>'})`;
    if (!entry.file) problems.push(`${at}: no file`);
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

/** Every file any ticket has recorded a digest for, sorted. */
export function recordedFiles(
  register: ReadonlyArray<OwnershipEntry> = loadOwnership(),
): string[] {
  return [...new Set(register.map((e) => e.file))].sort();
}

/**
 * Every digest accepted for `file`, each carrying its provenance.
 *
 * ⚠️ The union across tickets, never a choice between them: a baseline one
 * ticket recorded is joined by the later state another ticket recorded, and
 * neither is replaced.
 */
export function acceptedFor(
  file: string,
  register: ReadonlyArray<OwnershipEntry> = loadOwnership(),
): ReadonlyArray<readonly [digest: string, source: string]> {
  return register
    .filter((e) => e.file === file)
    .map((e) => [e.digest, `${e.ticket} (${e.source}) — ${e.why}`] as const);
}

/**
 * `null` when `actual` is accepted for `file`; otherwise the failure message,
 * naming the file, what it is at, and every value that would have been fine.
 *
 * Pure — takes the digest rather than reading disk — so the register's own
 * suite can prove an unrecorded value is rejected without touching a source
 * file.
 *
 * 🔴 A FILE NOBODY RECORDED IS A FAILURE, NOT A PASS. An empty accepted set
 * means no ticket has said anything about this file, so there is nothing to
 * check it against — answering `null` there would turn a missing record into a
 * blanket exemption, which is precisely the hole a digest-less entry would open.
 */
export function ownershipFailureFor(
  file: string,
  actual: string,
  register: ReadonlyArray<OwnershipEntry> = loadOwnership(),
): string | null {
  const accepted = acceptedFor(file, register);
  if (!accepted.length) {
    return (
      `${file} has no accepted digest in any per-ticket ownership record, so nothing is checking it. `
      + 'Add src/__tests__/__fixtures__/ownership/THE-nnn.json for YOUR ticket with { file, digest, why }.'
    );
  }
  if (accepted.some(([digest]) => digest === actual)) return null;
  return (
    `${file} is at ${actual}, which is none of:\n  `
    + accepted.map(([d, why]) => `${d} (${why})`).join('\n  ')
    + '\n\n🔴 If this change was deliberate, RECORD it: create or append to '
    + 'src/__tests__/__fixtures__/ownership/THE-nnn.json for YOUR ticket with { file, digest, why }. '
    + "Do not delete this assertion and do not edit another ticket's file."
  );
}

/**
 * THE-336 — the same union, for a guard that carries its OWN baseline literal.
 *
 * ⚠️ Two of this repo's no-regression guards pin a file with a bare
 * `expect(sha(file)).toBe('<literal>')` and say in prose that the literal is
 * not to be replaced: the claim they make is "MY ticket did not open this
 * file", and the literal is the merge base they made it from. When a later
 * ticket legitimately owns the file, that literal has to stay AND the guard has
 * to keep failing on an edit nobody recorded.
 *
 * 🔴 THIS IS NOT A LOOSENING, for the same reason {@link acceptedFor} is not.
 * The baseline is added to the accepted set, not swapped for it, and a digest
 * that is neither the baseline nor any per-ticket record still fails. It is the
 * shape THE-312 gave `settings-freeze-register`'s `freezeFailureFor`, reached
 * through the per-ticket directory instead of a shared literal so two tickets
 * recording different files never touch a common file.
 */
export function ownershipFailureWithBaseline(
  file: string,
  baseline: string,
  register: ReadonlyArray<OwnershipEntry> = loadOwnership(),
): string | null {
  const actual = sha256File(file);
  if (actual === baseline) return null;
  const accepted = acceptedFor(file, register);
  if (accepted.some(([digest]) => digest === actual)) return null;
  return (
    `${file} is at ${actual}, which is neither the guard's own baseline\n  `
    + `${baseline} (the state that guard's ticket left it in)\n`
    + 'nor any recorded state:\n  '
    + (accepted.length ? accepted.map(([d, why]) => `${d} (${why})`).join('\n  ') : '(nothing recorded)')
    + '\n\n🔴 If this change was deliberate, RECORD it: create or append to '
    + 'src/__tests__/__fixtures__/ownership/THE-nnn.json for YOUR ticket with { file, digest, why }. '
    + "Do not delete this assertion and do not replace the baseline literal."
  );
}

/**
 * `null` when the file on disk is at an accepted digest, otherwise the failure
 * message. This is what the guards call.
 */
export function ownershipFailure(
  file: string,
  register: ReadonlyArray<OwnershipEntry> = loadOwnership(),
): string | null {
  return ownershipFailureFor(file, sha256File(file), register);
}
