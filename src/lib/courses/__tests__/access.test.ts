import { describe, it, expect } from 'vitest';
import {
  attachCommunity,
  canAccessCourse,
  isCourseStaff,
  isRestrictedCourse,
  coursesForCommunity,
  detachCommunity,
  type AccessibleCourse,
} from '../access';

const published = (extra: AccessibleCourse = {}): AccessibleCourse => ({ status: 'published', ...extra });

describe('canAccessCourse', () => {
  it('lets a legacy published course (no accessMode) open to every signed-in member', () => {
    expect(canAccessCourse(published(), { userId: 'u1' })).toEqual({ allowed: true, reason: 'open' });
  });

  it.each(['private', 'Restricted', 'RESTRICTED', '', 'leaders', null])(
    'denies an unlisted member a published course whose accessMode is the unknown value %j',
    (mode) => {
      const course = published({ accessMode: mode as never, accessUserIds: ['u2'] });
      expect(canAccessCourse(course, { userId: 'u1' })).toEqual({ allowed: false, reason: 'none' });
    },
  );

  it('still lets the access list and attached communities open a course with an unknown accessMode', () => {
    const course = published({ accessMode: 'private' as never, accessUserIds: ['u1'], communityIds: ['c1'] });
    expect(canAccessCourse(course, { userId: 'u1' }).reason).toBe('access-list');
    expect(canAccessCourse(course, { userId: 'u3', communityIds: ['c1'] }).reason).toBe('community');
  });

  it('keeps everyone-mode open even when an access list exists', () => {
    expect(canAccessCourse(published({ accessMode: 'everyone', accessUserIds: ['u9'] }), { userId: 'u1' }).allowed).toBe(true);
  });

  it('denies a restricted course to a member on neither the list nor an attached community', () => {
    const course = published({ accessMode: 'restricted', accessUserIds: ['u2'], communityIds: ['c1'] });
    expect(canAccessCourse(course, { userId: 'u1', communityIds: ['c9'] })).toEqual({ allowed: false, reason: 'none' });
  });

  it('allows a restricted course through the explicit access list', () => {
    const course = published({ accessMode: 'restricted', accessUserIds: ['u1'] });
    expect(canAccessCourse(course, { userId: 'u1' })).toEqual({ allowed: true, reason: 'access-list' });
  });

  it('allows a restricted course through membership of ANY attached community', () => {
    const course = published({ accessMode: 'restricted', communityIds: ['c1', 'c2'] });
    expect(canAccessCourse(course, { userId: 'u1', communityIds: ['c0', 'c2'] })).toEqual({ allowed: true, reason: 'community' });
  });

  it('does not treat an empty attachment list as a match for a person in no community', () => {
    const course = published({ accessMode: 'restricted', communityIds: [] });
    expect(canAccessCourse(course, { userId: 'u1', communityIds: [] }).allowed).toBe(false);
  });

  it('hides drafts from members even when they are on the list', () => {
    const course: AccessibleCourse = { status: 'draft', accessMode: 'restricted', accessUserIds: ['u1'] };
    expect(canAccessCourse(course, { userId: 'u1' })).toEqual({ allowed: false, reason: 'draft' });
  });

  it('treats a document with no status as unpublished', () => {
    expect(canAccessCourse({}, { userId: 'u1' }).reason).toBe('draft');
  });

  it('lets staff open anything, drafts included', () => {
    expect(canAccessCourse({ status: 'draft', accessMode: 'restricted' }, { userId: 'a1', isStaff: true })).toEqual({ allowed: true, reason: 'staff' });
  });

  it('never admits a signed-out person to a published course', () => {
    expect(canAccessCourse(published(), { userId: null })).toEqual({ allowed: false, reason: 'none' });
  });
});

describe('community attachment', () => {
  it('is many-to-many: one course in several communities, one community with several courses', () => {
    const a = published({ accessMode: 'restricted', communityIds: ['c1', 'c2'] });
    const b = published({ accessMode: 'restricted', communityIds: ['c1'] });
    const member = { userId: 'u1', communityIds: ['c1', 'c2'] };
    expect(coursesForCommunity([a, b], 'c1', member)).toEqual([a, b]);
    expect(coursesForCommunity([a, b], 'c2', member)).toEqual([a]);
  });

  it('only lists a course in the Classroom when the person can actually open it', () => {
    const a = published({ accessMode: 'restricted', communityIds: ['c1'] });
    expect(coursesForCommunity([a], 'c1', { userId: 'u1', communityIds: [] })).toEqual([]);
  });

  it('attach is idempotent and detach removes only that community', () => {
    expect(attachCommunity(['c1'], 'c1')).toEqual(['c1']);
    expect(attachCommunity(undefined, 'c2')).toEqual(['c2']);
    expect(detachCommunity(['c1', 'c2'], 'c1')).toEqual(['c2']);
  });
});

describe('isRestrictedCourse', () => {
  it('is open only for an absent accessMode or an explicit everyone', () => {
    expect(isRestrictedCourse({})).toBe(false);
    expect(isRestrictedCourse({ accessMode: 'everyone' })).toBe(false);
    expect(isRestrictedCourse({ accessMode: 'restricted' })).toBe(true);
    expect(isRestrictedCourse({ accessMode: 'Everyone' as never })).toBe(true);
  });
});

describe('isCourseStaff', () => {
  it('is true for admin, super_admin and a createCourses holder only', () => {
    expect(isCourseStaff({ role: 'admin' })).toBe(true);
    expect(isCourseStaff({ role: 'super_admin' })).toBe(true);
    expect(isCourseStaff({ role: 'member', permissions: { createCourses: true } })).toBe(true);
    expect(isCourseStaff({})).toBe(false);
    expect(isCourseStaff({ role: 'member', permissions: { createCourses: false } })).toBe(false);
    expect(isCourseStaff({ role: 'member', permissions: null })).toBe(false);
  });
});
