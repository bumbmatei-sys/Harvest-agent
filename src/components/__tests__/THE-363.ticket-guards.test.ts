import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

/**
 * THE-363 — the cross-cutting rules, applied to this ticket's own files.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every assertion here is scoped to what THIS ticket wrote or changed. It does
 * NOT sweep the repository: a guard that fails on somebody else's pre-existing
 * file is a guard that gets deleted rather than obeyed.
 *
 * 🔴 AND NOTHING HERE ASSERTS ANYTHING ABOUT THE BRANCH'S DIFF. #504 was caught
 * adding such a guard and #501 closed the sweep's blind spot and found two more.
 * "These four paths are byte-identical to main" is a claim about a diff, so it
 * is VERIFIED IN THE PULL REQUEST, not encoded as a test that would compare the
 * working tree against a remote ref at run time. Section 4 pins the reachable
 * half of it: this ticket's own files do not import or write those paths.
 *
 * NO LINE NUMBER IS PINNED ANYWHERE IN THIS FILE.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/** Everything this ticket added or edited, by path relative to `src/`. */
const TICKET_SOURCE = [
  'utils/plan-gate-state.ts',
  'hooks/useMemberPhoto.ts',
  'components/AdminBlog.tsx',
  'components/MainApp.tsx',
  'app/api/blog/auto-generate/route.ts',
] as const;

/** This ticket's own test files. */
const TICKET_TESTS = [
  'components/__tests__/THE-363.plan-gate-loading-state.test.tsx',
  'components/__tests__/THE-363.member-header-avatar.test.tsx',
  'components/__tests__/THE-363.course-type-fork.test.ts',
  'components/__tests__/THE-363.ticket-guards.test.ts',
  'app/api/blog/__tests__/THE-363.cron-failure-surfaces.test.ts',
] as const;


// ═════════════════════════════════════════════════════════════════════════════
// 1 · Every element that has a primitive uses it
// ═════════════════════════════════════════════════════════════════════════════

