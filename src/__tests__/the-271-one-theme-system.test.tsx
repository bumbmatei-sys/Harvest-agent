import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import postcss from 'postcss';
import {
  THEME_STORAGE_KEY,
  FAMILY_STORAGE_KEY,
  DEFAULT_PALETTE_FAMILY,
  PALETTE_FAMILIES,
  isPaletteFamily,
  deriveOnDarkAccent,
  deriveOnTintAccent,
  accentTintGround,
  ACCENT_TINT_PCT,
  contrastRatio,
  AA_CONTRAST,
  DARK_SURFACE,
  CLASSIC_DARK_SURFACE,
  DARK_SURFACE_RAISED,
  CLASSIC_DARK_SURFACE_RAISED,
  type PaletteFamily,
  type ThemeChoice,
} from '../lib/theme';
import { PREAUTH_PATHS } from '../lib/preauth-theme';
import { applyThemeForLocation, applyTheme, readStoredChoice, readStoredFamily } from '../lib/theme-runtime';
import { useTheme } from '../lib/use-theme';
import ThemeToggle from '../components/ThemeToggle';
import PaletteFamilyToggle from '../components/PaletteFamilyToggle';

/**
 * THE-271 — ONE theme system, and this suite is the argument for which one.
 *
 * 🔵 THE DECISION: Harvest keeps its own system. `next-themes` drives nothing,
 * gets no provider, and stays out of the pre-paint path. A thin first-party
 * shim (`src/lib/use-theme.ts`) gives shadcn components the real theme through
 * a next-themes-shaped `useTheme()`, so adopting it is a one-line change of
 * import specifier and the library owns nothing.
 *
 * ⚠️ THE TICKET'S PREMISE WAS WRONG IN ONE PLACE, and it changes the outcome.
 * It says next-themes "has NO provider anywhere in `src`", which is true, and
 * infers that nothing uses it, which is not: `src/components/ui/sonner.tsx`
 * imports `useTheme` from it. So "remove the dependency entirely" — the
 * ticket's fourth option, and a legitimate outcome — cannot be done from this
 * ticket: dropping the package while that import stands is a `tsc` failure,
 * and `src/components/ui/**` belongs to THE-270 / THE-272. Section 9 pins the
 * import census so the removal becomes a one-line follow-up the moment that
 * file's owner switches the specifier.
 *
 * ✅ THE-273 IS THAT FOLLOW-UP, and this file carries the consequences.
 * `sonner.tsx` now reads the shim, the census went red exactly as designed,
 * and `next-themes` is out of package.json. Two things changed here as a
 * result, both recorded where they happened rather than only here:
 *   • sections 1 and 2 lost the five tests that DROVE the installed library.
 *     A test cannot exercise a package that is not installed, and keeping the
 *     package solely to keep those tests would have preserved exactly the
 *     installed-but-inert state the removal exists to end. Their argument
 *     survives in prose in src/lib/use-theme.ts's docblock; the claims that
 *     were about HARVEST rather than about the library survive as tests.
 *   • section 9's census flipped from "exactly one importer" to "none, and
 *     not in package.json either", and now walks the test trees too.
 *
 * ⚠️ NOTHING WAS CHANGED IN THE LOAD-BEARING PATH. `src/app/layout.tsx`,
 * `src/lib/theme.ts`, `src/lib/theme-runtime.ts`, `src/lib/preauth-theme.ts`
 * and `src/app/globals.css` are byte-identical to `main` — section 5 asserts
 * the layout's digest against the four suites that already pin it. That is
 * why the pre-paint script needed no regenerated hash, why #409's paired
 * default survives untouched, and why there is exactly one inline theme
 * script on the page.
 *
 * ⚠️ No `git show` anywhere: every expectation reads the working tree, so a
 * shallow CI clone cannot change the result.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const LAYOUT = path.join(ROOT, 'src/app/layout.tsx');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');

const digestOf = (rel: string): string =>
  createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

/* ── the real pre-paint script, extracted and made runnable ─────────────────
 * Lifted unchanged from `the-265-classic-default.test.ts`, which lifted it
 * from `preauth-light.test.ts`. A re-implementation would keep passing after
 * the real script broke, and the real script is the thing under test. */
function prePaintScript(): string {
  const layout = readFileSync(LAYOUT, 'utf8');
  const m = layout.match(/__html: `(\(function\(\)\{try\{[\s\S]*?)`,/);
  if (!m) throw new Error('pre-paint theme script not found in layout.tsx');
  return m[1]
    .replace('${JSON.stringify(PREAUTH_PATHS)}', JSON.stringify(PREAUTH_PATHS))
    .replace(/\\\\/g, '\\');
}

const SCRIPT = prePaintScript();

function runPrePaint(url: string): void {
  window.history.replaceState({}, '', url);
  // eslint-disable-next-line no-new-func
  new Function(SCRIPT)();
}

const stamped = () => ({
  attr: document.documentElement.getAttribute('data-theme'),
  dark: document.documentElement.classList.contains('dark'),
  palette: document.documentElement.getAttribute('data-palette'),
});

let matchesDark = false;

const resetHtml = () => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-palette');
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
};

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear();
  resetHtml();
  matchesDark = false;
  window.history.replaceState({}, '', '/');
  window.matchMedia = ((q: string) => ({
    matches: /prefers-color-scheme:\s*dark/.test(q) ? matchesDark : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

/* ── React mounting helpers ────────────────────────────────────────────── */

/** Every root mounted in a test, so one that mounts twice cannot leave the
 *  first tree (and its matchMedia listeners) alive into the next test. */
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await act(async () => { m.root.unmount(); });
    m.container.remove();
  }
});

const mount = async (node: React.ReactElement): Promise<HTMLDivElement> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    const root = createRoot(container);
    mounted.push({ root, container });
    root.render(node);
  });
  return container;
};

/**
 * 🔴 Mount and stop at the paint boundary.
 *
 * `flushSync` renders and COMMITS synchronously — layout effects run inside
 * it, passive effects do not. That is exactly where the browser would paint,
 * so whatever the DOM says when this returns is what the user's first frame
 * shows. `act()` flushes both kinds and therefore cannot tell a pre-paint
 * correction from a post-paint one; this can. Section 4 validates the
 * technique against a control component before trusting it.
 */
