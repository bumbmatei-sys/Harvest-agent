import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { contrastRatio, AA_CONTRAST } from '../lib/theme';
import { PREAUTH_PATHS, isPreAuthPath } from '../lib/preauth-theme';
import tw from '../../tailwind.config';

/**
 * THE-136 — the two surfaces a desktop session reported as unreadable in dark
 * mode: the course editor's Level/Section title rows, and the Notes document
 * list item.
 *
 * Both are the same shape of bug and neither is a class the earlier sweeps could
 * see. The course editor paints its rows with inline `style` objects, so a fixed
 * light literal there is invisible to every class-based guard; the Notes list
 * item spells `color-mix(…, white)`, which is a well-formed themeable expression
 * whose second operand is pinned to a light colour. In both cases the surface
 * stayed light while the ink on it inverted, and the text disappeared.
 *
 * As in PR 322 (theming-stage3) and PR 323 (theming-stage4), nothing here is
 * asserted against a hex. Every colour is read out of the REAL source, resolved
 * through the REAL Tailwind config and the REAL variable blocks in globals.css,
 * and every ratio is computed. A test that pinned a passing number would keep
 * passing after the palette moved, which is the failure mode these exist to
 * prevent.
 *
 * Targets are named by their LABEL — the placeholder a user reads — never by
 * the value they happen to render today.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');

const EDITOR_FILE = 'components/AdminCourseEditor.tsx';
const DOCS_FILE = 'components/AdminDocs.tsx';
/**
 * THE-275 moved the notes list and folder tree out of AdminDocs and into a
 * component of their own — the tree is now mounted unconditionally beside the
 * editor instead of existing only inside it. The ROWS this file measures moved
 * with it, so the Notes surface is these two files together and every scan
 * below reads both. The row's colours themselves did not move: the selected
 * fill is still the accent mixed over `transparent`, and the two inks are still
 * text-strong / text-body, which is what keeps the ratios below comparable to
 * the ones THE-136 recorded.
 */
const TREE_FILE = 'components/docs/DocsTree.tsx';

const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const EDITOR = read(EDITOR_FILE);
const DOCS = read(DOCS_FILE);
const TREE = read(TREE_FILE);
/** The Notes surface, for the scans that are about the screen and not a file. */
const NOTES_SRC = `${DOCS}\n${TREE}`;

/** The ground each theme composites a translucent fill over, for the rare
 *  expression that cannot be reduced without one. */
const BACKSTOP = { light: '#FFFFFF', dark: '#221D18' } as const;
type Theme = keyof typeof BACKSTOP;

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
// Enough of a CSS colour evaluator for the forms these two files and globals.css
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
    return toHex(fr * alpha + br * (1 - alpha), fg2 * alpha + bg * (1 - alpha), fb * alpha + bb * (1 - alpha));
  }

  return null;
}

/** Every CSS custom property an expression ultimately names. */
const tokensNamed = (expr: string): string[] =>
  [...expr.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);

// ── Tailwind class → colour expression, through the real config ─────────────

const twExtend = (tw.theme?.extend ?? {}) as Record<string, Record<string, unknown>>;
const twColors = (twExtend.colors ?? {}) as Record<string, unknown>;
const twTextColor = (twExtend.textColor ?? {}) as Record<string, unknown>;

/** Index `surface-raised` / `line` / `strong` into a config colour group. */
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
 * Resolve a utility class to the colour expression Tailwind will emit for it,
 * using the project's own config rather than a copy that can drift. Returns null
 * for a class that carries no colour (spacing, radius, …).
 */
