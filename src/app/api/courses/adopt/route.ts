import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireTenantPermission } from '@/lib/api-auth';
import { captureHandledError } from '@/lib/money-path-sentry';
import { getPlanFeatures } from '@/utils/plan-features';
import { LIBRARY_COURSE_COLLECTIONS } from '@/utils/library-authoring';
import { UNLIMITED, isAtCourseLimit } from '@/utils/course-adoption';

/**
 * Adopt / un-adopt a platform library course (THE-54).
 *
 * The client used to write tenants/{t}/adoptedCourses directly. It no longer
 * can — the rule is now `allow write: if false` (the certificates shape), so
 * this route is the ONLY way an adoption record comes into existence.
 *
 * What that actually buys, stated precisely so nobody over-reads it:
 *
 *  1. VALIDATION. The record is now guaranteed well-formed and truthful:
 *     `libraryCourseId` always equals the doc id, and it always points at a
 *     library course that really exists and is really published. A client write
 *     could previously invent any id, point at a draft, or leave a dangling
 *     pointer — the rules could not see into libraryCourses to tell.
 *  2. `adoptedBy` is the verified caller's uid, not a self-reported field.
 *
 * ⚠️ WHAT THIS DOES NOT BUY: a watertight plan cap.
 *
 * The cap is checked here, but a tenant's OWN courses are still created by a
 * direct client write to /courses under hasPermission('createCourses', …) — as
 * they have been since #228, where AdminCourses.tsx's disabled button is the
 * only check. So adoption is enforced and creation is not. This route makes one
 * path real and leaves the other exactly as it was: no regression, but no
 * watertight cap either. Routing course creation through an API route means
 * refactoring the 1279-line AdminCourseEditor and is deliberately its own PR.
 */

interface AdoptBody {
  tenantId?: unknown;
  libraryCourseId?: unknown;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

async function parseBody(request: NextRequest): Promise<{ tenantId: string; libraryCourseId: string } | NextResponse> {
  let body: AdoptBody;
  try {
    body = (await request.json()) as AdoptBody;
  } catch {
    return badRequest('Invalid JSON body');
  }
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  const libraryCourseId = typeof body.libraryCourseId === 'string' ? body.libraryCourseId.trim() : '';
  if (!tenantId) return badRequest('tenantId is required');
  if (!libraryCourseId) return badRequest('libraryCourseId is required');
  // Doc ids must not contain path separators — a '/' would let a caller escape
  // the adoptedCourses subcollection and address an arbitrary document.
  if (libraryCourseId.includes('/') || tenantId.includes('/')) {
    return badRequest('Invalid id');
  }
  return { tenantId, libraryCourseId };
}

/** POST — adopt a library course into the tenant. Idempotent. */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseBody(request);
    if (parsed instanceof NextResponse) return parsed;
    const { tenantId, libraryCourseId } = parsed;

    // Same permission the rules required for a client write, and the same one
    // creating a course requires. No new permission is invented.
    const userOrResponse = await requireTenantPermission(request, tenantId, 'createCourses');
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const user = userOrResponse;

    const adoptionRef = adminDb
      .collection('tenants').doc(tenantId)
      .collection('adoptedCourses').doc(libraryCourseId);

    // Already adopted → succeed without re-checking the cap. Adoption is
    // idempotent (the doc id IS the library course id), and a tenant sitting at
    // its limit must not get a 403 for re-confirming something it already has.
    const existing = await adoptionRef.get();
    if (existing.exists) {
      return NextResponse.json({ ok: true, alreadyAdopted: true });
    }

    // THE POINTER MUST POINT SOMEWHERE REAL. This is the check no Firestore rule
    // could make: rules cannot read across into libraryCourses to confirm the
    // target exists, let alone that it is published.
    const libraryDoc = await adminDb
      .collection(LIBRARY_COURSE_COLLECTIONS.courses).doc(libraryCourseId).get();
    if (!libraryDoc.exists) {
      return NextResponse.json({ error: 'Library course not found' }, { status: 404 });
    }
    if ((libraryDoc.data()?.status ?? '') !== 'published') {
      return NextResponse.json({ error: 'That course is not published' }, { status: 409 });
    }

    // Plan resolved SERVER-SIDE from the tenant document — never from the
    // client, which could claim any tier. Fail closed to 'plus' (2) when the
    // tenant doc has no plan, matching AdminCourses' long-standing fallback.
    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    const plan = (tenantDoc.data()?.plan as string | undefined) ?? 'plus';
    const maxCourses = getPlanFeatures(plan ?? 'plus').maxCourses;

    if (maxCourses !== UNLIMITED) {
      const [ownSnap, adoptedSnap] = await Promise.all([
        adminDb.collection('courses').where('tenantId', '==', tenantId).count().get(),
        adminDb.collection('tenants').doc(tenantId).collection('adoptedCourses').count().get(),
      ]);
      const ownCount = ownSnap.data().count;
      const adoptedCount = adoptedSnap.data().count;
      if (isAtCourseLimit(ownCount, adoptedCount, maxCourses)) {
        return NextResponse.json(
          {
            error: `Your plan includes up to ${maxCourses} course${maxCourses === 1 ? '' : 's'} (including adopted library courses). Upgrade to add more.`,
            code: 'course_limit_reached',
            maxCourses,
            ownCount,
            adoptedCount,
          },
          { status: 403 },
        );
      }
    }

    // A POINTER, never a copy. libraryCourseId is written from the validated doc
    // id, so the two can never disagree; adoptedBy is the verified caller.
    await adoptionRef.set({
      libraryCourseId,
      adoptedBy: user.uid,
      adoptedAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, libraryCourseId });
  } catch (error) {
    captureHandledError(error, { step: 'course-adopt' });
    return NextResponse.json({ error: 'Failed to adopt course' }, { status: 500 });
  }
}

/**
 * DELETE — un-adopt. Members lose the course; progress records are retained, so
 * re-adopting restores their place. Idempotent: removing something already gone
 * is a success, not a 404.
 */
export async function DELETE(request: NextRequest) {
  try {
    const parsed = await parseBody(request);
    if (parsed instanceof NextResponse) return parsed;
    const { tenantId, libraryCourseId } = parsed;

    const userOrResponse = await requireTenantPermission(request, tenantId, 'createCourses');
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    await adminDb
      .collection('tenants').doc(tenantId)
      .collection('adoptedCourses').doc(libraryCourseId)
      .delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    captureHandledError(error, { step: 'course-unadopt' });
    return NextResponse.json({ error: 'Failed to remove course' }, { status: 500 });
  }
}
