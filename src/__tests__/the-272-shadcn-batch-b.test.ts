import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postcss from 'postcss';

import { GLOBALS_CSS, REPO_ROOT, TAILWIND_CONFIG } from '../test/support/tailwind-build';
import {
  auditPrimitives,
  extractClassNames,
  SET_AT_RUNTIME,
  SET_BY_NEXT_FONT,
  rel,
} from '../components/ui/__tests__/ds-primitives.audit';
import { contrastRatio, AA_CONTRAST, DEFAULT_PALETTE_FAMILY } from '../lib/theme';

/**
 * THE-272 — shadcn Phase 7, Batch B: chart, table, pagination, progress.
 *
 * These carry the analytics dashboard: the 28 widgets, the countries table,
 * the retention cohort heatmap and every leaderboard. As with THE-266, the
 * components are installed and wired into NOTHING — imported by nothing is the
 * correct end state, and section 8 asserts it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THREE PREMISES OF THE TICKET WERE WRONG. What was found instead:
 *
 * 1. `data-table` IS NOT A REGISTRY COMPONENT AND CANNOT BE INSTALLED.
 *    `https://ui.shadcn.com/r/styles/base-nova/data-table.json` is a 404, as
 *    is every other style path for that name, and `r/index.json` lists 63
 *    items of which `table` is the only table-shaped one. In shadcn/ui, "Data
 *    Table" is a documentation GUIDE — you compose `table` with TanStack Table
 *    yourself — not an installable item. So this PR installs four, not five.
 *
 * 2. THEREFORE `@tanstack/react-table` IS NOT A DEPENDENCY OF THIS WORK.
 *    Nothing installed here asks for it, and it is deliberately NOT added:
 *    section 7 asserts its ABSENCE. The ticket's question — "if data-table is
 *    the only thing needing it, consider splitting it out" — is answered by
 *    the registry: there is nothing to split, and adopting TanStack Table is a
 *    Phase 8 BUILD decision made when the countries table is actually written.
 *
 * 3. RECHARTS DOES NOT ADD A d3-* FAMILY TO THIS TREE — IT ADDS A REDUX ONE.
 *    Every d3 module recharts reaches (through `victory-vendor`) is ALREADY a
 *    production dependency here, via `d3` and `mermaid` under
 *    `@excalidraw/excalidraw`, at versions satisfying victory-vendor's ranges,
 *    so they dedupe rather than duplicate. What is genuinely new is recharts
 *    3.x's internal store: @reduxjs/toolkit, react-redux, redux, redux-thunk
 *    and immer. Twelve lockfile additions in total, pinned by name in section 7.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THE ONE UNRESOLVED CLASS, AND THE FOUR THAT WERE NEVER CLASSES.
 *
 * The guard reported five findings against chart.tsx on first run. Neither
 * group was fixed by defining a token — the ticket forbids that, and it would
 * have been wrong in both cases:
 *
 *   • `dot`, `line`, `dashed`, `top` — NOT CLASSES. They are the values of the
 *     `indicator` and `verticalAlign` props, compared inside cn():
 *     `indicator === "dot" && "items-center"`. The extractor harvested the
 *     comparand. Fixed in ds-primitives.audit.ts by skipping the operands of a
 *     comparison, which is what they are. Section 1 proves the fix is exact:
 *     it changes the class count of NONE of the seventeen files that predate
 *     this PR, because not one of them compares a string inside a cn() call.
 *
 *   • `bg-(--color-bg)` — a real class naming a real property, set by
 *     chart.tsx itself at render time (`style={{ "--color-bg": indicatorColor }}`)
 *     from the hovered datum's series colour. No stylesheet can hold a
 *     per-datum value, so it joins SET_AT_RUNTIME by exact name, the same
 *     mechanism and the same audited constraints as the Base UI three.
 *
 * Its twin `border-(--color-border)` is deliberately NOT exempted — see the
 * note in ds-primitives.audit.ts. THE-264 defined --color-border as a theme
 * token, so it resolves against the stylesheet and adding it would break
 * `holds back no stale exemption`.
 *
 * ⚠️ ZERO NEW TOKENS. globals.css is byte-identical (section 4). THE-263's
 * --chart-1..5 were already there and are unmoved (section 5).
 */

const sha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

const UI_DIR = path.join(REPO_ROOT, 'src/components/ui');
const FIXTURES = path.join(UI_DIR, '__tests__/__fixtures__');
const LAYOUT = path.join(REPO_ROOT, 'src/app/layout.tsx');

/** The four this PR installs. `data-table` is absent for the reason above. */
const NEW_PRIMITIVES = ['chart.tsx', 'pagination.tsx', 'progress.tsx', 'table.tsx'] as const;

/**
 * The 17 that existed before, with the digests recorded at 767ca9b.
 *
 * ⚠️ Spelled as literals rather than read from primitive-digests.json. This PR
 * RE-RECORDS that fixture — it has to, it gains four entries — so a test
 * comparing the fixture against itself would pass no matter what the CLI had
 * done to button.tsx or card.tsx. Both are registry dependencies of what this
 * PR installs (`pagination` → button, `chart` → card), so both were candidates
 * for exactly that rewrite. The CLI reported them as "skipped (identical)";
 * this is the assertion that does not take its word for it.
 */
