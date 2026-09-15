/**
 * THE-366 — the `rating` and `scale` field types.
 *
 * Everything that decides a NUMBER lives here rather than in a component,
 * for the same reason `form-answers.ts` says it: the numbers are the part
 * that can be quietly wrong, and one of them is wrong in a way a church
 * would not notice until it had already acted on it.
 *
 * ── TWO TYPES, ONE STORED SHAPE ─────────────────────────────────────────────
 *
 * 🔴 `rating` and `scale` are two BUILDER types and one ANSWER shape. They are
 * not one control with options, because the affordances genuinely differ:
 *
 *   `rating` — 1..5, drawn as stars. Five is the convention and the control
 *       carries no numerals; the glyph IS the scale. It reads as a verdict.
 *   `scale`  — a configurable run of numbered points with optional labels at
 *       each end ("Strongly disagree" … "Strongly agree"). It reads as a
 *       position between two poles, which is why the poles are nameable and
 *       the numerals are on screen.
 *
 * A single control with a `max` option would have to draw ten stars for a 1-10
 * agreement scale, which is the thing a church sees once and does not ship. So
 * the BUILDER offers two, and the STORAGE, the CSV column and the per-question
 * aggregate are identical for both — a plain number. Two affordances, one
 * number, no second code path for the half that matters.
 *
 * ── AN UNANSWERED RATING IS ABSENT, NEVER ZERO ──────────────────────────────
 *
 * 🔴 The defect this module exists to prevent. A zero IS a rating. If an
 * untouched control submits 0, every unanswered row lands in the column as a
 * real value, and the mean of a conference feedback form is dragged toward
 * zero by people who simply skipped the question — a church concludes their
 * conference went badly on the strength of the rows where nobody answered.
 *
 * So there is no zero anywhere in the answer path:
 *   - the control's value starts as `undefined`, not 0;
 *   - {@link normaliseAnswer} returns `undefined` for anything not a real
 *     point, INCLUDING 0, '' and null;
 *   - {@link toCsvCell} renders `undefined` as the empty string;
 *   - {@link isPointAnswered} is what the aggregate counts, and 0 is not
 *     answered.
 *
 * A `scale` MAY legitimately start at 0 (a 0-10 NPS-shaped question), and that
 * is why "unanswered" is expressed as ABSENCE rather than as the value 0: the
 * two are different facts and a sentinel value cannot tell them apart. When a
 * field's own range includes 0, a chosen 0 is a real answer and survives every
 * step below; it is only the ABSENT answer that is empty.
 */

/** The fixed run of a `rating`. Five stars, and the control carries no numerals. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** What a `scale` defaults to when the builder has not said otherwise. */
export const SCALE_DEFAULT_MIN = 1;
export const SCALE_DEFAULT_MAX = 10;

/** The widest run the builder will offer. Beyond this the points stop being
 *  distinguishable targets on a phone, which is the whole point of the floor
 *  in {@link TAP_TARGET}. */
export const SCALE_LIMIT_MIN = 0;
export const SCALE_LIMIT_MAX = 10;

/**
 * 🔴 The tap-target floor, as one exported pair so the control and its guard
 * read the same numbers.
 *
 * A five-star row is FIVE targets side by side and is the easiest thing in the
 * product to ship too small. Below `sm` every point is at least 44px square;
 * at `sm` and up the rule-4 floor of 38px applies.
 */
export const TAP_TARGET = { belowSm: 44, smAndUp: 38 } as const;

/**
 * 🔴 The tap-target classes, spelled as ONE literal string.
 *
 * Tailwind's JIT scans source for whole class names, so a template-built
 * `min-w-[${n}px]` is never seen and the rule is never generated — the target
 * would silently have no floor at all. They therefore cannot be derived from
 * {@link TAP_TARGET} at runtime; instead the guard asserts the two agree, which
 * is what makes this pair a single source rather than two that drift.
 */
export const POINT_SIZE_CLASSES =
  'min-w-[44px] min-h-[44px] sm:min-w-[38px] sm:min-h-[38px]';

export interface ScaleRange {
  min: number;
  max: number;
}

/**
 * The points a field offers, in the order a respondent sees them.
 *
 * A `rating` is always 1..5. A `scale` reads its range from the field and is
 * clamped to the limits above — a form authored before those limits, or edited
 * by hand, cannot make the control draw 40 targets.
 */
