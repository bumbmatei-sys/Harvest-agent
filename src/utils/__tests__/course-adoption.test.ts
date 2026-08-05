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
  adoptedLibraryCourses,
  resolveOverriddenFlag,
  applyCourseOverrides,
  courseHasQuiz,
  TENANT_OVERRIDABLE_COURSE_FIELDS,
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
      // `max` went from unlimited to a hard 10 in the freemium repricing —
      // limits are what paid tiers sell now, so only the top tier is unlimited.
      expect(resolveCourseLimit('plus')).toBe(2);
      expect(resolveCourseLimit('pro')).toBe(5);
      expect(resolveCourseLimit('max')).toBe(10);
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

  describe('adoptedLibraryCourses — the admin "Your courses" list', () => {
    const lib = [libCourse({ id: 'a', title: 'A' }), libCourse({ id: 'b', title: 'B' })];

    it('resolves adoption pointers to catalogue courses', () => {
      const out = adoptedLibraryCourses([{ libraryCourseId: 'b' }, { libraryCourseId: 'a' }], lib);
      expect(out.map((c) => c.id)).toEqual(['b', 'a']);
    });

    it('drops a pointer that no longer resolves rather than rendering a blank', () => {
      // The platform can delete a catalogue course; the adoption record survives
      // until someone un-adopts it.
      const out = adoptedLibraryCourses([{ libraryCourseId: 'gone' }, { libraryCourseId: 'a' }], lib);
      expect(out.map((c) => c.id)).toEqual(['a']);
    });

    it('does NOT filter by status — a slot is spent even once unpublished', () => {
      // Members stop seeing it (CoursePage filters), but the church still holds
      // the pointer, so hiding it from their admin would make the count wrong.
      const withDraft = [libCourse({ id: 'd', status: 'draft' })];
      expect(adoptedLibraryCourses([{ libraryCourseId: 'd' }], withDraft).map((c) => c.id)).toEqual(['d']);
    });

    it('returns nothing when the tenant has adopted nothing', () => {
      expect(adoptedLibraryCourses([], lib)).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-tenant overrides.
//
// THE resolution rule, in one place, imported by /api/certificate,
// CourseOverview and CoursePage. Three hand-maintained copies of one rule is how
// the retention, super-admin and minimum-plan bugs happened this week, so these
// pin the rule itself rather than any one consumer's use of it.
// ─────────────────────────────────────────────────────────────────────────────
describe('per-tenant course overrides', () => {
  describe('resolveOverriddenFlag — the tenant wins, in BOTH directions', () => {
    it('falls back to the library course when the override is absent', () => {
      expect(resolveOverriddenFlag(true, undefined)).toBe(true);
      expect(resolveOverriddenFlag(false, undefined)).toBe(false);
      expect(resolveOverriddenFlag(undefined, undefined)).toBe(false);
    });

    it('a tenant TRUE beats a platform FALSE', () => {
      // The certificate carries the adopting church's name and logo (#248) and
      // they are the ones teaching it — the platform's value is a default, not a
      // restriction.
      expect(resolveOverriddenFlag(false, true)).toBe(true);
      expect(resolveOverriddenFlag(undefined, true)).toBe(true);
    });

    it('a tenant FALSE beats a platform TRUE — the same rule, the other way', () => {
      expect(resolveOverriddenFlag(true, false)).toBe(false);
    });

    it('ABSENT is not FALSE — an unset override never silently opts a church out', () => {
      // A `?? false` here would convert every un-configured adoption into an
      // opt-out: a decision nobody made, invisible until a learner is refused a
      // certificate they earned.
      expect(resolveOverriddenFlag(true, undefined)).not.toBe(resolveOverriddenFlag(true, false));
    });

    it('treats a non-boolean (e.g. a null cleared field) as absent', () => {
      expect(resolveOverriddenFlag(true, null as unknown as undefined)).toBe(true);
      expect(resolveOverriddenFlag(false, null as unknown as undefined)).toBe(false);
    });
  });

  describe('applyCourseOverrides — both fields, both directions', () => {
    const platform = libCourse({
      id: 'lib-1', issueCertificate: false, requireQuiz: true,
    });

    it('resolves issueCertificate in both directions', () => {
      expect(applyCourseOverrides(platform, { issueCertificate: true }).issueCertificate).toBe(true);
      expect(applyCourseOverrides(libCourse({ id: 'x', issueCertificate: true }), { issueCertificate: false }).issueCertificate).toBe(false);
    });

    it('resolves requireQuiz in both directions', () => {
      expect(applyCourseOverrides(platform, { requireQuiz: false }).requireQuiz).toBe(false);
      expect(applyCourseOverrides(libCourse({ id: 'x', requireQuiz: false }), { requireQuiz: true }).requireQuiz).toBe(true);
    });

    it('an override on one field leaves the other on the platform value', () => {
      const out = applyCourseOverrides(platform, { issueCertificate: true });
      expect(out.issueCertificate).toBe(true);
      expect(out.requireQuiz).toBe(true); // untouched
    });

    it('no adoption record at all passes the course through unchanged', () => {
      expect(applyCourseOverrides(platform, null)).toBe(platform);
      expect(applyCourseOverrides(platform, undefined)).toBe(platform);
    });

    it('an empty adoption record resolves to the platform values', () => {
      const out = applyCourseOverrides(platform, {});
      expect(out.issueCertificate).toBe(false);
      expect(out.requireQuiz).toBe(true);
    });

    it('NEVER touches platform-owned content', () => {
      const rich = libCourse({
        id: 'lib-2', title: 'Foundations', description: '<p>Deep.</p>',
        category: 'Discipleship', thumbnail: 't.png', authorIds: ['a-1'],
        levels: [{ id: 'lv', title: 'L', sections: [] }],
      });
      const out = applyCourseOverrides(rich, { issueCertificate: true, requireQuiz: true });
      expect(out.title).toBe('Foundations');
      expect(out.description).toBe('<p>Deep.</p>');
      expect(out.category).toBe('Discipleship');
      expect(out.thumbnail).toBe('t.png');
      expect(out.authorIds).toEqual(['a-1']);
      expect(out.levels).toBe(rich.levels);
    });

    it('does not mutate the course it is given', () => {
      const before = { ...platform };
      applyCourseOverrides(platform, { issueCertificate: true, requireQuiz: false });
      expect(platform).toEqual(before);
    });

    it('is idempotent — applying the same record twice resolves the same', () => {
      const once = applyCourseOverrides(platform, { issueCertificate: true });
      const twice = applyCourseOverrides(once, { issueCertificate: true });
      expect(twice.issueCertificate).toBe(once.issueCertificate);
      expect(twice.requireQuiz).toBe(once.requireQuiz);
    });

    it('TWO TENANTS HOLD INDEPENDENT OVERRIDES on the same course', () => {
      // The catalogue course is one document; the overrides live on each
      // church's own adoption record, so one church opting out cannot reach
      // another's members.
      const churchA = applyCourseOverrides(platform, { issueCertificate: false });
      const churchB = applyCourseOverrides(platform, { issueCertificate: true });
      expect(churchA.issueCertificate).toBe(false);
      expect(churchB.issueCertificate).toBe(true);
      // And the shared platform document is untouched by either.
      expect(platform.issueCertificate).toBe(false);
    });
  });

  describe('courseHasQuiz', () => {
    const withQuiz = (quiz: unknown) => libCourse({
      id: 'q', levels: [{ id: 'lv', title: 'L', sections: [
        { id: 's', title: 'S', lessons: [{ id: 'l1', title: 'L1', duration: '5', authorId: 'a', summary: '', ...(quiz ? { quiz } : {}) } as any] },
      ] }],
    });

    it('is true when any lesson carries a non-empty quiz', () => {
      expect(courseHasQuiz(withQuiz([{ id: 'q1', q: 'Q?', options: [] }]))).toBe(true);
    });

    it('is false when no lesson has one', () => {
      expect(courseHasQuiz(withQuiz(null))).toBe(false);
    });

    it('is false for an EMPTY quiz array — an empty quiz is no quiz', () => {
      expect(courseHasQuiz(withQuiz([]))).toBe(false);
    });

    it('tolerates a half-authored course with no levels/sections/lessons', () => {
      // Runs against a raw Firestore document in the route, where any of these
      // can be missing; getAllLessons() would throw on all three.
      expect(courseHasQuiz(libCourse({ id: 'empty' }))).toBe(false);
      expect(courseHasQuiz({ levels: undefined } as any)).toBe(false);
      expect(courseHasQuiz({ levels: [{ id: 'lv', title: 'L' }] } as any)).toBe(false);
      expect(courseHasQuiz({ levels: [{ id: 'lv', title: 'L', sections: [{ id: 's', title: 'S' }] }] } as any)).toBe(false);
      expect(courseHasQuiz(null)).toBe(false);
    });
  });

  it('the overridable field list is exactly the two, and nothing else', () => {
    // The route's allow-list is built from this constant, so widening it here
    // widens the server boundary. That must be a deliberate edit, not a drift.
    expect([...TENANT_OVERRIDABLE_COURSE_FIELDS]).toEqual(['requireQuiz', 'issueCertificate']);
  });
});
