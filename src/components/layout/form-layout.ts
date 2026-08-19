/**
 * Desktop layout rules for forms — the container (a page measure and a form
 * measure), the field widths, the button, the density of a control, and the
 * two-column split of a form too long to read in one.
 *
 * Five rules, defined once. The app is responsive to 1024px and then stretches
 * with no maximum, so on a wide monitor the Add Church form rendered a 1517px
 * Google Maps field, a 748px "Church Name" for a value needing about 300, and a
 * 1517px submit button. That is not a typography or component problem — it is
 * these rules missing.
 *
 * Rules 1-3 are horizontal and landed together; they made the form narrower
 * without making it smaller. Rule 4 is the vertical half — height and rhythm —
 * and it is the one that can reach a phone if it is ever written carelessly.
 * Rule 5 is vertical too, but by composition rather than by density: a form
 * whose content is genuinely long stays long however tight its rows are, and
 * the only way left to halve its height is to put half of it beside the other
 * half (THE-187).
 *
 * ── Every rule here is gated at `sm:` and above, deliberately ────────────────
 * Below 640px the app is fine and must not move, so no rule in this file can
 * apply to a phone. That is a hard constraint, not a convention: adding an
 * unprefixed token here changes mobile rendering, and
 * ChurchEnrollment.desktop-layout.test.tsx pins the sub-640px class layer
 * against an extracted baseline precisely so that fails loudly. Rule 5 is
 * gated harder still, at `lg:` — see its own note for why.
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
 * Rule 1 — the container. TWO measures, because a page and a form want
 * different ones, and the difference is the whole point of this rule.
 *
 * ── 1a. The page measure — 1120px ────────────────────────────────────────────
 * Derived from the admin shell: the shell spends 275.5px on chrome (a 232px
 * sidebar plus 21.75px of padding either side), so on a 1440px monitor the
 * content box is 1164.5px and 1120px sits just under it. That is the right way
 * to size a data-dense PAGE — a screen whose job is to show as much at once as
 * the shell will allow. The course builder's curriculum tab is that (THE-179).
 *
 * ── 1b. The form measure — 940px ─────────────────────────────────────────────
 * A form is not a data-dense page, and sizing it against the room available
 * rather than the content going into it leaves the room over. Measured in
 * Chromium at 1440px, the widest thing the Add Church form draws is the second
 * column of a two-column row, ending 995.4px into a 1089px content box —
 * 93.6px of dead space on the busiest row. Most rows ended at 900.5px and the
 * services row caps at 760px, so the card's right edge was empty for most of
 * its height.
 *
 * 940px is that content, measured rather than chosen: two `long` fields at
 * 440px plus the column gap, plus the card's own 1px border and `p-4` either
 * side. At the 16px rem base that is 904 + 34 = 938px, and at the 14.5px
 * desktop base 901.75 + 31 = 932.75px, so 940px fits both with the wider one
 * deciding. At 1440px the busiest row now ends 905.4px into a 909px box.
 *
 * ── Why both, and not one ────────────────────────────────────────────────────
 * The form measure started life as a change to FORM_CONTAINER itself, on the
 * reading that the module had one consumer and it was a form. THE-179 landed
 * first and made the course builder a second consumer, where 1120px is
 * correct — so a single number would have silently taken 180px off a screen
 * that had just been laid out deliberately. Two named measures, each with its
 * own derivation, is what the distinction actually was.
 *
 * A screen picks one. Carrying both is a second, competing definition, which
 * is what "no width outside this module" exists to prevent.
 */
export const FORM_CONTAINER = 'sm:max-w-[1120px] sm:mx-auto';

/** Rule 1b — a form's own measure. See above; not interchangeable with 1a. */
export const FORM_MEASURE = 'sm:max-w-[940px] sm:mx-auto';

/** Both measures, for the tests that range over every rule in this module. */
export const CONTAINERS = [FORM_CONTAINER, FORM_MEASURE];

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
  /**
   * Between the COLUMNS of a reference grid — a block of read-only material
   * laid into columns so it stops running past the fold.
   *
   * ── Why this is not the column gap the rule above declines to own ───────────
   * The note on `rowGap` is about NARROWING a column gap that already exists on
   * a field grid: the Add Church form's `gap-6` decides where its second column
   * starts, and the 940px form measure is derived from that. Nothing here
   * touches it. This token is only ever spelled by a grid that had no columns at
   * all before — the CRM's Permission Reference, 24 items in one column, 1525px
   * tall inside a 900px viewport — so there is no existing second-column
   * position for it to move.
   *
   * 16px rather than a new number, for the reason `control` is 38px: the module
   * already has ONE gap, and a reference grid is not a new density. Reusing it
   * names an axis instead of minting a value.
   */
  columnGap: 'sm:gap-x-[16px]',
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
  columnGap: 16,
  sectionGap: 28,
} as const;