const mountToPaint = (node: React.ReactElement): HTMLDivElement => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  flushSync(() => { root.render(node); });
  return container;
};

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 THE DECISION: Harvest's two axes, and why no one-value writer fits
//
//     ⚠️ THE-273 REMOVED THE PACKAGE, and three tests went with it. They
//     DROVE the installed library — a multi-attribute provider writing one
//     value into every attribute, the `value` map failing to rescue it, and
//     its single storage key — so they could only exist while next-themes was
//     in node_modules. `sonner.tsx` was its last importer; once that switched
//     to the first-party shim the dependency came out of package.json, and
//     importing the package is now a module-resolution failure rather than a
//     test. (This comment spells no import of it: the census below greps the
//     test trees too.) The argument they measured is recorded in full in
//     src/lib/use-theme.ts's docblock, which is where anyone weighing a
//     re-adoption will land.
//
//     What survives is the half that was never about the library: the stamps
//     Harvest's OWN code produces. No writer that puts ONE value on both
//     attributes can reach any of them, whatever library is behind it — so
//     this outlives the specific package it was written against. The census
//     in section 9 is what now guards the removal.
// ═══════════════════════════════════════════════════════════════════════════

describe('1 — Harvest has two axes, and a one-value writer reaches none of them', () => {
  it('🔴 so NONE of the four stamps the real system produces is reachable', () => {
    // The closing argument, and it is about Harvest rather than about the
    // library: a writer that puts ONE value on both attributes can only ever
    // produce a stamp where data-theme === data-palette. Run the real
    // pre-paint script for all four combinations and collect what it
    // actually writes — not one of them has that shape, so not one of them
    // is reachable, whatever theme names or `value` map you invent.
    const produced: string[] = [];
    for (const mode of ['light', 'dark'] as const) {
      for (const family of PALETTE_FAMILIES) {
        localStorage.clear();
        localStorage.setItem(THEME_STORAGE_KEY, mode);
        localStorage.setItem(FAMILY_STORAGE_KEY, family);
        resetHtml();
        runPrePaint('/');
        const { attr, palette } = stamped();
        produced.push(`${attr}/${palette}`);
        expect(
          attr === palette,
          `${attr}/${palette} would need data-theme === data-palette to be reachable`,
        ).toBe(false);
      }
    }
    expect(new Set(produced).size, 'the four palettes are not four distinct stamps').toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · 🔴 the app keeps exactly ONE inline theme script
//
//     ⚠️ THE-273: the two tests that rendered next-themes' own provider to
//     capture its inline script — and showed it restamping data-theme over
//     the THE-85 pre-auth force — went with the package, for the same reason
//     as section 1. What they proved is now structural rather than argued:
//     there is no second pre-paint script because there is no second theme
//     library installed. The test below still pins that from this side.
// ═══════════════════════════════════════════════════════════════════════════

describe('2 — the app keeps exactly one inline theme script', () => {
  it('🔴 there is exactly one, it is the head one, and no provider is mounted', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    // Exactly one dangerouslySetInnerHTML script that touches documentElement.
    const scripts = layout.match(/__html: `\(function\(\)\{try\{[\s\S]*?`,/g) ?? [];
    expect(scripts, 'layout.tsx gained or lost a pre-paint script').toHaveLength(1);
    expect(SCRIPT).toContain("setAttribute('data-theme'");
    expect(SCRIPT).toContain("setAttribute('data-palette'");
    expect(SCRIPT).toContain("classList.toggle('dark'");

    // And no next-themes provider is mounted anywhere in the app: neither
    // rendered as JSX nor imported by name. (A bare mention in a comment is
    // not a mount — sonner.tsx names it while explaining its absence.)
    const offenders = walkSrc().filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /<ThemeProvider[\s/>]/.test(src) || /import\s*\{[^}]*\bThemeProvider\b[^}]*\}\s*from\s*['"]next-themes['"]/.test(src);
    });
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      'a next-themes ThemeProvider was mounted — it ships a second pre-paint script',
    ).toEqual([]);
  });
});

/** Every non-test .ts/.tsx file under src/. */
function walkSrc(dir: string = SRC, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== '__tests__' && e !== 'node_modules') walkSrc(p, out);
    } else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/** Every .ts/.tsx file under src/, __tests__ INCLUDED. The census needs the
 *  test trees too now that next-themes is not installed at all: an import
 *  from a test file resolves to nothing just as surely as one from a
 *  component, and this names the file rather than leaving a bare
 *  module-not-found. */
function walkAllSrc(dir: string = SRC, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== 'node_modules') walkAllSrc(p, out);
    } else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · all four palettes resolve and render — one named test per palette
// ═══════════════════════════════════════════════════════════════════════════

/** Custom properties declared in a rule matched by `selectorTest`. Same
 *  `varsIn` as theming-stage3 / theming-classic-palette, on purpose. */
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

function resolveVar(name: string, scope: Record<string, string>, depth = 0): string {
  const v = scope[name];
  if (!v || depth > 10) return v ?? '';
  const m = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  return m ? resolveVar(m[1], scope, depth + 1) : v;
}

const GLOBALS_CSS = readFileSync(GLOBALS, 'utf8');

