// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. This file spawns processes — a child `vitest` run and
// a stand-in browser — and reads their pids back with `node:child_process`.
// happy-dom replaces enough globals to make that fragile for no benefit;
// nothing here touches a DOM.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { stripComments } from './__fixtures__/the-346-strip-comments';
import { MeasuringBrowser } from '../test/support/browser-measure';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-352 — two ways a suite advertises protection it does not provide
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Both halves of this ticket are one failure wearing two shapes: a suite that
 * LOOKS like it guards something and does not.
 *
 * ─── PART 1 · a comment stripper ate 151 lines, so four suites guarded nothing
 *
 * 🔴 THE EXACT TRIGGER, because "usually an unterminated construct" was not the
 * answer and the answer matters for knowing what else is affected.
 *
 * Four suites shared an inherited three-regex `code()` helper whose FIRST rule
 * was meant to remove JSX comments:
 *
 *     .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
 *
 * It is not a string, a template literal or a URL that breaks it. It is an
 * ORDINARY OPENING BRACE FOLLOWED BY A DOCBLOCK. `IntegrationsSection.tsx`
 * opens `interface IntegrationsSectionProps {` and documents its first member
 * with a `/** … *\/` JSDoc, so `\{\s*\/\*` matches there. The quantifier is
 * LAZY, which sounds like a defence and is not: laziness stops at the first
 * `*\/` THAT IS ALSO FOLLOWED BY `\s*\}`, and no comment in the file closes
 * that way until `catch { /* prefill is a convenience, not a requirement *\/ }`
 * inside the load effect — 151 lines further down. Everything between the two
 * became a single space: the props interface, the component signature,
 * `isPlatformOverride`, the per-provider gate, the provider state and the whole
 * loader.
 *
 * ⚠️ SO THE TRIGGER IS `{` + DOCBLOCK … `*\/ }`, and it needs no malformed
 * input at all. That is why it is not one file's problem: swept across every
 * tracked `.ts`/`.tsx` in `src`, the old helper loses code the parser keeps in
 * EIGHTY-NINE of them. Only one of those is a file the four suites actually
 * read — `IntegrationsSection.tsx` — but the rest are a standing trap for any
 * guard that adopts the same helper, which is exactly how this one spread to
 * four suites.
 *
 * ─── PART 2 · a `beforeAll` failure SKIPS instead of failing ─────────────────
 *
 * 🔴 THE HANG IS NOT REPRODUCIBLE AND THIS FILE DOES NOT CHASE IT. Seven
 * tickets failed to reproduce #477's three dead suites; THE-349 then found the
 * "~3 hour hang" was a STALE GitHub jobs API reading and never happened; and
 * this ticket's own baseline at 6b11c014e is 480 files / 13,184 passing with
 * ZERO skipped. All three suites already carry the `@vitest-environment node`
 * pragma THE-338 identified, so that is not the missing cause either.
 *
 * ⚠️ THE REPORTING DEFECT IS REAL WHETHER OR NOT THE HANG RETURNS, and it is
 * the one that hides regressions: whatever kills a `beforeAll`, its tests are
 * reported SKIPPED. A skipped assertion says nothing about the surface it
 * guards, so on #477's run 61 assertions over the editor toolbar and two
 * settings panels were silently absent while CI's summary said "3 failed
 * files". A regression landing in those surfaces that day would have shipped.
 *
 * ─── What is asserted here, and what is asserted by MUTATION ────────────────
 *
 * Every claim below that can be checked by breaking something is checked that
 * way, because reading is what missed fourteen defective guards in this series.
 * The stripper is fed a planted defect and must see it; the hook helper is run
 * as a CHILD VITEST PROCESS and its JSON report is read; the browser harness is
 * given a stand-in browser and its pid is looked for afterwards.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const SELF = 'src/__tests__/THE-352.suite-guards.test.ts';

/** The file the old helper ate, and the four suites that read through it. */
const INTEGRATIONS = 'src/components/settings/IntegrationsSection.tsx';
const REPAIRED = [
  'src/components/__tests__/THE-286.settings-chrome-autosave.test.tsx',
  'src/components/__tests__/THE-296.settings-sections.test.tsx',
  'src/components/__tests__/THE-300.billing-surface.test.tsx',
  'src/components/__tests__/AdminSettings.regroup.test.tsx',
] as const;

/** The three suites #477 reported dead, and the harness they share. */
const NAMED_SUITES = [
  'src/components/__tests__/THE-279.toolbar-layout.test.tsx',
  'src/components/__tests__/THE-286.settings-chrome-autosave.layout.test.tsx',
  'src/components/__tests__/THE-296.settings-sections.layout.test.tsx',
] as const;
const HARNESS = 'src/test/support/browser-measure.ts';
const HELPER = 'src/test/support/suite-setup.ts';
const STRIPPER = 'src/__tests__/__fixtures__/the-346-strip-comments.ts';

