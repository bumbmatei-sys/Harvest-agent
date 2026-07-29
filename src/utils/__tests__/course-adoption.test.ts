import { describe, it, expect } from 'vitest';
import {
  UNLIMITED,
  resolveCourseLimit,
  isAtCourseLimit,
  courseLimitMessage,
  buildAdoptionRecord,
  isPubliclyVisible,
  adoptableCourses,
  mergeCoursesForMembers,
  mergeAuthors,
  mergeCategories,
} from '../course-adoption';
import type { Course, LibraryCourse } from '../../types/course.types';

const course = (over: Partial<Course> & { id: string }): Course => ({
  featured: false, title: 'T', description: '', category: 'Discipleship',
  thumbnail: '', authorIds: [], levels: [], ...over,
});

const libCourse = (over: Partial<LibraryCourse> & { id: string }): LibraryCourse => ({
  ...course(over), status: 'published', ...over,
});

describe('course adoption', () => {
  describe('the plan cap counts adopted courses', () => {
    it('fails closed to the plus limit (2) when the plan is unknown or loading', () => {
      expect(resolveCourseLimit(undefined)).toBe(2);
      expect(resolveCourseLimit(null)).toBe(2);
    });

    it('resolves each plan tier', () => {
      expect(resolveCourseLimit('plus')).toBe(2);
      expect(resolveCourseLimit('pro')).toBe(5);
      expect(resolveCourseLimit('max')).toBe(UNLIMITED);
      expect(resolveCourseLimit('ultra')).toBe(UNLIMITED);
    });

    it('counts own courses AND adoptions against the cap', () => {
      // This is the founder decision: adopted courses are not exempt.
      expect(isAtCourseLimit(2, 0, 2)).toBe(true);   // two own
      expect(isAtCourseLimit(0, 2, 2)).toBe(true);   // two adopted
      expect(isAtCourseLimit(1, 1, 2)).toBe(true);   // one of each — the case a
                                                     // count of own courses alone would miss
      expect(isAtCourseLimit(1, 0, 2)).toBe(false);
      expect(isAtCourseLimit(0, 1, 2)).toBe(false);
    });

    it('treats -1 as unlimited no matter the counts', () => {
      expect(isAtCourseLimit(500, 500, UNLIMITED)).toBe(false);
    });

    it('stays at the limit when a tenant is over it (e.g. after a downgrade)', () => {
      expect(isAtCourseLimit(3, 2, 2)).toBe(true);
    });

    it('says the cap includes adopted courses', () => {
      expect(courseLimitMessage(2)).toMatch(/up to 2 courses/);
      expect(courseLimitMessage(2)).toMatch(/including adopted/i);
      expect(courseLimitMessage(1)).toMatch(/up to 1 course\b/);
    });
  });

  describe('the adoption record is a POINTER, never a copy', () => {
    const record = buildAdoptionRecord('lib-course-1', 'admin-uid', '2026-07-29T00:00:00.000Z');

    it('carries the pointer and adoption metadata', () => {
      expect(record).toEqual({
        id: 'lib-course-1',
        libraryCourseId: 'lib-course-1',
        adoptedBy: 'admin-uid',
        adoptedAt: '2026-07-29T00:00:00.000Z',
      });
    });

    it('carries NO course content', () => {
      // Denormalising any of these would fork the catalogue and undo "edits
      // reach every adopter" — copying through the back door.
      for (const key of ['title', 'description', 'levels', 'thumbnail', 'authorIds', 'category']) {
        expect(key in record).toBe(false);
      }
    });

    it('uses the library course id as the doc id, so adopting twice is idempotent', () => {
      const again = buildAdoptionRecord('lib-course-1', 'other-uid', '2026-08-01T00:00:00.000Z');
      expect(again.id).toBe(record.id);
    });
  });

  describe('unpublished catalogue entries are neither browsable nor adoptable', () => {
    it('only published courses are visible', () => {
      expect(isPubliclyVisible({ status: 'published' })).toBe(true);
      expect(isPubliclyVisible({ status: 'draft' })).toBe(false);
      expect(isPubliclyVisible({ status: undefined })).toBe(false);
    });

    it('filters drafts out of the catalogue', () => {
      const list = [
        libCourse({ id: 'a', status: 'published' }),
        libCourse({ id: 'b', status: 'draft' }),
        libCourse({ id: 'c', status: undefined }),
      ];
      expect(adoptableCourses(list).map((c) => c.id)).toEqual(['a']);
    });
  });

  describe("the tenant's own featured course wins", () => {
    it('clears featured on adopted courses when the tenant features one of their own', () => {
      const own = [course({ id: 'own-1', featured: true })];
      const adopted = [libCourse({ id: 'lib-1', featured: true })];

      const merged = mergeCoursesForMembers(own, adopted);
      // CourseLibrary picks the hero with courses.find(c => c.featured).
      expect(merged.find((c) => c.featured)?.id).toBe('own-1');
      expect(merged.find((c) => c.id === 'lib-1')?.featured).toBe(false);
    });

    it('lets a featured library course through when the tenant features nothing', () => {
      const merged = mergeCoursesForMembers(
        [course({ id: 'own-1', featured: false })],
        [libCourse({ id: 'lib-1', featured: true })],
      );
      expect(merged.find((c) => c.featured)?.id).toBe('lib-1');
    });

    it('does not mutate the adopted courses it was given', () => {
      const adopted = [libCourse({ id: 'lib-1', featured: true })];
      mergeCoursesForMembers([course({ id: 'own-1', featured: true })], adopted);
      expect(adopted[0].featured).toBe(true);
    });

    it('keeps own courses first and includes both sets', () => {
      const merged = mergeCoursesForMembers(
        [course({ id: 'own-1' }), course({ id: 'own-2' })],
        [libCourse({ id: 'lib-1' })],
      );
      expect(merged.map((c) => c.id)).toEqual(['own-1', 'own-2', 'lib-1']);
    });

    it('un-adopting removes the course from the member list', () => {
      // Un-adopt is a delete of the pointer; nothing else has to change, because
      // the member list is derived from the adoption set on every load.
      const own = [course({ id: 'own-1' })];
      expect(mergeCoursesForMembers(own, []).map((c) => c.id)).toEqual(['own-1']);
    });
  });

  describe('merged author lookup', () => {
    it('resolves tenant authors AND library authors from one pool', () => {
      const merged = mergeAuthors(
        [{ id: 'tenant-author', name: 'Local Pastor' }],
        [{ id: 'lib-author', name: 'Platform Teacher' }],
      );
      // This is the shape every consumer uses: .find(a => a.id === id).
      expect(merged.find((a) => a.id === 'tenant-author')?.name).toBe('Local Pastor');
      expect(merged.find((a) => a.id === 'lib-author')?.name).toBe('Platform Teacher');
    });

    it("prefers the tenant's own author on an id collision", () => {
      const merged = mergeAuthors(
        [{ id: 'shared', name: 'Theirs' }],
        [{ id: 'shared', name: 'Platform' }],
      );
      expect(merged.filter((a) => a.id === 'shared')).toHaveLength(1);
      expect(merged[0].name).toBe('Theirs');
    });
  });

  describe('merged categories', () => {
    it('appends library categories without duplicating shared labels', () => {
      expect(mergeCategories(['All', 'Discipleship'], ['Discipleship', 'Prayer']))
        .toEqual(['All', 'Discipleship', 'Prayer']);
    });
  });
});
