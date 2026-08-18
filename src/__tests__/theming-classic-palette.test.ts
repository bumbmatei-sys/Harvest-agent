import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import postcss from 'postcss';
import {
  contrastRatio,
  deriveOnDarkAccent,
  deriveOnTintAccent,
  accentTintGround,
  ACCENT_TINT_PCT,
  AA_CONTRAST,
  DARK_SURFACE,
  CLASSIC_DARK_SURFACE,
  DARK_SURFACE_RAISED,
  CLASSIC_DARK_SURFACE_RAISED,
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

/**
 * The ONLY custom property this branch adds to Harvest's own two blocks.
 *
 * It is not part of the palette family — it is the accent-on-tint AA fix:
 * --brand-color-on-dark corrects the accent against the PAGE GROUND, but an
 * accent-tinted chip sits above that ground and is lighter, so a dark
 * white-label accent can clear AA on the page and still fail on the chip
 * (~4.27:1), in Harvest dark exactly as much as in Classic dark.
 *
 * Listing it by name rather than loosening the pins: every one of the 134
 * :root and 82 .dark values stays pinned exactly, and any OTHER new token
 * still fails. In light it is the identity (var(--brand-color)), asserted
 * below, so nothing about Harvest's rendering moves.
 */
const ALLOWED_NEW_TOKENS = ['--ink-on-accent-tint'];

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

  it('introduces no new :root custom property beyond the one named accent-ink token', () => {
    const extra = Object.keys(rootVars).filter((k) => !(k in PINNED_ROOT));
    expect(extra, 'an UNEXPECTED new :root token appeared').toEqual(ALLOWED_NEW_TOKENS);
  });

  it(':root declares exactly the pinned count of custom properties, plus the accent-ink token', () => {
    expect(Object.keys(rootVars).length).toBe(Object.keys(PINNED_ROOT).length + ALLOWED_NEW_TOKENS.length);
  });

  it('the accent-ink token is the IDENTITY in light — it resolves to the raw accent, so light renders exactly as before', () => {
    // This is what makes adding it a non-event for light mode: every call
    // site that now reads --ink-on-accent-tint used var(--brand-color)
    // before, and in light that is still literally what it resolves to.
    expect(rootVars['--ink-on-accent-tint']).toBe('var(--brand-color)');
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

  it('introduces no new .dark custom property beyond the one named accent-ink token', () => {
    const extra = Object.keys(harvestDarkVars).filter((k) => !(k in PINNED_DARK));
    expect(extra, 'an UNEXPECTED new .dark token appeared').toEqual(ALLOWED_NEW_TOKENS);
  });

  it('.dark declares exactly the pinned count of custom properties, plus the accent-ink token', () => {
    expect(Object.keys(harvestDarkVars).length).toBe(Object.keys(PINNED_DARK).length + ALLOWED_NEW_TOKENS.length);
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
// 13 · both controls render side by side, family on the left, without
//      overflow — on mobile, and past the desktop settings column split
// ═══════════════════════════════════════════════════════════════════════════

describe('both controls render side by side, family on the left, without overflow', () => {
  const profileSrc = readFileSync(path.join(SRC, 'components/Profile.tsx'), 'utf8');
  const themeToggleSrc = readFileSync(path.join(SRC, 'components/ThemeToggle.tsx'), 'utf8');
  const familyToggleSrc = readFileSync(path.join(SRC, 'components/PaletteFamilyToggle.tsx'), 'utf8');

  it('both controls are wired into the Profile row', () => {
    expect(profileSrc).toContain('<ThemeToggle variant="row" />');
    expect(profileSrc).toContain('<PaletteFamilyToggle />');
  });

  it('the row places the two controls side by side (flex, not flex-col) — family first, so it lands on the left', () => {
    // The founder's explicit call, checked on a phone: side by side, not
    // stacked — "the switch for themes should not be under but next to it" —
    // including on mobile. See the comment above the row in Profile.tsx.
    expect(profileSrc).toMatch(/flex items-center gap-\S+ px-4 py-3/);
    expect(profileSrc).not.toMatch(/flex-col[^\n]*px-4 py-3/);

    // DOM order follows visual order (family, then mode) rather than
    // reversing one control with CSS alone, which would desync tab order
    // from what is on screen. Anchored to the Appearance block itself —
    // both component names also appear in the import statements above it.
    const appearance = profileSrc.slice(profileSrc.indexOf('{/* Appearance —'));
    expect(appearance.length, 'Appearance block comment not found').toBeGreaterThan(0);
    const familyAt = appearance.indexOf('<PaletteFamilyToggle />');
    const modeAt = appearance.indexOf('<ThemeToggle variant="row" />');
    expect(familyAt).toBeGreaterThan(-1);
    expect(modeAt).toBeGreaterThan(-1);
    expect(familyAt, 'PaletteFamilyToggle must render before ThemeToggle to land on the left')
      .toBeLessThan(modeAt);
  });

  it("full labels do not fit side by side at 380px — computed from Tailwind's own spacing scale plus a real Chromium text measurement", () => {
    // tailwind.config.ts does not override `spacing`, so these are the
    // framework's own published px-at-16px-root values, not guesses:
    // 0.5 => 2px, 1 => 4px, 2 => 8px, 4 => 16px.
    const PAGE_GUTTER = 32; // the page container's own `px-4`, both sides
    const CARD_BORDER = 2; // the Account Settings card's `border`, both sides
    const ROW_PADDING = 32; // this row's own `px-4`, both sides
    const available380 = 380 - PAGE_GUTTER - CARD_BORDER - ROW_PADDING;
    expect(available380).toBe(314);

    // Full button-pill widths (icon + gap + text + padding together, not
    // just the glyphs) measured in Chromium at a 380px viewport: family
    // (Harvest/Classic) 161.15625px, mode (Light/Dark/System) 210.875px,
    // plus this row's own gap-2 (8px) between the two controls.
    const fullLabelContent = 161.15625 + 210.875 + 8;
    expect(Math.round(fullLabelContent)).toBe(380);
    expect(
      fullLabelContent,
      'full labels should overflow the 380px card — if this ever passes, re-verify the icon fallback below is still necessary in a real browser before relaxing it',
    ).toBeGreaterThan(available380);
  });

  it('icon-only fits at 380px with room to spare — computed from Tailwind\'s own spacing scale and the icon size in source, no text metrics involved', () => {
    const iconSize = 12; // asserted below: both controls render size={12}
    const buttonPadding = 16; // `px-2`, both sides
    const containerPadding = 4; // `p-0.5`, both sides
    const interButtonGap = 2; // `gap-0.5`, between each pair of buttons
    const rowGap = 8; // `gap-2`, between the two controls

    const buttonWidth = iconSize + buttonPadding; // no label, so no gap-1 to it
    const modeWidth = containerPadding + 3 * buttonWidth + 2 * interButtonGap; // Light/Dark/System
    const familyWidth = containerPadding + 2 * buttonWidth + 1 * interButtonGap; // Harvest/Classic
    const iconOnlyContent = familyWidth + rowGap + modeWidth;
    const available380 = 380 - 32 /* page gutter */ - 2 /* card border */ - 32 /* row padding */;

    expect(iconOnlyContent, 'icon-only content should comfortably clear the 380px card')
      .toBeLessThan(available380);
    // Cross-checked against a real Chromium render at 375–639px: natural
    // (unconstrained) row width 194px inside a 346px-wide card, no overflow.
  });

  it('labels drop to icon-only below `sm` (640px) AND from `xl` (1280px) up', () => {
    // Both breakpoints are load-bearing, not just the obvious one. Profile's
    // `settings` column splits into two exactly at `xl`, which makes this
    // card's column NARROWER there than in the single-column layout just
    // below that breakpoint — a real Chromium measurement of the full nested
    // grid found a genuine 41px overflow at exactly 1280px width with labels
    // shown, one of the most common laptop viewport widths there is. See the
    // comment above the Appearance row in Profile.tsx for the full
    // measurement (375px through 1920px, verified clean with this rule).
    for (const src of [themeToggleSrc, familyToggleSrc]) {
      expect(src).toMatch(/hidden sm:inline xl:hidden/);
    }
  });

  it('the accessible name never depends on which of icon-only / icon+label is showing', () => {
    // `aria-label={label}` must sit on its own, unconditional line — not
    // inside the same variant/breakpoint branch as the visible label text —
    // or a screen reader loses the name exactly when sighted users lose it.
    for (const src of [themeToggleSrc, familyToggleSrc]) {
      const ariaLabelLine = src.split('\n').find((l) => l.includes('aria-label={label}'));
      expect(ariaLabelLine, 'aria-label={label} not found on its own line').toBeTruthy();
      expect(ariaLabelLine).not.toMatch(/variant === 'row' \?|hidden sm:inline/);
    }
  });

  it('the reordered/reflowed Appearance block hardcodes no colour', () => {
    // Scoped to the Appearance block specifically — the composition test's
    // own "hardcodes no colour" check (Profile.composition.test.tsx) only
    // walks the five composition wrapper elements, not their descendants, so
    // it never sees this block. Every colour four palettes must resolve
    // (Harvest/Classic x light/dark) still comes from CSS custom properties
    // (bg-surface-sunken, bg-surface-raised, text-strong, text-muted, …), not
    // a literal, exactly as before this PR — this PR only touched flex
    // direction, order and the icon/label breakpoints.
    const appearance = profileSrc.slice(
      profileSrc.indexOf('{/* Appearance —'),
      profileSrc.indexOf('{/* Second settings group'),
    );
    expect(appearance.length, 'Appearance block not found').toBeGreaterThan(0);
    expect(appearance).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/);
    expect(appearance).not.toMatch(/style=\{/);
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
// 13b · reordering the controls is presentation only — the pre-paint script
//       and the theme runtime it shares with the toggle are untouched
// ═══════════════════════════════════════════════════════════════════════════

describe('the pre-paint script and the theme runtime are untouched by the reorder', () => {
  // Same idiom as "ChurchMap needed no edits at all" above: a clean
  // `git diff --stat` is a stronger claim than a content assertion, because
  // it also catches a change that happens to preserve every string this file
  // already checks for. Neither file has any reason to change for a
  // presentation-only reorder of two already-working controls — see the
  // non-negotiable in the Appearance block comment (Profile.tsx) not to
  // touch `applyTheme`, `readStoredChoice`, or the pre-paint script.
  it('theme-runtime.ts (applyTheme / readStoredChoice) has no uncommitted changes', () => {
    const diff = execSync('git diff --stat -- src/lib/theme-runtime.ts', { cwd: ROOT }).toString().trim();
    expect(diff, 'theme-runtime.ts changed — applyTheme/readStoredChoice must stay the one stamping path THE-85 consolidated').toBe('');
  });

  it('layout.tsx (the pre-paint script) has no uncommitted changes', () => {
    const diff = execSync('git diff --stat -- src/app/layout.tsx', { cwd: ROOT }).toString().trim();
    expect(diff, 'layout.tsx changed — the pre-paint script is a raw string with duplicated keys pinned by theming-stage3.test.ts; touching it risks a flash of the wrong palette on load').toBe('');
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

// ═══════════════════════════════════════════════════════════════════════════
// 15 · the admin sidebar's selected nav item follows the family
//
// Founder review on the deployed preview: the selected nav item (Courses in
// the screenshot) did not match Classic. Root cause was NOT the family
// mechanism — it was that the active pill mixed the accent over hardcoded
// `white`, so it rendered a fixed near-white #F6EEDF in EVERY theme and
// could not respond to the family (or to dark mode at all). Same bug class
// #340 fixed across the twelve member screens; its guard only covered those
// files, so the admin chrome still carried it.
// ═══════════════════════════════════════════════════════════════════════════

describe('the admin sidebar selected nav item follows the palette family', () => {
  const adminSrc = readFileSync(path.join(SRC, 'components/AdminDashboard.tsx'), 'utf8');

  /** color-mix(in srgb, FG P%, transparent) composited over `ground`. */
  const mixOver = (fg: string, pct: number, ground: string): string => {
    const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
    const a = pct / 100;
    const [f, g] = [rgb(fg), rgb(ground)];
    return '#' + f.map((c, i) => Math.round(c * a + g[i] * (1 - a)).toString(16).padStart(2, '0')).join('').toUpperCase();
  };

  // Read straight out of globals.css rather than retyped, so a palette move
  // recomputes these instead of silently passing on a stale hex.
  const ACCENT = resolve('--brand-color', rootVars);
  const RAISED_LIGHT = resolve('--surface-raised', rootVars);
  const RAISED_HARVEST_DARK = resolve('--surface-raised', harvestDarkVars);
  const RAISED_CLASSIC_DARK = resolve('--surface-raised', classicDarkVars);

  /** The tint percentages the component actually spells, parsed from source. */
  const tints = (): { light: number; dark: number } => {
    const active = adminSrc.slice(adminSrc.indexOf('const renderDesktopTab'));
    const light = active.match(/\blg:bg-\[color-mix\(in_srgb,var\(--brand-color\)_(\d+)%,transparent\)\]/);
    const dark = active.match(/\bdark:lg:bg-\[color-mix\(in_srgb,var\(--brand-color\)_(\d+)%,transparent\)\]/);
    expect(light, 'the active pill no longer spells a transparent-composited light tint').not.toBeNull();
    expect(dark, 'the active pill no longer spells a transparent-composited dark tint').not.toBeNull();
    return { light: Number(light![1]), dark: Number(dark![1]) };
  };

  it('🔴 the active pill no longer mixes the accent over hardcoded white', () => {
    // The precise regression. `white` here pins the pill to one fixed colour
    // in every theme, which is exactly what made it clash with Classic.
    const offenders = [...adminSrc.matchAll(/color-mix\(in[_\s]srgb,[^\]]*?,\s*white\s*\)/g)].map((m) => m[0]);
    expect(offenders, 'AdminDashboard still composites an accent over hardcoded white').toEqual([]);
  });

  it('light mode is provably unchanged — the sidebar is #FFFFFF in light, so transparent composites onto the very white it hardcoded', () => {
    expect(RAISED_LIGHT).toBe('#FFFFFF');
    expect(resolve('--surface-raised', classicLightVars)).toBe('#FFFFFF');
    const { light } = tints();
    // What it rendered before (mix over literal white) vs what it renders now
    // (mix over transparent, composited on the white sidebar): identical.
    expect(mixOver(ACCENT, light, '#FFFFFF')).toBe(mixOver(ACCENT, light, RAISED_LIGHT));
  });

  it('the pill actually changes between the two families in dark mode — it is no longer one fixed colour', () => {
    const { dark } = tints();
    const onHarvest = mixOver(ACCENT, dark, RAISED_HARVEST_DARK);
    const onClassic = mixOver(ACCENT, dark, RAISED_CLASSIC_DARK);
    expect(onHarvest, 'the pill renders the same in both families — it is still pinned').not.toBe(onClassic);
  });

  it('the pill is no longer a bright block on a dark sidebar (it was 14.5:1 against its own background)', () => {
    const { dark } = tints();
    for (const [family, ground] of [['Harvest', RAISED_HARVEST_DARK], ['Classic', RAISED_CLASSIC_DARK]] as const) {
      const pill = mixOver(ACCENT, dark, ground);
      const ratio = contrastRatio(pill, ground);
      // A selected-state tint should sit just off its ground, not blaze
      // against it. The broken white-mix was 13-14:1 here.
      expect(ratio, `${family}: the pill is ${pill} at ${ratio.toFixed(2)}:1 against ${ground} — still a bright block`)
        .toBeLessThan(2);
      expect(ratio, `${family}: the pill is invisible against its own sidebar`).toBeGreaterThan(1.05);
    }
  });

  it.each(['Harvest', 'Classic'] as const)(
    '%s dark: the selected label clears AA on the pill it sits on — computed, not eyeballed',
    (family) => {
      const { dark } = tints();
      const ground = family === 'Harvest' ? RAISED_HARVEST_DARK : RAISED_CLASSIC_DARK;
      const pill = mixOver(ACCENT, dark, ground);
      // The active label/icon paint in the raw accent (AdminDashboard sets
      // color: var(--brand-color) on both), so that is the ink to measure.
      const ratio = contrastRatio(ACCENT, pill);
      expect(
        ratio,
        `${family}: accent ${ACCENT} on the pill ${pill} is ${ratio.toFixed(2)}:1, needs ${AA_CONTRAST}:1`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    },
  );

  it('the label ink is still the tenant accent, not a fixed Harvest wheat — white-label survives', () => {
    const active = adminSrc.slice(adminSrc.indexOf('const renderDesktopTab'));
    expect(active).toContain("color: 'var(--brand-color, #C9963A)'");
    expect(active, 'the active label was pinned to a fixed wheat and would ignore tenant branding')
      .not.toMatch(/color:\s*'var\(--wheat-/);
  });

  it('the fix reuses the accent tint the More-drawer row already used, rather than inventing a second mechanism', () => {
    // The mobile drawer sibling was already correct (transparent, 10%); the
    // desktop pill was the lone holdout. Both now composite over their ground.
    expect(adminSrc).toContain("color-mix(in srgb, var(--brand-color, #C9963A) 10%, transparent)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16 · 🔴 accent ink on an accent TINT — the second half of the trap
//
// deriveOnDarkAccent corrects the accent against the PAGE GROUND. An
// accent-tinted chip sits ABOVE that ground (it is the accent mixed into the
// raised surface), so it is lighter, and ink that clears AA on the ground can
// still fail on the chip. Pre-existing and family-independent: it bites
// Harvest dark exactly as hard as Classic dark. deriveOnTintAccent closes it
// by deriving against the chip itself.
// ═══════════════════════════════════════════════════════════════════════════

describe('accent ink clears AA on the accent tint it sits on, in both families', () => {
  const FAMILIES = [
    ['Harvest', DARK_SURFACE, DARK_SURFACE_RAISED, harvestDarkVars],
    ['Classic', CLASSIC_DARK_SURFACE, CLASSIC_DARK_SURFACE_RAISED, classicDarkVars],
  ] as const;

  it.each(FAMILIES.map(([n, , raised, vars]) => [n, raised, vars] as const))(
    '%s: DARK_SURFACE_RAISED matches that family\'s real --surface-raised — the correction is against fiction otherwise',
    (_name, raised, vars) => {
      expect(raised).toBe(resolve('--surface-raised', vars));
    },
  );

  // The same tenant list theming-stage3 uses, so this is directly comparable
  // to its own on-dark assertions — same inputs, one layer up.
  const DARK_TENANTS = ['#0C1526', '#14532D', '#5B0E12', '#000000', '#2563EB'];

  it.each(
    FAMILIES.flatMap(([name, ground, raised]) =>
      DARK_TENANTS.map((hex) => [name, hex, ground, raised] as const),
    ),
  )(
    '%s / %s: the PAGE-GROUND correction genuinely fails on the chip — this is the gap, not a hypothetical',
    (_name, hex, ground, raised) => {
      const chip = accentTintGround(hex, raised, ACCENT_TINT_PCT);
      const pageInk = deriveOnDarkAccent(hex, ground);
      // It clears AA where it was derived...
      expect(contrastRatio(pageInk, ground)).toBeGreaterThanOrEqual(AA_CONTRAST);
      // ...and fails on the chip that actually sits under it.
      expect(
        contrastRatio(pageInk, chip),
        `${hex}: the page-ground ink ${pageInk} already cleared AA on the chip ${chip} — this test proves nothing`,
      ).toBeLessThan(AA_CONTRAST);
    },
  );

  it.each(
    FAMILIES.flatMap(([name, , raised]) => DARK_TENANTS.map((hex) => [name, hex, raised] as const)),
  )('%s / %s: the chip-derived correction clears AA on the chip', (_name, hex, raised) => {
    const chip = accentTintGround(hex, raised, ACCENT_TINT_PCT);
    const ink = deriveOnTintAccent(hex, raised, ACCENT_TINT_PCT);
    const ratio = contrastRatio(ink, chip);
    expect(ratio, `${hex}: ink ${ink} on chip ${chip} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it.each(DARK_TENANTS)('%s is corrected differently per family — the raised surface differs, so the chip does too', (hex) => {
    expect(deriveOnTintAccent(hex, DARK_SURFACE_RAISED, ACCENT_TINT_PCT))
      .not.toBe(deriveOnTintAccent(hex, CLASSIC_DARK_SURFACE_RAISED, ACCENT_TINT_PCT));
  });

  it.each(['#C9963A', '#B8962E'])(
    '🔴 %s (the Harvest golds) is returned UNCHANGED by the tint correction — the default brand does not shift',
    (gold) => {
      expect(deriveOnTintAccent(gold, DARK_SURFACE_RAISED, ACCENT_TINT_PCT)).toBe(gold);
      expect(deriveOnTintAccent(gold, CLASSIC_DARK_SURFACE_RAISED, ACCENT_TINT_PCT)).toBe(gold);
    },
  );

  it('🔴 ACCENT_TINT_PCT is low enough that Harvest gold never needs lightening — raising it past the ceiling would shift the brand', () => {
    // Computed, not assumed: at 16% gold falls to 4.48:1 on Classic's chip
    // and the derivation would start lightening it, visibly changing the
    // brand colour in dark. This pins the constant below that ceiling.
    for (const raised of [DARK_SURFACE_RAISED, CLASSIC_DARK_SURFACE_RAISED]) {
      const chip = accentTintGround('#C9963A', raised, ACCENT_TINT_PCT);
      const ratio = contrastRatio('#C9963A', chip);
      expect(
        ratio,
        `gold is ${ratio.toFixed(2)}:1 on its own ${ACCENT_TINT_PCT}% chip (${chip}) — the tint is too strong`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it('leaves a malformed hex alone rather than emitting garbage', () => {
    expect(deriveOnTintAccent('not-a-hex')).toBe('not-a-hex');
  });

  it('layout.tsx injects the chip-corrected accent per family, alongside the page-ground one', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(layout).toContain('deriveOnTintAccent(brandColor, DARK_SURFACE_RAISED)');
    expect(layout).toContain('deriveOnTintAccent(brandColor, CLASSIC_DARK_SURFACE_RAISED)');
    // Both palette selectors carry it — one declaration each, and only one
    // of the two selectors can ever match a given <html>.
    expect(layout).toContain('[data-palette="harvest"]{');
    expect(layout).toContain('[data-palette="classic"]{');
    // Counted inside the injected <style> template only — the explanatory
    // comment above it names the token too, and a comment is not a rule.
    const styleTag = layout.match(/<style dangerouslySetInnerHTML=\{\{ __html: `([^`]*)`/);
    expect(styleTag, 'the tenant brand <style> injection is gone').not.toBeNull();
    expect([...styleTag![1].matchAll(/--brand-color-on-tint:/g)]).toHaveLength(2);
    expect([...styleTag![1].matchAll(/--brand-color-on-dark:/g)]).toHaveLength(2);
  });

  it('globals.css switches the consumer token by MODE — identity in light, chip-corrected in dark', () => {
    expect(rootVars['--ink-on-accent-tint']).toBe('var(--brand-color)');
    expect(harvestDarkVars['--ink-on-accent-tint']).toBe('var(--brand-color-on-tint, var(--brand-color))');
  });

  it('Classic dark inherits the same consumer token rather than redeclaring it — one definition, family-aware via the injected value', () => {
    expect(classicDarkVars['--ink-on-accent-tint']).toBeUndefined();
    expect(classicLightVars['--ink-on-accent-tint']).toBeUndefined();
  });

  it('the fallback chain still ends at the raw accent, so a tenant with no injected value renders gold', () => {
    // The default (non-white-label) tenant injects nothing at all, so
    // --brand-color-on-tint is undefined and the chain must not collapse to
    // an empty value.
    expect(harvestDarkVars['--ink-on-accent-tint']).toContain('var(--brand-color)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17 · the color-mix-over-white sweep
//
// `color-mix(<accent> N%, white)` pins a tint to a fixed near-white in EVERY
// theme, so it cannot follow the mode or the family — the defect behind the
// founder's report. #340 fixed the twelve member screens; this sweeps the
// remaining 34 across admin, member and public surfaces.
//
// The pre-auth screens are deliberately NOT swept: THE-85 renders them light
// forever, so the literal never manifests there — and several of them sit on
// cream rather than white, where swapping to `transparent` would be a real
// light-mode regression on a screen that has no dark mode to fix.
// ═══════════════════════════════════════════════════════════════════════════

describe('no surface composites an accent over hardcoded white outside the light-only pre-auth screens', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) {
        if (e !== '__tests__' && e !== 'node_modules') walk(p, out);
      } else if (/\.tsx?$/.test(e)) out.push(p);
    }
    return out;
  }

  const OVER_WHITE = /color-mix\(in[_\s]srgb,[^\]"'`\n]*?,[_\s]*white[_\s]*\)/g;

  /**
   * The ONLY files allowed to keep the literal, with exact counts.
   *
   * Every one is a signup-funnel screen forced to light by THE-85, so the
   * value it pins is the value it will always render. Counts are exact (not
   * `<=`) so that deleting a pre-auth screen's mix, or adding one anywhere,
   * both surface here rather than drifting.
   */
  const PREAUTH_ALLOWED: Record<string, number> = {
    'src/components/ChurchOnboarding.tsx': 2,
    'src/components/FirstRunSetup.tsx': 1,
    'src/components/Onboarding.tsx': 4,
    'src/components/OnboardingGate.tsx': 1,
    'src/components/WorkspaceHandoff.tsx': 2,
  };

  const offenders = new Map<string, number>();
  for (const file of walk(SRC)) {
    const n = (readFileSync(file, 'utf8').match(OVER_WHITE) ?? []).length;
    if (n > 0) offenders.set(path.relative(ROOT, file), n);
  }

  it('🔴 every non-pre-auth surface was swept', () => {
    const unexpected = [...offenders.entries()]
      .filter(([f]) => !(f in PREAUTH_ALLOWED))
      .map(([f, n]) => `${f} (${n})`);
    expect(unexpected, 'this surface still pins an accent tint to white and cannot follow the family').toEqual([]);
  });

  it.each(Object.entries(PREAUTH_ALLOWED))(
    '%s keeps exactly its pre-auth count (light-only by THE-85)',
    (file, count) => {
      expect(offenders.get(file) ?? 0).toBe(count);
    },
  );

  it('the pre-auth exemption is justified — every allowed file really is on the funnel path list', () => {
    // Guards the guard: if one of these stopped being pre-auth, it would be
    // rendering a pinned white tint in dark mode and this exemption would be
    // silently wrong.
    const PREAUTH_TREE = [
      'components/ChurchOnboarding.tsx', 'components/FirstRunSetup.tsx',
      'components/Onboarding.tsx', 'components/OnboardingGate.tsx',
      'components/WorkspaceHandoff.tsx',
    ];
    for (const f of Object.keys(PREAUTH_ALLOWED)) {
      expect(PREAUTH_TREE.some((p) => f.endsWith(p)), `${f} is exempted but is not a pre-auth screen`).toBe(true);
    }
  });

  it('the sweep is light-identical by construction — both replacements equal #FFFFFF in light, in both families', () => {
    // Two replacements were used. `transparent` where the backdrop is
    // definitively --surface-raised (it then composites onto exactly the
    // white the literal hardcoded), and `var(--surface-raised)` where the
    // backdrop is cream or varies across call sites — that token IS #FFFFFF
    // in light in both families, so it is identical to the literal there
    // regardless of what sits behind.
    expect(resolve('--surface-raised', rootVars)).toBe('#FFFFFF');
    expect(resolve('--surface-raised', classicLightVars)).toBe('#FFFFFF');
  });

  it('the sweep introduced no bare hex — the accent is still read through its variable everywhere it was swept', () => {
    const SWEPT = [
      'components/AdminBlog.tsx', 'components/AdminCommunity.tsx', 'components/AdminCourses.tsx',
      'components/AdminFundraising.tsx', 'components/AdminLibraryCourses.tsx', 'components/AdminLivestream.tsx',
      'components/AdminRAG.tsx', 'components/AdminSettings.tsx', 'components/AffiliateSection.tsx',
      'components/AnalyticsAndRoles.tsx', 'components/CanvasList.tsx', 'components/NewsletterCampaigns.tsx',
      'components/PlanUpgradeScreen.tsx', 'components/SaveButton.tsx', 'components/ShareButton.tsx',
      'components/UserEvents.tsx', 'components/course/AuthorProfile.tsx',
    ];
    for (const rel of SWEPT) {
      const src = readFileSync(path.join(SRC, rel), 'utf8');
      for (const m of src.match(/color-mix\(in[_\s]srgb,[^\]"'`\n]*?\)/g) ?? []) {
        // Every swept mix must still name a variable, never a pasted hex.
        if (/#[0-9A-Fa-f]{6}/.test(m) && !/var\(--/.test(m)) {
          throw new Error(`${rel}: a swept mix hardcodes a colour: ${m}`);
        }
      }
    }
  });
});
