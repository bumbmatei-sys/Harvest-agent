import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireTenantPermission } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';

/** Re-prove membership before reading permissions; token claims can outlive a move. */
export async function authorizeForms(request: NextRequest, tenantId: string) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  if (!user.isSuperAdmin) {
    const currentUser = await adminDb.collection('users').doc(user.uid).get();
    if (!currentUser.exists || currentUser.data()?.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }
  }
  const access = await requireTenantPermission(request, tenantId, 'manageForms');
  // Match hasFormsPermission in the rules, including the legacy permission.
  if (access instanceof NextResponse && access.status === 403) {
    return requireTenantPermission(request, tenantId, 'seeFormsInbox');
  }
  return access;
}