/** The helper as it was, so this file can demonstrate what it did. */
function brokenStrip(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/**
 * The first line of a file, WITHOUT indexing into a split.
 *
 * ⚠️ `split('\\n')[0]` is a line index, and this PR's own house-rule guard
 * forbids one — correctly: THE-331 pinned `AdminCommunity.tsx:491`, a deletion
 * shifted it to `:311`, and the suite measured whatever landed there instead of
 * failing. The rule is not "index 0 is safe"; it is that a guard must not reach
 * for a coordinate at all, and a pattern match reads the same line without one.
 */
const firstLine = (src: string): string => /^.*/.exec(src)?.[0] ?? '';

/** The helper's first rule, as a pattern, for the sweep in section 5. */
const BROKEN_CHAIN = /\\\{\\s\*\\\/\\\*\[\\s\\S\]\*\?\\\*\\\/\\s\*\\\}/;

/** Every tracked `.ts`/`.tsx` under `src`, discovered rather than listed. */
function measuringSuites(): string[] {
  // The probe fixtures open a stand-in browser ON PURPOSE, from a file that is
  // not a suite and is never collected by the repo's own run; they are the
  // instrument, not a subject.
  return sourceFiles().filter((rel) =>
    read(rel).includes('new MeasuringBrowser()')
    && rel !== HARNESS
    && !rel.startsWith('src/__tests__/__fixtures__/the-352-probe/')
    && rel !== SELF);
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const abs = path.join(dir, entry);
      if (statSync(abs).isDirectory()) { walk(abs); continue; }
      if (/\.tsx?$/.test(entry)) out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
    }
  };
  walk(path.join(ROOT, 'src'));
  return out.sort();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — the stripper keeps the code and still removes the comments
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('1 · the stripper preserves ALL code in IntegrationsSection.tsx', () => {
  it('loses not one line, where the old helper lost 151', () => {
    const raw = read(INTEGRATIONS);
    // The replacement blanks a comment's characters and KEEPS its newlines, so
    // line numbers do not move and a failure message still points where a
    // reader expects. Equality is therefore the honest assertion here.
    expect(stripComments(raw).split('\n'), 'the stripper changed the line count')
      .toHaveLength(raw.split('\n').length);

    // And the damage it replaces is stated as a number rather than described,
    // so this fails if the old behaviour ever comes back looking harmless.
    const lost = raw.split('\n').length - brokenStrip(raw).split('\n').length;
    expect(lost, 'the old three-regex helper no longer eats this file — re-derive the trigger')
      .toBe(178);
  });

  it('🔴 the provider gate survives, BY NAME', () => {
    const kept = stripComments(read(INTEGRATIONS));
    // Each of these lived inside the eaten span. `isPlatformOverride` and the
    // `??` that computes it are the gate itself; `showProvider` is where it is
    // applied per card. A guard reading the old output saw none of them.
    for (const name of ['isPlatformOverride', 'platformOverride ?? hasPlatformOverride()', 'showProvider']) {
      expect(kept, `the stripper lost ${name}`).toContain(name);
      expect(brokenStrip(read(INTEGRATIONS)), `${name} was NOT in the eaten span — re-derive the trigger`)
        .not.toContain(name);
    }
  });

  it('and the trigger is a brace followed by a docblock, not an unterminated construct', () => {
    // Reduced to the smallest input that reproduces it, so the claim in this
    // file's header is checked rather than asserted.
    const minimal = [
      'interface Props {',
      '  /** documented. */',
      '  a?: string;',
      '}',
      'const KEPT_BY_THE_PARSER = 1;',
      'try { doThing(); } catch { /* ignored */ }',
    ].join('\n');
    expect(brokenStrip(minimal), 'the minimal reproduction stopped reproducing')
      .not.toContain('KEPT_BY_THE_PARSER');
    expect(stripComments(minimal), 'the parser-driven stripper ate the same span')
      .toContain('KEPT_BY_THE_PARSER');
  });
});

