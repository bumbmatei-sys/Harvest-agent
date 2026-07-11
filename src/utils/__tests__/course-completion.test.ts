import { describe, it, expect } from 'vitest';
import { isCourseComplete, lessonHasQuiz } from '../course.utils';
import type { Course, Lesson, QuizAttempt } from '../../types/course.types';

// Shared completion rule used by BOTH the client (offer the cert) and the
// server (/api/certificate, re-verify before issuing). These tests pin the
// invariants the un-fakeable cert relies on.

function lesson(id: string, quiz = false): Lesson {
  return {
    id, title: id, duration: '5', summary: '', authorId: 'a1',
    ...(quiz ? { quiz: [{ id: 'q', q: 'Q?', options: [{ id: 'o', text: 'A', correct: true }] }] } : {}),
  };
}

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 'c1', title: 'C', description: '', category: '', thumbnail: '', featured: false,
    authorIds: [], issueCertificate: true, requireQuiz: false,
    levels: [{ id: 'lv1', title: 'L', sections: [{ id: 's1', title: '', lessons: [lesson('a'), lesson('b')] }] }],
    ...overrides,
  };
}

const pass: QuizAttempt = { score: 1, total: 1, passed: true, answeredAt: '' };
const fail: QuizAttempt = { score: 0, total: 1, passed: false, answeredAt: '' };

describe('lessonHasQuiz', () => {
  it('is true only when the lesson carries questions', () => {
    expect(lessonHasQuiz(lesson('a', true))).toBe(true);
    expect(lessonHasQuiz(lesson('a', false))).toBe(false);
    expect(lessonHasQuiz({ ...lesson('a'), quiz: [] })).toBe(false);
  });
});

describe('isCourseComplete', () => {
  it('false for a course with no lessons (cannot complete an empty course)', () => {
    expect(isCourseComplete(course({ levels: [] }), new Set(), {})).toBe(false);
  });

  it('false when any lesson is missing from completed', () => {
    expect(isCourseComplete(course(), new Set(['a']), {})).toBe(false);
  });

  it('true when all lessons complete and quizzes are not required', () => {
    expect(isCourseComplete(course(), new Set(['a', 'b']), {})).toBe(true);
  });

  it('with requireQuiz, blocks when a quiz lesson has no passing attempt', () => {
    const c = course({ requireQuiz: true, levels: [{ id: 'lv1', title: 'L', sections: [{ id: 's1', title: '', lessons: [lesson('a', true), lesson('b')] }] }] });
    expect(isCourseComplete(c, new Set(['a', 'b']), {})).toBe(false);
    expect(isCourseComplete(c, new Set(['a', 'b']), { a: fail })).toBe(false);
    expect(isCourseComplete(c, new Set(['a', 'b']), { a: pass })).toBe(true);
  });

  it('recomputes the pass threshold — a forged passed=true with a failing score is rejected', () => {
    const c = course({ requireQuiz: true, levels: [{ id: 'lv1', title: 'L', sections: [{ id: 's1', title: '', lessons: [lesson('a', true)] }] }] });
    const forged: QuizAttempt = { score: 0, total: 1, passed: true, answeredAt: '' };
    expect(isCourseComplete(c, new Set(['a']), { a: forged })).toBe(false);
  });

  it('a lesson without a quiz needs no attempt even under requireQuiz', () => {
    const c = course({ requireQuiz: true }); // both lessons quizless
    expect(isCourseComplete(c, new Set(['a', 'b']), {})).toBe(true);
  });
});
