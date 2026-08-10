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
 * ⚠️ THE PLAN CAP IS ENFORCED ON ONE PATH AND NOT THE OTHER. THAT IS SETTLED,
 * NOT PENDING.
 *
 * An earlier version of this comment called server-side enforcement "the
 * immediate follow-up" that would "REPLACE the checks in this module". It
 * shipped, and neither half of that sentence describes what exists now — the
 * stale wording has already produced two wrong conclusions in review, hence the
 * detail here. What is actually true:
 *
 *   ADOPTION — server-enforced. tenants/{t}/adoptedCourses is
 *   `allow write: if false` in firestore.rules, so POST /api/courses/adopt
 *   (Admin SDK) is the only way an adoption record comes into existence, and it
 *   checks the cap before writing. Note it does that by IMPORTING
 *   `isAtCourseLimit` from this module rather than replacing it: the helpers
 *   below are the single definition of the cap for both callers, which is what
 *   stops the disabled button and the route from drifting apart.
 *
 *   CREATION — client-only. A tenant's own courses are still written straight
 *   to /courses under hasPermission('createCourses', …), capped only by a
 *   disabled button in AdminCourses (as since #228). A direct SDK write
 *   bypasses that, and always has.
 *
 * So a determined tenant can still exceed `maxCourses` by creating courses, not
 * by adopting them. That is accepted, not a gap awaiting a fix. Client-side caps
 * are this codebase's settled position — #278 (maxAdmins) and #280 (maxContacts)
 * both landed that way deliberately — and adoption is the odd one out only
 * because THE-54 needed an API route for validation anyway (well-formed
 * pointers, an `adoptedBy` that is the verified caller), so the cap check came
 * along for free. Moving course CREATION behind a route is a real refactor with
 * a real cost; see the route's own header comment for why it was scoped out.
 */

import { getPlanFeatures, toTenantPlan } from './plan-features';
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
  return getPlanFeatures(toTenantPlan(plan)).maxCourses;
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

// ─── Per-tenant overrides ────────────────────────────────────────────────────

/**
 * The ONLY two fields an adopting tenant may set for themselves.
 *
 * Everything else about a library course — title, description, author,
 * curriculum, lessons, videos — stays platform-owned and read-only. That is the
 * whole point of adoption being a POINTER: the platform edits once and the
 * change reaches every adopter. These two are different in kind, because they
 * are not content at all: they are decisions about how a church runs the course
 * for *their* audience.
 *
 * Exported so the route's allow-list and the UI cannot drift apart, and so
 * "which keys are accepted" has exactly one definition. The route rejects any
 * body key outside this list — the boundary must be enforced server-side, not
 * merely hidden in the UI.
 */
export const TENANT_OVERRIDABLE_COURSE_FIELDS = ['requireQuiz', 'issueCertificate'] as const;

export type TenantOverridableCourseField = typeof TENANT_OVERRIDABLE_COURSE_FIELDS[number];

/** The subset of an adoption record a tenant controls. Absent ⇒ not chosen. */
export type CourseOverrides = Partial<Record<TenantOverridableCourseField, boolean>>;

/**
 * Resolve one effective flag from the platform's value and the tenant's.
 *
 * 🔴 THE TENANT WINS, IN BOTH DIRECTIONS.
 *
 * The platform's value is a DEFAULT, not a restriction. A church that sets
 * `issueCertificate: true` on a course the platform left false gets
 * certificates; a church that sets `false` on a course the platform marked true
 * does not. Same for `requireQuiz`. The reasoning is the same one #248 settled
 * for branding: the certificate carries the ADOPTING church's name and logo, and
 * they are the ones actually teaching the course — so the decision about what
 * their learners must do, and what they walk away with, is theirs.
 *
 * ABSENT IS NOT FALSE. The override is stored only when the tenant has actually
 * chosen, so "not chosen" (fall back to the platform's value) stays
 * distinguishable from "chose false". A `?? false` here would silently convert
 * every un-configured adoption into an opt-out — the exact shape of default that
 * hides a decision nobody made.
 */
export function resolveOverriddenFlag(
  libraryValue: boolean | undefined,
  overrideValue: boolean | undefined,
): boolean {
  if (typeof overrideValue === 'boolean') return overrideValue;
  return libraryValue === true;
}

/**
 * THE one resolver. Returns the course as the adopting tenant's learners should
 * actually experience it: platform content untouched, the two tenant-owned flags
 * resolved.
 *
 * Returning a Course rather than a pair of booleans is deliberate — it is what
 * makes the three consumers agree without any of them having to remember to ask.
 * `verifyCourseCompletion` reads `course.requireQuiz` internally, and LessonView
 * reads it directly; hand the resolved course in and both are correct with no
 * signature change and no second copy of the precedence rule. Three
 * hand-maintained copies of one rule is how the retention, super-admin and
 * minimum-plan bugs happened.
 *
 * A tenant course (no adoption record) passes through unchanged, so this is safe
 * to apply unconditionally. It is also idempotent for a given adoption record:
 * applying it twice resolves to the same values.
 */
export function applyCourseOverrides<T extends Course>(
  course: T,
  adoption: CourseOverrides | null | undefined,
): T {
  if (!adoption) return course;
  return {
    ...course,
    requireQuiz: resolveOverriddenFlag(course.requireQuiz, adoption.requireQuiz),
    issueCertificate: resolveOverriddenFlag(course.issueCertificate, adoption.issueCertificate),
  };
}

/**
 * Whether any lesson in the course actually carries a quiz.
 *
 * Guards `requireQuiz: true` on a course that has none. Note what this does and
 * does NOT prevent in this codebase: `verifyCourseCompletion` only inspects
 * lessons that HAVE a quiz, and LessonView's gate is `hasQuiz && requireQuiz` —
 * so a quiz-less course does not become uncompletable. The setting is not a dead
 * end; it is a LIE. An admin toggles "learners must pass the quiz", believes it,
 * and nothing whatsoever changes. That is the silent-failure shape this codebase
 * keeps producing, so the route refuses it and the toggle is disabled with a
 * reason rather than accepting a setting with no effect.
 */
export function courseHasQuiz(course: Pick<Course, 'levels'> | null | undefined): boolean {
  // Walked defensively rather than through getAllLessons(): this runs against a
  // raw Firestore document in the route, where a course mid-authoring can be
  // missing `levels` or `sections` entirely, and getAllLessons() assumes both.
  return (course?.levels ?? []).some((level) =>
    (level?.sections ?? []).some((section) =>
      (section?.lessons ?? []).some((l) => Array.isArray(l?.quiz) && l.quiz.length > 0),
    ),
  );
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

/**
 * The library courses a tenant currently holds, resolved from their adoption
 * records against the catalogue.
 *
 * Used by the admin course list so adopted courses appear under "Your courses"
 * alongside the tenant's own — they occupy a plan slot and members see them, so
 * hiding them on the tab that shows what the church has was misleading.
 *
 * A pointer that no longer resolves is DROPPED rather than rendered as a blank
 * row: the platform can delete a catalogue course, which leaves the adoption
 * record dangling until someone un-adopts it.
 *
 * Status is deliberately NOT filtered here. If the platform unpublishes a course
 * a church already adopted, the church still holds the pointer and its admin
 * should see that — members stop seeing the course (CoursePage filters), but the
 * slot is still spent, so silently hiding it from the admin would make the
 * course count look wrong.
 */
export function adoptedLibraryCourses(
  adopted: Pick<AdoptedCourse, 'libraryCourseId'>[],
  libraryCourses: LibraryCourse[],
): LibraryCourse[] {
  const byId = new Map(libraryCourses.map((c) => [c.id, c]));
  return adopted
    .map((a) => byId.get(a.libraryCourseId))
    .filter((c): c is LibraryCourse => Boolean(c));
}
