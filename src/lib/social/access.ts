import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth, type AuthenticatedUser } from '@/lib/api-auth';
import { firebaseAdminCredentialsAvailable } from '@/lib/firebase-admin-credentials';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantPrivate } from '@/lib/tenant-private';
import { getEffectiveFeatures, readTenantAddons, toTenantPlan } from '@/utils/plan-features';
import { SOCIAL_SAMPLE_SCOPE, socialMode, socialSampleWithoutEntitlement } from './mode';

export interface SocialAccess {
  readonly tenantId: string;
  readonly entitled: boolean;
  /** Seeded fiction. The scheduler shows the sample banner. */
  readonly sample: boolean;
  /** The session layer must use the mock client and must not call Zernio. */
  readonly mockOnly: boolean;
}

/**
 * The signed-in person, already verified from their token. The service does
 * not read the request. `isSuperAdmin` is the claim `verifyAuth` set, never
 * a body, header, or query flag.
 */
export interface SocialActor {
  readonly uid: string;
  readonly email: string | undefined;
  /**
   * Firebase `email_verified` from the ID token. A roster match is an email
   * match, and an unverified signup can carry an admin's address.
   */
  readonly emailVerified: boolean;
  readonly tenantId: string | null;
  readonly isSuperAdmin: boolean;
  readonly requestedTenantId: string | null;
}

/**
 * The same people who see Social in the nav (`hasFullAccess`): a super
 * admin, a roster admin, the legacy church-admin role, or an admin whose
 * permission map has full access. A role of `admin` alone does not.
 *
 * `isSuperAdmin` is the flag `verifyAuth` set from the verified token
 * (the platform-admin claim, or the frozen super-admin email list). Nothing
 * in the body, the query, or a header is consulted.
 */
async function hasSocialFullAccess(user: AuthenticatedUser, tenantId: string): Promise<boolean> {
  if (user.isSuperAdmin) return true;
  const privateData = await getTenantPrivate(tenantId);
  const adminEmails: string[] = Array.isArray(privateData.adminEmails) ? privateData.adminEmails : [];
  const email = (user.email || '').toLowerCase();
  if (user.emailVerified === true && email && adminEmails.some((entry) => (entry || '').toLowerCase() === email)) {
    return true;
  }
  const userSnap = await adminDb.collection('users').doc(user.uid).get();
  const data = userSnap.exists ? userSnap.data() || {} : {};
  const permissions = (data.permissions ?? {}) as Record<string, unknown>;
  if (data.role === 'church_admin') return true;
  if (permissions.fullAccess === true) return true;
  return false;
}

/**
 * Authenticated, allowed to open Social, and entitled — or a preview that
 * may show seeded fiction.
 *
 * The add-on check and the super-admin bypass are one expression, evaluated
 * here. Nothing in this function writes `tenants.addons`. The Dodo webhook
 * stays the only writer of that field.
 *
 * A super admin's token tenant is null on the apex and on a Vercel preview.
 * On preview that is the in-memory sample, not `tenants/null`. In production
 * the sample is not a fallback: there is no tenant to attach a live profile
 * to, so the route answers 503.
 */
function actorUser(actor: SocialActor): AuthenticatedUser {
  return {
    uid: actor.uid,
    email: actor.email,
    tenantId: actor.tenantId,
    isAdmin: false,
    isSuperAdmin: actor.isSuperAdmin,
    emailVerified: actor.emailVerified,
    authTime: 0,
  };
}

/**
 * Role, add-on (with the super-admin bypass), and tenant scope for one actor.
 * Nothing here writes `tenants.addons`.
 */
export async function authorizeSocialActor(actor: SocialActor): Promise<SocialAccess | NextResponse> {
  const headerTenant = actor.requestedTenantId;
  const mode = socialMode();
  const sampleGate = mode === 'mock' && socialSampleWithoutEntitlement();

  if (actor.isSuperAdmin && !actor.tenantId) {
    if (headerTenant) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }
    if (sampleGate) {
      return { tenantId: SOCIAL_SAMPLE_SCOPE, entitled: true, sample: true, mockOnly: true };
    }
    return NextResponse.json({ error: 'social_unavailable' }, { status: 503 });
  }

  if (!actor.tenantId) {
    return NextResponse.json({ error: 'No tenant associated with this account' }, { status: 403 });
  }
  if (headerTenant && headerTenant !== actor.tenantId) {
    return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
  }

  let allowed = false;
  try {
    allowed = await hasSocialFullAccess(actorUser(actor), actor.tenantId);
  } catch (error) {
    console.error('Social scheduling could not verify the role', error);
    return NextResponse.json({ error: 'social_unavailable' }, { status: 503 });
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  if (!firebaseAdminCredentialsAvailable()) {
    console.error('Social scheduling skipped Firebase admin: credentials are not available');
    if (sampleGate) {
      return { tenantId: actor.tenantId, entitled: actor.isSuperAdmin, sample: true, mockOnly: true };
    }
    return NextResponse.json({ error: 'social_unavailable' }, { status: 503 });
  }

  try {
    const snap = await adminDb.collection('tenants').doc(actor.tenantId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const data = snap.data() || {};
    const features = getEffectiveFeatures(toTenantPlan(data.plan), readTenantAddons(data.addons));
    const holdsAddon = features.socialScheduler === true;
    const entitled = holdsAddon || actor.isSuperAdmin;
    if (!entitled && !sampleGate) {
      return NextResponse.json({ error: 'social_scheduler_not_entitled' }, { status: 403 });
    }
    if (mode === 'unavailable') {
      return NextResponse.json({ error: 'social_unavailable' }, { status: 503 });
    }
    const mock = mode === 'mock';
    return { tenantId: actor.tenantId, entitled, sample: mock, mockOnly: mock };
  } catch (error) {
    console.error('Social scheduling could not read Firebase admin', error);
    if (sampleGate) {
      return { tenantId: actor.tenantId, entitled: actor.isSuperAdmin, sample: true, mockOnly: true };
    }
    return NextResponse.json({ error: 'social_unavailable' }, { status: 503 });
  }
}

export async function requireSocialAccess(request: NextRequest): Promise<SocialAccess | NextResponse> {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  return authorizeSocialActor({
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified === true,
    tenantId: user.tenantId,
    isSuperAdmin: user.isSuperAdmin,
    requestedTenantId: request.headers.get('x-harvest-tenant'),
  });
}
