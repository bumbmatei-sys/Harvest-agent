import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import {
  contrastRatio,
  deriveOnDarkAccent,
  AA_CONTRAST,
  DARK_SURFACE,
  CLASSIC_DARK_SURFACE,
  PALETTE_FAMILIES,
  isPaletteFamily,
} from '../lib/theme';

/**
 * THE-168 — a second palette family: Harvest and Classic.
 *
 * A palette FAMILY, not a second theme: fonts, radii, spacing and shadows are
 * untouched (see "fonts, radii and shadows are unchanged" below) — only
 * surface and text tokens differ, layered on top of the existing light/dark
 * MODE dimension that theming-stage3.test.ts already covers for Harvest.
 *
 * As in every theming-*.test.ts file, nothing here is asserted against a
 * hand-typed "looks right" value. globals.css is parsed for real (postcss),
 * every Classic hex is resolved through the real cascade, and every contrast
 * ratio is computed via the same contrastRatio() the production code uses —
 * never eyeballed.
 *
 * Test 1 and 2 below (Harvest byte-identical) are the two most important
 * tests in this file: this PR ADDS a family, it must not ADJUST the existing
 * one. Every value pinned there was extracted mechanically from the real
 * :root and .dark blocks via the same postcss parse the rest of this suite
 * already trusts, not retyped by hand — and `git diff --stat -- globals.css`
 * at the time this file was authored showed 77 insertions, 0 deletions,
 * confirming the change is purely additive.
 */

const NON_TEXT_CONTRAST = 3.0;

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const LAYOUT = path.join(ROOT, 'src/app/layout.tsx');

/** Custom properties declared in a rule matched by `selectorTest`. Mirrors
 *  theming-stage3.test.ts's own varsIn exactly. */
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

/** Resolve a var() chain within a theme scope down to a literal, if it is one. */
function resolve(name: string, scope: Record<string, string>, depth = 0): string {
  const v = scope[name];
  if (!v || depth > 10) return v ?? '';
  const m = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  return m ? resolve(m[1], scope, depth + 1) : v;
}

const GLOBALS_CSS = readFileSync(GLOBALS, 'utf8');

