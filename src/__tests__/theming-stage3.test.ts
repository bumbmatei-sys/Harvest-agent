import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import {
  contrastRatio,
  deriveOnDarkAccent,
  resolveTheme,
  THEME_STORAGE_KEY,
  AA_CONTRAST,
  DARK_SURFACE,
} from '../lib/theme';

/**
 * Theming stage 3 — the dark palette and its edge cases.
 *
 * Contrast ratios are COMPUTED here, never hardcoded to a pass. A test that
 * asserts `expect(true)` against an eyeballed value would survive any palette
 * change, which is the failure mode these are meant to prevent.
 */

const ROOT = path.resolve(__dirname, '../..');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const LAYOUT = path.join(ROOT, 'src/app/layout.tsx');

/** Custom properties declared in a rule matching `selectorTest`. */
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

/** Resolve a var chain within a theme to a literal hex, if it is one. */
function resolve(name: string, scope: Record<string, string>, depth = 0): string {
  const v = scope[name];
  if (!v || depth > 10) return v ?? '';
  const m = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (m) return resolve(m[1], scope, depth + 1);
  return v;
}

beforeAll(() => {
  const css = readFileSync(GLOBALS, 'utf8');
  lightVars = varsIn(css, (s) => s === ':root');
  darkVars = varsIn(css, (s) => /\.dark|\[data-theme="dark"\]/.test(s));
});

/**
 * TEST 1 — pairing. A token present in one theme but missing from the other is
 * exactly how one surface stays white. Removing any dark token fails this.
 */
describe('every themed token has a counterpart in both themes', () => {
  // The tokens the theme is responsible for inverting.
  //
  // ⚠️ THIS LIST IS EXPLICIT, NOT DERIVED. That is deliberate — it states which
  // tokens the theme OWNS, so a token can be added to globals.css without
  // anyone noticing it never got a dark value. The cost is that the list has to
  // be extended by hand. If you add a themed token, add it here in the same
  // commit; a light-only token is how a surface stays white in dark mode.
  const THEMED = [
    '--surface', '--surface-raised', '--surface-sunken',
    '--surface-night', '--surface-gold', '--surface-chip',
    '--border-subtle', '--border-default', '--border-strong', '--border-gold',
    '--text-strong', '--text-heading', '--text-body', '--text-muted', '--text-faint',
    '--ds-sh-sm', '--ds-sh-md', '--ds-sh-lg', '--glow-gold',
    // Both of these have carried light AND dark values since stage 2, but were
    // never listed here — the list had drifted two tokens behind globals.css,
    // which is the exact failure mode described above. Closed by THE-61.
    '--border-hairline', '--surface-tint',
    // THE-61: the three tokens the design-kit primitives needed that Harvest
    // had not named. --ds-sh-xl extends the elevation ramp for Modal;
    // --scrim-night is its backdrop; --ring-gold is the Input/Select focus ring.
    '--ring-gold', '--scrim-night', '--ds-sh-xl',
  ];

  it.each(THEMED)('%s is defined in the dark theme', (token) => {
    expect(darkVars[token], `${token} has no dark value — that surface stays light`).toBeDefined();
  });

  it.each(THEMED)('%s is defined in the light theme', (token) => {
    expect(lightVars[token], `${token} has no light counterpart`).toBeDefined();
  });

  it('the dark theme introduces no token the light theme lacks', () => {
    // color-scheme is a real property, not a custom property, so it is absent here.
    const orphans = Object.keys(darkVars).filter((k) => !(k in lightVars));
    expect(orphans, 'dark-only tokens have no light fallback').toEqual([]);
  });
});

/**
 * TEST 2 — contrast, computed. Loosening any value fails this.
 */
