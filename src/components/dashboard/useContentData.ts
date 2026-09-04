"use client";
/**
 * THE-294 — every read the Content tab makes.
 *
 * ─── Four reads, one figure, and every one of them count-gated ──────────────
 *
 * Course completion is a fact about a (person, course) PAIR, so both sides have
 * to be held whole:
 *
 *   1. `courses` scoped to the tenant, filtered to published IN MEMORY.
 *   2. `tenants/{t}/adoptedCourses`.
 *   3. `libraryCourses` — only when there is at least one adoption.
 *   4. `users` scoped to the tenant, for `completedLessons` / `quizAttempts`.
 *
 * Each goes through `completeRead`, which takes an exact `getCountFromServer`
 * count first and refuses above {@link DASHBOARD_FETCH_LIMIT}. 🔴 UNLIKE THE
 * ENGAGEMENT TAB, THESE FOUR ARE GATED TOGETHER: they are not four questions,
 * they are four halves of one answer, and a completion count taken over some of
 * the courses or some of the members is not a smaller version of the right
 * number, it is a wrong one. So if any of the four is refused the whole figure
 * is, with one reason saying which kind of read ran out.
 *
 * ─── 🔴 Scoping: TENANT ONLY ────────────────────────────────────────────────
 *
 * The same decision `useGivingData` and `useEngagementData` take, for the same
 * reason. `tenants/{t}/adoptedCourses` is a subcollection with no apex-level
 * counterpart, so a platform-wide branch could not read it at all — and
 * "completions across every church on the platform" is not a number this
 * product defines. On the apex the widget reports {@link REASON.noTenant}.
 *
 * ─── The read fires when the tab is opened ──────────────────────────────────
 *
 * Base UI mounts only the ACTIVE panel, so a `ContentPanel` that owns this hook
 * issues four queries when — and only when — someone selects Content. One of
 * them is a whole-collection member read, which is not something to put on the
 * landing tab's critical path for a widget most visits never see.
 */
import { useEffect, useState } from 'react';

import type { Course, CourseStatus } from '../../types/course.types';
import {
  CONTENT_REASON,
  DASHBOARD_FETCH_LIMIT,
  REASON,
  adoptedCoursesFor,
  boundedAdoptedCoursesQuery,
  boundedLibraryCoursesQuery,
  boundedScopedQuery,
  completeRead,
  countCompletions,
  libraryCoursesQuery,
  adoptedCoursesQuery,
  readableCourses,
  scopedQuery,
  toAdoptionRow,
  toCourseRow,
  toLearnerRow,
  type CompletionSummary,
  type CourseRow,
} from './content-data';

/**
 * What the Content tab reads for itself. One figure, or one reason.
 *
 * ⚠️ A `null` value with a `null` reason is the LOADING state and nothing else,
 * so the widget can never render an empty frame that means "we did not try".
 */
export interface ContentData {
  readonly loading: boolean;
  readonly completion: CompletionSummary | null;
  readonly completionReason: string | null;
}

const PENDING: ContentData = { loading: true, completion: null, completionReason: null };

/** A library course document, as much of it as this hook needs to hand on. */
type LibraryDoc = Course & { status?: CourseStatus };

const toLibraryDoc = (data: Record<string, unknown>, id: string): LibraryDoc =>
  ({ ...(data as object), id }) as LibraryDoc;

export function useContentData(tenantId: string | null): ContentData {
  const [data, setData] = useState<ContentData>(PENDING);

  useEffect(() => {
    let cancelled = false;
    setData(PENDING);

    (async () => {
      if (!tenantId) {
        if (!cancelled) setData({ loading: false, completion: null, completionReason: REASON.noTenant });
        return;
      }

      /** Every refusal from the four reads becomes ONE reason — see the header. */
      const refuse = (reason: string) => {
        if (!cancelled) setData({ loading: false, completion: null, completionReason: reason });
      };
      const ceilingOr = (reason: string) =>
        reason === REASON.tooManyToChart ? CONTENT_REASON.tooManyToCount(DASHBOARD_FETCH_LIMIT) : reason;

      /* ── 1. The ministry's own courses ───────────────────────────────────── */

      const own = await completeRead(
        scopedQuery('courses', tenantId),
        boundedScopedQuery('courses', tenantId),
        toCourseRow,
      );
      if (own.kind !== 'complete') return refuse(ceilingOr(own.reason));
      // 🔴 The published filter runs HERE, over a complete set, rather than as a
      // second `where`. See `content-data`'s header: the composite index that
      // would serve `where(tenantId) + where(status)` cannot be deployed.
      const published: CourseRow[] = own.rows.filter((c) => c.status === 'published');

      /* ── 2. and 3. The library courses this church has adopted ───────────── */

      const adoptions = await completeRead(
        adoptedCoursesQuery(tenantId),
        boundedAdoptedCoursesQuery(tenantId),
        toAdoptionRow,
      );
      if (adoptions.kind !== 'complete') return refuse(ceilingOr(adoptions.reason));

      let adopted: Course[] = [];
      if (adoptions.rows.length > 0) {
        const library = await completeRead(libraryCoursesQuery(), boundedLibraryCoursesQuery(), toLibraryDoc);
        if (library.kind !== 'complete') return refuse(ceilingOr(library.reason));
        adopted = adoptedCoursesFor(adoptions.rows, library.rows);
      }

      /*
        🔴 An adopted course is read live from `libraryCourses` and arrives as a
        whole document, so it is not put through `toCourseRow`'s nullable-levels
        gate — it goes through the same `courseHasQuiz`-shaped defence instead:
        a library document with no `levels` array would throw inside
        `getAllLessons`, so it is filtered out here and counted as unreadable
        along with the tenant's own.
      */
      const adoptable = adopted.filter((c) => Array.isArray(c.levels));
      const unreadableAdopted = adopted.length - adoptable.length;

      const countable = readableCourses(published);
      if (countable.kind !== 'complete') return refuse(countable.reason);
      if (unreadableAdopted > 0) {
        return refuse(
          CONTENT_REASON.unreadableCourses(unreadableAdopted, published.length + adopted.length),
        );
      }

      const courses = [
        ...countable.rows.map((c) => ({ course: c as unknown as Course, adopted: false })),
        ...adoptable.map((c) => ({ course: c, adopted: true })),
      ];
      if (courses.length === 0) return refuse(CONTENT_REASON.noCourses);

      /* ── 4. The learners ─────────────────────────────────────────────────── */

      const learners = await completeRead(
        scopedQuery('users', tenantId),
        boundedScopedQuery('users', tenantId),
        toLearnerRow,
      );
      if (learners.kind !== 'complete') return refuse(ceilingOr(learners.reason));

      if (cancelled) return;
      setData({
        loading: false,
        completion: countCompletions(courses, learners.rows),
        completionReason: null,
      });
    })();

    return () => { cancelled = true; };
  }, [tenantId]);

  return data;
}
