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

/**
 * THE-338 — there is exactly ONE palette family.
 *
 * A second family, "Classic", used to live alongside the Harvest one behind a
 * `data-palette` attribute and a stored `harvest-theme-family` preference.
 * THE-265 had already made Classic the family a user with no stored choice
 * rendered in, so Classic light and Classic dark were what the app actually
 * put on screen; Harvest survived only as the set of declarations Classic
 * layered its 14 overrides on top of.
 *
 * The founder asked for the family to go ("remove harvest theme"), so the 14
 * overrides were promoted into `:root` / `.dark` in globals.css and BOTH the
 * attribute and the stored preference were removed. What that leaves is the
 * mode axis alone — light/dark — which is the axis this file still models.
 *
 * ⚠️ The stored `harvest-theme-family` key is deliberately NOT migrated or
 * cleared. Nothing reads it any more, so a value left in a returning user's
 * localStorage is inert; writing a migration would mean shipping code whose
 * only job is to delete a key nobody consults.
 */


/** The dark page ground — see `--surface` in the `.dark` block of
 *  globals.css, which this must match EXACTLY for deriveOnDarkAccent's AA
 *  guarantee to hold. THE-338 darkened it from #1C1C1C (and, before the
 *  family promotion, Harvest's warm #1A1612) on the founder's note that the
 *  grey read lighter than his reference. */
export const DARK_SURFACE = '#141414';
/** The dark RAISED surface — cards, panels, the admin sidebar. An accent-
 *  tinted chip composites onto THIS, not onto the page ground, so it is the
 *  ground deriveOnTintAccent has to correct against. Must match
 *  `--surface-raised` in the `.dark` block of globals.css. */
export const DARK_SURFACE_RAISED = '#1F1F1F';
/** Brand cream — what an accent is lightened toward. Shared by both families:
 *  lightening toward cream (rather than toward each family's own near-white)
 *  is what keeps a corrected tenant accent reading as gold-tinted instead of
 *  flattening to a neutral grey — see the non-negotiable that the accent must
 *  never grey out. */
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

/**
 * The ground an accent-tinted chip actually paints, i.e. what
 * `color-mix(in srgb, <accent> <pct>%, transparent)` composites to when it
 * sits on `raised`. Exported so tests recompute it rather than trusting a
 * hand-typed hex.
 */
export function accentTintGround(hex: string, raised: string, pct: number): string {
  // mix(a, b, t) walks a -> b, so t = pct/100 puts `pct`% of the accent in.
  return mix(raised, hex, pct / 100);
}

/**
 * The strength accent chips are tinted at on dark.
 *
 * One canonical value, because the correction below has to be derived
 * against a KNOWN ground: a per-call-site percentage would need a per-call-
 * site variable. Chosen as the worst (lightest) tint that carries accent ink
 * — a lighter chip is the harder case for ink sitting on it, so correcting
 * for this covers every chip at or below it.
 */
export const ACCENT_TINT_PCT = 12;

/**
 * The on-ACCENT-TINT variant of a tenant accent.
 *
 * 🔴 The gap deriveOnDarkAccent leaves. That function corrects the accent
 * against the PAGE GROUND — but an accent-tinted chip sits ABOVE the ground
 * (it is the accent mixed into the raised surface), so it is lighter, and
 * ink that clears AA on the ground can still fail on the chip. Harvest gold
 * is comfortable either way; a dark white-label accent is not. Navy #0C1526
 * clears 4.54:1 on the page ground and lands ~4.27:1 on the chip — below AA,
 * in Harvest dark exactly as much as in Classic dark.
 *
 * So this derives against the chip itself: build the ground the CSS actually
 * renders (the accent mixed into `raised` at `pct`), then lighten toward
 * cream by the minimum that clears AA against THAT. Harvest gold still comes
 * back untouched — 5.15:1 on its own 12% chip — so this changes nothing for
 * the default brand, which is the same property deriveOnDarkAccent has.
 */
export function deriveOnTintAccent(
  hex: string,
  raised: string = DARK_SURFACE_RAISED,
  pct: number = ACCENT_TINT_PCT,
): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  return deriveOnDarkAccent(hex, accentTintGround(hex, raised, pct));
}

/** Resolve a stored choice to the theme actually rendered. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return prefersDark ? 'dark' : 'light';
  return choice;
}
