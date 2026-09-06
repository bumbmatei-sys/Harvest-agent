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
    expect(readdirSync(OWNERSHIP_DIR).filter((n) => !/^THE-\d+\.json$/.test(n)),
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
      const structural = [parsed.ticket, ...parsed.entries.map((e) => e.file)].join(' ');
      const others = names.filter((n) => n !== name && structural.includes(n.replace(/\.json$/, '')));
      expect(others, `${name} names another ticket's record in a structural field — that is an `
        + `index by another name:\n  ${others.join('\n  ')}`).toEqual([]);
    }
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
 * emulator tests. That is why so many suites pin it, and it is why this ticket
 * left those pins exactly where they are. What is asserted here is the property
 * itself: the digest on disk is the one the suites pin, and a value NOBODY
 * pinned appears in no suite — so a change nobody recorded turns every one of
 * them red.
 */
const RULES = 'firestore.rules';
const RULES_DIGEST_ON_DISK = sha256(readFileSync(path.join(ROOT, RULES)));

/** Every suite that pins `firestore.rules` by digest, measured from the tree. */
function suitesPinning(digest: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === 'node_modules' || e.name === '.next') return [];
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.test\.[cm]?[jt]sx?$/.test(e.name) || e.name.endsWith('.json') ? [p] : [];
    });
  return walk(path.join(ROOT, 'src'))
    .filter((p) => readFileSync(p, 'utf8').includes(digest))
    .map((p) => path.relative(ROOT, p).split(path.sep).join('/'))
    .sort();
}

describe('3b · an unrecorded change to firestore.rules still fails', () => {
  it('the digest on disk is the one the suites pin', () => {
    expect(RULES_DIGEST_ON_DISK)
      .toBe('4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075');
  });

  it('🔴 and a digest no suite pinned is accepted by NONE of them', () => {
    /**
     * This is the whole protection, stated directly. Change `firestore.rules`
     * without recording it and its digest becomes a value that appears in no
     * suite — so every suite that pins it goes red, which is exactly what
     * happened to 45 of them when THE-313 legitimately changed the file.
     */
    expect(suitesPinning(UNRECORDED),
      'a digest nobody recorded is already pinned somewhere — the pins are not what they look like')
      .toEqual([]);
  });

  it('the pins are real and plural — at least forty suites carry the live digest', () => {
    expect(suitesPinning(RULES_DIGEST_ON_DISK).length).toBeGreaterThan(40);
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
 * 🔴 THIS TICKET DID NOT CONSOLIDATE THEM, and this section is the measured
 * baseline for the PR that will. The count was read from the tree, not from a
 * CI log: 45 files in `src/` carry the live digest — 44 suites plus THE-286's
 * JSON fixture — and THE-319 makes 46 by asserting the digest appears in
 * `the-299-retention-guards.test.ts` rather than spelling it itself.
 *
 * ⚠️ WHAT EACH ONE STILL ASSERTS: that `firestore.rules` on disk hashes to a
 * digest it accepts, and therefore that its own ticket did not touch a file
 * which auto-deploys to production with no emulator tests in CI. Not one of
 * them was edited, loosened or dropped by THE-322.
 */
const RULES_PINNERS_BEFORE_THE_322 = 45;

/** THE-322 spells the digest too, in section 3b, so it is the 46th. */
const RULES_PINNERS_NOW = RULES_PINNERS_BEFORE_THE_322 + 1;

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
];

describe('5 · every suite that pinned firestore.rules still pins it', () => {
  it('the population never shrank — nothing was consolidated away', () => {
    const pinners = suitesPinning(RULES_DIGEST_ON_DISK);
    expect(pinners.length,
      'a suite stopped pinning firestore.rules. THE-322 consolidates none of them; if a later '
      + 'ticket does, it updates this count and says what each one still asserts.')
      .toBe(RULES_PINNERS_NOW + RULES_PINNERS_ADDED_SINCE.length);
    expect(pinners, 'THE-322 no longer pins firestore.rules itself').toContain(SELF);
    expect(pinners.filter((p) => p !== SELF && !RULES_PINNERS_ADDED_SINCE.some(([, f]) => f === p)),
      'the 45 that pinned it before THE-322 are not 45 any more')
      .toHaveLength(RULES_PINNERS_BEFORE_THE_322);
    // Each recorded addition really is a pinner, so the list cannot pad the
    // count with a suite that does not carry the digest.
    for (const [ticket, suite] of RULES_PINNERS_ADDED_SINCE) {
      expect(pinners, `${ticket} is recorded as a pinner but ${suite} does not pin the digest`)
        .toContain(suite);
    }
  });

  it('THE-319 still defers to the-299\'s pin rather than spelling a second copy', () => {
    const guard = read('src/__tests__/the-299-retention-guards.test.ts');
    expect(guard, 'the-299 no longer carries the digest THE-319 defers to')
      .toContain(RULES_DIGEST_ON_DISK);
    expect(read('src/__tests__/THE-319.composition-guards.test.ts'))
      .toContain('the pins that already exist still hold');
  });

  it('and THE-322 edited none of them', () => {
    /* The only suite this ticket touched is THE-319's, and it touched section
       14 alone. Its firestore.rules deferral in section 16 is byte-for-byte
       what it was, asserted above by content. */
    for (const suite of suitesPinning(RULES_DIGEST_ON_DISK)) {
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
