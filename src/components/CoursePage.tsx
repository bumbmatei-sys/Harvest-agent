import React, { useState, useEffect } from "react";
import { doc, getDoc, updateDoc, getDocs, collection, query, where } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Course, Lesson, Author } from "../types/course.types";
import { getAllLessons } from "../utils/course.utils";
import { BG, GOLD } from "../utils/course.constants";
import { CourseLibrary } from "../components/course/CourseLibrary";
import { CourseOverview } from "../components/course/CourseOverview";
import { LessonView } from "../components/course/LessonView";
import { AuthorProfile } from "../components/course/AuthorProfile";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function CoursePage({ 
  onOpenCourse, 
  onBack, 
  initialCourseId, 
  initialLessonId 
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
        handleFirestoreError(error, OperationType.GET, `users/${auth.currentUser?.uid}`);
      }
    };
    fetchUserData();
  }, []);

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
          thumbnail: course.thumbnail || '',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser?.uid}`);
    }
  };

  const [courses, setCourses] = useState<Course[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const authorsSnap = await getDocs(collection(db, "authors"));
        const fetchedAuthors: Author[] = [];
        authorsSnap.forEach((doc) => {
          fetchedAuthors.push({ id: doc.id, ...doc.data() } as Author);
        });
        setAuthors(fetchedAuthors);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, "authors");
      }

      try {
        const catsSnap = await getDocs(collection(db, "categories"));
        const fetchedCats: string[] = ["All"];
        catsSnap.forEach((doc) => {
          fetchedCats.push(doc.data().name);
        });
        setCategories(fetchedCats);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, "categories");
      }

      try {
        const coursesSnap = await getDocs(query(collection(db, "courses"), where("status", "==", "published")));
        const fetchedCourses: Course[] = [];
        coursesSnap.forEach((doc) => {
          fetchedCourses.push({ id: doc.id, ...doc.data() } as Course);
        });
        setCourses(fetchedCourses);

        if (initialCourseId) {
          const course = fetchedCourses.find(c => c.id === initialCourseId);
          if (course) {
            setSelectedCourse(course);
            if (initialLessonId) {
              const allLessons = getAllLessons(course);
              const lesson = allLessons.find(l => l.id === initialLessonId);
              if (lesson) setSelectedLesson(lesson);
            }
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, "courses");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [initialCourseId, initialLessonId]);

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
          completedLessons: Array.from(newCompleted)
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser?.uid}`);
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
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: BG }}>
        <div style={{ color: GOLD, fontFamily: "'Nunito', sans-serif", fontWeight: 700 }}>Loading courses...</div>
      </div>
    );
  }

  return (
    <div className={`max-w-4xl lg:max-w-5xl lg:mx-auto w-full mx-auto ${onBack ? "bg-[#f8f9fa] min-h-screen" : ""}`} style={onBack ? {} : { minHeight: "calc(100vh - 120px)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&family=Lora:wght@400;600;700&display=swap');
      `}</style>
      {screen === "library" && <CourseLibrary courses={courses} authors={authors} categories={categories} onSelectCourse={goToCourse} completed={completed} />}
      {screen === "overview" && selectedCourse && <CourseOverview course={selectedCourse} authors={authors} onBack={onBack || (() => setScreen("library"))} onStartLesson={goToLesson} completed={completed} onSelectAuthor={(author) => { setSelectedAuthor(author); setPreviousScreen("overview"); setScreen("author"); window.scrollTo(0, 0); }} />}
      {screen === "lesson" && selectedCourse && selectedLesson && <LessonView course={selectedCourse} lesson={selectedLesson} authors={authors} onBack={() => setScreen("overview")} onComplete={toggleComplete} completed={completed} onSelectLesson={selectLesson} onSelectAuthor={(author) => { setSelectedAuthor(author); setPreviousScreen("lesson"); setScreen("author"); window.scrollTo(0, 0); }} />}
      {screen === "author" && selectedAuthor && <AuthorProfile author={selectedAuthor} onBack={() => setScreen(previousScreen || (selectedLesson ? "lesson" : "overview"))} />}
    </div>
  );
}
