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

/** A lesson gates on a quiz only when it actually carries questions. */
export const lessonHasQuiz = (lesson: Lesson): boolean =>
  Array.isArray(lesson.quiz) && lesson.quiz.length > 0;

/**
 * Whole-course completion — the SINGLE source of truth shared by the client
 * (which decides whether to offer the certificate) and the server (which
 * independently re-verifies before issuing one). Do not fork this: the whole
 * point of the certificate being un-fakeable is that both sides run the exact
 * same rule against the same data shape (completedLessons + quizAttempts).
 *
 * Complete ⇔ the course has lessons, every lesson id is in `completed`, and —
 * when `requireQuiz` is on — every lesson that carries a quiz has a passing
 * attempt (scored with the shared isQuizPassing threshold, never a trusted
 * `passed` flag, so a forged `{ passed: true }` with a failing score is caught).
 */
export const isCourseComplete = (
  course: Course,
  completed: Set<string>,
  quizAttempts: Record<string, QuizAttempt | undefined>
): boolean => {
  const lessons = getAllLessons(course);
  if (lessons.length === 0) return false;
  if (!lessons.every((l) => completed.has(l.id))) return false;
  if (course.requireQuiz) {
    for (const lesson of lessons) {
      if (!lessonHasQuiz(lesson)) continue;
      const attempt = quizAttempts[lesson.id];
      if (!attempt || !isQuizPassing(attempt.score, attempt.total)) return false;
    }
  }
  return true;
};
