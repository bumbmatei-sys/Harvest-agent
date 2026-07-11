import { describe, it, expect } from 'vitest';
import { verifyCourseCompletion } from '../course.utils';
import type { Course, Level, QuizAttempt } from '../../types/course.types';

// ── Fixtures ───────────────────────────────────────────────────────────────

function lesson(id: string, withQuiz = false) {
  return {
    id, title: `Lesson ${id}`, duration: '10', summary: '', authorId: '', youtubeUrl: '',
    ...(withQuiz
      ? { quiz: [{ id: `${id}-q1`, q: 'Q?', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }] }] }
      : {}),
  };
}

function makeCourse(overrides?: Partial<Course>): Course {
  const levels: Level[] = [
    { id: 'lv1', title: 'L1', sections: [
      { id: 's1', title: 'A', lessons: [lesson('l1'), lesson('l2', true)] },
      { id: 's2', title: 'B', lessons: [lesson('l3')] },
    ] },
  ];
  return {
    id: 'c1', title: 'Course', description: '', category: '', thumbnail: '',
    featured: false, authorIds: [], levels, issueCertificate: true, ...overrides,
  };
}

const pass: QuizAttempt = { score: 1, total: 1, passed: true, answeredAt: '2026-01-01T00:00:00Z' };
const fail: QuizAttempt = { score: 0, total: 1, passed: false, answeredAt: '2026-01-01T00:00:00Z' };
const ALL = ['l1', 'l2', 'l3'];

describe('verifyCourseCompletion', () => {
  it('is complete when every lesson is done and quizzes are not required', () => {
    const r = verifyCourseCompletion(makeCourse({ requireQuiz: false }), ALL, {});
    expect(r.complete).toBe(true);
    expect(r.missingLessons).toEqual([]);
    expect(r.unpassedQuizzes).toEqual([]);
  });

  it('is INCOMPLETE when a lesson is missing', () => {
    const r = verifyCourseCompletion(makeCourse(), ['l1', 'l2'], { l2: pass });
    expect(r.complete).toBe(false);
    expect(r.missingLessons).toEqual(['l3']);
  });

  it('with requireQuiz, an un-passed quiz lesson blocks completion even if marked done', () => {
    const r = verifyCourseCompletion(makeCourse({ requireQuiz: true }), ALL, { l2: fail });
    expect(r.complete).toBe(false);
    expect(r.unpassedQuizzes).toEqual(['l2']);
  });

  it('with requireQuiz, a passing quiz attempt satisfies the gate', () => {
    const r = verifyCourseCompletion(makeCourse({ requireQuiz: true }), ALL, { l2: pass });
    expect(r.complete).toBe(true);
  });

  it('recomputes the pass bar from score/total — a lying passed:true with a failing score is rejected', () => {
    const lying: QuizAttempt = { score: 0, total: 1, passed: true, answeredAt: '2026-01-01T00:00:00Z' };
    const r = verifyCourseCompletion(makeCourse({ requireQuiz: true }), ALL, { l2: lying });
    expect(r.complete).toBe(false);
    expect(r.unpassedQuizzes).toEqual(['l2']);
  });

  it('with requireQuiz, a missing attempt for a quiz lesson blocks completion', () => {
    const r = verifyCourseCompletion(makeCourse({ requireQuiz: true }), ALL, {});
    expect(r.complete).toBe(false);
    expect(r.unpassedQuizzes).toEqual(['l2']);
  });

  it('without requireQuiz, quiz lessons never block (only lesson completion counts)', () => {
    const r = verifyCourseCompletion(makeCourse({ requireQuiz: false }), ALL, { l2: fail });
    expect(r.complete).toBe(true);
  });

  it('a zero-lesson course is never complete', () => {
    const r = verifyCourseCompletion(makeCourse({ levels: [] }), [], {});
    expect(r.complete).toBe(false);
    expect(r.totalLessons).toBe(0);
  });

  it('accepts an array or a Set for completedLessons', () => {
    expect(verifyCourseCompletion(makeCourse({ requireQuiz: false }), new Set(ALL), {}).complete).toBe(true);
    expect(verifyCourseCompletion(makeCourse({ requireQuiz: false }), ALL, {}).complete).toBe(true);
  });
});
