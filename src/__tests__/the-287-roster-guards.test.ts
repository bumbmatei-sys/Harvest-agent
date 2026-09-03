import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

import { GLOBALS_CSS, REPO_ROOT } from '../test/support/tailwind-build';

/**
 * THE-287 — the static guards: what this slice was not allowed to add.
 *
 * The rendered behaviour lives in
 * `components/__tests__/the-287-dashboard-roster.test.tsx` and the measured
 * layout in `the-287-roster-layout.test.tsx`. What is here is the set of things
 * only the SOURCE can show — a minted token, an inline style, a hardcoded
 * colour, a Firestore `orderBy`, an edit to a file this ticket may not touch.
 *
 * ⚠️ Nothing here shells out to `git show`. Every baseline is a literal digest
 * computed once and pinned. A guard that re-derives its own baseline from the
 * repository at assertion time cannot fail — it would simply describe whatever
 * it was handed.
 */

const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Every file this ticket adds or rewrites. The subject of every guard below. */
const NEW_FILES = [
  'src/components/dashboard/roster-data.ts',
  'src/components/dashboard/CountriesTable.tsx',
  'src/components/dashboard/TopGivers.tsx',
  'src/components/dashboard/GrowthTab.tsx',
  'src/components/dashboard/GivingTab.tsx',
  // Rewritten rather than added — the shell's one slot became a map, and the
  // read layer grew the roster block. Both come under the same bars.
  'src/components/dashboard/DashboardTabs.tsx',
  'src/components/dashboard/useOverviewData.ts',
  'src/components/AdminDashboardHome.tsx',
] as const;

