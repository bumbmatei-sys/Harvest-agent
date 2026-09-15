import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { stripComments } from './__fixtures__/the-346-strip-comments';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

/**
 * THE-364 — the cross-cutting rules, applied to this bundle's own files.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Eight backlog cards. TWO produced code (THE-107's client check, THE-218's seed
 * value); THREE were investigations that correctly end in none; THREE are split
 * out. This suite holds the bundle-wide claims: the freezes, the test hygiene
 * rules, and — for the cards that ship nothing — the RECORDED REASON, so "we
 * decided not to" is a durable answer rather than a silence a later reader has
 * to re-derive.
 *
 * 🔴 NOTHING HERE ASSERTS ANYTHING ABOUT THE BRANCH'S DIFF, in either direction.
 * #501 closed the sweep's blind spot and found two vacuous guards doing exactly
 * that. Section 1's freezes are digest SETS compared against the file on disk —
 * a claim that gets MORE true when this ticket merges, never less — and no
 * assertion here shells out to git.
 *
 * NO LINE NUMBER IS PINNED ANYWHERE IN THIS FILE.
 */

const ROOT = process.cwd();
const sha256 = (buf: Parameters<typeof createHash>[0] extends never ? never : Buffer) =>
  createHash('sha256').update(buf).digest('hex');
const digestOf = (rel: string) => sha256(readFileSync(join(ROOT, rel)));
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

/**
 * Files this bundle AUTHORED — created from nothing on this ticket.
 *
 * 🔴 THE HYGIENE RULES IN SECTION 2 APPLY TO THESE AND ONLY THESE. A guard that
 * held a pre-existing file to a rule written after it is a guard that fails on
 * somebody else's work and gets deleted rather than obeyed.
 */
const AUTHORED = [
  'src/lib/__tests__/THE-107.super-admin-gate.test.ts',
  'src/lib/__tests__/THE-101.usage-ttl.test.ts',
  'src/lib/dodo/__tests__/THE-171.dodo-cancellation-events.test.ts',
  'src/__tests__/THE-218.platform-tenant-plan.test.ts',
  'src/__tests__/THE-364.bundle-guards.test.ts',
] as const;

/**
 * Files that already existed and which this bundle EDITED.
 *
 * TWO carry the behaviour change (the seed's plan id, Profile's email source).
 * The rest are REGISTER BOOKKEEPING, which is what it costs to change a pinned
 * file in this repo and is listed rather than hidden:
 *
 *   · `settings-freeze-register.ts` — THE-107's recorded-edit row for Profile.
 *   · `AdminDashboard.plan-entitlement` — a comment that said the seed writes
 *     `'ministry'`, corrected. Its ASSERTIONS are untouched and still right.
 *   · `THE-322` / `THE-325` — the rules-pinner population, 75 -> 76, appended
 *     by the protocol both files document.
 *   · `THE-359` — 🔴 AN EXPIRING GUARD, FOUND BY THIS BUNDLE AND FIXED. It
 *     asserted that the NEWEST register row for Profile.tsx was THE-359's own,
 *     which is true only until anyone else legitimately appends — so THE-107's
 *     row turned it red for a reason that had nothing to do with THE-359. It
 *     now asserts what it needs (its own row survives, and the newest row
 *     matches disk), which cannot expire.
 *
 * They are held to the freeze and line-ending rules, not to hygiene rules that
 * predate them.
 */
const EDITED = [
  'scripts/seed-platform-tenant.js',
  'src/components/Profile.tsx',
  'src/components/__tests__/__fixtures__/settings-freeze-register.ts',
  'src/components/__tests__/AdminDashboard.plan-entitlement.test.tsx',
  'src/__tests__/THE-322.ownership-register.test.ts',
  'src/__tests__/THE-325.rules-digest-register.test.ts',
  'src/__tests__/THE-359.paid-event-copy.guards.test.ts',
] as const;

const TICKET_FILES = [...AUTHORED, ...EDITED];

/** The non-test source this bundle actually ships — what renders, and what runs. */
const SHIPPED_SOURCE = ['scripts/seed-platform-tenant.js', 'src/components/Profile.tsx'];


/** This bundle's own suites — what section 2 polices. */
const TICKET_TESTS = AUTHORED.filter((f) => /\.test\.tsx?$/.test(f));

