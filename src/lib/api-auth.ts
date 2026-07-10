import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from './firebase-admin';

// Server-side super admin emails (must match client-side super-admins.ts)
const SUPER_ADMIN_EMAILS = [
  'bumbmatei@proton.me',
  'bumbmatei@zohomail.eu',
];
const envEmails = process.env.SUPER_ADMIN_EMAILS;
if (envEmails) {
  for (const e of envEmails.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (!SUPER_ADMIN_EMAILS.includes(e)) SUPER_ADMIN_EMAILS.push(e);
  }
}

function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}

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

    // Admin status: prefer the token claim, but fall back to the authoritative
    // server-read user-doc role. A freshly-provisioned owner (build-on-payment) has
    // role 'admin' in their doc, but their cached ID token may not carry the 'admin'
    // claim yet (claims propagate only on token refresh). Without this fallback the
    // client lets them into /admin (it reads the doc role) while requireAdmin routes
    // reject them — e.g. custom domains failing with "Not authorized". The role is
    // server-controlled (users can't self-escalate it via rules), so this is safe.
    let tenantId = decoded.tenantId as string | null || null;
    let isAdmin = decoded.admin === true;
    if (!tenantId || !isAdmin) {
      try {
        const userDoc = await adminDb.collection('users').doc(decoded.uid).get();
        if (userDoc.exists) {
          const data = userDoc.data();
          tenantId = tenantId || data?.tenantId || null;
          if (!isAdmin && ['admin', 'church_admin', 'super_admin'].includes(data?.role)) {
            isAdmin = true;
          }
        }
      } catch {
        // Ignore — user doc might not exist yet
      }
    }

    return {
      uid: decoded.uid,
      email: decoded.email,
      tenantId,
      isAdmin,
      isSuperAdmin: decoded.superAdmin === true || isSuperAdminEmail(decoded.email),
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

/** Result of a successful owner check: the user plus their resolved tenant. */
export interface OwnerContext {
  user: AuthenticatedUser;
  tenantId: string;
  tenantData: FirebaseFirestore.DocumentData;
}

/**
 * Require the authenticated user to be the plan OWNER of their own tenant.
 *
 * Owner identity is `tenants/{tenantId}.ownerId` (the buyer uid, set by the
 * Stripe webhook at tenant creation and immutable). The tenant is resolved from
 * the caller's own token/user-doc — never a client-supplied id — so a user can
 * only ever reach their own tenant's owner-gated surfaces. A created (non-owner)
 * admin, or an admin of a different tenant, gets 403.
 *
 * Returns 401 (unauthenticated), 403 (not admin / not owner / no tenant), or 404
 * (tenant missing) as a NextResponse; otherwise the OwnerContext.
 */
export async function requireOwner(request: NextRequest): Promise<OwnerContext | NextResponse> {
  const userOrResponse = await requireAdmin(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const user = userOrResponse;

  const tenantId = user.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant associated with this account' }, { status: 403 });
  }

  const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  const tenantData = tenantDoc.data() || {};

  if (tenantData.ownerId !== user.uid) {
    return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
  }

  return { user, tenantId, tenantData };
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

/**
 * Require the caller to hold a specific per-admin permission flag for the
 * tenant. Mirrors firestore.rules' hasPermission(perm, tenantId): super
 * admins, the tenant owner (tenants/{tenantId}.ownerId), and adminEmails-
 * roster admins always pass; any other tenant admin must hold the specific
 * permission flag (or fullAccess) on their users/{uid}.permissions map.
 * Non-admins never pass. Use this for admin-moderation API routes that stand
 * in for a client write the rules can't express (e.g. cross-author deletes on
 * a subcollection whose rule can't see the parent doc's tenant/permission).
 */
export async function requireTenantPermission(
  request: NextRequest,
  tenantId: string,
  permission: string
): Promise<AuthenticatedUser | NextResponse> {
  const userOrResponse = await requireTenantMember(request, tenantId);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const user = userOrResponse;

  if (user.isSuperAdmin) return user;

  const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
  const tenantData = tenantDoc.exists ? tenantDoc.data() || {} : {};

  if (tenantData.ownerId === user.uid) return user;

  const adminEmails: string[] = Array.isArray(tenantData.adminEmails) ? tenantData.adminEmails : [];
  const email = (user.email || '').toLowerCase();
  if (email && adminEmails.some((e) => (e || '').toLowerCase() === email)) {
    return user;
  }

  if (!user.isAdmin) {
    return NextResponse.json({ error: 'Tenant admin access required' }, { status: 403 });
  }

  const userDoc = await adminDb.collection('users').doc(user.uid).get();
  const permissions = userDoc.exists ? (userDoc.data()?.permissions || {}) : {};
  if (permissions.fullAccess === true || permissions[permission] === true) {
    return user;
  }

  return NextResponse.json({ error: `Missing '${permission}' permission` }, { status: 403 });
}