export function classToExpr(cls: string): string | null {
  const bare = cls.replace(/^(?:hover|focus|active|group-hover|placeholder|dark):/g, '');

  const arbitrary = bare.match(/^(?:bg|text|border|ring|divide)-\[([^\]]+)\]$/);
  if (arbitrary) {
    const inner = arbitrary[1].replace(/_/g, ' ');
    return /^(?:#|rgb|hsl|color-mix|var\()/i.test(inner) ? inner : null;
  }

  const named = bare.match(/^(bg|text|border|ring|divide|placeholder)-(.+)$/);
  if (!named) return null;
  const [, prefix, rest] = named;
  if (prefix === 'text') {
    return lookupScale(twTextColor, rest) ?? lookupScale(twColors, rest);
  }
  return lookupScale(twColors, rest);
}

/** The one colour-bearing class in a space-separated class string. */
function soleColorClass(classes: string, kind: 'bg' | 'text'): string {
  const hits = classes
    .split(/\s+/)
    .filter((c) => new RegExp(`^(?:hover:|focus:|placeholder:)?${kind}-`).test(c))
    .filter((c) => classToExpr(c) !== null);
  expect(hits, `no ${kind} colour class in "${classes}"`).not.toHaveLength(0);
  return hits[hits.length - 1];
}

// ── reading the targets out of the source, by label ─────────────────────────

/** `const NAME = "…";` declarations, so `color: TEXT` can be followed. */
function localConsts(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/^const\s+([A-Z_0-9]+)\s*=\s*"([^"]*)";/gm)) out[m[1]] = m[2];
  return out;
}
const EDITOR_CONSTS = localConsts(EDITOR);

