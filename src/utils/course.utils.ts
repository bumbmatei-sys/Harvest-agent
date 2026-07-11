import { Course, Lesson, Author } from "../types/course.types";

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
