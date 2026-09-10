"use client";
import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, GraduationCap, Library, Check, Eye } from 'lucide-react';
import { collection, onSnapshot, query, where, deleteDoc, doc, getDoc, limit, orderBy, documentId, getCountFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import { authFetch } from '../utils/auth-fetch';
import AdminCourseEditor, { Course } from './AdminCourseEditor';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope, getWriteTenantScope } from '../utils/tenant-scope';
import { sortByTime } from '../utils/query-helpers';
import { useTenant } from '@/contexts/TenantContext';
import {
  LIBRARY_COURSE_COLLECTIONS,
  LIBRARY_COURSE_FETCH_LIMIT,
  TENANT_COURSE_FETCH_LIMIT,
  COURSE_LOOKUP_FETCH_LIMIT,
} from '../utils/library-authoring';
import { readDocsByIds, truncationNotice } from '../utils/bounded-list-read';
// Course descriptions are HTML from the rich-text editor. This card is a
// two-line clamped summary, so formatting is worthless here — and rendering
// catalogue HTML with dangerouslySetInnerHTML would be a needless XSS surface
// even though the author is a super admin. Existing helper, not a new one.
import { stripHtml } from '../utils/stripHtml';
import {
  resolveCourseLimit, isAtCourseLimit, courseLimitMessage, adoptableCourses,
  adoptedLibraryCourses,
} from '../utils/course-adoption';
import { CoursePreview } from './course/CoursePreview';
import type { AdoptedCourse, Author, LibraryCourse } from '../types/course.types';
import { AdminPageHeader, AdminPrimaryButton, AdminSearchBar, AdminCard, AdminBadge, statusTone } from './admin/AdminUI';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { FORM_CONTAINER, CONTROL_DENSITY } from './layout/form-layout';

/**
 * A tenant could not be resolved for a WRITE. Distinct from a generic failure
 * because it is deterministic and reproducible — a configuration fault, not a
 * transient one — so telling the user to "try again" is actively misleading.
 */
class NoTenantScopeError extends Error {
  constructor() {
    super('No tenant scope: could not determine which church to write to.');
    this.name = 'NoTenantScopeError';
  }
}

/** The message the user actually sees. Specific when we know why. */
function describeAdoptionFailure(error: unknown, fallback: string): string {
  if (error instanceof NoTenantScopeError) {
    return 'Could not determine which church to use. Open your church\'s own site and try there.';
  }
  return fallback;
}

/**
 * Do not swallow. The original catch here was `console.error(error)` plus a
 * generic retry message, which turned a deterministic apex-super-admin failure
 * into an unexplained one — invisible in Vercel logs and Sentry alike, because
 * the request never left the browser.
 *
 * NOTE: there is no established client-side Sentry capture pattern in this
 * codebase — `Sentry.captureException` appears in no component or util (the
 * browser SDK IS initialised in instrumentation-client.ts, and
 * money-path-sentry.ts is server-only). Rather than invent one here, this logs
 * with the operation and the real message intact so the cause is legible in the
 * console. Adding a client capture helper is its own change.
 */
