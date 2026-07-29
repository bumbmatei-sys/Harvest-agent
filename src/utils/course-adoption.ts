/**
 * Platform course library — tenant adoption (THE-54).
 *
 * A tenant adopts a library course by writing ONE pointer document:
 *
 *   tenants/{tenantId}/adoptedCourses/{libraryCourseId}
 *
 * The doc id IS the library course id, so adopting twice is idempotent and
 * un-adopting is a plain delete. It stores the pointer plus adoption metadata
 * and NOTHING ELSE — denormalising the title, levels or lessons would fork the
 * catalogue and undo "edits reach every adopter", which is the whole reason
 * adoption is a reference rather than a copy.
 *
 * ⚠️ THE PLAN CAP HERE IS CLIENT-SIDE ONLY.
 *
 * `maxCourses` has always been enforced purely in the UI (a disabled button in
 * AdminCourses) — nothing server-side or in the Firestore rules counts
 * documents. Counting adoptions against the cap keeps that behaviour consistent,
 * but a direct SDK write still bypasses it, exactly as it does for a tenant's
 * own courses today. Server-side enforcement (POST /api/courses/adopt, with the
 * plan resolved from tenants/{id}.plan, and adoptedCourses tightened to
 * server-only writes) is the immediate follow-up and will REPLACE the checks in
 * this module.
 */

import { getPlanFeatures } from './plan-features';
import type { AdoptedCourse, Course, LibraryCourse } from '../types/course.types';

/** Unlimited sentinel used by plan-features' maxCourses. */
export const UNLIMITED = -1;

/**
 * The tenant's course allowance.
 *
 * Fails closed to 'plus' (2) when the plan is unknown or still loading — the
 * same fallback AdminCourses has always used, and the same one AdminChurches
 * uses for maxChurches.
 */
export function resolveCourseLimit(plan: string | null | undefined): number {
  return getPlanFeatures(plan ?? 'plus').maxCourses;
}

/**
 * Whether the tenant has spent its course allowance.
 *
 * ADOPTED COURSES COUNT. A church on Individual (2 slots) that adopts two
 * library courses cannot also create one of its own — this was a deliberate
 * founder decision, chosen over exempting adopted courses.
 */
export function isAtCourseLimit(
  ownCourseCount: number,
  adoptedCourseCount: number,
  maxCourses: number,
): boolean {
  if (maxCourses === UNLIMITED) return false;
  return ownCourseCount + adoptedCourseCount >= maxCourses;
}

/** The user-facing cap message, matching the existing AdminCourses wording. */
export function courseLimitMessage(maxCourses: number): string {
  return `Your plan includes up to ${maxCourses} course${maxCourses === 1 ? '' : 's'} (including adopted library courses). Upgrade to add more.`;
}

/**
 * The adoption record written to Firestore.
 *
 * Pointer + metadata ONLY. If you are ever tempted to add the course title here
 * "just for the list view", read the module comment again — the list view can
 * resolve it from libraryCourses, which is the point.
 */
export function buildAdoptionRecord(
  libraryCourseId: string,
  adoptedBy: string,
  adoptedAt: string,
): AdoptedCourse {
  return { id: libraryCourseId, libraryCourseId, adoptedBy, adoptedAt };
}

/**
 * A library course is visible to tenants only once published.
 *
 * THIS IS THE SINGLE FILTERING MECHANISM on the read path, deliberately. The
 * libraryCourses read rule is `allow read: if isAuthenticated()` and references
 * no document field — the property that makes every catalogue query (search,
 * category filter, ordering, pagination) impossible to get silently wrong.
 *
 * A `status == 'published'` read rule was written and reverted: it would have
 * forced every client query to constrain `status` forever, and what it bought
 * was hiding a half-written course of Harvest's OWN content from someone
 * querying Firestore directly — no security boundary, no privacy, no tenant
 * data. See the libraryCourses comment in firestore.rules.
 *
 * Where draft status actually matters — adoption — it IS enforced server-side:
 * /api/courses/adopt refuses to adopt an unpublished course, a check no rule
 * could make anyway since rules cannot read across collections.
 */
export function isPubliclyVisible(course: Pick<LibraryCourse, 'status'>): boolean {
  return course.status === 'published';
}

/** Catalogue entries a tenant may browse and adopt. */
export function adoptableCourses(libraryCourses: LibraryCourse[]): LibraryCourse[] {
  return libraryCourses.filter(isPubliclyVisible);
}

/**
 * The member-facing course list: the tenant's own courses plus the library
 * courses they have adopted.
 *
 * THE TENANT'S OWN FEATURED COURSE WINS. CourseLibrary picks the hero with
 * `courses.find(c => c.featured)`, so a featured LIBRARY course could otherwise
 * outrank a church's own content on the church's own screen. Own courses are
 * placed first and `featured` is cleared on adopted courses whenever the tenant
 * already features one of their own.
 */
export function mergeCoursesForMembers(
  ownCourses: Course[],
  adoptedCourses: LibraryCourse[],
): Course[] {
  const tenantFeatures = ownCourses.some((c) => c.featured);
  const adopted = tenantFeatures
    ? adoptedCourses.map((c) => (c.featured ? { ...c, featured: false } : c))
    : adoptedCourses;
  return [...ownCourses, ...adopted];
}

/**
 * Author pool for the merged course list.
 *
 * Tenant courses resolve authorIds against `authors`; adopted library courses
 * resolve against `libraryAuthors`. Every consumer (CourseOverview, CourseCard,
 * CourseLibrary, AuthorProfile) looks authors up with an in-memory
 * `.find(a => a.id === id)` over one array, so a plain concatenation is all a
 * merged lookup requires — no per-id fetch, and no change to the tenant-scoped
 * /authors rule.
 *
 * Tenant authors come first so that in the (practically impossible, both being
 * Firestore auto-ids) event of an id collision, the tenant's own author wins on
 * their own screen.
 */
export function mergeAuthors<T extends { id: string }>(tenantAuthors: T[], libraryAuthors: T[]): T[] {
  const seen = new Set(tenantAuthors.map((a) => a.id));
  return [...tenantAuthors, ...libraryAuthors.filter((a) => !seen.has(a.id))];
}

/** Category labels for the merged list, de-duplicated, tenant labels first. */
export function mergeCategories(tenantCategories: string[], libraryCategories: string[]): string[] {
  const out = [...tenantCategories];
  for (const c of libraryCategories) if (!out.includes(c)) out.push(c);
  return out;
}
