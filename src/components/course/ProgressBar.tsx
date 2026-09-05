import React from "react";
import { BORDER, GOLD_BTN } from "../../utils/course.constants";

/**
 * ⚠️ THE-311 — `ui/progress` WAS CONSIDERED AND NOT ADOPTED. Recorded here
 * rather than left silent, because THE-282 named this component as the thing
 * `course.constants.ts` blocked, and that blocker is now gone: `BORDER` and
 * `GOLD_BTN` resolve through the palette in all four families.
 *
 * Four reasons it still is not the primitive, and any one of them is enough:
 *
 *  1. 🔴 GEOMETRY. `ProgressTrack` is a fixed `h-1` (4px). This takes a
 *     `height` prop defaulting to 5. Adopting moves a pixel, and THE-311 is a
 *     colour migration whose whole non-negotiable is that nothing moves.
 *  2. 🔴 THE GRADIENT. The primitive's indicator is a flat `bg-primary`. The
 *     bar here is a two-stop gradient, which is the one thing THE-311 spent its
 *     `GOLD_BTN` work making tenant-configurable. Adopting would throw it away.
 *  3. `progress` paints `bg-primary` on `bg-muted` at 2.30:1 in light. THE-290
 *     accepted that ONLY where "every figure the bar depicts is written out as
 *     a number beside it". This component draws a bare bar and takes no label.
 *  4. It has NO CALL SITES. Nothing in `src` renders it (THE-282's card keeps
 *     its own 3px bar), so adopting would add a name to THE-272's closed
 *     adopter list — a list whose entire purpose is that each entry is a
 *     deliberate, visible decision — in exchange for nothing on screen.
 *
 * So THE-272's `THE_290_PROGRESS_ADOPTERS` is UNCHANGED by THE-311, and
 * `THE-311.course-palette.test.ts` asserts that it is.
 */
interface ProgressBarProps {
  pct: number;
  height?: number;
}

export function ProgressBar({ pct, height = 5 }: ProgressBarProps) {
  return (
    <div style={{ background: BORDER, borderRadius: 99, height, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: GOLD_BTN, borderRadius: 99, transition: "width 0.4s" }} />
    </div>
  );
}