function reportAdoptionFailure(op: 'adopt' | 'unadopt' | 'override', error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[courses:${op}] ${message}`, error);
}

const AdminCourses: React.FC = () => {
  const { tenantPlan } = useTenant();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Browse-and-adopt lives here rather than in its own tab: the plan cap is
  // computed on this screen and only makes sense with both lists in one place.
  const [view, setView] = useState<'own' | 'library'>('own');
  const [libraryCourses, setLibraryCourses] = useState<LibraryCourse[]>([]);
  const [libraryAuthors, setLibraryAuthors] = useState<Author[]>([]);
  const [adopted, setAdopted] = useState<AdoptedCourse[]>([]);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);

  // Read-only catalogue preview. Holds an ID rather than a course object so the
  // preview always re-renders from the live listener — the platform can publish
  // an edit while it is open.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [overrideBusy, setOverrideBusy] = useState(false);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * THE-342 — the EXACT totals behind every figure this screen prints, and the
   * failure flags that stop a rejected read from rendering as "none".
   *
   * `courses.length` was the "N courses used" figure AND the plan-cap input,
   * taken from an unordered `limit(100)`. Firestore serves an unordered limit
   * in `__name__` order over random ids, so that was an ARBITRARY 100: a church
   * with 130 courses was told it had 100, and the cap arithmetic agreed. A
   * figure ships only when its read is EXACT — these come from
   * `getCountFromServer`, an unclamped server-side aggregation.
   *
   * `null` means "not yet known / could not be counted", which renders as no
   * figure rather than as a zero. A `0` and a "we could not read this" must
   * never look the same.
   */
  const [ownCount, setOwnCount] = useState<number | null>(null);
  const [libraryCount, setLibraryCount] = useState<number | null>(null);
  const [ownReadFailed, setOwnReadFailed] = useState(false);
  const [libraryReadFailed, setLibraryReadFailed] = useState(false);

  /**
   * The catalogue documents behind THIS church's adoptions, fetched BY ID.
   *
   * THE-342 — "Your courses" used to resolve adoptions against the ceiling-
   * limited catalogue listener, so a church whose adopted course sorted past
   * the ceiling lost it from the tab that answers "what does this church
   * have?" — and, because the plan cap counts adoptions, from the cap too.
   * Reading the pointers by id is COMPLETE BY CONSTRUCTION: no ceiling can
   * apply. CoursePage resolves the member-facing list exactly the same way, so
   * the two screens cannot disagree about which courses a church has adopted.
   */
  const [adoptedCourseDocs, setAdoptedCourseDocs] = useState<LibraryCourse[]>([]);

  /**
   * THE-345 - which id set `adoptedCourseDocs` is an ANSWER TO, or null for
   * "no answer yet".
   *
   * The by-id read is async, so `adoptedCourseDocs` is `[]` for a tick after
   * every change to the adoption set - and `[]` is indistinguishable from "every
   * pointer dangles". Counting resolved adoptions without this flag would drop
   * the figure to `ownCount` on first paint and, far worse, hand a church a free
   * slot for that tick, because the plan cap reads the same number. That is the
   * cap failing OPEN, which is the one direction this file has never let it fail
   * (an unknown plan falls back to `plus`; an uncounted church is treated as at
   * its limit).
   *
   * It holds the KEY, not a boolean, so a stale answer to a previous id set is
   * not mistaken for a current one: adopt a second course and the key moves on
   * before the read for it lands.
   *
   * It is deliberately NOT set in the catch below. A REJECTED read must leave
   * the figure where it was - at `adopted.length`, the larger number - so a
   * failure can never present as a church having fewer courses or more room.
   * That is THE-342's Silent-Failure Rule applied to the same read one layer up.
   */
  const [adoptedResolvedKey, setAdoptedResolvedKey] = useState<string | null>(null);

  // Unknown/loading plan falls back to 'plus' (maxCourses: 2) — fail closed on the cap.
  // ADOPTED COURSES COUNT: a church on Individual (2 slots) that adopts two
  // library courses cannot also create one of their own. Deliberate founder call.
  //
  // For ADOPTION this is now presentation only — /api/courses/adopt re-checks the
  // same cap server-side against the plan on the tenant doc and returns 403, and
  // adoptedCourses is no longer client-writable at all. For a tenant's OWN
  // courses the disabled button below is still the only check, exactly as it has
  // been since #228: creation goes straight to /courses from the client. Adoption
  // is enforced; creation is not.
  const maxCourses = resolveCourseLimit(tenantPlan);
  const adoptedIds = new Set(adopted.map((a) => a.libraryCourseId));

  /**
   * THE-345 - THE GHOST, and the three figures that must stop counting it.
   *
   * The founder: "In courses I only adopted one course in shadcn tenant from
   * library but it says I used 2 in total." His screen read "2 of 15 courses
   * used", "Your courses (2)" and "Library (2 adopted)" with exactly ONE row
   * rendered - and one of his fifteen plan slots was spent on a course that does
   * not exist.
   *
   * WHY A POINTER DANGLES. `adoptedCourses` holds POINTERS
   * (`{ libraryCourseId }`) into the platform catalogue, and nothing keeps the
   * two in step: the platform can delete a `libraryCourses` document at any time
   * and no rule, index or hook reaches into every tenant to tidy up after it. So
   * a pointer dangles for exactly two reasons, and this ticket established both
   * rather than inferring them:
   *
   *   1. THE CATALOGUE DOCUMENT IS GONE. `readDocsByIds` resolves ids through
   *      `where(documentId(), 'in', ids)`, which returns only documents that
   *      EXIST - a deleted one is simply absent from the snapshot.
   *   2. THE POINTER IS MALFORMED - no `libraryCourseId`, or an empty one. Those
   *      are filtered out of `adoptedIdKey` below before the read, so they are
   *      never even asked about.
   *
   * WHAT IS **NOT** A CAUSE, and this is the part that makes the fix safe:
   *
   *   · A FAILED READ. `readDocsByIds` THROWS on a rejected chunk and never
   *     resolves into a short list, so a permission error or an outage cannot
   *     masquerade as a missing course. The catch sets `libraryReadFailed` and
   *     leaves `adoptedResolvedKey` alone, so every figure here stays at
   *     `adopted.length`. Hiding a symptom without knowing the cause was the
   *     risk; the read's own contract rules the dangerous cause out.
   *   · AN UNPUBLISHED COURSE. `adoptedLibraryCourses` deliberately does not
   *     filter `status`, and an unpublished document still exists, so it still
   *     resolves and still counts. That is right: the slot really is spent.
   *
   * WHICH FIGURE EACH SURFACE READS - and they are NOT all the same answer:
   *
   *   · the header count, the "Your courses" tab and the PLAN CAP read
   *     `countedAdoptions`: adoptions that resolved, falling back to
   *     `adopted.length` while the answer is unknown.
   *   · the "Library (N adopted)" tab reads `countedAdoptions` too, because the
   *     "Adopted" badge beside it is driven by `adoptedIds` against catalogue
   *     documents that exist - a ghost can never carry one - so a raw count here
   *     is the precise thing the founder saw and could not reconcile.
   *   · `myAdoptedCourses` reads the SEARCH-FILTERED list and must never be any
   *     of the above. Typing in the search box would otherwise change "N courses
   *     used" and, through the same number, the plan cap.
   *
   * WHY THIS IS NOT `:102`'s BUG ONE LAYER DOWN. That bug used `courses.length`
   * - the length of a CEILING-LIMITED LIST - as both the figure and the cap
   * input, so a truncated read flattered the church. Nothing here is a truncated
   * list: `ownCount` is still the exact `getCountFromServer` aggregation and is
   * untouched, and `adoptedCourseDocs` comes from `readDocsByIds`, which is
   * complete by construction and subject to no ceiling at all. The count went
   * DOWN by excluding a course that does not exist, not by failing to read one.
   */
  const adoptedIdKey = adopted
    .map((a) => a.libraryCourseId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort()
    .join(',');
  /** `adoptedCourseDocs` answers the CURRENT adoption set, not a previous one. */
  const adoptionsResolved = adoptedResolvedKey === adoptedIdKey;
  /**
   * Every adoption that resolves to a real catalogue document. UNFILTERED by
   * search on purpose - `myAdoptedCourses` filters this, never the reverse.
   */
  const resolvedAdopted = adoptedLibraryCourses(adopted, adoptedCourseDocs);
  /**
   * The adoptions that count. Falls back to the RAW pointer count while the
   * resolution is unknown or failed, which is the fail-closed direction: a
   * church is never handed a slot by a read that has not finished.
   */
  const countedAdoptions = adoptionsResolved ? resolvedAdopted.length : adopted.length;
  /** Pointers that resolved to nothing. Zero unless the answer is in. */
  const danglingAdoptions = adoptionsResolved ? adopted.length - resolvedAdopted.length : 0;
  /**
   * The ghosts a church can actually clear, by id.
   *
   * NO NEW ROUTE AND NO MIGRATION. `adoptedCourses` is `allow write: if false`
   * and stays that way, but `DELETE /api/courses/adopt` already removes a
   * pointer by `{ tenantId, libraryCourseId }`, already requires
   * `createCourses`, never reads `libraryCourses` on the way through, and is
   * documented idempotent ("removing something already gone is a success, not a
   * 404"). A ghost is precisely the case it already handles, so clearing one is
   * `handleUnadopt` with the id the church already holds.
   *
   * A MALFORMED pointer (no `libraryCourseId`) is counted in `danglingAdoptions`
   * but is deliberately absent here: there is no id to address it by, so the
   * route's own id validation would refuse it. It stops consuming a slot either
   * way, which is the founder's bug; removing the record itself would need a
   * server-side sweep and is reported, not built.
   */
  const resolvedAdoptedIds = new Set(resolvedAdopted.map((c) => c.id));
  const danglingAdoptedIds = adoptionsResolved
    ? adopted
        .map((a) => a.libraryCourseId)
        .filter((id): id is string =>
          typeof id === 'string' && id.length > 0 && !resolvedAdoptedIds.has(id))
    : [];
  // THE-342 — the cap counts the EXACT total, not the capped list.
  //
  // `courses.length` came from a `limit(100)` read, so a church with 130
  // courses on a 2-course plan was measured at 100 — the number was wrong in
  // the church's favour every time the list was truncated. `ownCount` is the
  // unclamped aggregation.
  //
  // Fails CLOSED when the count is unknown, matching the existing
  // "unknown plan falls back to the smallest cap" stance directly above: an
  // uncounted church is treated as at its limit rather than waved through.
  // THE-345 - `countedAdoptions`, not `adopted.length`. A ghost must not consume
  // a plan slot. Everything else about this line is THE-342's and is unchanged:
  // an unknown `ownCount` still fails CLOSED at `true`, and a REAL adoption
  // still counts, which is the founder's deliberate call recorded above.
  const atLimit = ownCount === null
    ? true
    : isAtCourseLimit(ownCount, countedAdoptions, maxCourses);
  const limitMessage = courseLimitMessage(maxCourses);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const tenantId = await getTenantScope();
      // Single-field filter only (tenantId); sort client-side to avoid a composite index.
      //
      // THE-342 — `orderBy(documentId())` and the SHARED ceiling.
      //
      // This was `limit(100)` with NO order, which does not mean "the first
      // 100" or "the newest 100": Firestore has no default order, so it was an
      // arbitrary and unstable 100. `__name__` is unique, so it is a total
      // order and the window is at least stable between reads. It is served by
      // the automatic (tenantId, __name__) index, so NO COMPOSITE INDEX is
      // involved — which matters because firestore.indexes.json is not
      // deployed by deploy-rules.yml and an index added there would be inert.
      //
      // Ordering by 'createdAt' instead would need that composite index AND
      // would silently drop every course missing the field. The client-side
      // sort below still puts the newest first for display.
      const base = tenantId
        ? query(collection(db, 'courses'), where('tenantId', '==', tenantId))
        : query(collection(db, 'courses'));
      const q = query(base, orderBy(documentId()), limit(TENANT_COURSE_FETCH_LIMIT));

      // EXACT, and independent of the ceiling above: the aggregation runs over
      // the whole query and loads no documents, so "N courses used" is true
      // even when the list under it is capped.
      try {
        setOwnCount((await getCountFromServer(base)).data().count);
      } catch (error) {
        try { handleFirestoreError(error, OperationType.GET, 'courses:count'); } catch (e) { console.error(e); }
        setOwnCount(null);
      }

      unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedCourses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Course[];
        setCourses(sortByTime(fetchedCourses, 'createdAt', 'desc'));
        setOwnReadFailed(false);
        setLoading(false);
      }, (error) => {
        try { handleFirestoreError(error, OperationType.GET, `courses`); } catch (e) { console.error(e); }
        // Not an empty church. Rendering [] here is the bug THE-342 closes.
        setOwnReadFailed(true);
        setLoading(false);
      });
    })();

    return () => { if (unsubscribe) unsubscribe(); };
  }, []);

  // Catalogue + this tenant's adoptions.
  //
  // Both reads are deliberately UNFILTERED, and that is the opposite of the
  // /courses read above. libraryCourses docs carry no tenantId and their read
  // rule references no document field at all, so no filter is required — or
  // possible to get wrong. adoptedCourses is a subcollection whose tenant comes
  // from the PATH, so it needs no filter either.
  //
  // Draft courses are excluded in JS by adoptableCourses() below, deliberately
  // as the single mechanism: a `status` filter here would duplicate that in a
  // second place, and pushing it into the read rule was considered and rejected
  // (see the libraryCourses comment in firestore.rules).
  useEffect(() => {
    //
    // THE-342 — the SHARED ceiling, and why the number is imported.
    //
    // This screen capped the catalogue at a hardcoded 200 while CoursePage read
    // it with no limit at all, so a church with 250 library courses saw 200 in
    // the editor and 250 on the member page. Two screens, one collection, two
    // different truths, and neither said which was which. The ceiling now comes
    // from ONE exported constant so that drift cannot be reintroduced by
    // editing a literal in one file.
    //
    // This ceiling governs the BROWSABLE catalogue only. Which courses this
    // church has ADOPTED is resolved by id below, so an adopted course can
    // never fall off the end of this window.
    const libraryBase = collection(db, LIBRARY_COURSE_COLLECTIONS.courses);
    const unsubLibrary = onSnapshot(
      query(libraryBase, orderBy(documentId()), limit(LIBRARY_COURSE_FETCH_LIMIT)),
      (snap) => {
        const fetched = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as LibraryCourse[];
        setLibraryCourses(sortByTime(fetched, 'createdAt', 'desc'));
        setLibraryReadFailed(false);
      },
      (error) => {
        try { handleFirestoreError(error, OperationType.GET, LIBRARY_COURSE_COLLECTIONS.courses); } catch (e) { console.error(e); }
        setLibraryReadFailed(true);
      },
    );
    // EXACT catalogue total, so "Showing 200 of 250" can be said truthfully.
    (async () => {
      try {
        setLibraryCount((await getCountFromServer(libraryBase)).data().count);
      } catch (error) {
        try { handleFirestoreError(error, OperationType.GET, `${LIBRARY_COURSE_COLLECTIONS.courses}:count`); } catch (e) { console.error(e); }
        setLibraryCount(null);
      }
    })();

    // Authors for the preview. A library course's authorIds resolve against
    // libraryAuthors, NOT the tenant-scoped /authors — the two are separate
    // namespaces, and looking a catalogue author up in /authors finds nothing
    // (the same trap #248 hit on the certificate's teacher name). Unfiltered,
    // like every other catalogue read: these docs carry no tenantId.
    // Bounded and ordered like every other read here (THE-342). A truncated
    // author pool renders a course AUTHORLESS rather than short, which is why
    // it gets a real ceiling instead of an unbounded scan.
    const unsubAuthors = onSnapshot(
      query(collection(db, LIBRARY_COURSE_COLLECTIONS.authors), orderBy(documentId()), limit(COURSE_LOOKUP_FETCH_LIMIT)),
      (snap) => {
        setLibraryAuthors(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Author[]);
      },
      (error) => {
        try { handleFirestoreError(error, OperationType.GET, LIBRARY_COURSE_COLLECTIONS.authors); } catch (e) { console.error(e); }
      },
    );

    let unsubAdopted: (() => void) | null = null;
    (async () => {
      // getWriteTenantScope, NOT getTenantScope. This read addresses a
      // tenant-scoped PATH, so it needs a concrete id — and getTenantScope()
      // returns null for a super admin on the apex, which meant no listener at
      // all: no "Adopted" badge, and adopted.length stuck at 0 so the plan cap
      // undercounted. The adopt fix below is invisible without this one.
      const tenantId = await getWriteTenantScope();
      if (!tenantId) return; // genuinely no tenant to hold adoptions
      unsubAdopted = onSnapshot(
        query(collection(db, 'tenants', tenantId, 'adoptedCourses'), orderBy(documentId()), limit(LIBRARY_COURSE_FETCH_LIMIT)),
        (snap) => {
          setAdopted(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AdoptedCourse[]);
        },
        (error) => {
          try { handleFirestoreError(error, OperationType.GET, `tenants/${tenantId}/adoptedCourses`); } catch (e) { console.error(e); }
        },
      );
    })();

    return () => { unsubLibrary(); unsubAuthors(); if (unsubAdopted) unsubAdopted(); };
  }, []);

  // Resolve the adoption pointers to catalogue documents, by id. Keyed on the
  // ids themselves so it re-runs when an adoption is added or removed, not on
  // every unrelated re-render of the `adopted` array.
  // `filter(Boolean)` before the join: a dangling adoption record with no
  // libraryCourseId would otherwise put the literal string "undefined" into the
  // key and then into the `in` clause, asking Firestore for a document by that
  // name. adoptedLibraryCourses() already drops such a pointer from the list.
  //
  // THE-345 - `adoptedIdKey` itself now lives above, beside the plan cap that
  // also depends on it. It is the same expression, moved and not rewritten: the
  // cap has to know whether the adoption set has been resolved, and a key
  // declared below the cap could not tell it. The sentence directly above is
  // where this ticket started - a pointer this key drops is a pointer that was
  // still being COUNTED.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = adoptedIdKey ? adoptedIdKey.split(',') : [];
      // No well-formed pointers is a COMPLETE answer, not a missing one: either
      // this church has adopted nothing, or every record it holds is malformed
      // and none of them resolves. Both are resolved states, so the key is
      // recorded here too - without it a church with one malformed pointer and
      // nothing else would sit at "unresolved" forever and never lose the ghost.
      if (ids.length === 0) { setAdoptedCourseDocs([]); setAdoptedResolvedKey(adoptedIdKey); return; }
      try {
        const docs = await readDocsByIds(
          db, LIBRARY_COURSE_COLLECTIONS.courses, ids,
          (id, data) => ({ id, ...data }) as LibraryCourse,
        );
        // Both together, and only on success. `readDocsByIds` THROWS on a
        // rejected chunk (it never resolves into a short list), so reaching this
        // line means the catalogue answered for every id asked about and any id
        // missing from `docs` is missing from the CATALOGUE, not from the read.
        if (!cancelled) { setAdoptedCourseDocs(docs); setAdoptedResolvedKey(adoptedIdKey); }
      } catch (error) {
        try { handleFirestoreError(error, OperationType.GET, LIBRARY_COURSE_COLLECTIONS.courses); } catch (e) { console.error(e); }
        // NOT `setAdoptedResolvedKey`. See the state declaration: a failed read
        // leaves every figure on this screen at the larger, fail-closed number.
        if (!cancelled) setLibraryReadFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [adoptedIdKey]);

  const filteredCourses = courses.filter(course =>
    (course.title?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    (course.author?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  // Adopted library courses belong on "Your courses" too: they occupy a plan
  // slot and members see them, so listing them only under Library made the tab
  // that answers "what does this church have?" answer it wrongly.
  //
  // They are POINTERS, so they render read-only — no Edit (the tenant does not
  // own the content; the platform edits it and the change reaches everyone) and
  // the remove action un-adopts rather than deleting anything.
  // From the by-id read, NOT from the ceiling-limited catalogue listener.
  // THE-345 - filters `resolvedAdopted` rather than re-resolving. One resolution,
  // one truth: the count above and the rows below can no longer disagree, and
  // the SEARCH-filtered length stays confined to rendering.
  const myAdoptedCourses = resolvedAdopted.filter(course =>
    (course.title?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );
  /**
   * THE-342 — the figures on this screen, and which read each rests on.
   *
   * `ownCount` is the EXACT number of this church's courses (a
   * getCountFromServer aggregation, unclamped by the list ceiling).
   * `adopted.length` is exact by construction: adoptions are pointers, they are
   * few, and the listener's ceiling is the catalogue ceiling — far above any
   * real adoption count — so a truncated adoption list is not reachable in
   * practice and would surface as a notice if it ever were.
   *
   * When the count could not be taken, `exactOwnTotal` is null and the
   * header prints NO figure rather than a number derived from a capped list.
   * A wrong number is worse than an absent one: nobody questions a number.
   */
  // THE-345 - `countedAdoptions`. `ownCount` is untouched and still the exact
  // aggregation; what changed is that the adoptions added to it are the ones
  // that exist.
  const exactOwnTotal = ownCount === null ? null : ownCount + countedAdoptions;
  const ownTabCount = exactOwnTotal;
  const ownListTruncated = ownCount !== null && courses.length < ownCount;
  // Truncation is a fact about the READ WINDOW, not about what survives the
  // draft filter. Comparing `adoptableCourses(...).length` against the
  // collection total would announce "Showing 150 of 200" for a catalogue that
  // was read in full and merely holds 50 drafts — a truncation notice that is
  // itself untrue, which is the class of bug this ticket exists to remove.
  const libraryListTruncated = libraryCount !== null && libraryCourses.length < libraryCount;

  const handleNewCourse = () => {
    if (loading) return; // course count not known yet — can't decide the cap
    if (atLimit) {
      setErrorMessage(limitMessage);
      setTimeout(() => setErrorMessage(null), 5000);
      return;
    }
    setEditingCourse(null); setIsEditorOpen(true);
  };
  const handleEditCourse = (course: Course) => { setEditingCourse(course); setIsEditorOpen(true); };

  // Draft courses are neither browsable nor adoptable. This is the ONE place
  // that filter lives on the read path; /api/courses/adopt independently refuses
  // to adopt an unpublished course, which is the check that actually matters.
  const visibleLibrary = adoptableCourses(libraryCourses).filter(course =>
    (course.title?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  const handleAdopt = async (libraryCourse: LibraryCourse) => {
    if (loading) return;                       // counts not known — can't decide the cap
    if (adoptedIds.has(libraryCourse.id)) return;
    if (atLimit) {
      setErrorMessage(limitMessage);
      setTimeout(() => setErrorMessage(null), 5000);
      return;
    }
    setAdoptingId(libraryCourse.id);
    try {
      // getWriteTenantScope, NOT getTenantScope — this is a MUTATION.
      // getTenantScope() returns null by design for a super admin with no host
      // scope (null means "all tenants", correct for a read), so on the apex
      // the old code threw before the request ever left the browser: no Vercel
      // log, no Sentry event, just "please try again", every time.
      const tenantId = await getWriteTenantScope();
      if (!tenantId) throw new NoTenantScopeError();
      // adoptedCourses is server-only now (allow write: if false). The route
      // writes the POINTER after verifying the target exists and is published —
      // a check no Firestore rule can make, since rules cannot read across
      // collections. The listener above picks the new doc up.
      const res = await authFetch('/api/courses/adopt', {
        method: 'POST',
        body: JSON.stringify({ tenantId, libraryCourseId: libraryCourse.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body?.error || 'Failed to adopt this course. Please try again.');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    } catch (error) {
      reportAdoptionFailure('adopt', error);
      setErrorMessage(describeAdoptionFailure(error, 'Failed to adopt this course. Please try again.'));
      setTimeout(() => setErrorMessage(null), 6000);
    } finally {
      setAdoptingId(null);
    }
  };

  // Un-adopt is a plain delete of the pointer. Members lose the course; their
  // progress records are retained, so re-adopting restores their place.
  const handleUnadopt = async (libraryCourseId: string) => {
    setAdoptingId(libraryCourseId);
    try {
      // Same mutation, same resolver — see handleAdopt. This had the identical
      // apex bug: un-adopt failed for a super admin for exactly the same reason.
      const tenantId = await getWriteTenantScope();
      if (!tenantId) throw new NoTenantScopeError();
      const res = await authFetch('/api/courses/adopt', {
        method: 'DELETE',
        body: JSON.stringify({ tenantId, libraryCourseId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body?.error || 'Failed to remove this course. Please try again.');
        setTimeout(() => setErrorMessage(null), 5000);
      }
    } catch (error) {
      reportAdoptionFailure('unadopt', error);
      setErrorMessage(describeAdoptionFailure(error, 'Failed to remove this course. Please try again.'));
      setTimeout(() => setErrorMessage(null), 6000);
    } finally {
      setAdoptingId(null);
    }
  };

  /**
   * Set one of the two tenant-owned flags on an adopted course.
   *
   * Goes through the route for the same reason adoption does: adoptedCourses is
   * `allow write: if false` (#247) and stays that way. The route — not this
   * screen — is the authority on which keys are acceptable; the UI merely avoids
   * offering one it knows will be refused.
   */
  const handleSetOverride = async (
    libraryCourseId: string,
    field: 'requireQuiz' | 'issueCertificate',
    value: boolean,
  ) => {
    setOverrideBusy(true);
    try {
      // getWriteTenantScope, NOT getTenantScope — this is a MUTATION, and on the
      // apex the read scope is null by design. Same resolver as handleAdopt.
      const tenantId = await getWriteTenantScope();
      if (!tenantId) throw new NoTenantScopeError();
      const res = await authFetch('/api/courses/adopt', {
        method: 'PATCH',
        body: JSON.stringify({ tenantId, libraryCourseId, [field]: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body?.error || 'Failed to save this setting. Please try again.');
        setTimeout(() => setErrorMessage(null), 6000);
      }
    } catch (error) {
      reportAdoptionFailure('override', error);
      setErrorMessage(describeAdoptionFailure(error, 'Failed to save this setting. Please try again.'));
      setTimeout(() => setErrorMessage(null), 6000);
    } finally {
      setOverrideBusy(false);
    }
  };

  const handleDeleteCourse = async (id: string) => {
    try {
      const tenantId = await getTenantScope();
      if (tenantId) {
        const docSnap = await getDoc(doc(db, 'courses', id));
        if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== tenantId) {
          console.error('Tenant mismatch — cannot modify another tenant\'s document');
          return;
        }
      }
      await deleteDoc(doc(db, 'courses', id));
      setDeleteConfirmId(null);
    } catch (error) {
      try { handleFirestoreError(error, OperationType.DELETE, `courses/${id}`); } catch (e) { console.error(e); }
      setErrorMessage("Failed to delete course. Please try again.");
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  // The editor is a full in-shell screen; when open it replaces the list.
  if (isEditorOpen) {
    return <AdminCourseEditor course={editingCourse} onClose={() => setIsEditorOpen(false)} />;
  }

  // The read-only preview is a full in-shell screen too, resolved fresh from the
  // live catalogue each render. A pointer that stops resolving (the platform
  // deleted the course while it was open) falls back to the list rather than
  // rendering a blank screen.
  // Look in the by-id adoption pool as well as the browsable catalogue: an
  // adopted course past the catalogue ceiling is still previewable (THE-342).
  const previewCourse = previewId
    ? (libraryCourses.find((c) => c.id === previewId) ?? adoptedCourseDocs.find((c) => c.id === previewId))
    : undefined;
  if (previewCourse) {
    const previewAdoption = adopted.find((a) => a.libraryCourseId === previewCourse.id) ?? null;
    const previewIsAdopted = Boolean(previewAdoption);
    return (
      <div className={`w-full ${FORM_CONTAINER} space-y-4`}>
        {errorMessage && (
          <div className="max-w-4xl mx-auto bg-red-50 text-red-600 p-3 rounded-brand text-sm font-medium border border-red-100">
            {errorMessage}
          </div>
        )}
        <CoursePreview
          course={previewCourse}
          authors={libraryAuthors}
          onClose={() => setPreviewId(null)}
          onAdopt={handleAdopt}
          isAdopted={previewIsAdopted}
          adoptBusy={adoptingId === previewCourse.id}
          adoptBlocked={!previewIsAdopted && atLimit}
          blockedReason={limitMessage}
          adoption={previewAdoption}
          onSetOverride={(field, value) => handleSetOverride(previewCourse.id, field, value)}
          overrideBusy={overrideBusy}
        />
      </div>
    );
  }

  return (
    <div className={`w-full ${FORM_CONTAINER} space-y-6`}>
      {errorMessage && (
        <div className="bg-red-50 text-red-600 p-3 rounded-brand text-sm font-medium border border-red-100">
          {errorMessage}
        </div>
      )}

      <AdminPageHeader
        eyebrow="Discipleship"
        title={
          exactOwnTotal === null
            ? 'Courses'
            : maxCourses === -1
              ? `${exactOwnTotal} course${exactOwnTotal === 1 ? '' : 's'}`
              : `${exactOwnTotal} of ${maxCourses} course${maxCourses === 1 ? '' : 's'} used`
        }
        action={
          view === 'own'
            ? <AdminPrimaryButton onClick={handleNewCourse} icon={<Plus size={16} />} disabled={atLimit} title={atLimit ? limitMessage : undefined}>New course</AdminPrimaryButton>
            : undefined
        }
      />

      {/* Own courses vs the platform library. The count above spans BOTH — an
          adopted course occupies a plan slot exactly like one you authored. */}
      <div className="flex items-center gap-1 border-b border-line">
        {([
          { key: 'own', label: ownTabCount === null ? 'Your courses' : `Your courses (${ownTabCount})` },
          { key: 'library', label: `Library (${countedAdoptions} adopted)` },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors ${
              view === t.key
                ? 'border-gold text-strong'
                : 'border-transparent text-muted hover:text-strong'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {atLimit && (
        <div className="bg-[var(--surface-gold)] text-strong rounded-brand p-3.5 text-sm border border-line">
          {limitMessage}
        </div>
      )}

      {/*
        THE-342 — the READ FAILED, which is not "this church has no courses".
        Rendered above the list and NOT as an empty state, because the two are
        indistinguishable in the data and must never be indistinguishable on
        screen. `alert variant="destructive"` — the primitive exists, so a
        hand-rolled div would be a defect; `empty` was rejected because this is
        a fault, not an empty collection.
      */}
      {(view === 'own' ? ownReadFailed : libraryReadFailed) && (
        <Alert data-courses-read-failed={view} variant="destructive">
          <AlertTitle>We could not load these courses</AlertTitle>
          <AlertDescription>
            The list below is not showing what is actually here, so please do not
            treat it as complete. Try again in a moment.
          </AlertDescription>
        </Alert>
      )}

      {/*
        A truncated list SAYS SO, with an EXACT total from getCountFromServer.
        "Showing 200 of 250" is honest; showing 200 silently is the quiet lie.
      */}
      {view === 'own' && ownListTruncated && ownCount !== null && (
        <Alert data-courses-truncated="own">
          <AlertTitle>This list is incomplete</AlertTitle>
          <AlertDescription>
            {truncationNotice(courses.length, ownCount, 'courses in this church')}{' '}
            Use search to find one that is not shown.
          </AlertDescription>
        </Alert>
      )}
      {view === 'library' && libraryListTruncated && libraryCount !== null && (
        <Alert data-courses-truncated="library">
          <AlertTitle>This list is incomplete</AlertTitle>
          <AlertDescription>
            {truncationNotice(libraryCourses.length, libraryCount, 'library courses')}{' '}
            Courses this church has already adopted are always shown in full under
            Your courses.
          </AlertDescription>
        </Alert>
      )}

      {/*
        THE-345 - the count moved, so the screen SAYS SO.
        Silently dropping the ghost from the figure would fix the arithmetic and
        leave the church with a record it can neither see nor remove, and a
        stored adoption set that disagrees with its own screen forever. This is
        the same stance THE-342 took for a truncated list one section up: a
        discrepancy a church cannot act on is the quiet lie, and the fix is to
        name it, not to round it off.

        `alert` - installed, so a hand-rolled div would be a defect. The DEFAULT
        variant, not `destructive`: nothing failed and the church did nothing
        wrong, and the read-failure Alert directly above IS destructive, so
        reusing red here would flatten the difference between "we could not read
        this" and "the platform withdrew a course you had". `empty` was rejected
        - there is nothing empty about this screen - and `badge` was rejected
        because this needs a sentence and an action, not a label.
      */}
      {view === 'own' && danglingAdoptions > 0 && (
        <Alert data-courses-dangling-adoptions={danglingAdoptions}>
          <AlertTitle>
            {danglingAdoptions === 1
              ? 'One adopted course is no longer in the library'
              : `${danglingAdoptions} adopted courses are no longer in the library`}
          </AlertTitle>
          <AlertDescription>
            Harvest has removed{' '}
            {danglingAdoptions === 1 ? 'a course' : 'courses'} your church had
            adopted, so {danglingAdoptions === 1 ? 'it is' : 'they are'} no longer
            shown here and no longer{' '}
            {danglingAdoptions === 1 ? 'counts' : 'count'} towards your plan.
            {danglingAdoptedIds.length > 0 && (
              <>
                {' '}You can clear the leftover{' '}
                {danglingAdoptedIds.length === 1 ? 'record' : 'records'} now.
                <span className="mt-2 flex flex-wrap gap-2">
                  {danglingAdoptedIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleUnadopt(id)}
                      disabled={adoptingId === id}
                      // min-h-11 is 44px and it is NOT inert here: this button
                      // sits inside an AlertDescription whose own type scale
                      // would otherwise leave it around 28px on a phone. Rule 4
                      // takes over at sm with the shared 40px action token.
                      className={`rounded-brand border border-line px-3 text-xs font-semibold text-strong hover:bg-surface-sunken disabled:opacity-50 min-h-11 sm:min-h-0 ${CONTROL_DENSITY.action}`}
                    >
                      {adoptingId === id ? 'Removing…' : 'Remove leftover record'}
                    </button>
                  ))}
                </span>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      <AdminSearchBar value={searchQuery} onChange={setSearchQuery} placeholder={view === 'own' ? 'Search by title or author…' : 'Search the library…'} />

      {view === 'library' && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Courses published by Harvest, free on every plan. Adopting one adds it to your
            church&apos;s courses — you keep it in step automatically, because the course stays
            with its author and any edits reach you. Adopted courses count towards your plan.
          </p>
          {visibleLibrary.length === 0 ? (
            <AdminCard className="px-6 py-14 text-center">
              <div className="flex flex-col items-center justify-center gap-1.5">
                <Library size={30} className="text-stone-300 mb-1" />
                <p className="font-display text-base text-strong">Nothing in the library yet</p>
                <p className="text-sm text-muted">Published courses will appear here.</p>
              </div>
            </AdminCard>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleLibrary.map((course) => {
                const isAdopted = adoptedIds.has(course.id);
                const busy = adoptingId === course.id;
                const blocked = !isAdopted && atLimit;
                const lessonCount = (course.levels || []).reduce(
                  (sum, lv) => sum + (lv.sections || []).reduce((n, sec) => n + (sec.lessons?.length || 0), 0),
                  0,
                );
                return (
                  <AdminCard key={course.id} className="p-4 flex flex-col gap-3">
                    {/* The card body opens the read-only preview. Adopting one of
                        2 or 5 plan slots to find out what is inside a course was
                        the only way to see its curriculum before this. */}
                    <button
                      type="button"
                      onClick={() => setPreviewId(course.id)}
                      className="flex items-start gap-3 text-left w-full"
                      title={`Preview ${course.title}`}
                    >
                      <div className="w-[68px] h-[52px] rounded-brand bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0 overflow-hidden">
                        {course.thumbnail
                          ? <img src={course.thumbnail} alt="" className="w-full h-full object-cover" />
                          : <Library size={20} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-strong line-clamp-1">{course.title}</span>
                          {isAdopted && <AdminBadge tone="gold">Adopted</AdminBadge>}
                        </div>
                        <p className="text-xs text-faint mt-1 line-clamp-2">{stripHtml(course.description || '')}</p>
                        <p className="text-xs text-muted mt-1">
                          {[course.category, lessonCount ? `${lessonCount} lesson${lessonCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </button>
                    {isAdopted ? (
                      <button
                        onClick={() => handleUnadopt(course.id)}
                        disabled={busy}
                        className="self-start px-3 py-1.5 rounded-brand text-sm font-medium text-muted hover:text-danger hover:bg-danger-tint transition-colors disabled:opacity-50"
                      >
                        {busy ? 'Removing…' : 'Remove from your courses'}
                      </button>
                    ) : (
                      <AdminPrimaryButton
                        onClick={() => handleAdopt(course)}
                        icon={busy ? undefined : <Check size={16} />}
                        disabled={busy || blocked}
                        title={blocked ? limitMessage : undefined}
                        className="self-start"
                      >
                        {busy ? 'Adopting…' : 'Adopt'}
                      </AdminPrimaryButton>
                    )}
                  </AdminCard>
                );
              })}
            </div>
          )}
        </div>
      )}

      {view === 'own' && (<>

      {/* Mobile list — mockup course-card library: thumbnail (cover, else GraduationCap
          on gold tint), title + status pill, and an author · lesson-count meta line.
          Same loading / filteredCourses data and the same handleEditCourse (tap = open
          the builder) / setDeleteConfirmId handlers as the desktop table below. */}
      <div className="lg:hidden bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
        {loading ? (
          <div className="px-3.5 py-10 flex items-center justify-center gap-2 text-muted">
            <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin"></div>
            <span>Loading courses…</span>
          </div>
        ) : filteredCourses.length === 0 && myAdoptedCourses.length === 0 ? (
          <div className="px-3.5 py-14 flex flex-col items-center justify-center gap-1.5 text-center">
            <GraduationCap size={30} className="text-stone-300 mb-1" />
            <p className="font-display text-base text-strong">No courses found</p>
            <p className="text-sm text-muted">Get started by creating a new course, or adopt one from the library.</p>
          </div>
        ) : (
          filteredCourses.map((course, i) => {
            const lessonCount = (course.levels || []).reduce(
              (sum, lv) => sum + (lv.sections || []).reduce((s, sec) => s + (sec.lessons?.length || 0), 0),
              0,
            );
            const meta = [course.author, lessonCount ? `${lessonCount} lesson${lessonCount === 1 ? '' : 's'}` : null]
              .filter(Boolean)
              .join(' · ');
            return (
              <div key={course.id} className={`flex items-center gap-3 px-3.5 py-3 ${i ? 'border-t border-line' : ''}`}>
                <div className="w-[68px] h-[52px] rounded-brand bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0 overflow-hidden">
                  {course.thumbnail
                    ? <img src={course.thumbnail} alt="" className="w-full h-full object-cover" />
                    : <GraduationCap size={20} />}
                </div>
                <button onClick={() => handleEditCourse(course)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex-1 min-w-0 text-sm font-semibold text-strong line-clamp-1">{course.title}</span>
                    <AdminBadge tone={statusTone(course.status)} className="shrink-0">{course.status}</AdminBadge>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {(course as any).featured && <AdminBadge tone="gold">Featured</AdminBadge>}
                    {meta && <span className="text-xs text-faint truncate">{meta}</span>}
                  </div>
                </button>
                <button
                  onClick={() => setDeleteConfirmId(course.id || null)}
                  className="p-2 rounded-brand text-faint hover:text-danger hover:bg-danger-tint transition-colors shrink-0"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })
        )}
        {/* Adopted library courses — read-only pointers. No Edit: the platform
            owns the content and its edits reach every adopter. Remove un-adopts. */}
        {myAdoptedCourses.map((course, i) => (
          <div key={`adopted-${course.id}`} className={`flex items-center gap-3 px-3.5 py-3 ${(i || filteredCourses.length) ? 'border-t border-line' : ''}`}>
            <div className="w-[68px] h-[52px] rounded-brand bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0 overflow-hidden">
              {course.thumbnail
                ? <img src={course.thumbnail} alt="" className="w-full h-full object-cover" />
                : <Library size={20} />}
            </div>
            {/* Opens the read-only preview, which is also where this church's
                own two settings live. Still NO Edit: the content is not theirs. */}
            <button onClick={() => setPreviewId(course.id)} className="flex-1 min-w-0 text-left" title={`Preview ${course.title}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex-1 min-w-0 text-sm font-semibold text-strong line-clamp-1">{course.title}</span>
                <AdminBadge tone="gold" className="shrink-0">Adopted</AdminBadge>
              </div>
              <div className="text-xs text-faint mt-1 truncate">
                From the Harvest library · View &amp; settings
              </div>
            </button>
            <button
              onClick={() => handleUnadopt(course.id)}
              disabled={adoptingId === course.id}
              className="p-2 rounded-brand text-faint hover:text-danger hover:bg-danger-tint transition-colors shrink-0 disabled:opacity-50"
              title="Remove from your courses"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {/* Desktop table — existing approved layout, unchanged (now lg-only). */}
      <AdminCard className="hidden lg:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Title</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Author</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Status</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-gold uppercase tracking-[0.12em] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin"></div>
                      <span>Loading courses…</span>
                    </div>
                  </td>
                </tr>
              ) : filteredCourses.length === 0 && myAdoptedCourses.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-14 text-center">
                    <div className="flex flex-col items-center justify-center gap-1.5">
                      <GraduationCap size={30} className="text-stone-300 mb-1" />
                      <p className="font-display text-base text-strong">No courses found</p>
                      <p className="text-sm text-muted">Get started by creating a new course, or adopt one from the library.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCourses.map((course) => (
                  <tr key={course.id} className="hover:bg-[color-mix(in_srgb,var(--surface-sunken)_60%,transparent)] transition-colors group">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-brand bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)] flex items-center justify-center shrink-0">
                          <GraduationCap size={17} className="text-gold" />
                        </span>
                        <span className="text-sm font-semibold text-strong line-clamp-1">{course.title}</span>
                        {(course as any).featured && <AdminBadge tone="gold">Featured</AdminBadge>}
                      </div>
                    </td>
                    <td className="px-6 py-3.5"><span className="text-sm text-muted">{course.author}</span></td>
                    <td className="px-6 py-3.5"><AdminBadge tone={statusTone(course.status)}>{course.status}</AdminBadge></td>
                    <td className="px-6 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleEditCourse(course)}
                          className="p-2 rounded-brand text-faint hover:text-gold hover:bg-surface-sunken transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(course.id || null)}
                          className="p-2 rounded-brand text-faint hover:text-danger hover:bg-danger-tint transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
              {/* Adopted library courses — read-only pointers (see the mobile
                  list above). Rendered after the tenant's own, never editable. */}
              {myAdoptedCourses.map((course) => (
                <tr key={`adopted-${course.id}`} className="hover:bg-[color-mix(in_srgb,var(--surface-sunken)_60%,transparent)] transition-colors group">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-brand bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)] flex items-center justify-center shrink-0">
                        <Library size={17} className="text-gold" />
                      </span>
                      <span className="text-sm font-semibold text-strong line-clamp-1">{course.title}</span>
                      <AdminBadge tone="gold">Adopted</AdminBadge>
                    </div>
                  </td>
                  <td className="px-6 py-3.5"><span className="text-sm text-muted">Harvest library</span></td>
                  <td className="px-6 py-3.5"><AdminBadge tone={statusTone(course.status)}>{course.status}</AdminBadge></td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* View & settings, NOT Edit — the two tenant-owned flags
                          only. #249 removed Edit deliberately. */}
                      <button
                        onClick={() => setPreviewId(course.id)}
                        className="p-2 rounded-brand text-faint hover:text-gold hover:bg-surface-sunken transition-colors"
                        title="View & settings"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        onClick={() => handleUnadopt(course.id)}
                        disabled={adoptingId === course.id}
                        className="p-2 rounded-brand text-faint hover:text-danger hover:bg-danger-tint transition-colors disabled:opacity-50"
                        title="Remove from your courses"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminCard>
      </>)}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-surface-raised rounded-brand-lg shadow-xl max-w-sm w-full p-6 border border-line">
            <h3 className="font-display text-xl font-semibold text-strong mb-2">Delete course</h3>
            <p className="text-muted mb-6 text-sm">Are you sure you want to delete this course? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-muted hover:bg-surface-sunken rounded-brand font-medium transition-colors">Cancel</button>
              <button onClick={() => handleDeleteCourse(deleteConfirmId)} className="px-4 py-2 bg-danger hover:opacity-90 text-white rounded-brand font-medium transition-opacity">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCourses;
