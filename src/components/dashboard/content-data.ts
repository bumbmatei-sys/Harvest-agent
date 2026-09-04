/**
 * THE-294 — the Content tab's read layer: how many courses have actually been
 * finished.
 *
 * ─── 🔴 A COUNT. NEVER A SERIES. AND THE REASON IS IN THE SCHEMA ────────────
 *
 * The design asks for "course completions over time". IT CANNOT EXIST, and no
 * amount of care with the read makes it exist:
 *
 *   · Completion is DERIVED, not recorded. `verifyCourseCompletion` in
 *     `utils/course.utils.ts` is the single definition and it says so —
 *     complete ⇔ every lesson id of the course is in the learner's
 *     `completedLessons`, plus a passing quiz attempt per quiz-bearing lesson
 *     when the course requires one. There is no `completedAt`, no
 *     `completions` collection and no event.
 *   · 🔴 `completedLessons` IS A SET OF LESSON IDS. It records WHAT is
 *     finished, never WHEN anything was touched. `course.utils.ts`'s own header
 *     spells this out where it explains why there is no `paused` status: the
 *     only questions this data can answer are "all of them", "some of them" and
 *     "none of them".
 *   · `quizAttempts[lessonId].answeredAt` IS an ISO timestamp — but it exists
 *     only on quiz-bearing lessons of courses that require a quiz, so it dates
 *     a minority of completions and dates none of the rest. Using it as a proxy
 *     for "when this course was completed" would draw a chart of one small,
 *     unrepresentative subset under a heading claiming all of them.
 *
 * ⚠️ So a CURRENT COUNT is buildable and ships; the series is DELETED from this
 * tab's widget list rather than rendered empty or deferred. See `ContentTab`'s
 * header for the founder decision and for the other two deletions.
 *
 * ─── Four reads, and each is exact or complete or it refuses ────────────────
 *
 * Completion is a fact about a (person, course) PAIR, so both sides have to be
 * held whole. Four `completeRead`s, each count-gated by `getCountFromServer`
 * first:
 *
 *   1. `courses` scoped to the tenant — filtered to `status === 'published'` IN
 *      MEMORY. 🔴 A `where(tenantId) + where(status)` pair would need the
 *      composite index, and `firestore.indexes.json` DOES NOT DEPLOY ON MERGE
 *      (`deploy-rules.yml` runs `firestore:rules,storage` and its `paths:`
 *      filter does not include the file), so a query that leans on one throws
 *      `failed-precondition` in production while every test stays green. One
 *      equality plus an in-memory filter over a COMPLETE set is exactly as
 *      correct and needs no index at all — the same choice `member-courses.ts`
 *      made for the same reason.
 *   2. `tenants/{t}/adoptedCourses` — a subcollection, so no `where` at all.
 *   3. `libraryCourses` — read only when there is at least one adoption.
 *   4. `users` scoped to the tenant, for `completedLessons` and `quizAttempts`.
 *
 * 🔴 ADOPTED LIBRARY COURSES ARE INCLUDED, and leaving them out would be the
 * defect THE-140 fixed. A church whose only content is adopted has an empty
 * `courses` collection: a completion count over own courses alone would report
 * `0` for a congregation that finished three courses last month. Adoption
 * stores a POINTER, so the course is read live from `libraryCourses` and the
 * tenant's two overrides are resolved through `applyCourseOverrides` — the same
 * path `/api/certificate` takes, so this count and the certificate the learner
 * can actually download agree.
 *
 * ─── 🔴 Aggregates only. Never a learner ────────────────────────────────────
 *
 * {@link LearnerRow} reads `completedLessons` and `quizAttempts` and NOTHING
 * else — no uid, no name, no email — so no identifier reaches the aggregation
 * even in memory, and {@link CompletionSummary} has no field that could hold
 * one. Same ceiling THE-283 set for the dashboard read layer and enforced by
 * type rather than by discipline. "Who finished the discipleship course" is a
 * real and legitimate question; `AdminCourses` and the certificate route are
 * where it is answered, each behind its own permission.
 */
