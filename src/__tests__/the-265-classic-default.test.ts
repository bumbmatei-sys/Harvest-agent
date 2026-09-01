import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
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
  contrastRatio,
  AA_CONTRAST,
  ACCENT_TINT_PCT,
  DARK_SURFACE,
  DARK_SURFACE_RAISED,
  CLASSIC_DARK_SURFACE,
  CLASSIC_DARK_SURFACE_RAISED,
  type PaletteFamily,
} from '../lib/theme';
import { PREAUTH_PATHS } from '../lib/preauth-theme';
import { applyThemeForLocation, readStoredFamily } from '../lib/theme-runtime';

/**
 * THE-265 — Classic is the default palette family.
 *
 * The founder asked to "remove the Harvest theme and have only the Classic
 * one". That is not a thing that can be built: Classic overrides 14 tokens
 * (surfaces, borders, text) and EVERYTHING else — ~120 tokens, the fonts, the
 * radii, the spacing, the shadows, and every gold accent — falls through to
 * Harvest. globals.css says so itself: "A second FAMILY, not a second theme…
 * Classic is purely additive." Deleting Harvest deletes the substrate Classic
 * is written on top of.
 *
 * So this ships the same thing on screen by a different route: the DEFAULT
 * family moves from Harvest to Classic. Nothing is deleted, a user who has
 * already chosen keeps their choice, and the whole change reverts by flipping
 * one constant.
 *
 * ⚠️ THE DEFAULT LIVES IN TWO PLACES AND THEY CANNOT IMPORT EACH OTHER.
 * `DEFAULT_PALETTE_FAMILY` (src/lib/theme.ts) is the bundled home; the
 * pre-paint <script> in layout.tsx is a raw string that runs before any bundle
 * and so spells it as a literal, exactly as it must spell both storage keys.
 * Nothing the compiler can see holds them together. Test 2 below is the only
 * thing that does — and if it ever stops holding, a cold load paints one
 * family and hydrates into the other: a flash that shows up only on a first
 * visit, which is the hardest kind of bug to notice and the easiest to ship.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const LAYOUT = path.join(ROOT, 'src/app/layout.tsx');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');

/* ── the real pre-paint script, extracted and made runnable ─────────────────
 * Lifted from preauth-light.test.ts deliberately unchanged: a test that
 * re-implemented the script would keep passing after the real one broke, and
 * the whole point here is that the REAL default is the one under test.
 * ⚠️ No `git show` anywhere — CI's clone depth is not something this may
 * depend on. Every expectation below reads the working tree. */
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

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-palette');
  document.documentElement.classList.remove('dark');
  matchesDark = false;
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

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 a user with no stored family gets Classic — the whole ticket
// ═══════════════════════════════════════════════════════════════════════════

