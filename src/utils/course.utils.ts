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

/**
 * A member's standing on one course, as the data can actually answer it.
 *
 * THREE values, and the count is the whole design. `completedLessons` is a set
 * of lesson ids and nothing else — it records WHAT is finished, never WHEN
 * anything was touched — so the only questions it can answer are "all of them",
 * "some of them" and "none of them".
 *
 * 🔴 There is deliberately no `paused`. A member who stopped halfway through
 * and one who never opened the course are IDENTICAL in this data: both have the
 * same lesson ids missing, and distinguishing them needs a `lastOpenedAt` that
 * `course.types.ts` does not carry and no write in the app produces. Inventing
 * one to fill a badge would put a field in every user document, and a write on
 * every course open, to make a cosmetic claim the app cannot substantiate.
 *
 * ⚠️ `not-started` is NOT that missing state under another name. It asserts
 * only "no lesson is complete", which is true of both members above and is a
 * fact this data holds. Progress here is lesson-completion and not watch-time
 * (`youtubeId` is a video SOURCE, not a meter), so under the app's own model a
 * member with nothing completed has not started — whenever they last looked.
 */
export type CourseStatus = 'not-started' | 'ongoing' | 'done';

/**
 * The card's status, derived from the SAME completeness check the certificate
 * route and CourseOverview run.
 *
 * 🔴 `done` is `verifyCourseCompletion(...).complete` and nothing else. A
 * second "is it finished" rule written here would be a real bug rather than a
 * duplication: certificates hang off that function, so a card that decided
 * completeness its own way could badge a course Done that the server would
 * refuse to certify.
 *
 * That also means `done` inherits the quiz gate — on a `requireQuiz` course a
 * member with every lesson ticked is `ongoing` until their attempts pass —
 * which is the safe direction to be wrong in: the badge never promises more
 * than the certificate will deliver.
 */
export const getCourseStatus = (
  course: Course,
  completedLessons: Iterable<string>,
  quizAttempts: Record<string, QuizAttempt | undefined> = {},
): CourseStatus => {
  const { complete, totalLessons, missingLessons } = verifyCourseCompletion(
    course,
    completedLessons,
    quizAttempts,
  );
  if (complete) return 'done';
  // Some lesson is done but not all of them. A course with no lessons has
  // nothing to start, so it falls through to `not-started` rather than
  // reporting progress it cannot have.
  return missingLessons.length < totalLessons ? 'ongoing' : 'not-started';
};

/** The badge's words, one per status. */
export const COURSE_STATUS_LABEL: Record<CourseStatus, string> = {
  'not-started': 'Not started',
  ongoing: 'Ongoing',
  done: 'Done',
};

/**
 * The CTA's words, one per status — the card's action follows the badge.
 *
 * All three open the same course; only the promise differs, because "Continue"
 * on a course never begun and "Start" on a finished one are both lies about
 * where the member is.
 */
export const COURSE_STATUS_CTA: Record<CourseStatus, string> = {
  'not-started': 'Start course',
  ongoing: 'Continue',
  done: 'Review',
};
