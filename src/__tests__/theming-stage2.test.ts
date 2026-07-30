import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import type { Config } from 'tailwindcss';
import baseConfig from '../../tailwind.config';

/**
 * Theming stage 2 — the two prerequisites, and the safety property.
 *
 * These assert against COMPILED CSS rather than the shape of the config object.
 * That is deliberate and it matters here: the text tokens are registered under
 * `textColor`, not `colors`, so a config-shape test (`theme.extend.colors.strong`)
 * would assert nothing about whether `text-strong` is a real utility — it would
 * pass just as happily if Tailwind emitted nothing at all. Compiling is the only
 * check that distinguishes "mapped" from "mapped in a way that actually works",
 * and it is what catches a wrong nesting key, which is the realistic mistake.
 */

const ROOT = path.resolve(__dirname, '../..');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const LAYOUT = path.join(ROOT, 'src/app/layout.tsx');

/** Compile just the utilities Tailwind finds in `markup`. */
async function compile(markup: string): Promise<string> {
  const config = { ...(baseConfig as Config), content: [{ raw: markup, extension: 'html' }] };
  const result = await postcss([tailwindcss(config)]).process('@tailwind utilities;', {
    from: undefined,
  });
  return result.css;
}

/** Compile the real globals.css against the real content globs. */
async function compileGlobals(): Promise<string> {
  const result = await postcss([tailwindcss(baseConfig as Config)]).process(
    readFileSync(GLOBALS, 'utf8'),
    { from: GLOBALS },
  );
  return result.css;
}

/** All `--custom: value` pairs declared in globals.css's :root. */
function rootVars(): Record<string, string> {
  const css = readFileSync(GLOBALS, 'utf8');
  const vars: Record<string, string> = {};
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    if (!(m[1] in vars)) vars[m[1]] = m[2].trim();
  }
  return vars;
}

/** Resolve a colour expression to a normalised uppercase #RRGGBB. */
function resolveColour(value: string, vars: Record<string, string>, depth = 0): string {
  const v = value.trim();
  if (depth > 10) return v;
  const varMatch = v.match(/^var\((--[a-z0-9-]+)/i);
  if (varMatch) {
    const target = vars[varMatch[1]];
    return target ? resolveColour(target, vars, depth + 1) : v;
  }
  // Tailwind's opacity-aware form: rgb(255 255 255 / var(--tw-bg-opacity, 1))
  const rgb = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)/);
  if (rgb) {
    return (
      '#' +
      [rgb[1], rgb[2], rgb[3]]
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    );
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  return v;
}

/** The declared value of `prop` inside the rule whose selector is exactly `.cls`. */
function declOf(css: string, cls: string, prop: string): string | undefined {
  const root = postcss.parse(css);
  let found: string | undefined;
  root.walkRules((rule) => {
    if (rule.selector !== `.${cls}`) return;
    rule.walkDecls(prop, (decl) => {
      found = decl.value;
    });
  });
  return found;
}

let globalsCss: string;
let vars: Record<string, string>;

beforeAll(async () => {
  globalsCss = await compileGlobals();
  vars = rootVars();
}, 60_000);

/**
 * TEST 1 — prerequisite 1. Reverting the textColor mapping in
 * tailwind.config.ts fails this test by name.
 */
describe('text tokens are wired into Tailwind and resolve to the right CSS variables', () => {
  it.each([
    ['text-strong', '--text-strong'],
    ['text-muted', '--text-muted'],
    ['text-faint', '--text-faint'],
  ])('%s emits color: var(%s)', async (utility, variable) => {
    const css = await compile(`<div class="${utility}"></div>`);
    const value = declOf(css, utility, 'color');

    // The utility must exist at all — before this PR `--text-strong` was a
    // variable with no utility, so text-earth had nowhere to convert to.
    expect(value, `${utility} was not emitted by Tailwind`).toBeDefined();
    expect(value).toBe(`var(${variable})`);
  });

  it('those variables are defined in globals.css', () => {
    expect(vars['--text-strong']).toBe('var(--earth)');
    expect(resolveColour('var(--text-strong)', vars)).toBe('#2D2519');
    expect(resolveColour('var(--text-muted)', vars)).toBe('#8B7355');
    expect(resolveColour('var(--text-faint)', vars)).toBe('#A89A87');
  });

  it('does not also mint bg-strong / border-strong (which would collide in meaning)', async () => {
    // `border-strong` must NOT resolve to --text-strong (earth): the existing
    // `border-line-strong` is --border-strong (stone-300). Scoping the text
    // roles to `textColor` makes the ambiguous utility unspellable.
    const css = await compile('<div class="bg-strong border-strong text-strong"></div>');
    expect(declOf(css, 'bg-strong', 'background-color')).toBeUndefined();
    expect(declOf(css, 'border-strong', 'border-color')).toBeUndefined();
    expect(declOf(css, 'text-strong', 'color')).toBeDefined();
  });
});

