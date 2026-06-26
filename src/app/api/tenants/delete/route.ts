import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';

/**
 * DELETE /api/tenants/delete?id=<tenantId>
 * Server-side tenant deletion using Firebase Admin SDK (bypasses Firestore rules).
 * Only super admins can delete tenants.
 *
 * Uses recursiveDelete() to remove the tenant document AND all of its
 * subcollections (settings, members, and any others nested under it).
 * Firestore document deletes do NOT cascade to subcollections on their
 * own — a plain .delete() on the tenant doc would leave that data
 * orphaned in the database permanently. This does NOT touch other
 * top-level collections that merely reference this tenantId (e.g.
 * courses, blog_posts, community_posts, rag_sources/rag_chunks) since
 * those are separate collections, not subcollections of this doc — if
 * full cleanup of those is required, that needs to be handled
 * separately (e.g. a batched query-and-delete per collection).
 */

export async function DELETE(request: NextRequest) {
  const userOrResponse = await requireAuth(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  // Super admin check (isSuperAdmin already includes email fallback from api-auth)
  if (!userOrResponse.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const tenantId = request.nextUrl.searchParams.get('id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenant id' }, { status: 400 });
  }

  try {
    const tenantRef = adminDb.collection('tenants').doc(tenantId);

    const tenantSnap = await tenantRef.get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // recursiveDelete walks and deletes the document plus every
    // subcollection beneath it (settings/, members/, etc.), avoiding the
    // orphaned-data bug a plain .delete() would cause.
    await adminDb.recursiveDelete(tenantRef);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Tenant delete error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
