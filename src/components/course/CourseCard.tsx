"use client";
import React from "react";
import { Course, Author, QuizAttempt } from "../../types/course.types";
import {
  getAllLessons,
  getCourseStatus,
  COURSE_STATUS_LABEL,
  COURSE_STATUS_CTA,
  type CourseStatus,
} from "../../utils/course.utils";
import { GOLD } from "../../utils/course.constants";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

/** Every tappable thing on this card, in px. Named, not interpolated. */
export const TAP_TARGET_PX = 44;

/**
 * The status badge's ground, as a three-step ramp on ONE hue.
 *
 * 🔴 Every value is var-backed and therefore palette-correct: `surface-*` and
 * `line`/`muted` are the app's neutral ramp, and the tinted middle step is the
 * `color-mix(… var(--brand-color) …)` idiom the slash menu and the editor
 * toolbar already use for "current". No hex is spelled here, so all four
 * palettes resolve from one declaration.
 */
const STATUS_BADGE: Record<CourseStatus, string> = {
  "not-started": "bg-surface-sunken text-muted border-line",
  ongoing:
    "bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)] text-gold border-transparent",
  done: "bg-gold text-white border-transparent",
};

interface CourseCardProps {
  course: Course;
  authors: Author[];
  onClick: () => void;
  completed?: Set<string>;
  /**
   * The member's quiz attempts, for the `requireQuiz` half of completeness.
   *
   * Optional, and today no caller supplies it — `CoursePage` holds the attempts
   * but hands `CourseLibrary` only `completed`. Absent, a `requireQuiz` course
   * reads `ongoing` at 100% of lessons rather than `done`, which is the
   * conservative direction: the badge under-promises rather than claiming a
   * completion the certificate route would refuse.
   */
  quizAttempts?: Record<string, QuizAttempt | undefined>;
}

export function CourseCard({ course, authors, onClick, completed, quizAttempts }: CourseCardProps) {
  const allLessons = getAllLessons(course);
  const totalLessons = allLessons.length;
  const completedCount = completed
    ? allLessons.filter((l) => completed.has(l.id)).length
    : 0;
  const progress = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  /**
   * 🔴 The SINGLE definition of "finished", borrowed rather than restated:
   * `getCourseStatus` is a thin read of `verifyCourseCompletion`, which is the
   * same function `/api/certificate` and `CourseOverview` run. This card
   * decides nothing about completeness on its own.
   */
  const status = getCourseStatus(course, completed ?? new Set<string>(), quizAttempts ?? {});

  // Resolve author names
  const courseAuthors = course.authorIds
    ?.map((id) => authors.find((a) => a.id === id))
    .filter(Boolean) as Author[];
  const authorName = courseAuthors?.[0]?.name || "";

  // Total duration
  const totalMinutes = allLessons.reduce((sum, l) => {
    const match = l.duration?.match(/(\d+)/);
    return sum + (match ? parseInt(match[1]) : 0);
  }, 0);
  const durationStr = totalMinutes >= 60
    ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
    : `${totalMinutes}m`;

  return (
    <div
      data-course-card
      data-course-status={status}
      onClick={onClick}
      className="flex flex-col gap-3 p-3.5 bg-surface-raised border border-line rounded-xl cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 mb-3"
    >
      <div className="flex gap-3.5">
        {/* Thumbnail */}
        <div className="w-[100px] h-[75px] rounded-lg overflow-hidden flex-shrink-0 bg-surface-sunken">
          {course.thumbnail ? (
            <img
              src={course.thumbnail}
              alt={course.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-faint">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="m8 21 4-4 4 4" />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {/* Category · status. Wraps rather than overflows at 380px. */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: GOLD }}
            >
              {course.category || "Course"}
            </span>
            <Badge
              data-course-status-badge={status}
              className={`h-5 px-2 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[status]}`}
            >
              {COURSE_STATUS_LABEL[status]}
            </Badge>
          </div>
          <div className="text-[15px] font-bold tracking-tight leading-snug mb-1 line-clamp-2">
            {course.title}
          </div>
          <div className="flex items-center gap-3 text-xs text-faint font-medium flex-wrap">
            {totalLessons > 0 && (
              <span className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>
                {totalLessons} lessons
              </span>
            )}
            {totalMinutes > 0 && (
              <span className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                {durationStr}
              </span>
            )}
            {authorName && <span>{authorName}</span>}
          </div>
        </div>
      </div>

      {/*
        Progress and the action, on their own row.

        ⚠️ Below the thumbnail rather than beside the title, because at 380px
        the info column is ~215px wide and a 44px button taken out of it would
        leave the title two words per line. A full-width row costs 44px of
        height and nothing else.
      */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-[11px] font-medium text-faint mb-1">
            <span>{completedCount} of {totalLessons} lessons</span>
            <span className="tabular-nums" data-course-progress={progress}>{progress}%</span>
          </div>
          {/*
            The card's own bar, kept.

            🔴 STILL NOT `course/ProgressBar.tsx`, but no longer for THE-282's
            reason. THE-282 refused it because it painted `BORDER` (#e5e7eb) and
            `GOLD_BTN` (a two-hex gradient) straight from `course.constants.ts`,
            so it could not follow a palette and stayed light grey on the dark
            themes. THE-311 fixed exactly that — those two now resolve to
            `--border-default` and a `--brand-color` gradient, in all four
            palettes.

            What still rules it out is GEOMETRY, not colour: this bar is 3px and
            `ProgressBar`'s height defaults to 5, and THE-282's measured layout
            suite pins this card's boxes. Swapping it is a layout change and
            belongs to a layout ticket. The bar here is `bg-surface-sunken`
            under `--brand-color` and resolves in all four.
          */}
          <div className="h-[3px] bg-surface-sunken rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, background: GOLD }}
            />
          </div>
        </div>

        {/*
          🔴 The height is the literal 44 the constant names, not an
          interpolation of it: Tailwind scans source text, so `h-[${…}px]`
          emits no rule and the button silently collapses to the variant's h-8.
          `min-w-` so a longer label widens it rather than clipping.
        */}
        <Button
          data-course-cta={status}
          className="h-[44px] min-w-[44px] shrink-0 px-4 text-xs font-bold"
          onClick={(e) => {
            // The whole card is clickable; without this the same course opens twice.
            e.stopPropagation();
            onClick();
          }}
        >
          {COURSE_STATUS_CTA[status]}
        </Button>
      </div>
    </div>
  );
}