/** Source with block and line comments stripped — the code, not the prose. */
function codeOf(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ═══ 1 · No inline style, no emoji ══════════════════════════════════════════ */

describe('no inline style does what a class could', () => {
  /**
   * The bar is ZERO, not "low", and the dashboard directory is currently at
   * zero. An inline style out-ranks every stylesheet rule, so a themed token
   * can never override one — which is why `AnalyticsAndRoles.tsx`'s 193 of them
   * put that screen permanently outside the design system.
   */
  it.each(NEW_FILES)('%s carries no style={{ … }} at all', (file) => {
    const inline = codeOf(file).match(/style=\{\{/g) ?? [];
    expect(inline, `${file} has ${inline.length} inline styles`).toHaveLength(0);
  });

  it('and no style attribute of any other shape either', () => {
    for (const file of NEW_FILES) {
      expect(codeOf(file), file).not.toMatch(/\sstyle\s*=/);
      expect(codeOf(file), file).not.toMatch(/\.style\.[a-zA-Z]/);
      expect(codeOf(file), file).not.toMatch(/setProperty\(/);
    }
  });
});

describe('no emoji reaches the screen', () => {
  /**
   * 🔴 Comments are stripped first. This repo's house style uses 🔴 and ⚠️
   * heavily in prose to mark load-bearing notes; those are documentation. What
   * is banned is an emoji that can reach a screen, on files that already import
   * `lucide-react` beside it.
   */
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  it.each(NEW_FILES)('%s uses no emoji outside its comments', (file) => {
    const found = codeOf(file).match(EMOJI);
    expect(found, `${file} carries ${found?.[0]} in code`).toBeNull();
  });

  it('and both new widgets draw their icon with lucide', () => {
    for (const file of ['src/components/dashboard/CountriesTable.tsx', 'src/components/dashboard/TopGivers.tsx']) {
      expect(read(file), file).toMatch(/from 'lucide-react'/);
    }
  });
});

/* ═══ 2 · No colour is hardcoded ═════════════════════════════════════════════ */

describe('no colour is hardcoded', () => {
  it.each(NEW_FILES)('%s contains no hex literal', (file) => {
    const hexes = codeOf(file).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes, `${file} hardcodes ${hexes.join(', ')}`).toHaveLength(0);
  });

  it.each(NEW_FILES)('%s contains no rgb/hsl/oklch literal', (file) => {
    const fns = codeOf(file).match(/\b(?:rgba?|hsla?|oklch|lab)\s*\(/g) ?? [];
    expect(fns, `${file} hardcodes ${fns.join(', ')}`).toHaveLength(0);
  });

  it('no raw Tailwind palette step is spelled either — every colour is a semantic token', () => {
    // `bg-sky-100` is as fixed as a hex: the numbered ramps do not move with
    // the palette, and four palettes ship with Classic the default since #409.
    const RAMP = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
    for (const file of NEW_FILES) {
      const hits = codeOf(file).match(RAMP) ?? [];
      expect(hits, `${file} spells ${hits.join(', ')}`).toHaveLength(0);
    }
  });

  it('the funnel on Growth takes a --chart-N reference, never a literal', () => {
    const growth = codeOf('src/components/dashboard/GrowthTab.tsx');
    // It reuses GivingMix's CHART_VARS rather than spelling a colour at all.
    expect(growth).toMatch(/CHART_VARS\[\d\]/);
    expect(growth).not.toMatch(/var\(--chart-\d\)/);
  });
});

/* ═══ 3 · No new token was defined ═══════════════════════════════════════════ */

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

describe('no new token was defined', () => {
  /**
   * ⚠️ The bridge has held with zero additions through #410, #416, #417, #419
   * and THE-276. This slice adds none either: the two tables are written in
   * `text-foreground` / `text-muted-foreground` / `bg-muted` and the funnel
   * reuses `--chart-3`.
   */
  it('no file in this slice declares a custom property', () => {
    for (const file of NEW_FILES) {
      const declared = codeOf(file).match(/(?<![\w-])--[\w-]+\s*:/g) ?? [];
      expect(declared, `${file} declares ${declared.join(', ')}`).toHaveLength(0);
    }
  });

  /**
   * The stronger half: a token can also be "added" by REFERENCING one that does
   * not exist. `var(--roster-accent)` compiles, resolves to nothing and paints
   * transparent — a token invented by use rather than by declaration.
   */
  it('every custom property these files reference already exists in globals.css', () => {
    const declared = new Set(Object.keys(rootVars));
    for (const map of [darkVars, classicLightVars, classicDarkVars]) {
      for (const key of Object.keys(map)) declared.add(key);
    }
    const globals = readFileSync(GLOBALS_CSS, 'utf8');

    for (const file of NEW_FILES) {
      for (const [, name] of codeOf(file).matchAll(/var\((--[\w-]+)/g)) {
        // `--color-<key>` is minted at RUNTIME by the chart primitive, scoped
        // to one chart, from that chart's own config — not a design token.
        if (name.startsWith('--color-')) continue;
        expect(declared.has(name) || globals.includes(`${name}:`), `${file} references undeclared ${name}`).toBe(true);
      }
    }
  });

  /**
   * ⚠️ The guard also has to name what it deliberately does NOT flag. #421
   * recorded `--chart-4` / `--chart-5` at 1.50:1 and 1.77:1 on light and
   * `progress`'s `bg-primary` on `bg-muted` at 2.30:1, in both directions,
   * as known and accepted. This slice paints neither: it adopts `table`, not
   * `progress`, and its one chart takes `--chart-3`.
   */
  it('and it uses neither of the two recorded low-contrast pairs', () => {
    for (const file of NEW_FILES) {
      expect(codeOf(file), `${file} draws in --chart-4 or --chart-5`).not.toMatch(/--chart-[45]/);
      expect(codeOf(file), `${file} adopted progress`).not.toMatch(/\/ui\/progress/);
    }
  });
});

/* ═══ 4 · 🔴 No Firestore ordering, and no index was declared for one ════════ */

describe('nothing sorts with a Firestore orderBy', () => {
  /**
   * 🔴 Two reasons, both established, and the second is why declaring an index
   * would not rescue the first:
   *
   *   • `users` and `contacts` carry no (tenantId, createdAt) composite index.
   *   • `firestore.indexes.json` does NOT deploy on merge. `deploy-rules.yml`
   *     runs `firebase deploy --only firestore:rules,storage`, and its `paths:`
   *     filter does not include the indexes file. A new index declared there is
   *     inert, so the query throws `failed-precondition` in production.
   */
  const DASHBOARD_DIR = path.join(REPO_ROOT, 'src/components/dashboard');

  it('no file in the dashboard directory imports or calls orderBy', () => {
    for (const entry of readdirSync(DASHBOARD_DIR)) {
      const source = codeOf(path.join('src/components/dashboard', entry));
      expect(source, `${entry} calls orderBy`).not.toMatch(/\borderBy\s*\(/);
      expect(source, `${entry} imports orderBy`).not.toMatch(/\borderBy\b[^(]*from ['"]firebase\/firestore['"]/);
    }
  });

  it('and the deploy workflow still does not carry the indexes file', () => {
    const workflow = read('.github/workflows/deploy-rules.yml');
    expect(workflow).toMatch(/firestore:rules/);
    // The premise, asserted rather than assumed. If this ever changes, the
    // reasoning above has to be revisited before an index is relied on.
    expect(workflow, 'deploy-rules.yml now deploys indexes').not.toMatch(/firestore:indexes/);
  });

  it('@tanstack/react-table was still not added — a complete set sorts with Array.sort', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>; devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@tanstack/react-table']).toBeUndefined();
    expect(pkg.devDependencies['@tanstack/react-table']).toBeUndefined();
  });

  it('no npm dependency was added at all', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    for (const absent of ['react-simple-maps', 'topojson-client', 'd3-geo', 'nivo', '@nivo/core', 'victory', 'playwright', '@playwright/test']) {
      expect(pkg.dependencies[absent], `${absent} was added`).toBeUndefined();
    }
  });
});

/* ═══ 5 · Dollars and cents never meet ═══════════════════════════════════════ */

describe('totalDonated is read as dollars and invoice cents never enter this slice', () => {
  it('nothing on the giving path divides or multiplies by 100', () => {
    for (const file of ['src/components/dashboard/TopGivers.tsx', 'src/components/dashboard/roster-data.ts']) {
      expect(codeOf(file), `${file} scales a money value by 100`).not.toMatch(/[/*]\s*100\b/);
    }
  });

  it('and neither reads an invoice amount', () => {
    for (const file of [
      'src/components/dashboard/TopGivers.tsx',
      'src/components/dashboard/roster-data.ts',
      'src/components/dashboard/GivingTab.tsx',
    ]) {
      expect(codeOf(file), `${file} reads invoice cents`).not.toMatch(/amountCents|invoicesQuery|ReadableReceipt/);
    }
  });

  it('the strict money gate is still in place, unweakened', () => {
    const data = codeOf('src/components/dashboard/dashboard-data.ts');
    // #421 caught `amount ?? 0` here. The refusal, and the count it names.
    expect(data).toMatch(/typeof data\.amount === 'number' \? data\.amount : null/);
    expect(data).toMatch(/if \(bad > 0\) return unavailable\(REASON\.unreadableReceipts\(bad, rows\.length\)\)/);
  });
});

/* ═══ 6 · The files this ticket may not touch ════════════════════════════════ */

/**
 * ⚠️ A SET per file, not a single digest, for #422's reason: CI runs against
 * `refs/pull/N/merge`, so a file another live ticket owns legitimately holds a
 * different value on the merge ref than on this branch. Each accepted value is
 * named with the commit that produced it. 🔴 A value that is neither — i.e.
 * THIS ticket editing the file — still fails, which is the whole threat.
 */
const UNTOUCHED: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
  'src/components/AdminDashboard.tsx': [
    ['722c5e4478be0a8508e7dff1232dd4c1f88cacdd502604f946f3134eb730d98c', 'main at 625e3eb, where this branch started'],
  ],
  'firestore.rules': [
    ['a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499', 'unchanged since 5e06c67'],
  ],
  'firestore.indexes.json': [
    ['8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0', 'main at 625e3eb — no index was added for a sort this slice does not make'],
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

  it('nothing in this slice imports a screen another ticket owns', () => {
    for (const file of NEW_FILES) {
      expect(codeOf(file), file).not.toMatch(/from\s+['"][^'"]*AdminDashboard['"]/);
      expect(codeOf(file), file)
        .not.toMatch(/from\s+['"][^'"]*(?:AdminDocs|AdminRoles|AdminSignups|AdminCheckin|AdminSettings|Profile)['"]/);
      // THE-286's and THE-288's directories, for the same reason.
      expect(codeOf(file), file).not.toMatch(/from\s+['"][^'"]*\/settings\//);
    }
  });
});

/* ═══ 7 · The stage vocabulary is the app's, not this ticket's ═══════════════ */

describe('the funnel derives its stages rather than inventing them', () => {
  it('roster-data imports resolvePipelineStage and compares no threshold inline', () => {
    const source = codeOf('src/components/dashboard/roster-data.ts');
    expect(source).toMatch(/import \{ resolvePipelineStage/);
    // 🔴 Nothing here re-spells $10,000. The one definition lives in
    // useCRMQueries as CHAMPION_THRESHOLD_DOLLARS and is called, not copied.
    expect(source).not.toMatch(/\b10000\b/);
  });

  it('and no file in this slice reads a stored `stage` field', () => {
    // A stored stage is a second copy of a fact `totalDonated` already holds,
    // and duplicated facts drift — see the PipelineStage doc in useCRMQueries.
    for (const file of NEW_FILES) {
      expect(codeOf(file), file).not.toMatch(/\bdata\.stage\b|\.stage\s*===\s*['"]/);
    }
  });
});