const ROOT_VARS = varsIn(GLOBALS_CSS, (s) => s === ':root');
const HARVEST_DARK_VARS = varsIn(
  GLOBALS_CSS,
  (s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'),
);
const CLASSIC_LIGHT_VARS = varsIn(
  GLOBALS_CSS,
  (s) => s.includes('data-palette="classic"') && s.includes('data-theme="light"'),
);
const CLASSIC_DARK_VARS = varsIn(
  GLOBALS_CSS,
  (s) => s.includes('data-palette="classic"') && (s.includes('.dark') || s.includes('data-theme="dark"')),
);

/**
 * The cascade, resolved the way a browser would for a given stamp.
 *
 * Harvest is the substrate (`:root`, then `.dark`); Classic is purely
 * additive on top — globals.css says so itself. So a stamp selects a scope by
 * layering, never by replacing, which is why "Classic overrides 14 tokens and
 * ~120 fall through" is a property this function reproduces rather than a
 * claim it asserts.
 */
function scopeFor(theme: 'light' | 'dark', family: PaletteFamily): Record<string, string> {
  const scope = { ...ROOT_VARS };
  if (theme === 'dark') Object.assign(scope, HARVEST_DARK_VARS);
  if (family === 'classic') {
    Object.assign(scope, theme === 'dark' ? CLASSIC_DARK_VARS : CLASSIC_LIGHT_VARS);
  }
  return scope;
}

/** The tokens every surface in the app paints with. If one of these fails to
 *  resolve to a literal, that palette does not render. */
const CORE_TOKENS = [
  '--surface', '--surface-raised', '--surface-sunken', '--surface-chip',
  '--border-default', '--border-strong',
  '--text-strong', '--text-heading', '--text-body', '--text-muted', '--text-faint',
];

const PALETTES: ReadonlyArray<{
  name: string;
  choice: ThemeChoice;
  theme: 'light' | 'dark';
  family: PaletteFamily;
  surface: string;
}> = [
  // 🔴 The two DARK grounds are spelled as the theme.ts constants, not as
  // hexes retyped from globals.css: deriveOnDarkAccent's AA guarantee holds
  // only while those constants match the CSS exactly, so asserting them here
  // is what makes section 8 mean anything. The two LIGHT grounds are resolved
  // out of the real cascade, since theme.ts has no constant for them.
  { name: 'Harvest light', choice: 'light', theme: 'light', family: 'harvest', surface: resolveVar('--surface', ROOT_VARS) },
  { name: 'Harvest dark', choice: 'dark', theme: 'dark', family: 'harvest', surface: DARK_SURFACE },
  { name: 'Classic light', choice: 'light', theme: 'light', family: 'classic', surface: resolveVar('--surface', { ...ROOT_VARS, ...CLASSIC_LIGHT_VARS }) },
  { name: 'Classic dark', choice: 'dark', theme: 'dark', family: 'classic', surface: CLASSIC_DARK_SURFACE },
];

describe('3 — all four palettes resolve and render', () => {
  // 🔴 Classic is the DEFAULT since #409, so it is checked first.
  it('Classic is still the default, so it is the palette to check first', () => {
    expect(DEFAULT_PALETTE_FAMILY).toBe('classic');
  });

  for (const p of PALETTES) {
    it(`${p.name} resolves every core token to a literal colour`, () => {
      const scope = scopeFor(p.theme, p.family);
      for (const token of CORE_TOKENS) {
        const value = resolveVar(token, scope);
        expect(value, `${p.name}: ${token} does not resolve`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
      }
    });

    it(`${p.name} is selected by the stamp the real code produces`, () => {
      // Not "the CSS exists" — that the attributes the pre-paint script and
      // applyTheme actually write are the ones that select this scope.
      localStorage.setItem(THEME_STORAGE_KEY, p.choice);
      localStorage.setItem(FAMILY_STORAGE_KEY, p.family);

      runPrePaint('/');
      expect(stamped(), `${p.name}: pre-paint stamped the wrong scope`).toEqual({
        attr: p.theme,
        dark: p.theme === 'dark',
        palette: p.family,
      });

      const scope = scopeFor(p.theme, p.family);
      expect(resolveVar('--surface', scope), `${p.name}: wrong page ground`).toBe(p.surface);
    });

    it(`${p.name} paints readable body text on its own ground`, () => {
      // A palette that "resolves" but puts 2:1 text on its surface does not
      // render in any sense worth having.
      const scope = scopeFor(p.theme, p.family);
      const ground = resolveVar('--surface', scope);
      const body = resolveVar('--text-body', scope);
      const ratio = contrastRatio(body, ground);
      expect(ratio, `${p.name}: --text-body ${body} on ${ground} is ${ratio.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(AA_CONTRAST);
    });
  }

  it('the four are genuinely four — no two share a page ground', () => {
    const grounds = PALETTES.map((p) => resolveVar('--surface', scopeFor(p.theme, p.family)));
    expect(new Set(grounds).size, `two palettes render the same ground: ${grounds.join(', ')}`).toBe(4);
  });

  it('and Classic really is additive — it overrides surfaces/borders/text and nothing else', () => {
    // The property #409 depends on: "remove Harvest" is not buildable because
    // Classic is written on top of it. If Classic ever redefined a font or a
    // radius, changing the default would change more than the ticket claimed.
    for (const vars of [CLASSIC_LIGHT_VARS, CLASSIC_DARK_VARS]) {
      for (const token of Object.keys(vars)) {
        expect(token, `Classic overrides ${token}, which is not a surface/border/text token`)
          .toMatch(/^--(surface|border|text)-?/);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · 🔴 NO FLASH ON FIRST PAINT — all four combinations, EXERCISED
// ═══════════════════════════════════════════════════════════════════════════

/** Reads the theme through the shim and writes it into the DOM, so what the
 *  first frame would show is inspectable. */
const ShimProbe: React.FC = () => {
  const { theme, palette } = useTheme();
  return <span data-probe={`${theme}/${palette}`} />;
};

/** A deliberately WRONG control: identical, but syncing in a passive effect,
 *  i.e. after paint. Its only job is to prove the harness below can actually
 *  see a flash — a test for "no flash" that cannot detect one is worthless. */
const FlashingProbe: React.FC = () => {
  const [v, setV] = useState('light/classic');
  useEffect(() => {
    const el = document.documentElement;
    setV(`${el.getAttribute('data-theme')}/${el.getAttribute('data-palette')}`);
  }, []);
  return <span data-probe={v} />;
};

const probeValue = (c: HTMLElement): string => c.querySelector('span')!.getAttribute('data-probe')!;

describe('4 — no flash on first paint, in all four combinations', () => {
  it('🔴 the harness can SEE a flash — the control probe fails the way a flash looks', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(FAMILY_STORAGE_KEY, 'classic');
    runPrePaint('/');

    const c = mountToPaint(<FlashingProbe />);
    // At the paint boundary the post-paint prober still shows its seed: this
    // is exactly the wrong-theme frame a user would see.
    expect(probeValue(c), 'the control corrected before paint, so this harness proves nothing')
      .toBe('light/classic');
    // …and only catches up afterwards.
    await act(async () => {});
    expect(probeValue(c)).toBe('dark/classic');
  });

  /**
   * ⚠️ One honest caveat, recorded rather than hidden: the seed the shim
   * renders with before its layout effect runs is light/classic — what a
   * brand-new visitor gets — so CLASSIC LIGHT is the one combination where a
   * post-paint correction would be invisible here. The other three catch it,
   * and the control test above catches the technique failing outright. Swap
   * the shim's layout effect for a passive one and three of these four go
   * red, which is what was verified.
   */
  for (const p of PALETTES) {
    it(`${p.name}: <html> is stamped before paint and the shim agrees at that instant`, async () => {
      localStorage.setItem(THEME_STORAGE_KEY, p.choice);
      localStorage.setItem(FAMILY_STORAGE_KEY, p.family);

      // 1. the document load: the head script runs before any bundle.
      runPrePaint('/');
      const atPrePaint = stamped();
      expect(atPrePaint).toEqual({ attr: p.theme, dark: p.theme === 'dark', palette: p.family });

      // 2. first paint: a component reading the theme already has the right
      //    value — no correction lands after the user has seen a frame.
      const c = mountToPaint(<ShimProbe />);
      expect(probeValue(c), `${p.name}: the shim painted the wrong theme first`)
        .toBe(`${p.theme}/${p.family}`);

      // 3. hydration settles: nothing moves.
      await act(async () => {});
      expect(probeValue(c), `${p.name}: the shim corrected itself AFTER paint — that is the flash`)
        .toBe(`${p.theme}/${p.family}`);
      expect(stamped(), `${p.name}: <html> changed after first paint`).toEqual(atPrePaint);
    });

    it(`${p.name}: the SPA's own re-apply on route change stamps the identical scope`, () => {
      // The pre-paint script runs once per document load; applyThemeForLocation
      // runs on every client navigation. If the two disagreed for any storage
      // state, a route change would repaint into the other palette.
      localStorage.setItem(THEME_STORAGE_KEY, p.choice);
      localStorage.setItem(FAMILY_STORAGE_KEY, p.family);

      runPrePaint('/');
      const fromScript = stamped();

      resetHtml();
      applyThemeForLocation('/');
      expect(stamped(), `${p.name}: pre-paint and hydration disagree`).toEqual(fromScript);
    });
  }

  it('🔴 and a cold load with NOTHING stored paints the default, both scripts agreeing', () => {
    // The path most users take, and the one #409 changed.
    runPrePaint('/');
    const fromScript = stamped();
    expect(fromScript.palette).toBe(DEFAULT_PALETTE_FAMILY);

    resetHtml();
    applyThemeForLocation('/');
    expect(stamped()).toEqual(fromScript);
  });

  it('the shim corrects before paint because it syncs in a LAYOUT effect', () => {
    // Behaviour is asserted above; this pins the mechanism, because in a
    // test renderer act() flushes both effect kinds and a future edit could
    // swap useLayoutEffect for useEffect without the assertions noticing.
    const shim = readFileSync(path.join(SRC, 'lib/use-theme.ts'), 'utf8');
    expect(shim).toContain('useIsomorphicLayoutEffect');
    expect(shim).toContain('typeof window !== \'undefined\' ? useLayoutEffect : useEffect');
    expect(shim, 'the shim syncs in a passive effect — that lands after paint')
      .not.toMatch(/\n\s*useEffect\(\(\) => \{\n\s*const sync/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · 🔴 #409's paired default survives — because layout.tsx was not touched
// ═══════════════════════════════════════════════════════════════════════════

describe('5 — the pre-paint script and theme.ts still agree on the default', () => {
  /**
   * The same structural parse `the-265-classic-default.test.ts` uses, restated
   * here rather than imported, because THIS ticket's claim is "the mechanism
   * that pins them survived my change". A test that only re-ran #409's file
   * would prove the file still runs, not that the property still holds.
   */
  const defaultFromScript = (): string => {
    const m = SCRIPT.match(
      /setAttribute\('data-palette',\s*f===('[a-z]+')\s*\?\s*('[a-z]+')\s*:\s*('[a-z]+')\)/,
    );
    if (!m) throw new Error('the family ternary was not found in the pre-paint script');
    const [, tested, thenArm, elseArm] = m.map((x) => x && x.replace(/'/g, ''));
    expect(thenArm, 'the pre-paint script rewrites a stored family to a different one').toBe(tested);
    return elseArm;
  };

  it('🔴 the pre-paint default IS DEFAULT_PALETTE_FAMILY', () => {
    expect(
      defaultFromScript(),
      'the script and DEFAULT_PALETTE_FAMILY disagree — a cold load would paint one family and hydrate into the other',
    ).toBe(DEFAULT_PALETTE_FAMILY);
  });

  it('🔴 the pre-auth FORCED family in the script is that same constant', () => {
    const m = SCRIPT.match(
      /classList\.remove\('dark'\);e\.setAttribute\('data-palette','([a-z]+)'\);return;/,
    );
    expect(m, 'the pre-auth branch no longer stamps a literal family').toBeTruthy();
    expect(m![1], 'the funnel and the app it leads into default to different families')
      .toBe(DEFAULT_PALETTE_FAMILY);
  });

  it('🔴 layout.tsx is byte-identical to main, so the hash pin needed no regeneration', () => {
    // Four suites pin this file's digest (theming-shadcn-tokens,
    // the-266-shadcn-batch-a, posthog-public-routes, posthog-untouched). The
    // cheapest way to keep every one of them green — and to keep the pre-paint
    // script provably unraced — was to not touch the file at all.
    expect(
      digestOf('src/app/layout.tsx'),
      'layout.tsx changed — regenerate the four pinned digests and record the reason',
    ).toBe('bf5f96a61c3fa2f467556f44f0b36e91e49b7c830609b37c775fa6a2b9232ca5');
  });

  /**
   * 🔴 The rest of the load-bearing path, byte-for-byte.
   *
   * If THE-271 had adopted next-themes, every one of these would have had to
   * move: theme.ts would have lost DEFAULT_PALETTE_FAMILY's meaning to a
   * provider prop, theme-runtime would have lost applyTheme, preauth-theme's
   * list would have had nowhere to be interpolated, and globals.css would
   * have needed selectors for whatever attribute values the library emits.
   * That none of them moved is the shape of the decision, stated as a digest.
   *
   * ⚠️ globals.css and src/components/ui/** belong to THE-270 and THE-272,
   * which are in flight against the same main. Their digests are pinned here
   * for the same reason firestore.rules is: to prove THIS branch did not
   * touch them.
   */
  const UNCHANGED: Record<string, string> = {
    'src/lib/theme.ts': '97d2f057fa04f85f33a1faa0dc196324d51770c6032ca9b4d21e467dfd70d8de',
    'src/lib/theme-runtime.ts': '499d75f3ee336303d247c02a38c7bcc2338206609066da420842795745d9dee3',
    'src/lib/preauth-theme.ts': '1940796f21a9c5219ba6d35d15958eafb34aaada0e3a2670f5d858f65e840ad0',
    'src/lib/use-resolved-theme.ts': 'ec8961c8637fd0004c4cf8d6a9ba9830e88b7a02b65c730f52172acd396114a6',
    'src/app/globals.css': '772c79af681c2b97c496b91be4f2573415f2a65802dfac078dbc72e8a8fd3741',
    'src/components/ThemeToggle.tsx': 'efd6790ae14ebb1e5238ce601828589724ffcd4931f6c90e631927d9e1522277',
    'src/components/PaletteFamilyToggle.tsx': '6a88e764af6b6d861d6e4df7bf01593d497d240a326ea6c94c03794349484233',
  };

  it.each(Object.keys(UNCHANGED))('%s is byte-for-byte unchanged', (file) => {
    expect(digestOf(file), `${file} changed — THE-271 changes no existing theme code`)
      .toBe(UNCHANGED[file]);
  });

  /**
   * ⚠️ sonner.tsx WAS in the list above, and THE-273 moved it — on purpose,
   * and it is the one file in the load-bearing path that any ticket has been
   * allowed to move since. So it is not dropped from the pin and it is not
   * quietly re-recorded into `UNCHANGED`: it gets its own assertion naming
   * both digests, which keeps every claim the original list made.
   *
   *   • it still fails if sonner.tsx moves AGAIN, to any third value;
   *   • it still fails if it somehow reverts to the THE-271 version, which
   *     would mean the light default is back;
   *   • and no other file gained the same licence, because the list above is
   *     untouched.
   */
  it('src/components/ui/sonner.tsx moved exactly once, and THE-273 is why', () => {
    const THE_271 = 'f76ee6fb6aa5892bdc1c92b8b282a59f34b63f3fa2ab01475df4a61988f0014b';
    const THE_273 = '2ebc0c9ba968858cead2fbf2523dfd9da217715339967025e8c8df94f2131ab9';
    const actual = digestOf('src/components/ui/sonner.tsx');
    expect(
      actual,
      actual === THE_271
        ? 'sonner.tsx is back to its THE-271 state — the hard-coded light default has returned'
        : 'sonner.tsx changed again; if that is intended, re-record BOTH this digest and the-273-toast-dark-mode.test.tsx',
    ).toBe(THE_273);
  });

  it('the two storage keys are still spelled identically in both homes', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(layout).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    expect(layout).toContain(`localStorage.getItem('${FAMILY_STORAGE_KEY}')`);
  });

  it('behaviourally: script and runtime stamp the same family in every storage state', () => {
    for (const stored of [null, 'harvest', 'classic', 'sepia', '']) {
      localStorage.clear();
      if (stored !== null) localStorage.setItem(FAMILY_STORAGE_KEY, stored);

      runPrePaint('/');
      const fromScript = stamped().palette;

      document.documentElement.removeAttribute('data-palette');
      applyThemeForLocation('/');
      expect(stamped().palette, `stored=${JSON.stringify(stored)}: pre-paint and hydration disagree`)
        .toBe(fromScript);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · a user who has chosen keeps their choice
// ═══════════════════════════════════════════════════════════════════════════

describe('6 — a stored family is still honoured', () => {
  it("a stored 'harvest' still gets Harvest, through both paths and in dark", () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    runPrePaint('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: 'harvest' });

    resetHtml();
    applyThemeForLocation('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: 'harvest' });

    expect(readStoredFamily()).toBe('harvest');
    // …and reading it never rewrote it.
    expect(localStorage.getItem(FAMILY_STORAGE_KEY)).toBe('harvest');
  });

  it("a stored 'classic' still gets Classic, through both paths and in dark", () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'classic');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    runPrePaint('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: 'classic' });

    resetHtml();
    applyThemeForLocation('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: 'classic' });

    expect(readStoredFamily()).toBe('classic');
    expect(localStorage.getItem(FAMILY_STORAGE_KEY)).toBe('classic');
  });

  it('and the shim reports the stored family back to a component', () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runPrePaint('/');
    const c = mountToPaint(<ShimProbe />);
    expect(probeValue(c)).toBe('dark/harvest');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · 🔴 pre-auth is light-mode only, in BOTH families (THE-85, no-regression)
// ═══════════════════════════════════════════════════════════════════════════

describe('7 — pre-auth is light-mode only in both families', () => {
  for (const family of PALETTE_FAMILIES) {
    it(`a stored dark + ${family} still gets a LIGHT sign-in screen`, () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      localStorage.setItem(FAMILY_STORAGE_KEY, family);

      for (const p of PREAUTH_PATHS) {
        resetHtml();
        runPrePaint(p);
        expect(stamped(), `${p} (${family}) painted dark before hydration`).toEqual({
          attr: 'light',
          dark: false,
          palette: DEFAULT_PALETTE_FAMILY,
        });

        resetHtml();
        applyThemeForLocation(p);
        expect(stamped(), `${p} (${family}) went dark on hydration`).toEqual({
          attr: 'light',
          dark: false,
          palette: DEFAULT_PALETTE_FAMILY,
        });
      }
    });
  }

  it('a dark-OS visitor with nothing stored still gets a light sign-in page', () => {
    matchesDark = true;
    for (const p of PREAUTH_PATHS) {
      resetHtml();
      runPrePaint(p);
      expect(stamped().attr, `${p} followed the OS into dark`).toBe('light');
    }
  });

  it('🔴 it is still a FORCE, not a fallback — a stored harvest is ignored on the funnel', () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    runPrePaint('/auth');
    expect(stamped().palette, 'the funnel let a stored family through').toBe(DEFAULT_PALETTE_FAMILY);
  });

  it("🔴 but a stored 'system' does NOT report a false force on an ordinary screen", () => {
    // The OS can move while nothing is re-stamping <html> (ThemeToggle
    // subscribes to that, and it is only mounted on the settings screens), so
    // under 'system' a stamp/OS disagreement means "the stamp is older than
    // the OS", not "something is forcing". Reporting a force here would put a
    // false positive on every ordinary screen.
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    matchesDark = false;
    applyThemeForLocation('/');
    expect(stamped().attr).toBe('light');
    matchesDark = true; // the OS moves, nobody re-stamps

    const Probe: React.FC = () => {
      const { theme, forcedTheme, systemTheme } = useTheme();
      return <span data-probe={`${theme}|${forcedTheme}|${systemTheme}`} />;
    };
    const c = mountToPaint(<Probe />);
    expect(probeValue(c), 'a stale stamp was reported as a force').toBe('light|undefined|dark');
  });

  it('and the shim tells a component the funnel is forced, without inventing a value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    applyThemeForLocation('/auth');

    const Probe: React.FC = () => {
      const { theme, themeChoice, forcedTheme, palette } = useTheme();
      return <span data-probe={`${theme}|${themeChoice}|${forcedTheme}|${palette}`} />;
    };
    const c = mountToPaint(<Probe />);
    // Rendered light, REMEMBERS dark — the whole THE-85 property, visible to a
    // component for the first time.
    expect(probeValue(c)).toBe(`light|dark|light|${DEFAULT_PALETTE_FAMILY}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · 🔴 nothing writes the stored preference during a pre-auth force
// ═══════════════════════════════════════════════════════════════════════════

describe('8 — nothing writes the stored preference during a pre-auth force', () => {
  const snapshot = () => ({
    theme: localStorage.getItem(THEME_STORAGE_KEY),
    family: localStorage.getItem(FAMILY_STORAGE_KEY),
    length: localStorage.length,
  });

  it('the theme-application layer contains no write at all', () => {
    const runtime = readFileSync(path.join(SRC, 'lib/theme-runtime.ts'), 'utf8');
    expect(runtime).not.toMatch(/localStorage\.setItem/);
    expect(readFileSync(LAYOUT, 'utf8')).not.toMatch(/localStorage\.setItem/);
  });

  it('🔴 a full funnel visit leaves both keys exactly as they were', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    const before = snapshot();

    for (const p of PREAUTH_PATHS) {
      runPrePaint(p);
      applyThemeForLocation(p);
    }
    expect(snapshot(), 'a pre-auth force persisted itself — the user just lost dark mode').toEqual(before);
  });

  it('🔴 and neither does MOUNTING a component that reads the theme through the shim', async () => {
    // The new surface this ticket adds. A shim that "helpfully" normalised the
    // stored value on first read would break THE-85 from a direction nothing
    // was watching.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    applyThemeForLocation('/auth');
    const before = snapshot();

    const c = mountToPaint(<ShimProbe />);
    expect(probeValue(c)).toBe(`light/${DEFAULT_PALETTE_FAMILY}`);
    await act(async () => {});

    expect(snapshot(), 'the shim wrote a preference while the funnel was forcing').toEqual(before);
  });

  it('the user is back in dark/harvest the moment they sign in again', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    applyThemeForLocation('/auth');
    expect(stamped().attr).toBe('light');

    applyThemeForLocation('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: 'harvest' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · 🔵 useTheme() returns the REAL theme to a shadcn component
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shaped exactly like `src/components/ui/sonner.tsx`'s single line —
 * `const { theme = "light" } = useTheme()` — because that is the call this
 * ticket exists to answer, and the whole claim is that switching its import
 * specifier is the entire change.
 */
const ShadcnShapedConsumer: React.FC = () => {
  const { theme = 'light' } = useTheme();
  return <span data-probe={theme} data-sonner-theme={theme} />;
};

describe('9 — useTheme() returns the real theme to a shadcn component', () => {
  for (const p of PALETTES) {
    it(`${p.name}: a sonner-shaped consumer gets '${p.theme}'`, () => {
      localStorage.setItem(THEME_STORAGE_KEY, p.choice);
      localStorage.setItem(FAMILY_STORAGE_KEY, p.family);
      runPrePaint('/');
      const c = mountToPaint(<ShadcnShapedConsumer />);
      expect(probeValue(c)).toBe(p.theme);
    });
  }

  it("🔴 and it is NEVER the string 'system', which is what makes it a drop-in", () => {
    // next-themes' `theme` is the STORED choice, so it can be 'system' —
    // sonner passes that straight through and then follows the OS. On a
    // light-forced sign-in page with a dark OS that means dark toasts over a
    // light screen, which is the exact bug sonner.tsx's comment describes.
    matchesDark = true;
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    applyThemeForLocation('/auth');

    const c = mountToPaint(<ShadcnShapedConsumer />);
    expect(probeValue(c), 'the shim leaked the stored choice instead of the rendered theme')
      .toBe('light');
    expect(['light', 'dark']).toContain(probeValue(c));
  });

  it("a 'system' choice still tracks the OS where nothing is forcing", () => {
    matchesDark = true;
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    applyThemeForLocation('/');
    const c = mountToPaint(<ShadcnShapedConsumer />);
    expect(probeValue(c)).toBe('dark');
  });

  it('it follows a live theme change, because both writers stamp <html> directly', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    localStorage.setItem(FAMILY_STORAGE_KEY, 'classic');
    runPrePaint('/');
    const c = mountToPaint(<ShimProbe />);
    expect(probeValue(c)).toBe('light/classic');

    // What ThemeToggle does when a user picks Dark.
    await act(async () => { applyTheme('dark'); });
    expect(probeValue(c), 'the shim did not hear the stamp change').toBe('dark/classic');

    await act(async () => { applyTheme('dark', 'harvest'); });
    expect(probeValue(c), 'the shim ignored the family axis').toBe('dark/harvest');
  });

  it('the shim exposes BOTH axes — the thing next-themes has no slot for', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    runPrePaint('/');

    const Probe: React.FC = () => {
      const t = useTheme();
      return (
        <span
          data-probe={[
            t.theme, t.resolvedTheme, t.themeChoice, t.palette,
            t.themes.join('+'), t.palettes.join('+'),
            typeof t.setTheme, typeof t.setPalette,
          ].join('|')}
        />
      );
    };
    const c = mountToPaint(<Probe />);
    expect(probeValue(c)).toBe('dark|dark|dark|harvest|light+dark+system|harvest+classic|function|function');
  });

  /**
   * 🔴 One behaviour, two entry points, PINNED AGAINST EACH OTHER.
   *
   * The shim cannot simply call the toggles' code: THE-265 pins the toggles'
   * own write lines by source text (`localStorage.setItem(FAMILY_STORAGE_KEY,
   * next)`), so refactoring them into a shared helper would break that pin.
   * The next best thing is to prove the two paths are indistinguishable —
   * drive the real control, snapshot storage and the stamp, reset, drive the
   * shim setter, and require the identical result.
   */
  const ShimSetters: React.FC = () => {
    const { setTheme, setPalette } = useTheme();
    return (
      <>
        <button type="button" data-act="mode" onClick={() => setTheme('dark')} />
        <button type="button" data-act="family" onClick={() => setPalette('harvest')} />
      </>
    );
  };

  const outcome = () => ({
    theme: localStorage.getItem(THEME_STORAGE_KEY),
    family: localStorage.getItem(FAMILY_STORAGE_KEY),
    ...stamped(),
  });

  it("setTheme leaves storage and <html> exactly where ThemeToggle's Dark button does", async () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    const toggle = await mount(<ThemeToggle />);
    await act(async () => {
      toggle.querySelector<HTMLButtonElement>('[data-theme-choice="dark"]')!.click();
    });
    const viaToggle = outcome();

    localStorage.clear();
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    resetHtml();

    const shim = await mount(<ShimSetters />);
    await act(async () => { shim.querySelector<HTMLButtonElement>('[data-act="mode"]')!.click(); });
    expect(outcome(), 'the shim and ThemeToggle write different things').toEqual(viaToggle);
    expect(viaToggle).toEqual({ theme: 'dark', family: 'harvest', attr: 'dark', dark: true, palette: 'harvest' });
  });

  it('setPalette leaves storage and <html> exactly where PaletteFamilyToggle does, mode intact', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    applyTheme('dark');
    const toggle = await mount(<PaletteFamilyToggle />);
    await act(async () => {
      toggle.querySelector<HTMLButtonElement>('[data-palette-choice="harvest"]')!.click();
    });
    const viaToggle = outcome();

    localStorage.clear();
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    resetHtml();
    applyTheme('dark');

    const shim = await mount(<ShimSetters />);
    await act(async () => { shim.querySelector<HTMLButtonElement>('[data-act="family"]')!.click(); });
    expect(outcome(), 'the shim and PaletteFamilyToggle write different things').toEqual(viaToggle);
    // 🔴 And the family change did not reset the mode, through either path.
    expect(viaToggle).toEqual({ theme: 'dark', family: 'harvest', attr: 'dark', dark: true, palette: 'harvest' });
  });

  it('🔴 the shim does not stamp — applyTheme stays the one stamping path', () => {
    const shim = readFileSync(path.join(SRC, 'lib/use-theme.ts'), 'utf8');
    const STAMP =
      /\.setAttribute\(\s*['"]data-theme['"]|\.setAttribute\(\s*['"]data-palette['"]|classList\.(?:toggle|add|remove)\(\s*['"]dark['"]/;
    expect(STAMP.test(shim), 'the shim became a THIRD stamping path').toBe(false);
    expect(shim).toContain("from './theme-runtime'");
  });

  /**
   * ⚠️ THE CENSUS — UPDATED by THE-273, deliberately not deleted.
   *
   * THE-271 wrote this pin to fail two ways, both useful:
   *   • a NEW file starts importing next-themes → the shim exists, use it;
   *   • sonner.tsx stops importing it → nothing is left, delete the package.
   *
   * The second is what happened. `sonner.tsx` was the last importer and it
   * belonged to a parallel ticket at the time, which is the only reason the
   * dependency outlived THE-271; THE-273 switched that import to
   * `@/lib/use-theme`, this test went red exactly as designed, and the
   * package came out of package.json in the same PR.
   *
   * 🔴 So the pin FLIPS rather than retires. An empty census is a fact that
   * needs guarding just as much as a one-entry one did: without this, a
   * future `shadcn add` pasting upstream's own `useTheme` import back into a
   * new primitive would reinstate the dependency and nothing would object.
   */
  it('🔴 nothing imports next-themes any more, and it is gone from package.json', () => {
    // Every .ts/.tsx under src, TEST FILES INCLUDED — walkSrc skips __tests__,
    // and with the package uninstalled a test importing it is just as broken
    // as a component doing so. (This suite's own two sections that drove the
    // real library were removed for that reason; see section 1.)
    const importers = walkAllSrc()
      .filter((f) => /from ['"]next-themes['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f))
      .sort();
    expect(
      importers,
      'next-themes is imported again — src/lib/use-theme.ts is the shim to point at instead',
    ).toEqual([]);

    // ⚠️ Every dependency field, not just `dependencies`: demoting it to
    // devDependencies would leave it installed and importable again, which is
    // the state this whole line of work exists to end.
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const declaredIn = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ].filter((field) => pkg[field]?.['next-themes'] !== undefined);
    expect(declaredIn, 'next-themes came back into package.json').toEqual([]);
  });

  it('and no OTHER shadcn component under src/components/ui reaches for a theme hook', () => {
    const UI = path.join(SRC, 'components/ui');
    const reachers = walkSrc(UI)
      .filter((f) => /\buseTheme\b|\buseResolvedTheme\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f))
      .sort();
    expect(reachers).toEqual(['src/components/ui/sonner.tsx']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · 🔴 deriveOnDarkAccent still clears AA — several accents, ratios asserted
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The same spread `the-265-classic-default.test.ts` chose, and for its
 * reasons: colours that behave DIFFERENTLY, not colours that all pass.
 */
const ACCENTS: ReadonlyArray<readonly [string, string]> = [
  ['#C9963A', 'Harvest gold — already clears both grounds, must be untouched'],
  ['#0C1526', 'deep navy — 1.01:1 raw, the pathological case'],
  ['#1B2E4F', 'navy 700 — very dark, drives the derivation hard'],
  ['#3A78B5', 'mid blue — the interesting band'],
  ['#2E7D32', 'forest green — a common church brand colour'],
  ['#7B1FA2', 'purple — mid-tone, low luminance'],
  ['#B00020', 'material red — dark enough to matter'],
  ['#111111', 'near-black — worst case'],
  ['#E2C99B', 'already light — must be untouched'],
  ['#4F97D6', 'sky 500'],
];

describe('10 — deriveOnDarkAccent still clears AA on both dark grounds', () => {
  const GROUNDS: ReadonlyArray<readonly [string, string, string]> = [
    ['Harvest', DARK_SURFACE, DARK_SURFACE_RAISED],
    ['Classic', CLASSIC_DARK_SURFACE, CLASSIC_DARK_SURFACE_RAISED],
  ];

  it('🔴 the grounds the derivation uses still match globals.css exactly', () => {
    // The guarantee is only as good as this. If --surface in either dark block
    // moved and the constant did not, every ratio below would be computed
    // against a colour nobody renders.
    expect(resolveVar('--surface', scopeFor('dark', 'harvest'))).toBe(DARK_SURFACE);
    expect(resolveVar('--surface', scopeFor('dark', 'classic'))).toBe(CLASSIC_DARK_SURFACE);
    expect(resolveVar('--surface-raised', scopeFor('dark', 'harvest'))).toBe(DARK_SURFACE_RAISED);
    expect(resolveVar('--surface-raised', scopeFor('dark', 'classic'))).toBe(CLASSIC_DARK_SURFACE_RAISED);
  });

  for (const [familyName, ground, raised] of GROUNDS) {
    it.each(ACCENTS)(`${familyName} dark: %s (%s) clears AA after derivation`, (hex) => {
      const derived = deriveOnDarkAccent(hex, ground);
      const ratio = contrastRatio(derived, ground);
      expect(ratio, `${hex} -> ${derived} on ${ground} is only ${ratio.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(AA_CONTRAST);
    });

    it.each(ACCENTS)(`${familyName} chip: %s (%s) clears AA on its own tint`, (hex) => {
      // ⚠️ The chip is NOT the raised surface. It is the accent mixed into
      // raised at ACCENT_TINT_PCT, so it is LIGHTER than the raised ground —
      // which is the whole reason deriveOnTintAccent exists alongside
      // deriveOnDarkAccent. Rebuilt through the exported helper rather than
      // typed, so the test cannot drift from what the CSS composites.
      const chipGround = accentTintGround(hex, raised, ACCENT_TINT_PCT);
      const derived = deriveOnTintAccent(hex, raised);
      const ratio = contrastRatio(derived, chipGround);
      expect(ratio, `${hex} -> ${derived} is ${ratio.toFixed(2)}:1 on chip ${chipGround}`)
        .toBeGreaterThanOrEqual(AA_CONTRAST);
    });
  }

  it('🔴 Harvest gold is returned UNCHANGED on both grounds — the brand does not shift', () => {
    expect(deriveOnDarkAccent('#C9963A', DARK_SURFACE)).toBe('#C9963A');
    expect(deriveOnDarkAccent('#C9963A', CLASSIC_DARK_SURFACE)).toBe('#C9963A');
  });

  it('records the ratios both families actually produce, so a regression is legible', () => {
    const rows = ACCENTS.map(([hex]) => {
      const h = contrastRatio(deriveOnDarkAccent(hex, DARK_SURFACE), DARK_SURFACE);
      const c = contrastRatio(deriveOnDarkAccent(hex, CLASSIC_DARK_SURFACE), CLASSIC_DARK_SURFACE);
      return { hex, harvest: Number(h.toFixed(2)), classic: Number(c.toFixed(2)) };
    });
    for (const r of rows) {
      expect(r.harvest, `${r.hex} Harvest`).toBeGreaterThanOrEqual(AA_CONTRAST);
      expect(r.classic, `${r.hex} Classic`).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
    // The Classic ground (#1C1C1C) is LIGHTER than Harvest's (#1A1612), so it
    // is the harder case — the lowest ratio in the table must come from it.
    const worstClassic = Math.min(...rows.map((r) => r.classic));
    expect(worstClassic, `lowest Classic ratio is ${worstClassic}:1`).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(contrastRatio('#FFFFFF', CLASSIC_DARK_SURFACE))
      .toBeLessThan(contrastRatio('#FFFFFF', DARK_SURFACE));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 · both toggles still work
// ═══════════════════════════════════════════════════════════════════════════

describe('11 — PaletteFamilyToggle and ThemeToggle still work', () => {
  const click = async (c: HTMLElement, selector: string) => {
    await act(async () => { c.querySelector<HTMLButtonElement>(selector)!.click(); });
  };

  it('ThemeToggle still writes the mode key and stamps <html>', async () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    const c = await mount(<ThemeToggle />);
    expect(c.querySelectorAll('[role="radio"]')).toHaveLength(3);

    await click(c, '[data-theme-choice="dark"]');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(stamped(), 'ThemeToggle stopped stamping, or dropped the family').toEqual({
      attr: 'dark', dark: true, palette: 'harvest',
    });

    await click(c, '[data-theme-choice="light"]');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(stamped()).toEqual({ attr: 'light', dark: false, palette: 'harvest' });
  });

  it('PaletteFamilyToggle still writes the family key and keeps the mode', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const c = await mount(<PaletteFamilyToggle />);
    expect(c.querySelectorAll('[role="radio"]')).toHaveLength(2);

    await click(c, '[data-palette-choice="harvest"]');
    expect(localStorage.getItem(FAMILY_STORAGE_KEY)).toBe('harvest');
    expect(stamped(), 'the family change reset the mode').toEqual({
      attr: 'dark', dark: true, palette: 'harvest',
    });

    await click(c, '[data-palette-choice="classic"]');
    expect(localStorage.getItem(FAMILY_STORAGE_KEY)).toBe('classic');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: 'classic' });
  });

  it('the two together still reach all four palettes', async () => {
    const modes = await mount(<ThemeToggle />);
    await click(modes, '[data-theme-choice="dark"]');
    const families = await mount(<PaletteFamilyToggle />);

    for (const p of PALETTES) {
      await click(modes, `[data-theme-choice="${p.choice}"]`);
      await click(families, `[data-palette-choice="${p.family}"]`);
      expect(stamped(), `${p.name} is unreachable from the two controls`).toEqual({
        attr: p.theme, dark: p.theme === 'dark', palette: p.family,
      });
    }
  });

  it("and a stored choice still survives the round trip through readStored*", async () => {
    const c = await mount(<ThemeToggle />);
    await click(c, '[data-theme-choice="system"]');
    expect(readStoredChoice()).toBe('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12 · nothing outside this ticket's lane moved
// ═══════════════════════════════════════════════════════════════════════════

describe('12 — firestore.rules and functions/ are byte-identical', () => {
  // firestore.rules auto-deploys to production on merge to main; functions/
  // is a separate Cloud Functions build. A theme decision touches neither.
  const UNTOUCHED: Record<string, string> = {
    'firestore.rules': 'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499',
    'functions/.gcloudignore': '9c20b803e45cd91612bcc0113d5e925422cd5c90686feaa4487e0349ae0951b2',
    'functions/package-lock.json': 'bbe18ca8fb92c17d72a991069017be73116d885643dcf681599a958aa3e31681',
    'functions/package.json': '33846d2de1bef5e32ab53a5fb37373aa725aab06a6dd12d2e81a1c69ac6034eb',
    'functions/src/index.ts': '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b',
    'functions/tsconfig.json': 'a707d5b587803ee0e9224d5943136bbb5be281f3522ce6640def17315a423a25',
  };

  it.each(Object.keys(UNTOUCHED))('%s is unchanged', (file) => {
    expect(digestOf(file), `${file} changed — THE-271 must not touch it`).toBe(UNTOUCHED[file]);
  });

  it('and functions/ has gained no files either', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === 'lib') continue;
        const p = path.join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, 'functions'));
    expect(files.sort()).toEqual(
      Object.keys(UNTOUCHED).filter((f) => f.startsWith('functions/')).sort(),
    );
  });
});
