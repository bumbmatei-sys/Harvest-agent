"use client";
import React, { useState, useEffect } from "react";
import { doc, getDoc, updateDoc, collection, query, where } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Course, Lesson, Author, QuizAttempt, LibraryCourse, AdoptedCourse } from "../types/course.types";
import { getAllLessons } from "../utils/course.utils";
import { CourseLibrary } from "../components/course/CourseLibrary";
import { CourseOverview } from "../components/course/CourseOverview";
import { LessonView } from "../components/course/LessonView";
import { AuthorProfile } from "../components/course/AuthorProfile";
import { OperationType, handleFirestoreError } from "../utils/firestore-errors";
import { getTenantScope, getWriteTenantScope } from "../utils/tenant-scope";
import {
  LIBRARY_COURSE_COLLECTIONS,
  LIBRARY_COURSE_FETCH_LIMIT,
  TENANT_COURSE_FETCH_LIMIT,
  COURSE_LOOKUP_FETCH_LIMIT,
} from "../utils/library-authoring";
import { readBoundedList, readDocsByIds, truncationNotice } from "../utils/bounded-list-read";
import {
  adoptableCourses, mergeCoursesForMembers, mergeAuthors, mergeCategories,
  applyCourseOverrides,
} from "../utils/course-adoption";

export default function CoursePage({
  onOpenCourse,
  onBack,
  initialCourseId,
  initialLessonId,
}: {
  onOpenCourse?: (courseId: string, lessonId?: string) => void;
  onBack?: () => void;
  initialCourseId?: string;
  initialLessonId?: string;
}) {
  const [screen, setScreen] = useState<"library" | "overview" | "lesson" | "author">(
    initialLessonId ? "lesson" : initialCourseId ? "overview" : "library"
  );
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [selectedAuthor, setSelectedAuthor] = useState<Author | null>(null);
  const [previousScreen, setPreviousScreen] = useState<"overview" | "lesson" | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [quizAttempts, setQuizAttempts] = useState<Record<string, QuizAttempt>>({});
  const [lessonNotes, setLessonNotes] = useState<Record<string, string>>({});

  const [courses, setCourses] = useState<Course[]>([]);
  // This church's adoption records, keyed by library course id. Held so
  // CourseOverview can resolve the same overrides itself and stay correct on its
  // own terms rather than relying on its caller having remembered.
  const [adoptions, setAdoptions] = useState<Map<string, AdoptedCourse>>(new Map());
  const [authors, setAuthors] = useState<Author[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // THE-342 — the two facts every read here must be able to state.
  //
  // `coursesFailed` is NOT the same as "no courses", and conflating them is
  // the bug this ticket closes. The course read below is REJECTED WHOLESALE for
  // any signed-in member whose tenant scope came back null (see the comment on
  // that read), and the old `catch { console.error }` turned that rejection into
  // a library that said "No courses found" — a lie about this church's content,
  // told confidently. AGENTS.md's Silent-Failure Rule names exactly this shape.
  //
  // `notices` collects the "Showing N of M" lines for whichever reads hit their
  // ceiling. Empty is the normal case and renders nothing.
  const [coursesFailed, setCoursesFailed] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  // De-duplicating, because the effect below can run twice (StrictMode in dev
  // double-invokes effects) and a notice appearing twice would look like two
  // different problems. The text is the identity, which is also the render key.
  const addNotice = (line: string) =>
    setNotices((prev) => (prev.includes(line) ? prev : [...prev, line]));

  // Fetch user completed lessons
  useEffect(() => {
    const fetchUserData = async () => {
      if (!auth.currentUser) return;
      try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          if (data.completedLessons) {
            setCompleted(new Set(data.completedLessons));
          }
          if (data.quizAttempts) {
            setQuizAttempts(data.quizAttempts);
          }
          if (data.lessonNotes) {
            setLessonNotes(data.lessonNotes);
          }
        }
      } catch (error) {
        try { handleFirestoreError(error, OperationType.GET, `users/${auth.currentUser?.uid}`); } catch (e) { console.error(e); }
      }
    };
    fetchUserData();
  }, []);

  // Fetch courses, authors, categories
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Tenant-scoped: authors carry a tenantId and the rules require it to
        // match, so the query must filter by tenantId — an unfiltered read is
        // rejected. A super admin in platform context (null) reads unscoped.
        //
        // THE-342: bounded and counted. An author pool that truncates does not
        // render a SHORT list, it renders a course AUTHORLESS — the reader sees
        // a course with no teacher and no reason given. Ordering by
        // documentId() keeps the window stable and needs no composite index.
        const tenantId = await getTenantScope();
        const authorsBase = tenantId
          ? query(collection(db, "authors"), where("tenantId", "==", tenantId))
          : collection(db, "authors");
        const authorsRead = await readBoundedList(
          authorsBase, COURSE_LOOKUP_FETCH_LIMIT,
          (id, data) => ({ id, ...data }) as Author,
        );

        // Adopted library courses resolve authorIds against libraryAuthors, not
        // the tenant-scoped authors above. Every consumer looks an author up
        // with an in-memory .find() over ONE array, so merging the two pools is
        // all a merged lookup needs — no per-id fetch, and no change to the
        // tenant-scoped /authors rule. This read is UNFILTERED by design.
        const libAuthorsRead = await readBoundedList(
          collection(db, LIBRARY_COURSE_COLLECTIONS.authors), COURSE_LOOKUP_FETCH_LIMIT,
          (id, data) => ({ id, ...data }) as Author,
        );
        setAuthors(mergeAuthors(authorsRead.rows, libAuthorsRead.rows));
        if (authorsRead.truncated || libAuthorsRead.truncated) {
          const shown = authorsRead.rows.length + libAuthorsRead.rows.length;
          const total = authorsRead.total + libAuthorsRead.total;
          addNotice(truncationNotice(shown, total, "teachers"));
        }
      } catch (error) {
        try { handleFirestoreError(error, OperationType.GET, "authors"); } catch (e) { console.error(e); }
        // A teacher pool that failed to load is not an empty pool. Say so here
        // rather than letting courses render silently authorless.
        addNotice("Teacher profiles could not be loaded, so some courses may not show who teaches them.");
      }

      try {
        // Tenant-scoped (same as authors above): filter categories by tenantId
        // so the query is accepted by the tenant-scoped rules.
        //
        // THE-342: bounded and counted, for the same reason as the author pool.
        // A missing category silently removes a filter chip, so a course becomes
        // unreachable by browsing rather than visibly absent.
        const tenantId = await getTenantScope();
        const catsBase = tenantId
          ? query(collection(db, "categories"), where("tenantId", "==", tenantId))
          : collection(db, "categories");
        const catsRead = await readBoundedList(
          catsBase, COURSE_LOOKUP_FETCH_LIMIT, (_id, data) => String(data.name ?? ""),
        );
        // Library categories too — an adopted course's category must be
        // filterable. Unfiltered read, same as libraryAuthors above.
        const libCatsRead = await readBoundedList(
          collection(db, LIBRARY_COURSE_COLLECTIONS.categories), COURSE_LOOKUP_FETCH_LIMIT,
          (_id, data) => String(data.name ?? ""),
        );
        setCategories(mergeCategories(["All", ...catsRead.rows], libCatsRead.rows));
        if (catsRead.truncated || libCatsRead.truncated) {
          const shown = catsRead.rows.length + libCatsRead.rows.length;
          const total = catsRead.total + libCatsRead.total;
          addNotice(truncationNotice(shown, total, "categories"));
        }
      } catch (error) {
        try { handleFirestoreError(error, OperationType.GET, "categories"); } catch (e) { console.error(e); }
        addNotice("Categories could not be loaded, so the filters below are incomplete.");
      }

      try {
        // Tenant-scoped (same as authors/categories above): the courses read
        // rule requires belongsToTenant(tenantId), so the query MUST filter by
        // tenantId — a status-only query is rejected ("rules are not filters").
        // Query by tenantId alone (single-field, no composite index) and apply
        // the published-status filter client-side. A super admin in platform
        // context (null) reads unscoped and filters status client-side too.
        //
        // THE-342 — WHAT THE UNFILTERED `else` BRANCH ACTUALLY DOES.
        // It is NOT a cross-tenant read for a member, and it is not merely a
        // slow one. The /courses rule is
        //   allow read: if isAuthenticated() && belongsToTenant(resource.data.tenantId)
        // which references `resource.data`, and AGENTS.md's corollary applies:
        // for a `list` Firestore must prove from the QUERY CONSTRAINTS ALONE
        // that every result is readable — it does not evaluate per document and
        // drop the failures. So for anyone who is not a super admin this
        // unfiltered query is REJECTED WHOLESALE with permission-denied. No
        // other church's course can reach a member through it.
        //
        // For a super admin it SUCCEEDS, deliberately: `belongsToTenant` short-
        // circuits on `isSuperAdmin()`, which reads no document field, so the
        // rule holds for every row. That is the platform-admin view, gated
        // server-side by the rules' own `isSuperAdmin()` (a `superAdmin` token
        // claim or the hardcoded platform emails) — not by this client branch.
        //
        // So the defect here was never a leak; it was what happened on the
        // REJECTION. getTenantScope() also returns null for a NON-super-admin
        // whenever the host carries no tenant subdomain (apex, a custom domain,
        // a vercel preview) AND their user doc has no tenantId — including when
        // reading that doc THREW, because getTenantId() catches and returns
        // null. Such a member ran this query, got permission-denied, and the
        // old `catch { console.error }` rendered it as "No courses found".
        const tenantId = await getTenantScope();
        const coursesRead = await readBoundedList(
          tenantId
            ? query(collection(db, "courses"), where("tenantId", "==", tenantId))
            : collection(db, "courses"),
          TENANT_COURSE_FETCH_LIMIT,
          (id, data) => ({ id, ...data }) as Course,
        );

        // TWO DIFFERENT SCOPES, and the difference is the whole bug. The read
        // above is FIELD-FILTERED, so null correctly means "every tenant" for a
        // super admin on the apex. The adopted read below addresses a
        // tenant-scoped PATH — tenants/{id}/adoptedCourses — which null cannot
        // build, so it was skipped entirely and every adopted course vanished
        // from the member app. It never errored: it rendered as "this church has
        // no library courses". getWriteTenantScope() resolves the platform
        // tenant instead of null, exactly as AdminCourses' adoption listener
        // does (#249) — the two screens must agree on WHICH tenant holds the
        // adoptions, or the admin sees a course the members cannot.
        const pathScope = await getWriteTenantScope();
        // `status` is not on the `Course` type (only LibraryCourse/AdoptedCourse
        // declare it) but tenant course docs carry the field, exactly as the
        // previous `d.data().status` read it. Unchanged behaviour: anything not
        // explicitly published stays out of the member app.
        const fetchedCourses = coursesRead.rows.filter(
          (c) => (c as { status?: string }).status === "published",
        );

        // Adopted library courses. Adoption stores a POINTER, so the content is
        // read live from libraryCourses — an edit by the platform reaches every
        // adopter with nothing to re-sync. Both reads below are UNFILTERED,
        // which is the opposite of the /courses read above: adoptedCourses gets
        // its tenant from the PATH, and libraryCourses docs carry no tenantId
        // and no field-referencing read rule, so any query shape is accepted.
        // Drafts are excluded in JS by adoptableCourses() a few lines down.
        let adoptedLibrary: LibraryCourse[] = [];
        if (pathScope) {
          const adoptedRead = await readBoundedList(
            collection(db, "tenants", pathScope, "adoptedCourses"),
            LIBRARY_COURSE_FETCH_LIMIT,
            (id, data) => ({ id, ...data }) as AdoptedCourse,
          );
          // Keyed by library course id: the record carries this church's own
          // requireQuiz / issueCertificate, which must reach the course object.
          const adoptions = new Map<string, AdoptedCourse>();
          adoptedRead.rows.forEach((record) => {
            adoptions.set(record.libraryCourseId ?? record.id, record);
          });
          if (adoptedRead.truncated) {
            addNotice(truncationNotice(adoptedRead.rows.length, adoptedRead.total, "adopted library courses"));
          }
          if (adoptions.size > 0) {
            // THE-342 — BY ID, not a scan of the whole catalogue.
            //
            // This used to read every libraryCourses document and keep the
            // handful this church had adopted. Bounding THAT scan would have
            // introduced a worse bug than it fixed: the ceiling is applied in
            // documentId() order, so a church whose adopted course sorted past
            // the ceiling would lose it from the member app entirely, with
            // nothing on screen to say a course had gone missing.
            //
            // The adoption records already name exactly which courses are
            // wanted, so fetch exactly those. The result is COMPLETE BY
            // CONSTRUCTION — no ceiling can apply and no truncation notice is
            // possible — and it is also what makes this screen agree with
            // AdminCourses, which resolves its adoptions the same way. The
            // catalogue ceiling now governs only the browsable catalogue list,
            // which is the one place a reader is actually browsing it.
            const all = (await readDocsByIds(
              db, LIBRARY_COURSE_COLLECTIONS.courses, Array.from(adoptions.keys()),
              (id, data) => ({ id, ...data }) as LibraryCourse,
            ))
              // THE COURSE AS THIS CHURCH RUNS IT. Resolved here, at the one
              // place the member app composes its course list, so every
              // downstream consumer is consistent for free: CourseOverview's
              // certificate affordance, LessonView's quiz gate, and
              // verifyCourseCompletion (which reads course.requireQuiz
              // internally) all see the effective values with no signature
              // change and no second copy of the precedence rule.
              .map((c) => applyCourseOverrides(c, adoptions.get(c.id)));
            // Unpublished catalogue entries never reach members.
            adoptedLibrary = adoptableCourses(all);
          }
          setAdoptions(adoptions);
        }

        // The tenant's OWN featured course wins: a library course must never
        // outrank a church's own content on the church's own screen.
        const allCourses = mergeCoursesForMembers(fetchedCourses, adoptedLibrary);
        setCourses(allCourses);
        // The total is the church's OWN published courses plus its adopted
        // ones. The adopted half is complete by construction (read by id), so
        // only the /courses half can truncate, and only its figures go here.
        if (coursesRead.truncated) {
          addNotice(truncationNotice(coursesRead.rows.length, coursesRead.total, "courses in this church's library"));
        }

        if (initialCourseId) {
          const course = allCourses.find((c) => c.id === initialCourseId);
          if (course) {
            setSelectedCourse(course);
            if (initialLessonId) {
              const allLessons = getAllLessons(course);
              const lesson = allLessons.find((l) => l.id === initialLessonId);
              if (lesson) setSelectedLesson(lesson);
            }
          }
        }
      } catch (error) {
        try { handleFirestoreError(error, OperationType.GET, "courses"); } catch (e) { console.error(e); }
        // THE FIX. Not `setCourses([])`, and not silence. The library screen
        // reads this and renders "We could not load this church's courses"
        // INSTEAD of its empty state, so a rejected read can never again be
        // presented to a member as a church that has published nothing.
        setCoursesFailed(true);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [initialCourseId, initialLessonId]);

  const updateLastWatched = async (course: Course, lesson: Lesson) => {
    if (!auth.currentUser) return;
    try {
      const userRef = doc(db, "users", auth.currentUser.uid);
      await updateDoc(userRef, {
        lastWatchedVideo: {
          courseId: course.id,
          courseTitle: course.title,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          thumbnail: course.thumbnail || "",
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      try { handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser?.uid}`); } catch (e) { console.error(e); }
    }
  };

  const goToCourse = (course: Course) => {
    if (onOpenCourse) {
      onOpenCourse(course.id);
    } else {
      setSelectedCourse(course);
      setScreen("overview");
      window.scrollTo(0, 0);
    }
  };

  const goToLesson = (course: Course, lesson: Lesson) => {
    if (onOpenCourse) {
      onOpenCourse(course.id, lesson.id);
      updateLastWatched(course, lesson);
    } else {
      setSelectedCourse(course);
      setSelectedLesson(lesson);
      setScreen("lesson");
      window.scrollTo(0, 0);
      updateLastWatched(course, lesson);
    }
  };

  const toggleComplete = async (id: string) => {
    const newCompleted = new Set(completed);
    if (newCompleted.has(id)) {
      newCompleted.delete(id);
    } else {
      newCompleted.add(id);
    }
    setCompleted(newCompleted);
    if (auth.currentUser) {
      try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        await updateDoc(userRef, {
          completedLessons: Array.from(newCompleted),
        });
      } catch (error) {
        try { handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser?.uid}`); } catch (e) { console.error(e); }
      }
    }
  };

  const submitQuizAttempt = async (lessonId: string, attempt: QuizAttempt) => {
    setQuizAttempts((prev) => ({ ...prev, [lessonId]: attempt }));
    if (auth.currentUser) {
      try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        await updateDoc(userRef, {
          [`quizAttempts.${lessonId}`]: attempt,
        });
      } catch (error) {
        try { handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser?.uid}`); } catch (e) { console.error(e); }
      }
    }
  };

  const saveLessonNote = async (lessonId: string, text: string) => {
    setLessonNotes((prev) => ({ ...prev, [lessonId]: text }));
    if (auth.currentUser) {
      try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        await updateDoc(userRef, {
          [`lessonNotes.${lessonId}`]: text,
        });
      } catch (error) {
        try { handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser?.uid}`); } catch (e) { console.error(e); }
      }
    }
  };

  const selectLesson = (lesson: Lesson) => {
    setSelectedLesson(lesson);
    window.scrollTo(0, 0);
    if (selectedCourse) {
      updateLastWatched(selectedCourse, lesson);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-raised">
        <div className="w-8 h-8 border-4 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`max-w-4xl lg:max-w-none w-full mx-auto ${onBack ? "bg-surface min-h-screen" : ""}`}
      style={onBack ? {} : { minHeight: "calc(100vh - 120px)" }}
    >
      {screen === "library" && (
        <CourseLibrary
          courses={courses}
          authors={authors}
          categories={categories}
          onSelectCourse={goToCourse}
          completed={completed}
          readFailed={coursesFailed}
          notices={notices}
        />
      )}
      {screen === "overview" && selectedCourse && (
        <CourseOverview
          course={selectedCourse}
          adoption={adoptions.get(selectedCourse.id) ?? null}
          authors={authors}
          onBack={onBack || (() => setScreen("library"))}
          onStartLesson={goToLesson}
          completed={completed}
          quizAttempts={quizAttempts}
          onSelectAuthor={(author) => {
            setSelectedAuthor(author);
            setPreviousScreen("overview");
            setScreen("author");
            window.scrollTo(0, 0);
          }}
        />
      )}
      {screen === "lesson" && selectedCourse && selectedLesson && (
        <LessonView
          course={selectedCourse}
          lesson={selectedLesson}
          authors={authors}
          onBack={() => setScreen("overview")}
          onComplete={toggleComplete}
          completed={completed}
          quizAttempts={quizAttempts}
          onQuizSubmit={submitQuizAttempt}
          lessonNotes={lessonNotes}
          onSaveNote={saveLessonNote}
          onSelectLesson={selectLesson}
          onSelectAuthor={(author) => {
            setSelectedAuthor(author);
            setPreviousScreen("lesson");
            setScreen("author");
            window.scrollTo(0, 0);
          }}
        />
      )}
      {screen === "author" && selectedAuthor && (
        <AuthorProfile
          author={selectedAuthor}
          onBack={() => setScreen(previousScreen || (selectedLesson ? "lesson" : "overview"))}
          courses={courses}
          onSelectCourse={(course) => {
            setSelectedCourse(course);
            setScreen("overview");
            window.scrollTo(0, 0);
          }}
        />
      )}
    </div>
  );
}
