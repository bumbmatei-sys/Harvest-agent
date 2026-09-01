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
  NOT_A_UTILITY,
  REPO_ROOT,
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
 * ── The quarantine ─────────────────────────────────────────────────────
 *
 * The guard below FAILS TODAY, on purpose, and is quarantined with Vitest's
 * `it.fails` rather than `.skip`. The difference is the whole point:
 *
 *   • `.skip` is silent forever. Nothing ever tells anyone to remove it.
 *   • `it.fails` asserts the test still fails. The moment the last unresolved
 *     class is fixed and the guard would go green, `it.fails` turns RED —
 *     "expected test to fail" — and the suite cannot pass until the quarantine
 *     is deleted. The mechanism removes itself, and it cannot fire early:
 *     while anything is still unresolved the guard keeps failing as designed.
 *
 * REMOVING THE QUARANTINE is one edit: `it.fails(` → `it(`, plus re-recording
 * __fixtures__/unresolved-token-classes.txt, which by then is empty. Nothing
 * else here moves.
 *
 * That takes two PRs, because the 262 unresolved classes are two different
 * bugs. 110 are missing tokens (`bg-muted`, `text-primary-foreground`,
 * `ring-foreground/10`) and are Phase 2's. 152 are Tailwind v4 spellings this
 * app's Tailwind 3.4.1 has no rule for (`ring-3`, `data-open:`, `outline-hidden`,
 * `size-3!`, `animate-in`) and are Phase 1's — the v4 migration. The list below
 * does not sort them; it reports what does not resolve, which is the truth
 * either way. The split is in the PR description.
 *
 * This PR changes no component, defines no token and moves no dependency —
 * tests 5 and 6 pin exactly that.
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
   * ⚠️ QUARANTINED — see the header. This currently fails with 262 named
   * classes across 11 of the 13 primitives; that list is the specification for
   * Phase 2 and is recorded in __fixtures__/unresolved-token-classes.txt so it
   * is reviewable in the diff rather than only in CI output.
   */
  it.fails('every token class in src/components/ui resolves', () => {
    // One named line per unresolved class, naming its file. Not a count, and
    // not a single "something is missing" — Phase 2 needs the names.
    expect(formatFindings(audit.findings)).toBe('');
  });

  it('holds back no stale exemption', () => {
    // NOT_A_UTILITY is the guard's only hand-written list. Every entry that
    // applies to these files must still be genuinely unresolved, so an
    // exemption cannot outlive its reason and quietly hide a real token bug.
    const held = new Set(audit.exempted.map((f) => f.className));
    const spelled = new Set([...audit.classesByFile.values()].flat());
    for (const cls of Object.keys(NOT_A_UTILITY)) {
      if (!spelled.has(cls)) continue;
      expect(held, `${cls} resolves now — drop it from NOT_A_UTILITY`).toContain(cls);
    }
  });

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

describe('THE-260 changes nothing it audits', () => {
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
    // Phase 2 is where this file grows. Until then any addition is out of scope
    // for THE-260, and the diff of this fixture names exactly what was added.
    expect(`${globalsTokens().join('\n')}\n`).toBe(recorded);
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
