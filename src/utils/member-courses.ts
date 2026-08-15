/**
 * THE member-facing course list — the tenant's own published courses plus the
 * library courses they have adopted, resolved and merged in ONE place (THE-140).
 *
 * ⚠️ THE LIST AND THE TAB GATE MUST COME FROM THE SAME READ.
 *
 * The bug this exists to stop: the member course list read only /courses, while
 * MainApp decided whether to render the Courses tab at all from a SECOND,
 * separate read of the same collection. Both ignored
 * tenants/{t}/adoptedCourses, so a church whose only content was an adopted
 * library course saw no courses AND no tab — the adoption left no trace in the
 * member app at all. Fixing one without the other changes nothing visible:
 * a correct list behind a hidden tab is still invisible.
 *
 * So the gate does not count anything itself. It asks this module for the list
 * and checks whether it is empty. There is no second definition of "does this
 * church have courses" to drift.
 *
 * ⚠️ TWO DIFFERENT SCOPES, and the difference is the original defect.
 *
 *   • /courses        — FIELD-FILTERED (`where('tenantId','==',…)`). null is
 *                       correct: a super admin on the apex reads unscoped.
 *   • adoptedCourses  — a tenant-scoped PATH, tenants/{id}/adoptedCourses,
 *                       which null CANNOT build. getWriteTenantScope() resolves
 *                       the platform tenant instead of null, exactly as
 *                       CoursePage (#249) and AdminCourses' adoption listener
 *                       do. Building a path from null would throw; skipping the
 *                       read entirely is worse — it renders as "this church has
 *                       no library courses" and never errors.
 *
 * Reads only. adoptedCourses is `allow write: if false` — server-only, via
 * POST /api/courses/adopt.
 */

import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { getTenantScope, getWriteTenantScope } from './tenant-scope';
import { LIBRARY_COURSE_COLLECTIONS } from './library-authoring';
import { adoptableCourses, applyCourseOverrides, mergeCoursesForMembers } from './course-adoption';
import { sortByTime } from './query-helpers';
import type { AdoptedCourse, Course, CourseStatus, LibraryCourse } from '../types/course.types';

/**
 * A course as the member list renders it. `status`, `author`, `coverImage` and
 * `createdAt` are persisted on the Firestore doc but absent from the shared
 * Course interface, which is why every read site used to reach through an
 * untyped `(c as any)`. Declared here so the filter and the sort below are type
 * -checked rather than merely believed.
 */
export type MemberCourse = Course & {
  status?: CourseStatus;
  author?: string;
  coverImage?: string;
  createdAt?: string;
};

/**
 * ⚠️ A SILENT CEILING, REPORTED NOT FIXED (THE-140; same shape as THE-67 and
 * THE-106). The cap applies on the SERVER, before the published-status filter
 * below runs in JS — so a tenant holding more than this many course docs loses
 * the overflow from the member list without any error. The published filter has
 * to be client-side because the read rule requires `belongsToTenant(tenantId)`,
 * so the query must constrain tenantId, and `where(tenantId) + where(status)`
 * is a composite index. Raising the cap does not fix the shape; a paginated
 * read does, and that is its own card.
 */
export const MEMBER_COURSE_READ_LIMIT = 100;

/**
 * The tenant's own courses, published only.
 *
 * Single-field filter on the server, status applied in memory — deliberately no
 * composite index (see MEMBER_COURSE_READ_LIMIT).
 */
async function fetchOwnCourses(): Promise<MemberCourse[]> {
  const tenantId = await getTenantScope();
  const q = tenantId
    ? query(collection(db, 'courses'), where('tenantId', '==', tenantId), limit(MEMBER_COURSE_READ_LIMIT))
    : query(collection(db, 'courses'), where('status', '==', 'published'), limit(MEMBER_COURSE_READ_LIMIT));
  const snap = await getDocs(q);
  const own: MemberCourse[] = [];
  snap.forEach((d) => {
    const row = { id: d.id, ...d.data() } as MemberCourse;
    if (row.status === 'published') own.push(row);
  });
  return own;
}

/**
 * The library courses this church has adopted, as this church runs them.
 *
 * Adoption stores a POINTER, so the content is read live from libraryCourses —
 * a platform edit reaches every adopter with nothing to re-sync. Both reads are
 * UNFILTERED, the opposite of /courses above: adoptedCourses gets its tenant
 * from the PATH, and libraryCourses docs carry no tenantId and no
 * field-referencing read rule, so any query shape is accepted and no composite
 * index is involved.
 *
 * VISIBILITY IS THE LIBRARY COURSE'S OWN `status`, via adoptableCourses() —
 * course-adoption.ts's isPubliclyVisible() is the single definition, and this
 * must not grow a second one. The adoption record carries no status of its own
 * to filter on. A pointer that no longer resolves is dropped rather than
 * rendered blank: the platform can delete a catalogue course, which leaves the
 * record dangling until someone un-adopts it.
 */
async function fetchAdoptedCourses(): Promise<MemberCourse[]> {
  // NOT getTenantScope(): null cannot build tenants/{id}/adoptedCourses.
  const pathScope = await getWriteTenantScope();
  if (!pathScope) return []; // genuinely no tenant to hold adoptions

  const adoptedSnap = await getDocs(collection(db, 'tenants', pathScope, 'adoptedCourses'));
  // Keyed by library course id: the record carries this church's own
  // requireQuiz / issueCertificate, which must reach the course object.
  const adoptions = new Map<string, AdoptedCourse>();
  adoptedSnap.docs.forEach((d) => {
    const record = { id: d.id, ...d.data() } as AdoptedCourse;
    adoptions.set(record.libraryCourseId ?? d.id, record);
  });
  if (adoptions.size === 0) return [];

  const librarySnap = await getDocs(collection(db, LIBRARY_COURSE_COLLECTIONS.courses));
  const all = librarySnap.docs
    .filter((d) => adoptions.has(d.id))
    .map((d) => ({ id: d.id, ...d.data() }) as LibraryCourse)
    // THE COURSE AS THIS CHURCH RUNS IT — the two tenant-owned flags resolved
    // once, here, so no downstream consumer has to remember to ask.
    .map((c) => applyCourseOverrides(c, adoptions.get(c.id)));
  return adoptableCourses(all) as MemberCourse[];
}

/**
 * The merged member list: own courses first, adopted after.
 *
 * 🔴 THE MERGE IS mergeCoursesForMembers(), NOT A SECOND COPY OF IT. It also
 * clears `featured` on adopted courses when the tenant already features one of
 * their own — a library course must never outrank a church's own content on the
 * church's own screen. Each group is sorted newest-first BEFORE the merge, so
 * the sort cannot interleave the two and undo that ordering.
 *
 * Throws on a failed read; callers report through handleFirestoreError.
 */
export async function fetchMemberCourses(): Promise<MemberCourse[]> {
  const [own, adopted] = await Promise.all([fetchOwnCourses(), fetchAdoptedCourses()]);
  return mergeCoursesForMembers(
    sortByTime(own, 'createdAt', 'desc'),
    sortByTime(adopted, 'createdAt', 'desc'),
  ) as MemberCourse[];
}

/**
 * Whether the member app has any course to show — the Courses tab gate.
 *
 * Deliberately derived from the list rather than from its own count: a tab that
 * opens onto "No Courses Available", or a list nobody can reach because the tab
 * is hidden, are the two ways these can disagree.
 */
export async function hasMemberVisibleCourses(): Promise<boolean> {
  return (await fetchMemberCourses()).length > 0;
}