describe('WCAG AA contrast in both themes', () => {
  const SURFACES = ['--surface', '--surface-raised', '--surface-sunken'] as const;
  const TEXTS = ['--text-strong', '--text-muted', '--text-faint'] as const;

  it.each(TEXTS.flatMap((t) => SURFACES.map((s) => [t, s] as const)))(
    'dark: %s on %s clears AA',
    (text, surface) => {
      const ratio = contrastRatio(resolve(text, darkVars), resolve(surface, darkVars));
      expect(
        ratio,
        `${text} on ${surface} is ${ratio.toFixed(2)}:1, needs ${AA_CONTRAST}:1`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    },
  );

  it('the dark text ramp is monotonic (strong > muted > faint)', () => {
    const g = resolve('--surface', darkVars);
    const ratios = (['--text-strong', '--text-muted', '--text-faint'] as const).map((t) =>
      contrastRatio(resolve(t, darkVars), g),
    );
    expect(ratios).toEqual([...ratios].sort((a, b) => b - a));
  });

  // The light theme used to ship BELOW AA for muted (4.23:1) and faint
  // (2.59:1). That is now fixed, so this assertion is inverted: both themes
  // are held to the same floor rather than dark being the only compliant one.
  it.each([
    ['--text-strong'], ['--text-muted'], ['--text-faint'],
  ])('light: %s clears AA on every light surface', (text) => {
    for (const surface of ['--surface', '--surface-raised', '--surface-sunken']) {
      const ratio = contrastRatio(resolve(text, lightVars), resolve(surface, lightVars));
      expect(
        ratio,
        `${text} on ${surface} is ${ratio.toFixed(2)}:1, needs ${AA_CONTRAST}:1`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it('the light text ramp stays monotonic after the AA fix', () => {
    const g = resolve('--surface', lightVars);
    const ratios = (['--text-strong', '--text-muted', '--text-faint'] as const).map((t) =>
      contrastRatio(resolve(t, lightVars), g),
    );
    expect(ratios).toEqual([...ratios].sort((a, b) => b - a));
  });
});

/**
 * TEST 3 — the light theme ramp is pinned.
 *
 * 🔴 THE-338 REPOINTED THESE SEVEN, and the reason matters more than the
 * values. This block was written as "the light theme is UNTOUCHED" — stage 3
 * added a dark theme and had to prove it changed nothing in light — and the
 * values it pinned were the warm Harvest ramp (#FAF8F5 cream, #F3EEE7,
 * #E8E2D9 stone, #2D2519 earth, #68563F, #766A5A).
 *
 * THE-338 removed the Harvest palette FAMILY and promoted the neutral one
 * into `:root`, so those six hexes are no longer what light renders — the
 * neutral values below are. That is the ticket's whole point, not a
 * regression, so the pins move WITH it rather than being deleted: the block
 * still fails the moment anything moves the light ramp without saying so.
 *
 * ⚠️ Note what did NOT have to change: every other assertion in this file.
 * This suite tests the light/dark MODE axis, which THE-338 did not touch —
 * only the FAMILY axis was removed — so its dark-ramp contrast, its
 * monotonicity checks and its toggle tests all still hold, computed against
 * the new ramp. That is why this file was kept rather than deleted.
 */
describe('the light theme ramp values are pinned', () => {
  it.each([
    ['--surface', '#F7F7F7'],
    ['--surface-raised', '#FFFFFF'],
    ['--surface-sunken', '#EFEFEF'],
    ['--border-default', '#E0E0E0'],
    ['--text-strong', '#1A1A1A'],
    ['--text-muted', '#595959'],
    ['--text-faint', '#696969'],
  ])('%s is still %s', (token, expected) => {
    expect(resolve(token, lightVars).toUpperCase()).toBe(expected);
  });

  it('the light theme declares no dark-only override', () => {
    expect(lightVars['color-scheme']).toBeUndefined();
  });
});

/**
 * TEST 4 — the toggle's three states.
 */
describe('the toggle resolves its three states correctly', () => {
  it.each([
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
  ] as const)('%s with prefersDark=%s resolves to %s', (choice, prefers, expected) => {
    expect(resolveTheme(choice, prefers)).toBe(expected);
  });

  it('system tracks prefers-color-scheme in both directions', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('the toggle offers exactly light / dark / system', () => {
    const src = readFileSync(path.join(ROOT, 'src/components/ThemeToggle.tsx'), 'utf8');
    for (const v of ['light', 'dark', 'system']) {
      expect(src).toContain(`value: '${v}'`);
    }
  });
});

/**
 * TEST 5 — persistence survives a reload.
 */
describe('the persisted choice survives a reload', () => {
  it('the toggle writes the same key the pre-paint script reads', () => {
    const toggle = readFileSync(path.join(ROOT, 'src/components/ThemeToggle.tsx'), 'utf8');
    const layout = readFileSync(LAYOUT, 'utf8');
    // The pre-paint script is a raw string and cannot import the constant, so
    // the key is duplicated there. Pin the two together: if they drift, the
    // stored choice is silently ignored on reload and the theme flashes.
    expect(toggle).toContain('THEME_STORAGE_KEY');
    expect(layout).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });

  /**
   * 🔴 THE-338 INVERTED THIS TEST, rather than deleting it.
   *
   * It used to pin a SECOND duplicated storage key: the pre-paint script
   * could not import FAMILY_STORAGE_KEY either, so it spelled
   * 'harvest-theme-family' as a literal, and PaletteFamilyToggle read the
   * constant. Drift between the two meant a stored family was ignored on
   * reload and the surface flashed after first paint.
   *
   * There is one palette family now. The toggle is gone, the constant is
   * gone, and the script must no longer read that key — so the property
   * worth guarding flipped from "these two agree" to "neither exists". A
   * deleted test would have let the key quietly come back; this one fails if
   * it does.
   */
  it('the pre-paint script reads no family key, and no family control exists', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    // 🔴 The SCRIPT, not the prose around it. layout.tsx documents the family
    // removal in a comment that necessarily names `data-palette`, so a check
    // over the whole file would match its own explanation and pass while the
    // stamp was still live. The script is a template literal inside
    // dangerouslySetInnerHTML and the tag is self-closing, so it is bounded by
    // the IIFE itself rather than by a closing tag.
    const script = (/\(function\(\)\{[\s\S]*?\}\)\(\);/.exec(layout) ?? [''])[0];
    expect(script, 'the pre-paint IIFE was not found — this assertion would be vacuous')
      .toContain('document.documentElement');
    expect(script).toContain("setAttribute('data-theme'");
    expect(script).not.toContain('harvest-theme-family');
    expect(script).not.toContain('data-palette');
    expect(existsSync(path.join(ROOT, 'src/components/PaletteFamilyToggle.tsx'))).toBe(false);
  });

  it('the pre-paint script stamps before paint and cannot throw', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(layout).toMatch(/<script\s+dangerouslySetInnerHTML/);
    expect(layout).toMatch(/try\{[\s\S]*catch/);
    // Storage key and CSS must not depend on being the same bundle version
    // (skipWaiting: false can serve a stale bundle after a deploy).
    expect(layout).toContain("setAttribute('data-theme'");
  });
});

/**
 * TEST 6 — a deliberately dark tenant accent. Reverting the on-dark accent
 * derivation fails this.
 */
describe('a dark tenant brand colour still clears contrast on dark', () => {
  const DARK_TENANTS = ['#0C1526', '#14532D', '#5B0E12', '#000000', '#2563EB'];

  it.each(DARK_TENANTS)('%s is corrected to clear AA on the dark ground', (hex) => {
    const raw = contrastRatio(hex, DARK_SURFACE);
    const corrected = contrastRatio(deriveOnDarkAccent(hex), DARK_SURFACE);
    expect(raw, `${hex} should be the hard case`).toBeLessThan(AA_CONTRAST);
    expect(
      corrected,
      `${hex} corrected to ${deriveOnDarkAccent(hex)} is ${corrected.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('Harvest gold already clears AA and is returned untouched', () => {
    // The point of deriving the minimum: a blunt fixed mix would wash gold out
    // and the two themes would stop looking like the same brand.
    expect(contrastRatio('#C9963A', DARK_SURFACE)).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(deriveOnDarkAccent('#C9963A')).toBe('#C9963A');
  });

  it('is derived server-side from the already-stored hex, changing no storage', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(layout).toContain('deriveOnDarkAccent');
    expect(layout).toContain('--brand-color-on-dark');
  });

  it('leaves a malformed hex alone rather than emitting garbage', () => {
    expect(deriveOnDarkAccent('not-a-hex')).toBe('not-a-hex');
  });
});

/**
 * TEST 7 — documents, emails and certificates must never be theme-dependent.
 */
describe('no email, PDF or certificate path reads a theme token', () => {
  const DOC_PATHS = [
    'src/app/api/certificate/route.ts',
    'src/app/api/giving-statements/generate/route.ts',
    'src/app/api/billing/statement/route.ts',
    'src/lib/donation-receipt.ts',
    'src/utils/doc-export.ts',
    'src/utils/email.ts',
    'src/utils/open-statement-pdf.ts',
    'src/lib/gmail-sender.ts',
    'src/app/api/send-email/route.ts',
    'src/app/api/crm/send-email/route.ts',
  ];

  const THEME_TOKEN = /var\(--(surface|surface-raised|surface-sunken|border-default|border-subtle|border-strong|text-strong|text-body|text-muted|text-faint|brand-color-on-dark)\b/;

  it.each(DOC_PATHS)('%s is theme-independent', (rel) => {
    const src = readFileSync(path.join(ROOT, rel), 'utf8');
    expect(
      THEME_TOKEN.test(src),
      `${rel} reads a theme token — an emailed receipt rendered dark is a bug`,
    ).toBe(false);
  });

  it('none of them carry a dark-mode class either', () => {
    for (const rel of DOC_PATHS) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src).not.toMatch(/\bdark:[a-z-]+/);
      expect(src).not.toContain('logo-plate');
    }
  });
});