import { collection, limit, query } from 'firebase/firestore';

import { db } from '../../firebase';
import { applyCourseOverrides, isPubliclyVisible } from '../../utils/course-adoption';
import { verifyCourseCompletion } from '../../utils/course.utils';
import type { Course, CourseStatus, Level, QuizAttempt } from '../../types/course.types';
import {
  DASHBOARD_FETCH_LIMIT,
  REASON,
  boundedScopedQuery,
  completeRead,
  scopedQuery,
} from './dashboard-data';

export { boundedScopedQuery, completeRead, scopedQuery };

/* ── Queries. Every one of them index-free ────────────────────────────────── */

/** The library courses this tenant has adopted. A subcollection: no `where`. */
export const adoptedCoursesQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'adoptedCourses'));

export const boundedAdoptedCoursesQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'adoptedCourses'), limit(DASHBOARD_FETCH_LIMIT));

/**
 * The shared platform catalogue.
 *
 * ⚠️ UNSCOPED, and correctly so: `libraryCourses` documents carry no `tenantId`
 * and their read rule is `allow read: if isAuthenticated()` — platform-owned
 * content published to every church, the deliberate opposite of the tenant
 * collections. Only the adopted ids are kept, in memory.
 */
export const libraryCoursesQuery = () => query(collection(db, 'libraryCourses'));

export const boundedLibraryCoursesQuery = () =>
  query(collection(db, 'libraryCourses'), limit(DASHBOARD_FETCH_LIMIT));

/* ── The rows, read from the documents this app actually writes ───────────── */

/**
 * A course as this module needs it: its structure, its quiz rule, and nothing
 * else that could identify anybody.
 *
 * 🔴 `levels` IS NULLABLE and that is the point. `getAllLessons` does
 * `course.levels.flatMap(...)` and THROWS on a document that has no `levels`
 * array — `courseHasQuiz` already walks defensively for exactly this reason,
 * noting that "a course mid-authoring can be missing `levels` or `sections`
 * entirely". A course whose structure cannot be read cannot be evaluated for
 * completion at all, so it is `null` here and {@link readableCourses} refuses
 * with a count rather than silently treating it as a course nobody finished.
 * `[]` and `null` are different claims: the first is a course with no lessons,
 * which genuinely can never be completed; the second is a course this read
 * could not understand.
 */
export interface CourseRow {
  readonly id: string;
  readonly levels: Level[] | null;
  readonly requireQuiz: boolean | undefined;
  readonly status: CourseStatus | undefined;
}

const asStatus = (v: unknown): CourseStatus | undefined =>
  typeof v === 'string' ? (v as CourseStatus) : undefined;

/** 🔴 Reads no title, no description, no author, no cover image. Structure only. */
export const toCourseRow = (data: Record<string, unknown>, id: string): CourseRow => ({
  id,
  levels: Array.isArray(data.levels) ? (data.levels as Level[]) : null,
  requireQuiz: typeof data.requireQuiz === 'boolean' ? data.requireQuiz : undefined,
  status: asStatus(data.status),
});

/** An adoption record, reduced to the pointer and the two overrides it carries. */
export interface AdoptionRow {
  readonly libraryCourseId: string;
  readonly requireQuiz: boolean | undefined;
  readonly issueCertificate: boolean | undefined;
}

export const toAdoptionRow = (data: Record<string, unknown>, id: string): AdoptionRow => ({
  // The doc id IS the library course id (that is what makes adopt idempotent);
  // the field is preferred when present, exactly as `member-courses` reads it.
  libraryCourseId: typeof data.libraryCourseId === 'string' ? data.libraryCourseId : id,
  requireQuiz: typeof data.requireQuiz === 'boolean' ? data.requireQuiz : undefined,
  issueCertificate: typeof data.issueCertificate === 'boolean' ? data.issueCertificate : undefined,
});

