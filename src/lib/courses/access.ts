import type { CourseAccessMode } from '@/types/course-product.types';

export type CourseAccessReason =
  | 'staff'
  | 'open'
  | 'access-list'
  | 'community'
  | 'draft'
  | 'none';

export interface CourseAccessResult {
  allowed: boolean;
  reason: CourseAccessReason;
}

/** The slice of a course document the decision reads. */
export interface AccessibleCourse {
  status?: 'draft' | 'published';
  accessMode?: CourseAccessMode;
  accessUserIds?: readonly string[];
  communityIds?: readonly string[];
}

export interface AccessSubject {
  userId: string | null;
  /** Admins and course managers may open anything, drafts included. */
  isStaff?: boolean;
  /** Every community the person belongs to. */
  communityIds?: readonly string[];
}

/**
 * The one place that decides whether a person may open a course.
 *
 * Access is the explicit access list OR membership of any attached community.
 * A course written before this model carries no `accessMode`; it stays open to
 * every member of the tenant, so nothing a ministry already published vanishes.
 * `restricted` is the standalone-product mode: nobody gets in unless the list or
 * an attached community says so.
 *
 * A draft is only ever visible to staff. A signed-out person is never allowed.
 */
export function canAccessCourse(course: AccessibleCourse, subject: AccessSubject): CourseAccessResult {
  if (subject.isStaff) return { allowed: true, reason: 'staff' };
  if (!subject.userId) return { allowed: false, reason: 'none' };
  if (course.status !== 'published') return { allowed: false, reason: 'draft' };
  if (course.accessMode !== 'restricted') return { allowed: true, reason: 'open' };
  if (course.accessUserIds?.includes(subject.userId)) return { allowed: true, reason: 'access-list' };
  const attached = course.communityIds ?? [];
  if (attached.length > 0 && (subject.communityIds ?? []).some((id) => attached.includes(id))) {
    return { allowed: true, reason: 'community' };
  }
  return { allowed: false, reason: 'none' };
}

/** Courses attached to one community and open to this person. This is the Classroom tab's list. */
export function coursesForCommunity<T extends AccessibleCourse>(
  courses: readonly T[],
  communityId: string,
  subject: AccessSubject,
): T[] {
  return courses.filter(
    (c) => (c.communityIds ?? []).includes(communityId) && canAccessCourse(c, subject).allowed,
  );
}

/** Add a community to a course's attachment list without duplicating it. */
export function attachCommunity(ids: readonly string[] | undefined, communityId: string): string[] {
  const current = ids ?? [];
  return current.includes(communityId) ? [...current] : [...current, communityId];
}

export function detachCommunity(ids: readonly string[] | undefined, communityId: string): string[] {
  return (ids ?? []).filter((id) => id !== communityId);
}

export function describeAccess(reason: CourseAccessReason): string {
  switch (reason) {
    case 'staff': return 'You can open this because you manage the ministry.';
    case 'open': return 'Open to everyone in the ministry.';
    case 'access-list': return 'You were given access to this course.';
    case 'community': return 'Included with a community you belong to.';
    case 'draft': return 'This course is not published yet.';
    case 'none': return 'This course is not included in your access.';
  }
}
