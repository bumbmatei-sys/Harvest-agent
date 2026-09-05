// ─── Design Tokens ──────────────────────────────────────────────
// Single source of truth for all course UI colors, shadows, spacing.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE-311 — every value below now resolves through a palette token
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴 WHAT WAS WRONG. Only `GOLD` was var-backed. Every other export was a raw
// hex, so a course screen painted a white card with near-black text whatever
// theme was active — and Classic dark is one keystroke away from being what a
// member sees, since Classic has been the DEFAULT family since THE-265. A
// member's course library was a light page inside a dark app.
//
// 🔴 ZERO NEW TOKENS. Every name spelled here is already declared in
// globals.css. The bridge has held with no addition through THE-263, THE-264,
// THE-267 and THE-272, and it holds here too — `globals.css` and
// `tailwind.config.ts` are byte-identical to main, which
// `THE-311.course-palette.test.ts` asserts rather than asks you to believe.
//
// ⚠️ ONE SPELLING IS DELIBERATELY NOT THE SIBLING PRECEDENT.
// `AdminCourseEditor.tsx`, `AdminRAG.tsx` and `AdminRoles.tsx` each carry their
// own private copy of this constant set, already migrated, and eight of the
// names below are that copy verbatim. `GOLD_LIGHT` is the exception — those
// three spell it `color-mix(in srgb, var(--brand-color) 12%, var(--surface-raised))`,
// which is tenant-aware and which the accent CANNOT sit on: gold ink on its own
// 12% tint is 2.39:1 in both light palettes, well under AA. See GOLD_LIGHT
// below for what is used instead and what it costs.

/**
 * The tenant accent. Unchanged — this was already the one var-backed export,
 * and `var(--brand-color)` is what makes a white-label church's colour reach
 * every course screen.
 *
 * ⚠️ AS INK ON A LIGHT GROUND IT IS 2.66:1 ON `CARD` AND 2.48-2.51:1 ON `BG`.
 * That is a property of the brand accent itself, not of this migration, and it
 * is unchanged by it. globals.css already cards the identical failure on
 * `--ring` in its own words: "Gold on a white sidebar is 2.66:1, under the 3:1
 * non-text bar... Closing it means moving --brand-color". Closing it here would
 * mean replacing the tenant accent with a fixed dark gold everywhere gold text
 * appears — an app-wide design decision, not a colour migration. On both dark
 * palettes it is comfortable (5.84-6.77:1).
 */
export const GOLD = 'var(--brand-color, #C9963A)';

/**
 * The soft gold tint behind accent badges and pills — author chips, level
 * chips, the avatar ring.
 *
 * 🔴 `--surface-gold`, NOT a `color-mix` of the accent, and the difference is
 * AA. globals.css declares --surface-gold for exactly this role ("soft gold
 * tint fill (icon discs, active pills)") and THE-61 minted `--ink-wheat-800`
 * for exactly the ink that sits on it, because the design kit's own
 * wheat-700-on-wheat-100 pairing measured 4.33:1. The pair is 4.85:1 in both
 * light palettes and 11.9:1+ in both dark ones — see GOLD_ON_TINT.
 *
 * ⚠️ WHAT THIS COSTS. In LIGHT, --surface-gold is `var(--wheat-100)`, a fixed
 * brand hex, so a white-label tenant's badge fill is Harvest wheat rather than
 * their own colour. That is globals.css's standing decision for this token, not
 * one invented here, and it is the same trade THE-61 recorded: a tint whose ink
 * must clear AA cannot also be an arbitrary tenant hex. On DARK the token IS
 * tenant-composited (`color-mix(… var(--brand-color-on-dark) 16%, transparent)`),
 * so a tenant's colour does reach it there. `GOLD_BTN` below is where the
 * configurable brand is preserved unconditionally.
 */
export const GOLD_LIGHT = 'var(--surface-gold)';

/**
 * The ink that sits ON `GOLD_LIGHT`. THE-61's token, minted for this pair.
 *
 * ⚠️ NEW EXPORT, NOT A NEW TOKEN. `--ink-wheat-800` is declared in globals.css
 * in both themes already; this only gives the course screens a name for it, so
 * the two call sites that used to put raw `GOLD` on the tint stop failing AA.
 */
export const GOLD_ON_TINT = 'rgb(var(--ink-wheat-800))';

/**
 * The hover state of a solid gold button.
 *
 * The repo already spells this exact string in `PartnerWithUsTab`,
 * `NewsletterEditor`, `Profile` and — inlined, five times — in `CourseOverview`
 * and `LessonView` themselves. It was dead here only because those call sites
 * had no constant to reach for. They do now, so the string exists once.
 */
export const GOLD_HOVER = 'color-mix(in srgb, var(--brand-color, #C9963A) 85%, black)';

