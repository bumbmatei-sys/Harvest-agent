"use client";
import React from 'react';
import { Star } from 'lucide-react';
import {
  TAP_TARGET,
  POINT_SIZE_CLASSES,
  pointsFor,
  normaliseAnswer,
  type ScaleRange,
} from './rating-scale';

/**
 * THE-366 — the control behind the `rating` and `scale` field types.
 *
 * 🔴 NOT a `ui/` primitive. `src/components/ui` holds 43 installed shadcn
 * primitives and the inventory is byte-pinned at that count by several suites
 * with no append path for a 44th; `accordion` and `rating` are both absent from
 * it and this ticket does not change that. This is a FORM FIELD built from what
 * is already here — `lucide-react`'s `Star`, which 180 files already import,
 * and plain buttons — so it adds no dependency and no primitive.
 *
 * ── The tap targets ─────────────────────────────────────────────────────────
 *
 * 🔴 A five-star row is FIVE targets in a row and is the easiest thing in the
 * product to ship too small. Every point is at least {@link TAP_TARGET.belowSm}
 * px square below `sm` and {@link TAP_TARGET.smAndUp} px at `sm` and up. The
 * floors are spelled as arbitrary values from the shared constants rather than
 * as a Tailwind size step so the guard can measure the same numbers the control
 * renders.
 *
 * ── Unanswered ──────────────────────────────────────────────────────────────
 *
 * 🔴 `value` is `number | undefined` and starts UNDEFINED. There is no zero
 * state: an untouched control reports nothing at all, rather than a 0 that
 * would land in the CSV as a real rating. Choosing the point already chosen
 * CLEARS the answer back to undefined, which is the only way a respondent can
 * undo a mis-tap on a question they did not mean to answer.
 */

export interface RatingScaleInputProps {
  id: string;
  type: 'rating' | 'scale';
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  range?: Partial<ScaleRange>;
  /** The poles of a `scale`. Ignored for a `rating`, which has no numerals. */
  minLabel?: string;
  maxLabel?: string;
  /** Accent for the chosen points. A token or a tenant's own colour — never a
   *  literal in this file. */
  accent?: string;
  disabled?: boolean;
}

/**
 * 🔴 LITERAL, NOT INTERPOLATED. Tailwind's JIT scans source for whole class
 * names: a template-built `min-w-[${n}px]` is never seen, so the rule is never
 * generated and the target silently has no floor at all. These four are spelled
 * out, and the guard asserts they agree with {@link TAP_TARGET} rather than
 * trusting that they still do.
 *
 * 44px below `sm`, 38px from `sm` up. The literal lives in `rating-scale.ts`
 * beside the numbers it must agree with.
 */
const POINT_SIZE = POINT_SIZE_CLASSES;

const RatingScaleInput: React.FC<RatingScaleInputProps> = ({
  id, type, value, onChange, range, minLabel, maxLabel, accent, disabled,
}) => {
  const points = pointsFor(type, range);
  const chosen = normaliseAnswer(value, type, range);

  const pick = (point: number) => {
    if (disabled) return;
    // Re-tapping the chosen point clears it: the respondent gets back to
    // "unanswered", which is a different fact from "the lowest score".
    onChange(chosen === point ? undefined : point);
  };

  return (
    <div data-rating-scale={type} data-rating-scale-answered={chosen === undefined ? 'false' : 'true'}>
      <div
        role="radiogroup"
        aria-label={type === 'rating' ? 'Rating' : 'Scale'}
        className="flex flex-wrap items-center gap-1"
      >
        {points.map((point) => {
          const active = chosen !== undefined && (type === 'rating' ? point <= chosen : point === chosen);
          return (
            <button
              key={point}
              type="button"
              role="radio"
              aria-checked={chosen === point}
              aria-label={String(point)}
              data-rating-scale-point={point}
              disabled={disabled}
              onClick={() => pick(point)}
              style={{ color: active ? accent : undefined }}
              className={
                'inline-flex items-center justify-center rounded-xl border text-sm font-medium ' +
                `${POINT_SIZE} ` +
                (active ? 'border-transparent ' : 'border-line text-muted ') +
                'disabled:opacity-50'
              }
            >
              {type === 'rating'
                ? <Star size={20} fill={active ? 'currentColor' : 'none'} aria-hidden="true" />
                : point}
            </button>
          );
        })}
      </div>

      {type === 'scale' && (minLabel || maxLabel) && (
        <div className="mt-1.5 flex justify-between text-xs text-faint">
          <span>{minLabel ?? ''}</span>
          <span>{maxLabel ?? ''}</span>
        </div>
      )}

      {/* The submitted value. Absent — not 0 — while the question is
          unanswered, so a skipped question never reaches the CSV as a rating. */}
      <input type="hidden" name={id} value={chosen === undefined ? '' : String(chosen)} readOnly />
    </div>
  );
};

export default RatingScaleInput;
