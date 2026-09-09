import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import postcss from 'postcss';
import {
  THEME_STORAGE_KEY,
  deriveOnDarkAccent,
  deriveOnTintAccent,
  accentTintGround,
  ACCENT_TINT_PCT,
  contrastRatio,
  AA_CONTRAST,
  DARK_SURFACE,
  DARK_SURFACE_RAISED,
  type ThemeChoice,
} from '../lib/theme';
import { PREAUTH_PATHS } from '../lib/preauth-theme';
import { applyThemeForLocation, applyTheme, readStoredChoice } from '../lib/theme-runtime';
import { useTheme } from '../lib/use-theme';
import ThemeToggle from '../components/ThemeToggle';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

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

/**
 * 🔴 THE-338 WITHDREW THIS SECTION'S ARGUMENT, and that is the honest outcome
 * rather than a rewrite.
 *
 * It was the closing argument against next-themes, and it was about HARVEST
 * rather than about the library: Harvest had TWO axes (`data-theme` ×
 * `data-palette`), next-themes writes ONE value to every attribute it is
 * given, so it could only ever produce a stamp where data-theme ===
 * data-palette — and none of the four real stamps has that shape. The test ran
 * the real pre-paint script over all four combinations to prove it.
 *
 * THE-338 removed the second axis. That objection therefore no longer holds,
 * and it was removed from `use-theme.ts`'s header at the same time rather than
 * left as reasoning nobody can check.
 *
 * ⚠️ NOTHING WAS LOST. Section 2 below is the objection that always stood on
 * its own and still does: next-themes ships its own inline pre-paint script,
 * unconditionally, and that script knows nothing about PREAUTH_PATHS — so on
 * `/auth` it would stamp the stored 'dark' straight over the light THE-85
 * forces, which is the flash the mechanism exists to prevent. One sufficient
 * objection is a stronger argument than three of which two have expired.
 */
