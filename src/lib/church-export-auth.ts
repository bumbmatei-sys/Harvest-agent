import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, type AuthenticatedUser } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantPrivate } from '@/lib/tenant-private';
import { isSafeTenantId } from '@/lib/church-export';

/**
 * THE-228 — who may export a whole church.
 *
 * `manageCRM` is the authority to edit a contact. It is not the authority to
 * download every member, gift and event. This gate therefore does not call
 * `requireTenantPermission(..., 'manageCRM')`, and a tenant admin whose only
 * grant is that flag is refused.
 *
 * What passes:
 *   • the tenant owner (`tenants/{id}.ownerId`)
 *   • a roster admin (`tenant_private.adminEmails`) — the grant that does not
 *     live on the user document
 *   • a tenant admin of THIS tenant with `fullAccess`, or the legacy
 *     `church_admin` role
 *
 * A super admin is not a bypass. Their token tenant is null, and a body
 * tenant id must not let the platform account download a church they do not
 * own. A caller whose token already names a tenant cannot name a different one.
 */

export const CHURCH_EXPORT_DENIED = 'Tenant admin access required';

export interface ChurchExportCaller {
  user: AuthenticatedUser;
  tenantId: string;
}

export async function requireChurchExportAdmin(
  request: NextRequest,
  requestedTenantId: string | null,
): Promise<ChurchExportCaller | NextResponse> {
  const userOrResponse = await requireAuth(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const user = userOrResponse;

  if (requestedTenantId && !isSafeTenantId(requestedTenantId)) {
    return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
  }

  // Token already names a church. A different id in the body is another church.
  if (requestedTenantId && user.tenantId && requestedTenantId !== user.tenantId) {
    return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
  }

  const tenantId = user.tenantId || requestedTenantId;
  if (!tenantId || !isSafeTenantId(tenantId)) {
    return NextResponse.json({ error: 'No tenant associated with this account' }, { status: 403 });
  }

  const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  const tenant = tenantSnap.data() || {};

  if (tenant.ownerId === user.uid) return { user, tenantId };

  const privateData = await getTenantPrivate(tenantId);
  const adminEmails: string[] = Array.isArray(privateData.adminEmails) ? privateData.adminEmails : [];
  const email = (user.email || '').toLowerCase();
  if (email && adminEmails.some((entry) => (entry || '').toLowerCase() === email)) {
    return { user, tenantId };
  }

  if (user.tenantId !== tenantId || !user.isAdmin) {
    return NextResponse.json({ error: CHURCH_EXPORT_DENIED }, { status: 403 });
  }

  const userSnap = await adminDb.collection('users').doc(user.uid).get();
  const data = userSnap.exists ? userSnap.data() || {} : {};
  const permissions = (data.permissions ?? {}) as Record<string, unknown>;
  if (data.role === 'church_admin' || permissions.fullAccess === true) {
    return { user, tenantId };
  }

  return NextResponse.json({ error: CHURCH_EXPORT_DENIED }, { status: 403 });
}