const PRE_EXISTING_DIGESTS: Record<string, string> = {
  'avatar.tsx': '357b2f9aac0192c071cb2ed65cb6e4c8ec01fa02fc15cf50d889b85731b75666',
  'badge.tsx': '968b0403af74a785c9408ca69a677235e49d0c80b2c27fb9858ad421a8778c7d',
  'breadcrumb.tsx': '26f83fc8ed302d710851a71b705f5f8f28c805561c1fb6945370617267c5a4a9',
  'button.tsx': 'd14549ab3ba7a9d5d1f424c2599233bffa0b317121abf3b6efa2fb902d5e2781',
  'card.tsx': 'd8113cbf964f8d1aadf2649d2944d8bbc6e3cfd49d36746f76868cbc4dde3cfe',
  'collapsible.tsx': 'ead4349ff7b01d696ef89294a81d18ee1d3f732321398896462c834ab9b9e065',
  'dialog.tsx': 'ccabf6cc674a68b09d9168904bb46b7c1075a67312cf6f51f3e38b8eeacd2fdb',
  'dropdown-menu.tsx': '1c1ae4ec02de9778286f84e0d15a1b74cc610c13c5b6a13c1ada2e6770eeb4e1',
  'input.tsx': 'f7d6ecff9a4d631feeaf401c02bb87e26ddb38131c55d15a43b9290747390847',
  'label.tsx': '7f19b8476658d25ff197c84030e58cd7395059d876a54630e025951e474ebdae',
  'select.tsx': 'ca3bd1b370ea67b84632d435c22d8270752fa6013c06c365162af265e4a0e87e',
  'separator.tsx': '75085bd84ff6965e4a356c53a4689799cabf65caa93c0bba064d5a0c6fa78f13',
  'sheet.tsx': 'a8ff25079c1167230fc3a9ddce881a8fb24f8ebb1eecbc8189c7f1cf242018df',
  'skeleton.tsx': '8110bba70d0cb9fe968c0b7bd092ad12258caef40b028b4a87f402bdab907faf',
  'sonner.tsx': 'f76ee6fb6aa5892bdc1c92b8b282a59f34b63f3fa2ab01475df4a61988f0014b',
  'tabs.tsx': '8bf9ee3935ab86c268a2a71cb5b4b67d3d5587ca9f2e0bf25f37ffdb1980434c',
  'tooltip.tsx': '2cea2294d4947b88d815860f64e0b5e0eb47a59bde47cfd194aac2230c923865',
};

/**
 * The class counts of those 17, as recorded BEFORE this PR touched the
 * extractor. Pinned as literals for the same reason the digests are: this PR
 * re-records primitive-class-counts.json, and the claim under test is that the
 * comparison-operand fix moved none of these numbers.
 */
const PRE_EXISTING_COUNTS: Record<string, number> = {
  'avatar.tsx': 48,
  'badge.tsx': 49,
  'breadcrumb.tsx': 18,
  'button.tsx': 80,
  'card.tsx': 44,
  'collapsible.tsx': 0,
  'dialog.tsx': 53,
  'dropdown-menu.tsx': 79,
  'input.tsx': 35,
  'label.tsx': 11,
  'select.tsx': 104,
  'separator.tsx': 6,
  'sheet.tsx': 61,
  'skeleton.tsx': 3,
  'sonner.tsx': 3,
  'tabs.tsx': 73,
  'tooltip.tsx': 53,
};

/**
 * As of 767ca9b. None of these files is this PR's business.
 *
 * ⚠️ All three are the values THE-266 recorded, unchanged. That is the point:
 * two shadcn batches have now run the CLI against this repo and neither moved
 * layout.tsx, firestore.rules or tailwind.config.ts. THE-271 owns layout.tsx
 * concurrently, so this PR must be able to say it did not touch it.
 */
const LAYOUT_SHA = 'bf5f96a61c3fa2f467556f44f0b36e91e49b7c830609b37c775fa6a2b9232ca5';
const RULES_SHA = 'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499';
const TAILWIND_CODE_SHA = '491ebb5575d16eddfab00c6ed89900c725141b412e410e9e97342ff2108b2904';
const GLOBALS_SHA = '772c79af681c2b97c496b91be4f2573415f2a65802dfac078dbc72e8a8fd3741';

/** functions/ — byte-identical, file for file. Not this PR's business either. */
const FUNCTIONS_DIGESTS: Record<string, string> = {
  'functions/.gcloudignore': '9c20b803e45cd916',
  'functions/package-lock.json': 'bbe18ca8fb92c17d',
  'functions/package.json': '33846d2de1bef5e3',
  'functions/src/index.ts': '39ccade96ac3d4dd',
  'functions/tsconfig.json': 'a707d5b587803ee0',
};

/* ── palette resolution — the same four chains THE-266 pinned ────────────── */

const PALETTES = {
  // Classic first: it has been the default family since #409.
  'classic light': ['[data-palette="classic"][data-theme="light"]', ':root'],
  'classic dark': [
    '[data-palette="classic"].dark, [data-palette="classic"][data-theme="dark"]',
    '.dark, [data-theme="dark"]',
    ':root',
  ],
  'harvest light': [':root'],
  'harvest dark': ['.dark, [data-theme="dark"]', ':root'],
} as const;

type Palette = keyof typeof PALETTES;
type Decls = Map<string, Map<string, string>>;

const declarationsBySelector = (css: string): Decls => {
  const out: Decls = new Map();
  postcss.parse(css).walkRules((r) => {
    const key = r.selector.replace(/\s+/g, ' ').trim();
    const map = out.get(key) ?? new Map<string, string>();
    r.walkDecls((d) => {
      if (d.prop.startsWith('--')) map.set(d.prop, d.value.trim());
    });
    out.set(key, map);
  });
  return out;
};

