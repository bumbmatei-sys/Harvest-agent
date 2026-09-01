import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postcss from 'postcss';

import {
  auditPrimitives,
  extractClassNames,
  formatFindings,
  rel,
  type AuditResult,
  GLOBALS_CSS,
  EXEMPT,
  NOT_A_UTILITY,
  REPO_ROOT,
  SET_AT_RUNTIME,
  SET_BY_NEXT_FONT,
} from './ds-primitives.audit';

/**
 * THE-260 — the token guard tailwind.config.ts said existed.
 *
 * `tailwind.config.ts` cited this file by name as the thing that caught
 * `bg-surface-gold` producing no rule. It did not exist. Meanwhile eleven of
 * the thirteen primitives in this directory were spelling shadcn's default
 * tokens — `--primary`, `--foreground`, `--muted`, `--destructive`, `--ring`,
 * `--input`, `--radius`, `--secondary`, `--accent`, `--card`, `--popover`,
 * `--border` — none of which globals.css defines.
 *
 * A missing token does not error, does not warn and does not fail a build. It
 * produces no CSS and the component renders naked. src/components/ui/sonner.tsx
 * is the worked example: the shadcn defaults it inherited (`--popover`,
 * `--popover-foreground`, `--border`, `--radius`) each made their declaration
 * invalid at computed-value time, which drops it back to `unset` — a
 * transparent, borderless, square-cornered toast. Someone shipped that, saw it,
 * and hand-patched that one file.
 *
 * ── The quarantine, and its removal ────────────────────────────────────
 *
 * The guard below used to FAIL on purpose, quarantined with Vitest's
 * `it.fails` rather than `.skip`. The difference was the whole point:
 *
 *   • `.skip` is silent forever. Nothing ever tells anyone to remove it.
 *   • `it.fails` asserts the test still fails. The moment the last unresolved
 *     class is fixed and the guard would go green, `it.fails` turns RED —
 *     "expected test to fail" — and the suite cannot pass until the quarantine
 *     is deleted. The mechanism removes itself, and it cannot fire early:
 *     while anything is still unresolved the guard keeps failing as designed.
 *
 * It worked, and it is gone. THE-260 recorded 262 unresolved classes; the v4
 * migration cleared 152 v3-only spellings (`ring-3`, `data-open:`,
 * `outline-hidden`, `animate-in`), THE-263's token bridge cleared 110 missing
 * tokens (`bg-muted`, `text-primary-foreground`), and THE-264 cleared the last
 * two groups — `border-border`/`bg-border` (6 occurrences) and `font-heading`
 * (3), both by adding a theme key in globals.css rather than by editing a
 * component. `it.fails(` became `it(` in that PR, on the evidence of the guard
 * going green, and __fixtures__/unresolved-token-classes.txt is now empty.
 *
 * What is NOT cleared, and never will be: three classes that name a custom
 * property Base UI sets on the element at runtime. They are not tokens and no
 * stylesheet can define them — see SET_AT_RUNTIME in ds-primitives.audit.ts,
 * which holds them by exact name, and `every exemption is by name` below,
 * which proves the exclusion is not a pattern that would swallow a real bug.
 *
 * The fixture is kept, empty, rather than deleted: `matches the recorded
 * fixture` is what turns a newly-unresolved class into a reviewable diff
 * instead of a line of CI output, and that is worth more now than it was
 * while the list was long.
 */

const UI_DIR = path.join(REPO_ROOT, 'src/components/ui');
const FIXTURES = path.join(__dirname, '__fixtures__');

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The primitives: every .tsx directly in src/components/ui, read, not listed. */
const PRIMITIVES = readdirSync(UI_DIR)
  .filter((f) => f.endsWith('.tsx'))
  .sort()
  .map((f) => path.join(UI_DIR, f));

/** Every custom property globals.css defines, deduped and sorted. */
function globalsTokens(): string[] {
  const names = new Set<string>();
  postcss.parse(readFileSync(GLOBALS_CSS, 'utf8')).walkDecls((decl) => {
    if (decl.prop.startsWith('--')) names.add(decl.prop);
  });
  return [...names].sort();
}

let audit: AuditResult;

beforeAll(async () => {
  audit = await auditPrimitives(PRIMITIVES);
}, 120_000);

/* ── 1. The guard ──────────────────────────────────────────────────────── */

