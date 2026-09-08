import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

import { GLOBALS_CSS, REPO_ROOT } from '../test/support/tailwind-build';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

/**
 * THE-276 — the static guards: what this slice was not allowed to add.
 *
 * The rendered behaviour is covered in
 * `components/__tests__/the-276-dashboard-overview.test.tsx`. What is here is
 * the set of things that are only visible in the SOURCE — a hardcoded hex, an
 * inline style, a minted token, an edit to a file another ticket owns.
 *
 * ⚠️ Nothing here shells out to `git show`. Every baseline is a literal digest
 * or a literal value, computed once when this test was written and pinned. A
 * guard that re-derives its own baseline from the repository at assertion time
 * cannot fail: it would simply describe whatever it was handed.
 */

const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Every file this ticket adds or rewrites. The subject of every guard below. */
const NEW_FILES = [
  'src/components/AdminDashboardHome.tsx',
  'src/components/dashboard/dashboard-data.ts',
  'src/components/dashboard/analytics-permission.ts',
  'src/components/dashboard/useOverviewData.ts',
  'src/components/dashboard/DashboardTabs.tsx',
  'src/components/dashboard/OverviewTab.tsx',
  'src/components/dashboard/WidgetFrame.tsx',
  'src/components/dashboard/KpiCard.tsx',
  'src/components/dashboard/LiveNowStrip.tsx',
  'src/components/dashboard/TrendChart.tsx',
  'src/components/dashboard/GivingMix.tsx',
  'src/components/dashboard/FunnelChart.tsx',
  'src/components/dashboard/InsightFeed.tsx',
  // ⚠️ Added by THE-276-FIX. `ui/tabs.tsx` is a vendored primitive, but this
  // slice now MODIFIES it (twelve variant spellings — see its own header), so
  // it comes under the same bars as everything else here: no inline style, no
  // literal colour, no minted token. Its digest move is accounted for in the
  // seven pins that carry it, each with the reason named.
  'src/components/ui/tabs.tsx',
] as const;

