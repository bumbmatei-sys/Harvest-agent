import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';
import { ownershipFailure } from '../../__tests__/__fixtures__/ownership-register';
import { TENANT_UNRESOLVED_MESSAGE, TENANT_UNRESOLVED_TITLE } from '../../utils/auth-tenant-resolution';
import { googleAuthFailureMessage, homeScreenGoogleMessage } from '../../utils/auth-failure-copy';

/**
 * THE-349 · the guards that are not a component question.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The behaviour is measured against the real screen in
 * `THE-349.google-signup-tenant.test.tsx` and against the real writer in
 * `THE-349.onboarding-orphan-refusal.test.ts`. What is left here is the set of
 * questions no rendered component can answer: what the CODE cannot contain
 * any more, what this ticket did not touch, and whether this PR's own guards
 * are the kind that guard.
 *
 * 🔴 EVERY CONTENT GREP BELOW RUNS OVER COMMENT-STRIPPED SOURCE, through
 * #490's parser-driven stripper. This ticket has a sharper reason to insist on
 * it than most: `AuthPage.tsx` and `Onboarding.tsx` are the two most heavily
 * commented files in the repo, `tenantId` appears constantly in their prose,
 * and the exact string this file must prove ABSENT — `tenantId || null` — is
 * QUOTED in three of the docblocks that explain why it was removed. A raw-text
 * grep would find those quotations and report the bug as still present, or
 * (worse, and the shape THE-292 actually hit) find them and report a guard as
 * satisfied. Card 86bbxkawp records an inherited `code()` stripper that eats
 * ~150 lines; `the-346-strip-comments.ts` takes its ranges off a real
 * TypeScript parse, which is the only thing that knows it is inside JSX.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
/** 🔴 The only spelling of "the source" used for a content claim in this file. */
const code = (rel: string) => stripComments(read(rel));
const sha = (rel: string) => createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

const AUTH_PAGE = 'src/components/AuthPage.tsx';
const ONBOARDING = 'src/components/Onboarding.tsx';
const RESOLVER = 'src/utils/auth-tenant-resolution.ts';
const COPY = 'src/utils/auth-failure-copy.ts';

const THE_349_SUITES = [
  'src/utils/__tests__/THE-349.auth-tenant-resolution.test.ts',
  'src/components/__tests__/THE-349.google-signup-tenant.test.tsx',
  'src/components/__tests__/THE-349.onboarding-orphan-refusal.test.ts',
  'src/components/__tests__/THE-349.orphan-signup.guards.test.ts',
];