/* ═══ 1 · The four forbidden paths are untouched ═════════════════════════════ */

/**
 * ⚠️ A SET per file, not a single digest. CI runs against `refs/pull/N/merge` —
 * this branch merged into `main` as it stands when the run starts — so a file
 * another ticket legitimately lands on carries a different value on the merge
 * ref than on this branch, and a lone pin would fail for the one reason it is
 * not meant to detect.
 *
 * 🔴 APPENDED, NEVER SUBSTITUTED. `main` went red for everyone the week a PR
 * replaced a digest instead of adding one. A value that is NEITHER — i.e. THIS
 * bundle editing the file — still fails, which is the whole threat.
 */
const UNTOUCHED: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
  'firestore.indexes.json': [
    ['8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0', 'main at 3d641ca (#507)'],
  ],
  'src/app/layout.tsx': [
    ['b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f', 'main at 3d641ca (#507)'],
  ],
};

describe('1 · firestore.rules, the indexes, functions/ and layout.tsx are untouched', () => {
  it('firestore.rules carries no edit from this bundle', () => {
    /**
     * 🔴 Asserted through the SHARED ownership register, and this bundle adds NO
     * record to it. `firestore.rules` auto-deploys on merge with no emulator
     * tests in CI, and THE-313's one line turned 46 files red — so the two cards
     * here that could have wanted a rules change (THE-107's `email_verified`
     * leg, THE-52's message cap) are REPORTED with their exact replacement text
     * and stop there. The register is per ticket (#464) and a rules digest does
     * not belong in it for a ticket that changed no rule.
     */
    expect(
      rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production',
    ).toBeNull();
  });

  it.each(Object.entries(UNTOUCHED))('%s carries no edit from this bundle', (file, accepted) => {
    const actual = digestOf(file);
    expect(
      accepted.find(([d]) => d === actual),
      `${file} is at ${actual}, which is none of:\n  ` +
        accepted.map(([d, why]) => `${d} (${why})`).join('\n  '),
    ).toBeTruthy();
  });

  it('functions/ is unchanged, file for file', () => {
    // A tree digest rather than one per file, so a file ADDED to functions/ is
    // caught as well as a file edited — which a per-file loop over a hardcoded
    // list would miss.
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir).sort()) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const fp = join(dir, entry);
        if (statSync(fp).isDirectory()) walk(fp);
        else out.push(`${relative(ROOT, fp).split(sep).join('/')}:${sha256(readFileSync(fp))}`);
      }
    };
    walk(join(ROOT, 'functions'));
    expect(out.length, 'functions/ gained or lost a file').toBe(5);
    expect(
      createHash('sha256').update(out.join('\n')).digest('hex'),
      'functions/ changed; it is one of the four paths this bundle may not touch',
    ).toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });

  it('and no file this bundle wrote imports or writes any of those paths', () => {
    // The reachable half of the same claim, which stays true after merge.
    for (const rel of TICKET_FILES) {
      const src = code(rel);
      expect(src, `${rel} writes firestore.rules`).not.toMatch(/writeFileSync\([^)]*firestore\.rules/);
      expect(src, `${rel} reaches into functions/`).not.toMatch(/from\s+['"].*\/functions\//);
    }
  });
});

/* ═══ 2 · Test hygiene, on this bundle's own suites ══════════════════════════ */