/**
 * The top of the desktop density band. Nothing this rule sizes may exceed it —
 * that is the cap the founder's complaint is actually about, and the one thing
 * here a later screen must not quietly raise.
 */
export const DESKTOP_CONTROL_MAX_PX = 40;

/**
 * Rule 5 — the desktop two-column split of a long form.
 *
 * Rules 1-4 make a form narrower and denser. They cannot make it SHORTER than
 * its content, and a form whose content is genuinely long stays long: the
 * course builder's Course Info tab measures 1229.81px tall at 1440px with
 * every rule above already applied, inside a viewport 1200px high. The
 * founder's verdict on it — "extremely big, I need it way smaller and split
 * into 2 screens" — is the vertical problem Rules 1-4 do not reach.
 *
 * ── Why `lg` and not `sm` or `xl` ────────────────────────────────────────────
 * `lg` (1024px) is where the admin shell itself becomes desktop: the sidebar
 * stops being a fixed bottom bar and takes 232px of the row, and globals.css
 * drops the rem base to 14.5px. Splitting anywhere else means the page
 * reflows at a width where nothing else about the shell changes.
 *
 * It is also the only choice that is safe against the non-monotonic available
 * width THE-184 found. Crossing 1024px the shell TAKES 275.5px away, so the
 * content box drops from 951px at 1023px to 708.5px at 1024px — the narrowest
 * a desktop column ever gets is therefore 346.25px, at exactly 1024px. That is
 * still WIDER than the 308px the same content already renders in at a 380px
 * phone, so no column can be narrower than a width the markup demonstrably
 * survives. Splitting at `xl` instead would put the cliff at 1280px, which is
 * exactly where THE-184 measured a 41px overflow.
 *
 * ── Explicit grouping, not auto-placement ────────────────────────────────────
 * The two children are column GROUPS, each a flex column of its own blocks, so
 * a block's top edge depends only on the blocks above it in its own group.
 * With auto-placement every block's top is tied to the tallest block in its
 * grid row instead, which is the failure THE-181 (PR 346) already paid for.
 *
 * ── The gap is Rule 4's, and it is Rule 4's NAME too ─────────────────────────
 * Both axes take the 16px Rule 4 already settled: `DENSITY_PX.rowGap` down the
 * stack and `DENSITY_PX.columnGap` across it — the same two names THE-181 gave
 * the CRM's reference grid. Rule 5 mints no third name for that 16px and no
 * `SPLIT_GAP_PX` of its own: this module's whole point is one name per value,
 * and a `lg:gap-[16px]` shorthand is those two axes written once. It is also
 * the gap the panel being split already used between its cards, so nothing
 * here introduces a length the module had not already derived.
 *
 * There is no `lg:` spelling of those two tokens because Rule 4 is a `sm:`
 * rule and must stay one — a `lg:`-gated twin of `columnGap` would be a second
 * definition of the same 16px, which is the thing being avoided. The NUMBER is
 * imported; only the gate differs, and the gate is Rule 5's own business.
 *
 * ── The consumer supplies the mobile-inert half ──────────────────────────────
 * Every token below is `lg:`-gated, so on a phone these two rules apply
 * nothing at all — which also means the wrapper elements they go on would
 * otherwise be extra boxes in the mobile layout. A consumer pairs them with an
 * unprefixed `contents` (`display: contents`, i.e. no box) so that below `lg`
 * the wrappers vanish and the blocks stay direct children of the original
 * parent. That token stays at the call site deliberately: it is a mechanism
 * for not disturbing mobile, not a desktop rule, and this module's invariant
 * is that nothing it exports can apply below 640px.
 */
export const COLUMN_SPLIT = 'lg:grid lg:grid-cols-2 lg:items-start lg:gap-[16px]';

/** One column of Rule 5's split — its own stack, so tops do not interlock. */
export const COLUMN_GROUP = 'lg:flex lg:flex-col lg:gap-[16px]';

