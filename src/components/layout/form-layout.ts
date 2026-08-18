/**
 * Desktop layout rules for forms — the container, the field widths, the button.
 *
 * Three rules, defined once. The app is responsive to 1024px and then stretches
 * with no maximum, so on a wide monitor the Add Church form rendered a 1517px
 * Google Maps field, a 748px "Church Name" for a value needing about 300, and a
 * 1517px submit button. That is not a typography or component problem — it is
 * these three rules missing.
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
 * class is the number on screen at every viewport. (The churches LIST screen
 * carries a `max-w-6xl` that silently has this split; a separate screen, and
 * out of scope here.)
 */

/**
 * Rule 1 — the page container.
 *
 * 1120px, centred. The admin shell spends 275.5px on chrome (a 232px sidebar
 * plus 21.75px of padding either side), so on a 1440px monitor the content box
 * is 1164.5px: a cap has to sit below that to do anything at the width the
 * defect was actually reported at. 1120px clears the 1024px breakpoint
 * comfortably, so the container never engages before the sidebar layout does,
 * and leaves a two-column form ~545px per column before the field rules narrow
 * it further.
 */
export const FORM_CONTAINER = 'sm:max-w-[1120px] sm:mx-auto';

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
