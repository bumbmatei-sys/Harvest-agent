import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postcss from 'postcss';
import tailwindPostcss from '@tailwindcss/postcss';

/**
 * Building the app's real stylesheet in process, under Tailwind v4.
 *
 * Every theming guard in this repo answers questions of the form "does this
 * class produce this declaration" by COMPILING rather than by inspecting the
 * shape of `tailwind.config.ts`. That choice predates v4 and survives it — see
 * the header of src/__tests__/theming-stage2.test.ts for why a config-shape
 * assertion proves nothing here (`text-strong` lives under `textColor`, so
 * `theme.extend.colors.strong` does not exist and never did).
 *
 * What changed in v4 is only HOW you run Tailwind:
 *
 *   • v3: `postcss([tailwindcss(configObject)])` — the `tailwindcss` package
 *     was itself the PostCSS plugin and took a config object, so a test could
 *     hand it a config with `content` swapped for the files under test.
 *   • v4: the plugin moved to `@tailwindcss/postcss`, takes no config
 *     argument, and finds a JavaScript config only through the `@config`
 *     directive in the stylesheet it is compiling.
 *
 * So "compile with a different content set" is expressed the way v4 expresses
 * it: a throwaway config module that re-exports the real one with `content`
 * replaced, named by a `@config` line prepended to a copy of globals.css whose
 * own `@config` is stripped and whose `@import` is marked `source(none)` (which
 * turns off v4's automatic source detection). The theme, the plugins, the dark
 * variant and every colour still come from the real tailwind.config.ts — only
 * the file list differs. That is exactly the substitution v3 made inline.
 *
 * `buildAppCss()` needs none of that: `next build` compiles globals.css with
 * this same plugin and no arguments, so the guards get the real stylesheet by
 * doing precisely that. Under v3 this was "the pipeline next build runs, minus
 * autoprefixer"; v4 has no autoprefixer in the chain, so it is now exact.
 */

export const REPO_ROOT = path.resolve(__dirname, '../../..');
export const GLOBALS_CSS = path.join(REPO_ROOT, 'src/app/globals.css');
export const TAILWIND_CONFIG = path.join(REPO_ROOT, 'tailwind.config.ts');

/** globals.css's v4 entry lines — asserted, so a rewrite cannot silently no-op. */
const TAILWIND_IMPORT = '@import "tailwindcss";';
const CONFIG_DIRECTIVE = /^@config\s+"[^"]+";\s*$/m;

async function run(css: string, from: string): Promise<string> {
  const result = await postcss([tailwindPostcss()]).process(css, { from });
  return result.css;
}

let appCss: Promise<string> | undefined;

/**
 * The app's stylesheet, exactly as `next build` produces it: the real
 * globals.css, the real `@config`, the real content globs.
 */
export function buildAppCss(): Promise<string> {
  appCss ??= run(readFileSync(GLOBALS_CSS, 'utf8'), GLOBALS_CSS);
  return appCss;
}

/**
 * globals.css with automatic source detection off and its own `@config`
 * removed, ready for a caller-supplied one. Throws rather than returning
 * something that would compile the whole app by accident.
 */
function isolatedGlobals(): string {
  const css = readFileSync(GLOBALS_CSS, 'utf8');
  if (!css.includes(TAILWIND_IMPORT)) {
    throw new Error(`globals.css no longer contains ${TAILWIND_IMPORT}; isolation would be vacuous`);
  }
  if (!CONFIG_DIRECTIVE.test(css)) {
    throw new Error('globals.css no longer contains an @config directive; isolation would be vacuous');
  }
  return css
    .replace(TAILWIND_IMPORT, '@import "tailwindcss" source(none);')
    .replace(CONFIG_DIRECTIVE, '');
}

/** A throwaway config module re-exporting the real one with `content` swapped. */
function configWithContent(content: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harvest-tw-'));
  const file = path.join(dir, 'tailwind.config.ts');
  writeFileSync(
    file,
    `import base from ${JSON.stringify(TAILWIND_CONFIG)};\n` +
      `export default { ...base, content: ${JSON.stringify(content)} };\n`,
    'utf8',
  );
  return file;
}

/**
 * globals.css compiled with ONLY `files` as Tailwind's content.
 *
 * Used by the primitives audit, which has to be able to say "this class
 * produces no rule" about thirteen files. Left on the app's own globs, a class
 * that resolves only because some unrelated screen also spells it would look
 * resolved, and the guard would under-report.
 */