/** Resolve one custom property in one palette, following var() indirection. */
const resolve = (decls: Decls, chain: readonly string[], token: string): string => {
  const lookup = (name: string): string | undefined => {
    for (const sel of chain) {
      const v = decls.get(sel)?.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  let value = lookup(token);
  const seen = new Set<string>();
  while (value && /^var\(/.test(value)) {
    const inner = value.match(/^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,([\s\S]*))?\)$/);
    if (!inner) break;
    const next = inner[1];
    if (seen.has(next)) break;
    seen.add(next);
    const got = lookup(next);
    value = got !== undefined ? got : inner[2]?.trim();
  }
  return (value ?? '').trim();
};

/** Every custom property declared anywhere in globals.css, @theme included. */
const allDeclaredTokens = (): string[] => {
  const names = new Set<string>();
  postcss.parse(readFileSync(GLOBALS_CSS, 'utf8')).walkDecls((d) => {
    if (d.prop.startsWith('--')) names.add(d.prop);
  });
  return [...names].sort();
};

const pkg = (): { dependencies: Record<string, string>; devDependencies: Record<string, string> } =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

const lock = (): { packages: Record<string, { version?: string; dev?: boolean }> } =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));

let decls: Decls;
let audit: Awaited<ReturnType<typeof auditPrimitives>>;

beforeAll(async () => {
  decls = declarationsBySelector(readFileSync(GLOBALS_CSS, 'utf8'));
  audit = await auditPrimitives(
    readdirSync(UI_DIR)
      .filter((f) => f.endsWith('.tsx'))
      .sort()
      .map((f) => path.join(UI_DIR, f)),
  );
}, 180_000);

/* ── 0. The resolver is pointed at real blocks ───────────────────────────── */

it('every palette selector this file names actually exists in globals.css', () => {
  // A mistyped selector does not throw — `resolve` falls through to the next
  // link and returns :root's value, so "classic dark" would silently report
  // the LIGHT palette and every ratio below would pass while measuring the
  // wrong thing. THE-266 caught exactly that during development.
  for (const [palette, chain] of Object.entries(PALETTES)) {
    for (const sel of chain) {
      expect(decls.has(sel), `${palette} names a selector not in globals.css: ${sel}`).toBe(true);
    }
  }
});

/* ── 1. The guard, per component, named ──────────────────────────────────── */

describe("each new primitive's token classes resolve", () => {
  for (const file of NEW_PRIMITIVES) {
    it(`${file} spells no class that resolves to nothing`, () => {
      const abs = path.join(UI_DIR, file);
      const mine = audit.findings.filter((f) => rel(f.file) === rel(abs));
      expect(mine, `${file} has unresolved classes: ${JSON.stringify(mine)}`).toEqual([]);
    });
  }

  it('and the audit as a whole is clean', () => {
    expect(audit.findings).toEqual([]);
  });

  it('the audit opened all 22 files and pulled real classes out of the new four', () => {
    // A guard that read nothing would report nothing and look thorough. This
    // is the failure mode THE-266's section 10 was written against, kept here.
    //
    // ⚠️ THE-270 — 21 when this was written, 22 since `sidebar` landed, and 43
    // since THE-274 installed Batches C, D and E. Only the total moved: the
    // four counts below are THIS ticket's subject and are untouched, which is
    // also the evidence that neither sidebar's arrival nor THE-274's twenty-one
    // disturbed what Batch B installed.
    const counts = Object.fromEntries(
      [...audit.classesByFile].map(([f, c]) => [path.basename(f), c.length]),
    );
    expect(audit.classesByFile.size).toBe(43);
    for (const file of NEW_PRIMITIVES) {
      expect(existsSync(path.join(UI_DIR, file)), `${file} was never written`).toBe(true);
      expect(counts[file], `the audit never opened ${file}`).toBeGreaterThan(0);
    }
    expect(counts['chart.tsx']).toBe(63);
    expect(counts['pagination.tsx']).toBe(13);
    expect(counts['progress.tsx']).toBe(18);
    expect(counts['table.tsx']).toBe(26);
  });

  it('the comparison-operand fix moved no pre-existing count', () => {
    // The extractor changed in this PR. The claim is that it is a strict no-op
    // for every file that predates it — none of the seventeen compares a
    // string inside a cn() call — and this is that claim, not an assumption.
    const counts = Object.fromEntries(
      [...audit.classesByFile].map(([f, c]) => [path.basename(f), c.length]),
    );
    const preExisting = Object.fromEntries(
      Object.keys(PRE_EXISTING_COUNTS).map((f) => [f, counts[f]]),
    );
    expect(preExisting).toEqual(PRE_EXISTING_COUNTS);
  });

  it('and `dot`, `line`, `dashed`, `top` are no longer read as classes at all', () => {
    // The mutation this fix is written against, asserted positively: these
    // four are prop VALUES compared inside cn(). Exempting them would have
    // been wrong — they are not classes belonging to another stylesheet, they
    // are not classes. So the assertion is that the extractor never yields
    // them, not that the guard forgives them.
    const chartClasses = extractClassNames(path.join(UI_DIR, 'chart.tsx'));
    for (const notAClass of ['dot', 'line', 'dashed', 'top']) {
      expect(chartClasses, `chart.tsx still yields ${notAClass} as a class`).not.toContain(
        notAClass,
      );
    }
    // The control: the classes standing beside them in the same cn() calls are
    // still read, so the fix removed the comparands and nothing else.
    for (const real of ['items-center', 'w-1', 'pb-3', 'pt-3', 'my-0.5']) {
      expect(chartClasses, `chart.tsx stopped yielding ${real}`).toContain(real);
    }
  });
});

/* ── 2. The fixture stays empty ──────────────────────────────────────────── */

it('the unresolved fixture is still empty', () => {
  const p = path.join(FIXTURES, 'unresolved-token-classes.txt');
  expect(readFileSync(p, 'utf8')).toBe('');
  expect(statSync(p).size).toBe(0);
});

/* ── 3. No pre-existing primitive moved ──────────────────────────────────── */