/**
 * TEST 2 — the safety property. Every token used by the converted surface must
 * render the exact colour the hardcoded utility it replaced rendered.
 */
describe('zero visual change in the light theme', () => {
  const swaps: Array<[legacy: string, prop: string, token: string]> = [
    ['bg-white', 'background-color', 'bg-surface-raised'],
    ['bg-stone-100', 'background-color', 'bg-surface-sunken'],
    ['border-stone-200', 'border-color', 'border-line'],
    ['text-earth', 'color', 'text-strong'],
    ['text-warm-brown', 'color', 'text-muted'],
  ];

  it.each(swaps)('%s and %s render the same colour', async (legacy, prop, token) => {
    const css = await compile(`<div class="${legacy} ${token}"></div>`);
    const legacyValue = declOf(css, legacy, prop);
    const tokenValue = declOf(css, token, prop);
    expect(legacyValue).toBeDefined();
    expect(tokenValue).toBeDefined();
    expect(resolveColour(tokenValue!, vars)).toBe(resolveColour(legacyValue!, vars));
  });

  it('the converted surface uses no opacity modifier on a variable-backed token', () => {
    // Variable-backed colours cannot take Tailwind's `/50` opacity modifier —
    // `bg-surface-raised/50` silently produces nothing. A mechanical swap of
    // `bg-white/50` would introduce exactly that, so pin it on the one
    // converted file.
    const src = readFileSync(path.join(ROOT, 'src/components/settings/DomainSection.tsx'), 'utf8');
    expect(src).not.toMatch(/(bg-surface[a-z-]*|border-line[a-z-]*|text-(strong|muted|faint))\/\d/);
  });
});

/**
 * TEST 3 — prerequisite 2. Reverting the theme mechanism (the `darkMode` key,
 * the stage-3 block, or the pre-paint script) fails this test by name.
 */
describe('the theme mechanism exists and is inert with only the light theme defined', () => {
  it('Tailwind is configured for selector-driven dark mode on both hooks', () => {
    const darkMode = (baseConfig as Config).darkMode as [string, string[]];
    expect(darkMode, 'no darkMode key — dark: would fall back to the OS media query').toBeDefined();
    expect(darkMode[0]).toBe('variant');
    expect(darkMode[1].join(' ')).toContain('.dark');
    expect(darkMode[1].join(' ')).toContain('[data-theme="dark"]');
  });

  it('the theme is resolved before first paint by a blocking inline script', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    // A plain inline <script> in <head>, NOT next/script (which defers and
    // would therefore flash the wrong theme).
    expect(layout).toMatch(/<script\s+dangerouslySetInnerHTML/);
    expect(layout).toContain("setAttribute('data-theme'");
    expect(layout).toContain("classList.toggle('dark'");
    expect(layout).toContain('prefers-color-scheme: dark');
    // Must not throw where localStorage is blocked (private mode, sandboxed iframe).
    expect(layout).toMatch(/try\{[\s\S]*catch/);
  });

  /**
   * RETIRED ASSERTION — recorded rather than deleted.
   *
   * This used to assert that no dark rule declared any custom property, i.e.
   * that the stage 2 mechanism was inert. It was written to fail the moment a
   * palette landed, and in stage 3 it did exactly that (19 offenders). That is
   * the guard working, not a regression: its premise — "stage 3 is out of scope
   * for this PR" — expired when stage 3 shipped.
   *
   * What replaces it is the invariant that outlives inertness: the dark theme
   * may override the neutral ramp, but it must NEVER override --brand-color.
   * Tenant branding drives the accent only; deriving neutrals from an arbitrary
   * tenant hex is how white-label dark themes become unreadable. Palette
   * correctness itself is asserted in theming-stage3.test.ts.
   */
  it('no dark rule overrides --brand-color — tenant branding drives the accent only', () => {
    const root = postcss.parse(globalsCss);
    const offenders: string[] = [];
    root.walkRules((rule) => {
      if (!/(^|[\s,])(\.dark|\[data-theme="dark"\])/.test(rule.selector)) return;
      rule.walkDecls((decl) => {
        if (decl.prop === '--brand-color' || decl.prop === '--color-primary') {
          offenders.push(`${rule.selector} { ${decl.prop} }`);
        }
      });
    });
    expect(offenders, 'the dark theme is overriding tenant branding').toEqual([]);
  });

  it('nothing in the app renders a dark-variant utility today', () => {
    // The only dark: utility in the tree is on src/components/ui/avatar.tsx,
    // which no file imports. If a rendered component starts using dark:, the
    // "provably zero visual change" claim needs re-checking.
    const root = postcss.parse(globalsCss);
    const darkVariantRules: string[] = [];
    root.walkRules((rule) => {
      if (rule.selector.includes('.dark\\:')) darkVariantRules.push(rule.selector);
    });
    expect(darkVariantRules.every((s) => s.includes('mix-blend-lighten'))).toBe(true);
  });
});