describe('the token guard', () => {
  /**
   * ✅ NO LONGER QUARANTINED — see the header. Every token class the thirteen
   * primitives spell now resolves, and the recorded list is empty. It is kept
   * as a fixture so the next class that stops resolving shows up as a diff.
   */
  it('every token class in src/components/ui resolves', () => {
    // One named line per unresolved class, naming its file. Not a count, and
    // not a single "something is missing" — a regression needs the names.
    expect(formatFindings(audit.findings)).toBe('');
  });

  it('holds back no stale exemption', () => {
    // EXEMPT is the guard's only hand-written list. Every entry that applies
    // to these files must still be genuinely unresolved, so an exemption
    // cannot outlive its reason and quietly hide a real token bug. This is
    // the check that keeps SET_AT_RUNTIME honest now that it, and not a
    // missing token, is the only thing standing between the guard and zero.
    const held = new Set(audit.exempted.map((f) => f.className));
    const spelled = new Set([...audit.classesByFile.values()].flat());
    for (const cls of Object.keys(EXEMPT)) {
      if (!spelled.has(cls)) continue;
      expect(held, `${cls} resolves now — drop it from EXEMPT`).toContain(cls);
    }
  });

  it('every exemption is held by name, and each name is still spelled', () => {
    // The exclusion that lets the guard reach zero has to be exact. A pattern
    // — "ignore any class naming an arbitrary property" — would also swallow
    // the next `w-(--sidebar-width)` that genuinely IS a token this app forgot
    // to define, which is the failure mode the guard exists to catch.
    //
    // Both halves are asserted: every key is a literal class name carrying no
    // wildcard, and every key is actually spelled by a primitive, so a name
    // cannot linger after the component that needed it is gone.
    const spelled = new Set([...audit.classesByFile.values()].flat());
    for (const [cls, reason] of Object.entries(EXEMPT)) {
      expect(cls, `${cls} is a pattern, not a name`).not.toMatch(/[*?]|\.\+|\\/);
      expect(spelled, `${cls} is exempted but no primitive spells it`).toContain(cls);
      expect(reason.length, `${cls} is exempted without a reason`).toBeGreaterThan(40);
    }

    // And the runtime three are exactly the runtime three.
    expect(Object.keys(SET_AT_RUNTIME).sort()).toEqual([
      'max-h-(--available-height)',
      'origin-(--transform-origin)',
      'w-(--anchor-width)',
    ]);
  });

  it('the next/font variables are really declared in layout.tsx', () => {
    // SET_BY_NEXT_FONT lets `font-heading`/`font-display` past the
    // undefined-var check. That is only sound while layout.tsx actually
    // declares them, so this reads the file rather than trusting the list —
    // and it reads it, it does not change it.
    const layout = readFileSync(path.join(REPO_ROOT, 'src/app/layout.tsx'), 'utf8');
    for (const [prop, reason] of Object.entries(SET_BY_NEXT_FONT)) {
      expect(layout, `${prop} is exempted but layout.tsx no longer declares it`).toContain(
        `variable: '${prop}'`,
      );
      expect(reason.length, `${prop} is exempted without a reason`).toBeGreaterThan(40);
    }
    // Exactly the three faces the app loads — a fourth has to be argued for.
    expect(Object.keys(SET_BY_NEXT_FONT).sort()).toEqual([
      '--font-display',
      '--font-sans',
      '--font-serif',
    ]);
  });

  it('an undefined font property that next/font does NOT set still fails', async () => {
    // The mutation: same shape as font-heading — a font-family naming a
    // custom property no stylesheet defines — but a property layout.tsx never
    // declares. If the exemption were `--font-*` this would pass silently.
    const file = fixturePrimitive(
      'export const F = () => <div className="font-[var(--font-nonexistent)]" />',
    );
    const { findings } = await auditPrimitives([file]);
    expect(findings).toContainEqual({
      file,
      className: 'font-[var(--font-nonexistent)]',
      reason: 'undefined-var',
      property: '--font-nonexistent',
    });
  }, 120_000);

  it('a class naming an undefined property that is NOT exempted still fails', async () => {
    // The mutation the by-name rule is written against: same shape as the Base
    // UI three — a utility taking an arbitrary custom property — but a name
    // nobody excluded. If the exclusion were a pattern, this would pass and
    // the guard would be blind to every future missing token of this shape.
    const file = fixturePrimitive(
      'export const F = () => <div className="w-(--anchor-width) w-(--sidebar-width)" />',
    );
    const { findings, exempted } = await auditPrimitives([file]);

    expect(findings).toContainEqual({
      file,
      className: 'w-(--sidebar-width)',
      reason: 'undefined-var',
      property: '--sidebar-width',
    });
    // …while its exempted twin is held back, not reported.
    expect(findings.map((f) => f.className)).not.toContain('w-(--anchor-width)');
    expect(exempted.map((f) => f.className)).toContain('w-(--anchor-width)');
  }, 120_000);

  it('resolved a non-trivial stylesheet, so the guard is not vacuous', () => {
    // A build that produced nothing would report every class as unresolved and
    // look like a very thorough guard. It is the failure mode this ticket names.
    expect(audit.generatedCount).toBeGreaterThan(200);
    for (const cls of ['flex', 'rounded-lg', 'bg-primary', 'text-muted', 'size-8', 'sr-only']) {
      expect(audit.findings.map((f) => f.className)).not.toContain(cls);
    }
  });
});

