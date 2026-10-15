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
 * The tenant is the one on the verified token. `verifyAuth` fills that from
 * the custom claim, or from the server-side user document when the claim is
 * absent. A tenant id in the body or the query is never read: a caller with
 * no tenant of their own must not be able to name one.
 *
 * What passes, for that tenant only:
 *   • the tenant owner (`tenants/{id}.ownerId`) — a uid match
 *   • a roster admin (`tenant_private.adminEmails`) whose email is verified
 *   • a tenant admin of THIS tenant with `fullAccess`, or the legacy
 *     `church_admin` role
 *
 * The roster match is the only email match, and it requires
 * `email_verified`. An unverified signup can carry an admin's address.
 *
 * A super admin is not a bypass. Their token tenant is null, and nothing in
 * the request may supply one.
 */

export const CHURCH_EXPORT_DENIED = 'Tenant admin access required';

export interface ChurchExportCaller {
  user: AuthenticatedUser;
  tenantId: string;
}

export async function requireChurchExportAdmin(
  request: NextRequest,
): Promise<ChurchExportCaller | NextResponse> {
  const userOrResponse = await requireAuth(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const user = userOrResponse;

  const tenantId = user.tenantId;
  if (!tenantId || !isSafeTenantId(tenantId)) {
    return NextResponse.json({ error: 'No tenant associated with this account' }, { status: 403 });
  }

  const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  const tenant = tenantSnap.data() || {};

  if (tenant.ownerId === user.uid) return { user, tenantId };

  if (user.emailVerified === true) {
    const privateData = await getTenantPrivate(tenantId);
    const adminEmails: string[] = Array.isArray(privateData.adminEmails) ? privateData.adminEmails : [];
    const email = (user.email || '').toLowerCase();
    if (email && adminEmails.some((entry) => (entry || '').toLowerCase() === email)) {
      return { user, tenantId };
    }
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