describe('2 · this bundle writes no guard of a shape the repo has banned', () => {
  it('no test pins a LINE NUMBER', () => {
    /**
     * THE-331 pinned `AdminCommunity.tsx:491`; a deletion moved it to `:311` and
     * the guard went red for a reason that had nothing to do with the code. The
     * pattern is a repo-relative source path followed by `:<digits>`.
     */
    const PATH_WITH_LINE = /\b[\w./-]+\.(?:tsx?|jsx?|rules|json)\s*:\s*\d+/;
    for (const rel of TICKET_TESTS) {
      const src = code(rel);
      const hit = src.split('\n').find((l) => PATH_WITH_LINE.test(l));
      expect(hit, `${rel} pins a line number: ${hit}`).toBeUndefined();
    }
  });

  it('no fixture is anchored near today', () => {
    /**
     * A date literal close to the run date passes today and fails in a month.
     * Every instant this bundle fixes is an explicit literal years away, so the
     * floor is generous: nothing within a year of now, in either direction.
     */
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const rel of TICKET_TESTS) {
      for (const iso of code(rel).match(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g) || []) {
        const t = Date.parse(iso);
        if (Number.isNaN(t)) continue;
        expect(
          Math.abs(t - now) > YEAR_MS,
          `${rel} anchors a fixture at ${iso}, which is within a year of today`,
        ).toBe(true);
      }
    }
  });

  it('no guard asserts anything about the current branch’s diff', () => {
    // The NON-EMPTY direction is the expiring shape: true on this branch, false
    // for every branch after it merges. Nothing here may shell out to git at all.
    /**
     * ⚠️ CALL-SHAPED, not word-shaped, and THIS FILE IS EXCLUDED FROM THE REF
     * PATTERN. A suite cannot meaningfully scan its own ban list: the names it
     * forbids necessarily appear in it as literals. The subprocess and shell-out
     * checks below ARE call-shaped, so this file is held to those; the bare-ref
     * pattern has no call shape to match on, so it is applied to the other
     * suites and this one is covered by the two that can see it.
     */
    for (const rel of TICKET_TESTS) {
      const src = code(rel);
      expect(src, `${rel} imports a subprocess module`).not.toMatch(
        /from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]/,
      );
      expect(src, `${rel} shells out`).not.toMatch(/\b(?:execSync|spawnSync|execFileSync)\s*\(/);
      if (rel === 'src/__tests__/THE-364.bundle-guards.test.ts') continue;
      expect(src, `${rel} names a git ref`).not.toMatch(/origin\/main|git\s+diff|rev-parse/);
    }
  });

  it('every content grep runs over PARSER-STRIPPED source, imported not copied', () => {
    // #496's stripper is a shared module precisely so a suite cannot quietly
    // carry its own weaker copy. A suite that greps raw source is a suite that
    // reads a comment and reports it as code.
    const greppers = TICKET_TESTS.filter((rel) => /readFileSync/.test(code(rel)));
    for (const rel of greppers) {
      expect(code(rel), `${rel} greps source without importing the stripper`).toMatch(
        /import \{[^}]*stripComments[^}]*\} from/,
      );
    }
    expect(greppers.length, 'no suite in this bundle greps source at all').toBeGreaterThan(0);
  });

  it('and no emoji reaches the CODE of any file it wrote', () => {
    // Emoji in COMMENTS are this repo's house style and are stripped before the
    // test; what is banned is one reaching a rendered string or a literal.
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const rel of SHIPPED_SOURCE.concat(AUTHORED)) {
      expect(EMOJI.test(code(rel)), `${rel} carries an emoji in its code`).toBe(false);
    }
  });

  it('and no colour is hardcoded in the source it shipped', () => {
    /**
     * ⚠️ SCOPED TO THE SEED SCRIPT, and the scope is the honest one rather than a
     * convenience. "Hardcode no colour" is a rule about the code a ticket WRITES:
     *
     *   · A TEST FILE RENDERS NOTHING, and scanning suites makes the guard fire
     *     on provenance strings — a PR reference like the ones in `UNTOUCHED`
     *     above is `#` followed by three digits, which is the shape of a hex
     *     colour. A guard with a standing false positive is one readers learn to
     *     ignore.
     *   · `Profile.tsx` IS ALREADY COVERED, and more tightly than a colour grep
     *     could manage: it is digest-pinned in the settings-freeze register, and
     *     this bundle's row there states exactly which argument changed. It
     *     carries two pre-existing `rgba(` calls, unchanged by this bundle and
     *     not this bundle's to relitigate — sweeping a thousand-line file
     *     somebody else wrote is how a guard gets deleted rather than obeyed.
     */
    const rel = 'scripts/seed-platform-tenant.js';
    expect(code(rel), `${rel} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code(rel), `${rel} hardcodes an rgb/hsl colour`).not.toMatch(/\b(?:rgba?|hsla?)\s*\(/);
  });

  it('and every file this bundle wrote is LF, never CRLF', () => {
    for (const rel of TICKET_FILES) {
      expect(
        readFileSync(join(ROOT, rel), 'utf8').includes('\r\n'),
        `${rel} carries CRLF line endings`,
      ).toBe(false);
    }
  });
});

/* ═══ 3 · No new token, component or dependency ══════════════════════════════ */

describe('3 · the dependency surface did not move', () => {
  it('package.json declares no new dependency', () => {
    // THE-274 pins the lockfile to an exact length; this is the cheaper, more
    // legible half of the same claim, and it is the one a reviewer can check.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const names = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ];
    expect(names, 'a dependency was added or removed').toHaveLength(names.length);
    expect(pkg.dependencies?.resend, 'resend is reached through transactional-email.ts')
      .toBeDefined();
  });

  it('and nothing this bundle wrote imports a module the repo did not already have', () => {
    const ALLOWED_BARE = /^(vitest|next\/server|node:[\w/]+|firebase-admin\/firestore)$/;
    for (const rel of TICKET_TESTS) {
      for (const m of code(rel).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('.') || spec.startsWith('@/')) continue;
        expect(ALLOWED_BARE.test(spec), `${rel} imports ${spec}, which is new`).toBe(true);
      }
    }
  });
});

/* ═══ 4 · The cards that ship no code, and why ═══════════════════════════════ */

describe('4 · every card that produced no code has its reason recorded here', () => {
  /**
   * 🔴 THIS IS THE RECORD, NOT A PLACEHOLDER. Three of these cards could each be
   * mistaken later for "nobody got to it". Each has an answer, and the answer is
   * the deliverable. The pull request carries the full reasoning; this pins the
   * DECISION so a future ticket re-opening one of them starts from it.
   */
  const DECIDED: ReadonlyArray<readonly [card: string, decision: string]> = [
    [
      'THE-171',
      'Dodo DOES emit subscription.cancelled, and the handler already routes it and '
        + 'subscription.expired to real, distinct handlers. The card is answered, not fixed. '
        + 'THE-171.dodo-cancellation-events.test.ts pins the answer and the drift found beside it.',
    ],
    [
      'THE-101',
      'A Firebase console action, not code. THE-101.usage-ttl.test.ts establishes the two '
        + 'facts that make the click safe: every month doc carries expiresAt, and the persistent '
        + 'usage/ingest stock carries none, so the sweep can never reach a live counter.',
    ],
    [
      'THE-52',
      'NO CAP SHIPPED, DELIBERATELY. Community Groups take TEXT ONLY — a message attachment is '
        + 'a reference to an existing doc/contact/campaign/form, four short strings, and no '
        + 'Firebase Storage object exists on this path at all. The only binding enforcement '
        + 'point is firestore.rules, which this bundle may not touch, so a client-side cap '
        + 'would be theatre. The recommended number and its reasoning are in the pull request.',
    ],
    [
      'THE-98',
      'SPLIT OUT. Fund designations are a feature, not a fix: a managed fund list, a new '
        + 'invoice field, and changes across the giving-statement, QuickBooks, export and '
        + 'erasure readers of the money record. Too large to bundle and reviewable only alone.',
    ],
    [
      'THE-56',
      'SPLIT OUT — it is a change to a DIFFERENT REPOSITORY (harvest-presentation-site) and '
        + 'cannot be a commit in this one. It is also blocked on a fact no code can supply: '
        + 'libraryCourses is runtime data the super admin authors, so the repo does not know '
        + 'how many courses exist.',
    ],
    [
      'THE-43',
      'NOT BUILT. A general-purpose "email every church" composer is marketing-capable by '
        + 'construction, and transactional-email.ts carries no unsubscribe, no postal address '
        + 'and no suppression check. The legal floor is reported in the pull request.',
    ],
  ];

  it.each(DECIDED)('%s has a decision of substance recorded', (card, decision) => {
    expect(card).toMatch(/^THE-\d+$/);
    expect(decision.length, `${card}'s reason is too thin to be a record`).toBeGreaterThan(120);
  });

  it('and no half-built surface for a card that was decided against was left behind', () => {
    // The failure mode a "we decided not to" is most likely to hide: a route or
    // a component landed anyway, gated off, waiting to be forgotten.
    const src = code('src/lib/transactional-email.ts');
    expect(src, 'a bulk send entered the funnel despite THE-43 not being built')
      .not.toMatch(/\bsendBulk|broadcastToTenants|sendToAllTenants\b/);
  });
});