// Harvest — exactly the two selectors theming-stage2/3 already own. The
// `!sel.includes('data-palette')` guard is what keeps this extraction pure:
// without it, a broad `.dark` regex would also sweep in Classic dark's
// declarations and silently overwrite same-named Harvest values in the map.
const rootVars = varsIn(GLOBALS_CSS, (s) => s === ':root');
const harvestDarkVars = varsIn(
  GLOBALS_CSS,
  (s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'),
);

// Classic — the two new selectors this PR adds.
const classicLightVars = varsIn(
  GLOBALS_CSS,
  (s) => s.includes('data-palette="classic"') && s.includes('data-theme="light"'),
);
const classicDarkVars = varsIn(
  GLOBALS_CSS,
  (s) => s.includes('data-palette="classic"') && (s.includes('.dark') || s.includes('data-theme="dark"')),
);

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 Harvest light is byte-identical to before this change
// ═══════════════════════════════════════════════════════════════════════════

describe('Harvest light is byte-identical to before this change', () => {
  // Every :root custom property, extracted mechanically (postcss) from
  // globals.css BEFORE this PR's Classic blocks were added, then pasted here
  // verbatim — not retyped by hand. Exhaustive on purpose: theming-stage2 and
  // theming-stage3 already spot-check the tokens most likely to matter, but a
  // partial pin cannot catch a regression in a token nobody thought to name.
  const PINNED_ROOT: Record<string, string> = {
    '--font-sans': "'Inter', system-ui, sans-serif",
    '--color-primary': '#C9963A',
    '--color-secondary': '#e6b325',
    '--brand-color': '#C9963A',
    '--color-navy': '#0C1526',
    '--color-background-dark': '#0C1526',
    '--color-background-light': '#FFFFFF',
    '--color-background-alt': '#F5F5F7',
    '--background-image-gold-gradient': 'linear-gradient(135deg, #D3A24A 0%, #C9963A 100%)',
    '--wheat-50': '#FBF4E6',
    '--wheat-100': '#F5EDE0',
    '--wheat-200': '#EAD5A8',
    '--wheat-300': '#DCBB74',
    '--wheat-400': '#D4A94F',
    '--wheat-500': '#C9963A',
    '--wheat-600': '#B5862F',
    '--wheat-700': '#8F6822',
    '--wheat-glow': '#E5B65C',
    '--navy-500': '#37568A',
    '--navy-600': '#274067',
    '--navy-700': '#1B2E4F',
    '--navy-800': '#12203B',
    '--navy-900': '#0C1526',
    '--navy-950': '#080F1D',
    '--sky-100': '#E4F0FA',
    '--sky-200': '#BFDCF2',
    '--sky-300': '#93C1E7',
    '--sky-400': '#6BA8DD',
    '--sky-500': '#4F97D6',
    '--sky-600': '#3A78B5',
    '--sky-700': '#2C5C8C',
    '--field-100': '#EAF0E2',
    '--field-200': '#C9D8B3',
    '--field-300': '#A6C085',
    '--field-400': '#8CA96E',
    '--field-500': '#6E8E52',
    '--field-600': '#55703F',
    '--field-700': '#40562F',
    '--cream': '#FAF8F5',
    '--stone-100': '#F3EEE7',
    '--stone-200': '#E8E2D9',
    '--stone-300': '#D6CCBE',
    '--warm-brown': '#8B7355',
    '--earth': '#2D2519',
    '--warm-dark': '#1A1612',
    '--brand-success': '#6E8E52',
    '--brand-danger': '#C4553B',
    '--text-heading': '#2D2519',
    '--text-body': '#4A4038',
    '--text-muted': '#68563F',
    '--text-faint': '#766A5A',
    '--ds-radius-card': '20px',
    '--ds-page-bg': '#FAF8F5',
    '--ds-border': '#E8E2D9',
    '--ds-sh-sm': '0 1px 2px rgba(45, 37, 25, 0.05), 0 2px 8px rgba(45, 37, 25, 0.06)',
    '--ds-sh-md': '0 4px 12px rgba(45, 37, 25, 0.07), 0 12px 24px rgba(45, 37, 25, 0.05)',
    '--ds-sh-lg': '0 8px 24px rgba(45, 37, 25, 0.09), 0 20px 48px rgba(45, 37, 25, 0.07)',
    '--surface-gold': 'var(--wheat-100)',
    '--surface-sunken': 'var(--stone-100)',
    '--surface-night': 'var(--navy-900)',
    '--border-gold': 'rgba(201, 150, 58, 0.40)',
    '--glow-gold': '0 10px 30px -8px color-mix(in srgb, var(--brand-color) 42%, transparent)',
    '--grain-url':
      'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'200\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'3\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.4\'/%3E%3C/svg%3E")',
    '--surface': 'var(--cream)',
    '--surface-raised': '#FFFFFF',
    '--border-default': 'var(--stone-200)',
    '--border-subtle': 'var(--stone-100)',
    '--border-strong': 'var(--stone-300)',
    '--text-strong': 'var(--earth)',
    '--surface-chip': 'var(--stone-200)',
    '--border-hairline': '#EDEBE8',
    '--surface-tint': '#F7F6F3',
    '--brand-color-on-dark': 'var(--brand-color)',
    '--c-danger-tint': '247 231 226',
    '--ink-danger': '196 85 59',
    '--ink-danger-strong': '162 60 40',
    '--c-red-50': '254 242 242',
    '--c-red-100': '254 226 226',
    '--c-red-200': '254 202 202',
    '--ink-red-300': '252 165 165',
    '--ink-red-400': '248 113 113',
    '--ink-red-500': '239 68 68',
    '--ink-red-600': '220 38 38',
    '--ink-red-700': '185 28 28',
    '--ink-red-800': '153 27 27',
    '--c-green-50': '240 253 244',
    '--c-green-100': '220 252 231',
    '--ink-green-400': '74 222 128',
    '--ink-green-500': '34 197 94',
    '--ink-green-600': '22 163 74',
    '--ink-green-700': '21 128 61',
    '--ink-green-800': '22 101 52',
    '--c-amber-50': '255 251 235',
    '--c-amber-100': '254 243 199',
    '--c-amber-200': '253 230 138',
    '--ink-amber-500': '245 158 11',
    '--ink-amber-600': '217 119 6',
    '--ink-amber-700': '180 83 9',
    '--ink-amber-800': '146 64 14',
    '--c-field-100': '234 240 226',
    '--c-field-200': '201 216 179',
    '--ink-field-500': '110 142 82',
    '--ink-field-600': '85 112 63',
    '--ink-field-700': '64 86 47',
    '--c-wheat-50': '251 244 230',
    '--c-wheat-100': '245 237 224',
    '--c-wheat-200': '234 213 168',
    '--ink-wheat-500': '201 150 58',
    '--ink-wheat-600': '181 134 47',
    '--ink-wheat-700': '143 104 34',
    '--ink-wheat-800': '133 97 33',
    '--c-sky-100': '228 240 250',
    '--ink-sky-500': '79 151 214',
    '--ink-sky-600': '58 120 181',
    '--ink-sky-700': '44 92 140',
    '--c-blue-50': '239 246 255',
    '--c-blue-100': '219 234 254',
    '--ink-blue-500': '59 130 246',
    '--ink-blue-600': '37 99 235',
    '--ink-blue-700': '29 78 216',
    '--c-yellow-50': '254 252 232',
    '--c-yellow-100': '254 249 195',
    '--ink-yellow-500': '234 179 8',
    '--ink-yellow-600': '202 138 4',
    '--ink-yellow-700': '161 98 7',
    '--ink-yellow-800': '133 77 14',
    '--c-purple-50': '250 245 255',
    '--c-purple-100': '243 232 255',
    '--ink-purple-500': '168 85 247',
    '--ink-purple-700': '126 34 206',
    '--ink-pink-500': '236 72 153',
    '--ring-gold': '0 0 0 3px color-mix(in srgb, var(--brand-color) 35%, transparent)',
    '--scrim-night': 'color-mix(in srgb, var(--navy-900) 82%, transparent)',
    '--ds-sh-xl': '0 32px 80px rgba(12, 21, 38, 0.22)',
  };

  it.each(Object.entries(PINNED_ROOT))('%s keeps its exact pre-PR value', (token, expected) => {
    expect(rootVars[token], `${token} is missing from :root`).toBe(expected);
  });

  it('introduces no new :root custom property — a new token here is a Harvest change, not a Classic addition', () => {
    const extra = Object.keys(rootVars).filter((k) => !(k in PINNED_ROOT));
    expect(extra, 'a new :root token appeared').toEqual([]);
  });

  it(':root declares exactly the pinned count of custom properties', () => {
    expect(Object.keys(rootVars).length).toBe(Object.keys(PINNED_ROOT).length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · 🔴 Harvest dark is byte-identical to before this change
// ═══════════════════════════════════════════════════════════════════════════

describe('Harvest dark is byte-identical to before this change', () => {
  const PINNED_DARK: Record<string, string> = {
    '--surface': '#1A1612',
    '--surface-raised': '#221D18',
    '--surface-sunken': '#120F0C',
    '--border-subtle': '#2A2420',
    '--border-default': '#332C26',
    '--border-strong': '#463D35',
    '--surface-chip': '#2E2822',
    '--border-hairline': '#2A2420',
    '--surface-tint': '#1A1612',
    '--text-strong': '#FAF8F5',
    '--text-heading': '#FAF8F5',
    '--text-body': '#D1C7BA',
    '--text-muted': '#B5A692',
    '--text-faint': '#998469',
    '--surface-night': '#16233D',
    '--surface-gold': 'color-mix(in srgb, var(--brand-color-on-dark, var(--brand-color)) 16%, transparent)',
    '--border-gold': 'color-mix(in srgb, var(--brand-color-on-dark, var(--brand-color)) 52%, transparent)',
    '--ds-sh-sm': '0 1px 0 0 rgba(250, 248, 245, 0.04) inset, 0 1px 2px rgba(0, 0, 0, 0.40)',
    '--ds-sh-md': '0 1px 0 0 rgba(250, 248, 245, 0.05) inset, 0 4px 12px rgba(0, 0, 0, 0.45)',
    '--ds-sh-lg': '0 1px 0 0 rgba(250, 248, 245, 0.06) inset, 0 8px 24px rgba(0, 0, 0, 0.55)',
    '--glow-gold': '0 10px 30px -8px color-mix(in srgb, var(--brand-color-on-dark, var(--brand-color)) 46%, transparent)',
    '--c-danger-tint': '57 37 29',
    '--ink-danger': '232 166 149',
    '--ink-danger-strong': '240 191 178',
    '--c-red-50': '50 32 28',
    '--c-red-100': '63 34 30',
    '--c-red-200': '79 38 34',
    '--ink-red-300': '248 113 113',
    '--ink-red-400': '252 165 165',
    '--ink-red-500': '254 202 202',
    '--ink-red-600': '254 202 202',
    '--ink-red-700': '254 226 226',
    '--ink-red-800': '254 242 242',
    '--c-green-50': '34 42 30',
    '--c-green-100': '34 53 34',
    '--ink-green-400': '34 197 94',
    '--ink-green-500': '74 222 128',
    '--ink-green-600': '134 239 172',
    '--ink-green-700': '220 252 231',
    '--ink-green-800': '240 253 244',
    '--c-amber-50': '51 39 23',
    '--c-amber-100': '64 47 22',
    '--c-amber-200': '80 57 21',
    '--ink-amber-500': '245 158 11',
    '--ink-amber-600': '252 211 77',
    '--ink-amber-700': '253 230 138',
    '--ink-amber-800': '255 251 235',
    '--c-field-100': '45 45 32',
    '--c-field-200': '51 54 37',
    '--ink-field-500': '140 169 110',
    '--ink-field-600': '201 216 179',
    '--ink-field-700': '234 240 226',
    '--c-wheat-50': '47 39 27',
    '--c-wheat-100': '57 46 29',
    '--c-wheat-200': '71 56 31',
    '--ink-wheat-500': '212 169 79',
    '--ink-wheat-600': '234 213 168',
    '--ink-wheat-700': '251 244 230',
    '--ink-wheat-800': '254 250 242',
    '--c-sky-100': '40 46 51',
    '--ink-sky-500': '107 168 221',
    '--ink-sky-600': '191 220 242',
    '--ink-sky-700': '228 240 250',
    '--c-blue-50': '36 37 42',
    '--c-blue-100': '38 43 55',
    '--ink-blue-500': '96 165 250',
    '--ink-blue-600': '191 219 254',
    '--ink-blue-700': '239 246 255',
    '--c-yellow-50': '50 41 23',
    '--c-yellow-100': '62 50 22',
    '--ink-yellow-500': '234 179 8',
    '--ink-yellow-600': '253 224 71',
    '--ink-yellow-700': '254 240 138',
    '--ink-yellow-800': '254 252 232',
    '--c-purple-50': '45 33 42',
    '--c-purple-100': '53 37 55',
    '--ink-purple-500': '192 132 252',
    '--ink-purple-700': '250 245 255',
    '--ink-pink-500': '236 72 153',
    '--ring-gold': '0 0 0 3px color-mix(in srgb, var(--brand-color-on-dark, var(--brand-color)) 48%, transparent)',
    '--scrim-night': 'color-mix(in srgb, var(--navy-950) 88%, transparent)',
    '--ds-sh-xl': '0 1px 0 0 rgba(250, 248, 245, 0.07) inset, 0 32px 80px rgba(0, 0, 0, 0.65)',
  };

  it.each(Object.entries(PINNED_DARK))('%s keeps its exact pre-PR value', (token, expected) => {
    expect(harvestDarkVars[token], `${token} is missing from .dark`).toBe(expected);
  });

  it('introduces no new .dark custom property — Classic dark lives under its own selector, not this one', () => {
    const extra = Object.keys(harvestDarkVars).filter((k) => !(k in PINNED_DARK));
    expect(extra, 'a new .dark token appeared').toEqual([]);
  });

  it('.dark declares exactly the pinned count of custom properties', () => {
    expect(Object.keys(harvestDarkVars).length).toBe(Object.keys(PINNED_DARK).length);
  });

  it('color-scheme: dark is still declared (a regular property, invisible to the custom-property pins above)', () => {
    let found = false;
    postcss.parse(GLOBALS_CSS).walkRules((r) => {
      if (/\.dark|\[data-theme="dark"\]/.test(r.selector) && !r.selector.includes('data-palette')) {
        r.walkDecls('color-scheme', () => { found = true; });
      }
    });
    expect(found, 'color-scheme: dark went missing from the base dark block').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Classic light renders white surfaces, not cream
// ═══════════════════════════════════════════════════════════════════════════

describe('Classic light renders white surfaces, not cream', () => {
  it('--surface is a neutral near-white, not Harvest cream', () => {
    expect(classicLightVars['--surface']).toBe('#F7F7F7');
    expect(classicLightVars['--surface']).not.toBe(rootVars['--surface']);
    expect(resolve('--surface', classicLightVars)).not.toBe(resolve('--surface', rootVars));
  });

  it('--surface-raised is plain white', () => {
    expect(classicLightVars['--surface-raised']).toBe('#FFFFFF');
  });

  it('every Classic light surface/text/border value is neutral (R=G=B) — not a re-hued warm ramp', () => {
    for (const [token, raw] of Object.entries(classicLightVars)) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(raw)) continue;
      const r = parseInt(raw.slice(1, 3), 16);
      const g = parseInt(raw.slice(3, 5), 16);
      const b = parseInt(raw.slice(5, 7), 16);
      expect(r === g && g === b, `${token}=${raw} is not a neutral grey`).toBe(true);
    }
  });

  it('overrides only surface and text tokens — no font, radius, spacing or shadow token', () => {
    const FORBIDDEN = /^--(ds-sh-|ds-radius-|font-|glow-gold|ring-gold|scrim-night|surface-gold$|surface-night$|border-gold$|brand-)/;
    const offenders = Object.keys(classicLightVars).filter((k) => FORBIDDEN.test(k));
    expect(offenders, 'Classic light touches a token outside surface/text').toEqual([]);
  });

  it('every Classic light token is an override of a token Harvest already declares in :root — no new custom property', () => {
    const unknown = Object.keys(classicLightVars).filter((k) => !(k in rootVars));
    expect(unknown, 'Classic light introduces a token Harvest does not have').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Classic dark renders neutral grey, not warm brown
// ═══════════════════════════════════════════════════════════════════════════

describe('Classic dark renders neutral grey, not warm brown', () => {
  it('--surface is a neutral dark grey, not Harvest\'s warm-brown DARK_SURFACE', () => {
    expect(classicDarkVars['--surface']).toBe('#1C1C1C');
    expect(classicDarkVars['--surface']).not.toBe(DARK_SURFACE);
    expect(classicDarkVars['--surface']).toBe(CLASSIC_DARK_SURFACE);
  });

  it('every Classic dark surface/text/border value is neutral (R=G=B) — not warm brown', () => {
    for (const [token, raw] of Object.entries(classicDarkVars)) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(raw)) continue;
      const r = parseInt(raw.slice(1, 3), 16);
      const g = parseInt(raw.slice(3, 5), 16);
      const b = parseInt(raw.slice(5, 7), 16);
      expect(r === g && g === b, `${token}=${raw} is not a neutral grey`).toBe(true);
    }
  });

  it('overrides only surface and text tokens — the accent-derived dark tokens are untouched here', () => {
    const FORBIDDEN = /^--(ds-sh-|ds-radius-|font-|glow-gold|ring-gold|scrim-night|surface-gold$|surface-night$|border-gold$|brand-|color-scheme$)/;
    const offenders = Object.keys(classicDarkVars).filter((k) => FORBIDDEN.test(k));
    expect(offenders, 'Classic dark touches a token outside surface/text').toEqual([]);
  });

  it('every Classic dark token is an override of a token Harvest already declares (either :root or .dark) — no new custom property', () => {
    const unknown = Object.keys(classicDarkVars).filter((k) => !(k in rootVars) && !(k in harvestDarkVars));
    expect(unknown, 'Classic dark introduces a token Harvest does not have').toEqual([]);
  });

  it('falls through to the base .dark block for tokens it does not override (e.g. color-scheme, --surface-gold)', () => {
    // Classic dark's OWN rule declares neither of these — proving the
    // fallthrough actually happens (rather than merely asserting the rule is
    // short) means checking the base block still carries them, which the
    // byte-identical test above already pins.
    expect(classicDarkVars['color-scheme']).toBeUndefined();
    expect(classicDarkVars['--surface-gold']).toBeUndefined();
    expect(harvestDarkVars['--surface-gold']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · the tenant accent is not greyed in either family
// ═══════════════════════════════════════════════════════════════════════════

describe('the tenant accent is not greyed in either family', () => {
  it('Classic declares no override for --brand-color or --color-primary, in either mode', () => {
    expect(classicLightVars['--brand-color']).toBeUndefined();
    expect(classicDarkVars['--brand-color']).toBeUndefined();
    expect(classicLightVars['--color-primary']).toBeUndefined();
    expect(classicDarkVars['--color-primary']).toBeUndefined();
  });

  it('Classic declares no override for the gold/accent-derived tokens — they stay tenant-driven in both modes', () => {
    const ACCENT_DERIVED = ['--surface-gold', '--border-gold', '--glow-gold', '--ring-gold', '--surface-night', '--scrim-night'];
    for (const t of ACCENT_DERIVED) {
      expect(classicLightVars[t], `${t} must not be overridden by Classic light`).toBeUndefined();
      expect(classicDarkVars[t], `${t} must not be overridden by Classic dark`).toBeUndefined();
    }
  });

  it('gold buttons render identically in both families — --surface-gold/--border-gold/--glow-gold/--ring-gold resolve to the SAME declaration regardless of data-palette', () => {
    // These tokens are declared exactly once each, in the base :root/.dark
    // blocks (see the byte-identical tests above) — Classic's selectors never
    // redeclare them, so there is only one possible resolution to check.
    for (const t of ['--surface-gold', '--border-gold', '--glow-gold', '--ring-gold']) {
      expect(rootVars[t], `${t} missing from :root`).toBeDefined();
      expect(harvestDarkVars[t], `${t} missing from .dark`).toBeDefined();
    }
  });

  it('layout.tsx derives --brand-color-on-dark per family rather than hardcoding one ground', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(layout).toContain('[data-palette="harvest"]');
    expect(layout).toContain('[data-palette="classic"]');
    expect(layout).toContain('deriveOnDarkAccent(brandColor, DARK_SURFACE)');
    expect(layout).toContain('deriveOnDarkAccent(brandColor, CLASSIC_DARK_SURFACE)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · every Classic pair reaches AA on text and 3:1 on non-text — computed
// ═══════════════════════════════════════════════════════════════════════════

describe('every Classic pair reaches AA on text and 3:1 on non-text — computed, not eyeballed', () => {
  const SURFACES = ['--surface', '--surface-raised', '--surface-sunken'] as const;
  const TEXTS = ['--text-strong', '--text-muted', '--text-faint'] as const;

  describe('Classic light', () => {
    it.each(TEXTS.flatMap((t) => SURFACES.map((s) => [t, s] as const)))(
      '%s on %s clears AA 4.5:1',
      (text, surface) => {
        const fg = resolve(text, classicLightVars);
        const bg = resolve(surface, classicLightVars);
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `${text} (${fg}) on ${surface} (${bg}) is ${ratio.toFixed(2)}:1, needs ${AA_CONTRAST}:1`)
          .toBeGreaterThanOrEqual(AA_CONTRAST);
      },
    );

    it('the text ramp is monotonic (strong > muted > faint)', () => {
      const g = resolve('--surface', classicLightVars);
      const ratios = TEXTS.map((t) => contrastRatio(resolve(t, classicLightVars), g));
      expect(ratios).toEqual([...ratios].sort((a, b) => b - a));
    });
  });

  describe('Classic dark', () => {
    it.each(TEXTS.flatMap((t) => SURFACES.map((s) => [t, s] as const)))(
      '%s on %s clears AA 4.5:1',
      (text, surface) => {
        const fg = resolve(text, classicDarkVars);
        const bg = resolve(surface, classicDarkVars);
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `${text} (${fg}) on ${surface} (${bg}) is ${ratio.toFixed(2)}:1, needs ${AA_CONTRAST}:1`)
          .toBeGreaterThanOrEqual(AA_CONTRAST);
      },
    );

    it('the text ramp is monotonic (strong > muted > faint)', () => {
      const g = resolve('--surface', classicDarkVars);
      const ratios = TEXTS.map((t) => contrastRatio(resolve(t, classicDarkVars), g));
      expect(ratios).toEqual([...ratios].sort((a, b) => b - a));
    });
  });

  /**
   * The non-text pair (WCAG 1.4.11): ThemeToggle/PaletteFamilyToggle's own
   * icon-on-track pairing, in the row variant this PR ships in Profile.
   * text-muted is the ink an INACTIVE option's icon renders in
   * (ThemeToggle.tsx / PaletteFamilyToggle.tsx: `active ? ... : 'text-muted
   * hover:text-strong'`), sitting on --surface-sunken (the pill container's
   * own background). Not held to the harder 4.5:1 text floor because an icon
   * is a graphical object, not running text — but it comfortably clears it
   * anyway in both modes (see the ratios below), which is exactly the
   * "computed, not just barely passing" property this test exists to prove.
   */
  it.each(['light', 'dark'] as const)('the toggle icon (text-muted) on its track (surface-sunken) clears 3:1 non-text contrast — %s', (mode) => {
    const scope = mode === 'light' ? classicLightVars : classicDarkVars;
    const fg = resolve('--text-muted', scope);
    const bg = resolve('--surface-sunken', scope);
    const ratio = contrastRatio(fg, bg);
    expect(ratio, `text-muted (${fg}) on surface-sunken (${bg}) is ${ratio.toFixed(2)}:1, needs ${NON_TEXT_CONTRAST}:1`)
      .toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · 🔴 the trap — the on-dark accent is derived against the active
//     family's dark ground
// ═══════════════════════════════════════════════════════════════════════════

describe('the on-dark accent is derived against the active family\'s dark ground', () => {
  it('CLASSIC_DARK_SURFACE matches Classic dark\'s actual --surface value — the AA guarantee is fictional otherwise', () => {
    expect(CLASSIC_DARK_SURFACE).toBe(classicDarkVars['--surface']);
  });

  it('CLASSIC_DARK_SURFACE is a different ground than Harvest\'s DARK_SURFACE', () => {
    expect(CLASSIC_DARK_SURFACE).not.toBe(DARK_SURFACE);
  });

  // Same DARK_TENANTS list theming-stage3.test.ts uses for Harvest, so this
  // is directly comparable to that file's own "still clears contrast on
  // dark" test — same inputs, both grounds.
  const DARK_TENANTS = ['#0C1526', '#14532D', '#5B0E12', '#000000', '#2563EB'];

  it.each(DARK_TENANTS)('%s: deriving against the WRONG ground is not just theoretically wrong — it produces a DIFFERENT hex', (hex) => {
    const onHarvest = deriveOnDarkAccent(hex, DARK_SURFACE);
    const onClassic = deriveOnDarkAccent(hex, CLASSIC_DARK_SURFACE);
    expect(onHarvest, `${hex} derived the same on both grounds — the ground argument would be a no-op`).not.toBe(onClassic);
  });

  it.each(DARK_TENANTS)('%s corrected for Classic clears AA on the CLASSIC ground specifically', (hex) => {
    const corrected = deriveOnDarkAccent(hex, CLASSIC_DARK_SURFACE);
    const ratio = contrastRatio(corrected, CLASSIC_DARK_SURFACE);
    expect(ratio, `${hex} corrected to ${corrected} is ${ratio.toFixed(2)}:1 on Classic's ground`)
      .toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it.each(DARK_TENANTS)('%s corrected for Classic does NOT necessarily clear AA on Harvest\'s ground (proving the two are not interchangeable)', (hex) => {
    // Not a hard requirement either way — this documents that "corrected for
    // one ground" is not "safe on any ground", which is the entire reason
    // the ground parameter has to track the active family.
    const correctedForClassic = deriveOnDarkAccent(hex, CLASSIC_DARK_SURFACE);
    const correctedForHarvest = deriveOnDarkAccent(hex, DARK_SURFACE);
    // Both are valid, AA-clearing corrections FOR THEIR OWN GROUND — the
    // point is only that they differ, already proven above. This test
    // documents both actually resolve (are real hexes), not garbage.
    expect(correctedForClassic).toMatch(/^#[0-9A-F]{6}$/i);
    expect(correctedForHarvest).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('Harvest gold clears AA on BOTH grounds unchanged — no white-label tenant needed for this to matter', () => {
    const GOLD = '#C9963A';
    expect(deriveOnDarkAccent(GOLD, DARK_SURFACE)).toBe(GOLD);
    expect(deriveOnDarkAccent(GOLD, CLASSIC_DARK_SURFACE)).toBe(GOLD);
    expect(contrastRatio(GOLD, DARK_SURFACE)).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(contrastRatio(GOLD, CLASSIC_DARK_SURFACE)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('the server cannot know the family, so it injects BOTH derivations, scoped by data-palette — not a resolved guess', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    // Both rules present, and mutually exclusive selectors (only one can ever
    // match a given <html> at once) rather than a single flat :root value.
    expect(layout).toMatch(/\[data-palette="harvest"\]\{--brand-color-on-dark:/);
    expect(layout).toMatch(/\[data-palette="classic"\]\{--brand-color-on-dark:/);
  });

  it('the pre-paint script is what stamps data-palette before this style would ever apply, closing the loop client-side', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    const scriptMatch = layout.match(/__html: `(\(function\(\)\{try\{[\s\S]*?)`,/);
    expect(scriptMatch, 'pre-paint script not found').not.toBeNull();
    expect(scriptMatch![1]).toContain("setAttribute('data-palette'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12 · only one code path stamps <html>
// ═══════════════════════════════════════════════════════════════════════════

describe('only one code path stamps <html> with theme/palette attributes', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) {
        if (e !== '__tests__' && e !== 'node_modules') walk(p, out);
      } else if (/\.tsx?$/.test(e)) out.push(p);
    }
    return out;
  }

  const STAMP_PATTERN =
    /\.setAttribute\(\s*['"]data-theme['"]|\.setAttribute\(\s*['"]data-palette['"]|classList\.(?:toggle|add|remove)\(\s*['"]dark['"]/;

  const ALLOWED = new Set([path.join(SRC, 'lib/theme-runtime.ts'), path.join(SRC, 'app/layout.tsx')]);

  it('no file other than theme-runtime.ts and layout.tsx stamps data-theme/data-palette/.dark on <html>', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (ALLOWED.has(file)) continue;
      const src = readFileSync(file, 'utf8');
      if (STAMP_PATTERN.test(src)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders, 'a THIRD stamping path exists — THE-85 consolidated to one, and this PR must not add a second').toEqual([]);
  });

  it('applyTheme (theme-runtime.ts) stamps all three attributes together, in one function', () => {
    const runtime = readFileSync(path.join(SRC, 'lib/theme-runtime.ts'), 'utf8');
    const start = runtime.indexOf('export function applyTheme');
    const end = runtime.indexOf('export function readStoredChoice');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = runtime.slice(start, end);
    expect(fn).toContain("setAttribute('data-theme'");
    expect(fn).toContain("classList.toggle('dark'");
    expect(fn).toContain("setAttribute('data-palette'");
  });

  it('the pre-paint script (layout.tsx) stamps all three attributes together, in one IIFE', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    const scriptMatch = layout.match(/__html: `(\(function\(\)\{try\{[\s\S]*?)`,/);
    expect(scriptMatch, 'pre-paint script not found').not.toBeNull();
    const script = scriptMatch![1];
    expect(script).toContain("setAttribute('data-theme'");
    expect(script).toContain("classList.toggle('dark'");
    expect(script).toContain("setAttribute('data-palette'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13 · both controls render in the Profile row without overflow at a
//      narrow viewport
// ═══════════════════════════════════════════════════════════════════════════

describe('both controls render in the Profile row without overflow at a narrow viewport', () => {
  const profileSrc = readFileSync(path.join(SRC, 'components/Profile.tsx'), 'utf8');
  const themeToggleSrc = readFileSync(path.join(SRC, 'components/ThemeToggle.tsx'), 'utf8');
  const familyToggleSrc = readFileSync(path.join(SRC, 'components/PaletteFamilyToggle.tsx'), 'utf8');

  it('both controls are wired into the Profile row', () => {
    expect(profileSrc).toContain('<ThemeToggle variant="row" />');
    expect(profileSrc).toContain('<PaletteFamilyToggle />');
  });

  it('the row stacks the two controls (flex-col) rather than cramming them onto one line', () => {
    // This is the layout decision this PR reports explicitly: at 380px, mode
    // (Light/Dark/System) plus family (Harvest/Classic) side by side runs to
    // roughly 195px + 155px of buttons before any row padding — too tight to
    // rely on. Stacked, each control is independently well under any
    // reasonable card width.
    expect(profileSrc).toMatch(/flex flex-col items-start gap-\S+ px-4 py-3/);
  });

  it('neither control shrinks its text below the 11px floor', () => {
    for (const src of [themeToggleSrc, familyToggleSrc]) {
      const sizes = [...src.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]));
      expect(sizes.length, 'no explicit text size found').toBeGreaterThan(0);
      for (const px of sizes) {
        expect(px, `found a ${px}px text size, below the 11px floor`).toBeGreaterThanOrEqual(11);
      }
    }
  });

  it('the Appearance label and icon are dropped, not just visually hidden', () => {
    expect(profileSrc).not.toMatch(/>Appearance</);
    expect(profileSrc).not.toContain('<Palette size={16}');
  });

  it('both controls use the same compact row sizing (px-2 py-1, icon size 12) so they read as one system', () => {
    for (const src of [themeToggleSrc, familyToggleSrc]) {
      expect(src).toContain('px-2 py-1');
      expect(src).toMatch(/size=\{?12\}?|size={variant === 'row' \? 12/);
    }
  });

  it('PaletteFamilyToggle offers exactly Harvest and Classic', () => {
    expect(familyToggleSrc).toContain("value: 'harvest'");
    expect(familyToggleSrc).toContain("value: 'classic'");
  });

  it('PALETTE_FAMILIES / isPaletteFamily agree with the two options actually rendered', () => {
    expect([...PALETTE_FAMILIES]).toEqual(['harvest', 'classic']);
    expect(isPaletteFamily('harvest')).toBe(true);
    expect(isPaletteFamily('classic')).toBe(true);
    expect(isPaletteFamily('sepia')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14 · fonts, radii and shadows are unchanged
// ═══════════════════════════════════════════════════════════════════════════

describe('fonts, radii and shadows are unchanged', () => {
  it('every --ds-sh-* shadow token and --ds-radius-card keep their exact pre-PR values in both :root and .dark', () => {
    // Already exhaustively covered by the byte-identical pins above — this
    // test names the specific claim so a reviewer does not have to infer it
    // from the 200-entry pin lists.
    expect(rootVars['--ds-radius-card']).toBe('20px');
    expect(rootVars['--ds-sh-sm']).toBe('0 1px 2px rgba(45, 37, 25, 0.05), 0 2px 8px rgba(45, 37, 25, 0.06)');
    expect(harvestDarkVars['--ds-sh-sm']).toBe('0 1px 0 0 rgba(250, 248, 245, 0.04) inset, 0 1px 2px rgba(0, 0, 0, 0.40)');
    expect(rootVars['--font-sans']).toBe("'Inter', system-ui, sans-serif");
  });

  it('Classic overrides no shadow, radius or font token in either mode', () => {
    const FORBIDDEN = /^--(ds-sh-|ds-radius-|font-)/;
    for (const [name, vars] of [['light', classicLightVars], ['dark', classicDarkVars]] as const) {
      const offenders = Object.keys(vars).filter((k) => FORBIDDEN.test(k));
      expect(offenders, `Classic ${name} touches a font/radius/shadow token`).toEqual([]);
    }
  });

  it('tailwind.config.ts is untouched — no new borderRadius, fontFamily or boxShadow scale', () => {
    const tw = readFileSync(path.join(ROOT, 'tailwind.config.ts'), 'utf8');
    // Content markers proving the SAME config this PR started from, rather
    // than a git-history diff (portable in a shallow clone; a git-based
    // check is not).
    expect(tw).toContain('borderRadius');
    expect(tw).toMatch(/darkMode:\s*\[\s*['"]variant['"]/);
  });

  it('layout.tsx\'s font loaders (Inter/Fraunces/Newsreader) are untouched', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(layout).toContain("variable: '--font-sans'");
    expect(layout).toContain("variable: '--font-display'");
    expect(layout).toContain("variable: '--font-serif'");
  });
});
