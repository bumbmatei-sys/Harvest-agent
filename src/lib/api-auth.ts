import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from './firebase-admin';

export interface AuthenticatedUser {
  uid: string;
  email: string | undefined;
  tenantId: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

/**
 * Verify Firebase Auth token from request and return user info.
 * Returns null if not authenticated.
 */
export async function verifyAuth(request: NextRequest): Promise<AuthenticatedUser | null> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await adminAuth.verifyIdToken(idToken);

    // Get tenantId from custom claims or user doc
    let tenantId = decoded.tenantId as string | null || null;
    if (!tenantId) {
      try {
        const userDoc = await adminDb.collection('users').doc(decoded.uid).get();
        if (userDoc.exists) {
          tenantId = userDoc.data()?.tenantId || null;
        }
      } catch {
        // Ignore — user doc might not exist yet
      }
    }

    return {
      uid: decoded.uid,
      email: decoded.email,
      tenantId,
      isAdmin: decoded.admin === true,
      isSuperAdmin: decoded.superAdmin === true,
    };
  } catch {
    return null;
  }
}

/**
 * Require authentication. Returns 401 if not authenticated.
 */
export async function requireAuth(request: NextRequest): Promise<AuthenticatedUser | NextResponse> {
  const user = await verifyAuth(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return user;
}

/**
 * Require admin role. Returns 403 if not admin.
 */
export async function requireAdmin(request: NextRequest): Promise<AuthenticatedUser | NextResponse> {
  const userOrResponse = await requireAuth(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  // Super admins are implicitly admins
  if (!userOrResponse.isAdmin && !userOrResponse.isSuperAdmin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  return userOrResponse;
}

/**
 * Require tenant membership. Returns 403 if user doesn't belong to the tenant.
 */
export async function requireTenantMember(
  request: NextRequest,
  tenantId: string
): Promise<AuthenticatedUser | NextResponse> {
  const userOrResponse = await requireAuth(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  // Super admins can access any tenant
  if (userOrResponse.isSuperAdmin) return userOrResponse;

  if (userOrResponse.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
  }
  return userOrResponse;
}

/**
 * Require tenant admin. Returns 403 if not admin of the specified tenant.
 */
export async function requireTenantAdmin(
  request: NextRequest,
  tenantId: string
): Promise<AuthenticatedUser | NextResponse> {
  const userOrResponse = await requireTenantMember(request, tenantId);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  // Super admins are implicitly tenant admins
  if (!userOrResponse.isAdmin && !userOrResponse.isSuperAdmin) {
    return NextResponse.json({ error: 'Tenant admin access required' }, { status: 403 });
  }
  return userOrResponse;
}