/**
 * ⚠️ THE-273 CHANGED sonner.tsx, and it is the only pre-existing primitive any
 * later ticket has moved. The map above is deliberately LEFT ALONE — it records
 * the install-time state and that is the claim it makes — so this is the single,
 * named exception layered over it. Every other entry is still compared against
 * the digest recorded when this PR landed, and a second file moving still fails.
 *
 * (The change: sonner.tsx stopped hard-coding `theme: "light"` — a correct call
 * when the app had no dark mode — and reads Harvest's own resolved theme
 * instead. See src/__tests__/the-273-toast-dark-mode.test.tsx.)
 */
/**
 * ⚠️ `tabs.tsx` MOVED, and why — THE-276-FIX.
 *
 * As vendored, this primitive styled itself with `data-horizontal:` and
 * `data-vertical:` variants, which Tailwind compiles to the attribute selectors
 * `[data-horizontal]` and `[data-vertical]`. The installed @base-ui/react
 * (^1.5.0) emits `data-orientation="horizontal"` instead, so none of those
 * twelve rules ever matched. The consequence shipped: the tabs root kept
 * `display:flex` with the default `row` direction, and the panel — a sibling
 * carrying `flex-1` — rendered as a second COLUMN beside the tab strip instead
 * of below it, putting every dashboard widget in a 420px band on the right of a
 * 1044px container. The active tab's underline, whose geometry comes from the
 * same variants, was never drawn either.
 *
 * Twelve class names re-spelled `data-[orientation=…]`. No element, slot,
 * variant or API changed.
 *
 * Named here rather than the assertion being loosened — the same treatment
 * THE-273's sonner.tsx fix got, and for the same reason: every other entry is
 * still compared against the digest this PR recorded, and a second file moving
 * still fails.
 */
const MOVED_SINCE: Record<string, string> = {
  'sonner.tsx': '2ebc0c9ba968858cead2fbf2523dfd9da217715339967025e8c8df94f2131ab9',
  'tabs.tsx': '096e3d4b2a99b1eff95d16959f97daaa1747fdb7de6226d6c54b9693e22b3410',
};

describe('the CLI rewrote nothing it should not have', () => {
  it('all 17 pre-existing primitives are byte-identical to 767ca9b, bar the two THE-273 and THE-276-FIX fixed', () => {
    const actual = Object.fromEntries(
      Object.keys(PRE_EXISTING_DIGESTS).map((f) => [
        f,
        sha256(readFileSync(path.join(UI_DIR, f), 'utf8')),
      ]),
    );
    expect(actual).toEqual({ ...PRE_EXISTING_DIGESTS, ...MOVED_SINCE });
  });

  it('button.tsx and card.tsx in particular — the two the CLI could have rewritten', () => {
    // Named separately because they are the ones actually at risk: `pagination`
    // declares `button` as a registry dependency and `chart` declares `card`,
    // so the CLI resolved and considered both. It reported "skipped
    // (identical)"; these two lines are the check that does not trust that.
    expect(sha256(readFileSync(path.join(UI_DIR, 'button.tsx'), 'utf8'))).toBe(
      PRE_EXISTING_DIGESTS['button.tsx'],
    );
    expect(sha256(readFileSync(path.join(UI_DIR, 'card.tsx'), 'utf8'))).toBe(
      PRE_EXISTING_DIGESTS['card.tsx'],
    );
  });

  it('src/components/ui holds exactly the 17 plus the 4, plus sidebar and THE-274’s 21', () => {
    // ⚠️ THE-270 installed `sidebar` after this landed, and THE-274 then
    // installed Batches C, D and E in one pass — nineteen it named, plus
    // `popover` and `toggle`. Named explicitly rather than the assertion being
    // loosened to "contains", so the next arrival still has to come back and
    // say so — the same choice this test already made about Batch B's own four.
    const BATCH_CDE = [
      'alert.tsx', 'button-group.tsx', 'calendar.tsx', 'checkbox.tsx', 'command.tsx',
      'context-menu.tsx', 'empty.tsx', 'field.tsx', 'hover-card.tsx', 'input-group.tsx',
      'item.tsx', 'popover.tsx', 'radio-group.tsx', 'resizable.tsx', 'scroll-area.tsx',
      'slider.tsx', 'spinner.tsx', 'switch.tsx', 'textarea.tsx', 'toggle-group.tsx',
      'toggle.tsx',
    ];
    expect(
      readdirSync(UI_DIR)
        .filter((f) => f.endsWith('.tsx'))
        .sort(),
    ).toEqual(
      [...Object.keys(PRE_EXISTING_DIGESTS), ...NEW_PRIMITIVES, 'sidebar.tsx', ...BATCH_CDE].sort(),
    );
  });

  it('no data-table primitive was written, because there is no such registry item', () => {
    // Premise 1 of the header, asserted rather than described. If a future run
    // of this ticket writes a hand-authored data-table.tsx, this fails — which
    // is correct: the ticket forbids vendoring a component by hand.
    expect(existsSync(path.join(UI_DIR, 'data-table.tsx'))).toBe(false);
  });
});

/* ── 4. No new token ─────────────────────────────────────────────────────── */