/**
 * One learner's course progress.
 *
 * 🔴 THE COERCIONS HERE ARE THE SERVER'S OWN, COPIED DELIBERATELY.
 * `/api/certificate` reads the same two fields as
 * `Array.isArray(userData.completedLessons) ? … : []` and
 * `userData.quizAttempts && typeof … === 'object' ? … : {}`, and that route is
 * the authority on whether a learner has finished anything — it is what decides
 * if a certificate is issued. A member document with no `completedLessons` has
 * genuinely completed nothing, which is a true reading and not a failed one, so
 * `[]` is correct here in a way `0` never is for a count. Writing a second,
 * stricter rule here would let this widget disagree with the certificate a
 * learner can actually download.
 */
export interface LearnerRow {
  readonly completedLessons: string[];
  readonly quizAttempts: Record<string, QuizAttempt | undefined>;
}

export const toLearnerRow = (data: Record<string, unknown>): LearnerRow => ({
  completedLessons: Array.isArray(data.completedLessons)
    ? (data.completedLessons as unknown[]).filter((v): v is string => typeof v === 'string')
    : [],
  quizAttempts:
    data.quizAttempts && typeof data.quizAttempts === 'object'
      ? (data.quizAttempts as Record<string, QuizAttempt | undefined>)
      : {},
});

/* ── The gate, and the count ──────────────────────────────────────────────── */

/** A course whose structure this app can actually evaluate. */
export interface ReadableCourse {
  readonly id: string;
  readonly levels: Level[];
  readonly requireQuiz: boolean | undefined;
}

/**
 * The only two fields the completion rule actually reads.
 *
 * ⚠️ Declared so {@link countCompletions} can take BOTH a tenant course reduced
 * to its structure by {@link toCourseRow} and a whole library document, without
 * either having to pretend to be the other. `verifyCourseCompletion` is typed
 * against the full `Course`, so there is exactly one cast at the call site and a
 * guard test keeps it honest.
 */
export type CompletableCourse = Pick<Course, 'levels' | 'requireQuiz'>;

/**
 * Narrow a complete set of courses to the ones that can be evaluated, or refuse.
 *
 * 🔴 STRICT, like `readableReceipts` on the money path. A course whose `levels`
 * cannot be read makes the completion total short by however many people
 * finished it, with nothing on screen to say so — a total that is quietly short
 * is the defect this whole feature exists to refuse, and the fact that it is a
 * course rather than a gift does not change the shape of it.
 */
export function readableCourses(
  rows: readonly CourseRow[],
): { kind: 'complete'; rows: ReadableCourse[] } | { kind: 'unavailable'; reason: string } {
  const bad = rows.filter((r) => r.levels === null).length;
  if (bad > 0) {
    return { kind: 'unavailable', reason: CONTENT_REASON.unreadableCourses(bad, rows.length) };
  }
  return {
    kind: 'complete',
    rows: rows.map((r) => ({ id: r.id, levels: r.levels as Level[], requireQuiz: r.requireQuiz })),
  };
}

/**
 * What the widget renders. Every field is a COUNT taken at read time.
 *
 * 🔴 THERE IS NO DATE FIELD AND NO SERIES ANYWHERE IN THIS TYPE, so a chart of
 * completions over time cannot be built from it even by a later, careless
 * caller. The impossibility is enforced by the shape rather than by a comment
 * somebody may not read — the same technique THE-283 used to keep an identifier
 * out of `CountryRow`.
 */
export interface CompletionSummary {
  /** (person, course) pairs where every lesson is done and every required quiz passed. */
  readonly completions: number;
  /** People with at least one completed course. */
  readonly learnersWithACompletion: number;
  /** Courses evaluated: this ministry's published courses plus its adopted ones. */
  readonly courses: number;
  /** Of those, how many were adopted from the platform library rather than authored here. */
  readonly adoptedCourses: number;
  /** Members in the complete read. The denominator, stated rather than implied. */
  readonly learners: number;
  /** Courses nobody has finished. Counted, so the total is never read as the whole story. */
  readonly coursesWithNoCompletion: number;
}