export function buildCssForFiles(files: string[]): Promise<string> {
  const config = configWithContent(files);
  return run(`@config ${JSON.stringify(config)};\n${isolatedGlobals()}`, GLOBALS_CSS);
}

/**
 * globals.css compiled with only `markup` as content.
 *
 * v3 accepted `content: [{ raw }]`; v4 rejects raw entries outright ("This
 * feature is not currently supported"), so the markup is written to a real
 * file — which is what a raw entry always stood in for.
 */
export function buildCssForMarkup(markup: string, extension = 'html'): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'harvest-tw-markup-'));
  const file = path.join(dir, `markup.${extension}`);
  writeFileSync(file, markup, 'utf8');
  return buildCssForFiles([file]);
}

/* ── v3-shaped utility CSS ───────────────────────────────────────────────
 *
 * A dozen layout guards in this repo were written against the stylesheet
 * `postcss([tailwindcss(config)]).process('@tailwind utilities;')` produced:
 * a flat list of rules and `@media` blocks whose declarations hold literal
 * lengths (`height: 2.75rem`). They read those lengths back and assert real
 * things with them — that a card fits a 380px viewport, that no touch target
 * drops under 44px.
 *
 * v4 emits the same utilities with two purely REPRESENTATIONAL differences:
 *
 *   1. everything is wrapped in `@layer utilities { … }`, so a walker that
 *      iterates the top level finds one at-rule instead of the rules; and
 *   2. theme values are referenced rather than inlined — `h-11` is
 *      `height: calc(var(--spacing) * 11)` where v3 wrote `height: 2.75rem`.
 *
 * Both are invisible to a browser and fatal to those guards, and fatal in the
 * worst direction: a `px()` helper that cannot parse `calc(var(--spacing) *
 * 11)` returns null, and a guard that skips the control it was written to
 * measure passes. So this undoes exactly those two changes and nothing else —
 * it unwraps the layer, substitutes Tailwind's OWN theme variables for their
 * declared values, and folds the resulting `calc()` arithmetic.
 *
 * What it deliberately does NOT touch: any custom property this app declares.
 * `bg-surface-raised` stays `background-color: var(--surface-raised)`, because
 * resolving that against globals.css is the thing several of those guards are
 * for. Only variables Tailwind itself declares in `@layer theme` are inlined,
 * which is precisely the set v3 had already inlined before the guards saw it.
 */

/** Every variable Tailwind declares for itself, i.e. everything in `@layer theme`. */
function themeVariables(root: postcss.Root): Map<string, string> {
  const vars = new Map<string, string>();
  root.walkAtRules('layer', (layer) => {
    if (layer.params !== 'theme' || !layer.nodes) return;
    layer.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) vars.set(decl.prop, decl.value.trim());
    });
  });
  return vars;
}

/**
 * `var(--x)` / `var(--x, fallback)` → the declared value, for theme variables
 * only. A non-theme name is left alone but its FALLBACK is still descended
 * into: `line-height: var(--tw-leading, var(--text-sm--line-height))` holds a
 * theme value one level down, and v3 emitted that as a literal `1.25rem`.
 */
function inlineThemeVars(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 8 || !value.includes('var(')) return value;
  let changed = false;
  const out = value.replace(
    /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
    (whole, name: string, fallback?: string) => {
      const declared = vars.get(name);
      if (declared !== undefined) {
        changed = true;
        return declared;
      }
      if (fallback === undefined) return whole;
      const inner = inlineThemeVars(fallback, vars, depth + 1);
      if (inner === fallback) return whole;
      changed = true;
      return `var(${name},${inner})`;
    },
  );
  return changed ? inlineThemeVars(out, vars, depth + 1) : out;
}

/**
 * v4 states breakpoints in modern range syntax and in rem —
 * `@media (width >= 64rem)` where v3 wrote `@media (min-width: 1024px)`.
 * Every layout guard reads its breakpoint back with a `min-width: …px` match,
 * and a miss there does not fail: it drops the whole desktop branch and the
 * suite passes having measured only the mobile rules. So the params are
 * restated in v3's spelling. Media queries evaluate rem against the INITIAL
 * font size, never the document's, so 64rem is 1024px here whatever the
 * desktop rem trim does to :root.
 */