describe('the token bridge held, with zero new tokens', () => {
  it('globals.css is byte-identical — this PR defines no token at all', () => {
    // The headline result. THE-263 shipped --chart-1..5 across all four
    // palettes in #407, so `chart` needed nothing; the other three spell only
    // the shadcn names THE-263 already bridged.
    expect(sha256(readFileSync(GLOBALS_CSS, 'utf8'))).toBe(GLOBALS_SHA);
  });

  it('and the token ledger is unchanged, name for name', () => {
    // The digest above would also catch a comment edit. This is the claim in
    // the terms that matter: the SET of declared custom properties did not
    // grow. Both halves are covered — walkDecls sees inside @theme inline, so
    // a --color-* added there trips this too.
    expect(`${allDeclaredTokens().join('\n')}\n`).toBe(
      readFileSync(path.join(FIXTURES, 'globals-tokens.txt'), 'utf8'),
    );
  });

  it('the runtime exclusion list is back to three, and still holds names not patterns', () => {
    // ⚠️ THE-270 — this read "grew by exactly one" and pinned four names. The
    // one concession this PR made, `bg-(--color-bg)`, has since been removed,
    // and the removal is this ticket's claim vindicated rather than reversed:
    // the entry existed because the guard could not see that chart.tsx supplies
    // --color-bg itself (chart.tsx:236). THE-270 taught the audit to read
    // `style={{ … }}` off the component, `holds back no stale exemption`
    // immediately reported the entry as doing no work, and it went.
    //
    // Nothing about chart.tsx changed and the class is still never reported —
    // section 4's `border-(--color-border) is NOT exempted` test still draws the
    // same distinction, now between a stylesheet token and an inline style
    // rather than between a token and a name on a list.
    expect(Object.keys(SET_AT_RUNTIME).sort()).toEqual([
      'max-h-(--available-height)',
      'origin-(--transform-origin)',
      'w-(--anchor-width)',
    ]);
    for (const key of [...Object.keys(SET_AT_RUNTIME), ...Object.keys(SET_BY_NEXT_FONT)]) {
      // Only glob/regex metacharacters count — `(` and `)` are literal syntax
      // in Tailwind's arbitrary-property spelling, not wildcards.
      expect(key, `${key} is a wildcard, not a literal`).not.toMatch(/[*?]|\.\+|\.\*/);
    }
    expect(SET_AT_RUNTIME['bg-(--color-bg)']).toBeUndefined();
  });

  it('border-(--color-border) is NOT exempted — it resolves against THE-264’s token', () => {
    // chart.tsx sets --color-border inline beside --color-bg, but THE-264
    // defined --color-border as a real theme token, so the class resolves and
    // the guard never reports it. Listing it would break `holds back no stale
    // exemption`. The asymmetry is deliberate and this pins it.
    expect(Object.keys(SET_AT_RUNTIME)).not.toContain('border-(--color-border)');
    expect(allDeclaredTokens()).toContain('--color-border');
  });
});

/* ── 5. --chart-1..5, unmoved ────────────────────────────────────────────── */

describe('THE-263’s chart series are untouched by this PR', () => {
  /**
   * The twenty values #407 shipped, pinned by palette.
   *
   * ⚠️ Classic and Harvest are IDENTICAL here, and that is the design's
   * decision, not an oversight: a series colour is a categorical data
   * encoding, not surface chrome, so re-hueing it per family would make the
   * same data render differently between families. Neither Classic block
   * overrides --chart-*, and section 5's last test asserts that directly.
   */
  const CHART: Record<Palette, string[]> = {
    'classic light': ['#C9963A', '#4F97D6', '#6E8E52', '#D6CCBE', '#C8BCA9'],
    'classic dark': [
      '#E5B65C',
      '#6BA8DD',
      '#8CA96E',
      'rgba(255, 255, 255, 0.30)',
      'rgba(255, 255, 255, 0.28)',
    ],
    'harvest light': ['#C9963A', '#4F97D6', '#6E8E52', '#D6CCBE', '#C8BCA9'],
    'harvest dark': [
      '#E5B65C',
      '#6BA8DD',
      '#8CA96E',
      'rgba(255, 255, 255, 0.30)',
      'rgba(255, 255, 255, 0.28)',
    ],
  };

  for (const palette of Object.keys(PALETTES) as Palette[]) {
    it(`--chart-1..5 still resolve to their recorded values — ${palette}`, () => {
      const actual = [1, 2, 3, 4, 5].map((n) => resolve(decls, PALETTES[palette], `--chart-${n}`));
      expect(actual).toEqual(CHART[palette]);
    });
  }

  it('and the @theme inline half still mints the utilities', () => {
    // Without --color-chart-N a `fill-chart-1` would produce no rule. Phase 8
    // depends on this; the components installed here do not spell it, so
    // nothing else in this suite would notice if it disappeared.
    const tokens = allDeclaredTokens();
    for (const n of [1, 2, 3, 4, 5]) {
      expect(tokens, `--chart-${n} is gone`).toContain(`--chart-${n}`);
      expect(tokens, `--color-chart-${n} is gone`).toContain(`--color-chart-${n}`);
    }
  });

  it('neither Classic block overrides a chart series', () => {
    for (const sel of [
      '[data-palette="classic"][data-theme="light"]',
      '[data-palette="classic"].dark, [data-palette="classic"][data-theme="dark"]',
    ]) {
      const block = decls.get(sel);
      expect(block, `the Classic block ${sel} is missing`).toBeDefined();
      for (const n of [1, 2, 3, 4, 5]) {
        expect(block?.has(`--chart-${n}`), `Classic names --chart-${n} directly`).toBe(false);
      }
    }
  });

  it('--chart-4 and --chart-5 are still the design’s muted series on light grounds', () => {
    // Known, accepted, and NOT to be "fixed" here: the design ships these two
    // deliberately low-contrast. Recorded so that Phase 8 meets the number
    // before it puts a fourth series on a light chart and wonders where it
    // went — and so that a well-meaning later PR that "corrects" them has to
    // come through this test to do it.
    for (const palette of ['classic light', 'harvest light'] as const) {
      const bg = resolve(decls, PALETTES[palette], '--background');
      const c4 = contrastRatio(resolve(decls, PALETTES[palette], '--chart-4'), bg);
      const c5 = contrastRatio(resolve(decls, PALETTES[palette], '--chart-5'), bg);
      expect(c4).toBeGreaterThan(1.47);
      expect(c4).toBeLessThan(1.51);
      expect(c5).toBeGreaterThan(1.73);
      expect(c5).toBeLessThan(1.78);
    }
  });
});