/**
 * Count completions over a COMPLETE set of courses and a COMPLETE set of
 * learners.
 *
 * 🔴 COMPLETENESS IS WHAT MAKES THIS EXACT. Every published course and every
 * member is in hand, so the order either arrived in cannot change the answer,
 * and there is no window for a partial read to be approximately right about.
 *
 * 🔴 `verifyCourseCompletion` IS THE ONLY RULE CONSULTED. A second "is it
 * finished" test written here would be a real bug rather than a duplication:
 * certificates hang off that function, so a dashboard that counted a completion
 * the server would refuse to certify is a number a founder could act on and a
 * learner could not.
 */
export function countCompletions(
  courses: readonly { readonly course: CompletableCourse; readonly adopted: boolean }[],
  learners: readonly LearnerRow[],
): CompletionSummary {
  let completions = 0;
  let learnersWithACompletion = 0;
  const finished = new Array<number>(courses.length).fill(0);

  for (const learner of learners) {
    // A `Set` per learner rather than per (learner, course) pair: the same set
    // answers for every course, and `verifyCourseCompletion` accepts one.
    const done = new Set(learner.completedLessons);
    let any = false;
    courses.forEach((entry, i) => {
      // ⚠️ The widening cast, in ONE place and checked rather than believed.
      // `verifyCourseCompletion` and the `getAllLessons` it calls read `levels`
      // and `requireQuiz` off this argument and nothing else — a guard test
      // parses `utils/course.utils.ts` and fails if either grows a third field,
      // which is what would make this cast a lie rather than a narrowing.
      if (!verifyCourseCompletion(entry.course as Course, done, learner.quizAttempts).complete) return;
      completions++;
      finished[i]++;
      any = true;
    });
    if (any) learnersWithACompletion++;
  }

  return {
    completions,
    learnersWithACompletion,
    courses: courses.length,
    adoptedCourses: courses.filter((c) => c.adopted).length,
    learners: learners.length,
    coursesWithNoCompletion: finished.filter((n) => n === 0).length,
  };
}

/**
 * The tenant's adopted library courses, as this church runs them.
 *
 * ⚠️ `applyCourseOverrides` and `isPubliclyVisible` are IMPORTED, not
 * reimplemented. They are `course-adoption.ts`'s single definitions of "the
 * course as this church runs it" and "a library course is visible once
 * published", and `/api/certificate`, `CourseOverview` and the member course
 * list all go through the same two. A local copy here would let the dashboard
 * count a completion of a course no member can see, or apply the platform's
 * quiz rule where the church has overridden it.
 */
export function adoptedCoursesFor(
  adoptions: readonly AdoptionRow[],
  library: readonly (Course & { status?: CourseStatus })[],
): Course[] {
  const byId = new Map(adoptions.map((a) => [a.libraryCourseId, a]));
  return library
    .filter((c) => byId.has(c.id))
    .filter(isPubliclyVisible)
    .map((c) => applyCourseOverrides(c, byId.get(c.id)));
}

/* ── The reasons a Content widget has nothing to show ─────────────────────── */

export const CONTENT_REASON = {
  /** No course exists to be completed, so there is no completion to count. */
  noCourses:
    'This ministry has no published course and has adopted none from the library, so there is nothing to complete yet.',

  /** A course document carries no readable structure, so no total is honest. */
  unreadableCourses: (bad: number, total: number) =>
    `${bad.toLocaleString()} of ${total.toLocaleString()} courses carry no readable lesson structure, so no completion total here would be complete.`,

  /** More courses, adoptions, library entries or members than may be loaded at once. */
  tooManyToCount: (limit: number) =>
    `More than ${limit.toLocaleString()} records match on one of the reads this figure needs — courses, adoptions, the shared library or members — so no complete completion count can be taken from here.`,
} as const;

export { REASON, DASHBOARD_FETCH_LIMIT };