/* ═════════════════════════════════════════════════════════════════════════════
 * 1 · 🔴 The hypothesis this ticket arrived with, tested rather than assumed
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · 🔴 there is no auth REDIRECT, so there is no hop to lose the tenant on', () => {
  /**
   * The brief's hypothesis was that Google sign-in on iOS Safari falls back to
   * `signInWithRedirect`, that Firebase sends the browser to its auth domain
   * and back, and that `window.location.hostname` is therefore not the tenant
   * subdomain when the document is written.
   *
   * 🔴 NO PART OF THAT IS IN THIS CODEBASE. The whole product uses
   * `signInWithPopup`, which navigates a SEPARATE window and never touches the
   * opener's location; `signInWithRedirect` and `getRedirectResult` are not
   * imported, called or mentioned anywhere in `src/`. The assertion is here
   * rather than in prose so that the day somebody adds the redirect flow, this
   * file goes red and the reasoning below has to be rewritten with it.
   */
  const srcFiles = (): string[] => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        return /\.[cm]?[jt]sx?$/.test(e.name) ? [p] : [];
      });
    return walk(path.join(ROOT, 'src')).map((p) => path.relative(ROOT, p));
  };

  it('signInWithRedirect and getRedirectResult appear nowhere in src/', () => {
    const files = srcFiles().filter((f) => !f.includes('__tests__') && !/\.test\./.test(f));
    expect(files.length, 'the walk found no source files — this assertion would be vacuous')
      .toBeGreaterThan(200);
    for (const f of files) {
      const body = code(f);
      expect(body, `${f} uses signInWithRedirect — the hypothesis in the brief is now live`)
        .not.toMatch(/\bsignInWithRedirect\b/);
      expect(body, `${f} reads a redirect result — the hypothesis in the brief is now live`)
        .not.toMatch(/\bgetRedirectResult\b/);
    }
  });

  it('the auth screen uses the POP-UP, which cannot move the opener’s hostname', () => {
    const body = code(AUTH_PAGE);
    expect(body).toMatch(/signInWithPopup\(auth, provider\)/);
  });

  it('🔴 and the middleware that was supposed to set the tenant cookie sets NO cookie', () => {
    // This is the evidence behind the diagnosis, not decoration. `AuthPage`'s
    // custom-domain fallback has always read a `tenantId=` cookie described as
    // "set server-side by middleware via resolve-domain"; the middleware only
    // rate-limits `/api/*`. So on a live custom domain the fallback resolved to
    // null and the signup was orphaned — the reproducible instance of this bug.
    const mw = code('src/middleware.ts');
    expect(mw, 'middleware started setting cookies — the diagnosis in this ticket is now stale')
      .not.toMatch(/cookies|Set-Cookie|resolve-domain/i);
    expect(mw).toMatch(/matcher: '\/api\/:path\*'/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 2 · Test 13 — nothing that cannot be determined is written as null
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · 🔴 no `tenantId: … || null` survives on a create path', () => {
  it.each([AUTH_PAGE, ONBOARDING])('%s never coerces an unknown tenant to null', (rel) => {
    const body = code(rel);
    expect(body, `${rel} still writes \`tenantId: <x> || null\` — this IS the bug`)
      .not.toMatch(/tenantId:\s*[A-Za-z_$][\w$.]*\s*\|\|\s*null/);
    expect(body, `${rel} still writes \`tenantId: <x> ?? null\``)
      .not.toMatch(/tenantId:\s*[A-Za-z_$][\w$.]*\s*\?\?\s*null/);
  });

  it('and every create goes through the helper that THROWS on an unknown tenant', () => {
    for (const rel of [AUTH_PAGE, ONBOARDING]) {
      expect(code(rel), `${rel} stopped routing its create through tenantIdToWrite`)
        .toMatch(/tenantId:\s*tenantIdToWrite\(/);
    }
    // 🔴 And the helper really does throw — a version that returned null would
    // satisfy the greps above and restore the defect underneath them.
    const resolver = code(RESOLVER);
    expect(resolver).toMatch(/export function tenantIdToWrite/);
    expect(resolver.slice(resolver.indexOf('export function tenantIdToWrite')))
      .toMatch(/throw new Error/);
  });

  it('🔴 the grep is run over stripped source, and the raw file would have fooled it', () => {
    // The proof that the stripper is load-bearing here rather than ceremony:
    // the forbidden string is still QUOTED in the docblocks that explain its
    // removal, so a raw-text grep reports the bug as present on a fixed file.
    expect(read(ONBOARDING), 'the docblock stopped quoting what it replaced')
      .toMatch(/tenantId:\s*tenantId\s*\|\|\s*null/);
    expect(code(ONBOARDING), 'the stripper let a comment through into the code view')
      .not.toMatch(/tenantId:\s*tenantId\s*\|\|\s*null/);
  });

  it('the auth screen refuses on the unresolved branch instead of falling through', () => {
    const body = code(AUTH_PAGE);
    // Refused on both create paths and pre-empted on the signup views.
    expect((body.match(/tenantUnresolved/g) ?? []).length,
      'the unresolved branch is no longer consulted at every create site').toBeGreaterThanOrEqual(4);
    expect(body).toMatch(/setError\(TENANT_UNRESOLVED_MESSAGE\)/);
  });

  it('and the refusal is never swallowed by a bare catch', () => {
    const onboarding = code(ONBOARDING);
    const at = onboarding.indexOf('export async function writeUserDoc');
    expect(at, 'writeUserDoc moved').toBeGreaterThan(-1);
    const body = onboarding.slice(at, onboarding.indexOf('\n}', at));
    expect(body, 'the create branch caught its own refusal').not.toMatch(/catch\s*[({]/);
    expect(body).toMatch(/throw Object\.assign\(new Error\(TENANT_UNRESOLVED_MESSAGE\)/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 3 · Test 14 — the element that has a primitive uses it
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · the new error state composes the installed `alert` primitive', () => {
  const PRIMITIVES = readdirSync(path.join(ROOT, 'src/components/ui'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => f.replace(/\.tsx$/, ''))
    .sort();

  it('43 primitives are on disk, and `accordion` is the one that is not', () => {
    expect(PRIMITIVES.length, `the primitive set changed: ${PRIMITIVES.join(', ')}`).toBe(43);
    expect(PRIMITIVES, 'accordion was installed — this ticket adds no dependency').not.toContain('accordion');
    expect(PRIMITIVES, 'the primitive this ticket composes is gone').toContain('alert');
  });

  it('🔴 the refusal is an Alert, not a fourth hand-rolled banner', () => {
    const body = code(AUTH_PAGE);
    expect(body).toMatch(/import \{ Alert, AlertDescription, AlertTitle \} from '@\/components\/ui\/alert'/);
    expect(body).toMatch(/<Alert variant="destructive"[\s\S]{0,400}<AlertTitle>\{TENANT_UNRESOLVED_TITLE\}<\/AlertTitle>/);
    expect(body).toMatch(/<AlertDescription>\{TENANT_UNRESOLVED_MESSAGE\}<\/AlertDescription>/);
  });

  it('and it introduces no new tappable control, so no 44px floor is at stake', () => {
    const body = code(AUTH_PAGE);
    const block = body.slice(body.indexOf('{tenantUnresolved && !isLogin && ('));
    const alertBlock = block.slice(0, block.indexOf('</Alert>'));
    expect(alertBlock.length, 'the refusal block is not where this expects it').toBeGreaterThan(40);
    expect(alertBlock, 'the refusal grew a control — it now needs a measured tap target')
      .not.toMatch(/<button|onClick=/);
  });

  it('no primitive was installed and no dependency added', () => {
    expect(sha('package.json'), 'package.json changed — a dependency was added or moved')
      .toBe('1b2c57071a210a6b07302d2ba6bd90686bf0be05c2fe12e0fb3b197b8ac97da2');
    expect(sha('package-lock.json'), 'the lockfile moved — THE-274 pins it to an exact length')
      .toBe('da626030b980aab1bcbe9ec608c563ca92ceda7970f416ea4f4ed6eeb86b8b84');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 4 · Test 15 — no colour hardcoded, no emoji
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · no colour hardcoded and no emoji entered the code', () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  const HEX = /#[0-9a-fA-F]{3,8}\b/g;

  it('the two new modules carry no hex and no emoji at all', () => {
    for (const rel of [RESOLVER, COPY]) {
      const body = code(rel);
      expect(body.match(HEX), `${rel} hardcodes a colour`).toBeNull();
      expect(EMOJI.test(body), `${rel} carries an emoji in its code`).toBe(false);
    }
  });

  it('🔴 and the two edited screens gained NOT ONE hex literal', () => {
    /**
     * The counts are recorded from `origin/main` as CONSTANTS. Re-deriving
     * them from the working tree would compare the file to itself and pass
     * whatever it found — one guard in this series did exactly that. An
     * equality rather than a ceiling, so a ticket that removes one has to say
     * so here too.
     */
    const AT_BASE: Record<string, number> = { [AUTH_PAGE]: 37, [ONBOARDING]: 30 };
    for (const [rel, n] of Object.entries(AT_BASE)) {
      expect((code(rel).match(HEX) ?? []).length,
        `${rel} no longer carries exactly the ${n} colour literals it had at base`).toBe(n);
    }
  });

  it('and no emoji reached the code of either screen', () => {
    for (const rel of [AUTH_PAGE, ONBOARDING]) {
      expect(EMOJI.test(code(rel)), `${rel} carries an emoji in its code`).toBe(false);
    }
  });

  it('nor the copy a member reads', () => {
    expect(EMOJI.test(TENANT_UNRESOLVED_MESSAGE)).toBe(false);
    expect(EMOJI.test(TENANT_UNRESOLVED_TITLE)).toBe(false);
    expect(EMOJI.test(homeScreenGoogleMessage('kingdom-living.theharvest.app'))).toBe(false);
    expect(EMOJI.test(googleAuthFailureMessage('auth/account-exists-with-different-credential'))).toBe(false);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 5 · Tests 16–18 — this PR's own guards are the kind that guard
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("5 · THE-349's own guards", () => {
  it('🔴 no test pins a LINE NUMBER', () => {
    // THE-331 pinned `AdminCommunity.tsx:491`; a deletion moved that surface to
    // `:311`, so the suite would have MEASURED WHATEVER LANDED THERE rather
    // than failing. Every line number in this ticket's brief has already moved:
    // `AuthPage.tsx:384` and `:578` are not where the writes are any more.
    for (const rel of THE_349_SUITES) {
      const pins = [...code(rel).matchAll(/\.tsx?:(\d+)/g)].map((m) => m[0]);
      expect(pins, `${rel} pins a line number: ${pins.join(' ')}`).toEqual([]);
    }
  });

  it('🔴 no fixture is pinned to a date near today', () => {
    // ⚠️ THIS TEST READS THE CLOCK, and that is not the thing it forbids: the
    // ban is on a FIXTURE derived from the clock, and comparing a fixture's age
    // against today is what makes the ban checkable. The clock-read scan is
    // therefore applied to the OTHER three suites, never to this one, or it
    // would fail on its own comparison.
    const NOW = Date.now();
    const A_YEAR = 365 * 24 * 3600 * 1000;
    for (const rel of THE_349_SUITES.filter((r) => !r.endsWith('orphan-signup.guards.test.ts'))) {
      const body = code(rel);
      expect(body, `${rel} builds a fixture from the current clock`).not.toMatch(/Date\.now\(\)/);
      expect(body, `${rel} builds a fixture from an argument-less new Date()`).not.toMatch(/new Date\(\)/);
      for (const m of body.matchAll(/\b1_?\d{3}_?\d{3}_?\d{3}_?\d{3}\b/g)) {
        const ms = Number(m[0].replace(/_/g, ''));
        expect(Math.abs(NOW - ms),
          `${rel} pins a fixture at ${new Date(ms).toISOString()}, within a year of today`)
          .toBeGreaterThan(A_YEAR);
      }
    }
  });

  it('🔴 no guard in this PR asserts anything about the current branch’s DIFF', () => {
    // #454. A guard that reads the branch diff asserts how the work ARRIVED
    // rather than what the code is, so it passes or fails on the shape of a
    // rebase. ⚠️ THE CHECK LOOKS FOR THE MECHANISM, NOT THE WORD: listing the
    // names as strings would make this file match ITSELF, which is the exact
    // class of defect it exists to rule out. Shelling out needs an IMPORT and
    // a CALL, and both are matched as syntax.
    for (const rel of THE_349_SUITES) {
      const body = code(rel);
      expect(body, `${rel} imports a process-spawning module`)
        .not.toMatch(/(?:from|require\()\s*['"]node:child_process['"]/);
      expect(body, `${rel} calls out to a subprocess`)
        .not.toMatch(/\b(?:execSync|execFileSync|spawnSync|spawn)\s*\(/);
    }
  });

  it('and the baseline constants in this file are constants, not re-derivations', () => {
    // The failure mode #490 found in one of its own guards: a value hashed at
    // assertion time and compared to itself passes no matter what the file
    // holds. Every pinned value in this file is a literal.
    const body = code('src/components/__tests__/THE-349.orphan-signup.guards.test.ts');
    expect(body).toMatch(/const AT_BASE: Record<string, number> = \{/);
    expect(body, 'a digest constant was replaced by a re-derivation')
      .not.toMatch(/toBe\(sha\(/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 6 · Test 19 — the files this ticket may not touch
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('6 · firestore.rules, firestore.indexes.json, functions/ and layout.tsx are byte-identical', () => {
  it('firestore.rules is at a digest a ticket recorded — it AUTO-DEPLOYS on merge', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production with no emulator tests')
      .toBeNull();
  });

  it('🔴 and THE-349 recorded NO firestore.rules digest of its own', () => {
    // The ticket's own instruction. This ticket did not change the rules, and
    // it FOUND that it must not: repairing an orphan needs a `tenantId` write
    // that the update rule refuses to a member AND to a tenant admin, so the
    // repair belongs in the console or a server route, not in a rules edit
    // shipped behind a client fix.
    const own = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-349.json')) as {
      entries: { file: string }[];
    };
    expect(own.entries.map((e) => e.file), "THE-349's register names firestore.rules")
      .not.toContain('firestore.rules');
  });

  it('🔴 the rule that makes a self-repair impossible is still the rule', () => {
    // Reported rather than changed. `users` update refuses a self-edit whose
    // affected keys include `tenantId`, and the tenant-admin branch lists
    // `tenantId` as immutable too — so the stuck member cannot fix themselves
    // and neither can their church's admin. Only `isSuperAdmin()` or the Admin
    // SDK can. If this ever changes, this assertion goes red and the repair
    // instructions in this PR's description become stale.
    const rules = read('firestore.rules');
    const at = rules.indexOf('match /users/{userId}');
    expect(at, 'the users block moved').toBeGreaterThan(-1);
    const block = rules.slice(at, at + 3000);
    expect(block).toMatch(/'role', 'permissions', 'tenantId', 'plan'/);
    expect(block).toMatch(/isSuperAdmin\(\)/);
  });

  it('src/app/layout.tsx hashes to a digest the register accepts', () => {
    expect(ownershipFailure('src/app/layout.tsx'),
      "layout.tsx moved — this ticket's non-negotiables name it as untouchable").toBeNull();
  });

  it('firestore.indexes.json is byte-identical to the state this ticket found it in', () => {
    // 🔴 Recorded from `origin/main` as a CONSTANT, not re-derived from the
    // working tree: hashing the file at assertion time and comparing it to
    // itself would pass no matter what the file held.
    const AT_BASE = '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0';
    expect(sha('firestore.indexes.json'), 'the indexes moved').toBe(AT_BASE);
  });

  it('functions/ carries no change from this ticket', () => {
    // Nothing here is a server concern: the whole change is two client
    // components, two leaf modules and their guards.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'lib' ? [] : walk(p);
        return [p];
      });
    const fns = walk(path.join(ROOT, 'functions'));
    expect(fns.length, 'functions/ vanished — this assertion would be vacuous').toBeGreaterThan(0);
    for (const f of fns.filter((x) => /\.(ts|js|json)$/.test(x) && statSync(x).size < 400_000)) {
      expect(readFileSync(f, 'utf8'), `${f} mentions this ticket's resolver`)
        .not.toMatch(/resolveAuthTenant|tenantIdToWrite/);
    }
  });

  it('AuthPage.tsx and Onboarding.tsx are at the digests THIS ticket recorded', () => {
    for (const f of [AUTH_PAGE, ONBOARDING]) {
      expect(ownershipFailure(f), `${f} is at a digest no ticket recorded`).toBeNull();
    }
  });
});
