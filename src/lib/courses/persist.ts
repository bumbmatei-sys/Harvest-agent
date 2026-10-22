import { addDoc, collection, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebase';
import { getTenantScope, getWriteTenantScope } from '@/utils/tenant-scope';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { trackProductEvent } from '@/lib/analytics/client';
import type { ProductCourse } from '@/types/course-product.types';

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

/**
 * Writes a course the way the old editor did: an edit checks the document still
 * belongs to this tenant, a create stamps the platform-aware write scope. It
 * THROWS on any failure so the wizard can show it; nothing here swallows an
 * error into a default.
 */
export async function saveCourse(course: ProductCourse, status: SaveStatus): Promise<string> {
  const payload = buildPayload(course, status, new Date().toISOString());
  let id: string;
  if (course.id) {
    const tenantId = await getTenantScope();
    if (tenantId) {
      const snap = await getDoc(doc(db, 'courses', course.id));
      if (snap.exists() && snap.data().tenantId && snap.data().tenantId !== tenantId) {
        throw new Error('This course belongs to another ministry, so it was not saved.');
      }
    }
    await updateDoc(doc(db, 'courses', course.id), payload);
    id = course.id;
  } else {
    const writeTenantId = await getWriteTenantScope();
    const ref = await addDoc(collection(db, 'courses'), { ...payload, tenantId: writeTenantId });
    id = ref.id;
  }
  if (status === 'published') trackProductEvent(ANALYTICS_EVENTS.COURSE_PUBLISHED);
  return id;
}
