import { Course, Lesson, Author, QuizAttempt } from "../types/course.types";

export const getAuthor = (id: string, authors: Author[]): Author | undefined => authors.find(a => a.id === id);

export const getAllLessons = (course: Course): Lesson[] => course.levels.flatMap(lv => lv.sections.flatMap(sec => sec.lessons));

export const getTotalDuration = (course: Course): string => {
  let mins = getAllLessons(course).reduce((a, l) => a + (parseInt(l.duration) || 0), 0);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
};

export const getTotalLessons = (course: Course): number => getAllLessons(course).length;

export const getProgress = (course: Course, completed: Set<string>): number => {
  const total = getTotalLessons(course);
  if (total === 0) return 0;
  return Math.round((getAllLessons(course).filter(l => completed.has(l.id)).length / total) * 100);
};

export function extractYouTubeId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : undefined;
}

// A quiz is "encouragement, not gatekeeping" by default — 70% is a lenient bar
// (on a 2-3 question quiz this rounds up to needing all correct anyway).
export const QUIZ_PASS_THRESHOLD = 0.7;

export const isQuizPassing = (score: number, total: number): boolean =>
  total > 0 && score / total >= QUIZ_PASS_THRESHOLD;

export interface CourseCompletionResult {
  /** All lessons completed, and — when required — every quiz-bearing lesson passed. */
  complete: boolean;
  /** Total number of lessons across every level/section. */
  totalLessons: number;
  /** Lesson ids not present in completedLessons. */
  missingLessons: string[];
  /** Quiz-bearing lesson ids without a passing attempt (only when requireQuiz). */
  unpassedQuizzes: string[];
}

/**
 * Server-authoritative course-completion check. Pure and deterministic so the
 * SAME logic backs the un-fakeable `/api/certificate` route (recomputed from
 * the authed user's own Firestore data) AND the client's "Download
 * certificate" affordance — a learner is never shown an action the server
 * would refuse.
 *
 * Complete ⇔ every lesson id is in `completedLessons`, and — only when
 * `course.requireQuiz` — every lesson that HAS a quiz also has a passing
 * attempt. The quiz bar reuses Step 3's exact `isQuizPassing` /
 * `QUIZ_PASS_THRESHOLD` (recomputed from the stored score/total rather than
 * trusting the persisted `passed` boolean). A course with zero lessons is
 * never "complete" — there is nothing to certify.
 */
export const verifyCourseCompletion = (
  course: Course,
  completedLessons: Iterable<string>,
  quizAttempts: Record<string, QuizAttempt | undefined> = {},
): CourseCompletionResult => {
  const lessons = getAllLessons(course);
  const done = completedLessons instanceof Set ? completedLessons : new Set(completedLessons);

  const missingLessons = lessons.filter((l) => !done.has(l.id)).map((l) => l.id);

  const unpassedQuizzes = course.requireQuiz
    ? lessons
        .filter((l) => Array.isArray(l.quiz) && l.quiz.length > 0)
        .filter((l) => {
          const a = quizAttempts[l.id];
          return !(a && isQuizPassing(a.score, a.total));
        })
        .map((l) => l.id)
    : [];

  const complete =
    lessons.length > 0 && missingLessons.length === 0 && unpassedQuizzes.length === 0;

  return { complete, totalLessons: lessons.length, missingLessons, unpassedQuizzes };
};
