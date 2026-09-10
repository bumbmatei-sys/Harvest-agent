import { tsMillis, type TimestampLike } from './query-helpers';

/**
 * THE-347 - rendering a Firestore date field without handing React an object.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The crash this module exists to make impossible ─────────────────────────
 *
 * `/admin/blog` went down with minified React error #31 - "Objects are not
 * valid as a React child (found: object with keys {seconds, nanoseconds})" -
 * and `{seconds, nanoseconds}` is a Firestore Timestamp. The route it took is
 * worth writing down, because the bug was not in the renderer:
 *
 *   1. `AdminBlog` declared `createdAt: string` and cast `doc.data()` straight
 *      to that interface, so TypeScript asserted a string and checked nothing.
 *   2. One of the collection's three writers wrote `serverTimestamp()`, so some
 *      documents genuinely hold a Timestamp OBJECT on that field.
 *   3. The screen's own `formatDate` did `new Date(value)` - Invalid Date for
 *      an object - and `Intl.DateTimeFormat.format(Invalid Date)` THROWS
 * RangeError rather than returning "Invalid Date".
 *   4. Its `catch` returned `dateString`: THE INPUT, UNCHANGED. The Timestamp
 *      object went straight into JSX and the error boundary took the screen.
 *
 * STEP 4 IS THE DEFECT. A formatter that returns its input on failure is the
 * Silent-Failure Rule in its most literal form - "a default value that hides an
 * error converts a loud failure into a quiet lie" - except this lie was loud
 * enough to take the whole screen with it. A formatter whose declared return is
 * `string` must return a string on EVERY path, including the ones it did not
 * anticipate, or its type is a lie too.
 *
 * ── Why an em-dash and not an empty string, and not a throw ─────────────────
 *
 * Three answers were available for a value that cannot be parsed:
 *
 * RETURN THE INPUT - always wrong, and is precisely this bug. It is the only
 *   answer that can put a non-string into JSX.
 *
 * THROW - honest, and far too loud. A missing or malformed date on ONE row of
 *   a list is not a reason to take the list down, and the four uncaught
 *   `Intl.format` helpers elsewhere in this repo already do exactly that: they
 *   would have crashed the screen too, just with a RangeError instead of #31.
 *
 * EMPTY STRING - invisible. A reader cannot tell a post with no date from a
 *   post whose date is broken, so the failure is hidden rather than handled.
 * That is the same quiet lie one layer along.
 *
 * SO: A VISIBLE PLACEHOLDER. The slot is still occupied, the row still reads
 * as a row, and a date that did not survive says so. `NewsletterCampaigns`
 * already answers an unparseable date with this exact character, so this is the
 * repo's existing convention rather than a new one invented here.
 *
 * ── Why it is built on `tsMillis` ───────────────────────────────────────────
 *
 * `tsMillis` already resolves every representation this repo stores - a real
 * `Timestamp` via `toMillis()`, a plain `{seconds}` object as it arrives over
 * the wire or through a JSON round trip, an epoch number, and an ISO string -
 * and `sortByTime` has been sorting mixed data correctly with it all along.
 * Reusing it means the formatter and the sort can never disagree about what a
 * value MEANS, which is a class of bug that a second parser would introduce on
 * its first day.
 */

/**
 * Every shape a Firestore date field is actually observed to hold: a Timestamp,
 * a `{seconds}` object, an epoch number, an ISO string, or nothing at all.
 *
 * Declaring a field with this type is not pessimism, it is accuracy. A field
 * typed `string` that Firestore fills with a Timestamp makes every consumer
 * downstream wrong while the compiler reports no error at all.
 */
export type FirestoreDate = TimestampLike | string | number;

/**
 * What a date that cannot be parsed renders as. A VISIBLE placeholder: the
 * reader can see that something is missing instead of quietly reading past it.
 */
export const UNPARSEABLE_DATE = '—';

/** The day-precision format the blog screens show. */
export const BLOG_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

/**
 * Format a Firestore date field for display. TOTAL BY CONSTRUCTION: every path
 * returns a string, and no path can return the value it was given.
 *
 * The final `typeof` check is not defensive clutter. It is the one assertion
 * that makes the signature true no matter what a future edit does to the lines
 * above it, and it is the assertion whose absence caused this ticket.
 */
export function formatFirestoreDate(
  value: FirestoreDate,
  options: Intl.DateTimeFormatOptions = BLOG_DATE_FORMAT,
  locale: string = 'en-US',
): string {
  // `tsMillis` answers MAX_SAFE_INTEGER for null, for a pending server write and
  // for a string it cannot parse. That is beyond the maximum representable date
  // (8.64e15), so `new Date` of it is an Invalid Date and falls through below -
  // no sentinel comparison needed, and no risk of one drifting out of step.
  // `tsMillis` CALLS `toMillis()` when the value carries one, so resolving a
  // value can itself throw - a Timestamp-shaped object whose accessor is a
  // getter that blows up, or a stub from a half-finished mock. A formatter that
  // throws while trying to be safe is the same outage by another route, so the
  // resolve is inside the guard rather than beside it.
  let ms: unknown;
  try {
    ms = tsMillis(value as never);
  } catch {
    return UNPARSEABLE_DATE;
  }
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return UNPARSEABLE_DATE;

  const date = new Date(ms as number);
  if (Number.isNaN(date.getTime())) return UNPARSEABLE_DATE;

  try {
    const formatted = new Intl.DateTimeFormat(locale, options).format(date);
    return typeof formatted === 'string' ? formatted : UNPARSEABLE_DATE;
  } catch {
    // An out-of-range date, or an option set this runtime will not accept.
    // Whatever it was, it is NOT a reason to hand the caller back its input.
    return UNPARSEABLE_DATE;
  }
}
