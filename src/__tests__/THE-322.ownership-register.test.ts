/**
 * THE-322 — the shared digest map, split one file per ticket.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS TICKET CHANGED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `THE-319.composition-guards.test.ts` held a `NOT_OURS` map — one accepted-
 * digest SET per file, recording which ticket owns each component. It was
 * SHARED: every PR that composed a component appended its digest to that one
 * literal, so THE-317, THE-320 and THE-321 conflicted on it in sequence and
 * each rebase created the next. Four rebases for four PRs that touched
 * entirely different source files.
 *
 * The seven entries now live in one JSON record PER TICKET under
 * `__fixtures__/ownership/`, unioned at run time by `ownership-register.ts`. A
 * new ticket adds `THE-nnn.json` and conflicts with nobody.
 *
 * 🔴 NOTHING WAS WEAKENED. Every digest moved byte for byte; a component whose
 * digest matches no accepted entry still fails; a file NO ticket has recorded
 * fails too; and every entry still carries a ticket and a reason, enforced by
 * `validateOwnership()` on the model of `settings-freeze-register.ts`.
 *
 * ⚠️ WHAT THIS TICKET DID NOT DO. The `firestore.rules` consolidation — 46
 * suites each pinning the same digest to prove their own ticket did not touch
 * it — is separable and is NOT in this PR. Section 5 pins the current state of
 * those 46 so the follow-up starts from a measured baseline rather than a CI
 * log, and so that a suite quietly dropping its pin fails here.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MIN_REASON_LENGTH,
  OWNERSHIP_DIR,
  acceptedFor,
  loadOwnership,
  ownershipFailure,
  ownershipFailureFor,
  ownershipFiles,
  recordedFiles,
  validateOwnership,
  type OwnershipEntry,
} from './__fixtures__/ownership-register';
import { rulesDigestFailure, rulesDigestFailureFor, acceptedRulesDigests } from './__fixtures__/firestore-rules-pin';

const ROOT = path.resolve(__dirname, '../..');
const SELF = 'src/__tests__/THE-322.ownership-register.test.ts';
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** A digest no file in this repo is at. Used to prove a guard still refuses. */
const UNRECORDED = 'f'.repeat(64);

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — every entry that existed before exists after
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 THE PRE-MIGRATION INVENTORY, written out. This is the `NOT_OURS` map as
 * `THE-319.composition-guards.test.ts` carried it at 06ade3e, read off the file
 * before it was touched. It is the only record of the "before" that survives
 * the move, so it is spelled here in full rather than derived from anything
 * this PR wrote — a migration checked against its own output checks nothing.
 *
 * ⚠️ APPEND, NEVER SUBSTITUTE. All seven were kept. If a later ticket needs to
 * retire one it adds a row saying so; it does not delete a line here.
 */
const BEFORE: ReadonlyArray<readonly [file: string, digest: string]> = [
  ['src/components/AdminSms.tsx', '5cf8ed7aba7720fd4ef892ca0f294219ae1f6fe5d5121afc54481ff83a5f2eaf'],
  ['src/components/AdminSms.tsx', 'ed2f8906fb0b9f4faf26e62f44418fe85143762dbaae66761b3487b5a4f4eff9'],
  ['src/components/settings/SmsSection.tsx', '5bb4042ee2d57f562a7a2b33897fe6bf169a9f7e82bd1bb8bddeb9b83cf6c6b0'],
  ['src/components/settings/SmsSection.tsx', '75c90bc448dc52eceb47e8866a06a32cd53a64bb1b0455c2b7585053800bdf03'],
  ['src/components/settings/SmsSection.tsx', '6e619cd3a1b2e4356ebbee1a1b1788b0692ab1b736258481d18888b0455aa33d'],
  ['src/components/events/ServicePlanPanel.tsx', '81f99a23ff53cb1488935b7adf37cf043ff577399324e377785176d9f1e8c891'],
  ['src/components/events/ServicePlanRow.tsx', 'ffafaf4228bbefe95d7b9bf439d5a36df9c9160f5c086cbae25a236ec0adca37'],
];

/**
 * 🔴 THE TICKETS THE MIGRATION ITSELF PRODUCED, AND WHY THIS LIST EXISTS.
 *
 * ⚠️ AMENDED BY THE-326, AND THIS IS A BUG FIX IN THE GUARD, NOT A RELAXATION.
 *
 * Sections 1's "nothing was invented" and "the counts are unchanged" were
 * written against the WHOLE register, which was right for exactly one PR — the
 * one that did the migration and in which the register contained nothing else.
 * From the next ticket onward they say something THE-322's own header
 * contradicts in as many words: "A new ticket adds
 * `__fixtures__/ownership/THE-nnn.json` and edits nothing that already exists."
 * A guard that fails on the very thing its module was built to allow is the
 * shape this repo keeps removing on sight — it blocks every unrelated PR, and
 * the only way past it is to weaken it, which is how a real claim gets lost.
 *
 * 🔴 SO THE CLAIM IS SCOPED, NOT WEAKENED. The migration's fidelity is a
 * statement about the entries the migration MOVED, and those live in the two
 * files it wrote. Every one of them must still be present, unchanged, and no
 * digest may have appeared inside them that no `NOT_OURS` row carried — which is
 * the whole of what section 1 ever proved. A later ticket's own file is a
 * DIFFERENT record about a DIFFERENT file, and section 2 below already holds it
 * to the rule that matters: it may not touch another ticket's.
 */
const MIGRATED_SOURCES = ['THE-319.json', 'THE-320.json'];


/**
 * Does record `parsed` name the ownership record `otherFile` (e.g. `THE-344.json`)
 * in a STRUCTURAL field? Its `ticket` naming that ticket, or an entry pointing at
 * that record — as a bare id, as the record's filename, or by a path ending in it.
 * A source file that merely carries the ticket's id in its own name is not a
 * record, so it is not an index (see the THE-372 note where this is asserted).
 */
function namesRecord(
  parsed: { ticket: string; entries: ReadonlyArray<{ file: string }> },
  otherFile: string,
): boolean {
  const id = otherFile.replace(/\.json$/, '');
  if (parsed.ticket === id) return true;
  return parsed.entries.some(({ file }) => {
    const base = file.split('/').pop() ?? file;
    return file === id || base === otherFile || base === id;
  });
}

