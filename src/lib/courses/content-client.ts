import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/firebase';
import { LESSON_CONTENT_COLLECTION, mergeCourseContent, type ContentByLesson } from '@/lib/courses/content';
import type { Level } from '@/types/course.types';

/**
 * Every lesson's content for one tenant course. The rules answer with
 * permission-denied for anyone not entitled, and that THROWS: a reader who is
 * refused must see "could not load", never an empty lesson.
 */
export async function fetchCourseContent(courseId: string): Promise<ContentByLesson> {
  const snap = await getDocs(collection(db, 'courses', courseId, LESSON_CONTENT_COLLECTION));
  const out: ContentByLesson = {};
  snap.forEach((d) => { out[d.id] = d.data(); });
  return out;
}

/** The course with its lesson content laid back over the outline. */
export async function hydrateCourse<T extends { id: string; levels: Level[] }>(course: T): Promise<T> {
  return mergeCourseContent(course, await fetchCourseContent(course.id));
}
