/**
 * How tall a full-height admin screen is on desktop.
 *
 * ── The screens this is for ──────────────────────────────────────────────────
 * Most admin screens are documents: they are as tall as their content and the
 * shell scrolls them. Two are not. Notes and Community are APP-SHELL screens —
 * a rail beside a pane, both of which scroll independently — and a pane can
 * only scroll independently if something above it says how tall it is. So they
 * need a height, and a height is a number, and a number invented twice drifts.
 *
 * ── Why the number that was here was wrong ───────────────────────────────────
 * Both screens spelled `calc(100dvh - 140px)`. Nothing derived 140; it was a
 * guess, and it over-subtracted by about 37px — which is why both screens sat
 * short of the bottom of the shell with a band of empty page under them.
 *
 * ── The derivation, from the shell's own classes ─────────────────────────────
 * AdminDashboard.tsx stacks a desktop screen like this:
 *
 *   <div class="h-[100dvh] flex flex-col">        the right-hand column
 *     <div class="hidden lg:flex h-14 border-b">  the branded top bar
 *     <div class="flex-1 p-0 lg:p-6 lg:pb-8">     the content area
 *       <div class="p-4 lg:p-0">                  the per-tab wrapper
 *         …the screen…
 *
 * So what a screen actually gets is the viewport, less the top bar and its
 * border, less the content area's own padding:
 *
 *   100dvh − 3.5rem (h-14) − 1px (border-b) − 1.5rem (lg:p-6) − 2rem (lg:pb-8)
 *   = 100dvh − 7rem − 1px
 *
 * ── In rem, deliberately, not in px ──────────────────────────────────────────
 * globals.css trims the rem base to 14.5px at `min-width: 1024px`, so those
 * four Tailwind classes are NOT 24/56/32px on a monitor — they are 21.75, 50.75
 * and 29. A px constant would be right at one rem base and wrong at the other,
 * which is the same trap form-layout.ts documents for its widths. Spelled in
 * rem, this tracks the trim exactly, because it is the same arithmetic the
 * browser is already doing on the shell's own classes.
 *
 * ── Kept honest ──────────────────────────────────────────────────────────────
 * A derivation is only as good as its premises, and the premises here live in a
 * file this module cannot see. `shell-height.test.ts` reads AdminDashboard.tsx
 * and asserts every class named above is still on the element it is claimed to
 * be on — so if the top bar stops being `h-14`, that fails with the reason,
 * rather than these two screens quietly going short again.
 */

/** The pieces the height is derived from, each named for the class it reads. */
export const SHELL_CHROME = {
  /** The desktop branded top bar — `h-14`. */
  topBar: '3.5rem',
  /** Its bottom hairline — `border-b`. */
  topBarBorder: '1px',
  /** The content area's top padding — `lg:p-6`. */
  contentPaddingTop: '1.5rem',
  /** The content area's bottom padding — `lg:pb-8`, which overrides `p-6`. */
  contentPaddingBottom: '2rem',
} as const;

/** The three rem terms above, summed: 3.5 + 1.5 + 2. */
export const SHELL_CHROME_REM = 7;

/**
 * The height class for a full-height admin screen, desktop only.
 *
 * Gated at `lg:` because below it there is no top bar of this shape and the
 * shell scrolls the page normally — a phone gets one pane at natural height,
 * which is what both screens already do.
 */
export const SHELL_SCREEN_HEIGHT = `lg:h-[calc(100dvh-${SHELL_CHROME_REM}rem-${SHELL_CHROME.topBarBorder})]`;
