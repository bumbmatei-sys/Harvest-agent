import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from './firebase-admin';
// Single source of truth, shared with the client and with set-custom-claims.
// This module used to carry its own copy of the list plus a SUPER_ADMIN_EMAILS env
// extension, which let the API's idea of a super admin drift from firestore.rules'.
import { isSuperAdminEmail } from '@/utils/super-admins';
import { getTenantPrivate } from '@/lib/tenant-private';
import { isTenantAdminRole } from './roles';

export interface AuthenticatedUser {
  uid: string;
  email: string | undefined;
  tenantId: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /**
   * When the caller last actually authenticated (`auth_time`, epoch SECONDS —
   * not when this token was minted; a refresh does not move it).
   *
   * Carried so a route guarding an IRREVERSIBLE action can demand a recent
   * sign-in, the way the Firebase client SDK does for `deleteUser`/
   * `updatePassword`. The Admin SDK has no such guard — it is all-powerful by
   * design — so any route that moves one of those operations server-side must
   * re-impose the freshness check itself or it silently WEAKENS the operation.
   * Additive and unread by every existing consumer.
   */
  authTime: number;
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
          if (!isAdmin && isTenantAdminRole(data?.role)) {
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
      // Absent on a malformed token — 0 reads as "ancient", which fails closed
      // for anything gating on freshness rather than waving it through.
      authTime: typeof decoded.auth_time === 'number' ? decoded.auth_time : 0,
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
 * Require PLATFORM-OWNER (super admin) status. Returns 403 for everyone else,
 * including ordinary tenant admins.
 *
 * This is deliberately NOT requireAdmin. requireAdmin passes on
 * `isAdmin || isSuperAdmin`, and `isAdmin` is true for every church admin —
 * verifyAuth even falls back to the users/{uid} role so a freshly-provisioned
 * owner passes without the token claim. That is right for tenant-scoped routes,
 * which then re-scope the read to the caller's OWN tenant. It is wrong for any
 * route whose response spans tenants: there is no second scoping step left to
 * save it, so `isAdmin` alone would hand one church's admin every other
 * church's consumption and every affiliate's earnings.
 *
 * Use this for CROSS-TENANT reads. It is the only gate on the super-admin
 * usage/affiliate routes, so it must never widen to `isAdmin`.
 */
export async function requireSuperAdmin(request: NextRequest): Promise<AuthenticatedUser | NextResponse> {
  const userOrResponse = await requireAuth(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  if (!userOrResponse.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
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
 * Is this caller on the tenant's `adminEmails` roster?
 *
 * 🔴 THE ENTITLEMENT THAT DOES NOT LIVE ON THE USER DOCUMENT.
 *
 * `tenant_private/{tenantId}.adminEmails` grants tenant-admin access on its own
 * — the holder has NO `role: 'admin'` on their users/{uid} doc, so
 * `verifyAuth` reports `isAdmin: false` for them. firestore.rules has always
 * honoured it (`inTenantAdminEmails`, folded into both `isTenantAdmin` and
 * `belongsToTenant`); `requireTenantPermission` has always honoured it. Any
 * check that reads only the user document silently REFUSES a legitimate admin.
 *
 * That is THE-64 exactly: a real admin locked out because their entitlement
 * lived somewhere the check did not look. It cost a production lockout and a
 * three-state fix. Every helper below that gates a tenant-scoped surface must
 * therefore call this, and the billing helpers must most of all — for an
 * owner-by-roster, billing is the one screen they cannot afford to lose.
 *
 * The roster is NOT the fifteen-admin roster. It is server-only
 * (`tenant_private` is `allow read, write: if false`), seeded at provisioning
 * with exactly the buyer's email (stripe webhook / dodo provisioning), and
 * editable only through `/api/tenants/save`, which is `requireSuperAdmin`. No
 * tenant admin can add themselves or anyone else to it. That is what makes it
 * safe to treat as owner-equivalent rather than merely admin-equivalent.
 */
async function isOnTenantRoster(tenantId: string, email: string | undefined): Promise<boolean> {
  const normalized = (email || '').toLowerCase();
  if (!normalized) return false;
  const privateData = await getTenantPrivate(tenantId);
  const adminEmails: string[] = Array.isArray(privateData.adminEmails) ? privateData.adminEmails : [];
  return adminEmails.some((e) => (e || '').toLowerCase() === normalized);
}

/** Result of a successful owner check: the user plus their resolved tenant. */
export interface OwnerContext {
  user: AuthenticatedUser;
  tenantId: string;
  tenantData: FirebaseFirestore.DocumentData;
}

/** Options for {@link requireOwner}. */
export interface RequireOwnerOptions {
  /**
   * The tenant the request is acting on, when the route carries one in its body.
   *
   * ⚠️ This is NOT a way to choose which tenant you are an owner of. It is a
   * CANDIDATE that must then survive the same owner/roster/super-admin proof as
   * a token-resolved tenant would. A caller supplying someone else's tenant id
   * is neither its owner nor on its roster, so they get 403 — see the
   * cross-tenant test. It exists because two callers legitimately cannot be
   * resolved from the token alone:
   *
   *  - a SUPER ADMIN operating from the apex has `tenantId: null`, and
   *  - a ROSTER admin's own user doc may carry no tenantId at all, since the
   *    roster grant does not depend on one.
   *
   * Omit it and the tenant is resolved from the caller's own token exactly as
   * before, which is what `/api/billing/*` does.
   */
  tenantId?: string | null;
}

/**
 * Require the authenticated user to be the plan OWNER of a tenant.
 *
 * 🔴 THIS IS THE GATE ON EVERYTHING THAT CHANGES WHAT A CHURCH PAYS — the plan
 * change, the manage-subscription/cancel portal, and the invoice and statement
 * reads that sit on the same Billing screen. Read and write are deliberately the
 * SAME function, so the two can never drift apart the way they had: before
 * THE-80 the reads were `requireOwner` while the writes were `requireAuth`, so
 * every member of a congregation could raise their church's bill while only the
 * owner could look at it. Anything that only READS or only OPERATES the account
 * — the per-church seat true-up — uses `requireTenantAdmin` instead.
 *
 * Three identities pass, and only three:
 *
 *  1. THE OWNER — `tenants/{tenantId}.ownerId`, the buyer uid set at tenant
 *     creation and immutable.
 *  2. 🔴 A ROSTER ADMIN — `tenant_private.adminEmails`. They have no
 *     `role: 'admin'` on their user doc, so this must NOT go through
 *     `requireAdmin`, which would refuse them before the owner check ran. See
 *     `isOnTenantRoster`: the roster is super-admin-writable only and seeded
 *     with the buyer's own email, so it is an owner-equivalent set, not the
 *     fifteen-admin one.
 *  3. THE SUPER ADMIN — including from the apex with `tenantId: null`, which is
 *     why `options.tenantId` exists.
 *
 * A tenant admin who is none of those — the volunteer with the admin role
 * managing events — gets 403. That is the point: changing what an organisation
 * pays is an owner act.
 *
 * ⚠️ `options.tenantId` never widens access; a caller supplying a tenant they do
 * not own and are not rostered on is refused. See {@link RequireOwnerOptions}.
 *
 * Returns 401 (unauthenticated), 403 (not owner / wrong tenant / no tenant), or
 * 404 (tenant missing) as a NextResponse; otherwise the OwnerContext.
 */
export async function requireOwner(
  request: NextRequest,
  options?: RequireOwnerOptions,
): Promise<OwnerContext | NextResponse> {
  // requireAuth, NOT requireAdmin: a roster admin's `isAdmin` is false, and
  // refusing them here is the THE-64 lockout this gate must not reproduce.
  const userOrResponse = await requireAuth(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const user = userOrResponse;

  const requested = options?.tenantId || null;
  // The caller's own token first; the request's tenant only as a fallback, for
  // the two identities a token cannot resolve (apex super admin, roster admin
  // whose user doc carries no tenantId). Both are re-proved below.
  const tenantId = user.tenantId || requested;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant associated with this account' }, { status: 403 });
  }

  // Super admins reach any tenant, and are the only callers who may retarget
  // away from their own token's tenant.
  if (user.isSuperAdmin) {
    const targetId = requested || tenantId;
    const superDoc = await adminDb.collection('tenants').doc(targetId).get();
    if (!superDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    return { user, tenantId: targetId, tenantData: superDoc.data() || {} };
  }

  // Cross-tenant: an admin of tenant A asking about tenant B is refused before
  // tenant B is read at all — unless they are on B's roster, which IS a grant.
  if (requested && requested !== tenantId && !(await isOnTenantRoster(requested, user.email))) {
    return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
  }
  const targetId = requested || tenantId;

  const tenantDoc = await adminDb.collection('tenants').doc(targetId).get();
  if (!tenantDoc.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  const tenantData = tenantDoc.data() || {};

  if (tenantData.ownerId === user.uid) {
    return { user, tenantId: targetId, tenantData };
  }

  // 🔴 The roster is checked AFTER ownerId and BEFORE the refusal — never
  // skipped. Removing this line locks out every owner-by-roster.
  if (await isOnTenantRoster(targetId, user.email)) {
    return { user, tenantId: targetId, tenantData };
  }

  return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
}

/**
 * Require admin of a SPECIFIC tenant. Returns 403 for a member, and for an
 * admin of any other tenant.
 *
 * Mirrors firestore.rules' `isTenantAdmin(tenantId)` exactly:
 *
 *     isSuperAdmin() || (isAdmin() && userTenantId() == tenantId)
 *                    || inTenantAdminEmails(tenantId)
 *
 * 🔴 That third clause is the one this helper used to be missing. It went
 * through `requireTenantMember`, which compares `user.tenantId` and never reads
 * the roster, and then demanded `isAdmin` — so a roster admin (no `role: 'admin'`
 * on their user doc) was refused twice over by a check whose own docstring said
 * it mirrored a rule that admits them. THE-64 in miniature. It had no callers
 * when this was fixed, so nothing was widened in practice; THE-80's per-church
 * billing routes are its first consumers and they must not carry that drift.
 *
 * Use this for tenant-scoped ADMIN operations. Anything that changes what the
 * organisation PAYS by choice — plan, cancellation, the billing screen itself —
 * uses `requireOwner`, which is strictly narrower.
 */
export async function requireTenantAdmin(
  request: NextRequest,
  tenantId: string
): Promise<AuthenticatedUser | NextResponse> {
  const userOrResponse = await requireAuth(request);
  if (userOrResponse instanceof NextResponse) return userOrResponse;
  const user = userOrResponse;

  // Super admins are implicitly tenant admins, including from the apex where
  // their own tenantId is null.
  if (user.isSuperAdmin) return user;

  // 🔴 The roster grant stands on its own — before the tenant-match and before
  // the isAdmin check, because it depends on neither.
  if (await isOnTenantRoster(tenantId, user.email)) return user;

  if (user.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
  }

  if (!user.isAdmin) {
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

  // The roster lives on the server-only tenant_private doc (mirrors the rules'
  // inTenantAdminEmails, which get()s the same doc).
  const privateData = await getTenantPrivate(tenantId);
  const adminEmails: string[] = Array.isArray(privateData.adminEmails) ? privateData.adminEmails : [];
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