describe('1 — the one remaining objection is the one that always stood alone', () => {
  it('the two-axis argument is withdrawn, and is not left behind as dead reasoning', () => {
    const shim = readFileSync(path.join(ROOT, 'src/lib/use-theme.ts'), 'utf8');
    // The header must not still claim a second axis exists.
    expect(shim, 'use-theme.ts still argues from an axis that was removed')
      .not.toMatch(/Harvest has TWO/);
    // And the objection that DOES stand is still stated there.
    expect(shim, 'the pre-paint-script objection is gone too').toContain('PREAUTH_PATHS');
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
    expect(SCRIPT).toContain("classList.toggle('dark'");
    // 🔴 THE-338 — and it stamps NOTHING ELSE. The script used to write a
    // second attribute, `data-palette`, in the same pass.
    expect(SCRIPT, 'a family stamp is back in the pre-paint script')
      .not.toContain("setAttribute('data-palette'");

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
// 3 · both palettes resolve and render — one named test per palette
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

/**
 * 🔴 THE-338 — the family preference key, kept ONLY as a leftover.
 *
 * `harvest-theme-family` was `FAMILY_STORAGE_KEY` in theme.ts until the
 * palette family axis was removed. The constant is gone; the KEY still sits in
 * every returning user's localStorage, deliberately un-migrated because
 * nothing reads it. Spelling it here as a literal is what lets this suite
 * assert that writing it moves neither axis — which is the whole claim.
 */
const LEGACY_FAMILY_KEY = 'harvest-theme-family';

const ROOT_VARS = varsIn(GLOBALS_CSS, (s) => s === ':root');
const HARVEST_DARK_VARS = varsIn(
  GLOBALS_CSS,
  (s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'),
);
/**
 * The cascade, resolved the way a browser would for a given stamp.
 *
 * 🔴 THE-338 — this used to take a FAMILY too, and layer a third map on top:
 * `:root`, then `.dark`, then the additive Classic block. That family's 14
 * overrides per mode were promoted into the two blocks below and its selectors
 * deleted, so a stamp now selects a scope from the mode alone.
 */
function scopeFor(theme: 'light' | 'dark'): Record<string, string> {
  const scope = { ...ROOT_VARS };
  if (theme === 'dark') Object.assign(scope, HARVEST_DARK_VARS);
  return scope;
}

/** The tokens every surface in the app paints with. If one of these fails to
 *  resolve to a literal, that palette does not render. */
const CORE_TOKENS = [
  '--surface', '--surface-raised', '--surface-sunken', '--surface-chip',
  '--border-default', '--border-strong',
  '--text-strong', '--text-heading', '--text-body', '--text-muted', '--text-faint',
];

/**
 * 🔴 THE-338 — TWO palettes, not four. There were two palette FAMILIES
 * (Harvest and Classic) crossed with the two modes; the family axis is gone,
 * its 14 overrides per mode promoted into :root/.dark.
 */
const PALETTES: ReadonlyArray<{
  name: string;
  choice: ThemeChoice;
  theme: 'light' | 'dark';
  surface: string;
}> = [
  // 🔴 The DARK ground is spelled as the theme.ts constant, not as a hex
  // retyped from globals.css: deriveOnDarkAccent's AA guarantee holds only
  // while that constant matches the CSS exactly, so asserting it here is what
  // makes section 8 mean anything. The LIGHT ground is resolved out of the
  // real cascade, since theme.ts has no constant for it.
  { name: 'Light', choice: 'light', theme: 'light', surface: resolveVar('--surface', ROOT_VARS) },
  { name: 'Dark', choice: 'dark', theme: 'dark', surface: DARK_SURFACE },
];

describe('3 — both palettes resolve and render', () => {
  it('there is no default family left to check first (THE-338)', async () => {
    // 🔴 INVERTED: this pinned #409's default family. The axis is gone, so what
    // is guarded is that it stayed gone.
    const theme = await import('../lib/theme');
    expect('DEFAULT_PALETTE_FAMILY' in theme).toBe(false);
  });

  for (const p of PALETTES) {
    it(`${p.name} resolves every core token to a literal colour`, () => {
      const scope = scopeFor(p.theme);
      for (const token of CORE_TOKENS) {
        const value = resolveVar(token, scope);
        expect(value, `${p.name}: ${token} does not resolve`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
      }
    });

    it(`${p.name} is selected by the stamp the real code produces`, () => {
      // Not "the CSS exists" — that the attributes the pre-paint script and
      // applyTheme actually write are the ones that select this scope.
      localStorage.setItem(THEME_STORAGE_KEY, p.choice);

      runPrePaint('/');
      expect(stamped(), `${p.name}: pre-paint stamped the wrong scope`).toEqual({
        attr: p.theme,
        dark: p.theme === 'dark',
        palette: null,
      });

      const scope = scopeFor(p.theme);
      expect(resolveVar('--surface', scope), `${p.name}: wrong page ground`).toBe(p.surface);
    });

    it(`${p.name} paints readable body text on its own ground`, () => {
      // A palette that "resolves" but puts 2:1 text on its surface does not
      // render in any sense worth having.
      const scope = scopeFor(p.theme);
      const ground = resolveVar('--surface', scope);
      const body = resolveVar('--text-body', scope);
      const ratio = contrastRatio(body, ground);
      expect(ratio, `${p.name}: --text-body ${body} on ${ground} is ${ratio.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(AA_CONTRAST);
    });
  }

  it('the two are genuinely two — they do not share a page ground', () => {
    const grounds = PALETTES.map((p) => resolveVar('--surface', scopeFor(p.theme)));
    expect(new Set(grounds).size, `two palettes render the same ground: ${grounds.join(', ')}`).toBe(2);
  });

  it('🔴 and the promotion moved only surfaces, borders and text', () => {
    /* THE property #409 depended on, and the one THE-338 had to act on.
    
       This asserted that the removed family overrode ONLY surface/border/text
       tokens — "remove Harvest is not buildable because Classic is written on
       top of it", and if Classic had ever redefined a font or a radius,
       changing the default would have changed more than #409 claimed.
    
       THE-338 is the ticket that removed it, and that property is exactly what
       made the removal a PROMOTION rather than a deletion: the family held 14
       overrides per mode and nothing else, so its values could be written into
       the two blocks below without touching a font, a radius or a shadow. The
       claim is now asserted of the RESULT — the tokens whose dark value
       differs from their light one are still only surfaces, borders and text. */
    const moved = Object.keys(HARVEST_DARK_VARS).filter(
      (t) => resolveVar(t, { ...ROOT_VARS }) !== resolveVar(t, { ...ROOT_VARS, ...HARVEST_DARK_VARS }),
    );
    const structural = moved.filter((t) => /^--(font|radius|ds-radius|spacing)/.test(t));
    expect(structural, `the promotion moved a structural token: ${structural.join(', ')}`).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · 🔴 NO FLASH ON FIRST PAINT — all four combinations, EXERCISED
// ═══════════════════════════════════════════════════════════════════════════

/** Reads the theme through the shim and writes it into the DOM, so what the
 *  first frame would show is inspectable. */
const ShimProbe: React.FC = () => {
  // 🔴 THE-338 — `palette` is read through a cast ON PURPOSE, even though the
  // hook no longer declares it. That is what lets this suite assert the field
  // is GONE from the contract rather than merely unused: if it ever comes
  // back, every probe string here changes and the tests fail.
  const t = useTheme();
  const palette = (t as { palette?: string }).palette;
  return <span data-probe={`${t.theme}/${palette}`} />;
};

/** A deliberately WRONG control: identical, but syncing in a passive effect,
 *  i.e. after paint. Its only job is to prove the harness below can actually
 *  see a flash — a test for "no flash" that cannot detect one is worthless. */
const FlashingProbe: React.FC = () => {
  // The seed a brand-new visitor renders with. THE-338 dropped the family half
  // — `data-palette` is stamped by nothing, so it reads back as null/undefined.
  const [v, setV] = useState('light/undefined');
  useEffect(() => {
    const el = document.documentElement;
    setV(`${el.getAttribute('data-theme')}/${el.getAttribute('data-palette') ?? 'undefined'}`);
  }, []);
  return <span data-probe={v} />;
};

const probeValue = (c: HTMLElement): string => c.querySelector('span')!.getAttribute('data-probe')!;

describe('4 — no flash on first paint, in both combinations', () => {
  it('🔴 the harness can SEE a flash — the control probe fails the way a flash looks', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runPrePaint('/');

    const c = mountToPaint(<FlashingProbe />);
    // At the paint boundary the post-paint prober still shows its seed: this
    // is exactly the wrong-theme frame a user would see.
    expect(probeValue(c), 'the control corrected before paint, so this harness proves nothing')
      .toBe('light/undefined');
    // …and only catches up afterwards.
    await act(async () => {});
    expect(probeValue(c)).toBe('dark/undefined');
  });

  /**
   * ⚠️ One honest caveat, recorded rather than hidden: the seed the shim
   * renders with before its layout effect runs is LIGHT — what a brand-new
   * visitor gets — so light is the one combination where a post-paint
   * correction would be invisible here. Dark catches it, and the control test
   * above catches the technique failing outright. (THE-338: this used to say
   * "three of these four"; with the family axis gone it is one of two.)
   */
  for (const p of PALETTES) {
    it(`${p.name}: <html> is stamped before paint and the shim agrees at that instant`, async () => {
      localStorage.setItem(THEME_STORAGE_KEY, p.choice);

      // 1. the document load: the head script runs before any bundle.
      runPrePaint('/');
      const atPrePaint = stamped();
      expect(atPrePaint).toEqual({ attr: p.theme, dark: p.theme === 'dark', palette: null });

      // 2. first paint: a component reading the theme already has the right
      //    value — no correction lands after the user has seen a frame.
      const c = mountToPaint(<ShimProbe />);
      expect(probeValue(c), `${p.name}: the shim painted the wrong theme first`)
        .toBe(`${p.theme}/undefined`);

      // 3. hydration settles: nothing moves.
      await act(async () => {});
      expect(probeValue(c), `${p.name}: the shim corrected itself AFTER paint — that is the flash`)
        .toBe(`${p.theme}/undefined`);
      expect(stamped(), `${p.name}: <html> changed after first paint`).toEqual(atPrePaint);
    });

    it(`${p.name}: the SPA's own re-apply on route change stamps the identical scope`, () => {
      // The pre-paint script runs once per document load; applyThemeForLocation
      // runs on every client navigation. If the two disagreed for any storage
      // state, a route change would repaint into the other palette.
      localStorage.setItem(THEME_STORAGE_KEY, p.choice);

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
    expect(fromScript.palette, 'a palette family was stamped').toBeNull();

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
  /* 🔴 THREE TESTS STOOD HERE AND THE-338 REPLACED THEM WITH ONE.
  
     They parsed the FAMILY TERNARY out of the pre-paint script
     (`f==='harvest'?'harvest':'classic'`) and the pre-auth branch's forced
     family literal, and pinned both to DEFAULT_PALETTE_FAMILY — because the
     script cannot import, so the default lived in two places and a drift
     between them meant a cold load painting one family and hydrating into
     another.
  
     THE-338 deleted the family axis: the ternary, the forced literal, the
     second storage key and the constant are all gone. There is no second home
     left to drift from, so the property is now structural. What replaces the
     three is the assertion that the script really does stamp only the mode —
     read off the SCRIPT rather than the file, since layout.tsx documents the
     removal in prose that necessarily names the attribute. */
  it('🔴 the pre-paint script stamps the MODE and nothing else', () => {
    expect(SCRIPT, 'the script no longer stamps the mode at all')
      .toContain("setAttribute('data-theme'");
    expect(SCRIPT, 'a family stamp is back in the pre-paint script')
      .not.toContain('data-palette');
    expect(SCRIPT, 'the family storage key is read again')
      .not.toContain('harvest-theme-family');
  });

  it('🔴 layout.tsx is byte-identical to main, so the hash pin needed no regeneration', () => {
    // Four suites pin this file's digest (theming-shadcn-tokens,
    // the-266-shadcn-batch-a, posthog-public-routes, posthog-untouched). The
    // cheapest way to keep every one of them green — and to keep the pre-paint
    // script provably unraced — was to not touch the file at all.
    expect(
      digestOf('src/app/layout.tsx'),
      'layout.tsx changed — regenerate the four pinned digests and record the reason',
    ).toBe('b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f');
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
    'src/lib/theme.ts': 'e05b9e51ee019db5b7926358a5ed9de9a291c5c8372040f2a7ac435e88e2ba0b',
    'src/lib/theme-runtime.ts': 'fce9fa8e8a9bd76c0b57bce0decc450e394968c93855e9e6702c306958e2d6ee',
    'src/lib/preauth-theme.ts': '1940796f21a9c5219ba6d35d15958eafb34aaada0e3a2670f5d858f65e840ad0',
    'src/lib/use-resolved-theme.ts': 'ec8961c8637fd0004c4cf8d6a9ba9830e88b7a02b65c730f52172acd396114a6',
    'src/app/globals.css': '1fd6001c2d3bddc50a45b02ce1253b6b60802699fb33fa159f5ed42b8aeb9957',
    'src/components/ThemeToggle.tsx': 'efd6790ae14ebb1e5238ce601828589724ffcd4931f6c90e631927d9e1522277',
    // 🔴 PaletteFamilyToggle.tsx LEFT THIS LIST AT THE-338: the file is
    // deleted with the palette family axis. Its absence is asserted below,
    // rather than the entry simply disappearing.
  };

  it.each(Object.keys(UNCHANGED))('%s is byte-for-byte unchanged', (file) => {
    expect(digestOf(file), `${file} changed — THE-271 changes no existing theme code`)
      .toBe(UNCHANGED[file]);
  });

  it('🔴 and the file THE-338 deleted is really gone, not merely unpinned', () => {
    // An entry that simply vanished from UNCHANGED would leave the file
    // unguarded if it ever came back. This is the entry's replacement.
    expect(existsSync(path.join(ROOT, 'src/components/PaletteFamilyToggle.tsx'))).toBe(false);
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

  it('the storage key is still spelled identically in both homes', () => {
    // 🔴 THE-338 — there were TWO duplicated keys, because the script cannot
    // import. The family one is gone with the family; the mode one still has
    // to agree between theme.ts and the script or a stored choice is ignored
    // on reload and the theme flashes.
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(layout).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    expect(SCRIPT, 'the family key is read again').not.toContain(LEGACY_FAMILY_KEY);
  });

  it('behaviourally: a leftover family value changes nothing, in every storage state', () => {
    // 🔴 INVERTED. This checked that script and runtime stamped the SAME
    // family for every stored value. Nothing reads the key now, so what has to
    // hold is that no value of it moves either axis — which is the claim that
    // makes leaving it un-migrated safe.
    for (const stored of [null, 'harvest', 'classic', 'sepia', '']) {
      localStorage.clear();
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      if (stored !== null) localStorage.setItem(LEGACY_FAMILY_KEY, stored);

      runPrePaint('/');
      expect(stamped(), `stored=${JSON.stringify(stored)}: the pre-paint stamp moved`)
        .toEqual({ attr: 'dark', dark: true, palette: null });

      resetHtml();
      applyThemeForLocation('/');
      expect(stamped(), `stored=${JSON.stringify(stored)}: pre-paint and hydration disagree`)
        .toEqual({ attr: 'dark', dark: true, palette: null });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · 🔴 THE-338 — a stored family is no longer honoured, and cannot be
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 THIS SECTION'S CLAIM WAS DELIBERATELY WITHDRAWN.
 *
 * It asserted that a user who had CHOSEN a palette family kept their choice —
 * a stored 'harvest' still rendered Harvest through both the pre-paint script
 * and the client applier, and reading it never rewrote it. That was #409's
 * promise: making Classic the default took nothing away from anyone.
 *
 * THE-338 does take it away, on the founder's "remove harvest theme". A user
 * with 'harvest' stored now renders the one palette like everybody else. That
 * is the ticket, not a regression, and it is written down here rather than
 * left as a test that quietly disappeared.
 *
 * ⚠️ What is asserted instead is the part that still matters to that user: the
 * change is not destructive. Their stored value is not rewritten, not cleared
 * and not migrated — it is simply never read — so nothing about their account
 * was altered to make this happen.
 */
describe('6 — a stored family is inert, and is not rewritten', () => {
  it("a stored 'harvest' renders the one palette, through both paths and in dark", () => {
    localStorage.setItem(LEGACY_FAMILY_KEY, 'harvest');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    runPrePaint('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: null });

    resetHtml();
    applyThemeForLocation('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: null });

    // …and neither path rewrote or cleared it.
    expect(localStorage.getItem(LEGACY_FAMILY_KEY)).toBe('harvest');
  });

  it('the mode a user chose is still honoured — that axis was not touched', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runPrePaint('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: null });
    resetHtml();
    applyThemeForLocation('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: null });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · 🔴 pre-auth is light-mode only, in BOTH families (THE-85, no-regression)
// ═══════════════════════════════════════════════════════════════════════════

describe('7 — pre-auth is light-mode only', () => {
  // 🔴 THE-338 — this looped over the two palette FAMILIES. There is one, so
  // the loop is over the leftover stored values a returning user might carry,
  // which is what still needs proving inert.
  for (const family of ['harvest', 'classic'] as const) {
    it(`a stored dark + a leftover ${family} still gets a LIGHT sign-in screen`, () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      localStorage.setItem(LEGACY_FAMILY_KEY, family);

      for (const p of PREAUTH_PATHS) {
        resetHtml();
        runPrePaint(p);
        expect(stamped(), `${p} (${family}) painted dark before hydration`).toEqual({
          attr: 'light',
          dark: false,
          palette: null,
        });

        resetHtml();
        applyThemeForLocation(p);
        expect(stamped(), `${p} (${family}) went dark on hydration`).toEqual({
          attr: 'light',
          dark: false,
          palette: null,
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
    localStorage.setItem(LEGACY_FAMILY_KEY, 'harvest');
    runPrePaint('/auth');
    expect(stamped().palette, 'the funnel stamped a palette family').toBeNull();
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
    localStorage.setItem(LEGACY_FAMILY_KEY, 'harvest');
    applyThemeForLocation('/auth');

    const Probe: React.FC = () => {
      const t = useTheme();
      const palette = (t as { palette?: string }).palette;
      return <span data-probe={`${t.theme}|${t.themeChoice}|${t.forcedTheme}|${palette}`} />;
    };
    const c = mountToPaint(<Probe />);
    // Rendered light, REMEMBERS dark — the whole THE-85 property, visible to a
    // component for the first time.
    expect(probeValue(c)).toBe('light|dark|light|undefined');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · 🔴 nothing writes the stored preference during a pre-auth force
// ═══════════════════════════════════════════════════════════════════════════

describe('8 — nothing writes the stored preference during a pre-auth force', () => {
  const snapshot = () => ({
    theme: localStorage.getItem(THEME_STORAGE_KEY),
    family: localStorage.getItem(LEGACY_FAMILY_KEY),
    length: localStorage.length,
  });

  it('the theme-application layer contains no write at all', () => {
    const runtime = readFileSync(path.join(SRC, 'lib/theme-runtime.ts'), 'utf8');
    expect(runtime).not.toMatch(/localStorage\.setItem/);
    expect(readFileSync(LAYOUT, 'utf8')).not.toMatch(/localStorage\.setItem/);
  });

  it('🔴 a full funnel visit leaves both keys exactly as they were', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(LEGACY_FAMILY_KEY, 'harvest');
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
    localStorage.setItem(LEGACY_FAMILY_KEY, 'harvest');
    applyThemeForLocation('/auth');
    const before = snapshot();

    const c = mountToPaint(<ShimProbe />);
    expect(probeValue(c)).toBe('light/undefined');
    await act(async () => {});

    expect(snapshot(), 'the shim wrote a preference while the funnel was forcing').toEqual(before);
  });

  it('the user is back in dark the moment they sign in again', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(LEGACY_FAMILY_KEY, 'harvest');
    applyThemeForLocation('/auth');
    expect(stamped().attr).toBe('light');

    applyThemeForLocation('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: null });
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
    localStorage.setItem(LEGACY_FAMILY_KEY, 'classic');
    runPrePaint('/');
    const c = mountToPaint(<ShimProbe />);
    expect(probeValue(c)).toBe('light/undefined');

    // What ThemeToggle does when a user picks Dark.
    await act(async () => { applyTheme('dark'); });
    expect(probeValue(c), 'the shim did not hear the stamp change').toBe('dark/undefined');

    // 🔴 THE-338 — and back, so the shim tracks the stamp in both directions.
    // (This used to drive a second `applyTheme('dark', 'harvest')` call to
    // prove the shim heard the FAMILY axis; applyTheme takes one argument now.)
    await act(async () => { applyTheme('light'); });
    expect(probeValue(c), 'the shim did not hear the stamp change back').toBe('light/undefined');
  });

  it('the shim exposes the mode axis, and no longer claims a second one', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(LEGACY_FAMILY_KEY, 'harvest');
    runPrePaint('/');

    const Probe: React.FC = () => {
      const t = useTheme();
      return (
        <span
          data-probe={[
            // 🔴 THE-338 — `palette`, `palettes` and `setPalette` were removed
            // from the contract. They are read through a cast so their ABSENCE
            // is asserted rather than typed away: if any comes back, this
            // string changes and the test fails.
            t.theme, t.resolvedTheme, t.themeChoice,
            (t as { palette?: string }).palette,
            t.themes.join('+'),
            (t as { palettes?: string[] }).palettes,
            typeof t.setTheme, typeof (t as { setPalette?: unknown }).setPalette,
          ].join('|')}
        />
      );
    };
    const c = mountToPaint(<Probe />);
    expect(probeValue(c)).toBe('dark|dark|dark||light+dark+system||function|undefined');
  });

  /**
   * 🔴 One behaviour, two entry points, PINNED AGAINST EACH OTHER.
   *
   * The shim cannot simply call the toggle's code: THE-265 pins the toggle's
   * own write line by source text, so refactoring it into a shared helper
   * would break that pin. The next best thing is to prove the two paths are
   * indistinguishable — drive the real control, snapshot storage and the
   * stamp, reset, drive the shim setter, and require the identical result.
   *
   * 🔴 THE-338 — there were TWO setters here and one is gone: `setPalette`
   * left `useTheme`'s contract with the palette family axis.
   */
  const ShimSetters: React.FC = () => {
    const { setTheme } = useTheme();
    return (
      <>
        <button type="button" data-act="mode" onClick={() => setTheme('dark')} />
      </>
    );
  };

  const outcome = () => ({
    theme: localStorage.getItem(THEME_STORAGE_KEY),
    family: localStorage.getItem(LEGACY_FAMILY_KEY),
    ...stamped(),
  });

  it("setTheme leaves storage and <html> exactly where ThemeToggle's Dark button does", async () => {
    localStorage.setItem(LEGACY_FAMILY_KEY, 'harvest');
    const toggle = await mount(<ThemeToggle />);
    await act(async () => {
      toggle.querySelector<HTMLButtonElement>('[data-theme-choice="dark"]')!.click();
    });
    const viaToggle = outcome();

    localStorage.clear();
    localStorage.setItem(LEGACY_FAMILY_KEY, 'harvest');
    resetHtml();

    const shim = await mount(<ShimSetters />);
    await act(async () => { shim.querySelector<HTMLButtonElement>('[data-act="mode"]')!.click(); });
    expect(outcome(), 'the shim and ThemeToggle write different things').toEqual(viaToggle);
    expect(viaToggle).toEqual({ theme: 'dark', family: 'harvest', attr: 'dark', dark: true, palette: null });
  });

  /* 🔴 A SECOND HALF OF THIS PAIR STOOD HERE AND THE-338 REMOVED IT.
  
     It drove PaletteFamilyToggle's Harvest button and the shim's `setPalette`,
     and required the two to leave storage and <html> in the identical state —
     the same "one behaviour, two entry points, pinned against each other"
     technique the mode test above still uses. Both the control and the setter
     are gone with the family axis, so there is no pair left to pin.
  
     The mode half above is untouched and still does the whole of what this
     block is for. */

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
    ['Classic', DARK_SURFACE, DARK_SURFACE_RAISED],
  ];

  it('🔴 the grounds the derivation uses still match globals.css exactly', () => {
    // The guarantee is only as good as this. If --surface in either dark block
    // moved and the constant did not, every ratio below would be computed
    // against a colour nobody renders.
    expect(resolveVar('--surface', scopeFor('dark'))).toBe(DARK_SURFACE);
    expect(resolveVar('--surface', scopeFor('dark'))).toBe(DARK_SURFACE);
    expect(resolveVar('--surface-raised', scopeFor('dark'))).toBe(DARK_SURFACE_RAISED);
    expect(resolveVar('--surface-raised', scopeFor('dark'))).toBe(DARK_SURFACE_RAISED);
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

  it('🔴 the gold accent is returned UNCHANGED — the brand does not shift', () => {
    expect(deriveOnDarkAccent('#C9963A', DARK_SURFACE)).toBe('#C9963A');
  });

  it('records the ratios the dark ground actually produces, so a regression is legible', () => {
    /* 🔴 THE-338 — this recorded a Harvest column and a Classic column, and
       closed by asserting that the Classic ground (#1C1C1C) was LIGHTER than
       Harvest's (#1A1612) and therefore the harder case.
    
       One ground now, so that comparison would have been the constant against
       itself — a tautology that passes while asserting nothing, which is a
       failure mode this repo has shipped before. It is replaced by the real
       second value: the ground THE-338 moved AWAY from. The direction is the
       point — #141414 is DARKER than the #1C1C1C it replaced, so every accent
       has MORE room than it did, not less. */
    const BEFORE_THE_338 = '#1C1C1C';
    const rows = ACCENTS.map(([hex]) => ({
      hex,
      now: Number(contrastRatio(deriveOnDarkAccent(hex, DARK_SURFACE), DARK_SURFACE).toFixed(2)),
    }));
    for (const r of rows) expect(r.now, `${r.hex}`).toBeGreaterThanOrEqual(AA_CONTRAST);
    const worst = Math.min(...rows.map((r) => r.now));
    expect(worst, `lowest ratio is ${worst}:1`).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(
      contrastRatio('#FFFFFF', DARK_SURFACE),
      'the ground got LIGHTER — an accent now has less room, not more',
    ).toBeGreaterThan(contrastRatio('#FFFFFF', BEFORE_THE_338));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 · the one remaining toggle still works
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 THE-338 — THIS SECTION HELD TWO CONTROLS AND NOW HOLDS ONE.
 *
 * PaletteFamilyToggle is deleted with the palette family axis, so the tests
 * that drove its buttons, and the one that drove BOTH controls together to
 * reach all four palettes, have no subject. ThemeToggle is untouched and is
 * still asserted end to end: it writes the mode key and stamps <html>.
 */
describe('11 — ThemeToggle still works', () => {
  const click = async (c: HTMLElement, selector: string) => {
    await act(async () => { c.querySelector<HTMLButtonElement>(selector)!.click(); });
  };

  it('ThemeToggle still writes the mode key and stamps <html>', async () => {
    const c = await mount(<ThemeToggle />);
    expect(c.querySelectorAll('[role="radio"]')).toHaveLength(3);

    await click(c, '[data-theme-choice="dark"]');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(stamped(), 'ThemeToggle stopped stamping').toEqual({
      attr: 'dark', dark: true, palette: null,
    });

    await click(c, '[data-theme-choice="light"]');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(stamped()).toEqual({ attr: 'light', dark: false, palette: null });
  });

  it('it alone reaches both palettes — there is no second control to combine with', async () => {
    const modes = await mount(<ThemeToggle />);
    for (const p of PALETTES) {
      await click(modes, `[data-theme-choice="${p.choice}"]`);
      expect(stamped(), `${p.name} is unreachable from the mode control`).toEqual({
        attr: p.theme, dark: p.theme === 'dark', palette: null,
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
    'functions/.gcloudignore': '9c20b803e45cd91612bcc0113d5e925422cd5c90686feaa4487e0349ae0951b2',
    'functions/package-lock.json': 'bbe18ca8fb92c17d72a991069017be73116d885643dcf681599a958aa3e31681',
    'functions/package.json': '33846d2de1bef5e32ab53a5fb37373aa725aab06a6dd12d2e81a1c69ac6034eb',
    'functions/src/index.ts': '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b',
    'functions/tsconfig.json': 'a707d5b587803ee0e9224d5943136bbb5be281f3522ce6640def17315a423a25',
  };

  /**
   * 🔴 THE-325 · the accepted SET moved to `__fixtures__/ownership/`, the
   * ASSERTION stayed here. This suite still says what it always said: the
   * `firestore.rules` on disk is at a digest some ticket recorded, and so
   * THIS ticket did not touch a file that auto-deploys to production with no
   * emulator test in CI. Only the list of accepted values is now shared, so
   * a legitimate rules change is one new record rather than 50 edits.
   */
  it('firestore.rules is unchanged', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

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
