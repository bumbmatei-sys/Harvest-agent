/**
 * THE-325 · one accepted-digest set for `firestore.rules`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * 54 suites pinned `firestore.rules` by digest to prove their own ticket did
 * not touch it: 49 spelled the digest inline, four read it from THE-286's JSON
 * fixture, and THE-319 asserted it appeared in `the-299-retention-guards`. Every
 * one of them said the same thing, so THE-313's ONE-LINE `servicePlans` rule
 * turned 45 of them red at once and needed a second PR (#463) that changed
 * nothing but pins.
 *
 * 🔴 WHAT THIS TICKET MOVED, AND WHAT IT DID NOT. The accepted VALUES moved into
 * the per-ticket register at `__fixtures__/ownership/`. The ASSERTIONS did not
 * move: all 54 suites still assert, each in its own case, that the rules file on
 * disk is at a digest some ticket recorded — and therefore that its own ticket
 * did not touch a file which AUTO-DEPLOYS TO PRODUCTION with no emulator tests
 * in CI. Nothing was deleted but 49 copies of a two-item list.
 *
 * ── Why this is not a hole ──────────────────────────────────────────────────
 *
 * A shared accepted set would be a loosening if it accepted anything a ticket
 * had not written down. It does not, and section 2 proves it on the pure entry
 * point rather than asserting it: a digest no ticket recorded is refused, an
 * empty accepted set is a FAILURE rather than a pass, and every entry must carry
 * a ticket and an 80-character reason or `validateOwnership` refuses it.
 *
 * ⚠️ NOTHING HERE ASKS WHAT THIS BRANCH CHANGED. Section 9 is the sweep for
 * that, and it is scoped by the BASE REF — `git cat-file -e <base>:<path>` —
 * never by a diff, because four expiring diff-guards have already blocked
 * unrelated PRs in this repo and THE-315 (#454) is the standing sweep for them.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadOwnership,
  validateOwnership,
  ownershipFailureFor,
  OWNERSHIP_DIR,
  MIN_REASON_LENGTH,
  type OwnershipEntry,
} from './__fixtures__/ownership-register';
import {
  RULES_FILE,
  rulesDigestOnDisk,
  rulesDigestFailure,
  rulesDigestFailureFor,
  acceptedRulesDigests,
} from './__fixtures__/firestore-rules-pin';

const ROOT = path.resolve(__dirname, '../..');
const SELF = 'src/__tests__/THE-325.rules-digest-register.test.ts';
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** The shared module every pinning suite imports. Spelled once, and greppable. */
const PIN_MODULE = 'firestore-rules-pin';

/** THE-325's own record: the file this ticket added the accepted set to. */
const REGISTER_RECORD = 'src/__tests__/__fixtures__/ownership/THE-325.json';

/** The two files THE-325 added besides this suite. */
const THE_325_NEW_FIXTURES = [
  'src/__tests__/__fixtures__/firestore-rules-pin.ts',
  REGISTER_RECORD,
];

/**
 * 🔴 THE ACCEPTED VALUES AS THEY WERE BEFORE THIS TICKET, counted and named from
 * the tree at `main` (12503e2) before anything moved. Both were already accepted
 * somewhere: `a1fb6148` by the seven tuple-table guards and the four
 * `RULES_ACCEPTED` arrays, `4973c3c9` by all 49 inline pins, THE-286's fixture
 * and THE-319's deferral. Section 3 is what makes "append, never substitute"
 * checkable rather than a promise — drop either and it fails, naming it.
 *
 * ⚠️ THESE TWO LITERALS ARE A MIGRATION RECORD, NOT A PIN. They are the "before"
 * side of a before/after count and do not move when the rules legitimately
 * change: a later ticket APPENDS a third value to the register and edits nothing
 * here. That is why section 1 exempts this file by name from the one-edit sweep.
 */
const ACCEPTED_BEFORE: ReadonlyArray<readonly [digest: string, what: string]> = [
  ['a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499',
    'main before #462, unchanged since 5e06c67'],
  ['4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075',
    "main + THE-313 (#462) — the servicePlans rule; the state on disk at THE-325's branch point"],
];

