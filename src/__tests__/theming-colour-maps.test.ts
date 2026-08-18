import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { contrastRatio, AA_CONTRAST } from '../lib/theme';
import { PREAUTH_PATHS, isPreAuthPath } from '../lib/preauth-theme';
import tw from '../../tailwind.config';

/**
 * THE-136 (reopened) — the semantic colour maps.
 *
 * PR 326 fixed two surfaces. The founder reported dark mode still broken, and
 * AdminCRM proved why: a contact whose type is `both` rendered a white pill with
 * invisible text, live, after PR 322 had already "fixed" that badge. PR 322
 * added the UNKNOWN fallback and computed contrast for it — but the fallback is
 * the one branch a real contact almost never takes. `donor` and `both` were
 * never resolved at all, so a 1.01:1 pill shipped under a passing test.
 *
 * The bug is therefore not a file, it is a SHAPE: a lookup table that maps a
 * semantic value (a contact type, a status) to a FIXED LIGHT class string. The
 * surface stays light while the ink on it inverts, and the text disappears.
 *
 * So this file does not target files. It targets every colour map in src, by
 * name, and asserts EVERY BRANCH of each — never just the fallback. That is the
 * method guard: the assertion PR 322 was missing, generalised so the class
 * cannot come back.
 *
 * As in PR 322 (theming-stage3), PR 323 (theming-stage4) and PR 326
 * (theming-inputs-lists), nothing here is asserted against a hex. Every branch
 * is read out of the REAL source, resolved through the REAL Tailwind config to
 * the custom properties behind it, looked up in the REAL brace-matched blocks in
 * globals.css, and every ratio is COMPUTED. A test that pinned a passing number
 * would keep passing after the palette moved, which is the failure mode these
 * exist to prevent.
 *
 * Targets are named by their LABEL — the map a reader can point at — never by
 * the value pattern they happen to render today.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');

const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/**
 * A badge sits on a card, so the card is the ground its fill composites over
 * and the ground a fill must stay distinguishable from. --surface-raised, in
 * each theme's own value.
 */
const BACKSTOP = { light: '#FFFFFF', dark: '#221D18' } as const;
type Theme = keyof typeof BACKSTOP;

/** Non-text contrast floor (WCAG 1.4.11) — used for the pill fill itself. */
const NON_TEXT_CONTRAST = 3;

// ── globals.css ─────────────────────────────────────────────────────────────

function varsIn(css: string, selectorTest: (sel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim();
    });
  });
  return out;
}

let lightVars: Record<string, string>;
let darkVars: Record<string, string>;

beforeAll(() => {
  const css = readFileSync(GLOBALS, 'utf8');
  lightVars = varsIn(css, (s) => s === ':root');
  darkVars = varsIn(css, (s) => /\.dark|\[data-theme="dark"\]/.test(s));
});

/** A dark lookup that falls back to light, exactly as the cascade does. */
const inTheme = (theme: Theme) => (name: string): string | undefined =>
  theme === 'dark' ? darkVars[name] ?? lightVars[name] : lightVars[name];

// ── colour evaluation ───────────────────────────────────────────────────────
// Enough of a CSS colour evaluator for the forms these maps and globals.css
// actually use: hex, `R G B` channel triplets, var() chains with fallbacks,
// rgb(), and color-mix() over either `transparent` or a second colour.

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();

const parseHex = (h: string): [number, number, number] => {
  const v = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
};