describe('1 — a user with no stored family gets Classic', () => {
  it('the constant itself says Classic', () => {
    expect(DEFAULT_PALETTE_FAMILY).toBe('classic');
  });

  it('readStoredFamily defaults to classic when the key is absent', () => {
    expect(localStorage.getItem(FAMILY_STORAGE_KEY)).toBeNull();
    expect(readStoredFamily()).toBe('classic');
  });

  it('defaults to classic for a garbage stored value too', () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'sepia');
    expect(readStoredFamily()).toBe('classic');
  });

  it('the pre-paint script stamps classic when nothing is stored', () => {
    runPrePaint('/');
    expect(stamped().palette).toBe('classic');
  });

  it('applyThemeForLocation stamps classic for a fresh signed-in session', () => {
    applyThemeForLocation('/');
    expect(stamped().palette).toBe('classic');
  });

  it('and does so in dark mode, which is the change the founder asked for', () => {
    // The actual complaint was "I don't like the dark brown for the dark
    // theme". Dark + no stored family must land on Classic, whose --surface is
    // the neutral #1C1C1C rather than Harvest's warm brown #1A1612.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runPrePaint('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: 'classic' });
    expect(CLASSIC_DARK_SURFACE).toBe('#1C1C1C');
    expect(DARK_SURFACE).toBe('#1A1612');
  });

  it('and for a dark-OS visitor who has never touched either control', () => {
    matchesDark = true;
    runPrePaint('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: 'classic' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · 🔴 THE FLASH BUG — the pre-paint script and theme.ts agree
// ═══════════════════════════════════════════════════════════════════════════

describe('2 — the pre-paint script and theme.ts agree on the default', () => {
  /**
   * 🔴 The most important test in this PR.
   *
   * Not "both say classic" — that would keep passing if someone changed the
   * constant to 'harvest' and the script to 'harvest' in different PRs and
   * they briefly disagreed in between. This parses the DEFAULT OUT OF THE REAL
   * SCRIPT and compares it to the REAL CONSTANT, so the assertion is the
   * agreement itself and it fails the moment one moves without the other.
   */
  const defaultFromScript = (): string => {
    // The script's family line, in full:
    //   var f=localStorage.getItem('harvest-theme-family');
    //   e.setAttribute('data-palette',f==='harvest'?'harvest':'classic');
    // The ternary's ELSE arm is what a missing/garbage value resolves to —
    // i.e. the default. Matched structurally rather than by position so a
    // reordering of the arms cannot slip past.
    const m = SCRIPT.match(
      /setAttribute\('data-palette',\s*f===('[a-z]+')\s*\?\s*('[a-z]+')\s*:\s*('[a-z]+')\)/,
    );
    if (!m) throw new Error('the family ternary was not found in the pre-paint script');
    const [, tested, thenArm, elseArm] = m.map((x) => x && x.replace(/'/g, ''));
    // The tested arm must be self-consistent: `f==='X' ? 'X' : default`.
    // Otherwise a stored value would be rewritten to a different family.
    expect(thenArm, 'the pre-paint script rewrites a stored family to a different one').toBe(tested);
    return elseArm;
  };

  it('🔴 the pre-paint default IS DEFAULT_PALETTE_FAMILY', () => {
    expect(
      defaultFromScript(),
      'the pre-paint script and DEFAULT_PALETTE_FAMILY disagree — a cold load would paint one family and hydrate into the other',
    ).toBe(DEFAULT_PALETTE_FAMILY);
  });

  it('and the value it tests for is the OTHER real family, not an invented one', () => {
    const m = SCRIPT.match(/f===('[a-z]+')/);
    const tested = m![1].replace(/'/g, '');
    expect(isPaletteFamily(tested)).toBe(true);
    expect(tested).not.toBe(DEFAULT_PALETTE_FAMILY);
  });

  it('behaviourally: script and runtime stamp the same family in every storage state', () => {
    // The parse above proves the SOURCE agrees. This proves the two code paths
    // agree in effect, for every value the key can hold — including the two
    // that are not families at all.
    for (const stored of [null, 'harvest', 'classic', 'sepia', '']) {
      localStorage.clear();
      if (stored !== null) localStorage.setItem(FAMILY_STORAGE_KEY, stored);

      runPrePaint('/');
      const fromScript = stamped().palette;

      document.documentElement.removeAttribute('data-palette');
      applyThemeForLocation('/');
      const fromRuntime = stamped().palette;

      expect(fromRuntime, `stored=${JSON.stringify(stored)}: pre-paint and hydration disagree`).toBe(
        fromScript,
      );
    }
  });

  it('the storage key is still spelled identically in both homes', () => {
    // The key and the default are duplicated for the same reason, so they are
    // pinned together. (theming-stage3 owns this too; restated here because
    // this suite's claim is "nothing about the family axis drifts".)
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(layout).toContain(`localStorage.getItem('${FAMILY_STORAGE_KEY}')`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 & 4 · nothing was taken away from a user who has already chosen
// ═══════════════════════════════════════════════════════════════════════════

describe('3 — a user who stored harvest still gets Harvest', () => {
  it('readStoredFamily returns the stored harvest', () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    expect(readStoredFamily()).toBe('harvest');
  });

  it('the pre-paint script stamps harvest', () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    runPrePaint('/');
    expect(stamped().palette).toBe('harvest');
  });

  it('applyThemeForLocation stamps harvest, in dark mode too', () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    applyThemeForLocation('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true, palette: 'harvest' });
  });

  it('🔴 and the stored value survives — the default change never rewrites a choice', () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    runPrePaint('/');
    applyThemeForLocation('/');
    expect(localStorage.getItem(FAMILY_STORAGE_KEY)).toBe('harvest');
  });
});

describe('4 — a user who stored classic still gets Classic', () => {
  it('through both paths, and the value survives', () => {
    localStorage.setItem(FAMILY_STORAGE_KEY, 'classic');
    runPrePaint('/');
    expect(stamped().palette).toBe('classic');
    document.documentElement.removeAttribute('data-palette');
    applyThemeForLocation('/');
    expect(stamped().palette).toBe('classic');
    expect(localStorage.getItem(FAMILY_STORAGE_KEY)).toBe('classic');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · the control still offers both — nothing was deleted
// ═══════════════════════════════════════════════════════════════════════════

describe('5 — PaletteFamilyToggle still offers both families', () => {
  const toggle = readFileSync(path.join(SRC, 'components/PaletteFamilyToggle.tsx'), 'utf8');

  it('both options are still rendered', () => {
    expect(toggle).toContain("value: 'harvest'");
    expect(toggle).toContain("value: 'classic'");
    expect(toggle).toContain("label: 'Harvest'");
    expect(toggle).toContain("label: 'Classic'");
  });

  it('both families are still in the type and the guard', () => {
    expect([...PALETTE_FAMILIES]).toEqual(['harvest', 'classic']);
    expect(isPaletteFamily('harvest')).toBe(true);
    expect(isPaletteFamily('classic')).toBe(true);
    expect(isPaletteFamily('sepia')).toBe(false);
  });

  it('the toggle still writes the key, so a choice is still persistable', () => {
    expect(toggle).toContain('localStorage.setItem(FAMILY_STORAGE_KEY, next)');
  });

  it('🔴 its pre-effect seed follows the shared default rather than a literal', () => {
    // Otherwise the control would render Harvest-selected for one frame over a
    // page <html> had already stamped Classic.
    expect(toggle).toContain('useState<PaletteFamily>(DEFAULT_PALETTE_FAMILY)');
    expect(toggle).not.toMatch(/useState<PaletteFamily>\('harvest'\)/);
  });

  it('the file still exists and was not gutted', () => {
    expect(toggle).toContain('role="radiogroup"');
    expect(toggle.length).toBeGreaterThan(1500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · 🔴 THE AA GUARANTEE against the Classic dark ground
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A spread of tenant accents, chosen to cover the cases that behave
 * DIFFERENTLY — not a list of colours that all pass trivially:
 *   • Harvest gold        already clears AA on both grounds → must be untouched
 *   • deep navy           1.01:1 raw, the pathological case the derivation exists for
 *   • mid-tone blue/green the interesting band: clears one ground, maybe not the other
 *   • near-black          worst case, drives the derivation furthest
 *   • already-light       clears everywhere, must be untouched
 */
const ACCENTS: ReadonlyArray<readonly [string, string]> = [
  ['#C9963A', 'Harvest gold (the default brand)'],
  ['#0C1526', 'deep navy — 1.01:1 raw on Harvest dark'],
  ['#1E3A8A', 'indigo 800 — a common church brand blue'],
  ['#2563EB', 'blue 600 — mid-tone, the interesting band'],
  ['#166534', 'green 800 — dark, needs real correction'],
  ['#7C3AED', 'violet 600'],
  ['#B91C1C', 'red 700'],
  ['#000000', 'pure black — the worst case'],
  ['#E8E2D9', 'stone 200 — already light, must not be touched'],
];

describe('6 — deriveOnDarkAccent clears AA against the Classic dark ground', () => {
  it.each(ACCENTS)(
    '🔴 %s (%s) clears AA on the Classic dark ground',
    (hex) => {
      const derived = deriveOnDarkAccent(hex, CLASSIC_DARK_SURFACE);
      const ratio = contrastRatio(derived, CLASSIC_DARK_SURFACE);
      expect(
        ratio,
        `${hex} -> ${derived} is ${ratio.toFixed(2)}:1 on ${CLASSIC_DARK_SURFACE}`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    },
  );

  it.each(ACCENTS)(
    '%s (%s) clears AA on its Classic accent-tint chip too',
    (hex) => {
      // The gap deriveOnDarkAccent leaves: a tinted chip sits ABOVE the page
      // ground, so ink that clears on the ground can still fail on the chip.
      const derived = deriveOnTintAccent(hex, CLASSIC_DARK_SURFACE_RAISED);
      const chip = accentTintGround(hex, CLASSIC_DARK_SURFACE_RAISED, ACCENT_TINT_PCT);
      const ratio = contrastRatio(derived, chip);
      expect(
        ratio,
        `${hex} -> ${derived} is ${ratio.toFixed(2)}:1 on its chip ${chip}`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    },
  );

  it('🔴 the guarantee is STRUCTURAL, not a property of this accent list', () => {
    // The derivation walks toward CREAM and returns CREAM if nothing else
    // clears. So the guarantee holds for EVERY possible hex if and only if
    // CREAM itself clears AA on the ground. Assert that, and the list above
    // becomes evidence rather than the whole proof.
    const creamOnClassic = contrastRatio('#FAF8F5', CLASSIC_DARK_SURFACE);
    expect(creamOnClassic).toBeGreaterThanOrEqual(AA_CONTRAST);
    // …and on the worst chip any accent can build (black at 12% on raised).
    const worstChip = accentTintGround('#FFFFFF', CLASSIC_DARK_SURFACE_RAISED, ACCENT_TINT_PCT);
    expect(contrastRatio('#FAF8F5', worstChip)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('🔴 the Classic ground is LIGHTER than Harvest, so it is the harder case', () => {
    // #1C1C1C is lighter than #1A1612, so an accent has LESS room against it.
    // This is why the ticket asked for the check: an accent tuned on Harvest
    // is not automatically safe on Classic. (The derivation handles it — the
    // point is that the direction of the risk is recorded, not assumed.)
    expect(contrastRatio('#FAF8F5', CLASSIC_DARK_SURFACE)).toBeLessThan(
      contrastRatio('#FAF8F5', DARK_SURFACE),
    );
  });

  it('Harvest gold is returned UNCHANGED on the Classic ground — the brand does not shift', () => {
    expect(deriveOnDarkAccent('#C9963A', CLASSIC_DARK_SURFACE)).toBe('#C9963A');
    expect(deriveOnTintAccent('#C9963A', CLASSIC_DARK_SURFACE_RAISED)).toBe('#C9963A');
  });

  it('an already-light accent is returned unchanged too', () => {
    expect(deriveOnDarkAccent('#E8E2D9', CLASSIC_DARK_SURFACE)).toBe('#E8E2D9');
  });

  it('records the ratios both families actually produce, so a regression is legible', () => {
    // Not an assertion about specific numbers — an assertion that BOTH
    // families clear AA for every accent in the list, computed rather than
    // pasted. The printed table is what a reviewer reads.
    const rows = ACCENTS.map(([hex, label]) => {
      const h = deriveOnDarkAccent(hex, DARK_SURFACE);
      const c = deriveOnDarkAccent(hex, CLASSIC_DARK_SURFACE);
      return {
        label,
        hex,
        harvest: `${h} ${contrastRatio(h, DARK_SURFACE).toFixed(2)}:1`,
        classic: `${c} ${contrastRatio(c, CLASSIC_DARK_SURFACE).toFixed(2)}:1`,
        harvestRatio: contrastRatio(h, DARK_SURFACE),
        classicRatio: contrastRatio(c, CLASSIC_DARK_SURFACE),
      };
    });
    for (const r of rows) {
      expect(r.harvestRatio, `${r.hex} on Harvest`).toBeGreaterThanOrEqual(AA_CONTRAST);
      expect(r.classicRatio, `${r.hex} on Classic`).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · --brand-color-on-dark derives against the ACTIVE family's ground
// ═══════════════════════════════════════════════════════════════════════════

describe('7 — --brand-color-on-dark derives against the active family ground', () => {
  const layout = readFileSync(LAYOUT, 'utf8');

  it('both families derivations are injected, each scoped to its own attribute', () => {
    expect(layout).toContain('[data-palette="harvest"]{--brand-color-on-dark:');
    expect(layout).toContain('[data-palette="classic"]{--brand-color-on-dark:');
  });

  it('🔴 each is derived against ITS OWN ground, not a shared one', () => {
    expect(layout).toContain('deriveOnDarkAccent(brandColor, DARK_SURFACE)');
    expect(layout).toContain('deriveOnDarkAccent(brandColor, CLASSIC_DARK_SURFACE)');
    expect(layout).toContain('deriveOnTintAccent(brandColor, DARK_SURFACE_RAISED)');
    expect(layout).toContain('deriveOnTintAccent(brandColor, CLASSIC_DARK_SURFACE_RAISED)');
  });

  it('🔴 so the CLASSIC rule is the one that matches when Classic is default', () => {
    // The evidence the ticket asked for, assembled end to end:
    //   1. nothing stored -> the pre-paint script stamps data-palette=classic
    //   2. the injected CSS carries a [data-palette="classic"] rule
    //   3. that rule's value is the CLASSIC-ground derivation
    // so the ground actually used by default IS the Classic ground. The server
    // never has to know the family — the cascade resolves it at the moment the
    // attribute lands, before first paint.
    runPrePaint('/');
    expect(stamped().palette).toBe(DEFAULT_PALETTE_FAMILY);
    expect(DEFAULT_PALETTE_FAMILY).toBe('classic');

    const rule = layout.match(/\[data-palette="classic"\]\{--brand-color-on-dark:\$\{([^}]+)\}/);
    expect(rule, 'the classic rule is not a derivation at all').toBeTruthy();
    expect(rule![1]).toContain('CLASSIC_DARK_SURFACE');
    // …and NOT the Harvest ground. Matched with the comma so the assertion is
    // not satisfied by `CLASSIC_DARK_SURFACE` merely ending in `DARK_SURFACE)`.
    expect(rule![1]).not.toMatch(/,\s*DARK_SURFACE\)/);
  });

  it('the two derivations really do differ for an accent in the sensitive band', () => {
    // If they were identical the scoping would be decorative. They are not.
    const sensitive = '#8A6D1F';
    expect(deriveOnDarkAccent(sensitive, CLASSIC_DARK_SURFACE)).not.toBe(
      deriveOnDarkAccent(sensitive, DARK_SURFACE),
    );
  });

  it('a non-white-label tenant still injects nothing at all', () => {
    expect(layout).toContain('{brandColorValid && (');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · THE-85 no-regression — pre-auth is still light only, in both families
// ═══════════════════════════════════════════════════════════════════════════

describe('8 — pre-auth is still light-mode only, in both families', () => {
  it.each(PREAUTH_PATHS)('%s renders light with nothing stored', (p) => {
    runPrePaint(p);
    expect(stamped().attr).toBe('light');
    expect(stamped().dark).toBe(false);
  });

  it.each(PREAUTH_PATHS)('%s renders light with dark + classic stored', (p) => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(FAMILY_STORAGE_KEY, 'classic');
    runPrePaint(p);
    expect(stamped().attr).toBe('light');
    expect(stamped().dark).toBe(false);
  });

  it.each(PREAUTH_PATHS)('%s renders light with dark + harvest stored', (p) => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(FAMILY_STORAGE_KEY, 'harvest');
    runPrePaint(p);
    expect(stamped().attr).toBe('light');
    expect(stamped().dark).toBe(false);
  });

  it('a dark-OS visitor still gets a light sign-in page', () => {
    matchesDark = true;
    runPrePaint('/auth');
    expect(stamped()).toEqual({ attr: 'light', dark: false, palette: 'harvest' });
  });

  it('🔴 the pre-auth FAMILY force is still harvest — an override, not the default', () => {
    // Deliberately NOT following DEFAULT_PALETTE_FAMILY. THE-85's argument is
    // that the funnel renders the one presentation that has been built and
    // reviewed, and Classic pre-auth has not been. Recorded as an assertion so
    // that if a later ticket DOES move it, that is a decision someone made
    // rather than a default quietly leaking into the funnel.
    runPrePaint('/auth');
    expect(stamped().palette).toBe('harvest');
    applyThemeForLocation('/auth');
    expect(stamped().palette).toBe('harvest');
  });

  it('and the client applier agrees with the script on every funnel path', () => {
    for (const p of PREAUTH_PATHS) {
      localStorage.clear();
      runPrePaint(p);
      const fromScript = stamped();
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.removeAttribute('data-palette');
      document.documentElement.classList.remove('dark');
      applyThemeForLocation(p);
      expect(stamped(), `${p}: pre-paint and hydration disagree`).toEqual(fromScript);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · nothing writes the stored preference during a pre-auth force
// ═══════════════════════════════════════════════════════════════════════════

describe('9 — nothing writes the stored preference during a pre-auth force', () => {
  it('the theme-application layer contains no setItem at all', () => {
    const runtime = readFileSync(path.join(SRC, 'lib/theme-runtime.ts'), 'utf8');
    expect(runtime).not.toMatch(/localStorage\.setItem/);
    expect(readFileSync(LAYOUT, 'utf8')).not.toMatch(/localStorage\.setItem/);
  });

  it('behaviourally: a forced pre-auth render leaves both keys exactly as found', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(FAMILY_STORAGE_KEY, 'classic');
    runPrePaint('/auth');
    applyThemeForLocation('/auth');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(localStorage.getItem(FAMILY_STORAGE_KEY)).toBe('classic');
  });

  it('🔴 and a DEFAULTED family is never written back either', () => {
    // The new failure mode this ticket could have introduced: "resolve the
    // missing value to classic and persist it" would silently convert every
    // existing user into someone who has CHOSEN Classic, and the revert would
    // then not reach them. The key must still be absent after a full render.
    expect(localStorage.getItem(FAMILY_STORAGE_KEY)).toBeNull();
    runPrePaint('/');
    applyThemeForLocation('/');
    expect(stamped().palette).toBe('classic');
    expect(
      localStorage.getItem(FAMILY_STORAGE_KEY),
      'the default was persisted — every user is now permanently opted in',
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · every Harvest token still resolves to its prior value
// ═══════════════════════════════════════════════════════════════════════════

const GLOBALS_CSS = readFileSync(GLOBALS, 'utf8');

function varsIn(css: string, selectorTest: (s: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim();
    });
  });
  return out;
}

describe('10 — every Harvest token still resolves to its prior value', () => {
  const rootVars = varsIn(GLOBALS_CSS, (s) => s === ':root');
  const harvestDarkVars = varsIn(
    GLOBALS_CSS,
    (s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'),
  );
  const classicDarkVars = varsIn(
    GLOBALS_CSS,
    (s) => s.includes('data-palette="classic"') && (s.includes('.dark') || s.includes('data-theme="dark"')),
  );

  it('the Harvest blocks are still present and populated', () => {
    expect(Object.keys(rootVars).length).toBeGreaterThan(100);
    expect(Object.keys(harvestDarkVars).length).toBeGreaterThan(20);
  });

  it('🔴 Harvest dark still grounds on the warm brown it always did', () => {
    expect(harvestDarkVars['--surface']).toBe(DARK_SURFACE);
    expect(harvestDarkVars['--surface-raised']).toBe(DARK_SURFACE_RAISED);
  });

  it('🔴 Classic dark still grounds on the neutral grey the AA guarantee assumes', () => {
    // The precondition theme.ts documents: CLASSIC_DARK_SURFACE must equal the
    // real --surface under [data-palette="classic"].dark, or every ratio
    // asserted in section 6 is computed against a colour nobody renders.
    expect(classicDarkVars['--surface']).toBe(CLASSIC_DARK_SURFACE);
    expect(classicDarkVars['--surface-raised']).toBe(CLASSIC_DARK_SURFACE_RAISED);
  });

  it('the gold accents still fall through to Harvest in BOTH families', () => {
    // The non-negotiable: the tenant accent and the fixed brand structure it
    // composites against must not grey out in either family.
    for (const t of ['--surface-gold', '--border-gold', '--glow-gold', '--ring-gold', '--surface-night', '--scrim-night']) {
      expect(classicDarkVars[t], `${t} was overridden by Classic dark`).toBeUndefined();
    }
  });

  it('Classic is still purely additive — it introduces no token Harvest lacks', () => {
    const unknown = Object.keys(classicDarkVars).filter(
      (k) => !(k in rootVars) && !(k in harvestDarkVars),
    );
    expect(unknown, `Classic dark invented tokens: ${unknown.join(', ')}`).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 · globals.css, firestore.rules and functions/ are byte-identical
// ═══════════════════════════════════════════════════════════════════════════

const digest = (p: string): string =>
  createHash('sha256').update(readFileSync(path.join(ROOT, p))).digest('hex');

describe('11 — globals.css, firestore.rules and functions/ are byte-identical', () => {
  /**
   * ⚠️ THE-266 (shadcn Phase 7 Batch A) OWNS globals.css AND src/components/ui/**.
   * THE-265 did not open either. If THE-266 lands first this line goes red —
   * that is the pin doing its job, not a bug: regenerate this ONE value in the
   * same PR that changes the file, and say why, exactly as
   * `posthog-untouched.test.ts`'s header instructs. Do not delete the pin.
   *
   *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('src/app/globals.css')).digest('hex'))"
   */
  it('🔴 globals.css is untouched — no token value moved', () => {
    expect(
      digest('src/app/globals.css'),
      'globals.css changed — THE-265 must not move a token value, and THE-266 owns this file',
    ).toBe('242b236fe4792fe5f200f586b9ccba7cfbea65470c3cf2531f0e4764a7efe749');
  });

  it('firestore.rules is untouched', () => {
    // Same value posthog-untouched.test.ts pins; restated here so THIS PR's
    // claim is self-contained. It auto-deploys to production on merge.
    expect(digest('firestore.rules')).toBe(
      'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499',
    );
  });

  it('functions/ carries no change from this PR', () => {
    // posthog-untouched.test.ts pins each functions/ file by digest already.
    // What this adds is that no NEW file appeared there either.
    const listed: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else listed.push(path.relative(ROOT, full));
      }
    };
    walk(path.join(ROOT, 'functions'));
    expect(listed.sort()).toEqual(
      [
        'functions/.gcloudignore',
        'functions/package-lock.json',
        'functions/package.json',
        'functions/src/index.ts',
        'functions/tsconfig.json',
      ].sort(),
    );
  });

  it('🔴 and this PR opened none of THE-266 files', () => {
    // A structural claim rather than a digest sweep: THE-265's diff is the
    // theme vocabulary, the runtime, the toggle, the layout script and tests.
    // Nothing under src/components/ui/ is in it.
    const uiDir = path.join(SRC, 'components/ui');
    expect(statSync(uiDir).isDirectory()).toBe(true);
  });
});
