import { describe, it, expect } from 'vitest';
import type { Level } from '@/types/course.types';
import type { ProductLesson } from '@/types/course-product.types';
import {
  addLesson, addSection, continueTarget, emptyLesson, lessonProblem, lessonTypeOf, lessonsOf, moveLesson,
  positionsOf, publishReadiness, removeLesson, sectionProgress,
} from '../lessons';

const text = (id: string, title = 'A lesson', body = '<p>Some words</p>'): ProductLesson => ({ ...emptyLesson('text'), id, title, body });
const video = (id: string, url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'): ProductLesson => ({
  ...emptyLesson('video'), id, title: 'Watch', youtubeUrl: url,
});
const levels = (...lessons: ProductLesson[]): Level[] => [{ id: 'l1', title: 'Course', sections: [{ id: 's1', title: 'One', lessons }] }];
const course = (lv: Level[], extra = {}) => ({ title: 'Faith basics', levels: lv, ...extra });

describe('lessonProblem', () => {
  it('accepts a text lesson with words and no video', () => {
    expect(lessonProblem(text('a'))).toBeNull();
  });
  it('rejects a text lesson with an empty body', () => {
    expect(lessonProblem(text('a', 'T', '<p></p>'))).toBe('needs some text');
  });
  it('requires a video link for Video and Video + text, and a body for neither of those', () => {
    expect(lessonProblem({ ...video('v'), youtubeUrl: '' })).toBe('needs a video link');
    expect(lessonProblem({ ...video('v'), youtubeUrl: 'https://example.com/x' })).toBe('needs a valid YouTube link');
    expect(lessonProblem({ ...video('v'), type: 'video-text', body: '' })).toBeNull();
    expect(lessonProblem(video('v'))).toBeNull();
  });
  it('requires a title on every type', () => {
    expect(lessonProblem({ ...text('a'), title: '  ' })).toBe('needs a title');
  });
});

describe('lessonTypeOf', () => {
  it('reads a legacy lesson with a video as Video and without one as Text', () => {
    const legacy = { id: 'x', title: 'Old', duration: '', authorId: '', summary: '' } as ProductLesson;
    expect(lessonTypeOf(legacy)).toBe('text');
    expect(lessonTypeOf({ ...legacy, youtubeId: 'dQw4w9WgXcQ' })).toBe('video');
    expect(lessonTypeOf({ ...legacy, type: 'video-text' })).toBe('video-text');
  });
});

describe('publishReadiness — a course with no video at all can publish', () => {
  it('is ready when every lesson is text', () => {
    const r = publishReadiness(course(levels(text('a'), text('b'))));
    expect(r.ready).toBe(true);
    expect(r.items.every((i) => i.done)).toBe(true);
  });

  it('never names a video as a requirement when no lesson is a video', () => {
    const r = publishReadiness(course(levels(text('a'))));
    expect(JSON.stringify(r.items).toLowerCase()).not.toContain('video');
  });

  it('is not ready with no lessons, no title, or an incomplete lesson, and says which', () => {
    expect(publishReadiness(course([])).ready).toBe(false);
    expect(publishReadiness({ ...course(levels(text('a'))), title: ' ' }).ready).toBe(false);
    const r = publishReadiness(course(levels(text('a'), text('b', 'Empty', ''))));
    expect(r.ready).toBe(false);
    expect(r.items.find((i) => i.id === 'lesson-content')?.detail).toContain('Empty needs some text');
  });

  it('warns, without blocking, when a restricted course has nobody who can open it', () => {
    const r = publishReadiness(course(levels(text('a')), { accessMode: 'restricted' }));
    expect(r.ready).toBe(true);
    expect(r.items.find((i) => i.id === 'access')).toMatchObject({ done: false, blocking: false });
  });

  it('counts an attached community as access', () => {
    const r = publishReadiness(course(levels(text('a')), { accessMode: 'restricted', communityIds: ['c1'] }));
    expect(r.items.find((i) => i.id === 'access')?.done).toBe(true);
  });

  it('a mixed course needs the video lesson to be valid but still publishes', () => {
    expect(publishReadiness(course(levels(text('a'), video('v')))).ready).toBe(true);
    expect(publishReadiness(course(levels(text('a'), video('v', '')))).ready).toBe(false);
  });
});

describe('tree edits and progress', () => {
  it('adds a section to the last level and a lesson to that section', () => {
    let lv = levels(text('a'));
    lv = addSection(lv, 'Week 2');
    const added = lv[0].sections[1];
    expect(added.title).toBe('Week 2');
    lv = addLesson(lv, added.id, text('b'));
    expect(lessonsOf(lv).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('moves and removes lessons inside their own section', () => {
    let lv = levels(text('a'), text('b'), text('c'));
    lv = moveLesson(lv, 'c', -1);
    expect(lessonsOf(lv).map((l) => l.id)).toEqual(['a', 'c', 'b']);
    expect(lessonsOf(moveLesson(lv, 'a', -1)).map((l) => l.id)).toEqual(['a', 'c', 'b']);
    expect(lessonsOf(removeLesson(lv, 'c')).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('numbers lessons across sections and picks the first unfinished one to continue', () => {
    const lv: Level[] = [{ id: 'l', title: 'C', sections: [
      { id: 's1', title: 'A', lessons: [text('a'), text('b')] },
      { id: 's2', title: 'B', lessons: [text('c')] },
    ] }];
    expect(positionsOf(lv).map((p) => [p.lesson.id, p.sectionIndex, p.index])).toEqual([['a', 0, 0], ['b', 0, 1], ['c', 1, 2]]);
    expect(continueTarget(lv, new Set(['a']))?.id).toBe('b');
    expect(continueTarget(lv, new Set(['a', 'b', 'c']))?.id).toBe('a');
    expect(sectionProgress(lv[0].sections[0], new Set(['a']))).toEqual({ done: 1, total: 2 });
  });
});
