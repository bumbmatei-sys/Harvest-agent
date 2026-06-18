import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';

const SUPER_ADMIN_EMAIL = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL || 'bumbmatei@proton.me';

/**
 * DELETE /api/tenants/delete?id=<tenantId>
 * Server-side tenant deletion using Firebase Admin SDK (bypasses Firestore rules).
 * Only super admins can delete tenants.
 */
export async function DELETE(request: NextRequest) {
  const userOrResponse = await requireAuth(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  // Check super admin by email (token claim may be stale)
  const isSuper = userOrResponse.isSuperAdmin || userOrResponse.email === SUPER_ADMIN_EMAIL;
  if (!isSuper) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const tenantId = request.nextUrl.searchParams.get('id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenant id' }, { status: 400 });
  }

  try {
    await adminDb.collection('tenants').doc(tenantId).delete();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Tenant delete error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
