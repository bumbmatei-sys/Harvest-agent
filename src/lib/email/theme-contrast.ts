/**
 * Email theme contrast — the WCAG maths every theme surface shares.
 *
 * One module computes ratios and readable fallbacks so the editor's warning
 * banner and the renderer's fallback colour can never disagree: same maths on
 * the client and on the server, one import, no second copy. The ratio and
 * luminance functions are re-exported from the app's single implementation
 * (`src/lib/theme.ts`) rather than reimplemented here.
 *
 * `inkOn` moved here from render.ts — it is the "readable ink on a filled
 * background" primitive and the fallback logic below builds on the same two
 * ink colours. render.ts re-exports it, so nothing that imported it breaks.
 */
import { AA_CONTRAST, contrastRatio, luminance } from '@/lib/theme';

export { AA_CONTRAST, contrastRatio, luminance };

/** The two inks every fallback chooses between. */
const NEAR_BLACK = '#1A1A1A';
const WHITE = '#ffffff';

/**
 * White or near-black, whichever reads on `hex`. Used for the text on a filled
 * button; its threshold is the historic one and its outputs are pinned, so a
 * theme's button ink never changes under an old design.
 */
export function inkOn(hex: string): string {
  return luminance(hex) > 0.45 ? NEAR_BLACK : WHITE;
}

/** The ink with the higher contrast on `background` — never below 4.58:1 for any ground. */
export function readableInkOn(background: string): string {
  return contrastRatio(NEAR_BLACK, background) >= contrastRatio(WHITE, background) ? NEAR_BLACK : WHITE;
}

/** Straight-line mix of two six-digit hexes; `t` = 0 gives `a`, 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const channel = (x: number, y: number) => Math.round(x + (y - x) * t);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(channel(ar, br))}${hex(channel(ag, bg))}${hex(channel(ab, bb))}`;
}

/**
 * The colour `preferred` should be drawn in on `background`: `preferred` itself
 * when it clears AA, otherwise the closest readable colour to it — nudged
 * toward whichever ink reads better on that ground until it clears 4.5:1. The
 * walk keeps the theme's hue as long as it can; the extreme always clears AA
 * (one of black or white is at least 4.58:1 on any ground), so the fallback
 * can never resolve to something unreadable.
 */
export function readableTextOn(background: string, preferred: string): string {
  if (contrastRatio(preferred, background) >= AA_CONTRAST) return preferred;
  const extreme = readableInkOn(background);
  for (let t = 0.1; t < 1; t += 0.1) {
    const candidate = mixHex(preferred, extreme, t);
    if (contrastRatio(candidate, background) >= AA_CONTRAST) return candidate;
  }
  return extreme;
}

/** WCAG 1.4.11's non-text floor: a control must clear 3:1 against its ground. */
export const UI_CONTRAST = 3;

export interface BoxFillColors {
  /** The painted ground of the Box — the fill every ink below is chosen against. */
  readonly fill: string;
  /** The hairline between the fill and the tint base. */
  readonly border: string;
  readonly label: string;
  readonly title: string;
  readonly blurb: string;
  readonly buttonBg: string;
  readonly buttonInk: string;
  readonly buttonBorder: string;
}

/**
 * The colours a Box draws inside its tint — ONE derivation shared by the email
 * renderer's `boxHtml` and the editor's Box node view, so the preview and the
 * sent email can never disagree (import this helper; never copy its maths).
 *
 * Every ink is `readableTextOn` against the actual fill, keeping each
 * preferred hue as long as it reads. A filled Box's button keeps the theme's
 * own colours only while its background clears the 3:1 non-text floor against
 * that fill; otherwise the button becomes a light/dark chip in `inkOn(fill)`
 * with contrasting text — a themed button vanishing into its own Box is the
 * failure this replaces.
 */
export function boxFillColors(
  base: string,
  card: string,
  theme: { heading: string; ink: string; buttonBg: string; buttonInk: string },
  filled: boolean,
): BoxFillColors {
  const darkBase = inkOn(base) === '#ffffff';
  const fill = filled ? mixHex(card, base, darkBase ? 0.9 : 0.22) : card;
  let buttonBg = theme.buttonBg;
  let buttonInk = theme.buttonInk;
  if (filled && (buttonBg === 'transparent' || contrastRatio(buttonBg, fill) < UI_CONTRAST)) {
    buttonBg = inkOn(fill);
    buttonInk = readableTextOn(buttonBg, fill);
  }
  return {
    fill,
    border: mixHex(fill, base, 0.45),
    label: readableTextOn(fill, base),
    title: readableTextOn(fill, theme.heading),
    blurb: readableTextOn(fill, theme.ink),
    buttonBg,
    buttonInk,
    buttonBorder: buttonBg === 'transparent' ? buttonInk : buttonBg,
  };
}