export const pointsFor = (type: 'rating' | 'scale', range?: Partial<ScaleRange>): number[] => {
  if (type === 'rating') {
    return Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);
  }
  const { min, max } = clampRange(range);
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
};

/** A `scale`'s range, defaulted and clamped, and never inverted. */
export const clampRange = (range?: Partial<ScaleRange>): ScaleRange => {
  const rawMin = Number.isFinite(range?.min) ? Math.round(range!.min!) : SCALE_DEFAULT_MIN;
  const rawMax = Number.isFinite(range?.max) ? Math.round(range!.max!) : SCALE_DEFAULT_MAX;
  const min = Math.min(Math.max(rawMin, SCALE_LIMIT_MIN), SCALE_LIMIT_MAX);
  const max = Math.min(Math.max(rawMax, SCALE_LIMIT_MIN), SCALE_LIMIT_MAX);
  // An inverted or single-point range is a form authored wrong, not a reason to
  // render nothing: fall back to the default run rather than an empty control.
  if (max <= min) return { min: SCALE_DEFAULT_MIN, max: SCALE_DEFAULT_MAX };
  return { min, max };
};

/**
 * 🔴 The one gate every answer passes through.
 *
 * Returns the number when the value is a real point of THIS field, and
 * `undefined` for everything else — absent, null, '', a non-numeric string, a
 * fractional value, or a number outside the field's own run. 0 is returned
 * only when 0 is genuinely one of the field's points.
 */
export const normaliseAnswer = (
  value: unknown,
  type: 'rating' | 'scale',
  range?: Partial<ScaleRange>,
): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  return pointsFor(type, range).includes(n) ? n : undefined;
};

/** Whether a normalised answer counts towards the aggregate. Absence does not;
 *  a chosen 0 on a 0-N scale does. */
export const isPointAnswered = (point: number | undefined): point is number => point !== undefined;

/**
 * 🔴 The CSV cell for one rating or scale answer.
 *
 * A NUMBER, never a label: `4`, not "Good", not "4 of 5", not four stars. The
 * per-question view is where a reading goes; a spreadsheet column is where
 * arithmetic goes, and a label cannot be averaged. An UNANSWERED question is
 * the empty string — never 0, and never a dash or "N/A", both of which are
 * text that would poison the same column an admin is about to average.
 */
export const toCsvCell = (
  value: unknown,
  type: 'rating' | 'scale',
  range?: Partial<ScaleRange>,
): string => {
  const point = normaliseAnswer(value, type, range);
  return point === undefined ? '' : String(point);
};

export interface PointCount {
  point: number;
  count: number;
  /** count / answered, 0-100. 0 when nobody answered — never NaN. */
  percent: number;
}

export interface ScaleAggregate {
  /** How many PEOPLE gave a real answer. Skipped questions are not in here. */
  answered: number;
  /** One row per point the field offers, including the points nobody chose. */
  points: PointCount[];
  /**
   * The mean over ANSWERED responses only, or `null` when nobody answered.
   *
   * 🔴 `null` rather than 0. A mean of 0 over an unanswered question is the
   * same lie as an unanswered row exporting as 0, one level up, and it is the
   * figure a church would read off a screen and repeat out loud.
   */
  mean: number | null;
}

/**
 * Aggregate one rating or scale question.
 *
 * Every point the field offers gets a row even when nobody chose it — a gap in
 * a distribution is information ("nobody gave it below a 4"), and dropping the
 * empty rows would silently rescale the chart.
 */
export const aggregateScale = (
  values: unknown[],
  type: 'rating' | 'scale',
  range?: Partial<ScaleRange>,
): ScaleAggregate => {
  const points = pointsFor(type, range);
  const given = values
    .map((v) => normaliseAnswer(v, type, range))
    .filter(isPointAnswered);
  const answered = given.length;
  const counts = new Map<number, number>(points.map((p) => [p, 0]));
  for (const point of given) counts.set(point, (counts.get(point) ?? 0) + 1);
  return {
    answered,
    points: points.map((point) => {
      const count = counts.get(point) ?? 0;
      return { point, count, percent: answered === 0 ? 0 : (count / answered) * 100 };
    }),
    mean: answered === 0 ? null : given.reduce((a, b) => a + b, 0) / answered,
  };
};
