"use client";
import React, { useState } from "react";
import { Lesson, Level } from "../../types/course.types";
import { GOLD, GOLD_LIGHT } from "../../utils/course.constants";

/**
 * The level → section → lesson tree, with its expand/collapse behaviour.
 *
 * ⚠️ THERE IS EXACTLY ONE OF THESE, DELIBERATELY. It was lifted out of
 * CourseOverview when the read-only catalogue preview needed the same structure,
 * because a second copy of a curriculum renderer is precisely the thing that
 * drifts — and drift between two renderings of the same course is how a learner
 * ends up seeing a different set of lessons than the admin who adopted it.
 *
 * What differs between the two callers is the LESSON ROW, not the tree: the
 * member player's row carries completion state, a "current" marker and a
 * navigation handler; the preview's row carries a duration and an inline video.
 * Those are genuinely different things, so the row is a render prop and the
 * tree — the part with logic worth sharing — is not duplicated at all.
 *
 * `lessonNumber` is 1-based and counts across the WHOLE course, not per section,
 * matching the numbering CourseOverview has always shown.
 */
interface CourseCurriculumProps {
  levels: Level[] | undefined;
  renderLesson: (lesson: Lesson, lessonNumber: number) => React.ReactNode;
  /** Collapsed by default when false. Both callers currently open everything. */
  initiallyExpanded?: boolean;
}

export function CourseCurriculum({ levels, renderLesson, initiallyExpanded = true }: CourseCurriculumProps) {
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(
    new Set(initiallyExpanded ? (levels || []).map((l) => l.id) : []),
  );

  const toggleLevel = (id: string) => {
    const next = new Set(expandedLevels);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedLevels(next);
  };

  // Running 1-based index across every level/section, assigned as we walk so the
  // numbering never depends on a second traversal getting the same answer.
  let lessonNumber = 0;

  return (
    <>
      {levels?.map((level) => {
        const levelLessons = level.sections?.flatMap((s) => s.lessons || []) || [];
        const isExpanded = expandedLevels.has(level.id);

        return (
          <div key={level.id}>
            <div
              className="flex items-center justify-between py-3.5 cursor-pointer"
              onClick={() => toggleLevel(level.id)}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-bold"
                  style={{ background: GOLD_LIGHT, color: GOLD }}
                >
                  {level.title}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-[color:var(--text-faint)] font-medium">{levelLessons.length} lessons</span>
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A89A87" strokeWidth="2" strokeLinecap="round"
                  style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            </div>

            {level.sections?.map((section) => (
              <div key={section.id}>
                {isExpanded && section.title && (
                  <div className="text-xs font-bold text-[color:var(--text-faint)] uppercase tracking-wider pt-2 pb-1 pl-1">
                    {section.title}
                  </div>
                )}
                {section.lessons?.map((lesson) => {
                  // Numbered even while collapsed, so expanding a level never
                  // renumbers the lessons in the levels below it.
                  lessonNumber += 1;
                  const n = lessonNumber;
                  return isExpanded ? (
                    <React.Fragment key={lesson.id}>{renderLesson(lesson, n)}</React.Fragment>
                  ) : null;
                })}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
