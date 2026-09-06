/**
 * THE-325 · The one accepted-digest set for `firestore.rules`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * 49 suites spelled the digest of `firestore.rules` inline, THE-286's JSON
 * fixture carried a 50th copy for its four consumers, and THE-319 pinned it a
 * 51st time by asserting the digest appears in `the-299-retention-guards`.
 * Every one of them existed for the same reason and said the same thing.
 *
 * 🔴 SO A LEGITIMATE RULES CHANGE COST 53 EDITS. THE-313's one-line
 * `servicePlans` rule turned 45 suites red at once and needed a second PR
 * (#463) that changed nothing but pins. This module makes that ONE edit: a new
 * `__fixtures__/ownership/THE-nnn.json` recording the digest the ticket leaves
 * the file at, and nothing else in the tree moves.
 *
 * ── This is NOT a loosening ─────────────────────────────────────────────────
 *
 * 🔴 `firestore.rules` AUTO-DEPLOYS TO PRODUCTION on merge to `main` and CI
 * runs NO emulator tests against it. That is the entire reason so many suites
 * pin it, and nothing here relaxes it:
 *
 *   • The accepted set is a UNION of per-ticket records, so a digest NO ticket
 *     recorded is accepted by nobody and every suite that asks goes red.
 *   • An empty set is a FAILURE, not a pass — see `ownershipFailureFor`. A
 *     register that lost its records does not quietly stop checking.
 *   • Every entry must carry a ticket and a reason of 80+ characters, so an
 *     accepted digest is a record with a story rather than a bare hash.
 *
 * ⚠️ WHAT EACH SUITE STILL ASSERTS, UNCHANGED: that `firestore.rules` on disk
 * hashes to a digest it accepts, and therefore that its own ticket did not
 * touch the file. Only the LIST of accepted values is shared; the assertion
 * stays in each suite, where that ticket's reviewer reads it.
 *
 * ── How a ticket that legitimately changes the rules records it ─────────────
 *
 *   1. `sha256sum firestore.rules` — from the file, never from a CI log.
 *   2. Add `src/__tests__/__fixtures__/ownership/THE-nnn.json` for YOUR ticket
 *      with `{ file: 'firestore.rules', digest, why }`.
 *   3. That is the whole edit. Do not replace a digest another ticket recorded
 *      and do not edit another ticket's file — the set is a union, and `main`
 *      went red for everyone the once a PR substituted instead of appending.
 *
 * ⚠️ Nothing here shells out to git, at assertion time or any other time. The
 * digest is taken from the file on disk and compared against the register.
 */
import { ownershipFailure, ownershipFailureFor, acceptedFor, sha256File } from './ownership-register';

/** The file, spelled once. */
export const RULES_FILE = 'firestore.rules';

/** sha256 of `firestore.rules` as it is on disk right now. */
export const rulesDigestOnDisk = (): string => sha256File(RULES_FILE);

/**
 * Every digest any ticket has recorded for `firestore.rules`, each paired with
 * the ticket and reason that recorded it.
 */
export const acceptedRulesDigests = (): ReadonlyArray<readonly [digest: string, why: string]> =>
  acceptedFor(RULES_FILE);

/**
 * `null` when `firestore.rules` on disk is at a digest some ticket recorded;
 * otherwise the failure message, naming what it is at and every value that
 * would have been fine.
 *
 * 🔴 THIS IS THE CALL EVERY PINNING SUITE MAKES. Grep for it to find them.
 */
export const rulesDigestFailure = (): string | null => ownershipFailure(RULES_FILE);

/**
 * The same answer for a digest handed in rather than read from disk. Pure, so a
 * suite can prove an UNRECORDED value is refused without touching the rules
 * file — which is how the protection property is tested rather than assumed.
 */
export const rulesDigestFailureFor = (digest: string): string | null =>
  ownershipFailureFor(RULES_FILE, digest);
