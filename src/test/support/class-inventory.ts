/**
 * Class-layer inventory — the machinery behind the "mobile is unchanged" pin.
 *
 * Tailwind class strings are unordered sets of tokens, and a token only applies
 * at a viewport where its variant chain matches. So "what does this component
 * render below 640px?" has an exact, mechanical answer: the tokens whose variant
 * chain contains no breakpoint. Everything else is desktop-only by construction.
 *
 * Nothing here is Church-form specific — it walks a rendered subtree and reports
 * what it finds, so the fixtures it produces are extracted, never hand-typed.
 */

/** Tailwind's default breakpoints. No `screens` override exists in tailwind.config.ts. */
export const BREAKPOINTS = ['sm', 'md', 'lg', 'xl', '2xl'] as const;

/** Tailwind's default breakpoint minimums, in px — used to reason about order. */
export const BREAKPOINT_MIN_PX: Record<string, number> = {
  sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536,
};

/**
 * True when a token is gated behind a min-width breakpoint, i.e. it cannot
 * apply on a phone. Arbitrary variants like `[&>svg]:` may contain colons
 * inside brackets, so the chain is split on top-level colons only.
 */
export function isResponsive(token: string): boolean {
  return variantChain(token).some((v) => (BREAKPOINTS as readonly string[]).includes(v));
}

/** The variant chain of a token, excluding the utility itself. */
export function variantChain(token: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of token) {
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === ':' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  return parts;
}

/** Which breakpoint a token is gated behind, or null when it applies from 0px. */
export function breakpointOf(token: string): string | null {
  return variantChain(token).find((v) => (BREAKPOINTS as readonly string[]).includes(v)) ?? null;
}

export interface ElementClasses {
  /** Position in document order — a moved element changes its index. */
  index: number;
  tag: string;
  tokens: string[];
}

/**
 * Every element in the subtree, in document order, with its class tokens.
 *
 * Class-less elements are included deliberately. A wrapper that gains a
 * desktop-only class goes from no class attribute to one, and skipping the
 * class-less case would shift every later index and read as a mobile change
 * when nothing about the phone rendering moved.
 */
export function classInventory(root: ParentNode): ElementClasses[] {
  return Array.from(root.querySelectorAll('*')).map((el, index) => ({
    index,
    tag: el.tagName.toLowerCase(),
    tokens: (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort(),
  }));
}

/**
 * The rendering below 640px, as a stable string: every element that carries a
 * class, with only the tokens that apply at phone widths, sorted so a reordered
 * class attribute is not mistaken for a changed one.
 */
export function mobileLayer(root: ParentNode): string[] {
  return classInventory(root).map(
    ({ index, tag, tokens }) => `${index}\t${tag}\t${tokens.filter((t) => !isResponsive(t)).join(' ')}`,
  );
}

/** Every distinct class token in the subtree, sorted. */
export function allTokens(root: ParentNode): string[] {
  const set = new Set<string>();
  for (const { tokens } of classInventory(root)) for (const t of tokens) set.add(t);
  return [...set].sort();
}

/**
 * Font-size-bearing tokens. Covers Tailwind's named scale, arbitrary
 * `text-[13px]`/`text-[0.8rem]` values, and the `font-size:` shorthand that
 * arbitrary properties allow. Colour utilities such as `text-strong` share the
 * `text-` prefix, so the named scale is matched against an explicit list.
 */
const NAMED_TEXT_SIZES = [
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
];
export function isFontSizeToken(token: string): boolean {
  const utility = token.slice(variantChain(token).reduce((n, v) => n + v.length + 1, 0));
  if (/^text-\[(?:length:)?[^\]]*(?:px|rem|em|%|pt|ch|vw)\]$/.test(utility)) return true;
  if (/^\[font-size:[^\]]+\]$/.test(utility)) return true;
  const named = utility.match(/^text-([a-z0-9]+)$/)?.[1];
  return named !== undefined && NAMED_TEXT_SIZES.includes(named);
}

/** Font-size tokens in the subtree, sorted — the pin for "no font size changed". */
export function fontSizeTokens(root: ParentNode): string[] {
  return allTokens(root).filter(isFontSizeToken);
}