/** Both halves of Rule 5, for the tests that range over it. */
export const COLUMN_RULES = [COLUMN_SPLIT, COLUMN_GROUP];

/**
 * The viewport Rule 5's split begins at. The gap has no constant of its own —
 * it is `DENSITY_PX.rowGap` / `DENSITY_PX.columnGap`, which are already 16.
 */
export const SPLIT_MIN_PX = 1024;

/**
 * Rule 6 — the reading measure, for a surface whose content is PROSE.
 *
 * Rules 1a and 1b size a page and a form. Neither sizes a Bible chapter, a chat
 * thread or a news feed: those are read rather than scanned or filled in, and
 * the thing that decides their width is the line, not the room available or the
 * widest field going into them. The member app had no name for that, so its
 * four reading surfaces each invented one and none of them agreed:
 *
 *   AllNews feed        `lg:max-w-2xl`      609.0px on a monitor
 *   Ask Harvest thread  `lg:max-w-3xl`      696.0px on a monitor
 *   Bible chapter       `lg:max-w-[760px]`  760.0px
 *   Messages thread     — none —            unbounded: 994px of prose at 1920px
 *
 * ── The rem trap, live ───────────────────────────────────────────────────────
 * Two of those three numbers are not the numbers their class names say. Tailwind
 * spells `max-w-2xl` as 42rem and `max-w-3xl` as 48rem, and globals.css trims
 * the rem base to 14.5px above 1024px — so they render 609px and 696px, not the
 * 672px and 768px the scale is documented as. This rule is in px, like every
 * other width in this module, for exactly that reason.
 *
 * ── 680px, and how it was arrived at ─────────────────────────────────────────
 * ⚠️ The usual typographic rule — 60-75 characters — does NOT yield a 640-720px
 * measure in THIS app, and assuming it does is how a reading measure gets set
 * twice as wide as intended. Measured in headless Chromium against the real
 * compiled CSS at 1440px, the member app's desktop body text runs 12.69px
 * (`text-sm` at the 14.5px base) to 13px, at 6.33-6.80px per character:
 *
 *   NewsTab post body      13px       6.489px/char    65ch = 422px
 *   AllNews post body      12.69px    6.326px/char    65ch = 411px
 *   Messages bubble        12.69px    6.326px/char    65ch = 411px
 *   Bible verse            17px CP    6.748px/char    65ch = 439px
 *
 * So 680px is 100-107 characters here, not 65. A true 65-character measure
 * would be ~420px, which is a TYPE decision — it only reads as too wide because
 * the body text is small — and the type scale is explicitly a separate
 * programme (769 one-off sizes). Narrowing four shipped screens to 420px on the
 * strength of a rule of thumb whose premise (a ~16px body) this app does not
 * meet is not a layout fix; it is a redesign, and it is not this rule's to make.
 *
 * What this rule DOES fix is that there were four answers and no name. 680px is
 * the one value that sits inside the band the member screens already occupy
 * (609-760) while moving each of them least — AllNews +71px, Ask Harvest -16px,
 * the Bible -80px, none of them more than 11% — and it gives the Messages
 * thread, which had no cap at all, the same measure as the other three.
 *
 * ── Why `lg:` and not `sm:`, unlike Rules 1-4 ────────────────────────────────
 * Rule 5's reason, and the same one: `lg` (1024px) is where the member shell
 * becomes desktop. Below it there is no sidebar, no history rail, no Bible book
 * nav and no conversation list — every reading surface here is a single
 * full-width column by design, and capping it at 640px would centre a narrow
 * column inside mobile chrome that is still full-bleed. It is also where all
 * four surfaces already gate their existing desktop layer, so this rule changes
 * nothing between 640px and 1023px, and nothing at all below 640px.
 *
 * Consequently this token is NOT in `CONTAINERS`: that array is the two `sm:`
 * measures, and two tests range over it asserting every token in it is gated at
 * `sm`. A reading measure is a third measure, not a third member of that pair.
 */
export const READING_MEASURE = 'lg:max-w-[680px] lg:mx-auto';

/** Rule 6's number as plain px, for the tests that must not re-parse the class. */
export const READING_MEASURE_PX = 680;

/** The viewport Rule 6 begins at — the same `lg` cliff Rule 5 splits on. */
export const READING_MIN_PX = SPLIT_MIN_PX;
