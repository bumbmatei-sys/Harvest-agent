/**
 * Desktop layout rules for forms — the container, the field widths, the button,
 * and the density of a control.
 *
 * Four rules, defined once. The app is responsive to 1024px and then stretches
 * with no maximum, so on a wide monitor the Add Church form rendered a 1517px
 * Google Maps field, a 748px "Church Name" for a value needing about 300, and a
 * 1517px submit button. That is not a typography or component problem — it is
 * these rules missing.
 *
 * Rules 1-3 are horizontal and landed together; they made the form narrower
 * without making it smaller. Rule 4 is the vertical half — height and rhythm —
 * and it is the one that can reach a phone if it is ever written carelessly.
 *
 * ── Every rule here is gated at `sm:` and above, deliberately ────────────────
 * Below 640px the app is fine and must not move, so no rule in this file can
 * apply to a phone. That is a hard constraint, not a convention: adding an
 * unprefixed token here changes mobile rendering, and
 * ChurchEnrollment.desktop-layout.test.tsx pins the sub-640px class layer
 * against an extracted baseline precisely so that fails loudly.
 *
 * ── Why the widths are in px and not rem ─────────────────────────────────────
 * globals.css trims the rem base to 14.5px, but only at `min-width: 1024px`
 * ("desktop density"). A rem-based cap therefore means one width below 1024px
 * and a 9.4% smaller one above it — `max-w-6xl` is 1152px on a tablet and
 * 1044px on a monitor. That is a poor property for a rule whose whole job is to
 * be a predictable maximum, so every width here is in px: the number in the
 * class is the number on screen at every viewport. Rule 4's heights and gaps
 * are in px for the same reason. (The churches LIST screen carries a
 * `max-w-6xl` that silently has this split; a separate screen, and out of scope
 * here.)
 */

/**
 * Rule 1 — the page container. A FORM measure, not a page measure.
 *
 * 940px, centred. This was 1120px, derived from the admin shell: the shell
 * spends 275.5px on chrome (a 232px sidebar plus 21.75px of padding either
 * side), so on a 1440px monitor the content box is 1164.5px and 1120px sat
 * just under it. That is the right way to size a data-dense PAGE and the wrong
 * way to size a form, because it measures the room available rather than the
 * content that has to go in it.
 *
 * Measured: at 1440px the widest thing the form draws is the second column of
 * a two-column row, ending 995.4px into a 1089px content box — 93.6px of dead
 * space, on the busiest row. Most rows end at 900.5px, and the services row
 * caps at 760px, so the card's right edge was empty for most of its height.
 *
 * 940px is that content, measured rather than chosen: two `long` fields at
 * 440px plus the column gap, plus the card's own 1px border and `p-4` either
 * side. At the 16px rem base that is 904 + 34 = 938px, and at the 14.5px
 * desktop base 901.75 + 31 = 932.75px, so 940px fits both with the wider one
 * deciding. At 1440px the busiest row now ends 905.4px into a 909px content
 * box, and the dead space is gone.
 *
 * This narrows the Add Church card — the only thing this rule is on, in both
 * its Add and its Edit mode. That is the deliberate change, not a side effect.
 */
export const FORM_CONTAINER = 'sm:max-w-[940px] sm:mx-auto';

/**
 * Rule 2 — field widths sized to content.
 *
 * A field's width follows what it holds, not what its parent happens to be.
 * Three widths cover every input on the form; `group` is not a field width but
 * the cap for a row of fields that divides itself into fractions (the repeating
 * Weekly Services row), left whole so that adding and removing a service keeps
 * working exactly as it does now.
 *
 * Sizes are maximums applied to a field's wrapper — the input inside keeps its
 * `w-full` and simply stops growing past the cap.
 */
export const FIELD_WIDTH = {
  /** Codes and numbers: a zipcode, a house number, a latitude. */
  short: 'sm:max-w-[160px]',
  /** Single words and short names: a city, a state, a phone number. */
  medium: 'sm:max-w-[280px]',
  /** Names, streets, emails and URLs — the longest thing a person types here. */
  long: 'sm:max-w-[440px]',
  /** A ROW of fields, not a field: the repeating service row splits this 1/4, 1/4, 2/4. */
  group: 'sm:max-w-[760px]',
} as const;

export type FieldWidth = keyof typeof FIELD_WIDTH;

/** The enumerated set, for the test that pins how many distinct widths exist. */
export const FIELD_WIDTHS = Object.values(FIELD_WIDTH);

/**
 * Rule 3 — action buttons: full width on mobile, content width from `sm:` up.
 *
 * The submit button is a flex child that stretches on a phone, which is right
 * there and wrong on a desktop. `flex-none` sizes it to its label; the
 * horizontal padding comes with it because the button carries only `py-4`
 * today — it has never needed side padding while it was full width, and a
 * content-width button with none would hug its own text.
 */