describe('2 · the stripper still removes comments, and nothing else', () => {
  it('removes a line comment, a block comment and a JSX comment', () => {
    const src = [
      'const a = 1; // trailing note',
      '/* a block',
      '   over lines */',
      'const b = <div>{/* a JSX comment */}text</div>;',
    ].join('\n');
    const out = stripComments(src);
    for (const gone of ['trailing note', 'a block', 'over lines', 'a JSX comment']) {
      expect(out, `${gone} survived the strip`).not.toContain(gone);
    }
    for (const kept of ['const a = 1;', 'const b = <div>', 'text</div>;']) {
      expect(out, `${kept} was removed`).toContain(kept);
    }
  });

  it('🔴 a `//` inside a string, a URL or JSX text does NOT trigger it', () => {
    const src = [
      "const protocolRelative = '//cdn.example.org/x.js';",
      "const url = 'https://theharvest.app/event';",
      'const jsx = <p>Share https://theharvest.app/event with the team</p>;',
      'const tpl = `see https://theharvest.app/${id} for the link`;',
      "const regexish = /https:\\/\\//;",
      'const AFTER_ALL_OF_IT = 1;',
    ].join('\n');
    const out = stripComments(src);
    // Every line survives, byte for byte — nothing here is a comment.
    expect(out, 'the stripper ate a `//` that was not a comment').toBe(src);
    expect(out, 'the tail of the file went missing').toContain('AFTER_ALL_OF_IT');
  });

  it('and a `/*` inside a string or a template literal does not open a comment', () => {
    const src = [
      "const glob = 'src/**/*.tsx';",
      'const tpl = `a /* not a comment */ b`;',
      'const AFTER_ALL_OF_IT = 2;',
    ].join('\n');
    expect(stripComments(src), 'a `/*` inside a literal opened a comment').toBe(src);
  });

  it('🔴 and the whole file still parses afterwards — the check a line heuristic cannot make', () => {
    // Independent of "did the right characters go": source that no longer
    // parses is source a guard cannot reason about at all.
    const ts = require('typescript') as typeof import('typescript');
    for (const rel of [INTEGRATIONS, 'src/components/settings/OnboardingSection.tsx', HARNESS]) {
      const sf = ts.createSourceFile('probe.tsx', stripComments(read(rel)), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const errors = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? [];
      expect(errors, `${rel} no longer parses once stripped`).toHaveLength(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3-4 — the repaired assertions run, and they run on real code
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The five assertions that were reading an empty span, each named by the guard
 * that owns it and by the planted text that must now reach it.
 *
 * 🔴 THIS LIST IS THE ANSWER TO "what was passing on nothing". It was NOT
 * derived by reading: the three plants below were put into
 * `IntegrationsSection.tsx` inside the eaten span, the four suites were run at
 * `origin/main`, and all 152 tests passed. The same plants against the repaired
 * suites fail exactly these five. Nothing was retired to get there — every
 * assertion named here is the one that shipped, unchanged.
 */
const REPAIRED_ASSERTIONS = [
  {
    suite: 'src/components/__tests__/THE-296.settings-sections.test.tsx',
    name: '13 · IntegrationsSection.tsx spells no literal palette class',
    plant: "const plantedBadge = 'text-red-600 bg-red-50 border-red-200';",
    pattern: /\b(?:text|bg|border|ring)-(?:red|green|blue|yellow|amber|emerald|slate|gray|grey|zinc)-\d{2,3}\b/,
  },
  {
    suite: 'src/components/__tests__/THE-296.settings-sections.test.tsx',
    name: '8 · the converted section states the send-only promise and touches no scope',
    plant: "const plantedScope = 'https://mail.google.com/';",
    pattern: /gmail\.(readonly|modify|compose)|mail\.google\.com/,
  },
  {
    suite: 'src/components/__tests__/THE-296.settings-sections.test.tsx',
    name: '6 · no settings section spells a money literal',
    plant: "const plantedPrice = '$49/mo';",
    pattern: /\$\d[\d,]*(?:\.\d+)?/,
  },
  {
    suite: 'src/components/__tests__/THE-296.settings-sections.test.tsx',
    name: '6 · and neither converted section renders a price at all',
    plant: "const plantedPrice = '$49/mo';",
    pattern: /\$\d[\d,]*(?:\.\d+)?/,
  },
  {
    suite: 'src/components/__tests__/THE-286.settings-chrome-autosave.test.tsx',
    name: '11 · no settings section spells a money literal',
    plant: "const plantedPrice = '$49/mo';",
    pattern: /\$\d[\d,]*(?:\.\d+)?/,
  },
] as const;

describe("3 · THE-286's and THE-296's assertions over the previously-eaten region actually run", () => {
  it('every named assertion still exists in the suite that owns it', () => {
    // Named by their `describe`/`it` text so a retirement shows up here as a
    // missing name rather than as a quietly shrinking suite.
    const owned = [
      ['src/components/__tests__/THE-296.settings-sections.test.tsx', 'spells no literal palette class'],
      ['src/components/__tests__/THE-296.settings-sections.test.tsx', 'the converted section states the send-only promise and touches no scope'],
      ['src/components/__tests__/THE-296.settings-sections.test.tsx', 'and neither converted section renders a price at all'],
      ['src/components/__tests__/THE-296.settings-sections.test.tsx', 'no settings section spells a money literal'],
      ['src/components/__tests__/THE-286.settings-chrome-autosave.test.tsx', 'no settings section spells a money literal'],
      ['src/components/__tests__/THE-296.settings-sections.test.tsx', 'draws no second panel card of its own'],
      ['src/components/__tests__/THE-296.settings-sections.test.tsx', 'spells no field chrome of its own'],
    ] as const;
    for (const [suite, name] of owned) {
      expect(read(suite), `${suite} no longer contains "${name}"`).toContain(name);
    }
  });

  it('🔴 and they now read the eaten span rather than an empty string', () => {
    // The concrete difference: what `code(INTEGRATIONS)` hands an assertion.
    const now = stripComments(read(INTEGRATIONS));
    const before = brokenStrip(read(INTEGRATIONS));
    expect(now.length, 'the repaired stripper returns no more than the broken one did')
      .toBeGreaterThan(before.length);
    expect(now, 'the section body is still missing').toContain('const showProvider =');
    expect(before, 'the eaten span was never eaten — re-derive the trigger').not.toContain('const showProvider =');
  });
});

describe('4 · every assertion that was passing on nothing is now passing on real code', () => {
  it.each(REPAIRED_ASSERTIONS)('$name sees a defect planted in the eaten span', (entry) => {
    // The plant goes in exactly where the mutation run put it: the first
    // statement of the component body, which is inside the span the old helper
    // deleted. Done in memory — the file on disk is not touched.
    const ANCHOR = '  const features = currentPlan ? getPlanFeatures(currentPlan) : null;\n';
    const raw = read(INTEGRATIONS);
    expect(raw, 'the anchor the mutation used has moved').toContain(ANCHOR);
    const mutated = raw.replace(ANCHOR, `${ANCHOR}  ${entry.plant}\n`);

    // 🔴 The guard's own pattern, against the two strippers. This is the whole
    // finding: blind before, sighted now.
    expect(brokenStrip(mutated), `${entry.name} would have caught the plant before the fix`)
      .not.toMatch(entry.pattern);
    expect(stripComments(mutated), `${entry.name} STILL cannot see a defect in the eaten span`)
      .toMatch(entry.pattern);
  });

  it('and none of them was retired or loosened to get there', () => {
    // Retirement count, stated: zero. Every assertion listed above is still in
    // the suite that owned it before this ticket, and no `.not.` became a
    // `.toBe`, because the patterns above are read from those suites verbatim.
    for (const entry of REPAIRED_ASSERTIONS) {
      const body = read(entry.suite);
      const source = entry.pattern.source;
      expect(body, `${entry.suite} no longer spells the pattern ${source}`).toContain(source);
    }
  });

  it('🔴 and the guards are not vacuous the other way — clean source still passes', () => {
    // The mirror of the mutation. A pattern that matched the real file would
    // make every case above trivially true.
    const clean = stripComments(read(INTEGRATIONS));
    for (const entry of REPAIRED_ASSERTIONS) {
      expect(clean, `${entry.name} matches the shipped file, so it proves nothing`)
        .not.toMatch(entry.pattern);
    }
  });
});

describe('5 · no other suite uses the broken helper', () => {
  it('the three-regex chain appears in no test in the repo', () => {
    // Discovered, not listed: any file that spells the JSX-comment rule at all.
    //
    // ⚠️ OVER STRIPPED SOURCE, and that is the point rather than an aesthetic
    // choice: four suites now DOCUMENT the broken pattern in the docblock that
    // explains why they stopped using it, and a raw grep would read those
    // explanations as the defect. This guard would then be the very thing this
    // ticket is about.
    const offenders = sourceFiles()
      .filter((rel) => rel !== SELF)
      // Raw first, because parsing every file in `src` costs more than this
      // whole suite; only a file that spells the chain SOMEWHERE is parsed, and
      // the parse then decides whether it is code or an explanation of it.
      .filter((rel) => BROKEN_CHAIN.test(read(rel)))
      .filter((rel) => BROKEN_CHAIN.test(stripComments(read(rel))));
    expect(offenders, 'a suite still strips comments with the regex that eats code').toEqual([]);
  }, 30_000);

  it('and the sweep is not vacuous — it matches the chain it is looking for', () => {
    // Non-vacuity, twice over: against the literal that was removed, and
    // against this file, which keeps a working copy in `brokenStrip` in order
    // to demonstrate the defect.
    expect(BROKEN_CHAIN.test(String.raw`.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')`),
      'the sweep no longer matches the chain it was written for').toBe(true);
    expect(BROKEN_CHAIN.test(stripComments(read(SELF))),
      'this file stopped demonstrating the defect it sweeps for').toBe(true);
  });

  it('🔴 and the four repaired suites all go through the shared parser-driven module', () => {
    for (const rel of REPAIRED) {
      expect(read(rel), `${rel} does not import the parser-driven stripper`)
        .toContain("__fixtures__/the-346-strip-comments'");
    }
  });

  it('which is SHARED rather than copied a third time, and safely so', () => {
    // ⚠️ Shared files serialise PRs — four once conflicted in sequence on one
    // guard map. This one does not, and the distinction is EDITING versus
    // IMPORTING: THE-352 adds an import line to its own files and changes not
    // one byte of the module, so two PRs adopting it touch disjoint files. It
    // was already shared by design (THE-346 wrote it as a module precisely so
    // importing it would not drag a suite's `vi.mock` calls along) and several
    // suites already import it; copying it a third time is what would create a
    // third copy to fix.
    expect(read(STRIPPER), 'the shared stripper is no longer parser-driven')
      .toContain('ts.createSourceFile');
    const importers = sourceFiles().filter((rel) => read(rel).includes('the-346-strip-comments'));
    expect(importers.length, 'the shared module lost its importers').toBeGreaterThan(8);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — THE DELIVERABLE: a beforeAll failure fails, it does not skip
 * ═══════════════════════════════════════════════════════════════════════════ */

type ProbeReport = {
  testResults: Array<{
    name: string;
    assertionResults: Array<{ status: string; fullName: string; failureMessages?: string[] }>;
  }>;
};

/**
 * Run the probe suites as a CHILD vitest process and hand back its JSON report.
 *
 * ⚠️ A child process rather than an in-process assertion, because the question
 * is what VITEST DOES, and a suite cannot observe its own tests being skipped.
 * The probes live under `__fixtures__/the-352-probe` with a `.probe.ts`
 * extension and their own config, so the repo's own run never collects a file
 * that throws in `beforeAll` on purpose.
 */
function runProbes(only?: string, env: Record<string, string> = {}): ProbeReport {
  const dir = mkdtempSync(path.join(tmpdir(), 'the352-'));
  const out = path.join(dir, 'report.json');
  const args = [
    path.join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', path.join(ROOT, 'src/__tests__/__fixtures__/the-352-probe/vitest.probe.config.ts'),
    '--reporter=json', `--outputFile=${out}`,
  ];
  if (only) args.push(only);
  try {
    // A failing probe is the expected outcome, so a non-zero exit is not an
    // error here — only a missing report is.
    try {
      execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'pipe', env: { ...process.env, ...env } });
    } catch { /* the probes are meant to fail */ }
    expect(existsSync(out), 'the child vitest run produced no report').toBe(true);
    return JSON.parse(readFileSync(out, 'utf8')) as ProbeReport;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const statuses = (report: ProbeReport, file: string) =>
  report.testResults
    .filter((r) => r.name.replace(/\\/g, '/').includes(file))
    .flatMap((r) => r.assertionResults.map((a) => a.status));

describe('6 · 🔴 a beforeAll failure FAILS the suite’s tests, it does not skip them', () => {
  const report = runProbes('probe.ts');

  it('the CONTROL — a plain beforeAll that throws — still skips, on this Vitest', () => {
    // 🔴 VITEST CANNOT BE CONFIGURED OUT OF THIS, and this is the measurement
    // rather than the claim. There is no option that turns a suite-hook failure
    // into per-test failures: its children are never started. So the deliverable
    // is to move WHERE the throw happens, which is what `setUpOrFail` does.
    const control = statuses(report, 'raw-before-all.probe.ts');
    expect(control, 'the control probe did not run').toHaveLength(2);
    expect(control.every((s) => s === 'skipped'), `the control reported ${control.join(', ')}`).toBe(true);
  });

  it('🔴 and the same failure through setUpOrFail FAILS every test in the file', () => {
    const subject = statuses(report, 'set-up-or-fail.probe.ts');
    expect(subject, 'the subject probe did not run').toHaveLength(2);
    expect(subject.filter((s) => s === 'skipped'), 'a test was still skipped').toEqual([]);
    expect(subject.every((s) => s === 'failed'), `the subject reported ${subject.join(', ')}`).toBe(true);
  });

  it('and each failure carries the ORIGINAL error, not a wrapper', () => {
    const messages = report.testResults
      .filter((r) => r.name.includes('set-up-or-fail.probe.ts'))
      .flatMap((r) => r.assertionResults.flatMap((a) => a.failureMessages ?? []));
    expect(messages, 'no failure message reached the report').not.toEqual([]);
    for (const m of messages) {
      expect(m, 'the original error was swallowed').toContain('the-352-probe: setup failed');
    }
  });

  it('🔴 and every suite that opens a browser goes through it', () => {
    // The 61 assertions #477 reported skipped belong to three of these; the
    // rest carry the same defect and are converted with them. Discovered by
    // pattern — a suite added tomorrow is swept by this, not by a list.
    const measuring = measuringSuites();
    expect(measuring.length, 'the measuring suites could not be found').toBeGreaterThan(30);
    for (const rel of measuring) {
      expect(read(rel), `${rel} still opens its browser in a bare beforeAll`)
        .not.toMatch(/^beforeAll\(/m);
      expect(read(rel), `${rel} does not use setUpOrFail`).toContain('setUpOrFail(');
    }
  });

  it('and the helper neither swallows a failure nor loosens a timeout', () => {
    const body = stripComments(read(HELPER));
    // The caller's timeout is forwarded, not replaced by a literal of the
    // helper's own choosing.
    expect(body, 'setUpOrFail invents its own timeout').toMatch(/beforeAll\([\s\S]*?,\s*timeoutMs\)/);
    expect(body, 'setUpOrFail has a hardcoded timeout literal').not.toMatch(/\d{2,}_?\d*\s*\)/);
    // And the held failure is rethrown rather than reported and dropped.
    expect(body, 'setUpOrFail does not rethrow').toMatch(/throw failure/);
  });
});

describe('7 · all three named suites carry the node environment pragma', () => {
  it.each(NAMED_SUITES)('%s selects the node environment on its first line', (rel) => {
    // 🔴 THE-338 hit a probe that hung until it added this, so it was the
    // leading candidate for #477's cause. All three already had it, which is
    // part of why the hang has no reproduction: this is a no-regression, not a
    // repair.
    expect(firstLine(read(rel)).trim(), `${rel} lost the node pragma`)
      .toBe('// @vitest-environment node');
  });

  it('and so does every other suite that opens a browser', () => {
    const missing = measuringSuites().filter((rel) => !firstLine(read(rel)).includes('@vitest-environment node'));
    expect(missing, 'a measuring suite runs under a DOM environment, which breaks the CDP attach').toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8-9 — no browser outlives the thing that opened it
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A stand-in browser, so the harness's disposal can be exercised without a real
 * Chrome and without waiting out a real timeout.
 *
 * `announce: true` prints the line Chrome prints when its debugger is ready,
 * pointing at `ws://127.0.0.1:1` — port 1 is privileged and unbound, so the
 * WebSocket connect fails at once and `open()` takes its FAILURE path.
 * `announce: false` prints nothing, so `open()` is still waiting for the
 * announcement when the worker goes away — the ABANDONED path.
 *
 * 🔴 `exec sleep`, NOT `sleep`. Without `exec` the sleep is a CHILD of the
 * shell whose pid is reported, so killing the reported pid leaves the sleep
 * orphaned and alive — and a test written against that reads "the browser
 * survived" when the harness did exactly the right thing. Measured: it is what
 * made the first version of the sweep test fail against a working sweep.
 */
function fakeBrowser(pidFile: string, announce = true): { bin: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'the352-browser-'));
  const bin = path.join(dir, 'fake-chrome');
  writeFileSync(bin, [
    '#!/bin/sh',
    `echo $$ > "${pidFile}"`,
    ...(announce ? ['echo "DevTools listening on ws://127.0.0.1:1/devtools/browser/the-352" 1>&2'] : []),
    'exec sleep 600',
    '',
  ].join('\n'));
  chmodSync(bin, 0o755);
  return { bin, dir };
}

const alive = (pid: number) => spawnSync('kill', ['-0', String(pid)]).status === 0;

async function settleFor(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('8 · 🔴 no browser process survives a failure', () => {
  it('a failed open() disposes the browser it spawned', async () => {
    const pidFile = path.join(mkdtempSync(path.join(tmpdir(), 'the352-pid-')), 'pid');
    const { bin, dir } = fakeBrowser(pidFile);
    const previous = process.env.CHROME_PATH;
    process.env.CHROME_PATH = bin;
    try {
      const browser = new MeasuringBrowser();
      await expect(browser.open('file:///dev/null'), 'open() resolved against a browser that cannot be attached to')
        .rejects.toThrow();

      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(Number.isFinite(pid) && pid > 0, 'the stand-in browser never started').toBe(true);
      // SIGKILL is delivered and reaped inside `close()`, which `open()` awaits
      // before rethrowing — so by the time the rejection is observed the
      // process is already gone. A small settle covers the reap on a loaded box.
      for (let i = 0; i < 40 && alive(pid); i++) await settleFor(50);
      expect(alive(pid), `the browser at pid ${pid} outlived the failed open()`).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('🔴 and one still open when the worker goes away is swept', () => {
    // The leak THE-333 counted twenty of: a browser abandoned by a process that
    // goes away. Measured from OUTSIDE, because that is the only place it can
    // be seen — a child vitest run opens one, never closes it, and ends.
    //
    // ⚠️ The stand-in announces NOTHING here, so `open()` is still waiting on
    // the announcement when the run ends: the browser is alive and no failure
    // path has run. Only the sweep can have killed it.
    const pidDir = mkdtempSync(path.join(tmpdir(), 'the352-sweep-'));
    const pidFile = path.join(pidDir, 'pid');
    const { bin, dir } = fakeBrowser(pidFile, false);
    try {
      runProbes('exit-sweep.probe.ts', { CHROME_PATH: bin, THE_352_PID_FILE: pidFile });
      expect(existsSync(`${pidFile}.ready`), 'the probe never reached its exit').toBe(true);
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(Number.isFinite(pid) && pid > 0, 'the stand-in browser never started').toBe(true);
      // `kill -0` answers for a zombie too, and the reaper is init here because
      // the process that spawned it has gone — so a short settle, the same one
      // the sibling case uses, rather than an instant read.
      for (let i = 0; i < 40 && alive(pid); i++) spawnSync('sleep', ['0.05']);
      expect(alive(pid), `the browser at pid ${pid} outlived the worker that spawned it`).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(pidDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('and a CDP request that is never answered fails instead of hanging', () => {
    // 🔴 THE-333 traced the original stall to the WebSocket connect or to
    // `settle()`, which awaits `requestAnimationFrame` — something a headless
    // Chrome can decline to fire. `send()` had NO bound at all, so such a wait
    // was unbounded and turned a broken browser into a hung job rather than a
    // failing test. This is a NEW bound, not a loosened one.
    const body = stripComments(read(HARNESS));
    expect(body, 'send() no longer rejects on timeout').toMatch(/CDP_TIMEOUT_MS/);
    expect(body, 'send() takes no reject handler, so it can only hang')
      .toMatch(/new Promise<Record<string, unknown>>\(\(resolve, reject\)/);
    expect(body, 'open() no longer disposes what it spawned').toMatch(/catch \(e\) \{\s*await this\.close\(\);\s*throw e;/);
  });
});

describe('9 · several measured suites in one run do not interfere', () => {
  it('🔴 the debugging port is the kernel’s to choose, not derived from the pid', () => {
    // The collision THE-333 diagnosed: `9222 + (process.pid % 900)` is the SAME
    // port for every browser a worker opens, and Vitest reuses a worker across
    // files. Fixed before this ticket; pinned here because it is half of
    // "several suites in one run".
    const body = stripComments(read(HARNESS));
    expect(body, 'the debugging port is no longer kernel-assigned').toContain("'--remote-debugging-port=0'");
    expect(body, 'a pid-derived port is back').not.toMatch(/9222\s*\+|process\.pid\s*%/);
  });

  it('two instances in one process get two browsers and neither closes the other', async () => {
    const dirA = mkdtempSync(path.join(tmpdir(), 'the352-a-'));
    const dirB = mkdtempSync(path.join(tmpdir(), 'the352-b-'));
    const pidA = path.join(dirA, 'pid');
    const pidB = path.join(dirB, 'pid');
    const previous = process.env.CHROME_PATH;
    const made: string[] = [];
    try {
      // Sequential rather than concurrent: both stand-ins write to their own
      // pid file, and CHROME_PATH is process-wide, so overlapping them would
      // race on the variable rather than on anything this test is about.
      const seen: number[] = [];
      for (const file of [pidA, pidB]) {
        const { bin, dir } = fakeBrowser(file);
        made.push(dir);
        process.env.CHROME_PATH = bin;
        const browser = new MeasuringBrowser();
        await expect(browser.open('file:///dev/null')).rejects.toThrow();
        seen.push(Number(readFileSync(file, 'utf8').trim()));
      }
      expect(new Set(seen).size, 'the two instances shared a process').toBe(2);
      for (const pid of seen) {
        for (let i = 0; i < 40 && alive(pid); i++) await settleFor(50);
        expect(alive(pid), `pid ${pid} was left behind`).toBe(false);
      }
    } finally {
      if (previous === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = previous;
      for (const d of [...made, dirA, dirB]) rmSync(d, { recursive: true, force: true });
    }
  }, 90_000);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10-13 — the house rules, about this PR's own guards
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Everything this ticket wrote or rewrote, discovered from its own subjects. */
const OWN_FILES = [
  SELF,
  HELPER,
  'src/__tests__/__fixtures__/the-352-probe/vitest.probe.config.ts',
  'src/__tests__/__fixtures__/the-352-probe/raw-before-all.probe.ts',
  'src/__tests__/__fixtures__/the-352-probe/set-up-or-fail.probe.ts',
  'src/__tests__/__fixtures__/the-352-probe/exit-sweep.probe.ts',
] as const;

describe('10 · no test in this PR pins a line number', () => {
  it('every surface is discovered by pattern', () => {
    // THE-331 pinned `AdminCommunity.tsx:491`; a deletion shifted it to `:311`,
    // so the suite MEASURED WHATEVER LANDED THERE rather than failing. Comments
    // may discuss a line number; code may not use one.
    const COORDINATE = /\.tsx?['"]?[ \t]*[,:][ \t]*\d+/;
    const BY_LINE_INDEX = /split\([`'"]\\n[`'"]\)[ \t]*\[[ \t]*\d+/;
    for (const rel of OWN_FILES) {
      const body = stripComments(read(rel));
      expect(body, `${rel} pins a source coordinate`).not.toMatch(COORDINATE);
      expect(body, `${rel} slices a file by line index`).not.toMatch(BY_LINE_INDEX);
    }
  });
});

describe('11 · no test fixture is pinned to a date near today', () => {
  it('nothing here carries a date literal at all', () => {
    // #468's date-pinned fixture turned `main` red for everyone, and THE-324
    // left one four days out that would have failed SILENTLY. Nothing in this
    // ticket needs a date, so the honest guard is that none appears — and where
    // a suite does need one, `vi.useFakeTimers({ toFake: ['Date'] })` is the
    // repo's answer and `toFake` is load-bearing.
    const DATE = /\b20\d{2}-[01]\d-[0-3]\d\b/;
    for (const rel of OWN_FILES) {
      expect(stripComments(read(rel)), `${rel} pins a date literal`).not.toMatch(DATE);
    }
  });
});

/**
 * @see the note inside section 12 for why these are composed rather than spelt.
 *
 * ⚠️ EVERY fragment, not just the obvious one. A first version composed
 * `origin/main` and then wrote `HEAD~` as a literal two characters later, so
 * the guard matched its own definition and failed on the PR that added it.
 */
const j = (...parts: string[]) => parts.join('');
const GIT_SHELLOUT = new RegExp(`\\b${j('g', 'it')}\\s+(?:diff|log|show|rev-parse|${j('merge', '-base')}|status)\\b`);
const BRANCH_REF = new RegExp(`${j('orig', 'in')}/(?:main|master)|${j('HEA', 'D~')}|\\b${j('merge', '-base')}\\b`);

describe('12 · no guard in this PR asserts anything about the current branch’s diff', () => {
  it('nothing shells out to git, and nothing names a branch', () => {
    // #454 is a standing sweep and #482 found THE-315's own section 2 contained
    // exactly the thing it exists to forbid. A guard that reads the diff passes
    // on the PR that wrote it and means nothing afterwards.
    for (const rel of OWN_FILES) {
      const body = stripComments(read(rel));
      // ⚠️ ASSEMBLED FROM FRAGMENTS rather than written as a literal. A guard
      // that spells `origin/main` inside itself matches itself and fails on the
      // PR that introduces it — which is how a house rule gets quietly deleted
      // rather than kept. The fragments are proved to compose correctly by the
      // non-vacuity case below.
      expect(body, `${rel} shells out to git`).not.toMatch(GIT_SHELLOUT);
      expect(body, `${rel} names a branch`).not.toMatch(BRANCH_REF);
    }
  });

  it('and those patterns really do catch what they claim to', () => {
    // Non-vacuity. Without this, two regexes that compose to nothing would make
    // the case above pass on every file in the repo.
    expect(GIT_SHELLOUT.test(`execSync('${j('g', 'it')} diff --name-only')`)).toBe(true);
    expect(BRANCH_REF.test(j('orig', 'in/main'))).toBe(true);
    expect(BRANCH_REF.test(j('HEA', 'D~1'))).toBe(true);
    expect(BRANCH_REF.test(j('merge', '-base'))).toBe(true);
    expect(GIT_SHELLOUT.test('the digest of a file on disk')).toBe(false);
  });
});

describe('13 · no source file is in this ticket’s change', () => {
  it('everything it wrote is a test or a harness file', () => {
    // Asserted structurally, not from the diff (see 12): every file this ticket
    // owns lives under a test or test-support path, and the four repaired
    // suites are tests. A source change would have to appear as a path that is
    // neither.
    const TEST_OR_HARNESS = /^src\/(?:test\/|.*__tests__\/|.*__fixtures__\/)/;
    for (const rel of [...OWN_FILES, ...REPAIRED, ...NAMED_SUITES, HARNESS, STRIPPER]) {
      expect(rel, `${rel} is not a test or harness path`).toMatch(TEST_OR_HARNESS);
      expect(existsSync(path.join(ROOT, rel)), `${rel} does not exist`).toBe(true);
    }
    // And the file at the centre of Part 1 is UNTOUCHED by this ticket: the fix
    // was to the guards that read it, never to the code they guard.
    expect(read(INTEGRATIONS), 'IntegrationsSection.tsx carries a THE-352 edit').not.toContain('THE-352');
  });

  it('and writes LF, never CRLF', () => {
    for (const rel of [...OWN_FILES, ...REPAIRED, HARNESS]) {
      expect(read(rel).includes('\r\n'), `${rel} contains a CRLF line ending`).toBe(false);
    }
  });
});
