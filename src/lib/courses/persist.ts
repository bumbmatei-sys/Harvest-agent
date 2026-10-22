import { collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '@/firebase';
import { getTenantScope, getWriteTenantScope } from '@/utils/tenant-scope';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { trackProductEvent } from '@/lib/analytics/client';
import type { ProductCourse } from '@/types/course-product.types';
import { LESSON_CONTENT_COLLECTION, splitCourseContent } from '@/lib/courses/content';

export type SaveStatus = 'draft' | 'published';

/** Firestore refuses `undefined` anywhere in a document, so drop it before the write. */
export function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, withoutUndefined(v)]),
    ) as T;
  }
  return value;
}

export function buildPayload(course: ProductCourse, status: SaveStatus, now: string): Record<string, unknown> {
  const { id: _id, ...rest } = course;
  const payload: Record<string, unknown> = {
    ...rest,
    status,
    thumbnail: course.coverImage ?? course.thumbnail ?? '',
    author: course.author?.trim() || 'No Author',
    updatedAt: now,
  };
  if (!course.id) payload.createdAt = now;
  return withoutUndefined(payload);
}

/** A Firestore batch holds 500 writes; stay under it. */
export const MAX_SAVE_WRITES = 450;

/**
 * Writes a course the way the old editor did: an edit checks the document still
 * belongs to this tenant, a create stamps the platform-aware write scope. It
 * THROWS on any failure so the wizard can show it; nothing here swallows an
 * error into a default.
 *
 * The lessons are split: the course document keeps only the outline (titles,
 * durations) and each lesson's content goes to
 * courses/{id}/lessonContent/{lessonId}, which the rules open only to people
 * entitled to the course. Everything lands in ONE batch, so a reader never sees
 * an outline whose content is missing. A lesson that carries no content at all
 * (the editor was handed an outline it never hydrated) is NOT written, so a
 * stripped copy can never overwrite the real content.
 */
export async function saveCourse(course: ProductCourse, status: SaveStatus): Promise<string> {
  const payload = buildPayload(course, status, new Date().toISOString());
  const { levels, content } = splitCourseContent(course.levels ?? []);
  payload.levels = levels;

  let ref;
  let staleContentIds: string[] = [];
  if (course.id) {
    const tenantId = await getTenantScope();
    if (tenantId) {
      const snap = await getDoc(doc(db, 'courses', course.id));
      if (snap.exists() && snap.data().tenantId && snap.data().tenantId !== tenantId) {
        throw new Error('This course belongs to another ministry, so it was not saved.');
      }
    }
    ref = doc(db, 'courses', course.id);
    const existing = await getDocs(collection(db, 'courses', course.id, LESSON_CONTENT_COLLECTION));
    staleContentIds = existing.docs.map((d) => d.id).filter((lessonId) => !(lessonId in content));
  } else {
    ref = doc(collection(db, 'courses'));
  }

  const writable = Object.entries(content).filter(([, body]) => Object.keys(body).length > 0);
  if (writable.length + staleContentIds.length + 1 > MAX_SAVE_WRITES) {
    throw new Error('This course has too many lessons to save at once. Split it into two courses.');
  }

  const batch = writeBatch(db);
  if (course.id) batch.update(ref, payload);
  else batch.set(ref, { ...payload, tenantId: await getWriteTenantScope() });
  for (const [lessonId, body] of writable) {
    batch.set(doc(db, 'courses', ref.id, LESSON_CONTENT_COLLECTION, lessonId), withoutUndefined(body));
  }
  for (const lessonId of staleContentIds) {
    batch.delete(doc(db, 'courses', ref.id, LESSON_CONTENT_COLLECTION, lessonId));
  }
  await batch.commit();

  if (status === 'published') trackProductEvent(ANALYTICS_EVENTS.COURSE_PUBLISHED);
  return ref.id;
}

/**
 * Deletes a course together with its lesson content. Content goes first (its
 * delete rule reads the parent), the course document last.
 */
export async function deleteCourse(courseId: string): Promise<void> {
  const existing = await getDocs(collection(db, 'courses', courseId, LESSON_CONTENT_COLLECTION));
  const refs = existing.docs.map((d) => d.ref);
  for (let i = 0; i < refs.length; i += MAX_SAVE_WRITES) {
    const batch = writeBatch(db);
    refs.slice(i, i + MAX_SAVE_WRITES).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  const last = writeBatch(db);
  last.delete(doc(db, 'courses', courseId));
  await last.commit();
}