/* ── 2-4. The guard, proven ────────────────────────────────────────────── */

/** A throwaway primitive on disk. The guard reads files; so do these tests. */
function fixturePrimitive(body: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ds-primitives-'));
  const file = path.join(dir, 'fixture.tsx');
  writeFileSync(file, body, 'utf8');
  return file;
}

const FIXTURE = (extraVariant = '') => `
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const fixtureVariants = cva("inline-flex rounded-lg bg-nonexistent-token", {
  variants: {
    variant: {
      default: "text-earth",
      loud: "bg-cream ${extraVariant}",
    },
  },
  defaultVariants: { variant: "default" },
})

export function Fixture({ className }: { className?: string }) {
  return <div className={cn(fixtureVariants({ variant: "default" }), "rounded-[min(var(--totally-undefined-token),10px)] rounded-[min(var(--brand-color),10px)]", className)} />
}
`;

describe('the guard is proven, not assumed', () => {
  it('detects a planted undefined token', async () => {
    const file = fixturePrimitive(FIXTURE());
    const { findings } = await auditPrimitives([file]);

    // `bg-nonexistent-token` is a well-formed class name. Producing nothing is
    // the bug, and the guard has to name it and its file.
    expect(findings).toContainEqual({ file, className: 'bg-nonexistent-token', reason: 'no-rule' });

    // …and does not cry wolf on the classes beside it that do resolve.
    const named = findings.map((f) => f.className);
    expect(named).not.toContain('inline-flex');
    expect(named).not.toContain('rounded-lg');
    expect(named).not.toContain('bg-cream');
  });

  it('detects a var() naming an undefined custom property', async () => {
    const file = fixturePrimitive(FIXTURE());
    const { findings } = await auditPrimitives([file]);

    // The sonner failure mode: the class resolves to a real rule, and the rule
    // is dead because the property it names does not exist.
    expect(findings).toContainEqual({
      file,
      className: 'rounded-[min(var(--totally-undefined-token),10px)]',
      reason: 'undefined-var',
      property: '--totally-undefined-token',
    });

    // The control: same shape, a property globals.css does define.
    expect(findings.map((f) => f.className)).not.toContain(
      'rounded-[min(var(--brand-color),10px)]',
    );
  });

  it('reads classes from the real files, including every cva variant', async () => {
    const before = fixturePrimitive(FIXTURE());
    expect(extractClassNames(before)).not.toContain('bg-second-nonexistent-token');

    // Same shape, one class added inside a non-default cva variant — the place
    // a hand-written list would never see.
    const after = fixturePrimitive(FIXTURE('bg-second-nonexistent-token'));
    expect(extractClassNames(after)).toContain('bg-second-nonexistent-token');

    const { findings } = await auditPrimitives([after]);
    expect(findings).toContainEqual({
      file: after,
      className: 'bg-second-nonexistent-token',
      reason: 'no-rule',
    });

    // And the variant keys around it are not mistaken for classes.
    expect(extractClassNames(after)).not.toContain('default');
    expect(extractClassNames(after)).not.toContain('loud');
  });
});

/* ── The recorded failure list — Phase 2's specification ───────────────── */

