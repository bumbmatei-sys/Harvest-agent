import { headers } from 'next/headers';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantFromHostOrId } from '@/lib/server-tenant';
import { isRestrictedCourse } from '@/lib/courses/access';
import type { Course } from '@/types/course.types';
import type { Tenant } from '@/types/tenant.types';

export interface PublicCourseDoc extends Course {
  status?: string;
  tenantId?: string | null;
  accessMode?: string;
}

export interface PublicCourse {
  course: PublicCourseDoc;
  tenant: Tenant;
  restricted: boolean;
}

/**
 * Whether a course may be shown on the public page at all. Anything but an
 * exact 'published' is hidden (a draft, a missing status, a typo), and so is a
 * course that belongs to a different ministry than the host being visited.
 */
export function isPubliclyShown(course: Pick<PublicCourseDoc, 'status' | 'tenantId'>, tenantId: string): boolean {
  return course.status === 'published' && typeof course.tenantId === 'string' && course.tenantId === tenantId;
}

/**
 * The course behind /courses/[id] for the host being visited, or null when it
 * must not be shown. The tenant is resolved first, so a host with no ministry
 * never causes a course read. The Admin SDK bypasses firestore.rules, so this
 * function IS the access check for the page and its metadata.
 *
 * `tenantIdHint` is the `?t=` fallback a hostless tenant (no subdomain) carries
 * instead of a resolvable host; it is only consulted once the host itself
 * resolves nothing, so a tenant with its own subdomain is unaffected.
 */
export async function loadPublicCourse(id: string, tenantIdHint?: string): Promise<PublicCourse | null> {
  const host = (await headers()).get('host') || '';
  const tenant = await getTenantFromHostOrId(host, tenantIdHint);
  if (!tenant) return null;
  const snap = await adminDb.collection('courses').doc(id).get();
  if (!snap.exists) return null;
  const course = { id: snap.id, ...snap.data() } as PublicCourseDoc;
  if (!isPubliclyShown(course, tenant.id)) return null;
  return { course, tenant, restricted: isRestrictedCourse({ accessMode: course.accessMode as 'everyone' | 'restricted' | undefined }) };
}