describe('1 · every entry that existed before exists after', () => {
  const after = loadOwnership();
  /** The entries THE-322 actually moved — the population section 1 is about. */
  const migrated = after.filter((e) => MIGRATED_SOURCES.includes(e.source));

  it('the count matches — seven before, seven after', () => {
    expect(BEFORE).toHaveLength(7);
    expect(migrated, 'an entry was lost or invented in the move').toHaveLength(BEFORE.length);
  });

  it.each(BEFORE.map((r) => [`${r[0]} @ ${r[1].slice(0, 12)}`, r] as const))(
    '%s survived the move',
    (_name, [file, digest]) => {
      const match = after.find((e) => e.file === file && e.digest === digest);
      expect(
        match,
        `${file} @ ${digest} was in NOT_OURS before THE-322 and is in no per-ticket record now. `
        + 'Every migrated entry must survive — append, never substitute.',
      ).toBeTruthy();
    },
  );

  it('and nothing was invented — every MIGRATED entry was an entry before', () => {
    // ⚠️ Scoped to the migrated records; see MIGRATED_SOURCES above. A digest
    // appearing inside THE-319's or THE-320's file that `NOT_OURS` never carried
    // is still exactly the forgery this was written to catch.
    const before = new Set(BEFORE.map(([f, d]) => `${f}@${d}`));
    const strays = migrated.filter((e) => !before.has(`${e.file}@${e.digest}`))
      .map((e) => `${e.source}: ${e.file} @ ${e.digest}`);
    expect(strays, 'an accepted digest appeared that no pre-migration entry carried:\n  '
      + strays.join('\n  ')).toEqual([]);
  });

  it('named per file — the four migrated files and their entry counts are unchanged', () => {
    const perFile: Record<string, number> = {};
    for (const e of migrated) perFile[e.file] = (perFile[e.file] ?? 0) + 1;
    expect(perFile).toEqual({
      'src/components/AdminSms.tsx': 2,
      'src/components/settings/SmsSection.tsx': 3,
      'src/components/events/ServicePlanPanel.tsx': 1,
      'src/components/events/ServicePlanRow.tsx': 1,
    });
  });

  /**
   * 🔴 AND THE UNION STILL GROWS ONLY BY WHOLE TICKETS. The register is a union
   * of per-ticket files, so the honest global claim is not "nothing was added"
   * but "everything that was added came in a file of its own, named for its own
   * ticket". Section 2 asserts the naming; this asserts that every file the
   * loader sees is one of them, so an entry cannot arrive from nowhere.
   */
  it('and every record in the union belongs to a named ticket file', () => {
    const sources = new Set(after.map((e) => e.source));
    for (const source of sources) {
      expect(ownershipFiles(), `${source} is not a file in the ownership directory`)
        .toContain(source);
    }
    expect(recordedFiles().length, 'the register records fewer files than the migration left')
      .toBeGreaterThanOrEqual(4);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — two tickets recording different files touch no common file
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · two tickets recording different files touch no common file', () => {
  it('every record is named for the one ticket it carries', () => {
    for (const name of ownershipFiles()) {
      const parsed = JSON.parse(readFileSync(path.join(OWNERSHIP_DIR, name), 'utf8')) as {
        ticket: string;
      };
      expect(parsed.ticket, `${name} carries a ticket it is not named for`)
        .toBe(name.replace(/\.json$/, ''));
    }
  });

  it('each entry is attributed to the record it came from', () => {
    for (const e of loadOwnership()) {
      expect(e.source, 'an entry lost the record it was read from').toBe(`${e.ticket}.json`);
    }
  });

  it('there is no index — the union is discovered from the DIRECTORY', () => {
    /**
     * 🔴 THE WHOLE POINT. An index listing the per-ticket files would be a
     * shared file again: every new ticket would edit it and conflict there
     * instead. `loadOwnership` reads the directory, so adding a ticket is
     * adding a file and nothing else.
     */
    const names = ownershipFiles();

    // Nothing in the directory but per-ticket records. An `index.ts`, a
    // `manifest.json` or a generated union would be the shared file again.
    //
    // 🔵 WIDENED AT #519 to the SAME two spellings `loadOwnership` already
    // accepts as a ticket (`TICKET_RE`: `THE-nnn` or `#nnn`). A change with no
    // THE ticket (#517, #519) records under its PR number, as #517 already does
    // in THE-325's CONTENT_ASSERTING_MOVED table. Still one file per ticket,
    // still no index: anything else in the directory fails exactly as before.
    expect(readdirSync(OWNERSHIP_DIR).filter((n) => !/^(?:THE-\d+|#\d+)\.json$/.test(n)),
      'the ownership directory grew something that is not a per-ticket record')
      .toEqual([]);

    // ⚠️ STRUCTURE, NOT PROSE. A record's `why` may and should name the ticket
    // whose entry it was appended beside — that is provenance, and THE-320's
    // record says exactly which of THE-319's values it kept and why. What must
    // not happen is a record LISTING another record: a ticket in a structural
    // field is what would make this an index.
    for (const name of names) {
      const parsed = JSON.parse(readFileSync(path.join(OWNERSHIP_DIR, name), 'utf8')) as {
        ticket: string; entries: ReadonlyArray<{ file: string }>;
      };
      const others = names.filter((n) => n !== name && namesRecord(parsed, n));
      expect(others, `${name} names another ticket's record in a structural field — that is an `
        + `index by another name:\n  ${others.join('\n  ')}`).toEqual([]);
    }
  });

  it('the index check fires on a RECORD, and not on a suite that shares a ticket\'s name', () => {
    /**
     * ⚠️ NARROWED AT THE-372, and proved in both directions here. The check
     * used to be a substring match of the other ticket's id against every
     * structural field, which also matched a SOURCE FILE named after a ticket:
     * THE-372 reprices Ministry and must record its edit to THE-344's own
     * suite, `THE-344.reprice-retired.test.ts`, and that path contains
     * `THE-344`. A test file is not a record, so listing it is not an index.
     * What still fails: a `ticket` field naming another ticket, and an entry
     * pointing at another ticket's record file, by name or by path.
     */
    const other = 'THE-344.json';
    const rec = (ticket: string, file: string) => ({ ticket, entries: [{ file }] });
    expect(namesRecord(rec('THE-372', 'src/__tests__/THE-344.reprice-retired.test.ts'), other)).toBe(false);
    expect(namesRecord(rec('THE-344', 'src/x.ts'), other)).toBe(true);
    expect(namesRecord(rec('THE-372', 'src/__tests__/__fixtures__/ownership/THE-344.json'), other)).toBe(true);
    expect(namesRecord(rec('THE-372', 'THE-344.json'), other)).toBe(true);
    expect(namesRecord(rec('THE-372', 'THE-344'), other)).toBe(true);
  });

  it('🔴 and two tickets recording DIFFERENT files write two different files', () => {
    /**
     * Proven by doing it, not by describing it. Two fresh tickets each record a
     * different path into a scratch directory; the union carries both, and
     * NEITHER record's bytes mention the other's path. That is the property
     * `NOT_OURS` could not have: there, both would have edited one literal.
     */
    const dir = mkdtempSync(path.join(tmpdir(), 'the-322-ownership-'));
    try {
      const mk = (ticket: string, file: string, digest: string) => {
        const at = path.join(dir, `${ticket}.json`);
        writeFileSync(at, JSON.stringify({
          ticket,
          entries: [{
            file,
            digest,
            why: 'A scratch record written by the register\'s own suite to prove that two tickets '
              + 'recording different files never touch a common file. Not a real pin.',
          }],
        }, null, 2));
        return at;
      };
      const aPath = mk('THE-901', 'src/components/Alpha.tsx', 'a'.repeat(64));
      const before = readFileSync(aPath, 'utf8');
      const bPath = mk('THE-902', 'src/components/Beta.tsx', 'b'.repeat(64));

      const union = loadOwnership(dir);
      expect(union).toHaveLength(2);
      expect(recordedFiles(union)).toEqual(['src/components/Alpha.tsx', 'src/components/Beta.tsx']);

      // 🔴 The second ticket's record did not touch the first ticket's file.
      expect(readFileSync(aPath, 'utf8'), 'THE-902 changed THE-901\'s record').toBe(before);
      expect(readFileSync(aPath, 'utf8')).not.toContain('Beta.tsx');
      expect(readFileSync(bPath, 'utf8')).not.toContain('Alpha.tsx');
      expect(readdirSync(dir).sort()).toEqual(['THE-901.json', 'THE-902.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a record naming a ticket it is not named for is refused', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'the-322-mislabel-'));
    try {
      writeFileSync(path.join(dir, 'THE-903.json'),
        JSON.stringify({ ticket: 'THE-319', entries: [] }));
      expect(() => loadOwnership(dir),
        'a record could claim another ticket\'s name, so two tickets could share one file again')
        .toThrow(/must be named for the ticket it carries/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — an unrecorded digest still fails
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · an unrecorded digest still fails', () => {
  it.each(recordedFiles())('%s — an unrecorded digest is refused', (file) => {
    const failure = ownershipFailureFor(file, UNRECORDED);
    expect(failure, `${file} accepted a digest no ticket recorded — that is a hole, not a pin`)
      .toBeTruthy();
    expect(failure).toContain(UNRECORDED);
    expect(failure).toContain(file);
  });

  it.each(recordedFiles())('%s — the file on disk is at a recorded digest', (file) => {
    expect(ownershipFailure(file)).toBeNull();
  });

  it('🔴 a file NO ticket recorded fails — a missing record is not an exemption', () => {
    /**
     * The subtler hole. If `ownershipFailureFor` answered `null` for a file
     * with an empty accepted set, deleting a ticket's record would EXEMPT its
     * files rather than fail, and the register would quietly stop guarding
     * whatever nobody had written down.
     */
    expect(ownershipFailureFor('src/components/NeverRecorded.tsx', sha256('anything')))
      .toContain('has no accepted digest in any per-ticket ownership record');
  });

  it('and dropping a ticket\'s record makes its files fail rather than pass', () => {
    const onlyThe320 = loadOwnership().filter((e) => e.ticket === 'THE-320');
    // ServicePlanPanel is recorded only by THE-319. With that record gone it is
    // unguarded — and unguarded must mean RED.
    expect(acceptedFor('src/components/events/ServicePlanPanel.tsx', onlyThe320)).toEqual([]);
    expect(ownershipFailureFor(
      'src/components/events/ServicePlanPanel.tsx',
      '81f99a23ff53cb1488935b7adf37cf043ff577399324e377785176d9f1e8c891',
      onlyThe320,
    ), 'a deleted record turned into a blanket exemption').toBeTruthy();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3b — an unrecorded change to firestore.rules still fails
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE and CI runs no
 * emulator tests. That is why so many suites pin it. What is asserted here is
 * the property itself: the digest on disk is one some ticket RECORDED, and a
 * value nobody recorded is accepted by nobody — so a change nobody recorded
 * turns every one of those suites red.
 *
 * ⚠️ AMENDED BY THE-325, WHICH MOVED THE ACCEPTED SET AND NOT THE PROPERTY.
 * THE-322 measured the population by grepping the tree for the live digest,
 * because each suite spelled its own copy. THE-325 consolidated those copies
 * into `__fixtures__/ownership/`, so a pinner is no longer a file that SPELLS
 * the digest — it is a file that ROUTES to the shared register. Both markers
 * are kept below and both still assert: `filesSpelling` is what proves an
 * unrecorded value appears nowhere, and `suitesPinningRules` is what proves the
 * population did not shrink when the copies went away.
 */
const RULES = 'firestore.rules';
const RULES_DIGEST_ON_DISK = sha256(readFileSync(path.join(ROOT, RULES)));

/** Every test file and fixture under `src/`, sorted, repo-relative. */
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

/** Every file under `src/` that carries `digest` verbatim. */
function filesSpelling(digest: string): string[] {
  return suiteFiles().filter((p) => read(p).includes(digest));
}

/**
 * Every SUITE that pins `firestore.rules`, measured from the tree: the ones
 * that route to THE-325's shared accepted set.
 */
function suitesPinningRules(): string[] {
  return suiteFiles().filter((p) => /\.test\.[cm]?[jt]sx?$/.test(p) && read(p).includes(RULES_PIN_MODULE));
}

/** The module every pinning suite imports. Spelled once, and greppable. */
const RULES_PIN_MODULE = 'firestore-rules-pin';

describe('3b · an unrecorded change to firestore.rules still fails', () => {
  it('the digest on disk is one a ticket recorded', () => {
    // 🔴 Through the register, so there is ONE accepted set in the repo rather
    // than 54 copies of it. The claim is the same claim: the file on disk is at
    // a state some ticket wrote down, with its ticket and its reason.
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production')
      .toBeNull();
    expect(acceptedRulesDigests().map(([digest]) => digest),
      'the register no longer accepts the file that is actually on disk')
      .toContain(RULES_DIGEST_ON_DISK);
  });

  it('🔴 and a digest no ticket recorded is accepted by NOBODY', () => {
    /**
     * This is the whole protection, stated directly. Change `firestore.rules`
     * without recording it and its digest is a value the register refuses — so
     * every suite that asks the register goes red, which is exactly what
     * happened to 45 of them when THE-313 legitimately changed the file.
     *
     * 🔴 Asserted on the PURE entry point, so the property is proved without
     * touching the rules file: a hole here would be a hole for every suite at
     * once, which is precisely the risk consolidation carries.
     */
    expect(rulesDigestFailureFor(UNRECORDED),
      'the register accepts a digest no ticket recorded — the consolidation is a hole')
      .not.toBeNull();
    expect(filesSpelling(UNRECORDED),
      'a digest nobody recorded is already written somewhere — the pins are not what they look like')
      .toEqual([]);
  });

  it('the pins are real and plural — at least forty suites route to the register', () => {
    expect(suitesPinningRules().length).toBeGreaterThan(40);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — every entry still carries a ticket and a reason
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · every entry carries a ticket and a reason, not a bare hash', () => {
  it('the register validates clean', () => {
    const problems = validateOwnership();
    expect(problems, `the ownership register is not a record:\n  ${problems.join('\n  ')}`)
      .toEqual([]);
  });

  it.each(loadOwnership().map((e) => [`${e.source} · ${e.file}`, e] as const))(
    '%s names a ticket, a reason and a digest',
    (_name, entry: OwnershipEntry) => {
      expect(entry.ticket).toMatch(/^(?:THE-\d+|#\d+)$/);
      expect(entry.why.length,
        `${entry.file}: a reason under ${MIN_REASON_LENGTH} characters is a shrug, not a record`)
        .toBeGreaterThan(MIN_REASON_LENGTH - 1);
      expect(entry.digest).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it('🔴 and the validator actually refuses each missing field', () => {
    /**
     * A validator nobody has watched fail is a validator that might not. Each
     * field is dropped in turn from a well-formed entry and the problem it
     * raises is named — the same three holes `validateRegister()` refuses.
     */
    const good: OwnershipEntry = {
      file: 'src/components/AdminSms.tsx',
      ticket: 'THE-999',
      why: 'A well-formed scratch entry used only to prove the validator refuses each missing '
        + 'field in turn. It is long enough to clear the reason floor on purpose.',
      digest: 'a'.repeat(64),
      source: 'THE-999.json',
    };
    expect(validateOwnership([good])).toEqual([]);
    expect(validateOwnership([{ ...good, digest: '' }]).join(' '))
      .toContain('exempts the file from its pin entirely');
    expect(validateOwnership([{ ...good, ticket: '' }]).join(' ')).toContain('anonymous');
    expect(validateOwnership([{ ...good, why: 'too short' }]).join(' '))
      .toContain('a bare hash is a loophole, not a record');
    expect(validateOwnership([{ ...good, file: '' }]).join(' ')).toContain('no file');
    // A digest that is not a sha256 is not a digest.
    expect(validateOwnership([{ ...good, digest: 'deadbeef' }]).join(' '))
      .toContain('no sha256 digest');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — every suite still asserts what it asserted about firestore.rules
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 THE-325 CONSOLIDATED THEM, AND THIS SECTION IS WHERE THE POPULATION IS
 * RE-COUNTED RATHER THAN DROPPED. THE-322's own baseline, kept verbatim so the
 * two numbers reconcile: 45 files in `src/` carried the live digest — 44 suites
 * plus THE-286's JSON fixture — THE-319 made 46 by deferring to
 * `the-299-retention-guards.test.ts`, and THE-322 spelled it too, which with
 * THE-323, THE-324, THE-326 and THE-327 came to 50 files carrying the digest.
 *
 * ⚠️ THE UNIT CHANGED WITH THE MECHANISM, AND THE CLAIM DID NOT. A pinner used
 * to be a file that SPELLED the digest, which counted THE-286's fixture as one
 * pinner and its four consuming SUITES as none. Since THE-325 the accepted set
 * lives in `__fixtures__/ownership/` and a pinner is a SUITE that routes to it,
 * so those four are now counted where the assertions actually are. Measured
 * from the tree, not from a CI log:
 *
 *   49 suites that spelled the digest inline (THE-322 among them)
 *  + 4 suites that read it from THE-286's fixture (THE-286, THE-296,
 *      THE-300, THE-312) and now assert it in their own case
 *  + 1 THE-319, which deferred to the-299's copy and now asks the register
 *  ──
 *  + 1 THE-325's own suite, which asks the register the same question
 *  ──
 *   55 suites, every one of them still asserting exactly what it asserted.
 *
 * ⚠️ WHAT EACH ONE STILL ASSERTS, UNCHANGED: that `firestore.rules` on disk
 * hashes to a digest it accepts, and therefore that its own ticket did not
 * touch a file which auto-deploys to production with no emulator tests in CI.
 * Not one of them was loosened or dropped — THE-325 deleted 49 copies of the
 * accepted VALUES and no assertion at all.
 *
 * 🔴 THE FLOOR IS EXACT AND MAY NOT SHRINK. A later ticket that consolidates or
 * retires a pinner updates this count and says what that suite still asserts;
 * a suite that quietly stops pinning fails here.
 */
/* ⚠️ 76 → 77, APPENDED BY THE-368, and the count is RAISED rather than
 * loosened: its guard suite is a new pinner that reaches the accepted set
 * through the shared module, asserting that linking the giving documentation
 * from the admin surfaces left `firestore.rules` untouched — the ticket renders
 * an anchor and adds no Firestore operation for a rule to express. No pinner
 * was retired and the floor still refuses a suite that quietly drops its pin.
 *
 * ⚠️ 77 → 78, RAISED BY THE-369, AND FOR THE STRONGEST REASON ON THIS LIST. That
 * ticket lets a church DELETE a `tenants/{t}/invoices` receipt, and that
 * collection's rule is the one thing standing between a CRM admin and the money
 * ledger: `allow write: if hasPermission('manageAccounting', tenantId)`. A
 * reviewer of a ticket that deletes receipts is entitled to know the rule did
 * not move an inch to let it — it did not, and it could not usefully, because
 * the delete runs on the Admin SDK behind a `manageCRM` route exactly as
 * THE-350's invoice WRITE does. THE-369 therefore records NO firestore.rules
 * digest of its own in this directory (#464 — the register is per ticket, and a
 * rules digest in it turned THE-325 red for two tickets running); it reaches the
 * accepted set through `rulesDigestFailure()` and spells no hash.
 *
 * 🔴 RAISED, NEVER LOOSENED. The floor exists to catch a suite that quietly
 * STOPS pinning, and that still fails; no pinner was retired, no accepted value
 * was widened and no digest was replaced. */
const RULES_PINNERS_NOW = 78;

/**
 * Suites added SINCE THE-322 that also pin the rules digest, one line per
 * ticket.
 *
 * ⚠️ APPENDED RATHER THAN RECOUNTED, and this list is why the count above is
 * still exact. Written as a bare `toHaveLength(46)`, section 5 said two things
 * at once: "no suite stopped pinning" — which is the claim, and which gets more
 * true over time — and "no suite ever starts", which is false the moment any
 * ticket writes a guard that freezes the file. THE-323 did, and this section
 * went red on a PR that consolidated nothing. That is the expiring shape
 * THE-315 (#454) sweeps for, so the fix is the same one this repo reaches for
 * everywhere else: name the addition, keep the floor exact.
 *
 * 🔴 THE CLAIM IS UNWEAKENED. The population may not SHRINK below the 46, and a
 * suite that appears here has to be named with its ticket — so a consolidation
 * still fails, and so does an unrecorded new pinner.
 */
const RULES_PINNERS_ADDED_SINCE: ReadonlyArray<readonly [ticket: string, suite: string]> = [
  ['THE-323', 'src/components/__tests__/THE-323.personal-information-unlock.test.tsx'],
  // 🔴 THE-324 — invite, accept and remind. APPENDED beside THE-323's entry,
  // never over it, and this ticket's own `RULES_PINNERS_NOW = 46 + 1` was
  // RETIRED into this register rather than kept beside it: two mechanisms
  // counting the same population is how one of them comes to be wrong, and
  // THE-323's is the better of the two because it names the ticket as well as
  // the file. The CLAIM is unweakened and in fact strengthened — the loop below
  // asserts this suite really does carry the digest, which a bare `+ 1` did not.
  //
  // ⚠️ WHAT IT ASSERTS: `the-324-guards.test.ts` pins `firestore.rules`
  // byte-for-byte AND asserts the file carries NO `rotaInvitations` rule,
  // because invite/accept/remind needs none — that collection has no rule and
  // therefore no client access, and every read plus the unauthenticated accept
  // write go through the Admin SDK inside `src/app/api/rota/*`, the posture
  // `smsOptOuts` and `integrations/*` already have. The rule that WOULD be
  // needed if a later ticket read it from a browser is reported in prose in
  // `src/lib/rota-invite.ts` and deliberately unwritten; that suite asserts it
  // is still only reported.
  ['THE-324', 'src/__tests__/the-324-guards.test.ts'],
  //
  // ⚠️ WHAT IT ASSERTS: `the-326-guards.test.ts` pins `firestore.rules` against
  // an accepted SET (`main` before #462, and `main` + THE-313's `servicePlans`
  // rule) and, beside the digest, asserts the deployed rule still reads
  // `allow write: if hasPermission('manageEvents', tenantId)` in as many words.
  //
  // 🔴 THAT PAIR IS THE POINT OF THE TICKET. THE-326 splits service planning out
  // of Events into its own section and deliberately writes NO rule: the plan
  // stays keyed to an event, in the same collection, under the same permission,
  // so shape A needs no migration and no rules change. `firestore.rules`
  // auto-deploys to production and CI runs no emulator test, so the readable
  // assertion sits beside the digest to say WHAT must still be true rather than
  // only that something moved.
  ['THE-326', 'src/__tests__/the-326-guards.test.ts'],
  // ⚠️ THE-327 pins it for the reason this list exists: `firestore.rules`
  // auto-deploys to production and CI runs no emulator test, so a ticket that
  // must not touch it says so by digest rather than by promise.
  //
  // 🔴 THE-327 WRITES NO RULE, and needed none. It consolidates SMS into one
  // section and gives the orphaned Library screen a way into the sidebar —
  // both purely client-side. Nothing about who may read or write a number, a
  // broadcast or a usage document changed: the purchase route still gates on
  // `getEffectiveFeatures(...).smsAutomation`, the usage subcollection is
  // still default-deny to clients and read only through the Admin SDK, and
  // `smsNumbers/{number}` is still written server-side only. Beside the
  // digest, THE-327's suite also pins `firestore.indexes.json`, `functions/`,
  // `sms-optout.ts` and `layout.tsx`, which are out of scope by instruction.
  ['THE-327', 'src/components/__tests__/THE-327.sms-consolidation.test.tsx'],
  // ⚠️ THE-329 pins it for this list's reason: `firestore.rules` auto-deploys to
  // production and CI runs no emulator test, so a ticket that must not touch it
  // says so by digest rather than by promise. APPENDED beside THE-327's entry,
  // never over it.
  //
  // 🔴 THE-329 WRITES NO RULE, AND ESTABLISHED THAT IT NEEDS NONE. It lets a
  // church create a service WITHOUT first creating an event — the founder's
  // "If I have no event created, I cannot create any service, which is stupid."
  // That is one new FIELD (`startAt`) on documents in the SAME
  // `tenants/{t}/servicePlans` collection, and it adds no query shape at all
  // (the services list reuses the rota's existing
  // `where('isTemplate','==',false)` read). Neither half of the deployed rule
  // reads `resource.data`, so there is nothing for a rule to newly permit.
  //
  // ⚠️ WHAT ITS SUITE ASSERTS BESIDE THE DIGEST: that the block still reads
  // `allow read: if belongsToTenant(tenantId)` and
  // `allow write: if hasPermission('manageEvents', tenantId)` in as many words,
  // and that NO `manageServices` or `managePlanning` permission was invented —
  // a new claim would add a row to the roles matrix that no rule, no API route
  // and no other screen knows about, and every one of them would still be
  // checking `manageEvents`.
  ['THE-329', 'src/__tests__/the-329-guards.test.ts'],
  // 🔴 APPENDED BY THE-330, nothing above removed. Its guard suite asserts that
  // the number-purchase rebuild left `firestore.rules` — and `sms-optout.ts`,
  // `firestore.indexes.json`, `layout.tsx` and every file under `functions/` —
  // byte-identical, because none of them was in scope and none was needed.
  ['THE-330', 'src/__tests__/THE-330.purchase-guards.test.ts'],
  // 🔴 APPENDED BY THE-336, nothing above removed, and the count above raised by
  // exactly one. Its suite pins the rules digest through the same module every
  // entry here does.
  //
  // 🔴 THE-336 WRITES NO RULE, AND ESTABLISHING THAT IS PART OF ITS RESULT. It
  // fixes a member onboarding funnel whose last step rejected with `No document
  // to update: …/users/<uid>`, because both of its writes used `updateDoc` on a
  // document that a swallowed failure in `AuthPage` had left uncreated. The
  // deployed rule ALREADY allowed the fix: `users/{userId}` carries `allow
  // create: if isAuthenticated() && request.auth.uid == userId && (!…hasAny(
  // ['role']) || …role == 'user')`, and a write to a MISSING document is
  // evaluated as a create. So the writer branches on existence — `setDoc` with
  // the identity block when the document is absent, `updateDoc` when it is
  // present — and each half lands under the rule that already permitted it.
  //
  // ⚠️ WHAT ITS SUITE ASSERTS BESIDE THE DIGEST: that a document created from
  // onboarding is COMPLETE rather than a fragment (uid, email, displayName,
  // createdAt, role, tenantId), that it invents no consent record and writes no
  // `plan` and no theme preference, that #429's country invariant gains no third
  // state, and that `firestore.indexes.json`, `functions/` and `layout.tsx` are
  // byte-identical too.
  ['THE-336', 'src/components/__tests__/THE-336.onboarding-user-doc.test.tsx'],
  // ⚠️ APPENDED BY THE-337, beside THE-336's entry and not instead of it. Its
  // suite is a MEASURED one — it drives the shipped `AttachMenu` in a real
  // Chromium — and it reaches the accepted set through the shared module, so a
  // legitimate rules change still costs exactly one edit.
  //
  // 🔴 THE-337 WRITES NO RULE, and needed none. The composer's paperclip opened
  // a menu nobody could see: `render={<Button …/>}` on a React 18 function
  // component handed `Menu.Positioner` a null ref, so the positioner never
  // measured and never left `opacity: 0`. The fix is one trigger element in one
  // component. Nothing about who may read a doc, a contact, a campaign or a
  // form changed — the four loaders issue exactly the queries they issued
  // before, from the same screen, under the same permissions, and this ticket
  // adds no read and no write.
  //
  // ⚠️ WHAT ITS SUITE ASSERTS BESIDE THE DIGEST: that clicking the paperclip
  // produces a menu with real area and opacity at six widths and at BOTH
  // composer sites, that the positioner actually anchored, that no sampled
  // pixel of the open menu belongs to anything else, that all four category
  // flyouts open and end in Browse…, that Browse… opens the cascader and a
  // record can be picked, and that `firestore.indexes.json`, `functions/` and
  // `layout.tsx` are byte-identical too.
  ['THE-337', 'src/components/__tests__/THE-337.attach-menu-visibility.layout.test.tsx'],
  // ⚠️ APPENDED BY THE-340, beside THE-337's entry and not instead of it.
  //
  // 🔴 THE-340 WRITES NO RULE AND NEEDED NONE. It moves rota invitations and
  // reminders off the church's own Gmail onto Resend, from a Harvest-controlled
  // sender on a verified domain, so a church that has connected nothing can
  // still reach its volunteers. That is a TRANSPORT change: the collection it
  // writes, `tenants/{t}/rotaInvitations`, still has no rule and still needs
  // none, because every access to it goes through the Admin SDK inside a route
  // under `api/rota/`, which bypasses rules entirely. Nothing about who may
  // read or write anything changed.
  //
  // ⚠️ WHAT ITS SUITE ASSERTS BESIDE THE DIGEST: that a volunteer is reached
  // with NOTHING connected, that the send goes out from the verified Harvest
  // domain, that a rejected send — whether it throws, resolves with an error,
  // or finds no API key — is reported as a FAILURE rather than as "no
  // invitation", that the accept link's URL shape and its two-field write scope
  // are unmoved, that `rota-invite.ts` still constructs no provider client and
  // imports none, that the Gmail scope guard still fails closed when CALLED,
  // and that `firestore.indexes.json`, `functions/` and `layout.tsx` are
  // byte-identical too.
  ['THE-340', 'src/__tests__/THE-340.rota-resend.test.ts'],
  // 🔴 THE-341 — BROADCASTING renamed to REACH and `forms` moved into it.
  // APPENDED beside the entries above, never over one. Its suite asks the
  // register `rulesDigestFailure()` rather than spelling the digest, exactly as
  // every pinner here does, so a real rules change still costs ONE edit — and
  // THE-333 writing a rules digest into its own record, which turned THE-322
  // and THE-325 red, is the reason this ticket asks instead of writing. The
  // rename is a nav change: it reads nothing from Firestore and needed no rule.
  ['THE-341', 'src/__tests__/THE-341.reach-group.test.ts'],
  // 🔴 THE-342 — the three reads that lie about being complete. APPENDED beside
  // the entries above, never over one, and `RULES_PINNERS_NOW` goes 61 -> 62.
  //
  // ⚠️ ITS FIRST DRAFT MADE THE MISTAKE THIS REGISTER EXISTS TO CATCH: it wrote
  // the rules digest as a literal in its own baseline, which is exactly what
  // THE-333 and THE-341 each did and what turned THE-325 red both times. THE-325
  // caught it here, before review. The suite now asks `rulesDigestFailure()`
  // like every other pinner, so a legitimate rules change still costs ONE edit,
  // and this ticket records NO rules digest in its ownership entry either.
  //
  // ⚠️ WHAT IT ASSERTS: every bounded read in CoursePage, AdminCourses,
  // ChurchMap and useCRMQueries is ORDERED (an unordered `limit(N)` returns
  // arbitrary rows), that no read needs a composite index — every one is a
  // single equality `where` plus `orderBy(documentId())`, a prefix scan of an
  // automatic (field, __name__) index — and that `firestore.indexes.json`,
  // `functions/` and `layout.tsx` are byte-identical. It needed no rule change:
  // the unfiltered /courses read it investigated is already REJECTED wholesale
  // for a non-super-admin by the existing `belongsToTenant(resource.data...)`
  // rule, so the fix was to stop swallowing that rejection, not to change what
  // the rule allows.
  ['THE-342', 'src/__tests__/THE-342.read-honesty-guards.test.ts'],
  // APPENDED BY THE-345, beside THE-342's entry and never over it - the
  // documented cost of adding a suite that pins firestore.rules through the
  // shared register. RULES_PINNERS_NOW goes 62 -> 63.
  //
  // THE-345 gates paid event ticketing behind PAID_EVENTS_ENABLED after the
  // founder said "I should not be able to create paid events with stripe
  // disabled", and stops a dangling adoption pointer counting towards the course
  // figure and the plan cap. It records NO rules digest in its ownership entry
  // either, and it needed no rule change: `adoptedCourses` is already
  // `allow write: if false` and STAYS that way - the ghost is cleared through
  // the DELETE /api/courses/adopt route that already exists and is already
  // idempotent - and nothing about gating a price in the client touches a rule,
  // because the price was never written by a rule-governed path this ticket
  // alters.
  //
  // WHAT IT ASSERTS: that the paid-events gate is ONE value in a module that
  // imports nothing, that nothing was deleted to hide it (every gated surface is
  // still named in AdminEvents), that the price is gated in BOTH write paths
  // rather than merely hidden in the UI, that `adoptedCourses` is still
  // server-only and still mutated only through its existing route, and that
  // `firestore.indexes.json`, `functions/`, `layout.tsx`, the event-registration
  // routes and THE-342's `bounded-list-read.ts` are byte-identical.
  ['THE-345', 'src/__tests__/THE-345.paid-events-and-count-guards.test.ts'],
  // 🔴 THE-346 — six UI defects the founder found on a phone. APPENDED beside
  // the entries above, never over one, and `RULES_PINNERS_NOW` goes 63 -> 64.
  //
  // ⚠️ THE ONE ITEM THAT COULD HAVE NEEDED A RULE IS "Share on web", which
  // creates a PUBLIC link to a church's internal note — and it needed none,
  // for the reason THE-324 established one ticket at a time earlier: the share
  // record lives at the top-level `publicNotes/{token}`, which has NO RULE and
  // therefore no client read and no client write, and every access — minting,
  // revoking, and the signed-out reader's own fetch — goes through the Admin
  // SDK in `app/api/docs/public-share/` and `app/n/[token]/`. `/docs/{docId}`'s
  // read is UNTOUCHED, which is the point: widening that one line is the change
  // that would expose every note in the collection rather than the one being
  // shared. This ticket records NO rules digest in its ownership entry either,
  // and asks `rulesDigestFailure()` like every other pinner — THE-333 and
  // THE-341 each spelling one is what turned THE-325 red, twice.
  //
  // ⚠️ WHAT IT ASSERTS: that `firestore.rules` is at a recorded digest, that
  // `publicNotes` appears nowhere in it, that there is no catch-all
  // `match /{document=**}` (so an unruled top-level collection really is
  // default-deny, which is the assumption the whole design rests on), that
  // `/docs/{docId}` still requires authentication, that every path to a share
  // record goes through the Admin SDK, that the map declares a `minZoom` and a
  // non-wrapping tile layer while #476's `key={mapTheme}` and OSM attribution
  // stay byte-identical, that every element it shipped names the primitive it
  // adopted and the ones it rejected, and that `firestore.indexes.json`,
  // `functions/` and `layout.tsx` are byte-identical.
  ['THE-346', 'src/__tests__/the-346-guards.test.tsx'],
  // 🔴 THE-348 — the member chat's composer, attach menu and admin gate.
  // APPENDED beside the entries above, never over one, and `RULES_PINNERS_NOW`
  // goes 64 -> 65.
  //
  // ⚠️ THIS TICKET FOUND A RULES GAP AND DELIBERATELY DID NOT CLOSE IT, which
  // is why it pins rather than edits. The founder asked for the paperclip to
  // be hidden from members and it is — measured absent in a real browser. But
  // `dmMessages` and `channelMessages` create carry NO field allowlist, so the
  // rules permit a member to write an `attachments` array by any route that is
  // not the button, and hiding a button is not a permission. Closing it means
  // constraining two of the hottest write paths in the product, in a file that
  // AUTO-DEPLOYS on merge with no emulator tests — THE-313's one line turned 46
  // files red — so it is REPORTED, in this ticket's own suite, as a set of
  // assertions that go red the day someone adds the allowlist and makes the
  // report stale. THE-348 records NO rules digest in its ownership entry and
  // asks `rulesDigestFailure()` like every other pinner.
  //
  // ⚠️ WHAT IT ASSERTS: that `firestore.rules` is at a recorded digest; that
  // `dmMessages`/`channelMessages` create still ask only WHO is writing and
  // never WHAT, and that exactly one of the four attachable categories
  // (`forms`) is member-readable — all three of which go red if the rules move
  // under the report; that #490's `data-nav-shell` string in AdminDashboard is
  // still a plain double-quoted literal, so its four discovery guards still
  // find it; that the member nav hides by a CONDITION and the lowering is an
  // effect CLEANUP, so the nav cannot stay hidden; that #437's safe-area inset
  // is carried and never applied unprefixed; that Rule 6, the DM and channel
  // lists, compose-new, search and back all survive; that #475's
  // `items-end sm:items-center` holds on every remaining sheet and the
  // forms-only picker is gone; that the surface is the SHARED AttachMenu with
  // its rejections named per element; that no emoji, hex or raw Tailwind scale
  // entered the file; that this PR's own guards pin no line number, no
  // near-today fixture and nothing about the branch diff; and that
  // `firestore.indexes.json`, `functions/` and `layout.tsx` are byte-identical.
  ['THE-348', 'src/components/__tests__/THE-348.member-composer.guards.test.ts'],
  // THE-349 — GOOGLE SIGN-UP CREATED A USER WHO BELONGED TO NO CHURCH. A real
  // member's `users` document carried `tenantId: null`, which withheld their
  // `tenantId` claim and made them invisible to their ministry's dashboard and
  // CRM, unable to post a prayer request and unable to read its posts.
  //
  // The cause is `tenantId: <x> || null` on three create paths — two in
  // `AuthPage` and one in `Onboarding`'s THE-336 safety net. That operator
  // cannot tell "belongs to no ministry" (a super admin, the apex, the
  // www/app/admin/affiliate aliases, a preview host — where null is CORRECT
  // and stays) from "belongs to a ministry I could not name", and writes null
  // for both. The reproducible instance is a CUSTOM DOMAIN: the screen's
  // fallback there is a `tenantId=` cookie "set server-side by middleware",
  // and `src/middleware.ts` sets no cookie at all.
  //
  // 🔴 THIS SUITE ASKS `rulesDigestFailure()` AND RECORDS NO RULES DIGEST OF
  // ITS OWN, which is the whole posture of the ticket. The repair a stuck
  // member needs is a `tenantId` write, and the `users` update rule refuses
  // one to the member AND to their tenant admin — only `isSuperAdmin()` or the
  // Admin SDK can make it. Loosening that rule to allow a self-repair would be
  // a tenant-hopping surface, in a file that AUTO-DEPLOYS on merge with no
  // emulator tests; THE-313's one line turned 46 files red. So the rule is
  // ASSERTED as it stands — the suite goes red the day it moves and the repair
  // instructions in the PR become stale — and the repair itself is reported as
  // a console change for the founder rather than shipped as a rules edit.
  //
  // ⚠️ WHAT IT ALSO ASSERTS: that the brief's iOS-redirect hypothesis is not
  // in this codebase (`signInWithRedirect`/`getRedirectResult` appear in no
  // source file, so there is no hop to lose a hostname on); that middleware
  // still sets no cookie, which is the evidence the diagnosis rests on; that
  // no create path coerces an unknown tenant to null and every one routes
  // through a helper that THROWS on one; that the refusal composes the
  // installed `alert` primitive and introduces no tappable control; that
  // neither edited screen gained a hex literal or an emoji; that this PR's own
  // guards pin no line number, no near-today fixture and nothing about the
  // branch diff; and that `firestore.indexes.json`, `functions/`,
  // `src/app/layout.tsx`, `package.json` and the lockfile are byte-identical.
  ['THE-349', 'src/components/__tests__/THE-349.orphan-signup.guards.test.ts'],
  // THE-350 — A MANUAL DONATION WROTE A CRM NOTE AND NOTHING ELSE. The founder:
  // "If I add a donation from a user in CRM it updates the CRM but not the
  // dashboard." There were TWO records of a gift and only ONE of them counted:
  // `tenants/{t}/invoices` is the money ledger every surface reads — the
  // Overview giving figure, AdminAccounting, the year-end giving statement and
  // `/api/donation-history`, which is how a MEMBER retrieves their own receipts
  // — and its only writer was the Stripe donation webhook. Add Activity →
  // Donation wrote a `contactActivities` row, which nothing downstream reads as
  // money. `lib/manual-donation.ts` now writes the same `donation_receipt`
  // invoice the webhook writes, so one manual entry reaches all five surfaces
  // with no new reader anywhere.
  //
  // 🔴 THIS SUITE ASKS `rulesDigestFailure()` AND RECORDS NO RULES DIGEST OF
  // ITS OWN, and that is the shape of the ticket rather than an omission. The
  // invoices rule is `hasPermission('manageAccounting', tenantId)` and the
  // admin recording a gift holds `manageCRM`, so a CLIENT write would be
  // refused for exactly the people who do the recording. Loosening the rule
  // would hand every CRM admin direct write access to the money ledger, in a
  // file that AUTO-DEPLOYS on merge with no emulator tests. So the write goes
  // through the Admin SDK behind `/api/donations/manual`, which imposes
  // `requireTenantPermission(request, tenantId, 'manageCRM')` itself — the
  // documented use for that helper — and the rule is ASSERTED as it stands, so
  // the suite goes red the day it moves and this reasoning becomes stale.
  //
  // ⚠️ WHAT ELSE IT ASSERTS: that the gift is not counted twice (the invoice is
  // the money record; the timeline entry carries `amount: null` and an
  // `invoiceId`); that `amount` is INTEGER CENTS and every dollar value goes
  // through `formatCents` (AdminAccounting shipped the inverse and rendered
  // $105,500 as $10,550,000); that `recipientEmail` is normalised trim AND
  // lowercase on the way in, matching what `/api/donation-history` does to the
  // caller's verified token, with User A vs User B run through the REAL route;
  // that a gift with no email is RECORDED and its consequence named on screen
  // before the save; that `issuedAt` is an ISO string, the one representation
  // all three webhook receipt writes use; that the writer is ONE function no
  // second place duplicates; that a failed write keeps the dialog open with the
  // typed value; that erasure and export reach a manual receipt unchanged; that
  // no admin surface still says card giving is "temporarily" unavailable or
  // implies a migration or a date; that its guards pin no line number, no
  // near-today fixture and nothing about the branch diff; and that
  // `firestore.indexes.json`, `functions/` and `src/app/layout.tsx` are
  // byte-identical.
  ['THE-350', 'src/__tests__/THE-350.manual-donation-invoice.test.ts'],
  // 🔴 THE-351 — PAID EVENTS WITH NO PAYMENT RAIL: the church confirms, Harvest
  // records what the church says. APPENDED beside THE-350's entry, never over
  // it, and `RULES_PINNERS_NOW` goes 67 -> 68 — the documented cost of adding a
  // suite that pins firestore.rules through the shared register.
  //
  // ⚠️ A PER-TENANT INBOX IS THE SHAPE THAT USUALLY NEEDS A RULE — a new
  // collection, scoped to one church, readable by its admins — and this one
  // needed none, which is a finding rather than luck. A claim and its
  // confirmation are FIELDS on `tenants/{t}/registrations/{id}`, whose read rule
  // already says `isAuthenticated() && (isTenantAdmin(tenantId) || …)` with the
  // tenant taken from the PATH; and the WRITE side needed none either, for
  // THE-350's reason one layer along — the registration update rule requires
  // `manageEvents`, which a MEMBER pressing "I've paid" does not hold, so rather
  // than loosen a rule on a document carrying a money amount in a file that
  // AUTO-DEPLOYS with no emulator tests, the write goes through the Admin SDK
  // behind a route whose own ownership check (verified uid OR verified token
  // email) is STRICTER than the rule would have been. THE-351 records NO rules
  // digest in its ownership entry and asks `rulesDigestFailure()` like every
  // other pinner.
  //
  // ⚠️ WHAT IT ASSERTS: that `firestore.rules` is at a recorded digest and that
  // the registrations read rule it relies on has not moved; that no UI, email or
  // push string in the feature claims Harvest verified anything, swept over
  // COMMENT-STRIPPED source with a vacuity guard on each sweep; that the
  // creation disclaimer is present and unsoftened and stands ABOVE the pricing;
  // that a church's per-event provider selection can only ever NARROW the links
  // it publishes; that check-in is gated on registration status and nothing
  // else, so an unconfirmed guest is never turned away; that the CSV Amount
  // column exports a WORD for anything nobody vouched for and a figure only for
  // an invoice-backed row; that erasure and export already cover an inbox item
  // because it IS a registration; that the two switches are separate and
  // neither implies the other; that this PR's own guards pin no line number, no
  // near-today fixture and nothing about the branch diff; and that
  // `firestore.indexes.json`, `functions/` and `layout.tsx` are byte-identical.
  ['THE-351', 'src/__tests__/THE-351.manual-payment.guards.test.ts'],
  // 🔴 THE-355 — THE PUBLIC EVENT PAGE: no payment link, no way to claim, and a
  // button that promised a processor that no longer exists. APPENDED beside
  // THE-351's entry, never over it, and `RULES_PINNERS_NOW` goes 68 -> 69 — the
  // documented cost of adding a suite that pins firestore.rules through the
  // shared register.
  //
  // ⚠️ A PUBLIC, UNAUTHENTICATED WRITE AGAINST A DOCUMENT CARRYING A MONEY
  // AMOUNT IS THE SHAPE THAT MOST OBVIOUSLY NEEDS A RULE, and it needed none —
  // which is a finding rather than luck, and the same one THE-351 made one layer
  // in. The public claim is the Admin SDK inside a route, exactly as THE-351's
  // authenticated one is, so the registration UPDATE rule requiring
  // `manageEvents` is untouched and nothing is loosened in a file that
  // AUTO-DEPLOYS with no emulator tests. What replaces the rule is a STRONGER
  // shape: the route accepts no `registrationId` at all and finds the document
  // BY a stored 256-bit token — THE-324's rota-invitation pattern — so there is
  // no pair to mismatch and no expressible request that names somebody else's
  // seat. THE-355 records NO rules digest in its ownership entry and asks
  // `rulesDigestFailure()` like every other pinner.
  //
  // ⚠️ WHAT IT ASSERTS: that `firestore.rules` is at a recorded digest; that the
  // public page shows the church's own chosen payment links, which reached only
  // the logged-in member app before; that the submit button promises no redirect
  // while `manualConfirmationMode()` holds; that the dormant Stripe-return
  // branch is GATED on the same constant that gates Checkout, so "Payment
  // received" cannot render for a query string anyone can type; that a
  // logged-out registrant can claim and that a claim cannot land on another
  // person's registration; that Confirm still appears in the inbox, is still
  // idempotent and still calls THE-350's writer; that the two meanings of
  // "confirmed" are spelled differently; that check-in still never blocks on
  // payment and free registration is untouched; that every control clears 44px
  // below `sm` measured in a real Chromium at five widths with animation
  // suppressed; and that `firestore.indexes.json`, `functions/` and
  // `layout.tsx` are byte-identical.
  ['THE-355', 'src/__tests__/THE-355.public-payment.guards.test.ts'],
  // 🔴 THE-357 — three things reported and never swept. APPENDED beside
  // THE-355's entry, never over it, and the floor above moves 69 -> 70 with it:
  // the count is exact by design and this register is what keeps it so.
  //
  // ⚠️ WHAT IT ASSERTS: that `firestore.rules` is at a recorded digest, and that
  // `firestore.indexes.json`, `functions/` and `layout.tsx` are byte-identical —
  // this ticket adds no read, no write and no collection, so there is nothing
  // for a rule to govern and it records NO rules digest in its own ownership
  // entry. Beyond that: that THE-311 §8 asserts nothing about the current
  // branch's diff and that each of its three claims survives by CONTENT; that
  // #454's standing sweep would NOT have caught §8 even with its known binding
  // blind spot closed, because its detector hunts the NON-EMPTY direction alone
  // — proved on planted samples with the dataflow held fixed, and the cost of
  // closing it pinned per suite as a handover rather than swept here; that no
  // shipped source file promises a money rail is coming back, swept over the
  // whole tree and named per file; that what replaces the share-sheet copy is
  // TRUE, clause by clause against the tree; that `the-313-guards` is not
  // weakened — THE-313's own digest still accepted, THE-357's appended beside
  // it, and the URL builder and host validation the pin exists for pinned
  // verbatim; and that no colour, emoji, token, primitive or dependency was
  // added. Its measured half lives in
  // `THE-357.admin-sms-controls.layout.test.tsx`, in real Chromium at five
  // widths with animation suppressed.
  ['THE-357', 'src/__tests__/THE-357.guards.test.ts'],
  // ⚠️ WHAT IT ASSERTS: that `firestore.rules` is at a recorded digest, and that
  // `firestore.indexes.json`, `functions/` and `layout.tsx` are byte-identical.
  // THE-358 adds a LINK — one <a> to docs.theharvest.site in the admin account
  // menu, below Billing & Payments — so it adds no read, no write and no
  // collection, there is nothing for a rule to govern, and it records NO rules
  // digest in its own ownership entry. Beyond that: that the row renders at the
  // right address, opens in a new tab with rel="noopener", is UNGATED (present
  // for an admin who may reach neither Settings nor Billing), and sits DIRECTLY
  // under Billing & Payments — asserted as an ORDER over rendered markup, since
  // "above or under billing" was the founder's whole instruction; that every
  // pre-existing row survives in order, still a button, still carrying the
  // `w-full` THE-181's guard requires of that file; that the rail's flyouts and
  // the REACH group are untouched, asked of the ownership register rather than
  // of the diff; and that no colour, emoji, token, primitive or dependency was
  // added. Its measured half lives in `THE-358.account-menu.layout.test.tsx`,
  // in real Chromium at five widths with animation suppressed, where it also
  // records that every row of that menu was under BOTH floors before it.
  ['THE-358', 'src/components/__tests__/THE-358.account-menu.test.tsx'],
  // ⚠️ WHAT IT ASSERTS: that `firestore.rules` is at a recorded digest, and that
  // `firestore.indexes.json`, `functions/` and `layout.tsx` are byte-identical.
  // THE-359 rewrites attendee copy, withholds a QR until a payment is confirmed
  // and adds ONE CRM activity write — and that write is the reason it is worth
  // saying it needed no rule change. It goes through the Admin SDK behind a
  // route that already imposes `manageEvents`, and both collections it reaches,
  // `contacts` and `contactActivities`, are ones `member-erasure.ts` and
  // `member-export.ts` already enumerate; the contact lookup is ONE equality
  // `where` with no `orderBy`, a single-field index Firestore maintains
  // automatically, so `firestore.indexes.json` — which `deploy-rules.yml` does
  // not deploy — stays untouched too. It records NO rules digest in its own
  // ownership entry. Beyond that: that the door guarantee is gone from every
  // attendee-facing surface, swept per file over parser-stripped source AND
  // over what the copy builders actually produce at a real tenant name and at
  // a missing one; that check-in still never blocks on payment, read off the
  // shipped `AdminEvents` source it does not edit; that the "I've paid"
  // disclaimer names the tenant, says the press confirms nothing, and mentions
  // neither the door, nor what you owe, nor anything Harvest checked; that no
  // attendee-facing string says "the church", with a COMPLETENESS check proving
  // a newly added member-facing export cannot escape the sweep; that the public
  // claim route's request body still takes no registration id; and that free
  // registration, the waitlist, discount codes, ticket-type capacity and the
  // CSV export are untouched. Its rendered halves live in
  // `THE-359.member-ticket-qr.test.tsx` (the QR gate, including the FREE-ticket
  // regression at both spellings), `THE-359.crm-activity.test.ts` (THE-350's
  // no-double-count shape and idempotence) and
  // `THE-359.partnership-card.test.tsx`; its measured half in
  // `THE-359.partnership-button.layout.test.tsx`, in real Chromium at five
  // widths with animation suppressed.
  ['THE-359', 'src/__tests__/THE-359.paid-event-copy.guards.test.ts'],
  // THE-360 — THE ANALYTICS VOCABULARY HAD ONE WORD IN IT. Fourteen days of
  // production held 372 pageviews and nothing else, because `ANALYTICS_EVENTS`
  // listed exactly `$pageview`: a church could record a gift, publish a course
  // and send a rota invitation without any of it being visible. This suite
  // widens that list to ten and asserts the widening changed none of the
  // decisions that make PostHog safe on an app holding donor records —
  // autocapture still off, `capture_pageview` still off, the identity events
  // still a LIST of three rather than a `$` prefix that would admit
  // `$copy_autocapture`, paths still replaced by their route PATTERN, an
  // unmatched path still `UNROUTED_PATTERN`, and `admin-sections.ts` still at
  // zero imports so the blog bundle stays free of the Firestore SDK.
  //
  // 🔴 IT ASKS `rulesDigestFailure()` AND RECORDS NO RULES DIGEST OF ITS OWN.
  // Every one of the nine events is a client-side `capture()` fired beside a
  // write that already existed, on a screen whose permissions already governed
  // it; the one money path, a manual gift, still reaches
  // `tenants/{t}/invoices` through `/api/donations/manual` on the Admin SDK
  // exactly as THE-350 left it. Nothing this ticket adds is a document read, a
  // document write, or a name Firestore has ever seen.
  ['THE-360', 'src/lib/analytics/__tests__/THE-360.product-vocabulary.test.ts'],
  // THE-361 — THE ELEVENTH WORD. THE-360 proposed `course_adopted` and dropped
  // it on its own agent's report that no adopt action could be found; the agent
  // then found one and said so, and the founder has since asked for it. The
  // premise was wrong, not the decision: `AdminCourses.tsx` has posted to
  // `/api/courses/adopt` since #228, and `CoursePreview` adopts through the
  // same handler, so ONE instrumentation point covers both surfaces. This suite
  // asserts that adding the name changed none of the decisions THE-360's entry
  // above lists — autocapture still off, `capture_pageview` still off, the
  // identity events still a LIST of three, paths still replaced by their
  // PATTERN, `admin-sections.ts` still at zero imports — and that the event
  // itself fires on SUCCESS ONLY, exactly once, carrying NO course id, title or
  // author, through the seam that returns void and cannot be awaited.
  //
  // IT ASKS `acceptedRulesDigests()` AND RECORDS NO RULES DIGEST OF ITS OWN.
  // The event is one client-side `capture()` fired beside a request that
  // already existed, on a screen whose permissions already governed it;
  // `adoptedCourses` is still `allow write: if false` and the pointer is still
  // written only by the Admin SDK behind `/api/courses/adopt`. Nothing this
  // ticket adds is a document read, a document write, or a name Firestore has
  // ever seen.
  ['THE-361', 'src/components/__tests__/THE-361.course-adopted.test.tsx'],
  // 🔴 THE-362 — the dashboard's 100x, the Stripe copy on the giving screens,
  // the livestream support button and the CRM delete. APPENDED beside the
  // entries above, never over one, and `RULES_PINNERS_NOW` goes 74 -> 75.
  //
  // ⚠️ IT RECORDS NO `firestore.rules` DIGEST, and that is a FINDING rather
  // than an omission. Its STOP condition 4 was "the CRM delete needs a rules
  // change"; it does not. The top-level `contacts` rule already allows delete
  // to a holder of `manageCRM`, and the founder's bug was never a permission
  // one — the write named a `contacts` document that has never existed, because
  // the CRM list merges `contacts` with `users` and an app member's row is
  // keyed by their `users` id. The fix PREVENTS two writes and adds no
  // Firestore operation of any kind, so there is nothing here a rule could
  // have expressed, and a rules record would be this ticket claiming a file it
  // never opened. What its guard suite asserts is what every pinner asserts:
  // `firestore.rules` on disk is at a digest some ticket recorded, through
  // `rulesDigestFailure()` and never as a literal — the mistake THE-325 caught
  // #504 making, and which this register exists to keep catching.
  ['THE-362', 'src/__tests__/THE-362.guards.test.ts'],
  // 🔴 THE-364 — the eight-card bundle (THE-107, THE-218, THE-171, THE-101,
  // THE-52, THE-98, THE-56, THE-43). APPENDED beside the entries above, never
  // over one, and `RULES_PINNERS_NOW` goes 75 -> 76.
  //
  // ⚠️ IT RECORDS NO `firestore.rules` DIGEST, and for this bundle that is the
  // HEADLINE rather than a footnote. TWO of its eight cards landed on a rule
  // and BOTH stopped at the file:
  //
  //   · THE-107 found that `isSuperAdmin()` accepts `tokenEmail()` with no
  //     `email_verified` test, on all three surfaces. The replacement rule is
  //     written out in the pull request and NOT applied here — whether the
  //     founder's own accounts are verified decides whether that one line locks
  //     the platform owner out, and that is not a question a test can answer.
  //   · THE-52 was asked for a message cap on Community Groups. The only
  //     BINDING place to put one is this file, so the recommended number and
  //     the exact rule are reported and no cap ships.
  //
  // What its guard suite asserts is what every pinner asserts: `firestore.rules`
  // on disk is at a digest some ticket recorded, through `rulesDigestFailure()`
  // and never as a literal — the mistake THE-325 caught #504 making.
  ['THE-364', 'src/__tests__/THE-364.bundle-guards.test.ts'],
];

describe('5 · every suite that pinned firestore.rules still pins it', () => {
  it('the population never shrank — nothing was consolidated away', () => {
    const pinners = suitesPinningRules();
    expect(pinners.length,
      'a suite stopped pinning firestore.rules. THE-325 consolidated the accepted VALUES and '
      + 'no assertion; if a later ticket retires a pinner, it updates this count and says what '
      + `that suite still asserts. Currently pinning:\n  ${pinners.join('\n  ')}`)
      .toBe(RULES_PINNERS_NOW);
    expect(pinners, 'THE-322 no longer pins firestore.rules itself').toContain(SELF);
    // Each recorded addition really is a pinner, so the list cannot pad the
    // count with a suite that does not pin.
    for (const [ticket, suite] of RULES_PINNERS_ADDED_SINCE) {
      expect(pinners, `${ticket} is recorded as a pinner but ${suite} does not pin the rules`)
        .toContain(suite);
    }
  });

  it('🔴 the four THE-286-fixture readers assert it in their own case now', () => {
    /* They pinned it through `UNTOUCHED.rulesAndFunctions`, which THE-325 no
       longer carries. The assertion did not go with the value — each of the
       four asks the register directly, so all four still fail on a rules change
       nobody recorded. */
    for (const suite of [
      'src/components/__tests__/THE-286.settings-chrome-autosave.test.tsx',
      'src/components/__tests__/THE-296.settings-sections.test.tsx',
      'src/components/__tests__/THE-300.billing-surface.test.tsx',
      'src/components/__tests__/THE-312.settings-freeze-registers.test.tsx',
    ]) {
      expect(read(suite), `${suite} stopped pinning firestore.rules`).toContain(RULES_PIN_MODULE);
    }
    expect(read('src/components/__tests__/__fixtures__/the-286-untouched.json'),
      "THE-286's fixture carries a second copy of the accepted set again")
      .not.toContain(RULES_DIGEST_ON_DISK);
  });

  it('THE-319 asks the register rather than spelling a second copy', () => {
    /* Its deferral to the-299's literal is what THE-325 replaced; what it
       deferred FOR — that THE-319 did not open the rules file — is asserted in
       its own case now, and the-299 is still the suite that pins the other two
       files THE-319 defers on. */
    const the319 = read('src/__tests__/THE-319.composition-guards.test.ts');
    expect(the319, 'THE-319 no longer pins firestore.rules at all').toContain(RULES_PIN_MODULE);
    expect(the319).toContain('the pins that already exist still hold');
  });

  it('and every pinner is still where it was', () => {
    for (const suite of suitesPinningRules()) {
      expect(suite.startsWith('src/'), `${suite} is not where it was`).toBe(true);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — no source file appears in this diff  (GATED ON THE BASE REF)
 * ═══════════════════════════════════════════════════════════════════════════ */

const gitOut = (args: string[]) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * The commit this branch is measured against. The fallback chain is the one
 * THE-315 uses, and for the same CI reason — a `pull_request` run checks out
 * `refs/pull/N/merge`, where `origin/main` may not exist.
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
function landedOnBase(rel: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${baseRef()}:${rel}`],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/** The changed paths PLUS untracked files — a NEW source file counts too. */
function changedPaths(): string[] {
  const lines = (args: string[]) => gitOut(args).split('\n').filter(Boolean);
  return [...new Set([
    ...lines(['diff', '--name-only', baseRef()]),
    ...lines(['ls-files', '--others', '--exclude-standard']),
  ])].sort();
}

const isTestFile = (p: string) => /(^|\/)__tests__\//.test(p) || /\.test\.[cm]?[jt]sx?$/.test(p);

/**
 * 🔴 GATED ON THE BASE REF, NOT ON THE DIFF. `if (this file is not in the diff)
 * return` re-arms the sweep for any LATER branch that edits this suite and
 * freezes that branch's whole tree to test files — THE-312 hit exactly that and
 * #450 records it. Once THE-322 is on `main` there is no PR left to police.
 *
 * 🔴 AND THE GATE IS PROVED BY BEHAVIOUR, NOT BY TEXT. THE-315's first draft
 * proved its gate by grepping its own file for the gate's source, which passed
 * with the gate DELETED because the assertion's message contained the string it
 * grepped for. So the two stand-downs are DISTINGUISHABLE and the sweep can be
 * aimed at another path: pointed at a file already on the base ref it must
 * answer `landed`, and with the gate removed it answers `not-in-diff` instead.
 */
type SweepResult = { stoodDown: 'landed' | 'not-in-diff' } | { offenders: string[] };

function sourceFilesInDiff(self: string = SELF): SweepResult {
  if (landedOnBase(self)) return { stoodDown: 'landed' };
  const paths = changedPaths();
  if (!paths.includes(self)) return { stoodDown: 'not-in-diff' };
  return { offenders: paths.filter((p) => !isTestFile(p)) };
}

describe('6 · no source file appears in this diff', () => {
  it('every path in the diff is a test or fixture file', () => {
    const result = sourceFilesInDiff();
    if ('stoodDown' in result) return;
    expect(result.offenders, 'THE-322 changes only test and fixture files, but these are not:\n  '
      + result.offenders.join('\n  ')).toEqual([]);
  });

  it('🔴 and this sweep is itself gated on the base ref — it is not a fifth freeze', () => {
    const onBase = 'src/__tests__/THE-315.branch-diff-guards.test.ts';
    expect(landedOnBase(onBase), 'the fixture suite is not on the base ref').toBe(true);
    expect(sourceFilesInDiff(onBase),
      'section 6 lost its base-ref gate — an ungated whole-tree freeze on every source file in '
      + 'the repo is the defect THE-315 came to fix, and this would be the fifth')
      .toEqual({ stoodDown: 'landed' });
  });

  it('and the machinery still answers, so the sweep cannot be a silent no-op', () => {
    expect(Array.isArray(changedPaths()), 'changedPaths() no longer answers').toBe(true);
    expect(isTestFile('src/components/AdminSettings.tsx'),
      'isTestFile calls a source file a test — the sweep would pass over anything').toBe(false);
    expect(isTestFile(SELF), 'isTestFile no longer recognises a suite under __tests__').toBe(true);
    expect(isTestFile('src/__tests__/__fixtures__/ownership/THE-319.json'),
      'the ownership records are under __tests__ and are fixtures, not source').toBe(true);
  });

  it('every file THE-322 adds lives under __tests__', () => {
    const added = [
      'src/__tests__/__fixtures__/ownership-register.ts',
      'src/__tests__/__fixtures__/ownership/THE-319.json',
      'src/__tests__/__fixtures__/ownership/THE-320.json',
      SELF,
    ];
    expect(added.filter((p) => !isTestFile(p))).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 — every protected property is still asserted somewhere
 * ═══════════════════════════════════════════════════════════════════════════ */

const THE312 = 'src/components/__tests__/THE-312.settings-freeze-registers.test.tsx';
const THE311 = 'src/components/course/__tests__/THE-311.course-palette.test.ts';
const THE305 = 'src/components/__tests__/THE-305.install-reachable.test.tsx';
const THE315 = 'src/__tests__/THE-315.branch-diff-guards.test.ts';
const THE266 = 'src/__tests__/the-266-shadcn-batch-a.test.ts';
const THE272 = 'src/__tests__/the-272-shadcn-batch-b.test.ts';

const DELETE_FLOW_MESSAGES = [
  'You are not signed in. Sign in again and retry.',
  'Could not reach the server. Check your connection and try again.',
  'Your account and sign-in have been deleted. Signing you out now.',
  'For your security, confirm your password to finish deleting your account.',
  'Enter your password to continue.',
  'Incorrect password. Try again.',
] as const;

/**
 * ⚠️ Each row names the property and the assertion that OWNS it. A meta-check,
 * not a copy: re-asserting the eight delete-flow messages here would create a
 * second place for them to drift. What it catches is the assertion GOING.
 */
const PROTECTED: readonly (readonly [string, string, string])[] = [
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
  // 🔴 The shadcn adopter lists, which THE-315's own roster does not name.
  ['the recorded ui adopter map (batch A)', THE266, 'RECORDED_UI_ADOPTERS'],
  ["THE-276's chart adopter list", THE272, 'const THE_276_CHART_ADOPTERS = ['],
  ["THE-283's table adopter list", THE272, 'const THE_283_TABLE_ADOPTERS = ['],
  ["THE-290's table adopter list", THE272, 'const THE_290_TABLE_ADOPTERS = ['],
  ["THE-290's progress adopter list", THE272, 'const THE_290_PROGRESS_ADOPTERS = ['],
  ["THE-294's table adopter list", THE272, 'const THE_294_TABLE_ADOPTERS = ['],
  ["THE-317's table adopter list", THE272, 'const THE_317_TABLE_ADOPTERS = ['],
  ["THE-319's table adopter list", THE272, 'const THE_319_TABLE_ADOPTERS = ['],
  ["THE-319's progress adopter list", THE272, 'const THE_319_PROGRESS_ADOPTERS = ['],
  ["THE-320's progress adopter list", THE272, 'const THE_320_PROGRESS_ADOPTERS = ['],
  // 🔴 And the roster that owns most of the rows above is itself still there.
  ["THE-315's protected-property roster", THE315, "8 · every protected property is still asserted somewhere"],
  ['the ownership register validates ticket, reason and digest', SELF, 'validateOwnership'],
];

describe('7 · every protected property is still asserted somewhere', () => {
  it.each(PROTECTED.map((r) => [r[0], r] as const))('%s', (_name, [property, file, anchor]) => {
    expect(read(file), `${property}: the assertion that owns it is gone from ${file}`)
      .toContain(anchor);
  });

  it('and the list itself has not been quietly shortened', () => {
    expect(PROTECTED).toHaveLength(33);
    expect(DELETE_FLOW_MESSAGES).toHaveLength(6); // + 2 interpolated = the eight
    expect(new Set(PROTECTED.map((r) => r[0])).size, 'a duplicate row is padding the count')
      .toBe(PROTECTED.length);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 — no guard in this PR asserts anything about the current branch's diff
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 THE DIRECTION IS WHAT DECIDES, exactly as THE-315's header sets out. An
 * assertion that the diff is NON-EMPTY ("the diff contains X") is true on its
 * own branch and false for every branch after it merges — that is the shape
 * that has blocked four unrelated PRs here. An assertion that it is EMPTY is a
 * freeze: it gets MORE true when the ticket lands, never less.
 *
 * ⚠️ THE NEEDLES ARE ASSEMBLED, not written out. This sweep runs over its own
 * file, and a guard that fails because it SPELLS the thing it forbids is a
 * guard nobody can write — the same reason THE-319's section 15 assembles its
 * own. It is also why these must not appear literally: `NON_EMPTY` in THE-315's
 * detector is matched against source with strings INTACT.
 */
/** The files THE-322 adds or changes that ask git anything at all. */
const GIT_TOUCHING = [SELF];

/**
 * A read of the branch's changed paths.
 *
 * ⚠️ ASSEMBLED, so this declaration does not match its own markers and seed
 * itself. THE-315's detector matches against source with STRINGS INTACT, and so
 * does this one — a literal here would make every identifier downstream of it
 * "diff-bound" and the sweep would flag its own furniture.
 */
const DIFF_MARKERS = ['--name' + '-only', 'ls-' + 'files', "'di" + "ff'", '--oth' + 'ers'];

/**
 * The NON-EMPTY matchers. Assembled for the same reason, and because this sweep
 * runs over its own file: a guard that fails merely because it SPELLS the thing
 * it forbids is a guard nobody can write.
 */
const NON_EMPTY_MATCHERS = [
  '.to' + 'Contain(', '.to' + 'Match(', '.toBe' + 'GreaterThan(',
  '.not.to' + 'Equal([])', '.not.to' + 'HaveLength(0)',
];

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));

/** The whole declaration statement at `i`, read by balancing delimiters. */
function statementAt(lines: string[], i: number): string {
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
 * Every assertion in `src` that reads the branch's changed paths and asserts
 * them NON-EMPTY.
 *
 * 🔴 BOUND BY DATAFLOW, NOT BY A HAND-WRITTEN LIST. The first draft of this
 * check named the three identifiers it expected to see and passed a planted
 * `const paths = changedPaths(); expect(paths).toContain(SELF)` — one hop it
 * had not thought of. A list of names is not a detector. Bindings are taken
 * from the declarations, to a fixpoint, exactly as THE-311's `touched` and
 * THE-312's `paths` are actually written.
 */
export function nonEmptyDiffAssertions(src: string): string[] {
  const code = stripComments(src);
  const lines = code.split('\n');
  const decls = lines.map((line, i) => {
    const m = line.match(/(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/);
    return m ? { name: m[1], text: statementAt(lines, i) } : null;
  });
  const bound = new Set<string>();
  for (const d of decls) if (d && DIFF_MARKERS.some((k) => d.text.includes(k))) bound.add(d.name);
  // To a fixpoint: a binding one hop from the read is the shape every real
  // occurrence in this repo has used, and two hops is what caught the plant.
  for (let pass = 0; pass < 4; pass += 1) {
    for (const d of decls) {
      if (!d || bound.has(d.name)) continue;
      if ([...bound].some((id) => refers(id, d.text))) bound.add(d.name);
    }
  }
  const found: string[] = [];
  lines.forEach((line, i) => {
    if (!NON_EMPTY_MATCHERS.some((m) => line.includes(m))) return;
    let start = i;
    while (start > 0 && !/expect\s*\(/.test(lines[start])) start -= 1;
    const statement = lines.slice(start, i + 1).join('\n');
    if (!/expect\s*\(/.test(statement)) return;
    const via = [...bound].find((id) => refers(id, statement));
    if (via) found.push(`${i + 1} (via \`${via}\`)  ${src.split('\n')[i].trim()}`);
  });
  return found;
}

describe('8 · no guard in this PR asserts anything about the current branch\'s diff', () => {
  it.each(GIT_TOUCHING)('%s asserts the EMPTY direction only', (file) => {
    const offenders = nonEmptyDiffAssertions(read(file)).map((f) => `${file}:${f}`);
    expect(offenders, 'a branch-diff assertion in the NON-EMPTY direction. It stops being true the '
      + 'moment this ticket merges, and then every unrelated PR goes red for a reason that has '
      + 'nothing to do with it. Gate it on the BASE REF, never on the diff:\n  '
      + offenders.join('\n  ')).toEqual([]);
  });

  it('🔴 the detector catches the shape it is looking for, including one hop', () => {
    /**
     * 🔴 THE-315's lesson, applied. Its first gate-proof passed with the gate
     * deleted because the assertion's own message contained the string it
     * grepped for — so this one is proved on PLANTED samples, by behaviour.
     *
     * ⚠️ AND THE HOP IS THE CASE THAT MATTERS. This check's own first draft
     * named its diff-bound identifiers by hand and passed exactly the sample
     * below, because `paths` was not on the list. It is caught now because the
     * binding is read from `const paths = changedPaths();`, not from a list.
     */
    /* ⚠️ THE SAMPLE IDENTIFIERS ARE DELIBERATELY NAMES THIS FILE DOES NOT USE.
       The detector reads source with STRINGS INTACT — as THE-315's does — so a
       sample that spelled `changedPaths` would bind the sample's own variable
       to this file's real read and the sweep would flag its own fixtures. */
    const seed = "function sweptPaths() { return g(['di" + "ff', '--name" + "-only']); }";
    const direct = [seed, 'expect(sweptPaths())', '.to' + 'Contain(SELF);'].join('\n');
    const oneHop = [seed, 'const swept = sweptPaths();', 'expect(swept)', '.to' + 'Contain(SELF);'].join('\n');
    const twoHops = [seed, 'const swept = sweptPaths();', 'const hits = swept.filter(Boolean);',
      'expect(hits)', '.not.to' + 'HaveLength(0);'].join('\n');
    const freeze = [seed, 'const swept = sweptPaths();', 'expect(swept)', '.to' + 'Equal([]);'].join('\n');
    const unrelated = ['const suiteNames = listSuites();', 'expect(suiteNames)', '.to' + 'Contain(SELF);'].join('\n');

    expect(nonEmptyDiffAssertions(direct), 'a direct NON-EMPTY assertion on the diff is missed')
      .not.toEqual([]);
    expect(nonEmptyDiffAssertions(oneHop), 'ONE HOP from the read is missed — this is the exact '
      + 'shape THE-311 and THE-312 both had, and the shape this check first passed').not.toEqual([]);
    expect(nonEmptyDiffAssertions(twoHops), 'two hops from the read is missed').not.toEqual([]);
    expect(nonEmptyDiffAssertions(freeze), 'a freeze was flagged, and a freeze is not the defect')
      .toEqual([]);
    expect(nonEmptyDiffAssertions(unrelated), 'an assertion that never reads the diff was flagged')
      .toEqual([]);
  });

  it('the ownership register asks git nothing at all', () => {
    /* ⚠️ Assembled, for the reason above. The register is read at assertion
       time by every guard that uses it; a depth-1 clone has no object database
       and a fixture that needs one fails for reasons that are not about code. */
    const banned = [
      'exec' + 'Sync(', 'spawn' + 'Sync(', 'node:child' + '_process',
      'gi' + 't diff', 'gi' + 't show', 'gi' + 't log', 'gi' + 't rev-parse',
    ];
    for (const file of ['src/__tests__/__fixtures__/ownership-register.ts']) {
      for (const needle of banned) {
        expect(read(file), `${file} reaches for \`${needle}\``).not.toContain(needle);
      }
    }
  });

  it("and THE-315's standing sweep is still in the tree to catch a fifth", () => {
    expect(read(THE315)).toBeTruthy();
  });
});