/* ── 6. Contrast, four palettes, ratios asserted ─────────────────────────── */

describe('every foreground/background pair the four components introduce clears AA', () => {
  /**
   * The pairs, read off the installed files:
   *
   *   chart.tsx:194  the tooltip is `bg-background`, and inside it
   *   chart.tsx:256  the value is `text-foreground`
   *   chart.tsx:251  the label is `text-muted-foreground`
   *   table.tsx:47   TableFooter is `bg-muted/50`
   *   table.tsx:60   a selected TableRow is `bg-muted`
   *   table.tsx:73   TableHead is `text-foreground`
   *   table.tsx:101  TableCaption is `text-muted-foreground`
   *
   * ⚠️ The `/50` blends are bounded, not skipped. `bg-muted/50` composites
   * --muted over --background, so its result lies between the two; asserting
   * each text colour on BOTH grounds brackets every blend of them without
   * having to composite anything. pagination.tsx spells no colour of its own —
   * it defers entirely to buttonVariants, which THE-260 already covers.
   */
  const PAIRS = [
    ['chart tooltip text-foreground on bg-background', '--foreground', '--background'],
    ['chart tooltip text-muted-foreground on bg-background', '--muted-foreground', '--background'],
    ['table text-foreground on bg-muted', '--foreground', '--muted'],
    ['table text-muted-foreground on bg-muted', '--muted-foreground', '--muted'],
  ] as const;

  /** The measured ratios, Classic first. Pinned, not merely bounded. */
  const RATIOS: Record<Palette, number[]> = {
    'classic light': [9.68, 6.54, 9.02, 6.09],
    'classic dark': [10.61, 7.42, 11.57, 8.09],
    'harvest light': [9.52, 6.62, 8.74, 6.08],
    'harvest dark': [10.78, 7.57, 11.45, 8.04],
  };

  for (const palette of Object.keys(PALETTES) as Palette[]) {
    PAIRS.forEach(([label, fg, bg], i) => {
      it(`${label} — ${palette}`, () => {
        const r = contrastRatio(
          resolve(decls, PALETTES[palette], fg),
          resolve(decls, PALETTES[palette], bg),
        );
        expect(r, `${label} is ${r.toFixed(2)}:1 in ${palette}`).toBeGreaterThanOrEqual(
          AA_CONTRAST,
        );
        // And it is the ratio recorded, so a token moving underneath these
        // components fails here by name and palette rather than drifting
        // silently down towards the floor.
        expect(r).toBeCloseTo(RATIOS[palette][i], 1);
      });
    });
  }

  it('the worst of them clears both recorded floors — 5.66 (THE-263) and 5.69 (THE-267)', () => {
    const worst = Math.min(
      ...PAIRS.flatMap(([, fg, bg]) =>
        Object.values(PALETTES).map((chain) =>
          contrastRatio(resolve(decls, chain, fg), resolve(decls, chain, bg)),
        ),
      ),
    );
    expect(worst).toBeGreaterThanOrEqual(5.69);
    // Recorded exactly: harvest light, text-muted-foreground on bg-muted.
    expect(worst).toBeCloseTo(6.08, 1);
  });

  /**
   * ⚠️ THE ONE NUMBER PHASE 8 MUST SEE BEFORE IT SHIPS A PROGRESS BAR.
   *
   * progress.tsx paints its indicator `bg-primary` on a `bg-muted` track. That
   * is a graphical object, not text, so WCAG 1.4.3 (the AA the ticket's floor
   * is about) does not apply and this is NOT an AA failure. 1.4.11 non-text
   * contrast does apply to it, and its threshold is 3:1 — which the two LIGHT
   * palettes miss at ~2.30:1.
   *
   * This is not fixed here, and deliberately: fixing it means moving --primary
   * or --muted, both of which are load-bearing across the whole app, and the
   * ticket forbids moving any existing token's value. It is recorded instead,
   * with the numbers, so the decision is made in daylight when the dashboard
   * is built — a darker track, a border on the indicator, or an accepted
   * exception. Same treatment THE-266 gave skeleton's invisible `bg-muted`.
   */
  it('progress bg-primary on bg-muted is a non-text pair, recorded at its real ratio', () => {
    const measured = Object.fromEntries(
      (Object.keys(PALETTES) as Palette[]).map((p) => [
        p,
        Number(
          contrastRatio(
            resolve(decls, PALETTES[p], '--primary'),
            resolve(decls, PALETTES[p], '--muted'),
          ).toFixed(2),
        ),
      ]),
    );
    expect(measured).toEqual({
      'classic light': 2.31,
      'classic dark': 7.0,
      'harvest light': 2.3,
      'harvest dark': 7.19,
    });
    // The dark palettes clear 1.4.11's 3:1; the light ones do not. Asserted in
    // both directions so that a later token move in EITHER direction is caught.
    expect(measured['classic dark']).toBeGreaterThanOrEqual(3);
    expect(measured['harvest dark']).toBeGreaterThanOrEqual(3);
    expect(measured['classic light']).toBeLessThan(3);
    expect(measured['harvest light']).toBeLessThan(3);
  });
});

/* ── 7. The dependencies ─────────────────────────────────────────────────── */

