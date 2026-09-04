"use client";
/**
 * THE-294 — "Course completion": how many courses this ministry's members have
 * actually finished.
 *
 * ─── 🔴 A SNAPSHOT. THERE IS NO SERIES AND THERE CANNOT BE ONE ──────────────
 *
 * The design asks for completions over time. `completedLessons` is a set of
 * lesson ids on the member document: it records WHAT is finished and never WHEN
 * anything was touched — `utils/course.utils.ts` says so in its own header,
 * where it explains why there is no `paused` status either. Nothing else
 * records a completion date: there is no `completedAt`, no completions
 * collection and no event. So the chart is not deferred, not empty and not
 * approximated — it is deleted, and this widget states plainly that what it
 * shows is a count taken now.
 *
 * ⚠️ `quizAttempts[lessonId].answeredAt` IS a timestamp, and using it would be
 * the tempting substitution. It exists only on quiz-bearing lessons of courses
 * that require a quiz, so it dates a small and unrepresentative subset of
 * completions and dates none of the rest. A trend drawn from it under the
 * heading "completions" would be a chart of a minority claiming to be all of
 * them — a proxy wearing the real metric's label, which is the exact move this
 * ticket forbids for reach and impressions.
 *
 * ─── What the number means, said on screen ──────────────────────────────────
 *
 * It counts (person, course) PAIRS, not people: one member who finished three
 * courses is three. Both readings are useful and they are different numbers, so
 * the widget gives both rather than leaving a reader to guess which one the big
 * figure is.
 *
 * 🔴 THE RULE IS `verifyCourseCompletion` AND NOTHING ELSE — the same function
 * `/api/certificate` recomputes before it will issue anything. So a completion
 * counted here is one the server would certify, and this widget cannot promise
 * more than a learner can actually collect.
 *
 * ─── 🔴 Aggregates only. Never a learner ────────────────────────────────────
 *
 * `CompletionSummary` has no field that could carry a uid, name or email, and
 * `toLearnerRow` reads neither. "Who finished the discipleship course" is a
 * real question and `AdminCourses` is where it is answered.
 */
import React from 'react';
import { GraduationCap } from 'lucide-react';

import { WidgetFrame, type WidgetState } from './WidgetFrame';
import { REASON, type CompletionSummary } from './content-data';

const count = (n: number) => n.toLocaleString();

const people = (n: number) => `${count(n)} ${n === 1 ? 'member' : 'members'}`;

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0" data-completion-figure={label}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function CourseCompletion({ summary, reason }: {
  readonly summary: CompletionSummary | null;
  readonly reason: string | null;
}) {
  const state: WidgetState = summary === null && reason === null
    ? { kind: 'loading' }
    : summary === null
      ? { kind: 'unavailable', reason: reason ?? REASON.readFailed }
      : { kind: 'ready' };

  return (
    <WidgetFrame
      title="Course completion"
      description="Courses finished, counted now. Nothing records when a course was completed, so there is no trend to draw."
      icon={GraduationCap}
      state={state}
      skeletonClassName="h-40 w-full"
    >
      <div className="space-y-3" data-course-completion>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Figure
            label="Courses completed"
            value={summary ? count(summary.completions) : ''}
          />
          <Figure
            label="Members who finished one"
            value={summary ? count(summary.learnersWithACompletion) : ''}
          />
          <Figure
            label="Courses available"
            value={summary ? count(summary.courses) : ''}
          />
        </div>

        {/*
          🔴 The denominators, so the headline figure is never read as the whole
          story. "12 completions" means something different across 20 members
          and across 2,000, and a widget that shows one without the other has
          left the reader to assume.
        */}
        {summary && (
          <p className="text-xs text-muted-foreground" data-completion-scope>
            {`Across ${people(summary.learners)} and ${count(summary.courses)} ${summary.courses === 1 ? 'course' : 'courses'}`}
            {summary.adoptedCourses > 0
              ? `, ${count(summary.adoptedCourses)} of them adopted from the shared library`
              : ''}
            {`. ${summary.coursesWithNoCompletion === 0
              ? 'Every course has been finished by at least one member.'
              : `${count(summary.coursesWithNoCompletion)} ${summary.coursesWithNoCompletion === 1 ? 'course has' : 'courses have'} not been finished by anyone yet.`}`}
          </p>
        )}

        {/*
          ⚠️ WHY THERE IS NO CHART, ON SCREEN. A reader who expected the design's
          "completions over time" should learn that it was declined and why,
          rather than assume it was forgotten — and the reason is a fact about
          the data they can check.
        */}
        <p className="text-xs text-muted-foreground" data-completion-snapshot-note>
          A member&apos;s progress is stored as the set of lessons they have
          finished, with no date on any of them, so this is a count taken now
          rather than a trend. It counts one member finishing three courses as
          three; the middle figure counts people.
        </p>
      </div>
    </WidgetFrame>
  );
}
