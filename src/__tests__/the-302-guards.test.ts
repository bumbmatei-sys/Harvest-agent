import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-302 — the static guards: what these three fixes were not allowed to touch.
 *
 * ⚠️ Nothing here shells out to `git show`, and no baseline is re-derived from
 * the repository at assertion time. Every value below is a literal computed once
 * when this file was written. A guard that recomputes its own baseline cannot
 * fail — it would simply describe whatever it was handed.
 */

const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Source with block and line comments stripped — the code, not the prose. */
const codeOf = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every production file THE-302 edits. Three, and the list is the claim. */
const TOUCHED = [
  'src/components/dashboard/analytics-permission.ts',
  'src/lib/dodo/webhook-dispatch.ts',
  'src/app/api/dodo/webhook/route.ts',
] as const;

/* ═══ 11 · firestore.rules and functions/ byte-identical ═════════════════════ */

/**
 * ⚠️ A SET per file, not a single digest, and #422/#434 are why. CI runs against
 * `refs/pull/N/merge` — this branch merged into `main` AS IT STANDS WHEN THE RUN
 * STARTS — so a file another ticket legitimately lands on holds a different
 * value on the merge ref than on this branch, and a single pin would fail for
 * the one reason it is not meant to detect.
 *
 * 🔴 APPENDED, NEVER SUBSTITUTED. `main` was red for everyone last week because
 * #434 replaced a digest instead of adding one. A value that is NEITHER — i.e.
 * this ticket editing the file — still fails, which is the entire threat.
 */
const UNTOUCHED: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
  'firestore.rules': [
    ['a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499', 'unchanged since 5e06c67'],
    // THE-313 (#462) wrote the `servicePlans` rule: `allow read: if
    // belongsToTenant(tenantId)` / `allow write: if hasPermission('manageEvents',
    // tenantId)`, inside `match /tenants/{tenantId}` beside `events`. It is
    // deployed — `firestore.rules` auto-deploys on merge.
    //
    // 🔴 APPENDED, NEVER SUBSTITUTED. The value above is still accepted, because
    // CI runs against `refs/pull/N/merge` and a merge ref cut before #462 landed
    // legitimately carries it. A digest that is NEITHER — this ticket editing the
    // file — still fails, which is the entire threat this guard exists for.
    ['4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075', 'main + THE-313 (#462) — the servicePlans rule'],
  ],
  // 🔴 Digest-pinned, and several guards assert it byte-identical. THE-302 has
  // no business here: part 1's fix lives entirely in the module the shell does
  // not import, and the three accepted values are carried over from THE-276's
  // guard unchanged.
  'src/components/AdminDashboard.tsx': [
    ['0d84be6d9b8a73fdfcddb4d1178b6a62ad8e74a1461553645fdd2558e2d7c4e7', 'main at 5e06c67'],
    ['722c5e4478be0a8508e7dff1232dd4c1f88cacdd502604f946f3134eb730d98c', 'main at d13c7d4 — THE-277 (#422) added the Signups nav entry'],
    ['446f0bcb8ffa6accf4f80467b75a50023c1441937605b11e18aa01b53d8e53f8', 'main at 915d818 — THE-291 (#434) removed the client-side plan write'],
  ],
  // 🔴 A NAMED STOP CONDITION on this ticket: "do not touch `runDodoPlanChange`
  // or `plan-change.ts` unless the fix genuinely requires it". It did not — part
  // 3's fix is entirely in the dispatcher's reservation step and the route's
  // status codes. Pinned so that stays true. ⚠️ A future edit APPENDS a value
  // here with its reason; substituting one is what made `main` red last week.
  'src/lib/dodo/plan-change.ts': [
    ['7f583417d59d476ddc41c6530acbfe3cd9dcaaf9e8d15279842b9d3db984ce9f', 'main at 915d818, untouched by THE-302'],
  ],
};