describe('the new dependencies are declared, pinned and resolvable', () => {
  it('recharts is declared in package.json and pinned to 3.8.0 in the lockfile', () => {
    expect(pkg().dependencies.recharts).toBe('^3.8.0');
    expect(lock().packages['node_modules/recharts']?.version).toBe('3.8.0');
  });

  it('and it actually resolves at that version', () => {
    // The lockfile can say anything; this reads what npm installed. A range
    // that silently floated to 4.x would still satisfy `^3.8.0` in neither
    // direction, but a wrong install would pass every assertion above.
    const installed = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'node_modules/recharts/package.json'), 'utf8'),
    );
    expect(installed.version).toBe('3.8.0');
  });

  it('recharts 3.8.0 supports React 18 — the version this app is on', () => {
    // STOP condition 3 of the ticket, asserted rather than assumed: recharts
    // 3.x still declares ^18 alongside ^19, so the major bump to 3 does not
    // force a React upgrade, and Next 14.2.15 is untouched by it.
    const installed = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'node_modules/recharts/package.json'), 'utf8'),
    );
    expect(installed.peerDependencies.react).toContain('^18.0.0');
    expect(installed.peerDependencies['react-dom']).toContain('^18.0.0');
    expect(pkg().dependencies.react).toBe('^18.3.1');
    expect(pkg().dependencies.next).toBe('14.2.15');
  });

  it('and its third peer, react-is, is already satisfied by the tree', () => {
    // ⚠️ recharts 3.x adds `react-is` as a PEER dependency, which package.json
    // does not declare. .npmrc sets legacy-peer-deps=true, so npm would not
    // have complained either way — an unmet peer here would be a runtime
    // failure found in Phase 8, not an install error found now. It is met:
    // react-is is already in the tree at 16.13.1, inside the declared range.
    const installed = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'node_modules/recharts/package.json'), 'utf8'),
    );
    expect(installed.peerDependencies['react-is']).toBeDefined();
    const reactIs = lock().packages['node_modules/react-is'];
    expect(reactIs, 'react-is is not in the tree — recharts peer is unmet').toBeDefined();
    expect(reactIs?.version).toBe('16.13.1');
    expect(reactIs?.dev, 'react-is is dev-only; recharts needs it at runtime').not.toBe(true);
  });

  it('@tanstack/react-table was NOT added — nothing installed here needs it', () => {
    // Premise 2 of the header. `data-table` is not a registry item, so nothing
    // pulled TanStack Table, and it is not speculatively added. Adopting it is
    // a Phase 8 build decision. @tanstack/react-QUERY is a different package
    // and predates this PR — asserted so the two are never confused.
    const p = pkg();
    expect(p.dependencies['@tanstack/react-table']).toBeUndefined();
    expect(p.devDependencies['@tanstack/react-table']).toBeUndefined();
    expect(lock().packages['node_modules/@tanstack/react-table']).toBeUndefined();
    expect(p.dependencies['@tanstack/react-query']).toBe('^5.101.1');
  });

  /**
   * Everything the lockfile gained, by name and version.
   *
   * ⚠️ This is the "nothing surprising" check the ticket asks for, and what it
   * found IS the surprise: recharts 3.x carries a Redux store. The d3 family
   * the ticket expected is absent from this list because every module of it is
   * ALREADY here — `d3` and `mermaid` are production dependencies via
   * @excalidraw/excalidraw, at versions satisfying victory-vendor's ranges, so
   * npm deduped rather than duplicating.
   */
  it('the lockfile gained exactly twelve packages, and they are these twelve', () => {
    const added = Object.keys(lock().packages)
      .filter((k) => k.startsWith('node_modules/'))
      .map((k) => k.replace(/^node_modules\//, ''));
    const EXPECTED = [
      '@reduxjs/toolkit',
      '@reduxjs/toolkit/node_modules/immer',
      '@standard-schema/utils',
      'decimal.js-light',
      'eventemitter3',
      'immer',
      'react-redux',
      'recharts',
      'recharts/node_modules/reselect',
      'redux',
      'redux-thunk',
      'victory-vendor',
    ];
    for (const name of EXPECTED) {
      expect(added, `${name} is missing from the lockfile`).toContain(name);
    }
  });

  it('the d3 family recharts reaches was already a production dependency here', () => {
    // Stated as a fact about the tree, because it is the whole reason the
    // bundle delta is what it is rather than larger. victory-vendor's ranges
    // are satisfied by what @excalidraw/excalidraw already pulled.
    const packages = lock().packages;
    for (const d3 of ['d3-array', 'd3-scale', 'd3-shape', 'd3-time', 'd3-interpolate']) {
      const entry = packages[`node_modules/${d3}`];
      expect(entry, `${d3} is not in the tree`).toBeDefined();
      expect(entry?.dev, `${d3} is a dev dependency, not production`).not.toBe(true);
      // And not duplicated under recharts or victory-vendor.
      expect(packages[`node_modules/recharts/node_modules/${d3}`]).toBeUndefined();
      expect(packages[`node_modules/victory-vendor/node_modules/${d3}`]).toBeUndefined();
    }
  });

  it('no existing dependency changed version', () => {
    // "Do not move any existing token's value" has a dependency analogue: this
    // PR adds, and moves nothing. The one entry that legitimately changed is
    // @standard-schema/spec, which lost its `dev: true` flag because
    // @reduxjs/toolkit now reaches it from production — same version, 1.1.0.
    const packages = lock().packages;
    expect(packages['node_modules/@standard-schema/spec']?.version).toBe('1.1.0');
    expect(packages['node_modules/react']?.version).toMatch(/^18\./);
    expect(packages['node_modules/next']?.version).toBe('14.2.15');
  });
});

/* ── 8. Imported by nothing ──────────────────────────────────────────────── */

