import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import {
  contrastRatio,
  AA_CONTRAST,
  DARK_SURFACE,
  DARK_SURFACE_RAISED,
} from '../lib/theme';

/**
 * THE-338 — the Harvest palette FAMILY is gone; neutral grey is the only theme.
 *
 * ─── What this file replaces, and why it is not a deletion ──────────────────
 *
 * `theming-classic-palette.test.ts` used to live here. Its subject was a
 * SECOND palette family, "Classic", layered on Harvest behind a `data-palette`
 * attribute — so most of it (Classic-vs-Harvest comparisons, the two-family
 * accent derivation, the PaletteFamilyToggle layout) asserts a thing that no
 * longer exists and could only have been deleted.
 *
 * Deleting it outright would have thrown away four guards that are MORE
 * important after this change than before, so those were carried across
 * verbatim in intent and re-derived against the new single palette:
 *
 *   • the :root / .dark custom-property COUNT pins (no token may be added)
 *   • the "only one code path stamps <html>" sweep
 *   • the computed contrast floors, never eyeballed
 *   • the "no hardcoded colour outside globals.css" sweep
 *
 * ⚠️ `theming-stage3.test.ts` was NOT replaced and NOT deleted. It tests the
 * light/dark MODE axis, which this ticket did not touch — 92 of its 99 tests
 * passed against the promoted ramp with no edit at all, and the 7 that failed
 * were value pins that were repointed in place.
 *
 * ─── Nothing below is eyeballed ─────────────────────────────────────────────
 *
 * globals.css is parsed for real (postcss), every value is resolved through
 * the real cascade, and every ratio is computed with the same contrastRatio()
 * the production code uses.
 */

const ROOT = path.resolve(__dirname, '../..');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const GLOBALS_CSS = readFileSync(GLOBALS, 'utf8');

/** Declarations by selector, exactly as the cascade sees them. */
const BY_SELECTOR: Record<string, Record<string, string>> = {};
postcss.parse(GLOBALS_CSS).walkRules((rule) => {
  const sel = rule.selector.replace(/\s+/g, ' ').trim();
  rule.walkDecls((d) => {
    if (d.prop.startsWith('--')) (BY_SELECTOR[sel] ||= {})[d.prop] = d.value.trim();
  });
});

const LIGHT_SELECTOR = ':root';
const DARK_SELECTOR = '.dark, [data-theme="dark"]';
const rootVars = BY_SELECTOR[LIGHT_SELECTOR] ?? {};
const darkVars = BY_SELECTOR[DARK_SELECTOR] ?? {};

/** The lookup chain for each mode — the same order the browser resolves in. */
const CHAIN: Record<'light' | 'dark', string[]> = {
  light: [LIGHT_SELECTOR],
  dark: [DARK_SELECTOR, LIGHT_SELECTOR],
};

function rawValue(mode: 'light' | 'dark', token: string): string | undefined {
  for (const sel of CHAIN[mode]) {
    const v = BY_SELECTOR[sel]?.[token];
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Resolve a token to a literal, following `var()` chains AND their fallbacks.
 *
 * ⚠️ The fallback arm is load-bearing, not defensive. Three dark tokens
 * (--ring, --sidebar-ring, --ink-on-accent-tint) reference
 * --brand-color-on-dark / --brand-color-on-tint, which layout.tsx injects
 * per-request and globals.css therefore never declares. A resolver that
 * stopped at "not declared here" would report them unresolved and the sweep
 * below would be asserting a false alarm.
 */
function resolve(mode: 'light' | 'dark', token: string, depth = 0): string | undefined {
  if (depth > 12) return undefined;
  const v = rawValue(mode, token);
  if (v === undefined) return undefined;
  const m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (!m) return v;
  const direct = resolve(mode, m[1], depth + 1);
  if (direct !== undefined) return direct;
  const fallback = (m[2] ?? '').trim();
  if (!fallback) return undefined;
  const nested = fallback.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  return nested ? resolve(mode, nested[1], depth + 1) : fallback;
}

/** Resolve to a `#rrggbb`, or fail loudly — never silently skip a pair. */
function hex(mode: 'light' | 'dark', token: string): string {
  const v = resolve(mode, token);
  expect(v, `${token} did not resolve in ${mode}`).toBeTruthy();
  expect(v, `${token} is not a plain hex in ${mode} (got ${v})`).toMatch(/^#[0-9a-fA-F]{6}$/);
  return (v as string).toUpperCase();
}

const ratio = (mode: 'light' | 'dark', a: string, b: string) =>
  Math.round(contrastRatio(hex(mode, a), hex(mode, b)) * 100) / 100;

const luminanceOf = (h: string): number => {
  const c = (h.replace('#', '').match(/../g) as string[])
    .map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

/** Every .ts/.tsx under src/, excluding tests and fixtures. */
function sourceFiles(): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry === '__tests__' || entry === '__fixtures__' || entry === 'node_modules') continue;
        walk(p);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(p);
      }
    }
  })(path.join(ROOT, 'src'));
  return out;
}