/** Tailwind's default font-size scale, in rem. No `fontSize` override exists in the config. */
const NAMED_TEXT_SIZE_REM: Record<string, number> = {
  xs: 0.75, sm: 0.875, base: 1, lg: 1.125, xl: 1.25, '2xl': 1.5, '3xl': 1.875,
  '4xl': 2.25, '5xl': 3, '6xl': 3.75, '7xl': 4.5, '8xl': 6, '9xl': 8,
};

/**
 * The px a font-size token resolves to at a given rem base, or null when the
 * token is not an absolute length (`%`, `em`, `ch`, `vw`).
 *
 * The rem base is a parameter because this codebase has two: globals.css sets
 * `:root { font-size: 14.5px }` inside `@media (min-width: 1024px)` and leaves
 * 16px below it, so the same `text-xs` is 12px on a phone and 10.875px on a
 * monitor.
 */
export const REM_PX_MOBILE = 16;
export const REM_PX_DESKTOP = 14.5;

export function fontSizePx(token: string, remPx: number = REM_PX_MOBILE): number | null {
  // Gated on the token actually being a font size: `max-w-[1120px]` also
  // carries an absolute length, and is not one.
  if (!isFontSizeToken(token)) return null;
  const utility = token.slice(variantChain(token).reduce((n, v) => n + v.length + 1, 0));
  const arbitrary = utility.match(/\[(?:font-size:)?(?:length:)?(-?[\d.]+)(px|rem|pt)\]/);
  if (arbitrary) {
    const n = parseFloat(arbitrary[1]);
    return arbitrary[2] === 'px' ? n : arbitrary[2] === 'rem' ? n * remPx : n * (4 / 3);
  }
  const named = utility.match(/^text-([a-z0-9]+)$/)?.[1];
  if (named && named in NAMED_TEXT_SIZE_REM) return NAMED_TEXT_SIZE_REM[named] * remPx;
  return null;
}

/**
 * Colour-bearing tokens: any raw colour syntax, plus the utility families whose
 * value in this codebase is a colour token (`text-strong`, `bg-surface-raised`,
 * `border-line`). Font sizes share the `text-` prefix and are excluded.
 */
const COLOUR_FAMILIES = [
  'bg', 'text', 'border', 'ring', 'from', 'via', 'to', 'fill', 'stroke',
  'divide', 'outline', 'accent', 'caret', 'decoration', 'shadow', 'placeholder',
];
export function isColourToken(token: string): boolean {
  const utility = token.slice(variantChain(token).reduce((n, v) => n + v.length + 1, 0));
  if (/#[0-9a-fA-F]{3,8}\b/.test(utility)) return true;
  if (/\b(?:rgba?|hsla?|color-mix|oklch|lab)\(/.test(utility)) return true;
  if (isFontSizeToken(token)) return false;
  const family = utility.replace(/^-/, '').split('-')[0];
  return COLOUR_FAMILIES.includes(family) && utility.includes('-');
}

/** Colour tokens in the subtree, sorted — the pin for "no colour was added". */
export function colourTokens(root: ParentNode): string[] {
  return allTokens(root).filter(isColourToken);
}

/**
 * Max-width tokens, with their px value where it is an absolute length.
 * `max-w-full`/`max-w-none` and the like resolve to null.
 */
const TAILWIND_MAX_W_REM: Record<string, number> = {
  xs: 20, sm: 24, md: 28, lg: 32, xl: 36, '2xl': 42, '3xl': 48,
  '4xl': 56, '5xl': 64, '6xl': 72, '7xl': 80,
};
export function maxWidthPx(token: string): number | null {
  const utility = token.slice(variantChain(token).reduce((n, v) => n + v.length + 1, 0));
  const arbitrary = utility.match(/^max-w-\[(-?[\d.]+)(px|rem)\]$/);
  if (arbitrary) return arbitrary[2] === 'px' ? parseFloat(arbitrary[1]) : parseFloat(arbitrary[1]) * 16;
  const named = utility.match(/^max-w-([a-z0-9]+)$/)?.[1];
  if (named && named in TAILWIND_MAX_W_REM) return TAILWIND_MAX_W_REM[named] * 16;
  return null;
}

/** Max-width tokens carried by an element, in the order they appear. */
export function maxWidthTokens(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter((t) => /(?:^|:)max-w-/.test(t));
}