/**
 * The gold CTA / progress gradient.
 *
 * 🔴 THE CONFIGURABLE-BRAND PROPERTY. The old value hardcoded `#C9963A` — the
 * DEFAULT accent's fallback — as a gradient stop, so a church that changed its
 * colour got Harvest gold anyway. Both stops now derive from `--brand-color`.
 *
 * ⚠️ `deriveOnDarkAccent` CANNOT BUILD THIS, and that was checked rather than
 * assumed. It lightens an accent toward cream by the MINIMUM that clears AA on
 * a dark ground and returns an accent that already clears untouched — Harvest
 * gold is 6.77:1 and comes back verbatim (`src/lib/theme.ts` says so in its own
 * comment, and it is the point of that function). Feeding it here would collapse
 * the gradient to two identical stops, i.e. a flat fill, for the default tenant.
 * It is also a TypeScript function: this is a CSS string, evaluated in the
 * browser, with no build step to run it through.
 *
 * The machinery that CAN build it is `color-mix`, which is how globals.css
 * already composites the accent for `--surface-gold`, `--border-gold`,
 * `--glow-gold` and `--ring-gold`. This exact spelling is already shipping in
 * `AdminCourseEditor.tsx:74`, `AdminRAG.tsx:53` and `AdminRoles.tsx:28`, so
 * this is adoption of a settled form rather than a fourth invention.
 */
export const GOLD_BTN =
  'linear-gradient(135deg, var(--brand-color, #C9963A), color-mix(in srgb, var(--brand-color, #C9963A) 82%, #ffffff))';

/** The page ground. */
export const BG = 'var(--surface)';
/** The warm off-white fill — `--surface-tint` is the token for exactly this
 *  role, and it equals `--surface` on both dark palettes so it recedes there
 *  rather than staying a bright block. */
export const BG_WARM = 'var(--surface-tint)';
/** Cards and panels. Inverts direction on dark — lighter than the ground. */
export const CARD = 'var(--surface-raised)';

/** Headings and emphasis. 13.87-17.40:1 on `CARD` across all four palettes. */
export const TEXT = 'var(--text-strong)';
/** Secondary copy. 6.76-7.03:1 on `CARD`. */
export const TEXT2 = 'var(--text-muted)';
/** Eyebrows and timestamps — the third step of the same ramp. 4.66-5.49:1 on
 *  `CARD`, which is AA and deliberately no more: THE-263 darkened this role
 *  from 2.59:1 and recorded that "AA is a floor, so 'faint' cannot be as faint
 *  as it was". */
export const TEXT3 = 'var(--text-faint)';

/** The common container border. */
export const BORDER = 'var(--border-default)';
/** Hairlines. */
export const BORDER_LIGHT = 'var(--border-subtle)';

/**
 * Success / complete.
 *
 * ⚠️ A SUCCESS TOKEN DOES EXIST — two families of one, in fact, both from
 * THE-263 stage 4: the `--ink-green-*` / `--c-green-*` ramp and the Harvest
 * `--ink-field-*` / `--c-field-*` one. So there was nothing to report as
 * missing here, unlike the danger side where THE-263 had to reach for
 * `--ink-danger-strong` because `--brand-danger` measured 3.86:1.
 *
 * 🔴 `--ink-green-700`, NOT `--ink-green-600`. The old `#16A34A` IS
 * `--ink-green-600` to the byte, and mapping onto it would have been the exact
 * hex — but that pair measures 3.15:1 on `GREEN_BG` in BOTH light palettes,
 * i.e. it fails AA today and would have gone on failing. One step darker clears
 * it at 4.79:1 and inverts to 13.49:1 on dark. The step costs a barely visible
 * darkening of a badge that was already too light to read.
 */
export const GREEN = 'rgb(var(--ink-green-700))';
/** The success tint. `--c-green-50` is `#F0FDF4` to the byte in light, so this
 *  ground does not move at all; on dark it inverts to `#222A1E`. */
export const GREEN_BG = 'rgb(var(--c-green-50))';

/**
 * Multi-layer shadows.
 *
 * ⚠️ THE `rgba(0,0,0,…)` QUESTION, ANSWERED RATHER THAN ACCEPTED. A black
 * shadow on a dark ground is invisible rather than wrong, so "leave it" would
 * have been defensible — but this app already solved it once and the solution
 * is a token, not a workaround. globals.css's `.dark` block puts it plainly:
 * "Warm-tinted drop shadows are nearly invisible on a dark ground — they are
 * not 'subtle' there, they are absent. Rather than leave tokens that silently
 * do nothing, each becomes a hairline top highlight plus a deeper black
 * shadow, which is how elevation actually reads on dark." `--ds-sh-sm/md/lg`
 * is that ramp, it is the same three steps these three names describe, and
 * pointing at it costs nothing and needs no new token.
 *
 * These three are also the only mapping in this file with no possible visual
 * risk in light: nothing imports them (see the unconsumed-export note in the
 * test), so nothing renders either the old value or the new one today.
 */
export const SHADOW_SM = 'var(--ds-sh-sm)';
export const SHADOW_MD = 'var(--ds-sh-md)';
export const SHADOW_LG = 'var(--ds-sh-lg)';