function v3MediaParams(params: string): string {
  return params
    .replace(/\(\s*width\s*>=\s*([\d.]+)(rem|px)\s*\)/g,
      (_m, n: string, unit: string) => `(min-width: ${unit === 'rem' ? Number(n) * 16 : Number(n)}px)`)
    .replace(/\(\s*width\s*<\s*([\d.]+)(rem|px)\s*\)/g,
      (_m, n: string, unit: string) => `(max-width: ${(unit === 'rem' ? Number(n) * 16 : Number(n)) - 0.02}px)`);
}

interface Quantity { n: number; unit: string }

/** Evaluate a calc() expression to a single quantity, or null when it cannot be folded. */
function evaluate(expr: string): Quantity | null {
  const tokens = expr.match(/\d*\.?\d+[a-z%]*|[+\-*/()]|\s+/gi)?.filter((t) => t.trim()) ?? [];
  let i = 0;
  const peek = (): string | undefined => tokens[i];

  const combine = (a: Quantity, b: Quantity, op: string): Quantity | null => {
    if (op === '*' || op === '/') {
      if (a.unit && b.unit) return null; // rem * rem is not a length
      const n = op === '*' ? a.n * b.n : b.n === 0 ? NaN : a.n / b.n;
      if (!Number.isFinite(n)) return null;
      return { n, unit: a.unit || b.unit };
    }
    if (a.unit !== b.unit) return null; // 100% - 2rem cannot be folded here
    return { n: op === '+' ? a.n + b.n : a.n - b.n, unit: a.unit };
  };

  const primary = (): Quantity | null => {
    const t = peek();
    if (t === undefined) return null;
    if (t === '(') {
      i += 1;
      const inner = sum();
      if (peek() !== ')') return null;
      i += 1;
      return inner;
    }
    if (t === '-' || t === '+') {
      i += 1;
      const inner = primary();
      return inner && { n: t === '-' ? -inner.n : inner.n, unit: inner.unit };
    }
    const m = /^(\d*\.?\d+)([a-z%]*)$/i.exec(t);
    if (!m) return null;
    i += 1;
    return { n: Number(m[1]), unit: m[2] };
  };

  const product = (): Quantity | null => {
    let left = primary();
    while (left && (peek() === '*' || peek() === '/')) {
      const op = tokens[i]; i += 1;
      const right = primary();
      left = right && combine(left, right, op);
    }
    return left;
  };

  function sum(): Quantity | null {
    let left = product();
    while (left && (peek() === '+' || peek() === '-')) {
      const op = tokens[i]; i += 1;
      const right = product();
      left = right && combine(left, right, op);
    }
    return left;
  }

  const result = sum();
  return i === tokens.length ? result : null;
}

/** Fold every foldable calc() in a declaration value. */
function foldCalc(value: string): string {
  return value.replace(/calc\(((?:[^()]|\([^()]*\))*)\)/gi, (whole, expr: string) => {
    const q = evaluate(expr);
    if (!q) return whole;
    const n = Math.round(q.n * 1e6) / 1e6;
    return `${n}${q.unit}`;
  });
}

/**
 * v4 emits LOGICAL box properties where v3 emitted physical ones: `px-5` is
 * `padding-inline: 1.25rem`, not `padding-left` + `padding-right`. Same third
 * silent-skip hazard as the breakpoints — a guard that adds `padding-top` and
 * `padding-bottom` to check a control still paints 40px reads two undefineds
 * and computes 0 without failing on the way.
 *
 * The app is LTR-only — `<html lang="en">` carries no `dir`, components.json
 * pins `"rtl": false`, and nothing in src sets one — so inline is left/right
 * and block is top/bottom with no ambiguity. Anything that changes will make
 * this substitution wrong, which is why it is stated here rather than assumed.
 */
const PHYSICAL: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const [prefix, suffix] of [['margin', ''], ['padding', ''], ['scroll-margin', ''], ['scroll-padding', '']] as const) {
    map[`${prefix}-inline${suffix}`] = [`${prefix}-left`, `${prefix}-right`];
    map[`${prefix}-inline-start`] = [`${prefix}-left`];
    map[`${prefix}-inline-end`] = [`${prefix}-right`];
    map[`${prefix}-block${suffix}`] = [`${prefix}-top`, `${prefix}-bottom`];
    map[`${prefix}-block-start`] = [`${prefix}-top`];
    map[`${prefix}-block-end`] = [`${prefix}-bottom`];
  }
  map['inset-inline'] = ['left', 'right'];
  map['inset-inline-start'] = ['left'];
  map['inset-inline-end'] = ['right'];
  map['inset-block'] = ['top', 'bottom'];
  map['inset-block-start'] = ['top'];
  map['inset-block-end'] = ['bottom'];
  for (const part of ['width', 'color', 'style'] as const) {
    map[`border-inline-${part}`] = [`border-left-${part}`, `border-right-${part}`];
    map[`border-inline-start-${part}`] = [`border-left-${part}`];
    map[`border-inline-end-${part}`] = [`border-right-${part}`];
    map[`border-block-${part}`] = [`border-top-${part}`, `border-bottom-${part}`];
    map[`border-block-start-${part}`] = [`border-top-${part}`];
    map[`border-block-end-${part}`] = [`border-bottom-${part}`];
  }
  return map;
})();

