"use client";
import React, { useState, useEffect } from "react";
import { doc, getDoc, updateDoc, getDocs, collection, query, where } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Course, Lesson, Author } from "../types/course.types";
import { getAllLessons } from "../utils/course.utils";
import { CourseLibrary } from "../components/course/CourseLibrary";
import { CourseOverview } from "../components/course/CourseOverview";
import { LessonView } from "../components/course/LessonView";
import { AuthorProfile } from "../components/course/AuthorProfile";
import { OperationType, handleFirestoreError } from "../utils/firestore-errors";
import { getTenantScope } from "../utils/tenant-scope";

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

  const [courses, setCourses] = useState<Course[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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
        const authorsSnap = await getDocs(collection(db, "authors"));
        const fetchedAuthors: Author[] = [];
        authorsSnap.forEach((d) => {
          fetchedAuthors.push({ id: d.id, ...d.data() } as Author);
        });
        setAuthors(fetchedAuthors);
      } catch (error) {
        try { handleFirestoreError(error, OperationType.GET, "authors"); } catch (e) { console.error(e); }
      }

      try {
        const catsSnap = await getDocs(collection(db, "categories"));
        const fetchedCats: string[] = ["All"];
        catsSnap.forEach((d) => {
          fetchedCats.push(d.data().name);
        });
        setCategories(fetchedCats);
      } catch (error) {
        try { handleFirestoreError(error, OperationType.GET, "categories"); } catch (e) { console.error(e); }
      }

      try {
        const tenantId = await getTenantScope();
        // Single-field filter only (status); tenant scoping applied client-side.
        const coursesQuery = query(collection(db, "courses"), where("status", "==", "published"));
        const coursesSnap = await getDocs(coursesQuery);
        const fetchedCourses: Course[] = [];
        coursesSnap.forEach((d) => {
          if (tenantId && d.data().tenantId !== tenantId) return;
          fetchedCourses.push({ id: d.id, ...d.data() } as Course);
        });
        setCourses(fetchedCourses);

        if (initialCourseId) {
          const course = fetchedCourses.find((c) => c.id === initialCourseId);
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

  const selectLesson = (lesson: Lesson) => {
    setSelectedLesson(lesson);
    window.scrollTo(0, 0);
    if (selectedCourse) {
      updateLastWatched(selectedCourse, lesson);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`max-w-4xl lg:max-w-none w-full mx-auto ${onBack ? "bg-[#f8f9fa] min-h-screen" : ""}`}
      style={onBack ? {} : { minHeight: "calc(100vh - 120px)" }}
    >
      {screen === "library" && (
        <CourseLibrary
          courses={courses}
          authors={authors}
          categories={categories}
          onSelectCourse={goToCourse}
          completed={completed}
        />
      )}
      {screen === "overview" && selectedCourse && (
        <CourseOverview
          course={selectedCourse}
          authors={authors}
          onBack={onBack || (() => setScreen("library"))}
          onStartLesson={goToLesson}
          completed={completed}
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
