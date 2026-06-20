import { describe, it, expect } from 'vitest';
import {
  getAllLessons,
  getTotalLessons,
  getTotalDuration,
  getProgress,
  extractYouTubeId,
} from '../course.utils';
import type { Course, Level } from '../../types/course.types';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeLesson(id: string, duration = '10') {
  return { id, title: `Lesson ${id}`, duration, summary: '', authorId: '', youtubeUrl: '' };
}

function makeCourse(overrides?: Partial<Course>): Course {
  const levels: Level[] = [
    {
      id: 'lv1',
      title: 'Level 1',
      sections: [
        { id: 's1', title: 'Section A', lessons: [makeLesson('l1', '15'), makeLesson('l2', '20')] },
        { id: 's2', title: 'Section B', lessons: [makeLesson('l3', '10')] },
      ],
    },
    {
      id: 'lv2',
      title: 'Level 2',
      sections: [
        { id: 's3', title: 'Section C', lessons: [makeLesson('l4', '30'), makeLesson('l5', '5')] },
      ],
    },
  ];
  return {
    id: 'course1',
    title: 'Test Course',
    description: 'desc',
    category: 'Faith',
    thumbnail: '',
    featured: false,
    authorIds: [],
    levels,
    ...overrides,
  };
}

// ── getAllLessons ───────────────────────────────────────────────────────────

describe('getAllLessons', () => {
  it('returns a flat list of all lessons across levels and sections', () => {
    const lessons = getAllLessons(makeCourse());
    expect(lessons).toHaveLength(5);
    expect(lessons.map(l => l.id)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
  });

  it('returns empty array for a course with no levels', () => {
    expect(getAllLessons(makeCourse({ levels: [] }))).toHaveLength(0);
  });

  it('returns empty array for a course with empty sections', () => {
    const course = makeCourse({
      levels: [{ id: 'lv1', title: 'L1', sections: [{ id: 's1', title: 'S1', lessons: [] }] }],
    });
    expect(getAllLessons(course)).toHaveLength(0);
  });
});

// ── getTotalLessons ────────────────────────────────────────────────────────

describe('getTotalLessons', () => {
  it('counts all lessons correctly', () => {
    expect(getTotalLessons(makeCourse())).toBe(5);
  });

  it('returns 0 for empty course', () => {
    expect(getTotalLessons(makeCourse({ levels: [] }))).toBe(0);
  });
});

// ── getProgress ───────────────────────────────────────────────────────────

describe('getProgress', () => {
  it('returns 0 when no lessons are completed', () => {
    expect(getProgress(makeCourse(), new Set())).toBe(0);
  });

  it('returns 100 when all lessons are completed', () => {
    expect(getProgress(makeCourse(), new Set(['l1', 'l2', 'l3', 'l4', 'l5']))).toBe(100);
  });

  it('returns 40 when 2 of 5 lessons are completed', () => {
    expect(getProgress(makeCourse(), new Set(['l1', 'l3']))).toBe(40);
  });

  it('returns 0 for a course with no lessons', () => {
    expect(getProgress(makeCourse({ levels: [] }), new Set(['l1']))).toBe(0);
  });

  it('ignores completed IDs that do not belong to this course', () => {
    // l1 is in course, 'other_lesson' is not
    expect(getProgress(makeCourse(), new Set(['l1', 'other_lesson']))).toBe(20);
  });
});

// ── getTotalDuration ──────────────────────────────────────────────────────

describe('getTotalDuration', () => {
  it('returns minutes format when total is under 60', () => {
    // l1=15, l2=20, l3=10, l4=30, l5=5 → 80 min → "1h 20m"
    // Override to get under 60: use short lessons
    const shortCourse = makeCourse({
      levels: [{
        id: 'lv1', title: 'L1',
        sections: [{ id: 's1', title: 'S', lessons: [makeLesson('l1', '10'), makeLesson('l2', '20')] }],
      }],
    });
    expect(getTotalDuration(shortCourse)).toBe('30 min');
  });

  it('returns hours+minutes format when total is 60 or more', () => {
    // 15+20+10+30+5 = 80 min → "1h 20m"
    expect(getTotalDuration(makeCourse())).toBe('1h 20m');
  });

  it('handles lessons with missing or zero duration', () => {
    const course = makeCourse({
      levels: [{
        id: 'lv1', title: 'L1',
        sections: [{ id: 's1', title: 'S', lessons: [makeLesson('l1', ''), makeLesson('l2', '0')] }],
      }],
    });
    expect(getTotalDuration(course)).toBe('0 min');
  });
});

// ── extractYouTubeId ──────────────────────────────────────────────────────

describe('extractYouTubeId', () => {
  it('extracts ID from standard watch URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from youtu.be short URL', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from embed URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns undefined for non-YouTube URL', () => {
    expect(extractYouTubeId('https://vimeo.com/12345678')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(extractYouTubeId(undefined)).toBeUndefined();
  });
});