export const ACTION_BUTTON = 'sm:flex-none sm:px-8';

/**
 * Rule 4 — desktop control density.
 *
 * The first three rules are all horizontal. None of them touches height, and
 * the founder's verdict on the Add Church form after they landed was that it
 * is "smaller than before but not small enough" — which is exactly what a
 * horizontal-only rule buys you.
 *
 * Measured in headless Chromium against the real compiled CSS and the real
 * admin shell, at 1440px on unmodified HEAD (0accd19):
 *
 *   text input        45.5px   (1px border ×2 + py-3 ×2 + a 21.75px line box)
 *   submit button     53px     (py-4 ×2 + a 24px icon line box)
 *   label             12.688px (`text-sm` at the 14.5px desktop rem base)
 *   label → control    7.25px  (`mb-2`)
 *   field → field     21.75px  (`space-y-6` / `gap-6`)
 *   section → section 36.25px  (`space-y-10`)
 *   whole form      1671.75px
 *
 * 36–40px is normal desktop density, so 45.5px is ~20% over the top of that
 * band — not the "about a third" the defect report estimated, and the submit
 * measures 53px rather than the ~51px predicted from `py-4` alone, because its
 * line box is the 24px Send icon and not the 21.75px text.
 *
 * ── Height, and why 38px ─────────────────────────────────────────────────────
 * The form already renders a 38.25px control today — the Weekly Services row,
 * which carries `px-3 py-2` instead of `px-4 py-3`. So the form has two
 * densities in it and 38px is the one it already demonstrates. Picking it means
 * the screen ends up with ONE control height rather than a new third value:
 * 40px is the top of the band and barely moves off 45.5px; 36px is the bottom
 * and starts to crowd a `rounded-xl` control, whose 12px radius eats the
 * vertical space a 12.688px label needs to sit clear of. The action button
 * takes 40px — two pixels of hierarchy over its fields, and enough to clear the
 * 24px icon it contains with 8px either side.
 *
 * Height is set explicitly and the vertical padding is zeroed with it, so the
 * box is honest: the number in the class is the number on screen, rather than a
 * padding sum that moves with the rem base.
 *
 * ── Rhythm, and why it is in the same rule ───────────────────────────────────
 * Shrinking controls without tightening the gaps leaves the form the same
 * length with smaller parts in it. The gaps are the larger half of the saving
 * here, so they are not a follow-up: 21.75px → 16px between fields, 36.25px →
 * 28px between sections. Sections stay clearly separated because the section
 * gap keeps its ratio to the field gap (1.75× against the 1.67× it had).
 *
 * Only the ROW gap of a field grid moves. A grid's column gap is horizontal —
 * Rule 2's business — and narrowing it would quietly change where a second
 * column starts, which is what the container measure below is derived from.
 *
 * ── Label size is deliberately untouched ─────────────────────────────────────
 * `text-sm` already resolves to 12.688px at the desktop rem base, and it
 * contributes 12.688px to a 45.5px control — it is not what makes the control
 * tall. The only step down in the named scale is `text-xs`, which computes to
 * 10.875px in this app and is under the 11px floor, so there is no move to make
 * here that is not the type scale's move (769 one-off sizes, a separate step).
 * The label's MARGIN moves instead, 7.25px → 6px: that is rhythm, not type.
 */
export const CONTROL_DENSITY = {
  /** A text-entry control — input, select, textarea. */
  control: 'sm:h-[38px] sm:py-0',
  /** An action button — the submit, and anything reading as a primary action. */
  action: 'sm:h-[40px] sm:py-0',
  /** A field's label to its own control. */
  labelGap: 'sm:mb-[6px]',
  /** Between the stacked fields of a section. */
  fieldGap: 'sm:space-y-[16px]',
  /** Between the ROWS of a field grid. The column gap is Rule 2's business. */
  rowGap: 'sm:gap-y-[16px]',
  /** Between one section of the form and the next. */
  sectionGap: 'sm:space-y-[28px]',
} as const;

export type ControlDensity = keyof typeof CONTROL_DENSITY;

/** The enumerated set, for the tests that pin the gate and the heights. */
export const CONTROL_DENSITY_TOKENS = Object.values(CONTROL_DENSITY);

/**
 * The same numbers as plain px, because a test that re-derives them from the
 * class strings is testing its own parser. Pinned against the tokens above by
 * "the density numbers and the density tokens agree".
 */
export const DENSITY_PX = {
  control: 38,
  action: 40,
  labelGap: 6,
  fieldGap: 16,
  rowGap: 16,
  sectionGap: 28,
} as const;

/**
 * The top of the desktop density band. Nothing this rule sizes may exceed it —
 * that is the cap the founder's complaint is actually about, and the one thing
 * here a later screen must not quietly raise.
 */
export const DESKTOP_CONTROL_MAX_PX = 40;