function resolveColor(
  expr: string | undefined,
  lookup: (n: string) => string | undefined,
  backdrop: string,
  depth = 0,
): string | null {
  if (!expr || depth > 12) return null;
  const v = expr.trim().replace(/^["']|["']$/g, '').trim();

  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    const [a, b, c] = v.slice(1);
    return `#${a}${a}${b}${b}${c}${c}`.toUpperCase();
  }
  if (/^white$/i.test(v)) return '#FFFFFF';
  if (/^black$/i.test(v)) return '#000000';
  if (/^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(v)) {
    const [r, g, b] = v.split(/\s+/).map(Number);
    return toHex(r, g, b);
  }

  const varMatch = v.match(/^var\((--[a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/i);
  if (varMatch) {
    const direct = resolveColor(lookup(varMatch[1]), lookup, backdrop, depth + 1);
    if (direct) return direct;
    return varMatch[2] ? resolveColor(varMatch[2], lookup, backdrop, depth + 1) : null;
  }

  const rgbMatch = v.match(/^rgba?\(\s*([\s\S]+?)\s*(?:\/[^)]*)?\)$/i);
  if (rgbMatch && !/^color-mix/i.test(v)) {
    return resolveColor(rgbMatch[1].replace(/,/g, ' '), lookup, backdrop, depth + 1);
  }

  // color-mix(in srgb, <colour> P%, <transparent | colour>)
  const mix = v.match(
    /^color-mix\(\s*in\s+srgb\s*,\s*([\s\S]+?)\s+(\d+(?:\.\d+)?)%\s*,\s*([\s\S]+?)\s*\)$/i,
  );
  if (mix) {
    const fg = resolveColor(mix[1], lookup, backdrop, depth + 1);
    if (!fg) return null;
    const over = /^transparent$/i.test(mix[3].trim())
      ? backdrop
      : resolveColor(mix[3], lookup, backdrop, depth + 1);
    if (!over) return null;
    const alpha = Number(mix[2]) / 100;
    const [fr, fg2, fb] = parseHex(fg);
    const [br, bg, bb] = parseHex(over);
    return toHex(
      fr * alpha + br * (1 - alpha),
      fg2 * alpha + bg * (1 - alpha),
      fb * alpha + bb * (1 - alpha),
    );
  }

  return null;
}

// ── Tailwind class → colour expression, through the real config ─────────────

const twExtend = (tw.theme?.extend ?? {}) as Record<string, Record<string, unknown>>;
const twColors = (twExtend.colors ?? {}) as Record<string, unknown>;
const twTextColor = (twExtend.textColor ?? {}) as Record<string, unknown>;

/** Index `surface-raised` / `field-100` / `strong` into a config colour group. */
function lookupScale(group: Record<string, unknown>, rest: string): string | null {
  const parts = rest.split('-');
  for (let i = parts.length; i > 0; i -= 1) {
    const head = parts.slice(0, i).join('-');
    const tail = parts.slice(i).join('-');
    const entry = group[head];
    if (entry == null) continue;
    if (typeof entry === 'string') {
      if (!tail) return entry;
      continue;
    }
    const key = tail || 'DEFAULT';
    const value = (entry as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

/**
 * Resolve a utility class to the colour expression Tailwind emits for it, using
 * the project's own config rather than a copy that can drift.
 *
 * `undefined` means the class carries no colour at all (padding, radius, …).
 * A NAMED colour class that the config does not define is NOT null — it falls
 * through to Tailwind's stock palette, which is a fixed hex in both themes. That
 * distinction is the whole point of section 3, so it is returned rather than
 * swallowed: `bg-orange-100` is a real colour, it simply cannot theme.
 */
function classToExpr(cls: string): string | null {
  const bare = cls.replace(/^(?:hover|focus|active|group-hover|placeholder|dark):/g, '');

  const arbitrary = bare.match(/^(?:bg|text|border|ring|divide)-\[([^\]]+)\]$/);
  if (arbitrary) {
    const inner = arbitrary[1].replace(/_/g, ' ');
    return /^(?:#|rgb|hsl|color-mix|var\()/i.test(inner) ? inner : null;
  }

  const named = bare.match(/^(bg|text|border|ring|divide|placeholder)-(.+)$/);
  if (!named) return null;
  const [, prefix, rest] = named;
  if (/^(?:transparent|current|inherit)$/.test(rest)) return null;

  const fromConfig =
    prefix === 'text'
      ? lookupScale(twTextColor, rest) ?? lookupScale(twColors, rest)
      : lookupScale(twColors, rest);
  if (fromConfig) return fromConfig;

  // Not in the project config — Tailwind's own palette answers instead.
  const stock = (STOCK_PALETTE as Record<string, Record<string, string>>)[rest.split('-')[0]];
  const shade = rest.split('-').slice(1).join('-');
  return stock?.[shade] ?? null;
}

/**
 * The stock Tailwind values for the families the project did NOT tokenise. Only
 * the hues actually spelled in src need an entry; the list exists so an
 * untokenised class resolves to the fixed hex it really renders instead of
 * silently reading as "no colour here".
 */
const STOCK_PALETTE = {
  orange: { '50': '#fff7ed', '100': '#ffedd5', '200': '#fed7aa', '600': '#ea580c', '700': '#c2410c', '800': '#9a3412' },
} as const;

/** The colour-bearing class of a given kind in a space-separated class string. */
function colorClass(classes: string, kind: 'bg' | 'text'): string | null {
  const hits = classes
    .split(/\s+/)
    .filter((c) => new RegExp(`^(?:hover:|focus:)?${kind}-`).test(c))
    .filter((c) => classToExpr(c) !== null);
  return hits.length ? hits[hits.length - 1] : null;
}

// ── reading the maps out of the source, BY NAME ─────────────────────────────

/** The `{ … }` initialiser of `const NAME…= {`, brace-matched. */
function mapBody(src: string, name: string): string {
  const start = src.search(new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*\\{`));
  expect(start, `no map named ${name}`).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated map ${name}`);
}

/** Every `branch: 'classes'` pair of a named map, in source order. */
function branchesOf(rel: string, name: string): Array<[string, string]> {
  const body = mapBody(read(rel), name);
  const out: Array<[string, string]> = [];
  for (const m of body.matchAll(/^\s*'?([A-Za-z0-9_$]+)'?\s*:\s*'([^']*)'/gm)) out.push([m[1], m[2]]);
  expect(out.length, `${name} parsed to zero branches`).toBeGreaterThan(0);
  return out;
}

/** A single-string constant, e.g. the CRM's UNKNOWN fallback. */
function constString(rel: string, name: string): string {
  const m = read(rel).match(new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*'([^']*)'`));
  expect(m, `no string const named ${name}`).not.toBeNull();
  return m![1];
}

// ═══════════════════════════════════════════════════════════════════════════
// the surfaces in scope, named by label
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every colour map in src, found by an exhaustive scan (section 3 re-runs that
 * scan and fails if this list ever falls behind). They are ALL listed, not just
 * the ones this PR changed — a map that is already correct still has to prove it
 * on every branch, or "correct" is just an assumption nobody rechecked.
 *
 * src/components/ds/* is deliberately absent: fourteen token-correct primitives
 * with zero importers. Nothing a church can see renders them, and adopting them
 * is a rewrite (PR 326), not a legibility fix.
 */
interface Surface {
  /** What a reader points at. Used as the test name. */
  label: string;
  file: string;
  map?: string;
  /** A separate const holding the branch taken when the map lookup misses. */
  fallback?: string;
  /**
   * Named single-string class constants, for a surface whose variants are too
   * few to be a map but which is still one colour decision spelled once. Held to
   * exactly the same assertions — the bug does not care whether the repetition
   * was indexed.
   */
  consts?: string[];
}

const SURFACES: Surface[] = [
  {
    label: 'the CRM type badge',
    file: 'components/AdminCRM.tsx',
    map: 'TYPE_COLORS',
    fallback: 'UNKNOWN_TYPE_COLOR',
  },
  {
    label: 'the CRM giving pills',
    file: 'components/AdminCRM.tsx',
    consts: ['GIVING_PILL', 'GIVING_PILL_ERROR'],
  },
  { label: 'the shared admin status badge', file: 'components/admin/AdminUI.tsx', map: 'BADGE_TONES' },
  { label: 'the tenant plan badge', file: 'components/AdminTenants.tsx', map: 'PLAN_COLORS' },
  { label: 'the tenant status badge', file: 'components/AdminTenants.tsx', map: 'STATUS_COLORS' },
  { label: 'the accounting document type badge', file: 'components/AdminAccounting.tsx', map: 'TYPE_COLORS' },
  { label: 'the accounting document status badge', file: 'components/AdminAccounting.tsx', map: 'STATUS_COLORS' },
  { label: 'the event status badge', file: 'components/AdminEvents.tsx', map: 'STATUS_COLORS' },
  { label: 'the billing status badge', file: 'components/BillingAndPayments.tsx', map: 'STATUS_STYLES' },
];

/** Every branch of a surface: its map, its named constants, and its fallback. */
function allBranches(s: Surface): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (s.map) out.push(...branchesOf(s.file, s.map));
  for (const name of s.consts ?? []) out.push([name, constString(s.file, name)]);
  if (s.fallback) out.push([`${s.fallback} (fallback)`, constString(s.file, s.fallback)]);
  expect(out.length, `${s.label} resolved to zero branches`).toBeGreaterThan(0);
  return out;
}

/**
 * The source text a surface is spelled in — its map initialiser plus any named
 * constants. This is what the literal/inline-style/dark-variant scans read, so a
 * surface declared as constants is held to the same rules as one declared as a
 * map.
 */
function sourceOf(s: Surface): string {
  const src = read(s.file);
  const parts = s.map ? [mapBody(src, s.map)] : [];
  for (const name of [...(s.consts ?? []), ...(s.fallback ? [s.fallback] : [])]) {
    const m = src.match(new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*'[^']*'`));
    if (m) parts.push(m[0]);
  }
  return parts.join('\n');
}

/** The resolved ink/fill pair for one branch in one theme. */
function pairFor(classes: string, theme: Theme): { ink: string; fill: string } {
  const lookup = inTheme(theme);
  const backdrop = BACKSTOP[theme];

  const bg = colorClass(classes, 'bg');
  const fg = colorClass(classes, 'text');
  expect(bg, `"${classes}" names no background colour`).not.toBeNull();
  expect(fg, `"${classes}" names no text colour`).not.toBeNull();

  const fill = resolveColor(classToExpr(bg!)!, lookup, backdrop);
  expect(fill, `${theme}: could not resolve ${bg}`).not.toBeNull();
  // Ink composites over the fill it sits on, not over the card.
  const ink = resolveColor(classToExpr(fg!)!, lookup, fill!);
  expect(ink, `${theme}: could not resolve ${fg}`).not.toBeNull();

  return { ink: ink!, fill: fill! };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · the regression
// ═══════════════════════════════════════════════════════════════════════════

const CRM = SURFACES[0];
/**
 * The CRM badge's own map name, narrowed once. `Surface.map` is optional so a
 * surface can be declared as named constants instead (the giving pills below),
 * but this section is specifically about the map, so it asserts that rather than
 * asserting non-null at each use.
 */
const CRM_MAP = CRM.map!;

describe('the CRM type badge is readable in dark mode for every known type', () => {
  /**
   * The branches of the map itself — donor, member, both — NOT the fallback.
   *
   * PR 322 asserted the fallback and shipped a 1.01:1 `both` pill. `both` is a
   * real contact type a church selects in the UI, so it is named here
   * explicitly: if this map ever stops offering it, that is a product change
   * that should break a test, not silently shrink the coverage.
   */
  it('every known type is still a branch of the map', () => {
    const keys = branchesOf(CRM.file, CRM_MAP).map(([k]) => k);
    expect(keys, 'a contact type stopped being coloured').toEqual(['donor', 'member', 'both']);
  });

  it.each(branchesOf(CRM.file, CRM_MAP))('type "%s" clears AA on dark', (branch, classes) => {
    const { ink, fill } = pairFor(classes, 'dark');
    const r = contrastRatio(ink, fill);
    expect(
      r,
      `dark: type "${branch}" renders ${ink} on ${fill} — ${r.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it.each(branchesOf(CRM.file, CRM_MAP))('the "%s" pill is visible against the card on dark', (branch, classes) => {
    // The half PR 322 could not have caught by looking at ink alone: a pill whose
    // fill is a fixed light value is a white block on the dark card even when the
    // text on it happens to contrast.
    const { fill } = pairFor(classes, 'dark');
    const r = contrastRatio(fill, BACKSTOP.dark);
    expect(
      r,
      `dark: the "${branch}" pill fill ${fill} is ${r.toFixed(2)}:1 against the card — a bright block on a dark ground`,
    ).toBeLessThanOrEqual(NON_TEXT_CONTRAST + 1e-9);
  });

  it('the unknown fallback still clears AA on dark', () => {
    // PR 322's assertion, kept. It was never wrong — only insufficient.
    const { ink, fill } = pairFor(constString(CRM.file, CRM.fallback!), 'dark');
    expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · the same badge, light
// ═══════════════════════════════════════════════════════════════════════════

describe('the CRM type badge is still readable in light mode', () => {
  it.each(allBranches(CRM))('type "%s" clears AA on light', (branch, classes) => {
    const { ink, fill } = pairFor(classes, 'light');
    const r = contrastRatio(ink, fill);
    expect(
      r,
      `light: type "${branch}" renders ${ink} on ${fill} — ${r.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · the method guard
// ═══════════════════════════════════════════════════════════════════════════

describe('every branch of every colour map resolves to a property defined in the dark block', () => {
  const everyBranch = SURFACES.flatMap((s) =>
    allBranches(s).map(([branch, classes]) => [s.label, branch, classes] as const),
  );

  /**
   * The assertion PR 322 was missing, stated structurally rather than by ratio:
   * a branch whose classes resolve to a literal cannot theme AT ALL, whatever
   * its light contrast happens to be. `bg-orange-100` resolves through the real
   * config to #ffedd5 — a well-formed class that renders the same pixel in both
   * themes — and no contrast assertion on the light theme would ever notice.
   */
  it.each(everyBranch)('%s / "%s" names a custom property for both fill and ink', (label, branch, classes) => {
    for (const kind of ['bg', 'text'] as const) {
      const cls = colorClass(classes, kind);
      expect(cls, `${label} / "${branch}" names no ${kind} colour`).not.toBeNull();
      const expr = classToExpr(cls!)!;
      expect(
        expr,
        `${label} / "${branch}": ${cls} resolves to ${expr}, a fixed value with no custom property — it renders identically in both themes`,
      ).toMatch(/var\(--[a-z0-9-]+/);
    }
  });

  /**
   * The tenant accent is the SINGLE exemption, exactly as PR 323's test names
   * it: globals.css refuses to give --brand-color a dark value on purpose, so a
   * fill legitimately derived from the accent cannot be required to redeclare
   * it. Giving a tenant accent an on-dark variant is THE-111.
   *
   * The exemption is on the token, not on the branch: a branch that names ONLY
   * the accent still fails, because then nothing about it themes.
   */
  const ACCENT_EXEMPT = '--brand-color';

  it.each(everyBranch)('%s / "%s" resolves every property it names inside the dark block', (label, branch, classes) => {
    for (const kind of ['bg', 'text'] as const) {
      const expr = classToExpr(colorClass(classes, kind)!)!;
      const named = [...expr.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
      const themeable = named.filter((t) => t !== ACCENT_EXEMPT);
      expect(
        themeable,
        `${label} / "${branch}": ${kind} names only the tenant accent, which has no dark value by design — nothing here themes`,
      ).not.toHaveLength(0);
      for (const token of themeable) {
        expect(
          darkVars[token],
          `${label} / "${branch}": ${token} has no value in globals.css's dark block, so it keeps its light value on a dark ground`,
        ).toBeDefined();
      }
    }
  });

  it('the scan finds no colour map that this file does not list', () => {
    // The list above is only trustworthy if nothing can be added behind it. This
    // re-runs the discovery that produced it and fails on anything unlisted, so a
    // new map cannot ship unguarded.
    function walk(dir: string, out: string[] = []): string[] {
      for (const e of readdirSync(dir)) {
        const p = path.join(dir, e);
        if (statSync(p).isDirectory()) {
          if (e !== '__tests__' && e !== 'node_modules' && e !== 'ds') walk(p, out);
        } else if (/\.tsx?$/.test(e) && !/\.test\./.test(e)) out.push(p);
      }
      return out;
    }

    const listed = new Set(SURFACES.map((s) => `${s.file}:${s.map}`));
    const found: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file);
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bconst\s+([A-Z][A-Z_0-9]*)\s*(?::[^=]+)?=\s*\{/g)) {
        const body = mapBody(src, m[1]);
        const entries = [...body.matchAll(/^\s*'?[A-Za-z0-9_$]+'?\s*:\s*'([^']*)'/gm)];
        const colourful = entries.filter(([, v]) => colorClass(v, 'bg') && colorClass(v, 'text'));
        if (colourful.length >= 2 && !listed.has(`${rel}:${m[1]}`)) found.push(`${rel}: ${m[1]}`);
      }
    }
    expect(found, 'a colour map exists that no test in this file covers').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · each surface in scope, dark
// ═══════════════════════════════════════════════════════════════════════════

describe('each surface in scope is readable in dark mode', () => {
  for (const s of SURFACES) {
    it(`${s.label} clears AA on dark for every branch`, () => {
      const failures = allBranches(s)
        .map(([branch, classes]) => {
          const { ink, fill } = pairFor(classes, 'dark');
          return { branch, ink, fill, r: contrastRatio(ink, fill) };
        })
        .filter((x) => x.r < AA_CONTRAST)
        .map((x) => `"${x.branch}": ${x.ink} on ${x.fill} = ${x.r.toFixed(2)}:1`);
      expect(failures, `${s.label} has unreadable branches on dark`).toEqual([]);
    });

    it(`${s.label} keeps every pill fill off the dark card`, () => {
      const glaring = allBranches(s)
        .map(([branch, classes]) => {
          const { fill } = pairFor(classes, 'dark');
          return { branch, fill, r: contrastRatio(fill, BACKSTOP.dark) };
        })
        .filter((x) => x.r > NON_TEXT_CONTRAST)
        .map((x) => `"${x.branch}": ${x.fill} = ${x.r.toFixed(2)}:1 against the card`);
      expect(glaring, `${s.label} renders a bright block on the dark ground`).toEqual([]);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · each surface in scope, light — the no-regression test
// ═══════════════════════════════════════════════════════════════════════════

describe('each surface in scope is still readable in light mode', () => {
  for (const s of SURFACES) {
    it(`${s.label} clears AA on light for every branch`, () => {
      const failures = allBranches(s)
        .map(([branch, classes]) => {
          const { ink, fill } = pairFor(classes, 'light');
          return { branch, ink, fill, r: contrastRatio(ink, fill) };
        })
        .filter((x) => x.r < AA_CONTRAST)
        .map((x) => `"${x.branch}": ${x.ink} on ${x.fill} = ${x.r.toFixed(2)}:1`);
      expect(failures, `${s.label} has unreadable branches on light`).toEqual([]);
    });

    it(`${s.label} keeps every pill fill visible on the light card`, () => {
      // The mirror of the dark check: a tint that matches the card it sits on is
      // not a tint, it is nothing. Guards against "fixing" dark by flattening light.
      const flat = allBranches(s)
        .map(([branch, classes]) => {
          const { fill } = pairFor(classes, 'light');
          return { branch, fill, r: contrastRatio(fill, BACKSTOP.light) };
        })
        .filter((x) => x.r < 1.02)
        .map((x) => `"${x.branch}": ${x.fill} = ${x.r.toFixed(3)}:1 against the card`);
      expect(flat, `${s.label} has a pill that vanishes into the light card`).toEqual([]);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · no new literals
// ═══════════════════════════════════════════════════════════════════════════

describe('no hex, rgb() or inline colour is introduced', () => {
  it.each(SURFACES.map((s) => [s.label, s] as const))(
    "%s's map body contains no colour literal",
    (label, s) => {
      const body = sourceOf(s);
      const literals = [...body.matchAll(/#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g)].map(
        (m) => m[0],
      );
      expect(
        literals,
        `${label} pins a colour literal, which opts those branches out of theming`,
      ).toEqual([]);
    },
  );

  it.each(SURFACES.map((s) => [s.label, s] as const))(
    '%s renders through classes, not an inline style',
    (label, s) => {
      const body = sourceOf(s);
      expect(body, `${label} carries an inline style object, which no class guard can see`).not.toMatch(
        /style\s*[:=]|background(?:Color)?\s*:/,
      );
    },
  );

  it('no branch anywhere mixes a themeable colour toward a fixed light one', () => {
    // The exact shape of the shipped bug: color-mix(…, white) is well-formed and
    // themeable-looking, and its result is pinned light regardless of theme.
    const offenders: string[] = [];
    for (const s of SURFACES) {
      for (const [branch, classes] of allBranches(s)) {
        for (const kind of ['bg', 'text'] as const) {
          const cls = colorClass(classes, kind);
          if (!cls) continue;
          const expr = classToExpr(cls)!;
          if (/color-mix\([^)]*\b(?:white|black|#[0-9A-Fa-f]{3,8})\s*\)/i.test(expr)) {
            offenders.push(`${s.label} / "${branch}": ${expr}`);
          }
        }
      }
    }
    expect(offenders, 'a branch is pinned to a fixed light value by its mix operand').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · the accent
// ═══════════════════════════════════════════════════════════════════════════

describe('the tenant accent is still not inverted', () => {
  it('--brand-color has no dark value', () => {
    expect(
      darkVars['--brand-color'],
      'inverting the tenant accent is THE-111 and is a separate decision',
    ).toBeUndefined();
  });

  it('the on-dark variant is still derived rather than overriding the accent', () => {
    expect(lightVars['--brand-color-on-dark']).toBe('var(--brand-color)');
  });

  it('the gold branches still reach the accent rather than a pinned gold', () => {
    // Fixing a gold pill by pinning it to Harvest's own wheat scale would make
    // every white-label tenant's badge the wrong brand. --surface-gold is the
    // token that stays tenant-aware in both themes, so the gold branches must
    // still arrive at --brand-color through it.
    const goldish = [
      ['the CRM type badge', 'components/AdminCRM.tsx', 'TYPE_COLORS', 'donor'],
      ['the shared admin status badge', 'components/admin/AdminUI.tsx', 'BADGE_TONES', 'gold'],
    ] as const;
    for (const [label, file, map, branch] of goldish) {
      const classes = branchesOf(file, map).find(([k]) => k === branch)?.[1];
      expect(classes, `${label} lost its "${branch}" branch`).toBeDefined();
      const expr = classToExpr(colorClass(classes!, 'bg')!)!;
      const chain = [expr, ...[...expr.matchAll(/var\((--[a-z0-9-]+)/g)].flatMap((m) => [
        lightVars[m[1]] ?? '',
        darkVars[m[1]] ?? '',
      ])].join(' ');
      expect(chain, `${label} / "${branch}" stopped reading the tenant accent`).toMatch(
        /--brand-color/,
      );
    }
  });

  it('no surface in scope gained a dark: variant', () => {
    // A `dark:` class would be a second theming mechanism competing with the
    // variable blocks — and the one place a tenant colour could get frozen.
    for (const s of SURFACES) {
      const body = sourceOf(s);
      expect([...body.matchAll(/\bdark:[a-z-]+/g)].map((m) => m[0]), `${s.label} added a dark: variant`).toEqual(
        [],
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · pre-auth stays light (THE-85)
// ═══════════════════════════════════════════════════════════════════════════

describe('no pre-auth surface gained a dark treatment', () => {
  it('the pre-auth path list is unchanged', () => {
    expect([...PREAUTH_PATHS]).toEqual(['/auth', '/onboarding', '/church-onboarding']);
  });

  it.each(['/admin/crm', '/admin/tenants', '/admin/accounting'])(
    '%s is a signed-in route, not a funnel screen',
    (route) => {
      expect(isPreAuthPath(route), `${route} is being treated as pre-auth`).toBe(false);
    },
  );

  it('no pre-auth screen pulls a touched surface onto the funnel', () => {
    const PREAUTH_TREE = [
      'components/AuthPage.tsx',
      'components/Onboarding.tsx',
      'components/ChurchOnboarding.tsx',
      'components/OnboardingGate.tsx',
      'components/FirstRunSetup.tsx',
      'components/WorkspaceHandoff.tsx',
    ];
    const TOUCHED = ['AdminCRM', 'AdminTenants', 'AdminAccounting'];
    for (const file of PREAUTH_TREE) {
      const src = read(file);
      for (const component of TOUCHED) {
        expect(src, `${file} imports ${component}, which this PR themed for dark`).not.toMatch(
          new RegExp(`from\\s+'[./]*(?:components/)?${component}'`),
        );
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · deliberately dark in both themes
// ═══════════════════════════════════════════════════════════════════════════

describe('a surface that is deliberately dark in both themes is unchanged', () => {
  /**
   * RichTextEditor's bubble menu. PR 326 established that its 11 values are
   * CORRECT: the menu is a floating toolbar on a --warm-dark bubble, dark by
   * design in both themes, and its light-on-dark ink is right BECAUSE the bubble
   * is dark. "Fixing" it would invert a surface that was never light.
   *
   * Named here so the next sweep finds a test explaining why it was skipped,
   * rather than a file that merely looks unfinished.
   */
  it('the RichTextEditor bubble menu still sits on bg-warm-dark', () => {
    expect(read('components/RichTextEditor.tsx'), 'the bubble menu stopped being deliberately dark').toMatch(
      /className="bg-warm-dark[^"]*"/,
    );
  });

  it('--warm-dark is not overridden in the dark block', () => {
    expect(
      darkVars['--warm-dark'],
      'inverting --warm-dark would flip every deliberately-dark surface to light',
    ).toBeUndefined();
  });

  it('the LivestreamView video frame is still black in both themes', () => {
    // Checked before touching, per the brief. LivestreamView's dark values are
    // not the bubble-menu class — they are a 16:9 video frame and a modal scrim,
    // both of which are black by design and neither of which carries text.
    const src = read('components/LivestreamView.tsx');
    expect(src, 'the video frame stopped being black').toMatch(/bg-black\b/);
    expect(src, 'the video frame gained a theme-dependent ground').not.toMatch(/dark:bg-/);
  });
});