/** Source with block and line comments stripped — the code, not the prose. */
function codeOf(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ═══ 5 · No inline style does what a class could ════════════════════════════ */

describe('no inline style does what a class could', () => {
  /**
   * The bar is ZERO, not "low".
   *
   * ⚠️ `AnalyticsAndRoles.tsx` carries 193 inline styles against 9 classNames,
   * which is why the design system cannot reach it: an inline style beats every
   * stylesheet rule, so a themed token can never override one. A budget above
   * zero here is a budget for the same drift, and this feature demonstrably
   * needs none — including the chart legend, whose per-slice swatch colour is
   * the one thing a class genuinely cannot express and which is therefore
   * delegated to the `chart` primitive that already owns it.
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

/* ═══ 4 · No emoji, at the source ════════════════════════════════════════════ */

describe('no emoji appears in the rendered output', () => {
  /**
   * The companion to the rendered sweep in the-276-dashboard-overview, and the
   * half that catches what rendering cannot.
   *
   * ⚠️ A rendered sweep only sees the branches a test happens to mount. Base UI
   * mounts one tab panel at a time, so an emoji in an unopened tab — or in an
   * error branch, or in a string a fixture never triggers — is invisible to it.
   * This reads the SOURCE, so every branch is covered whether it renders or not.
   *
   * 🔴 Comments are stripped first, deliberately. This repo's own house style
   * uses 🔴 and ⚠️ heavily in prose to mark the load-bearing notes, and those
   * are documentation, not UI. What is banned is an emoji that can reach a
   * screen: `lucide-react` is already imported by every file here.
   * `AnalyticsAndRoles.tsx` carries 7 emoji as UI (📋 🔍 📞 📍 ⚠️) with lucide
   * already imported beside them — the founder's "AI slop".
   */
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  it.each(NEW_FILES)('%s uses no emoji outside its comments', (file) => {
    const found = codeOf(file).match(EMOJI);
    expect(found, `${file} carries ${found?.[0]} in code`).toBeNull();
  });

  it('and every file that draws an icon draws it with lucide', () => {
    const drawing = NEW_FILES.filter((f) => /<[A-Z]\w*\s+aria-hidden/.test(codeOf(f)));
    expect(drawing.length).toBeGreaterThan(4);
    for (const file of drawing) expect(read(file), file).toMatch(/from 'lucide-react'/);
  });
});

/* ═══ 6a · No colour is hardcoded ════════════════════════════════════════════ */

describe('no colour is hardcoded', () => {
  /**
   * Four palettes ship, and Classic is the DEFAULT since #409. A literal is the
   * same colour in all four, so it is wrong in at least three.
   *
   * ⚠️ `AnalyticsAndRoles.tsx` carries 13 hardcoded hexes, including a `#7C3AED`
   * purple that belongs to no Harvest palette. That is the failure this pins.
   */
  it.each(NEW_FILES)('%s contains no hex literal', (file) => {
    const hexes = codeOf(file).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes, `${file} hardcodes ${hexes.join(', ')}`).toHaveLength(0);
  });

  it.each(NEW_FILES)('%s contains no rgb/hsl/oklch literal', (file) => {
    const fns = codeOf(file).match(/\b(?:rgba?|hsla?|oklch|lab)\s*\(/g) ?? [];
    expect(fns, `${file} hardcodes ${fns.join(', ')}`).toHaveLength(0);
  });

  /**
   * `color-mix()` is NOT banned — it is a way of DERIVING a colour, and one the
   * app already uses. What is banned is a `color-mix()` with a literal in it: a
   * mix of two tokens follows the palette, a mix of a token and a hex does not.
   *
   * ⚠️ The one occurrence in this slice is the Quick Actions hover border,
   * carried over unchanged from the screen this file replaces. Its
   * `var(--stone-200, #E8E2D9)` fallback was dropped: `--stone-200` is declared
   * in `:root` and always resolves, so the literal was dead weight that only
   * ever mattered if the token vanished — in which case a stale Harvest stone
   * on a Classic surface is the wrong answer anyway.
   */
  it.each(NEW_FILES)('%s mixes only tokens, never a literal', (file) => {
    for (const [mix] of codeOf(file).matchAll(/color-mix\([^)]*(?:\([^)]*\)[^)]*)*\)/g)) {
      expect(mix, `${file}: ${mix}`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      // Every colour argument goes through a token.
      const colourArgs = mix.split(',').slice(1);
      for (const arg of colourArgs) expect(arg, `${file}: ${mix}`).toMatch(/var\(--/);
    }
  });

  it('no raw Tailwind palette step is spelled either — every colour is a semantic token', () => {
    // `bg-sky-100` / `text-sky-700` are as fixed as a hex: the numbered ramps do
    // not move with the palette. The app's own semantic names (`text-muted`,
    // `bg-card`, `text-destructive`) do.
    const RAMP = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
    for (const file of NEW_FILES) {
      const hits = codeOf(file).match(RAMP) ?? [];
      expect(hits, `${file} spells ${hits.join(', ')}`).toHaveLength(0);
    }
  });

  it('every series colour is a --chart-N reference, and there are exactly five', () => {
    const mix = read('src/components/dashboard/GivingMix.tsx');
    const vars = [...mix.matchAll(/var\(--chart-(\d)\)/g)].map((m) => m[1]);
    expect([...new Set(vars)].sort()).toEqual(['1', '2', '3', '4', '5']);
  });
});

/* ═══ 7 · The chart tokens have not moved ════════════════════════════════════ */

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

/** The cascade, composed: Classic over Harvest, dark over light. */
const PALETTES: Record<string, Record<string, string>> = {
  'Harvest light': { ...rootVars },
  'Harvest dark': { ...rootVars, ...darkVars },
  'Classic light': { ...rootVars, ...classicLightVars },
  'Classic dark': { ...rootVars, ...darkVars, ...classicDarkVars },
};

/** Follow a `var()` chain to a literal within one palette. */
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

/**
 * The values #407 established, pinned as literals.
 *
 * ⚠️ Classic is IDENTICAL to Harvest here, and that is correct rather than a
 * copy-paste: `--chart-*` is deliberately not overridden in either Classic
 * block, because a series colour is a categorical data encoding and not surface
 * chrome. Re-hueing it per family would make the same data render differently
 * between families. Pinning both spellings is what makes a later "fix" to that
 * fall-through fail here.
 */
const CHART_TOKENS = {
  'Harvest light': ['#C9963A', '#4F97D6', '#6E8E52', '#D6CCBE', '#C8BCA9'],
  'Harvest dark': ['#E5B65C', '#6BA8DD', '#8CA96E', 'rgba(255, 255, 255, 0.30)', 'rgba(255, 255, 255, 0.28)'],
  'Classic light': ['#C9963A', '#4F97D6', '#6E8E52', '#D6CCBE', '#C8BCA9'],
  'Classic dark': ['#E5B65C', '#6BA8DD', '#8CA96E', 'rgba(255, 255, 255, 0.30)', 'rgba(255, 255, 255, 0.28)'],
} as const;

describe('--chart-1..5 still resolve to the same values', () => {
  it.each(Object.entries(CHART_TOKENS))('%s is unchanged', (name, expected) => {
    const scope = PALETTES[name];
    const actual = [1, 2, 3, 4, 5].map((i) => resolve(scope[`--chart-${i}`], scope));
    expect(actual).toEqual([...expected]);
  });

  it('all five are declared, in all four palettes, and none resolves to nothing', () => {
    for (const [name, scope] of Object.entries(PALETTES)) {
      for (let i = 1; i <= 5; i++) {
        expect(resolve(scope[`--chart-${i}`], scope), `${name} --chart-${i}`).toBeTruthy();
      }
    }
  });

  it('the day and night variants genuinely differ — the pin is not four copies', () => {
    expect(CHART_TOKENS['Harvest light']).not.toEqual(CHART_TOKENS['Harvest dark']);
    expect(CHART_TOKENS['Classic light']).not.toEqual(CHART_TOKENS['Classic dark']);
  });
});

/* ═══ 8 · No new token was defined ═══════════════════════════════════════════ */

describe('no new token was defined', () => {
  it('no file in this slice declares a custom property', () => {
    for (const file of NEW_FILES) {
      const declared = codeOf(file).match(/(?<![\w-])--[\w-]+\s*:/g) ?? [];
      expect(declared, `${file} declares ${declared.join(', ')}`).toHaveLength(0);
    }
  });

  /**
   * The stronger half: a token can also be "added" by REFERENCING one that does
   * not exist. `var(--dashboard-accent)` compiles, resolves to nothing, and
   * paints transparent — a token invented by use rather than by declaration.
   */
  it('every custom property these files reference already exists in globals.css', () => {
    const declared = new Set(Object.keys(rootVars));
    for (const map of [darkVars, classicLightVars, classicDarkVars]) {
      for (const key of Object.keys(map)) declared.add(key);
    }
    // Declared in the ramps block above :root, and in @theme inline.
    const globals = readFileSync(GLOBALS_CSS, 'utf8');

    for (const file of NEW_FILES) {
      for (const [, name] of codeOf(file).matchAll(/var\((--[\w-]+)/g)) {
        // ⚠️ `--color-<key>` is minted at RUNTIME by the chart primitive's
        // <ChartStyle>, scoped to one chart, from that chart's own config. It
        // is not a design token and cannot be declared in globals.css — the key
        // is a data series name. Every one of them resolves to a --chart-N.
        if (name.startsWith('--color-')) continue;
        expect(declared.has(name) || globals.includes(`${name}:`), `${file} references undeclared ${name}`).toBe(true);
      }
    }
  });

  it('and the chart tokens it leans on are declared by globals.css, not by this slice', () => {
    for (let i = 1; i <= 5; i++) expect(rootVars[`--chart-${i}`]).toBeTruthy();
  });
});

/* ═══ 11 · The files this ticket may not touch ═══════════════════════════════ */

/**
 * Digests taken from `origin/main` at 5e06c67 when this test was written.
 *
 * 🔴 `AdminDashboard.tsx` is THE-277's. The dashboard tab shell was built so
 * that it needs no edit there at all: `AdminDashboardHome`'s five props are
 * unchanged, so the call site at AdminDashboard.tsx:1099 is byte-identical.
 * `firestore.rules` and `functions/` are out of scope by instruction.
 */
/**
 * ⚠️ A SET per file, not a single digest, and #422 is why.
 *
 * The claim being made is "THIS TICKET does not edit these files" — but
 * `AdminDashboard.tsx` belongs to THE-277, which is actively editing it, and CI
 * runs against `refs/pull/N/merge`: the branch merged into `main` AS IT STANDS
 * WHEN THE RUN STARTS. So the file legitimately holds a different value on this
 * branch than on the merge ref, and a single pinned digest would fail for the
 * one reason it is not meant to detect — somebody else's landed work.
 *
 * Each accepted value is named with the commit that produced it. 🔴 A value
 * that is neither — i.e. this ticket editing the file — still fails, which is
 * the entire threat this guard exists for.
 */
const UNTOUCHED: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
  'src/components/AdminDashboard.tsx': [
    ['0d84be6d9b8a73fdfcddb4d1178b6a62ad8e74a1461553645fdd2558e2d7c4e7', 'main at 5e06c67, where this branch started'],
    ['722c5e4478be0a8508e7dff1232dd4c1f88cacdd502604f946f3134eb730d98c', 'main at d13c7d4 — THE-277 (#422) added the Signups nav entry'],
    // THE-291 removed the dead `onChangePlan` / `onCancelPlan` props from the
    // `<AdminSettings>` mount. Their implementations wrote `plan` and
    // `planStatus` onto `users/{uid}` from the browser SDK — the one thing the
    // money path forbids — and neither prop was ever called. Appended rather
    // than substituted: a value that is NEITHER still fails, which is the
    // threat this guard exists for.
    ['446f0bcb8ffa6accf4f80467b75a50023c1441937605b11e18aa01b53d8e53f8', 'main + THE-291 — the client-side plan write removed'],
    // 🔴 THE-326 — the Services nav entry. APPENDED, NEVER SUBSTITUTED: every
    // value above is still accepted, because CI runs against `refs/pull/N/merge`
    // and a merge ref cut before this ticket landed legitimately carries one of
    // them. A digest that is NEITHER — i.e. THIS slice editing the file — still
    // fails, which is the whole threat this guard exists for.
    //
    // ⚠️ THIS SLICE'S OWN CLAIM IS UNCHANGED: it does not edit AdminDashboard.
    // THE-326 does, and it must — the nav lives there and the ticket is "service
    // planning is buried inside Events, split it out". What it adds is the
    // `services` entry in `allTabs`, the same id in the MINISTRY group of BOTH
    // nav arrays, one arm on the render switch, and two imports. It introduces
    // no permission: the entry repeats Events' own
    // `navAllows(features?.eventRegistration) && (hasFullAccess ||
    // perms.manageEvents)`, so no tier's and no role's reach changes.
    ['69f7efceccd7b8381e5ceb114642f8b4634e73df1278bb082e678a1a0cb634f9', 'main + THE-326 — service planning split out of Events into its own section'],
    // 🔴 THE-327 — `'library'` added to the PLATFORM group of MORE_GROUPS and
    // the GROW group of DESKTOP_NAV_GROUPS. APPENDED, NEVER SUBSTITUTED: every
    // value above is still accepted, because CI runs against
    // `refs/pull/N/merge` and a merge ref cut before this ticket landed
    // legitimately carries one of them. A digest that is NEITHER — i.e. THIS
    // slice editing the file — still fails, which is the whole threat this
    // guard exists for.
    //
    // ⚠️ THIS SLICE'S OWN CLAIM IS UNCHANGED: it does not edit AdminDashboard.
    // THE-327 does, and it must — the founder reported the Library screen
    // deleted and it was not: the screen renders, the nav entry exists and
    // `admin-sections.ts` maps the slug, so `/admin/library` already resolved.
    // What was missing was any way to CLICK to it, because `'library'` was in
    // NEITHER group array and the desktop sidebar has no catch-all. It adds two
    // array entries and their reasons and nothing else — no permission, gate,
    // tab id, render arm or import changes, and the entry is still
    // `isSuperAdmin && { id: 'library' }`.
    ['decfdddbdab91094c936b503f931b663eeb6ba3048ee087c541fe1580f20e31e', 'main + THE-327 — the Library nav entry added to both group arrays'],
    // 🔴 THE-332 — the desktop nav became a RAIL. APPENDED, NEVER
    // SUBSTITUTED: every value above stays accepted, because CI runs against
    // `refs/pull/N/merge` and a merge ref cut before this ticket landed
    // legitimately carries one of them. A digest that is NEITHER — i.e. THIS
    // slice editing the file — still fails, which is the whole threat this
    // guard exists for.
    //
    // ⚠️ THIS SLICE'S OWN CLAIM IS UNCHANGED: it does not edit
    // AdminDashboard. THE-332 does, and it must — the nav lives there and the
    // ticket is "the sidebar shows all 24 tabs at once, make it a rail with
    // flyouts". What it changes is the DESKTOP column only: the four groups
    // became flyout triggers, Dashboard and Settings stayed pinned, and
    // `isSidebarCollapsed` / `collapsedGroups` went with the column they
    // collapsed. MORE_GROUPS and the mobile More sheet are byte-identical, and
    // no permission gate moved.
    ['508747ccbc7b2fef051d449626ef2f81f3655b214be0494c6c21a8c7df88b9bb', 'main + THE-332 — the desktop nav becomes a rail with flyouts'],
    // 🔴 APPENDED BY THE-334, nothing above removed or rewritten.
    ['8e4911fd3cc9755e4780f94ccd074908537477ad77267c78357131aa94885c6e', 'main + THE-334 — one flyout at a time; the panel takes ClickUp’s shape and Settings moves to the account menu'],
  ],
};

/** Every file under `functions/`, excluding build output and dependencies. */
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

describe('AdminDashboard.tsx, firestore.rules and functions/ byte-identical', () => {
  /**
   * 🔴 THE-325 · the accepted SET moved to `__fixtures__/ownership/`, the
   * ASSERTION stayed here. This suite still says what it always said: the
   * `firestore.rules` on disk is at a digest some ticket recorded, and so
   * THIS ticket did not touch a file that auto-deploys to production with no
   * emulator test in CI. Only the list of accepted values is now shared, so a
   * legitimate rules change is one new per-ticket record rather than 50 edits.
   */
  it('firestore.rules carries no edit from this ticket', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

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
    for (const file of NEW_FILES) {
      expect(codeOf(file), file).not.toMatch(/from\s+['"][^'"]*AdminDashboard['"]/);
      // THE-275's and THE-277's other files, for the same reason.
      // ⚠️ The pre-#422 spelling of `AdminRoles` is deliberately NOT listed
      // here. THE-277 sweeps the tree for anything that still RESOLVES to the
      // renamed module and counts a regex literal as a pointer — correctly, since
      // a stale path in a guard test fails silently rather than failing to
      // compile. The current names are what this ban is for.
      expect(codeOf(file), file)
        .not.toMatch(/from\s+['"][^'"]*(?:AdminDocs|AdminRoles|AdminSignups)['"]/);
    }
  });
});

/* ═══ Dependencies ═══════════════════════════════════════════════════════════ */

describe('no npm dependency was added', () => {
  it('recharts is the only charting library, and the map libraries are absent', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.recharts).toBeTruthy();
    // 🔴 The geo map is explicitly NOT in this slice: react-simple-maps plus a
    // ~100KB TopoJSON is a dependency decision, not a layout one.
    for (const absent of ['react-simple-maps', 'topojson-client', 'd3-geo', 'nivo', '@nivo/core', 'victory']) {
      expect(pkg.dependencies[absent], `${absent} was added`).toBeUndefined();
    }
  });

  it('no registry beyond the one already configured', () => {
    const components = JSON.parse(read('components.json')) as { registries?: Record<string, unknown> };
    expect(components.registries ?? {}).toEqual({});
  });
});