describe('the unresolved list', () => {
  it('matches the recorded fixture', () => {
    const recorded = readFileSync(path.join(FIXTURES, 'unresolved-token-classes.txt'), 'utf8');
    // Shrinking this file is Phase 2 landing. Growing it means a primitive
    // gained a class that resolves to nothing — which is what happened here.
    expect(formatFindings(audit.findings)).toBe(recorded);
  });

  it('reads a stable number of classes out of each primitive', () => {
    // Pins the extractor against the pinned files below: same bytes in, same
    // classes out. An extractor that quietly stopped seeing a cva() block would
    // shrink these counts instead of silently reporting nothing to fix.
    const counts = Object.fromEntries(
      [...audit.classesByFile].map(([file, classes]) => [path.basename(file), classes.length]),
    );
    expect(counts).toEqual(
      JSON.parse(readFileSync(path.join(FIXTURES, 'primitive-class-counts.json'), 'utf8')),
    );
  });
});

/* ── 5-6. Pins: this PR moves no component and defines no token ────────── */

describe('the phases change nothing they audit', () => {
  it('no file under src/components/ui changed', () => {
    // Recorded into a fixture rather than diffed against `git show` at
    // assertion time: CI's checkout is the only history a test can rely on.
    const recorded: Record<string, string> = JSON.parse(
      readFileSync(path.join(FIXTURES, 'primitive-digests.json'), 'utf8'),
    );

    const actual = Object.fromEntries(
      PRIMITIVES.map((file) => [rel(file), sha256(readFileSync(file, 'utf8'))]),
    );

    // Set equality first, so a fourteenth primitive is a failure and not a
    // silently unchecked file.
    expect(Object.keys(actual).sort()).toEqual(Object.keys(recorded).sort());
    expect(actual).toEqual(recorded);
  });

  it('globals.css defines no new token', () => {
    const recorded = readFileSync(path.join(FIXTURES, 'globals-tokens.txt'), 'utf8');
    // This fixture is the ledger: every phase that adds a token re-records it,
    // and the diff names exactly what was added. THE-263 added the bridge;
    // THE-264 added --color-border and --font-heading and nothing else;
    // THE-267 added the sidebar family and its eight matching theme keys, and
    // nothing else — 16 lines, asserted by name in the test below so that
    // re-recording this fixture can never quietly carry something with it.
    expect(`${globalsTokens().join('\n')}\n`).toBe(recorded);
  });

  it('and the only thing THE-267 added to that ledger is the sidebar family', () => {
    // Re-recording a ledger fixture is the designed workflow, and it is also
    // the one moment a stray token can ride along unnoticed. So the DELTA is
    // pinned, not just the file: both halves of the bridge for eight tokens,
    // and nothing else.
    const expected = [
      '--sidebar',
      '--sidebar-accent',
      '--sidebar-accent-foreground',
      '--sidebar-border',
      '--sidebar-foreground',
      '--sidebar-primary',
      '--sidebar-primary-foreground',
      '--sidebar-ring',
    ];
    const tokens = globalsTokens();
    expect(tokens.filter((t) => /^--sidebar/.test(t)).sort()).toEqual(expected);
    // The @theme inline half. Without these `bg-sidebar` mints no rule.
    expect(tokens.filter((t) => /^--color-sidebar/.test(t)).sort())
      .toEqual(expected.map((t) => t.replace('--sidebar', '--color-sidebar')).sort());
  });

  it('tailwind.config.ts adds no colour, and no longer cites a file that is absent', () => {
    const config = readFileSync(path.join(REPO_ROOT, 'tailwind.config.ts'), 'utf8');
    // The config's own shape is pinned by the token list above plus this digest
    // of everything that is not a comment.
    //
    // THE-261 widened the normaliser by one step — comments are stripped as
    // before, and then whitespace is collapsed. It used to hash the code WITH
    // the blank lines the stripped comments left behind, so adding or removing
    // a comment line moved the digest even when not a character of code
    // changed. That made the digest unable to express the one claim the v4
    // migration most needed to make: that it rewrote this file's comments and
    // nothing else. It now expresses exactly that, and it is strictly harder to
    // satisfy by accident — reformatting no longer hides behind a re-record.
    const code = config
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    expect(sha256(code)).toBe(
      readFileSync(path.join(FIXTURES, 'tailwind-config-code.sha256'), 'utf8').trim(),
    );
    expect(config).toContain('ds-primitives.test.tsx');
  });
});
