import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

import { GLOBALS_CSS, REPO_ROOT } from '../test/support/tailwind-build';

/**
 * THE-283 — the static guards: what this slice was not allowed to add.
 *
 * The rendered behaviour is in `components/__tests__/the-283-growth-tab.test.tsx`
 * and the layout in `the-283-growth-layout.test.tsx`. What is here is the set of
 * things only visible in the SOURCE — a hardcoded hex, an inline style, a minted
 * token, a new dependency, an edit to a file another ticket owns.
 *
 * ⚠️ Nothing here shells out to `git show`. Every baseline is a literal digest
 * or a literal value, pinned when this test was written. A guard that re-derives
 * its own baseline from the repository at assertion time cannot fail — it just
 * describes whatever it was handed. (THE-276's guards say the same thing, and
 * the `MemberScreens.desktop-layout` test's `git show` is the counter-example:
 * it self-diagnoses a depth-1 clone because it has to.)
 */

const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Every file this ticket adds or modifies. The subject of every guard below. */
const TOUCHED_FILES = [
  'src/components/dashboard/growth-data.ts',
  'src/components/dashboard/useGrowthData.ts',
  'src/components/dashboard/LocationTable.tsx',
  'src/components/dashboard/GrowthTab.tsx',
  // Modified by this slice, so they come under the same bars.
  'src/components/dashboard/WidgetFrame.tsx',
  'src/components/dashboard/TrendChart.tsx',
  'src/components/dashboard/DashboardTabs.tsx',
  'src/components/AdminDashboardHome.tsx',
] as const;