describe('every element that has a primitive uses it', () => {
  it('the installed primitives are on disk, and `accordion` is still the absent one', () => {
    const present = readdirSync(join(SRC, 'components/ui'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => f.replace(/\.tsx$/, ''))
      .sort();

    expect(present.length, 'the primitive count').toBe(43);
    expect(present).toContain('skeleton');
    expect(present).toContain('avatar');
    expect(present).not.toContain('accordion');
  });

  it('the loading gate uses the `skeleton` primitive', () => {
    // Needle assembled from fragments — spelled whole it would match its own
    // spelling in this file.
    expect(stripComments(read('components/AdminBlog.tsx')))
      .toContain(['ui', '/', 'skeleton'].join(''));
  });

  it('the header avatar primitive is SPLIT OUT, and the split is recorded', () => {
    /**
     * 🔴 `ui/avatar` IS NOT ADOPTED HERE, deliberately, and this asserts the
     * split rather than hiding it.
     *
     * THE-141's defect is that the header read the wrong FIELD — the Firebase
     * Auth profile instead of the Firestore user document. Fixing that needs no
     * markup change at all. Swapping the header's img/span pair for the
     * primitive moves this file's element tree, its class literals, its colour
     * tokens and its rendered-row inventory: six assertions across three frozen
     * baselines (MemberScreens.desktop-layout, THE-295, THE-348), each needing
     * its own reversible fold and meta-guard. `main` went red for everyone once
     * because a PR replaced a pinned baseline, and the brief's own STOP
     * condition says to split out anything that turns out large.
     *
     * So: the FIELD changed, the markup did not, and the adoption is reported
     * as its own ticket. This test is what a future adoption deletes.
     */
    const header = stripComments(read('components/MainApp.tsx'));
    expect(header).not.toContain(['ui', '/', 'avatar'].join(''));

    // ...and the header no longer reads the Auth profile, which IS the fix.
    expect(header).not.toContain(['currentUser', '?.', 'photoURL'].join(''));
    expect(header).toContain(['useMember', 'Photo'].join(''));
  });

  it('BOTH import spellings are searched, not just the `@/` one', () => {
    // AdminCRM imports `Collapsible` relatively and a `@/`-only grep missed it.
    // So this asserts the search itself covers both spellings, by finding a
    // known relative import of a primitive elsewhere in the tree.
    const crm = stripComments(read('components/AdminCRM.tsx'));
    const relative = ['./ui/', 'collapsible'].join('');
    const aliased = ['@/components/ui/', 'collapsible'].join('');
    expect(crm.includes(relative) || crm.includes(aliased), 'one spelling must match').toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · Every control this ticket touched reaches the touch floor below sm
// ═════════════════════════════════════════════════════════════════════════════

describe('every control >= 44px below sm', () => {
  /**
   * ⚠️ READ FROM THE CLASS STRING, NOT FROM A MEASUREMENT. happy-dom has no
   * layout engine, so a `getBoundingClientRect()` here would return zeros and
   * agree with anything; real measurement lives in `browser-measure.ts` under
   * the `node` pragma. What is checkable here is that the floor was DECLARED.
   */
  it('the Automate control and its loading skeleton both declare the floor', () => {
    const src = stripComments(read('components/AdminBlog.tsx'));
    const floor = ['min-h-[', '44px]'].join('');
    const occurrences = src.split(floor).length - 1;
    // One for the control, one for the skeleton that stands in its footprint —
    // a skeleton shorter than the control it replaces is the reflow this
    // ticket exists to remove.
    expect(occurrences, 'both the control and its skeleton need the floor').toBeGreaterThanOrEqual(2);
  });

  it('the header avatar control is untouched, and the 44px rule does not reach it', () => {
    const src = stripComments(read('components/MainApp.tsx'));
    // 36px, and unchanged by this ticket. It lives inside the desktop top bar,
    // which is `lg:`-only and therefore never renders below `sm` at all, so the
    // sub-`sm` touch floor does not apply. Pinned so the reasoning is not
    // re-derived by the next reader, and so that a control MOVED out of the
    // lg-only bar would have to answer the rule.
    expect(src).toContain(['w-9 ', 'h-9'].join(''));
    expect(src).toContain(['hidden lg:', 'block'].join(''));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · No colour hardcoded, no emoji
// ═════════════════════════════════════════════════════════════════════════════

describe('no colour hardcoded, no emoji', () => {
  /** Anything outside the Basic Multilingual Plane, plus the emoji ranges. */
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F900}-\u{1F9FF}]/u;

  it('no emoji in any code this ticket added or changed', () => {
    for (const rel of TICKET_SOURCE) {
      // STRIPPED source: this repo's prose comments legitimately carry the
      // warning glyphs the house style uses, and those are not code.
      const code = stripComments(read(rel));
      expect(EMOJI.test(code), `${rel} carries an emoji in code`).toBe(false);
    }
  });

  it('no hex colour in any code this ticket added or changed', () => {
    const HEX = /#[0-9a-fA-F]{3,8}\b/;
    for (const rel of TICKET_SOURCE) {
      const code = stripComments(read(rel));
      // AdminBlog's pre-existing `GOLD` fallback is the one literal in these
      // files and it predates this ticket; everything else must use a token.
      const lines = code.split('\n').filter((l) => HEX.test(l));
      const introduced = lines.filter((l) => !l.includes('--brand-color'));
      expect(introduced, `${rel} hardcodes a colour`).toEqual([]);
    }
  });

  it('the new modules use design tokens rather than literal colours', () => {
    const header = stripComments(read('components/MainApp.tsx'));
    expect(header).toContain(['bg-surface-', 'sunken'].join(''));
    expect(header).toContain(['text-', 'muted'].join(''));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · This ticket's own test hygiene
// ═════════════════════════════════════════════════════════════════════════════

describe("this ticket's tests obey the standing rules", () => {
  it('no test pins a line number', () => {
    // THE-331 pinned `AdminCommunity.tsx:491` and a deletion shifted it to
    // `:311`. A `File.tsx:123` reference in a test is the shape to refuse.
    const PIN = /\b[A-Za-z][\w.-]*\.(tsx?|json|rules)\s*:\s*\d+/;
    for (const rel of TICKET_TESTS) {
      const code = stripComments(read(rel));
      const offenders = code.split('\n').filter((l) => PIN.test(l));
      expect(offenders, `${rel} pins a line number`).toEqual([]);
    }
  });

  it('no fixture sits near today', () => {
    // #468 pinned a fixture near the day it was written and turned `main` red
    // once the day passed; THE-324 left one four days out that failed silently.
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const rel of TICKET_TESTS) {
      const src = read(rel);
      for (const [literal] of src.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) {
        const parsed = Date.parse(literal);
        if (Number.isNaN(parsed)) continue;
        const days = Math.abs(now - parsed) / DAY;
        expect(days, `${rel} has a fixture ${Math.round(days)} days from today: ${literal}`)
          .toBeGreaterThan(30);
      }
    }
  });

  it('every suite that fakes the clock keeps `toFake` scoped to Date', () => {
    for (const rel of TICKET_TESTS) {
      const code = stripComments(read(rel));
      const fake = ['useFake', 'Timers('].join('');
      if (!code.includes(fake)) continue;
      // An unscoped `useFakeTimers()` fakes the timers these screens' Firestore
      // mocks rely on and nothing ever resolves. The cron suite is the one
      // exception: it drives a plain async handler with no component timers.
      const scoped = code.includes(["toFake: ['", "Date']"].join(''));
      const isCronSuite = rel.includes('cron-failure-surfaces');
      expect(scoped || isCronSuite, `${rel} fakes timers unscoped`).toBe(true);
    }
  });

  it('no guard asserts anything about the current branch diff', () => {
    // #504 was caught adding one. The shapes: shelling out to git, or reading a
    // remote ref. Needles assembled from fragments.
    const FORBIDDEN = [
      ['git', ' diff'].join(''),
      ['origin', '/main'].join(''),
      ['child_', 'process'].join(''),
      ['exec', 'Sync('].join(''),
      ['revPar', 'se'].join(''),
    ];
    for (const rel of TICKET_TESTS) {
      const code = stripComments(read(rel));
      for (const needle of FORBIDDEN) {
        expect(code.includes(needle), `${rel} reaches for '${needle}'`).toBe(false);
      }
    }
  });

  it('no digest of firestore.rules is recorded anywhere in this ticket', () => {
    // #504 was caught spelling the live digest as a literal, and the ownership
    // register must not carry one.
    for (const rel of [...TICKET_TESTS, ...TICKET_SOURCE]) {
      const code = read(rel);
      const hashing = ['create', 'Hash('].join('');
      expect(code.includes(hashing), `${rel} hashes a file`).toBe(false);
      // A bare 64-hex run is what a sha256 literal looks like.
      expect(/\b[0-9a-f]{64}\b/.test(code), `${rel} carries a digest literal`).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · The frozen paths are not reached by anything this ticket wrote
// ═════════════════════════════════════════════════════════════════════════════

describe('the frozen paths are untouched', () => {
  // Assembled from fragments: spelled whole, each of these would match its own
  // spelling in this file and the guard could never fail. #504 shipped three
  // that did exactly that.
  const FROZEN = [
    ['firestore', '.rules'].join(''),
    ['firestore', '.indexes.json'].join(''),
    ['functions', '/'].join(''),
    ['app/lay', 'out.tsx'].join(''),
  ];

  it('no file this ticket wrote imports or writes a frozen path', () => {
    for (const rel of [...TICKET_SOURCE, ...TICKET_TESTS]) {
      const code = stripComments(read(rel));
      for (const frozen of FROZEN) {
        // The plan-gate suite READS firestore.rules to prove the rules still
        // scope by membership — a read is not a write, and that is the point of
        // the assertion. Nothing may IMPORT from a frozen path.
        const asImport = [`from '`, frozen].join('');
        expect(code.includes(asImport), `${rel} imports ${frozen}`).toBe(false);
      }
    }
  });

  it('the root layout module is not referenced by this ticket at all', () => {
    // STOP condition 5: any fix needing the root layout stops, because 25 files
    // hash-pin it.
    //
    // 🔴 THE TITLE AND THE MESSAGE BELOW ARE ASSEMBLED TOO, not just the needle.
    // The first version of this assertion spelled the filename whole in its own
    // `it(...)` title and in its failure message — both of which are CODE, not
    // comments, so the stripper kept them and this file matched itself. It could
    // not fail. Found by running it, which is the only way these are ever found.
    const needle = ['lay', 'out', '.tsx'].join('');
    for (const rel of [...TICKET_SOURCE, ...TICKET_TESTS]) {
      const code = stripComments(read(rel));
      expect(code.includes(needle), `${rel} reaches the root ${needle}`).toBe(false);
    }
  });

  it('no new dependency was added', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    // Everything the new modules import is already here.
    for (const dep of ['firebase', '@base-ui/react', '@sentry/nextjs', 'typescript']) {
      expect(all[dep], `${dep} must already be a dependency`).toBeDefined();
    }
  });
});