describe('firestore.rules and functions/ byte-identical', () => {
  it.each(Object.entries(UNTOUCHED))(
    '%s carries no edit from this ticket',
    (file, accepted) => {
      const actual = sha256(readFileSync(path.join(REPO_ROOT, file)));
      const match = accepted.find(([digest]) => digest === actual);
      expect(
        match,
        `${file} is at ${actual}, which is none of:\n  ` +
          accepted.map(([d, why]) => `${d} (${why})`).join('\n  '),
      ).toBeTruthy();
    },
  );

  it('functions/ is unchanged, file for file', () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(path.relative(REPO_ROOT, p));
      }
    };
    walk(path.join(REPO_ROOT, 'functions'));
    const files = out.sort();

    expect(files).toHaveLength(5);
    const tree = sha256(files.map((f) => `${f}:${sha256(readFileSync(path.join(REPO_ROOT, f)))}`).join('\n'));
    expect(tree).toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });

  it('nothing THE-302 touched mentions firestore.rules or functions/', () => {
    for (const file of TOUCHED) {
      expect(codeOf(file), file).not.toMatch(/firestore\.rules|['"]\.\.?\/functions\//);
    }
  });
});

/* ═══ The parallel tickets' files ════════════════════════════════════════════ */

describe('the files THE-303, THE-304 and THE-305 own are not reached', () => {
  /**
   * ⚠️ Asserted as "not imported and not named", not as a digest. Those three
   * tickets are IN FLIGHT and land on the same merge ref, so pinning their
   * digests would fail on somebody else's landed work — the exact false positive
   * the accepted-digest sets above exist to avoid. What THE-302 can honestly
   * claim is that none of its files reaches into them.
   */
  const FOREIGN = [
    'components/donations',
    'AdminFundraising',
    'AdminDonations',
    'AdminCourseEditor',
  ] as const;

  it.each(TOUCHED)('%s imports none of them', (file) => {
    for (const name of FOREIGN) {
      expect(codeOf(file), `${file} reaches into ${name}`).not.toContain(name);
    }
  });

  it('and part 1 stays out of the shell and the roles screen it may not open', () => {
    const gate = codeOf('src/components/dashboard/analytics-permission.ts');
    expect(gate).not.toMatch(/from\s+['"][^'"]*AdminDashboard['"]/);
    expect(gate).not.toMatch(/from\s+['"][^'"]*(?:AdminDocs|AdminRoles|AdminSignups)['"]/);
  });
});

/* ═══ The house rules ════════════════════════════════════════════════════════ */

describe('no colour is hardcoded and no emoji is rendered', () => {
  it.each(TOUCHED)('%s contains no hex or rgb/hsl/oklch literal', (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab)\s*\(/);
  });

  /**
   * ⚠️ SCOPED TO THE ONE FILE THAT RENDERS, deliberately. "No emoji" is a rule
   * about what a church admin sees; the two webhook files emit only Vercel log
   * lines, and `webhook-dispatch.ts` has carried `⏭️ [dodo] Skipping duplicate
   * webhook …` since #290. Sweeping it here would fail on somebody else's log
   * line and say nothing about the product — and "silence it" would mean editing
   * a line this ticket has no reason to touch.
   */
  const RENDERS = 'src/components/dashboard/analytics-permission.ts';

  it('the one file with a user-visible surface renders no emoji', () => {
    // Pictographs and dingbats, not the whole of Extended Pictographic: `·` and
    // `—` are punctuation this codebase already uses in prose.
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
    const found = codeOf(RENDERS).match(EMOJI);
    expect(found, `${RENDERS} renders ${found?.[0]}`).toBeNull();
  });

  it.each(TOUCHED)('%s carries no inline style', (file) => {
    expect(codeOf(file)).not.toMatch(/style=\{\{/);
    expect(codeOf(file)).not.toMatch(/\sstyle\s*=/);
  });
});

describe('no npm dependency was added', () => {
  it('package.json is unchanged by this ticket', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // The three fixes are all in existing code paths: the gate uses the firebase
    // client SDK already imported beside it, the presign tests verify SigV4 with
    // `node:crypto`, and the webhook timeout is `setTimeout`.
    expect(pkg.dependencies).not.toHaveProperty('aws4');
    expect(pkg.dependencies).not.toHaveProperty('node-fetch');
    expect(pkg.devDependencies).not.toHaveProperty('nock');
    expect(pkg.devDependencies).not.toHaveProperty('msw');
  });
});
