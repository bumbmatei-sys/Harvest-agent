/**
 * Theming stage 3 — shared theme vocabulary.
 *
 * Imported by the server layout (to inject the derived on-dark accent), by the
 * toggle, and by the tests. The pre-paint script in layout.tsx cannot import
 * this — it is a string that runs before any bundle — so THEME_STORAGE_KEY is
 * duplicated there and a test pins the two together.
 */

export const THEME_STORAGE_KEY = 'harvest-theme';

/** What the user chose. `system` follows prefers-color-scheme. */
export type ThemeChoice = 'light' | 'dark' | 'system';
/** What actually gets stamped on <html>. `system` resolves to one of these. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system'] as const;

export const isThemeChoice = (v: unknown): v is ThemeChoice =>
  typeof v === 'string' && (THEME_CHOICES as readonly string[]).includes(v);

/** The dark page ground. Kept here so contrast derivation and CSS agree. */
export const DARK_SURFACE = '#1A1612';
/** Brand cream — what an accent is lightened toward. */
export const CREAM = '#FAF8F5';
/** WCAG AA for body text. */
export const AA_CONTRAST = 4.5;

const toRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

const toHex = (rgb: number[]): string =>
  '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Relative luminance, per WCAG 2.x. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => c / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two hex colours (order-independent). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
};

/**
 * The on-dark variant of a tenant accent.
 *
 * An arbitrary tenant hex can vanish on a dark ground — deep navy on #1A1612 is
 * 1.01:1, i.e. invisible. This lightens the accent toward cream by the MINIMUM
 * amount that clears AA, so a colour that already works is returned untouched:
 * Harvest gold #C9963A is 6.77:1 on the dark ground and comes back unchanged,
 * which is the point. A blunt fixed mix would have washed it out to a pale
 * #E2C99B and made the two themes look like different brands.
 *
 * Derived per-request from the hex the tenant already stores — nothing new is
 * persisted, so this needs no change to how branding is saved.
 */
export function deriveOnDarkAccent(hex: string, ground: string = DARK_SURFACE): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const candidate = mix(hex, CREAM, t);
    if (contrastRatio(candidate, ground) >= AA_CONTRAST) return candidate;
  }
  return CREAM;
}

/** Resolve a stored choice to the theme actually rendered. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return prefersDark ? 'dark' : 'light';
  return choice;
}