/** Split a shorthand value on top-level whitespace, so `calc(a * b)` stays whole. */
function shorthandParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth === 0 && /\s/.test(ch)) {
      if (current) parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * The utilities Tailwind emits for `markup`, in the shape the layout guards
 * were written against. Throws rather than silently returning something a
 * length parser would skip over.
 */
export async function buildUtilityCss(markup: string): Promise<string> {
  const root = postcss.parse(await buildCssForMarkup(markup));
  const vars = themeVariables(root);
  if (vars.size === 0) throw new Error('no @layer theme in the build — theme values cannot be inlined');

  const out = postcss.root();
  root.walkAtRules('layer', (layer) => {
    if (layer.params !== 'utilities' || !layer.nodes) return;
    layer.each((node) => {
      // globals.css has an `@layer utilities` block of its own
      // (.isometric-phone, .glass-card). v3's `@tailwind utilities;` entry
      // never saw it, so it is left out rather than quietly added to what a
      // guard measures.
      if (node.source?.input.file === GLOBALS_CSS) return;
      out.append(node.clone());
    });
  });

  // v4 wraps the selector some utilities generate in `:where()` to zero its
  // specificity — `:where(.space-y-6 > :not(:last-child))` where v3 wrote
  // `.space-y-6 > :not([hidden]) ~ :not([hidden])`. These guards read the
  // class name off the front of the selector and model no specificity at all,
  // so the wrapper is removed; without it the class is simply not found, and
  // "no rule" reads as "no gap" and passes.
  out.walkRules((rule) => {
    const whole = /^:where\((.*)\)$/s.exec(rule.selector.trim());
    if (whole) rule.selector = whole[1];
  });

  out.walkDecls((decl) => {
    decl.value = foldCalc(inlineThemeVars(decl.value, vars));
    const physical = PHYSICAL[decl.prop];
    if (!physical) return;
    const parts = shorthandParts(decl.value);
    // `margin-inline: 1rem 2rem` is start-then-end; one value covers both.
    decl.replaceWith(
      physical.map((prop, i) => decl.clone({ prop, value: parts[physical.length === 2 ? i : 0] ?? parts[0] })),
    );
  });
  out.walkAtRules('media', (media) => {
    media.params = v3MediaParams(media.params);
  });

  // v4 states a font-size utility's line-height as a RATIO behind the
  // `--tw-leading` override — `line-height: var(--tw-leading, 1.428571)` —
  // where v3 emitted the absolute `1.25rem`. Both compute the same box; only
  // the second is a length, and a guard adding a control's padding to its line
  // box reads the ratio as unparseable and measures the control 20px short.
  out.walkRules((rule) => {
    let fontSize: string | undefined;
    rule.walkDecls('font-size', (d) => { fontSize = d.value; });
    rule.walkDecls('line-height', (decl) => {
      const fallback = /^var\(\s*--tw-leading\s*,\s*(.+)\)$/s.exec(decl.value.trim());
      if (fallback) decl.value = fallback[1].trim();
      const ratio = /^\d*\.?\d+$/.exec(decl.value.trim());
      const size = fontSize && /^(\d*\.?\d+)(rem|px|em)$/.exec(fontSize.trim());
      if (!ratio || !size) return;
      const n = Math.round(Number(size[1]) * Number(ratio[0]) * 1e6) / 1e6;
      decl.value = `${n}${size[2]}`;
    });
  });

  const css = out.toString();
  if (/var\(\s*--spacing\b/.test(css)) {
    throw new Error('a theme variable survived inlining — lengths would read as unparseable');
  }
  if (/@media[^{]*width\s*[<>]/.test(css)) {
    throw new Error('a range-syntax media query survived — a breakpoint would read as absent');
  }
  if (/(^|[\s;{])(margin|padding)-(inline|block)\b/.test(css)) {
    throw new Error('a logical box property survived — a length would read as absent');
  }
  return css;
}