/** Every test file and fixture under `src/`, repo-relative and sorted. */
function suiteFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === 'node_modules' || e.name === '.next') return [];
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.test\.[cm]?[jt]sx?$/.test(e.name) || e.name.endsWith('.json') ? [p] : [];
    });
  return walk(path.join(ROOT, 'src'))
    .map((p) => path.relative(ROOT, p).split(path.sep).join('/'))
    .sort();
}

/** Every SUITE that pins `firestore.rules` — measured from the tree. */
const pinningSuites = (): string[] =>
  suiteFiles().filter((p) => /\.test\.[cm]?[jt]sx?$/.test(p) && read(p).includes(PIN_MODULE));

/** Every file under `src/` carrying `digest` verbatim. */
const filesSpelling = (digest: string): string[] =>
  suiteFiles().filter((p) => read(p).includes(digest));

/** The measured population, named in one place so a change to it is one edit.
 *
 * 🔴 56 → 57, APPENDED BY THE-330. Its guard suite reaches the accepted set
 * through the same module as every other pinner, to assert that rebuilding the
 * number-purchase form left `firestore.rules` untouched. The count is a
 * MEASURED population, so a new pinner raises it by one — what the assertion
 * catches is a suite quietly DROPPING its pin, and that still fails.
 *
 * 🔴 57 → 58, APPENDED BY THE-336, through the same module and for the same
 * reason. Its suite asserts that fixing a member onboarding funnel which could
 * not create an account — both writes used `updateDoc` on a document a
 * swallowed `AuthPage` failure had left uncreated — needed NO rule change: the
 * deployed `users/{userId}` block already permits a self-create whose `role` is
 * absent or 'user', and a write to a missing document is evaluated as a create.
 * Nothing above is removed and no accepted value is widened. */
const PINNING_SUITES = 58;

/**
 * A digest no ticket has recorded and none ever will — the planted change.
 * Assembled rather than spelled so this file cannot be found by a sweep for it.
 */