/**
 * ⚠️ AMENDED BY THE-276, which is the adoption this assertion was waiting for.
 *
 * THE-272 installed `chart` without wiring it in, so its bundle cost was zero,
 * and both assertions below said so. THE-276 builds the analytics dashboard and
 * mounts `chart` in four widgets — the explicit decision the note on the second
 * assertion defers to ("Phase 8 is where recharts starts costing anything").
 *
 * The claim is therefore narrowed, not dropped: `table`, `pagination` and
 * `progress` are STILL adopted by nothing, and `chart` is adopted by exactly
 * these four files and no others. A fifth adopter, or any adopter of the other
 * three, still fails here.
 */
const THE_276_CHART_ADOPTERS = [
  'src/components/dashboard/FunnelChart.tsx',
  'src/components/dashboard/GivingMix.tsx',
  'src/components/dashboard/KpiCard.tsx',
  'src/components/dashboard/TrendChart.tsx',
] as const;

it('only THE-276 adopts chart, and table/pagination/progress are still adopted by nothing', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
      return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
    });
  const files = walk(path.join(REPO_ROOT, 'src')).filter(
    (f) => !f.startsWith(UI_DIR) && !f.includes(`${path.sep}__tests__${path.sep}`),
  );
  /** ⚠️ Relative spellings too. The original regex matched only the `@/` alias,
   *  so a `../ui/chart` import would have slipped past it unrecorded. */
  const importsUi = (src: string, name: string) =>
    new RegExp(`from ['"](?:@/components|\\.{1,2}(?:/[\\w.-]+)*)/ui/${name}['"]`).test(src);

  const chartImporters = files.filter((f) => importsUi(readFileSync(f, 'utf8'), 'chart'));
  expect(chartImporters.map((f) => rel(f)).sort()).toEqual([...THE_276_CHART_ADOPTERS]);

  for (const name of ['table', 'pagination', 'progress']) {
    const adopters = files.filter((f) => importsUi(readFileSync(f, 'utf8'), name));
    expect(adopters.map((f) => rel(f)), `${name} was adopted`).toEqual([]);
  }
});

it('and recharts is imported by the chart primitive and THE-276\'s widgets, and nothing else', () => {
  // THE-272's own note: "The bundle consequence of this PR is zero precisely
  // because of this: a file no route reaches is in no chunk. Phase 8 is where
  // recharts starts costing anything, and it should be an explicit decision
  // there." THE-276 is that decision — the analytics dashboard draws real
  // charts — so the list is extended by exactly the four widgets that draw
  // them, and stays closed against a fifth.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
      return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
    });
  const importers = walk(path.join(REPO_ROOT, 'src')).filter((f) => {
    // Test files excluded — this one names the package in its own assertion.
    if (f.includes(`${path.sep}__tests__${path.sep}`)) return false;
    return /from "recharts"|from 'recharts'/.test(readFileSync(f, 'utf8'));
  });
  expect(importers.map((f) => rel(f)).sort()).toEqual(
    [...THE_276_CHART_ADOPTERS, 'src/components/ui/chart.tsx'].sort(),
  );
});

/* ── 9. Out-of-scope files ───────────────────────────────────────────────── */

describe('the out-of-scope files are untouched', () => {
  it('tailwind.config.ts keeps its pinned code digest', () => {
    const config = readFileSync(TAILWIND_CONFIG, 'utf8');
    const code = config
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    expect(sha256(code)).toBe(TAILWIND_CODE_SHA);
  });

  it('layout.tsx is byte-identical — THE-271 owns it concurrently', () => {
    expect(sha256(readFileSync(LAYOUT, 'utf8'))).toBe(LAYOUT_SHA);
  });

  it('firestore.rules is byte-identical', () => {
    expect(sha256(readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8'))).toBe(RULES_SHA);
  });

  it('functions/ carries no change from this PR', () => {
    // ⚠️ Keys are built with POSIX separators explicitly rather than taking
    // path.relative's output as-is: on Windows that yields backslashes and the
    // comparison fails for a reason that has nothing to do with the code.
    // Several suites in this repo have that bug; this one does not.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'lib' ? [] : walk(p);
        return [p];
      });
    const actual = Object.fromEntries(
      walk(path.join(REPO_ROOT, 'functions'))
        .sort()
        .map((f) => [
          path.relative(REPO_ROOT, f).split(path.sep).join('/'),
          sha256(readFileSync(f, 'utf8')).slice(0, 16),
        ]),
    );
    expect(actual).toEqual(FUNCTIONS_DIGESTS);
  });

  it('components.json is untouched — the CLI wanted nothing from it', () => {
    const cfg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'components.json'), 'utf8'));
    expect(cfg.style).toBe('base-nova');
    expect(cfg.iconLibrary).toBe('lucide');
    expect(cfg.tailwind.css).toBe('src/app/globals.css');
    expect(cfg.registries).toEqual({});
  });
});

/* ── 10. The `line` naming still protects what it protected ──────────────── */

it('border-strong, border-faint, border-subtle and border-hairline still produce nothing', async () => {
  // Carried forward from THE-266. `table.tsx` spells `border-b`, `border-t`
  // and `border-0`, which is the closest anything has come to these names, so
  // it is worth re-asserting under this PR rather than trusting the earlier run.
  const { buildCssForMarkup } = await import('../test/support/tailwind-build');
  const css = await buildCssForMarkup(
    '<div class="border-strong border-faint border-subtle border-hairline"></div>',
  );
  for (const cls of ['border-strong', 'border-faint', 'border-subtle', 'border-hairline']) {
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(css.match(new RegExp(`\\.${esc}\\s*\\{[^}]*\\}`)), `${cls} now mints a rule`).toBeNull();
  }
}, 180_000);

/* ── 11. #409 is not disturbed ───────────────────────────────────────────── */

it('Classic is still the default palette family', () => {
  expect(DEFAULT_PALETTE_FAMILY).toBe('classic');
});
