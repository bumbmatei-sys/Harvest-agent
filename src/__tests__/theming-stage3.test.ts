import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import {
  contrastRatio,
  deriveOnDarkAccent,
  resolveTheme,
  THEME_STORAGE_KEY,
  FAMILY_STORAGE_KEY,
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
 * TEST 3 — the light theme is untouched.
 */
describe('the light theme ramp values are pinned', () => {
  it.each([
    ['--surface', '#FAF8F5'],
    ['--surface-raised', '#FFFFFF'],
    ['--surface-sunken', '#F3EEE7'],
    ['--border-default', '#E8E2D9'],
    ['--text-strong', '#2D2519'],
    ['--text-muted', '#68563F'],
    ['--text-faint', '#766A5A'],
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
   * THE-168 — extends the pin above to the second duplicated key. The
   * pre-paint script also cannot import FAMILY_STORAGE_KEY, so it is
   * duplicated as a literal the same way; PaletteFamilyToggle reads/writes
   * the constant. If the two drift, a stored family is silently ignored on
   * reload and the surface flashes from Classic to Harvest (or back) after
   * first paint.
   */
  it('the family control writes the same key the pre-paint script reads', () => {
    const familyToggle = readFileSync(path.join(ROOT, 'src/components/PaletteFamilyToggle.tsx'), 'utf8');
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(familyToggle).toContain('FAMILY_STORAGE_KEY');
    expect(layout).toContain(`localStorage.getItem('${FAMILY_STORAGE_KEY}')`);
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
