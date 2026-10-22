import type { Level, Lesson } from '@/types/course.types';
import { videoUrlOf } from '@/lib/courses/lessons';
import type { ProductLesson } from '@/types/course-product.types';

/** Subcollection of courses/{id} holding one document per lesson, guarded by rules. */
export const LESSON_CONTENT_COLLECTION = 'lessonContent';

/**
 * The ONLY lesson fields that stay on the tenant-readable course doc: what the
 * landing page and the lesson rail draw. Everything else on a lesson is
 * content and moves to the guarded subcollection. This is an allow-list on
 * purpose: a field added to lessons later (attachments, a download url) is
 * locked by default instead of leaking until someone remembers to list it.
 */
export const OUTLINE_LESSON_FIELDS = ['id', 'title', 'duration', 'authorId', 'type', 'hasVideo'] as const;

export type LessonContent = Record<string, unknown>;
export type ContentByLesson = Record<string, LessonContent>;

const OUTLINE = new Set<string>(OUTLINE_LESSON_FIELDS);

const isRealQuestion = (q: { q?: unknown; options?: unknown }): boolean => typeof q.q === 'string' && Array.isArray(q.options);

/**
 * Splits a course's levels into the public outline and the guarded content.
 * Pure. The outline keeps a quiz STUB per question (its id only: no text, no
 * options, no answers) so "this lesson has a quiz" stays answerable from the
 * course doc, and quiz-gated completion (admin dashboard, certificate route,
 * verifyCourseCompletion) still requires the quiz without any access to it.
 * A lesson written before lesson types has no `type` and must stay that way (the player reads its summary and outline as
 * the legacy text); `hasVideo` lets the landing page still tell it is a video.
 */
export function splitCourseContent(levels: readonly Level[]): { levels: Level[]; content: ContentByLesson } {
  const content: ContentByLesson = {};
  const outlineLevels = levels.map((level) => ({
    ...level,
    sections: level.sections.map((section) => ({
      ...section,
      lessons: section.lessons.map((lesson) => {
        const full = lesson as ProductLesson;
        const outline: Record<string, unknown> = {};
        const body: LessonContent = {};
        for (const [key, value] of Object.entries(full)) {
          if (value === undefined) continue;
          if (OUTLINE.has(key)) outline[key] = value;
          else body[key] = value;
        }
        if (!full.type && videoUrlOf(full)) outline.hasVideo = true;
        else delete outline.hasVideo;
        if (Array.isArray(full.quiz) && full.quiz.length > 0) {
          outline.quiz = full.quiz.map((q) => ({ id: q.id }));
          // A stub that came back from an un-hydrated outline is not the quiz.
          const real = full.quiz.filter(isRealQuestion);
          if (real.length > 0) body.quiz = real;
          else delete body.quiz;
        }
        content[full.id] = body;
        return outline as unknown as Lesson;
      }),
    })),
  }));
  return { levels: outlineLevels, content };
}

/**
 * Lays fetched content back over an outline. A lesson with no content document
 * keeps whatever it carries inline, so a course written before the split keeps
 * working until it is migrated or re-saved.
 */
export function mergeCourseContent<T extends { levels: Level[] }>(course: T, content: ContentByLesson): T {
  return {
    ...course,
    levels: course.levels.map((level) => ({
      ...level,
      sections: level.sections.map((section) => ({
        ...section,
        lessons: section.lessons.map((lesson) => {
          const c = content[lesson.id];
          return c ? ({ ...lesson, ...c } as Lesson) : lesson;
        }),
      })),
    })),
  };
}

/**
 * True when any lesson still carries content inline: any field beyond the
 * outline, except a quiz made only of id stubs. This is what the migration asks
 * to decide whether a course is already in the split layout.
 */
export function hasInlineContent(levels: readonly Level[]): boolean {
  return levels.some((l) => l.sections.some((s) => s.lessons.some((lesson) =>
    Object.entries(lesson).some(([key, value]) => {
      if (OUTLINE.has(key) || value === undefined) return false;
      if (key === 'quiz') return Array.isArray(value) && value.some((q) => isRealQuestion(q as { q?: unknown; options?: unknown }));
      return true;
    }),
  )));
}