/** Source with block and line comments stripped — the code, not the prose. */
function codeOf(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ═══ 10a · No inline style ══════════════════════════════════════════════════ */

describe('no emoji, no inline style, no hardcoded colour', () => {
  /**
   * The bar is ZERO. The dashboard files currently carry no inline style at all
   * and this slice keeps it there — an inline style out-ranks every stylesheet
   * rule, so a themed token can never override one, which is exactly why the
   * design system could never reach `AnalyticsAndRoles.tsx` and its 193 of them.
   */
  it.each(TOUCHED_FILES)('%s carries no style={{ … }} at all', (file) => {
    const inline = codeOf(file).match(/style=\{\{/g) ?? [];
    expect(inline, `${file} has ${inline.length} inline styles`).toHaveLength(0);
  });

  it('and no style attribute of any other shape either', () => {
    for (const file of TOUCHED_FILES) {
      expect(codeOf(file), file).not.toMatch(/\sstyle\s*=/);
      expect(codeOf(file), file).not.toMatch(/\.style\.[a-zA-Z]/);
      expect(codeOf(file), file).not.toMatch(/setProperty\(/);
    }
  });

  /* ═══ 10b · No emoji reaches a screen ═════════════════════════════════════ */

  /**
   * 🔴 Comments are stripped first. This repo's house style uses 🔴 and ⚠️
   * heavily in prose to mark the load-bearing notes, and those are documentation.
   * What is banned is an emoji that can reach a SCREEN — `lucide-react` is
   * already imported by every file here that draws an icon.
   */
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  it.each(TOUCHED_FILES)('%s uses no emoji outside its comments', (file) => {
    const found = codeOf(file).match(EMOJI);
    expect(found, `${file} carries ${found?.[0]} in code`).toBeNull();
  });

  it('every icon on the Growth tab is a lucide component', () => {
    for (const file of ['src/components/dashboard/GrowthTab.tsx', 'src/components/dashboard/LocationTable.tsx']) {
      expect(read(file), file).toMatch(/from 'lucide-react'/);
    }
  });

  /* ═══ 10c · No colour is hardcoded ════════════════════════════════════════ */

  it.each(TOUCHED_FILES)('%s contains no hex literal', (file) => {
    const hexes = codeOf(file).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes, `${file} hardcodes ${hexes.join(', ')}`).toHaveLength(0);
  });

  it.each(TOUCHED_FILES)('%s contains no rgb/hsl/oklch literal', (file) => {
    const fns = codeOf(file).match(/\b(?:rgba?|hsla?|oklch|lab)\s*\(/g) ?? [];
    expect(fns, `${file} hardcodes ${fns.join(', ')}`).toHaveLength(0);
  });

  it('no raw Tailwind palette step is spelled either — every colour is semantic', () => {
    // `bg-sky-100` is as fixed as a hex: the numbered ramps do not move with the
    // palette. Four palettes ship and Classic is the DEFAULT since #409, so a
    // literal is the same colour in all four and therefore wrong in at least three.
    const RAMP = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
    for (const file of TOUCHED_FILES) {
      const hits = codeOf(file).match(RAMP) ?? [];
      expect(hits, `${file} spells ${hits.join(', ')}`).toHaveLength(0);
    }
  });

  it('the Growth tab names no series colour of its own — it reuses CHART_VARS', () => {
    const growth = codeOf('src/components/dashboard/GrowthTab.tsx');
    expect(growth).toMatch(/CHART_VARS/);
    // No `var(--chart-N)` spelled directly: the five slots are declared once,
    // in GivingMix, and referenced by index everywhere else.
    expect(growth).not.toMatch(/var\(--chart-\d\)/);
  });
});

/* ═══ 10d · All four palettes resolve, Classic first ═════════════════════════ */

/** Custom properties declared by rules whose selector matches. */
function varsIn(selectorTest: (sel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(readFileSync(GLOBALS_CSS, 'utf8')).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((decl) => { if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim(); });
  });
  return out;
}

const rootVars = varsIn((s) => s === ':root');
const darkVars = varsIn((s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'));
const classicLightVars = varsIn((s) => s.includes('data-palette="classic"') && s.includes('data-theme="light"'));
const classicDarkVars = varsIn(
  (s) => s.includes('data-palette="classic"') && (s.includes('.dark') || s.includes('data-theme="dark"')),
);

/** 🔴 Classic FIRST — it is the default since #409, so it is the primary case. */
const PALETTES: Record<string, Record<string, string>> = {
  'Classic light': { ...rootVars, ...classicLightVars },
  'Classic dark': { ...rootVars, ...darkVars, ...classicDarkVars },
  'Harvest light': { ...rootVars },
  'Harvest dark': { ...rootVars, ...darkVars },
};

function resolve(value: string | undefined, scope: Record<string, string>, depth = 0): string | null {
  if (value === undefined || depth > 12) return null;
  const v = value.trim();
  const m = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/.exec(v);
  if (m) {
    const direct = scope[m[1]] !== undefined ? resolve(scope[m[1]], scope, depth + 1) : null;
    return direct ?? (m[2] ? resolve(m[2], scope, depth + 1) : null);
  }
  return v;
}

describe('all four palettes resolve every token this slice leans on', () => {
  /**
   * The semantic tokens the two new widgets actually reference, via the
   * `ui/table`, `ui/card` and `ui/empty` primitives and their own classes.
   */
  const USED = ['--muted-foreground', '--foreground', '--card', '--card-foreground', '--border', '--muted'] as const;

  it.each(Object.entries(PALETTES))('%s resolves each of them to a real value', (name, scope) => {
    for (const token of USED) {
      expect(resolve(scope[token], scope), `${name} ${token}`).toBeTruthy();
    }
  });

  it('and --chart-2, the one series colour the growth trend plots, in all four', () => {
    for (const [name, scope] of Object.entries(PALETTES)) {
      expect(resolve(scope['--chart-2'], scope), `${name} --chart-2`).toBeTruthy();
    }
  });

  it('Classic is genuinely distinct from Harvest — the four are not two copies', () => {
    expect(resolve(PALETTES['Classic light']['--background'], PALETTES['Classic light']))
      .not.toBe(resolve(PALETTES['Harvest light']['--background'], PALETTES['Harvest light']));
  });
});

/* ═══ 11 · No new token was defined ══════════════════════════════════════════ */

describe('no new token was defined', () => {
  it('no file in this slice declares a custom property', () => {
    for (const file of TOUCHED_FILES) {
      const declared = codeOf(file).match(/(?<![\w-])--[\w-]+\s*:/g) ?? [];
      expect(declared, `${file} declares ${declared.join(', ')}`).toHaveLength(0);
    }
  });

  /**
   * The stronger half: a token can also be "added" by REFERENCING one that does
   * not exist. `var(--growth-accent)` compiles, resolves to nothing and paints
   * transparent — a token invented by use rather than by declaration.
   */
  it('every custom property these files reference already exists in globals.css', () => {
    const declared = new Set(Object.keys(rootVars));
    for (const map of [darkVars, classicLightVars, classicDarkVars]) {
      for (const key of Object.keys(map)) declared.add(key);
    }
    const globals = readFileSync(GLOBALS_CSS, 'utf8');

    for (const file of TOUCHED_FILES) {
      for (const [, name] of codeOf(file).matchAll(/var\((--[\w-]+)/g)) {
        // `--color-<key>` is minted at RUNTIME by the chart primitive, scoped to
        // one chart, from that chart's own config. Not a design token.
        if (name.startsWith('--color-')) continue;
        expect(declared.has(name) || globals.includes(`${name}:`), `${file} references undeclared ${name}`).toBe(true);
      }
    }
  });

  it('the bridge has held with zero additions, and this slice adds none', () => {
    // The count of `--chart-N` slots is the one that would move if a widget
    // needed a sixth series colour. It does not: the growth trend plots one.
    expect(rootVars['--chart-5']).toBeTruthy();
    expect(rootVars['--chart-6']).toBeUndefined();
  });
});

/* ═══ 12 · The files this ticket may not touch ═══════════════════════════════ */

/**
 * 🔴 `AdminDashboard.tsx` is THE-277's. THE-276's design keeps it untouched:
 * `AdminDashboardHome`'s five props are unchanged by this slice too, so the call
 * site never needs editing and this slice preserves that property.
 * `firestore.rules`, `firestore.indexes.json` and `functions/` are out of scope
 * by instruction — and `firestore.indexes.json` matters twice over, because it
 * DOES NOT DEPLOY ON MERGE, so an index added here would silently reject in
 * production. Every query this slice issues is a single equality, served by the
 * automatic single-field index every collection already has.
 *
 * ⚠️ A SET per file, not a single digest, for THE-276's reason: CI runs against
 * `refs/pull/N/merge`, so a file another ticket legitimately lands on `main`
 * holds a different value there than on this branch. A value that is NEITHER —
 * i.e. this ticket editing the file — still fails, which is the whole threat.
 */
const UNTOUCHED: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
  'src/components/AdminDashboard.tsx': [
    ['722c5e4478be0a8508e7dff1232dd4c1f88cacdd502604f946f3134eb730d98c', 'main at 625e3eb, where this branch started'],
    // THE-291 removed the dead `onChangePlan` / `onCancelPlan` props from the
    // `<AdminSettings>` mount — a client-side `plan` write that no caller ever
    // reached. This slice's own claim is unchanged: it does not edit the file.
    ['446f0bcb8ffa6accf4f80467b75a50023c1441937605b11e18aa01b53d8e53f8', 'main + THE-291 — the client-side plan write removed'],
  ],
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
  'firestore.indexes.json': [
    ['8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0', 'main at 625e3eb'],
  ],
};

function functionsTree(): string[] {
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
  return out.sort();
}

describe('AdminDashboard.tsx, firestore.rules, firestore.indexes.json and functions/ byte-identical', () => {
  it.each(Object.entries(UNTOUCHED))('%s carries no edit from this ticket', (file, accepted) => {
    const actual = sha256(readFileSync(path.join(REPO_ROOT, file)));
    const match = accepted.find(([digest]) => digest === actual);
    expect(
      match,
      `${file} is at ${actual}, which is none of:\n  ` +
        accepted.map(([d, why]) => `${d} (${why})`).join('\n  '),
    ).toBeTruthy();
  });

  it('functions/ is unchanged, file for file', () => {
    const files = functionsTree();
    expect(files).toHaveLength(5);
    const tree = sha256(files.map((f) => `${f}:${sha256(readFileSync(path.join(REPO_ROOT, f)))}`).join('\n'));
    expect(tree).toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });

  it('nothing in this slice imports the shell it may not open', () => {
    for (const file of TOUCHED_FILES) {
      expect(codeOf(file), file).not.toMatch(/from\s+['"][^'"]*AdminDashboard['"]/);
      expect(codeOf(file), file)
        .not.toMatch(/from\s+['"][^'"]*(?:AdminDocs|AdminRoles|AdminSignups)['"]/);
    }
  });

  it('and no query it builds carries an orderBy or a composite constraint', () => {
    /*
     * 🔴 `users` has NO (tenantId, createdAt) composite index, and this repo
     * avoids composite indexes by design — `firestore.indexes.json` does not
     * deploy on merge, so adding one would reject in production silently. An
     * `orderBy` beside the tenant equality would throw `failed-precondition` at
     * runtime, which is a crash the test suite would not see.
     */
    for (const file of ['src/components/dashboard/growth-data.ts', 'src/components/dashboard/useGrowthData.ts']) {
      expect(codeOf(file), file).not.toMatch(/orderBy/);
    }
    // And the completeness proof is what stands in for ordering.
    expect(codeOf('src/components/dashboard/useGrowthData.ts')).toMatch(/completeRead/);
  });
});

/* ═══ Dependencies ═══════════════════════════════════════════════════════════ */

describe('no npm dependency was added', () => {
  it('@tanstack/react-table was NOT installed for the countries table', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    /*
     * 🔴 A plain table needs no table library. `@tanstack/react-table` buys
     * INTERACTIVE sorting and filtering — a header a reader can click — and the
     * countries list is sorted once, in plain JavaScript, over an array already
     * entirely in memory. Wanting a clickable header later is a dependency
     * decision to report, not one to take silently inside a layout ticket.
     */
    for (const absent of ['@tanstack/react-table', '@tanstack/table-core']) {
      expect(pkg.dependencies[absent], `${absent} was added`).toBeUndefined();
      expect(pkg.devDependencies?.[absent], `${absent} was added as a devDependency`).toBeUndefined();
    }
  });

  it('and the geo map libraries are still absent — the map is deferred, not built', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    for (const absent of ['react-simple-maps', 'topojson-client', 'd3-geo', 'nivo', '@nivo/core', 'victory']) {
      expect(pkg.dependencies[absent], `${absent} was added`).toBeUndefined();
    }
    expect(pkg.dependencies.recharts, 'recharts is still the only charting library').toBeTruthy();
  });

  it('no Playwright, either — layout is measured over CDP with Node builtins', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const absent of ['playwright', '@playwright/test', 'puppeteer']) {
      expect(pkg.dependencies[absent], `${absent} was added`).toBeUndefined();
      expect(pkg.devDependencies?.[absent], `${absent} was added`).toBeUndefined();
    }
  });

  it('no registry beyond the one already configured', () => {
    const components = JSON.parse(read('components.json')) as { registries?: Record<string, unknown> };
    expect(components.registries ?? {}).toEqual({});
  });
});
