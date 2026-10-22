import { describe, expect, it } from 'vitest';
import { OUTLINE_LESSON_FIELDS, hasInlineContent, mergeCourseContent, splitCourseContent } from '../content';
import { lessonHtml, lessonTypeOf } from '../lessons';
import { verifyCourseCompletion } from '@/utils/course.utils';
import type { Course, Level } from '@/types/course.types';
import type { ProductLesson } from '@/types/course-product.types';

const levelsOf = (...lessons: Record<string, unknown>[]): Level[] =>
  [{ id: 'l', title: 'Course', sections: [{ id: 's', title: 'Start', lessons: lessons as never }] }];
const only = (levels: Level[]) => levels[0].sections[0].lessons as unknown as Record<string, unknown>[];

const full = {
  id: 'a', title: 'Why we pray', duration: '5', authorId: 'au1', type: 'video-text', summary: 's',
  body: '<p>b</p>', youtubeUrl: 'https://youtu.be/AAAAAAAAAAA', youtubeId: 'AAAAAAAAAAA', sources: 'src', scripture: 'John 1',
  teacherNote: 'note', outline: [{ id: 'o', title: 't', text: 'x' }], quiz: [{ id: 'q', q: '?', options: [{ id: 'o', text: 'x', correct: true }] }],
  attachments: [{ url: 'https://files.example/a.pdf' }], futureField: 'anything',
};

describe('splitCourseContent', () => {
  it('keeps only the allow-listed outline fields on the course document', () => {
    const { levels } = splitCourseContent(levelsOf(full));
    expect(Object.keys(only(levels)[0]).sort()).toEqual(['authorId', 'duration', 'id', 'quiz', 'title', 'type']);
    for (const k of Object.keys(only(levels)[0]).filter((k) => k !== 'quiz')) expect(OUTLINE_LESSON_FIELDS as readonly string[]).toContain(k);
  });

  it('leaves a quiz stub per question on the outline: ids only, no text, options or answers', () => {
    const { levels } = splitCourseContent(levelsOf(full));
    expect(only(levels)[0].quiz).toEqual([{ id: 'q' }]);
    expect(JSON.stringify(only(levels)[0])).not.toMatch(/correct|options|"q":/);
  });

  it('sends every other field to content, including ones this build has never heard of', () => {
    const { content } = splitCourseContent(levelsOf(full));
    expect(Object.keys(content.a).sort()).toEqual([
      'attachments', 'body', 'futureField', 'outline', 'quiz', 'scripture', 'sources', 'summary', 'teacherNote', 'youtubeId', 'youtubeUrl',
    ]);
    expect(content.a).not.toHaveProperty('title');
  });

  it('round-trips through merge to the original lessons', () => {
    const levels = levelsOf(full);
    const { levels: outline, content } = splitCourseContent(levels);
    const merged = mergeCourseContent({ levels: outline }, content);
    expect(only(merged.levels)[0]).toEqual(full);
  });

  it('writes no quiz stub for a lesson with no or an empty quiz', () => {
    const { levels } = splitCourseContent(levelsOf({ ...full, id: 'a', quiz: [] }, { id: 'b', title: 'B', duration: '' }));
    expect(only(levels)[0].quiz).toBeUndefined();
    expect(only(levels)[1]).not.toHaveProperty('quiz');
  });

  it('never saves a stub as if it were the quiz (an un-hydrated outline must not overwrite the real quiz)', () => {
    const { levels } = splitCourseContent(levelsOf(full));
    const again = splitCourseContent(levels);
    expect(again.content.a).not.toHaveProperty('quiz');
    expect(only(again.levels)[0].quiz).toEqual([{ id: 'q' }]);
  });

  it('leaves an untyped legacy lesson untyped, so its summary still renders, and keeps it recognisable as a video', () => {
    const legacy = { id: 'x', title: 'Old', duration: '', authorId: '', summary: 'Hello', youtubeUrl: 'https://youtu.be/AAAAAAAAAAA' };
    const { levels, content } = splitCourseContent(levelsOf(legacy));
    const lesson = only(levels)[0] as unknown as ProductLesson;
    expect(lesson).not.toHaveProperty('type');
    expect(lessonTypeOf(lesson)).toBe('video');
    const merged = only(mergeCourseContent({ levels }, content).levels)[0] as unknown as ProductLesson;
    expect(lessonHtml(merged)).toContain('Hello');
  });

  it('does not mutate its input', () => {
    const levels = levelsOf({ ...full });
    const before = JSON.stringify(levels);
    splitCourseContent(levels);
    expect(JSON.stringify(levels)).toBe(before);
  });
});

describe('mergeCourseContent', () => {
  it('lays content over the matching lesson only', () => {
    const outline = levelsOf({ id: 'a', title: 'A' }, { id: 'b', title: 'B' });
    const merged = mergeCourseContent({ levels: outline }, { a: { body: '<p>x</p>' } });
    expect(only(merged.levels)[0]).toMatchObject({ id: 'a', title: 'A', body: '<p>x</p>' });
    expect(only(merged.levels)[1]).toEqual({ id: 'b', title: 'B' });
  });

  it('falls back to inline content when a lesson has no content document (courses written before the split)', () => {
    const legacy = levelsOf({ id: 'a', title: 'A', body: '<p>inline</p>' });
    expect(only(mergeCourseContent({ levels: legacy }, {}).levels)[0].body).toBe('<p>inline</p>');
  });

  it('content wins over a stale inline copy', () => {
    const legacy = levelsOf({ id: 'a', title: 'A', body: '<p>old</p>' });
    expect(only(mergeCourseContent({ levels: legacy }, { a: { body: '<p>new</p>' } }).levels)[0].body).toBe('<p>new</p>');
  });
});

describe('hasInlineContent', () => {
  it('is true for a legacy lesson that still carries a body or a real quiz', () => {
    expect(hasInlineContent(levelsOf({ id: 'a', title: 'A', body: '<p>x</p>' }))).toBe(true);
    expect(hasInlineContent(levelsOf({ id: 'a', title: 'A', quiz: full.quiz }))).toBe(true);
  });
  it('is false for an outline, quiz stubs included', () => {
    expect(hasInlineContent(splitCourseContent(levelsOf(full)).levels)).toBe(false);
  });
});

describe('quiz-gated completion survives the split', () => {
  it('a course whose quiz moved out of the doc still requires the quiz, for the dashboard and the certificate route', () => {
    const { levels } = splitCourseContent(levelsOf(full));
    const outline = { id: 'c', requireQuiz: true, levels } as unknown as Course;
    const r = verifyCourseCompletion(outline, ['a'], {});
    expect(r.complete).toBe(false);
    expect(r.unpassedQuizzes).toEqual(['a']);
    expect(verifyCourseCompletion(outline, ['a'], { a: { score: 1, total: 1, passed: true, answeredAt: '' } }).complete).toBe(true);
  });
});