const deref = (expr: string, consts: Record<string, string>): string =>
  consts[expr.trim()] ?? expr.trim().replace(/^["']|["']$/g, '');

/** The body of the component whose JSX carries a given label. */
function componentCarrying(src: string, label: string): { name: string; body: string } {
  const at = src.indexOf(label);
  expect(at, `the label ${label} is no longer in the source`).toBeGreaterThan(-1);
  const before = src.slice(0, at);
  const start = before.lastIndexOf('\nfunction ');
  expect(start, `no enclosing component for ${label}`).toBeGreaterThan(-1);
  const after = src.indexOf('\nfunction ', at);
  return {
    name: /^\nfunction\s+(\w+)/.exec(src.slice(start))?.[1] ?? '?',
    body: src.slice(start, after === -1 ? src.length : after),
  };
}

/**
 * Every opaque surface a component paints behind its text.
 *
 * Backgrounds that name the tenant accent are excluded on purpose: those are the
 * 6-10px level/section bullets, not a ground any copy sits on, and the accent is
 * deliberately not part of the neutral ramp (see test 7).
 */
function groundsIn(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/background:\s*("(?:[^"]*)"|`[^`]*`|[A-Z_0-9]+)/g)) {
    const expr = deref(m[1], EDITOR_CONSTS);
    if (/^(transparent|none)$/i.test(expr)) continue;
    if (expr.includes('--brand-color')) continue;
    if (!/^var\(|^#|^color-mix|^rgb/i.test(expr)) continue;
    out.add(expr);
  }
  return [...out];
}

/** The ink an `<input>` paints, located by the label the user reads on it. */
function inkOfInputLabelled(body: string, label: string): string {
  const at = body.indexOf(label);
  expect(at, `the input labelled ${label} is gone`).toBeGreaterThan(-1);
  const start = body.lastIndexOf('<input', at);
  expect(start, `${label} is not on an <input>`).toBeGreaterThan(-1);
  const decl = [...body.slice(start, at).matchAll(/color:\s*("(?:[^"]*)"|[A-Z_0-9]+)/g)].pop();
  expect(decl, `the input labelled ${label} declares no colour`).not.toBeUndefined();
  return deref(decl![1], EDITOR_CONSTS);
}

// ── the pairs under test ────────────────────────────────────────────────────

interface Pair {
  /** How the surface is described in the issue. */
  target: string;
  /** Which state of it. */
  state: string;
  ink: string;
  bg: string;
  /** The opaque surface a translucent `bg` composites over. */
  ground: string;
}

/* — the course editor — */

const LEVEL_LABEL = 'placeholder="Level Title (e.g. Beginner, Week 1)..."';
const SECTION_LABEL = 'placeholder="Section Title..."';

const levelCard = componentCarrying(EDITOR, LEVEL_LABEL);
const sectionCard = componentCarrying(EDITOR, SECTION_LABEL);

/** The shared placeholder rule the editor injects for every input it renders. */
const EDITOR_PLACEHOLDER = (() => {
  const m = EDITOR.match(/input::placeholder\{color:([^;}]+)[;}]/);
  expect(m, 'the course editor no longer styles its input placeholders').not.toBeNull();
  return m![1].trim();
})();

const EDITOR_TARGETS = [
  { target: 'the course editor Level Title input', card: levelCard, label: LEVEL_LABEL },
  { target: 'the course editor Section Title input', card: sectionCard, label: SECTION_LABEL },
];

const editorPairs: Pair[] = EDITOR_TARGETS.flatMap(({ target, card, label }) => {
  const grounds = groundsIn(card.body);
  expect(grounds, `${card.name} paints no surface behind ${target}`).not.toHaveLength(0);
  const ink = inkOfInputLabelled(card.body, label);
  return grounds.flatMap((bg) => [
    { target, state: 'title', ink, bg, ground: bg },
    { target, state: 'placeholder', ink: EDITOR_PLACEHOLDER, bg, ground: bg },
  ]);
});

/* — Notes — */

/** The notes list + folder tree — its own component since THE-275. */
const NOTES_SIDEBAR = TREE;

/**
 * The surface the notes tree is mounted on.
 *
 * Read off the rail that mounts it rather than assumed: the rail is the
 * `Sidebar` carrying `data-testid="docs-sidebar"`, and the ground is the last
 * `bg-surface*` class in its own className. A rail that stopped painting a
 * surface would fail here rather than silently measuring every row against
 * whatever this file happened to believe.
 */
const NOTES_GROUND = (() => {
  const at = DOCS.indexOf('data-testid="docs-sidebar"');
  expect(at, 'the notes rail is gone — nothing mounts the tree').toBeGreaterThan(-1);
  const end = DOCS.indexOf('>', DOCS.indexOf('<DocsTree', at));
  const cls = [...DOCS.slice(at, end).matchAll(/\bbg-surface(?:-[a-z]+)?\b/g)].pop();
  expect(cls, 'the notes rail declares no surface').not.toBeUndefined();
  const expr = classToExpr(cls![0]);
  expect(expr, `${cls![0]} resolves to nothing in the Tailwind config`).not.toBeNull();
  return expr!;
})();

function pick(re: RegExp, src: string, what: string): RegExpExecArray {
  const m = re.exec(src);
  expect(m, `${what} could not be located — the markup moved`).not.toBeNull();
  return m!;
}

const docListPairs: Pair[] = (() => {
  // The row and its label, read together so a class swap on either is caught.
  const row = pick(
    /className=\{`text-left \$\{active \? '([^']+)' : '([^']+)'\}`\}/,
    NOTES_SIDEBAR,
    'the notes tree leaf row',
  );
  const label = pick(
    /<ItemTitle className=\{`truncate \$\{active \? '([^']+)' : '([^']+)'\}`\}>/,
    NOTES_SIDEBAR,
    'the notes tree leaf title',
  );

  const selectedBg = classToExpr(soleColorClass(row[1], 'bg'))!;
  const restingHoverBg = classToExpr(soleColorClass(row[2], 'bg'))!;
  const selectedInk = classToExpr(soleColorClass(label[1], 'text'))!;
  const restingInk = classToExpr(soleColorClass(label[2], 'text'))!;

  const target = 'the Notes document list item';
  return [
    { target, state: 'selected', ink: selectedInk, bg: selectedBg, ground: NOTES_GROUND },
    { target, state: 'resting', ink: restingInk, bg: NOTES_GROUND, ground: NOTES_GROUND },
    { target, state: 'hover', ink: restingInk, bg: restingHoverBg, ground: NOTES_GROUND },
  ];
})();

/**
 * The folder row IN THE TREE.
 *
 * THE-275 deleted the flat row of folder chips this used to read. Those chips
 * were the landing screen, and the landing screen is what the ticket removed —
 * a folder is a row in the tree now, at any depth. Same job for this file: the
 * folder name and its resting/hover fills, measured on the rail's ground rather
 * than on the page's.
 */
const docFolderPairs: Pair[] = (() => {
  const row = pick(
    /className="text-left (hover:bg-[a-z-]+)"/,
    NOTES_SIDEBAR,
    'the Notes folder row',
  );
  const name = pick(
    /<ItemTitle className="truncate (text-[a-z-]+)">\{folder\.name\}<\/ItemTitle>/,
    NOTES_SIDEBAR,
    'the Notes folder name',
  );
  const hoverBg = classToExpr(row[1])!;
  const ink = classToExpr(name[1])!;
  const target = 'the Notes folder row';
  return [
    { target, state: 'name', ink, bg: NOTES_GROUND, ground: NOTES_GROUND },
    { target, state: 'hover', ink, bg: hoverBg, ground: NOTES_GROUND },
  ];
})();

/** The Notes title field, whose placeholder reads "Untitled". */
const docTitlePair: Pair = (() => {
  const at = DOCS.indexOf('placeholder="Untitled"');
  expect(at, 'the Notes title field is gone').toBeGreaterThan(-1);
  const start = DOCS.lastIndexOf('<input', at);
  const classes = pick(/className="([^"]+)"/, DOCS.slice(start, at), 'the Notes title field classes')[1];
  return {
    target: 'the Notes document title field',
    state: 'placeholder',
    ink: classToExpr(soleColorClass(classes, 'text'))!,
    bg: NOTES_GROUND,
    ground: NOTES_GROUND,
  };
})();

const NOTES_PAIRS = [...docListPairs, ...docFolderPairs, docTitlePair];
const ALL_PAIRS = [...editorPairs, ...NOTES_PAIRS];

/** Compute one pair's contrast in one theme. */
function ratioOf(pair: Pair, theme: Theme): { ratio: number; fg: string; bg: string } {
  const lookup = inTheme(theme);
  const ground = resolveColor(pair.ground, lookup, BACKSTOP[theme]);
  expect(ground, `${pair.target} (${pair.state}): ground ${pair.ground} did not resolve in ${theme}`)
    .not.toBeNull();
  const bg = resolveColor(pair.bg, lookup, ground!);
  expect(bg, `${pair.target} (${pair.state}): background ${pair.bg} did not resolve in ${theme}`)
    .not.toBeNull();
  const fg = resolveColor(pair.ink, lookup, bg!);
  expect(fg, `${pair.target} (${pair.state}): ink ${pair.ink} did not resolve in ${theme}`)
    .not.toBeNull();
  return { ratio: contrastRatio(fg!, bg!), fg: fg!, bg: bg! };
}

const label = (p: Pair) => `${p.target} — ${p.state}`;

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 the course editor regression
// ═══════════════════════════════════════════════════════════════════════════

describe('the course editor level and section inputs are readable in dark mode', () => {
  const titles = editorPairs.filter((p) => p.state === 'title');

  it('covers both reported inputs', () => {
    expect(new Set(titles.map((p) => p.target)).size).toBe(2);
  });

  it.each(titles.map((p) => [label(p), p] as const))('%s clears AA on its own row', (_l, pair) => {
    const { ratio, fg, bg } = ratioOf(pair, 'dark');
    expect(
      ratio,
      `${label(pair)} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1 in dark, needs ${AA_CONTRAST}:1`,
    ).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('the rows themselves change colour between the themes', () => {
    // The whole bug: the row stayed light while the ink inverted. A ground that
    // resolves identically in both themes is that bug, whatever its ratio.
    for (const pair of titles) {
      const l = resolveColor(pair.bg, inTheme('light'), BACKSTOP.light);
      const d = resolveColor(pair.bg, inTheme('dark'), BACKSTOP.dark);
      expect(d, `${label(pair)}: ${pair.bg} renders identically on both grounds`).not.toBe(l);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · placeholders
// ═══════════════════════════════════════════════════════════════════════════

describe('their placeholders are readable in dark mode', () => {
  const placeholders = [...editorPairs.filter((p) => p.state === 'placeholder'), docTitlePair];

  it.each(placeholders.map((p) => [label(p), p] as const))('%s clears AA', (_l, pair) => {
    const { ratio, fg, bg } = ratioOf(pair, 'dark');
    expect(
      ratio,
      `${label(pair)} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1 in dark, needs ${AA_CONTRAST}:1`,
    ).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('the editor styles its placeholders through a token, not a literal', () => {
    expect(
      EDITOR_PLACEHOLDER,
      'the placeholder colour is a literal again and will not theme',
    ).toMatch(/^var\(--[a-z-]+\)$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · 🔴 the Notes regression
// ═══════════════════════════════════════════════════════════════════════════

describe('the Notes document list item is readable in dark mode', () => {
  it('covers the selected, resting and hover states', () => {
    expect(docListPairs.map((p) => p.state)).toEqual(['selected', 'resting', 'hover']);
  });

  it.each([...docListPairs, ...docFolderPairs].map((p) => [label(p), p] as const))(
    '%s clears AA',
    (_l, pair) => {
      const { ratio, fg, bg } = ratioOf(pair, 'dark');
      expect(
        ratio,
        `${label(pair)} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1 in dark, needs ${AA_CONTRAST}:1`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    },
  );

  it('the selected fill is mixed over the surface, not over a fixed light colour', () => {
    // `color-mix(…, white)` is the exact shape of this bug: a well-formed,
    // tenant-aware expression whose second operand is pinned light, so the
    // selected row stayed a near-white block under cream text.
    const selected = docListPairs.find((p) => p.state === 'selected')!;
    expect(selected.bg, 'the selected row is mixed over a fixed colour again')
      .toMatch(/,\s*transparent\s*\)/);
    const l = resolveColor(selected.bg, inTheme('light'), BACKSTOP.light);
    const d = resolveColor(selected.bg, inTheme('dark'), BACKSTOP.dark);
    expect(d, 'the selected row renders identically on both grounds').not.toBe(l);
  });

  it('no Notes surface mixes an accent over a hardcoded light colour', () => {
    const offenders = [...NOTES_SRC.matchAll(/color-mix\([^)]*?,\s*(white|#[0-9a-fA-F]{3,6})\s*\)/g)]
      .map((m) => m[0]);
    expect(offenders, 'this fill stays light on a dark ground').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · 🔴 the no-regression test
// ═══════════════════════════════════════════════════════════════════════════

describe('both surfaces remain readable in light mode', () => {
  it.each(ALL_PAIRS.map((p) => [label(p), p] as const))('%s clears AA in light', (_l, pair) => {
    const { ratio, fg, bg } = ratioOf(pair, 'light');
    expect(
      ratio,
      `${label(pair)} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1 in light, needs ${AA_CONTRAST}:1`,
    ).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('the light theme itself is untouched by this PR', () => {
    // Every token these surfaces now name already shipped, with the light value
    // it shipped with. Nothing here re-tunes the light theme.
    const PINNED: Record<string, string> = {
      '--surface': 'var(--cream)',
      '--surface-raised': '#FFFFFF',
      '--surface-sunken': 'var(--stone-100)',
      '--surface-tint': '#F7F6F3',
      '--border-strong': 'var(--stone-300)',
      '--text-strong': 'var(--earth)',
      '--text-body': '#4A4038',
      '--text-faint': '#766A5A',
    };
    for (const [token, value] of Object.entries(PINNED)) {
      expect(lightVars[token], `${token} moved in the light theme`).toBe(value);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · the tokens must exist on the dark side
// ═══════════════════════════════════════════════════════════════════════════

describe('every colour class used resolves to a property defined in the dark block', () => {
  /**
   * The one exemption, and it is the same one PR 323 named: the tenant accent is
   * NOT part of the neutral ramp and is deliberately absent from the dark block
   * (see test 7). Every fill derived from it composites over a themed surface,
   * so it themes without inverting.
   */
  const ACCENT_EXEMPT = ['--brand-color'];

  const used = [
    ...new Set(
      ALL_PAIRS.flatMap((p) => [p.ink, p.bg, p.ground]).flatMap(tokensNamed),
    ),
  ].sort();

  it('the surfaces name a non-trivial set of tokens', () => {
    // Guards the guard: a refactor that stopped finding any class would make
    // every assertion below vacuously true.
    expect(used.length).toBeGreaterThanOrEqual(5);
  });

  it.each(used.filter((t) => !ACCENT_EXEMPT.includes(t)))('%s has a dark value', (token) => {
    expect(
      darkVars[token],
      `${token} is only declared in :root, so this surface stays light on a dark page`,
    ).toBeDefined();
  });

  it.each(used.filter((t) => ACCENT_EXEMPT.includes(t)))(
    '%s is the documented accent exemption and stays unthemed',
    (token) => {
      expect(darkVars[token], `${token} must not gain a dark value here`).toBeUndefined();
    },
  );

  it('every class these surfaces spell emits real CSS', () => {
    // `bg-surface-gold` once produced no rule at all — a well-formed class name
    // with nothing behind it, which no type error and no failing render catches.
    const classes = new Set<string>();
    for (const src of [EDITOR, DOCS, TREE]) {
      // Strip var() references first: `var(--border-strong)` contains the
      // character sequence of a utility class without being one.
      for (const m of src.replace(/var\(--[a-z0-9-]+\)/g, 'var(--x)').matchAll(
        /\b(?:hover:|focus:|placeholder:)?(?:bg|text|border)-(?:surface|line|danger|gold|strong|body|muted|faint)(?:-[a-z]+)?\b/g,
      )) {
        classes.add(m[0]);
      }
    }
    expect(classes.size, 'no semantic classes found — the scan is broken').toBeGreaterThan(0);
    const dead = [...classes].filter((c) => classToExpr(c) === null);
    expect(dead, 'this class emits no CSS at all').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · nothing hardcoded
// ═══════════════════════════════════════════════════════════════════════════

describe('no hex, rgb() or inline colour is introduced', () => {
  /**
   * Every bare colour literal LEFT in the two files, pinned exactly.
   *
   * ⚠️ This is the surviving baseline, not a target. What remains is: the gold
   * gradient's white stop (a solid brand fill, which does not theme — same rule
   * as the 300+ shades in stage 4), the four success/danger status literals used
   * by the quiz markers, the AI banner and the delete button (a separate
   * retokenisation, reported not fixed), and the scrim/elevation rgba()s, which
   * must stay dark in both themes.
   *
   * `var(--token, #fallback)` is not counted: the token still resolves and the
   * hex is only reached if the variable is missing entirely.
   */
  const BASELINE: Record<string, string[]> = {
    [EDITOR_FILE]: [
      '#27AE60', '#E74C3C', '#EAFAF1', '#FDECEA', '#ffffff',
      'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.2)',
      'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.4)',
      'rgba(201,150,58,0.3)', 'rgba(201,150,58,0.35)',
      'rgba(45,37,25,0.05)', 'rgba(45,37,25,0.06)',
    ],
    // THE-275 removed both of AdminDocs' surviving rgba()s with the mobile
    // slide-in drawer they belonged to (its scrim and its 12px side shadow).
    // The two-pane layout has no drawer: below `lg` the tree IS the screen
    // until a note is opened, so nothing overlays anything. Neither literal was
    // replaced — the file spells no bare colour at all now, and neither does
    // the tree that took its rows.
    [DOCS_FILE]: [],
    [TREE_FILE]: [],
  };

  const literals = (rel: string): string[] =>
    [
      ...read(rel)
        .replace(/var\(\s*--[a-z0-9-]+\s*,\s*#[0-9A-Fa-f]{3,8}\s*\)/gi, 'var(--x)')
        .matchAll(/#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g),
    ]
      .map((m) => m[0])
      .sort();

  it.each(Object.keys(BASELINE))('%s introduces no colour literal', (file) => {
    expect(
      literals(file),
      `${file}'s colour literals changed — a new one here opts that surface out of theming`,
    ).toEqual([...BASELINE[file]].sort());
  });

  it('neither surface re-declares a ramp colour under a local name', () => {
    // `const CARD = "#FFFFFF"` is the shape that left three admin screens fully
    // light; every file must keep expressing the ramp as var().
    const RAMP = ['#FAF8F5', '#FFFFFF', '#F3EEE7', '#2D2519', '#8B7355', '#E8E2D9'];
    for (const [file, src] of [[EDITOR_FILE, EDITOR], [DOCS_FILE, DOCS], [TREE_FILE, TREE]] as const) {
      for (const m of src.matchAll(/^const\s+([A-Z_0-9]+)\s*=\s*"(#[0-9A-Fa-f]{6})";/gm)) {
        expect(RAMP, `${file}: ${m[1]} hardcodes a ramp colour`).not.toContain(m[2].toUpperCase());
      }
    }
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

  it('both surfaces still express their gold through the accent variable', () => {
    // Fixing the two surfaces must not have "solved" a tint by pinning a hex —
    // that would silently un-white-label the screen.
    expect(EDITOR, 'the editor no longer reads the tenant accent').toContain('var(--brand-color');
    // Arbitrary Tailwind values spell their spaces as underscores.
    const accentFills = [...NOTES_SRC.matchAll(/color-mix\(in[\s_]srgb,[\s_]*var\(--brand-color\)/g)];
    expect(accentFills.length, 'the Notes accent fills stopped reading the accent')
      .toBeGreaterThan(0);
  });

  it('no accent-derived fill in either file was given a fixed dark counterpart', () => {
    // A `dark:` class here would be a second theming mechanism competing with
    // the variable blocks — and the one place a tenant colour could get frozen.
    for (const [file, src] of [[EDITOR_FILE, EDITOR], [DOCS_FILE, DOCS], [TREE_FILE, TREE]] as const) {
      expect([...src.matchAll(/\bdark:[a-z-]+/g)].map((m) => m[0]), `${file} added a dark: variant`)
        .toEqual([]);
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

  it.each(['/admin/courses', '/admin/docs', '/admin/docs/abc'])(
    '%s is a signed-in route, not a funnel screen',
    (route) => {
      expect(isPreAuthPath(route), `${route} is being treated as pre-auth`).toBe(false);
    },
  );

  it('no pre-auth screen pulls either touched component onto the funnel', () => {
    const PREAUTH_TREE = [
      'components/AuthPage.tsx',
      'components/Onboarding.tsx',
      'components/ChurchOnboarding.tsx',
      'components/OnboardingGate.tsx',
      'components/FirstRunSetup.tsx',
      'components/WorkspaceHandoff.tsx',
    ];
    for (const file of PREAUTH_TREE) {
      const src = read(file);
      for (const component of ['AdminCourseEditor', 'AdminDocs']) {
        expect(src, `${file} imports ${component}, which this PR themed for dark`)
          .not.toMatch(new RegExp(`from\\s+'[./]*(?:components/)?${component}'`));
      }
    }
  });
});