/**
 * Source with comments and JSX comment blocks stripped.
 *
 * 🔴 THIS IS NOT TIDYING. The series that produced this ticket had ELEVEN
 * guards pass a planted defect, and one of the recorded causes was a guard
 * satisfied because a COMMENT contained the string it grepped for. Every
 * removal in this PR is documented in a comment that necessarily names the
 * thing removed ("this used to stamp data-palette"), so a naive grep over raw
 * source would find `data-palette` in the very comment explaining that it is
 * gone, and pass while the mechanism was still live.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1 · There is exactly ONE palette family
// ═══════════════════════════════════════════════════════════════════════════
describe('there is exactly ONE palette family', () => {
  it('globals.css declares custom properties in exactly two theme scopes', () => {
    const scopes = Object.keys(BY_SELECTOR).filter((s) => s !== '.excalidraw');
    expect(scopes.sort()).toEqual([DARK_SELECTOR, LIGHT_SELECTOR].sort());
  });

  it('no rule in globals.css selects on a palette attribute', () => {
    const selectors: string[] = [];
    postcss.parse(GLOBALS_CSS).walkRules((r) => { selectors.push(r.selector); });
    expect(selectors.filter((s) => s.includes('data-palette'))).toEqual([]);
  });

  it('no source file reads or writes the palette attribute', () => {
    const offenders = sourceFiles().filter((f) => codeOf(f).includes('data-palette'));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('the family storage key is read by nothing', () => {
    const offenders = sourceFiles().filter((f) => codeOf(f).includes('harvest-theme-family'));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2 · Dark mode is NEUTRAL GREY, not warm
// ═══════════════════════════════════════════════════════════════════════════
const RAMP = [
  '--surface', '--surface-raised', '--surface-sunken', '--surface-chip', '--surface-tint',
  '--border-hairline', '--border-subtle', '--border-default', '--border-strong',
  '--text-strong', '--text-heading', '--text-body', '--text-muted', '--text-faint',
] as const;

describe('dark mode is NEUTRAL GREY, not warm', () => {
  it.each(RAMP)('%s is a neutral grey in dark (R = G = B)', (token) => {
    const h = hex('dark', token);
    const [r, g, b] = (h.slice(1).match(/../g) as string[]).map((x) => parseInt(x, 16));
    expect({ token, r, g, b }).toEqual({ token, r: g, g, b: g });
  });

  /**
   * The specific warm values the Harvest family used to put on screen. Named
   * rather than inferred, so restoring any one of them fails HERE with the
   * hex in the message, not three suites away in a contrast rounding error.
   */
  it('none of Harvest’s warm dark values survives', () => {
    const WARM = ['#1A1612', '#221D18', '#120F0C', '#2E2822', '#332C26', '#463D35', '#2A2420',
      '#FAF8F5', '#D1C7BA', '#B5A692', '#998469'];
    const live = RAMP.map((t) => hex('dark', t));
    expect(live.filter((v) => WARM.includes(v))).toEqual([]);
  });

  it('the JS constants agree with the CSS, or the AA derivation is fictional', () => {
    expect(DARK_SURFACE.toUpperCase()).toBe(hex('dark', '--surface'));
    expect(DARK_SURFACE_RAISED.toUpperCase()).toBe(hex('dark', '--surface-raised'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2b · The dark ramp is DARKER than the grey it replaced
// ═══════════════════════════════════════════════════════════════════════════
describe('the dark ramp is DARKER than the neutral grey that shipped before', () => {
  /**
   * 🔴 THE FOUNDER'S FIRST COMPLAINT, AS A NUMBER: "current dark grey is
   * lighter than the one in the screenshot". These were the values on screen
   * when he said it — THE-265 had already made the neutral family the
   * default — so they are the bar this ticket had to beat, and beating it is
   * asserted rather than described.
   */
  const BEFORE: Record<string, string> = {
    '--surface': '#1C1C1C',
    '--surface-raised': '#242424',
    '--surface-sunken': '#131313',
    '--surface-chip': '#2E2E2E',
    '--surface-tint': '#1C1C1C',
  };

  it.each(Object.entries(BEFORE))('%s is strictly darker than %s', (token, before) => {
    const now = hex('dark', token);
    expect(
      luminanceOf(now),
      `${token} is ${now}, which is not darker than the ${before} the founder called too light`,
    ).toBeLessThan(luminanceOf(before));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2c · Cards stay distinguishable from the page ground
// ═══════════════════════════════════════════════════════════════════════════
describe('cards remain distinguishable from the page ground', () => {
  /**
   * ⚠️ --surface-raised INVERTS DIRECTION between modes: in light it is
   * WHITER than the ground, in dark it is LIGHTER than a dark ground. Both
   * are asserted, because darkening BOTH by the same amount would have kept
   * every ratio and still flattened the card into the page.
   */
  it('the card is lighter than the page in dark, and lighter than it was before', () => {
    expect(luminanceOf(hex('dark', '--surface-raised')))
      .toBeGreaterThan(luminanceOf(hex('dark', '--surface')));
    // 1.10:1 was the lift the previous grey shipped. Darkening must not cost it.
    expect(ratio('dark', '--surface-raised', '--surface')).toBeGreaterThanOrEqual(1.1);
  });

  it('the card is whiter than the page in light', () => {
    expect(luminanceOf(hex('light', '--surface-raised')))
      .toBeGreaterThan(luminanceOf(hex('light', '--surface')));
  });

  it('a chip still lifts off the card in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(luminanceOf(hex(mode, '--surface-chip')), `chip vs card in ${mode}`)
        .not.toBe(luminanceOf(hex(mode, '--surface-raised')));
      expect(ratio(mode, '--surface-chip', '--surface-raised')).toBeGreaterThanOrEqual(1.12);
    }
  });

  it('the sunken surface stays recessive in both modes', () => {
    expect(luminanceOf(hex('dark', '--surface-sunken')))
      .toBeLessThan(luminanceOf(hex('dark', '--surface')));
    expect(luminanceOf(hex('light', '--surface-sunken')))
      .toBeLessThan(luminanceOf(hex('light', '--surface')));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2d · Every border re-checked against the DARKER ground
// ═══════════════════════════════════════════════════════════════════════════
describe('every border still reads correctly against the darker ground', () => {
  /**
   * 🔴 THE FLOOR THAT APPLIES HERE IS NOT 5.66, AND SAYING SO IS THE POINT.
   *
   * A border is not text. WCAG has no text requirement for a hairline, and
   * every border in this app has always sat between 1.0 and 1.9:1 against its
   * own ground — a border at 5.66:1 would be a white line, which is the
   * DEFECT the founder reported, not the fix.
   *
   * So what is asserted is the property that actually matters: the ramp keeps
   * its ORDER and its SEPARATION. Each rung must be strictly brighter than the
   * one below it against the card it is drawn on, and the ramp must not
   * collapse — otherwise "darken the dividers" silently turns four distinct
   * border roles into one.
   */
  const RUNGS = ['--border-hairline', '--border-subtle', '--border-default', '--border-strong'] as const;

  /**
   * ⚠️ --border-hairline and --border-subtle are PEERS, not consecutive rungs,
   * and this test was written wrong the first time by assuming otherwise.
   * They sit within 2/255 of each other by inheritance — globals.css calls
   * them "two near-neutrals that predate the ramp" — so which of the two
   * measures fractionally higher is an accident of that history, not a
   * hierarchy. Ordering them against each other would pin an accident.
   *
   * The hierarchy that IS real, and is what a darkening pass could break, is
   * hairline/subtle < default < strong: a container edge must outrank a
   * hairline, and a control's edge must outrank a container's.
   */
  it('the border ramp keeps its hierarchy against the card, in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const r = (t: (typeof RUNGS)[number]) => ratio(mode, t, '--surface-raised');
      expect(r('--border-default'), `default vs hairline in ${mode}`).toBeGreaterThan(r('--border-hairline'));
      expect(r('--border-default'), `default vs subtle in ${mode}`).toBeGreaterThan(r('--border-subtle'));
      expect(r('--border-strong'), `strong vs default in ${mode}`).toBeGreaterThan(r('--border-default'));
    }
  });

  it('no border is invisible against the card it is drawn on', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const t of RUNGS) {
        expect(ratio(mode, t, '--surface-raised'), `${t} vanished in ${mode}`).toBeGreaterThan(1.0);
      }
    }
  });

  it('no border became a bright line on the dark card', () => {
    // The container border and every hairline stay well under 2:1 in dark;
    // above that a divider reads as a light rule rather than an edge.
    for (const t of RUNGS) {
      expect(ratio('dark', t, '--surface-raised'), `${t} is too bright on the dark card`)
        .toBeLessThan(2.0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2e · The More sheet's row dividers are DARKER than before
// ═══════════════════════════════════════════════════════════════════════════
describe('the More sheet row dividers are darker than before', () => {
  /**
   * 🔴 THE FOUNDER'S SECOND COMPLAINT, AND THE TICKET'S PREMISE WAS WRONG
   * ABOUT ITS CAUSE — which is why this test names the DOM, not a token.
   *
   * The brief assumed the dividers resolved to --border-strong (#474747,
   * 1.67:1 on the card, i.e. already subtle). They did not. The drawer drew
   * them with `divide-stone-200`, and `stone` is a HARDCODED hex scale in
   * tailwind.config.ts (`200: "#E8E2D9"`) that never themes — so the line was
   * a warm near-white at 12.06:1 against a #242424 card, ten times brighter
   * than the 1.23:1 container border beside it. That is "the lines in more
   * drawer are too white", and no amount of moving --border-strong would have
   * touched it.
   *
   * The fix is `divide-line`, which resolves to --border-default and themes.
   * This test asserts the DOM class, then the resulting ratio, so restoring
   * either the class or a bright value fails.
   */
  const DASHBOARD = readFileSync(path.join(ROOT, 'src/components/AdminDashboard.tsx'), 'utf8');

  it('the drawer’s grouped rows no longer use the unthemed stone divider', () => {
    expect(DASHBOARD).not.toContain('divide-stone-200');
  });

  it('no screen anywhere still uses the unthemed stone divider', () => {
    const offenders = sourceFiles().filter((f) => readFileSync(f, 'utf8').includes('divide-stone-200'));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('the drawer’s row group draws its dividers with the themed token', () => {
    // Discovered by pattern, never by line number — globals.css and this file
    // both moved in this PR.
    const rowGroup = DASHBOARD.split('\n').filter((l) => l.includes('divide-y') && l.includes('bg-surface-raised'));
    expect(rowGroup.length).toBeGreaterThan(0);
    for (const line of rowGroup) expect(line).toContain('divide-line');
  });

  it('the divider is dramatically darker on the dark card than the value it replaced', () => {
    const before = contrastRatio('#E8E2D9', '#242424'); // stone-200 on the old card
    const after = contrastRatio(hex('dark', '--border-default'), hex('dark', '--surface-raised'));
    expect(after).toBeLessThan(before);
    // It was 12.06:1. Anything still above 2:1 is a light rule, not an edge.
    expect(Math.round(after * 100) / 100).toBeLessThan(2.0);
    expect(Math.round(before * 100) / 100).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2f · A form field's edge is still VISIBLE
// ═══════════════════════════════════════════════════════════════════════════
describe('a form field edge is still visible', () => {
  /**
   * 🔴 --input ALIASES --border-strong, and that is why the dividers and the
   * field edges could not simply be darkened together. A decorative divider
   * may go as dark as it likes; a control whose boundary you cannot see is a
   * worse defect than a bright line.
   *
   * ⚠️ NO TOKEN WAS ADDED TO SEPARATE THEM — they were already separate. The
   * divider resolves to --border-default and the field edge to
   * --border-strong, so the roles only had to be kept apart, not created.
   */
  it('--input still resolves to --border-strong, not to the divider token', () => {
    expect(rootVars['--input']).toBe('var(--border-strong)');
    expect(hex('dark', '--input')).toBe(hex('dark', '--border-strong'));
    expect(hex('dark', '--input')).not.toBe(hex('dark', '--border-default'));
  });

  it('the field edge stays clearly brighter than a row divider, in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const edge = ratio(mode, '--input', '--surface-raised');
      const divider = ratio(mode, '--border-default', '--surface-raised');
      expect(edge, `the field edge collapsed into the divider in ${mode}`).toBeGreaterThan(divider);
      // Keep a real gap, not a rounding difference.
      expect(edge / divider).toBeGreaterThanOrEqual(1.2);
    }
  });

  it('the field edge did not get darker than the ramp it belongs to', () => {
    expect(ratio('dark', '--input', '--surface-raised')).toBeGreaterThanOrEqual(1.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3 · Light mode is plain white
// ═══════════════════════════════════════════════════════════════════════════
describe('light mode is plain white, not warm cream', () => {
  it('--surface-raised is plain white', () => {
    expect(hex('light', '--surface-raised')).toBe('#FFFFFF');
  });

  it('--surface is a neutral near-white, not Harvest cream', () => {
    expect(hex('light', '--surface')).toBe('#F7F7F7');
    expect(hex('light', '--surface')).not.toBe('#FAF8F5');
  });

  it.each(RAMP)('%s is a neutral grey in light (R = G = B)', (token) => {
    const h = hex('light', token);
    const [r, g, b] = (h.slice(1).match(/../g) as string[]).map((x) => parseInt(x, 16));
    expect({ token, r, g, b }).toEqual({ token, r: g, g, b: g });
  });

  it('none of Harvest’s warm light values survives', () => {
    const WARM = ['#FAF8F5', '#F3EEE7', '#E8E2D9', '#D6CCBE', '#2D2519', '#4A4038', '#68563F',
      '#766A5A', '#EDEBE8', '#F7F6F3'];
    expect(RAMP.map((t) => hex('light', t)).filter((v) => WARM.includes(v))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4 · Every token still resolves  (THE PROMOTION TRAP)
// ═══════════════════════════════════════════════════════════════════════════
describe('every token still resolves', () => {
  /**
   * 🔴 THIS IS THE TRAP THE TICKET EXISTS TO CATCH.
   *
   * The removed family held ONLY overrides — 14 tokens per mode, no
   * declarations of its own. Deleting the Harvest blocks and keeping it would
   * have left 153 :root and 75 .dark declarations undeclared, and `var()` on
   * an undeclared property is invalid at computed-value time: the declaration
   * that reads it drops to `unset`. No error, no warning, no failed build —
   * the app simply loses its colour. So the values were PROMOTED into :root
   * and .dark instead, and this sweep is what proves nothing was dropped on
   * the way.
   */
  const ALL_TOKENS = [...new Set([...Object.keys(rootVars), ...Object.keys(darkVars)])];

  it('every declared token resolves to a real value in light', () => {
    const dead = ALL_TOKENS.filter((t) => resolve('light', t) === undefined);
    expect(dead).toEqual([]);
  });

  it('every declared token resolves to a real value in dark', () => {
    const dead = ALL_TOKENS.filter((t) => resolve('dark', t) === undefined);
    expect(dead).toEqual([]);
  });

  it('every var() reference inside globals.css names a token that exists', () => {
    const declared = new Set(ALL_TOKENS);
    const missing = new Set<string>();
    // 🔴 COMMENTS STRIPPED FIRST. This file documents every removal in prose
    // that necessarily names what was removed, and one of the recorded ways a
    // guard in this series passed a planted defect was by matching its own
    // explanatory text. A `var(--x)` inside a worked example in a comment is
    // not a reference the browser ever resolves.
    const cssCode = GLOBALS_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of cssCode.matchAll(/var\(\s*(--[\w-]+)/g)) {
      // --brand-color-on-dark / -on-tint are injected per-request by
      // layout.tsx and are always read through a fallback; see resolve().
      if (m[1].startsWith('--brand-color-on-')) continue;
      // --color-* and --tw-* are TAILWIND's own theme namespace, declared by
      // the framework's theme layer rather than by this file. The preflight
      // compatibility block at the top reads --color-gray-200/400 on purpose.
      if (m[1].startsWith('--color-') || m[1].startsWith('--tw-')) continue;
      // --radius-* is Tailwind v4's own default theme (0.25/0.375/0.5/0.75rem),
      // deliberately NOT re-pointed at --radius; --font-display is injected by
      // next/font from layout.tsx. Neither is this file's to declare.
      if (m[1].startsWith('--radius-') || m[1] === '--font-display') continue;
      if (!declared.has(m[1])) missing.add(m[1]);
    }
    expect([...missing]).toEqual([]);
  });

  it('the promotion neither added nor dropped a declaration', () => {
    // 167 in :root and 89 in .dark, exactly as before the family was removed.
    // A token ADDED to bridge the two roles would fail here — see TEST 2f for
    // why none was needed.
    expect({ root: Object.keys(rootVars).length, dark: Object.keys(darkVars).length })
      .toEqual({ root: 167, dark: 89 });
  });

  it('color-scheme: dark survived the promotion', () => {
    let found = false;
    postcss.parse(GLOBALS_CSS).walkRules((r) => {
      if (/\.dark|\[data-theme="dark"\]/.test(r.selector)) {
        r.walkDecls('color-scheme', () => { found = true; });
      }
    });
    expect(found).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5 · Every text-on-surface pair clears the floor, in BOTH modes
// ═══════════════════════════════════════════════════════════════════════════
describe('every text-on-surface pair clears the recorded floors', () => {
  const TEXTS = ['--text-strong', '--text-heading', '--text-body', '--text-muted', '--text-faint'] as const;
  const GROUNDS = ['--surface', '--surface-raised', '--surface-sunken'] as const;

  /**
   * ⚠️ THE 5.66 / 5.69 FLOORS ARE NOT NEUTRAL-RAMP FLOORS, and treating them
   * as such is how this test would have become a lie.
   *
   * Both are the SAME pair, rounded: --primary-foreground (--earth #2D2519)
   * on --primary (the gold #C9963A), which measures 5.6876:1. Neither
   * --primary nor --earth is part of the surface ramp and neither is
   * overridden in either mode, so darkening the grey CANNOT move that pair —
   * it is asserted separately, below.
   *
   * What the ramp is held to is AA (4.5) as the hard floor, plus a
   * NO-REGRESSION rule against the grey that shipped before this ticket.
   * Darkening a ground can only improve text contrast, so the no-regression
   * rule is the one that would actually catch a mistake here.
   */
  it.each(TEXTS.flatMap((t) => GROUNDS.map((g) => [t, g] as const)))(
    '%s on %s clears AA in both modes',
    (text, ground) => {
      for (const mode of ['light', 'dark'] as const) {
        expect(ratio(mode, text, ground), `${text} on ${ground} in ${mode}`)
          .toBeGreaterThanOrEqual(AA_CONTRAST);
      }
    },
  );

  /** The ratios the previous neutral grey produced. Nothing may go below one. */
  const BEFORE_DARK: Record<string, Record<string, number>> = {
    '--text-strong': { '--surface': 15.22, '--surface-raised': 13.87, '--surface-sunken': 16.6 },
    '--text-body': { '--surface': 10.61, '--surface-raised': 9.67, '--surface-sunken': 11.57 },
    '--text-muted': { '--surface': 7.42, '--surface-raised': 6.76, '--surface-sunken': 8.09 },
    '--text-faint': { '--surface': 5.76, '--surface-raised': 5.25, '--surface-sunken': 6.28 },
  };

  it('no dark text pair regressed against the grey that shipped before', () => {
    const regressions: string[] = [];
    for (const [text, grounds] of Object.entries(BEFORE_DARK)) {
      for (const [ground, before] of Object.entries(grounds)) {
        const now = ratio('dark', text, ground);
        if (now < before) regressions.push(`${text} on ${ground}: ${now} < ${before}`);
      }
    }
    expect(regressions).toEqual([]);
  });

  it('the text ramp stays monotonic in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const rs = (['--text-strong', '--text-body', '--text-muted', '--text-faint'] as const)
        .map((t) => ratio(mode, t, '--surface'));
      expect({ mode, rs }).toEqual({ mode, rs: [...rs].sort((a, b) => b - a) });
    }
  });

  it('the 5.69 gold pair is untouched by the ramp change', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(ratio(mode, '--primary-foreground', '--primary')).toBe(5.69);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 6 · The accent is unchanged
// ═══════════════════════════════════════════════════════════════════════════
describe('the accent is unchanged', () => {
  /**
   * 🔴 REPORTED, NOT DECIDED. The founder asked to remove the harvest THEME
   * and make the dark ground grey; he did not mention the gold. The removed
   * family deliberately never overrode the accent — "a Classic gold button or
   * focus ring looks exactly like a Harvest one" — and --brand-color is
   * white-label, replaced per tenant at runtime, which makes it a different
   * axis from the surface family. So it stays, and this test pins it so that
   * changing it has to be a decision someone takes on purpose.
   */
  it('the brand accent keeps its exact value in both modes', () => {
    expect(hex('light', '--brand-color')).toBe('#C9963A');
    expect(hex('dark', '--brand-color')).toBe('#C9963A');
    expect(hex('light', '--color-primary')).toBe('#C9963A');
  });

  it('the ink on gold is still --earth, in both modes', () => {
    expect(hex('light', '--primary-foreground')).toBe('#2D2519');
    expect(hex('dark', '--primary-foreground')).toBe('#2D2519');
  });

  it('the accent-derived tokens are still accent-derived, not greyed', () => {
    for (const t of ['--surface-gold', '--border-gold', '--glow-gold', '--ring-gold']) {
      const light = rawValue('light', t) ?? '';
      const dark = rawValue('dark', t) ?? '';
      expect(`${t}:${light}${dark}`).toMatch(/brand-color|wheat/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 7 · The accepted low-contrast exceptions were NOT "fixed"
// ═══════════════════════════════════════════════════════════════════════════
describe('the accepted low-contrast exceptions are preserved', () => {
  /**
   * ⚠️ KNOWN AND ACCEPTED. A chart series is a categorical encoding, not
   * text, and re-hueing one to chase a text ratio makes the same data render
   * differently between screens. These are pinned so that "fixing" them is a
   * deliberate act, not a side effect of a palette change.
   *
   * The numbers moved with the light ground (#FAF8F5 cream -> #F7F7F7), which
   * is exactly what this ticket changed, so they are re-recorded rather than
   * frozen at their pre-promotion values — but they are still LOW, which is
   * the property being preserved.
   */
  it('--chart-4 and --chart-5 stay low-contrast on the light ground', () => {
    expect(ratio('light', '--chart-4', '--background')).toBeLessThan(2.0);
    expect(ratio('light', '--chart-5', '--background')).toBeLessThan(2.5);
  });

  it('progress still paints bg-primary on bg-muted at its accepted low ratio', () => {
    expect(ratio('light', '--primary', '--muted')).toBeLessThan(3.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 8 · The palette toggle is gone from every surface
// ═══════════════════════════════════════════════════════════════════════════
describe('the palette toggle is gone from every surface', () => {
  it('the component file no longer exists', () => {
    expect(existsSync(path.join(ROOT, 'src/components/PaletteFamilyToggle.tsx'))).toBe(false);
  });

  it('nothing imports or renders it', () => {
    const offenders = sourceFiles().filter((f) => codeOf(f).includes('PaletteFamilyToggle'));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('the two settings surfaces that mounted it still render the mode toggle', () => {
    for (const f of ['src/components/Profile.tsx', 'src/components/AdminSettings.tsx']) {
      expect(readFileSync(path.join(ROOT, f), 'utf8')).toContain('<ThemeToggle');
    }
  });

  it('the hook no longer exposes a family axis', () => {
    const code = codeOf(path.join(ROOT, 'src/lib/use-theme.ts'));
    for (const gone of ['setPalette', 'PaletteFamily', 'palettes']) {
      expect(code, `${gone} is still part of the hook contract`).not.toContain(gone);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 9 · No hardcoded colour was introduced outside globals.css
// ═══════════════════════════════════════════════════════════════════════════
describe('no hardcoded colour outside globals.css', () => {
  /**
   * Carried across from the file this replaces. Scoped to the files THIS
   * ticket touched: a repo-wide hex sweep is a different (and much larger)
   * standing guard, and one that fails for reasons unrelated to this change
   * teaches nothing.
   */
  const TOUCHED = [
    'src/components/AdminDashboard.tsx',
    'src/components/AdminCRM.tsx',
    'src/components/AdminRoles.tsx',
    'src/lib/theme-runtime.ts',
    'src/lib/use-theme.ts',
  ];

  /**
   * 🔴 PRE-EXISTING, NAMED, AND NOT INTRODUCED HERE — and worth reporting
   * rather than allowlisting silently.
   *
   * AdminRoles.tsx styles itself with inline `style` objects rather than
   * classes, and three of its fills are still raw literals that no theming
   * pass could reach: a `#F2F2F2` count pill and a `#F5F5F5` / `#fff` icon
   * disc. They are pinned LIGHT, so on the dark card they render as bright
   * blocks — the same class of defect as the drawer's stone divider, in a
   * file THE-181 only partly converted.
   *
   * They collide with this ticket's ramp only by coincidence: the promoted
   * neutral ramp happens to contain #F2F2F2 (dark --text-strong) and #F5F5F5
   * (light --surface-tint). Listing them BY VALUE keeps the sweep sharp — a
   * ramp colour this ticket introduced anywhere still fails — while not
   * claiming credit for a defect it did not create or fix.
   */
  const PRE_EXISTING: Record<string, string[]> = {
    'src/components/AdminRoles.tsx': ['#F2F2F2', '#F5F5F5', '#FFFFFF', '#242424'],
  };

  it.each(TOUCHED)('%s introduces no new literal ramp hex', (rel) => {
    const code = codeOf(path.join(ROOT, rel));
    const ramp = [...RAMP.map((t) => hex('light', t)), ...RAMP.map((t) => hex('dark', t))];
    const allowed = PRE_EXISTING[rel] ?? [];
    const found = ramp.filter((h) => code.toUpperCase().includes(h) && !allowed.includes(h));
    expect(found, `${rel} hardcodes a ramp colour that belongs in globals.css`).toEqual([]);
  });

  it('the stamping path is still the only one', () => {
    const ALLOWED = ['src/lib/theme-runtime.ts', 'src/app/layout.tsx'];
    const offenders = sourceFiles()
      .filter((f) => /setAttribute\(\s*['"]data-theme['"]|classList\.(toggle|add|remove)\(\s*['"]dark['"]/.test(codeOf(f)))
      .map((f) => path.relative(ROOT, f))
      .filter((f) => !ALLOWED.includes(f));
    expect(offenders).toEqual([]);
  });
});