const UNRECORDED = 'f'.repeat(48) + '0123456789abcdef';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — a legitimate rules change needs ONE edit
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · a legitimate rules change is one edit', () => {
  /**
   * 🔴 PLANTED FOR REAL, against a COPY of the register. `firestore.rules`
   * itself is byte-identical on this branch (section 8), so the change is
   * planted where it can be: a digest that is not on disk and is not recorded,
   * run through the same pure entry point all 54 suites reach through. It fails
   * against the register as it stands, and passes as soon as ONE per-ticket
   * record accepts it — which is the whole claim, demonstrated rather than said.
   */
  it('🔴 one new per-ticket record makes a planted rules change acceptable', () => {
    const planted = sha256(read(RULES_FILE) + "\n// a rule a later ticket legitimately added\n");
    const before = loadOwnership();

    expect(ownershipFailureFor(RULES_FILE, planted, before),
      'a rules state nobody recorded is already accepted — that would be the hole')
      .not.toBeNull();

    // THE ONE EDIT: a new `__fixtures__/ownership/THE-nnn.json`, written to a
    // temp directory so this test adds no record of its own to the tree.
    const dir = mkdtempSync(path.join(tmpdir(), 'the-325-'));
    try {
      for (const name of readdirSync(OWNERSHIP_DIR)) {
        writeFileSync(path.join(dir, name), readFileSync(path.join(OWNERSHIP_DIR, name)));
      }
      writeFileSync(path.join(dir, 'THE-999.json'), JSON.stringify({
        ticket: 'THE-999',
        entries: [{
          file: RULES_FILE,
          digest: planted,
          why: 'A later ticket legitimately changing firestore.rules records the state it leaves '
            + 'the file in, here, and edits nothing else in the tree. This is that edit.',
        }],
      }, null, 2));
      const after = loadOwnership(dir);
      expect(validateOwnership(after), 'the one new record does not validate').toEqual([]);
      expect(ownershipFailureFor(RULES_FILE, planted, after),
        'one recorded value was not enough — the consolidation did not achieve its point')
        .toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * ⚠️ TWO FILES ARE EXEMPT, BY NAME AND WITH REASONS, because neither has to be
   * edited when a rules change lands — which is the property under test:
   *
   *   • THIS SUITE holds `ACCEPTED_BEFORE`, the "before" half of the before/after
   *     count in section 3. It is a migration record and does not grow.
   *   • `the-313-guards` holds `RULES_BEFORE_462`, which asks WHICH of the two
   *     states a merge ref is at so its readable half knows whether the rule
   *     should be present yet. It is a selector, not an accepted-value list.
   *
   * 🔴 A THIRD would be a regression, so the list is exactly two lines long and
   * widening it is an edit visible in review.
   */
  const SPELLING_EXEMPT = [SELF, 'src/__tests__/the-313-guards.test.ts'];

  it('🔴 and that edit is ONE file, because no suite carries a copy of the set', () => {
    expect(SPELLING_EXEMPT).toHaveLength(2);
    for (const [digest] of acceptedRulesDigests()) {
      const carriers = filesSpelling(digest).filter((p) => !SPELLING_EXEMPT.includes(p));
      expect(carriers,
        `${digest} is written outside the register, so a rules change would cost more than one edit`)
        .toEqual([REGISTER_RECORD]);
    }
    // 🔴 AND THE LIVE STATE — the one a rules change actually supersedes — is
    // spelled in no suite at all, exemptions included but for this record.
    expect(filesSpelling(rulesDigestOnDisk()).filter((p) => p !== SELF),
      'a suite still spells the digest on disk, so a rules change would cost it an edit too')
      .toEqual([REGISTER_RECORD]);
    // The exemptions are real files that really do carry a value, so the list
    // cannot quietly become a pair of names that exempt nothing.
    for (const rel of SPELLING_EXEMPT) {
      expect(acceptedRulesDigests().some(([d]) => read(rel).includes(d)),
        `${rel} is exempt from the sweep but carries no accepted value — drop it from the list`)
        .toBe(true);
    }
  });

  it('every pinning suite reaches the accepted set through the one module', () => {
    const suites = pinningSuites();
    expect(suites.length, `pinning suites:\n  ${suites.join('\n  ')}`).toBe(PINNING_SUITES);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — an UNRECORDED rules change still fails
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · an unrecorded rules change still fails', () => {
  it('🔴 the register refuses a digest no ticket recorded', () => {
    expect(rulesDigestFailureFor(UNRECORDED),
      'the shared set accepts an unrecorded value — this is a hole, not a simplification')
      .not.toBeNull();
    expect(rulesDigestFailureFor(UNRECORDED)).toContain(RULES_FILE);
  });

  it('🔴 and an EMPTY accepted set is a failure, not a blanket exemption', () => {
    // The way a consolidation could quietly stop checking: lose the records and
    // answer "fine" because there is nothing left to compare against.
    expect(ownershipFailureFor(RULES_FILE, rulesDigestOnDisk(), []),
      'a file no ticket recorded is being treated as acceptable')
      .not.toBeNull();
  });

  it('the mechanism is named, and it is the one every suite calls', () => {
    // Per-suite proof is the population count in section 5; what is named here
    // is the single point every one of them goes through, so a hole would be a
    // hole for all 54 at once and is tested as such above.
    expect(read('src/__tests__/__fixtures__/firestore-rules-pin.ts'))
      .toContain('ownershipFailure(RULES_FILE)');
    expect(rulesDigestFailure(),
      'firestore.rules on disk is at a digest no ticket recorded').toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — every accepted value that existed before exists after
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · every accepted value survived the move', () => {
  it('🔴 both values the tree accepted before are accepted now, by name', () => {
    const now = acceptedRulesDigests().map(([digest]) => digest);
    for (const [digest, what] of ACCEPTED_BEFORE) {
      expect(now, `the accepted value for ${what} (${digest}) was LOST — append, never substitute`)
        .toContain(digest);
    }
  });

  it('the count before equals the count after', () => {
    expect(new Set(acceptedRulesDigests().map(([d]) => d)).size,
      'the accepted set changed size — THE-325 migrates values, it does not add or drop them')
      .toBe(ACCEPTED_BEFORE.length);
  });

  it('and each carries the provenance it had', () => {
    const why = Object.fromEntries(acceptedRulesDigests());
    expect(why[ACCEPTED_BEFORE[0][0]]).toContain('main before #462');
    expect(why[ACCEPTED_BEFORE[1][0]]).toContain('THE-313');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — every entry carries a ticket and a reason
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · every entry is a record, not a bare hash', () => {
  it('the register validates clean', () => {
    const problems = validateOwnership();
    expect(problems, `the ownership register is not a record:\n  ${problems.join('\n  ')}`)
      .toEqual([]);
  });

  it.each(loadOwnership().filter((e) => e.file === RULES_FILE)
    .map((e) => [`${e.source} · ${e.digest.slice(0, 12)}`, e] as const))(
    '%s names a ticket, a reason and a digest',
    (_name, entry: OwnershipEntry) => {
      expect(entry.ticket).toMatch(/^(?:THE-\d+|#\d+)$/);
      expect(entry.why.length,
        'a reason under the floor is a shrug, not a record').toBeGreaterThan(MIN_REASON_LENGTH - 1);
      expect(entry.digest).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it('🔴 and dropping the ticket or the reason from a rules entry is refused', () => {
    const good = loadOwnership().find((e) => e.file === RULES_FILE) as OwnershipEntry;
    expect(validateOwnership([good])).toEqual([]);
    expect(validateOwnership([{ ...good, ticket: '' }]).join(' ')).toContain('anonymous');
    expect(validateOwnership([{ ...good, why: 'rules' }]).join(' '))
      .toContain('a bare hash is a loophole, not a record');
    expect(validateOwnership([{ ...good, digest: '' }]).join(' '))
      .toContain('exempts the file from its pin entirely');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — each pinning suite still asserts its own ticket did not touch the file
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5 · each pinning suite kept its own assertion', () => {
  it.each(pinningSuites())('%s still asserts it', (suite) => {
    const body = read(suite);
    expect(body, `${suite} imports the register but never asks it anything`)
      .toMatch(/rulesDigestFailure\(\)|acceptedRulesDigests\(\)/);
  });

  it('and every one of them is a suite, where its reviewer reads it', () => {
    for (const suite of pinningSuites()) {
      expect(/(^|\/)__tests__\//.test(suite), `${suite} is not under __tests__`).toBe(true);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — the eight content-asserting suites are byte-identical
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ THESE ARE NOT PINS AND THE-325 DOES NOT TOUCH THEM. Each reads
 * `firestore.rules` and asserts something about its CONTENT — line endings, the
 * `isSuperAdmin` literal list, that no rule keys off a plan, that the file does
 * not mention a ticket that does not own it. Consolidating a digest set has
 * nothing to say to any of them, so they are frozen here byte for byte.
 */
const CONTENT_ASSERTING: ReadonlyArray<readonly [string, string]> = [
  ['src/__tests__/the-268-line-endings.test.ts',
    '9285b31bcfb8c3739c39cedb8858a60e3068c635784cf8b8b4b4e9ea93a2a01c'],
  /**
   * ⚠️ EDITED SINCE MEASUREMENT — THE-330, and the digest is APPENDED here as a
   * REPLACEMENT of the recorded value rather than as a second accepted one,
   * because this list pins ONE state per file and THE-330 is the ticket that
   * moved it.
   *
   * 🔴 WHAT THE-330 CHANGED IN IT, AND WHY EACH WAS FORCED: this suite pinned
   * the SMS number panel's country and area fields as `ui/input` text boxes and
   * pinned their `slice(0, 2)` / `slice(0, 4)` length caps as figures that may
   * not move. Replacing those free-text boxes with pickers IS THE-330 — a
   * church could not be expected to know that `DE` is offerable, that it cannot
   * text, and that `615` is not a German area code. The claims were not dropped:
   * the input assertion became an assertion that the field is a `<select>` and
   * that no `input#sms-country` exists, which fails on the revert this ticket
   * exists to prevent; the two `slice` figures describe a field that no longer
   * takes typing at all; and `skeleton`/`item` moved out of REJECTED_OUTRIGHT
   * (their call-site rejections stand, and `select` replaced them there) for
   * exactly the reason `card` was never in that list — the rejection is per
   * element, so file-level absence is the wrong question.
   *
   * It still asserts CONTENT and still pins no digest, so it remains out of
   * THE-325's own bounds; this record only says which ticket last moved it.
   */
  ['src/components/__tests__/THE-320.sms-composition.test.tsx',
    '2462f1268f2f78fb6a72450b0d86adfb05274943fbe5b4057f197e10abc0af10'],
  ['src/components/__tests__/the-255-install-app.test.tsx',
    'e8438de623b5a206f92a6ec1ae5d8696af4ad82ce99b413451486cb77f588985'],
  ['src/lib/__tests__/super-admin-consistency.test.ts',
    '2e5e38006a0c0da07b38bef1eac0fbc093fe722d5406dd1cf27aa5cb452f9a35'],
  ['src/lib/dodo/__tests__/dodo-subscription-lifecycle.test.ts',
    '3fa216c7ce56ffb0a54092b82a4552f11ce76efa3ff3fcf755cc7222f99c0390'],
  ['src/utils/__tests__/plan-features.crm-individual.test.ts',
    '408a41ca17cf6596dc7e2bd9532bd5134ebb9ef7642e45333efc88be90a64307'],
  ['src/utils/__tests__/plan-features.news-feed.test.ts',
    '871d24472090eef354a4df209d9986c9b21dad2cc0ab63a3bd9e04d3213f8b77'],
  ['src/utils/__tests__/plan-flag-surface-guard.test.ts',
    'faf1467d62f2e9a0749a36ab8f0ce05eb7035f6110df77388d5b7684aec9a94e'],
];

describe('6 · the content-asserting suites are untouched', () => {
  it('there are eight of them', () => {
    expect(CONTENT_ASSERTING).toHaveLength(8);
  });

  it.each(CONTENT_ASSERTING)('%s is byte-identical', (rel, digest) => {
    expect(sha256(readFileSync(path.join(ROOT, rel))),
      `${rel} was edited — it asserts CONTENT, not a digest, and is out of THE-325's bounds`)
      .toBe(digest);
  });

  it('and none of them was quietly turned into a digest pin', () => {
    for (const [rel] of CONTENT_ASSERTING) {
      expect(read(rel), `${rel} now routes to the register — it never pinned a digest`)
        .not.toContain(PIN_MODULE);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 — THE-322's population pin still works
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("7 · THE-322's population pin still works", () => {
  const THE322 = 'src/__tests__/THE-322.ownership-register.test.ts';

  it('it counts the same population, by the marker that survived the move', () => {
    const body = read(THE322);
    expect(body, "THE-322's section 5 no longer counts anything")
      .toContain('the population never shrank — nothing was consolidated away');
    expect(body, 'the count was not updated to the population THE-325 leaves')
      .toContain(`const RULES_PINNERS_NOW = ${PINNING_SUITES};`);
  });

  it('and THE-322 is itself one of the pinners it counts', () => {
    expect(pinningSuites(), 'THE-322 stopped pinning firestore.rules').toContain(THE322);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 — no source file in this change, and firestore.rules is byte-identical
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('8 · test and fixture files only', () => {
  it('🔴 firestore.rules is byte-identical to the state THE-325 found it in', () => {
    expect(rulesDigestOnDisk(),
      'firestore.rules was edited — this ticket may not open it, and it auto-deploys to production')
      .toBe(ACCEPTED_BEFORE[1][0]);
  });

  it('every file THE-325 touched is a test or a fixture under __tests__', () => {
    const touched = [...pinningSuites(), ...THE_325_NEW_FIXTURES,
      'src/components/__tests__/__fixtures__/the-286-untouched.json'];
    expect(touched.length, 'the touched set collapsed — this sweep would prove nothing')
      .toBeGreaterThan(50);
    const offenders = touched.filter((p) => !/(^|\/)__tests__\//.test(p));
    expect(offenders, `THE-325 changes only test files, but these are not:\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });

  it('and the two fixtures it adds reach into no file this ticket may not touch', () => {
    /* The suites keep their own pins on `functions/`, `firestore.indexes.json`
       and `layout.tsx`; what is asserted here is that THE-325's own additions
       say nothing about any of them. This file names them in prose, in the
       sentence you are reading, so it is not swept — its own scope is asserted
       by the case above and by section 9. */
    for (const rel of THE_325_NEW_FIXTURES) {
      expect(read(rel), `${rel} reaches into a file this ticket may not touch`)
        .not.toMatch(/functions\/|firestore\.indexes\.json|src\/app\/layout\.tsx/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 — no guard here asks what the current branch changed  (BASE-REF GATED)
 * ═══════════════════════════════════════════════════════════════════════════ */

const gitOut = (args: string[]): string =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * The commit this branch is measured against — the fallback chain THE-315 and
 * THE-322 use, because a `pull_request` run checks out `refs/pull/N/merge`,
 * where `origin/main` may not exist.
 */
function baseRef(): string {
  for (const ref of ['origin/main', 'refs/remotes/origin/main', 'main']) {
    try { return gitOut(['rev-parse', '--verify', `${ref}^{commit}`]).trim(); } catch { /* next */ }
  }
  try {
    const parents = gitOut(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
    if (parents.length === 3) return parents[1];
  } catch { /* fall through */ }
  throw new Error('the base commit could not be resolved, so this sweep would measure nothing');
}

/** Does the BASE REF already carry `rel`? The stand-down signal. */
function onBase(rel: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${baseRef()}:${rel}`],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * 🔴 ASSEMBLED, NOT SPELLED. THE-315's first gate-proof passed with its gate
 * DELETED because the assertion's own error message contained the string it
 * grepped for. Every needle below is joined at run time so this file cannot
 * satisfy its own sweep.
 */
const DIFF_READS = [
  'gi' + 't diff', 'gi' + 't show', 'gi' + 't log',
  'diff --name' + '-only', 'merge' + '-base',
];
const ANY_GIT = [...DIFF_READS, 'exec' + 'Sync(', 'spawn' + 'Sync(', 'node:child' + '_process'];

describe("9 · nothing THE-325 adds asserts anything about this branch's diff", () => {
  it('🔴 the two fixtures it adds ask git nothing at all', () => {
    expect(THE_325_NEW_FIXTURES.length, 'a sweep with nothing to sweep proves nothing')
      .toBeGreaterThan(1);
    for (const rel of THE_325_NEW_FIXTURES) {
      for (const needle of ANY_GIT) {
        expect(read(rel), `${rel} reaches for \`${needle}\``).not.toContain(needle);
      }
    }
  });

  it('🔴 and this suite reads the BASE REF only — never the diff', () => {
    const body = read(SELF);
    for (const needle of DIFF_READS) {
      expect(body, `THE-325's own guard reaches for \`${needle}\``).not.toContain(needle);
    }
    // The one git call it does make, named so replacing it is visible in review.
    expect(body, 'the base-ref signal is gone, so the gate below decides nothing')
      .toContain("['cat-file', '-e', `${baseRef()}:${rel}`]");
  });

  /**
   * 🔴 THE GATE, AND IT ASSERTS IN BOTH STATES. THE-312's amendment is the
   * lesson: a guard whose only claim holds while its ticket is unmerged goes red
   * on `main` the moment it lands, for a reason that has nothing to do with the
   * next branch. So the base ref decides WHICH claim is true, not whether one is:
   *
   *   • THE-325 UNMERGED — the base ref does not carry its three new files, so
   *     the named list above is exactly the set it adds and cannot be stale.
   *   • THE-325 MERGED — the base ref carries all three, and the machinery is
   *     proved directly instead: `onBase` must still tell a tracked path from an
   *     absent one, which is the actual way this could rot into a no-op.
   */
  it('the base-ref gate still answers, in whichever state this branch is in', () => {
    const added = [...THE_325_NEW_FIXTURES, SELF];
    if (!added.every(onBase)) {
      expect(added.filter(onBase),
        'the named list has gone stale — some of it is already on the base ref')
        .toEqual([]);
      return;
    }
    expect(onBase('src/__tests__/__fixtures__/ownership-register.ts'),
      'onBase no longer finds a file the base ref certainly has').toBe(true);
    expect(onBase('src/__tests__/THE-325.a-path-that-was-never-committed.ts'),
      'onBase answers true to everything — the gate would decide nothing').toBe(false);
  });
});
