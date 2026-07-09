import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { isSuperAdminEmail, SUPER_ADMIN_EMAILS } from './super-admins';

// Module-level cache for tenantId
let _cachedTenantId: string | null | undefined = undefined;
let _cachedUid: string | null = null;

// Keep backward-compatible export — first email in the array
const SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAILS[0] || 'bumbmatei@proton.me';

/** Platform tenant ID — used as fallback for super admin flows (newsletter, partner, etc.) */
export const PLATFORM_TENANT_ID = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';

/** Subdomains that are NOT tenants (root/marketing/app aliases) */
const NON_TENANT_SUBDOMAINS = new Set(['www', 'app', 'admin']);

/**
 * Resolve the tenantId from the current subdomain. This is the AUTHORITATIVE
 * tenant boundary: on `nations.theharvest.app` the tenant is always `nations`,
 * regardless of which user (even a super admin) is signed in. Returns null on
 * the root/marketing domain, custom domains, or when running on the server.
 *
 * Keep this in sync with the subdomain logic in TenantContext.
 */
export function getTenantIdFromHost(): string | null {
  if (typeof window === 'undefined') return null;
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  // Only real `*.theharvest.app` subdomains are tenant slugs — mirror
  // resolveTenantIdFromHostname() in TenantContext. Preview/staging URLs
  // (`*.vercel.app`) are NOT tenants: their single label (e.g.
  // `harvest-agent-git-…`) would otherwise be read as a bogus tenant here while
  // the admin/write path resolves the real tenant, so tenant-scoped reads
  // (events, livestream) silently miss data that admins created.
  if (parts.length >= 3 && hostname.endsWith('.theharvest.app')) {
    const sub = parts[0];
    if (sub && !NON_TENANT_SUBDOMAINS.has(sub)) return sub;
  }
  return null;
}

/**
 * Get the current user's tenantId from their Firestore user doc.
 * Caches the result per user session to avoid repeated Firestore reads.
 * Returns null for super admins or users without a tenant.
 */
export async function getTenantId(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;

  // Return cache if valid (same user)
  if (_cachedTenantId !== undefined && _cachedUid === user.uid) {
    return _cachedTenantId;
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      _cachedTenantId = userDoc.data().tenantId || null;
      _cachedUid = user.uid;
      return _cachedTenantId;
    }
  } catch (e) {
    console.error('Failed to get tenantId:', e);
  }
  _cachedTenantId = null;
  _cachedUid = user.uid;
  return null;
}

/**
 * Clear the tenantId cache (e.g. after onboarding or plan change).
 */
export function clearTenantCache(): void {
  _cachedTenantId = undefined;
  _cachedUid = null;
}

/**
 * Check if the current user is a super admin.
 * Checks Firestore role first, falls back to env-configured email.
 */
export function isSuperAdmin(): boolean {
  const user = auth.currentUser;
  return isSuperAdminEmail(user?.email);
}

/**
 * True only when the super admin is operating in the platform-wide context
 * (root/apex domain, no tenant subdomain). In this context they get the
 * unlocked cross-tenant view. On any tenant subdomain this returns false —
 * even for a super admin — so they are scoped and plan-gated as that tenant.
 */
export function isPlatformContext(): boolean {
  // A tenant subdomain is the authoritative tenant boundary. If we are on one,
  // we are NOT in the platform context, regardless of who is signed in.
  if (getTenantIdFromHost() !== null) return false;
  // Otherwise (apex/custom/preview), only a super admin gets the platform view.
  return isSuperAdmin();
}

/**
 * True when the signed-in user should receive the unlocked, all-features,
 * cross-tenant super-admin experience. This is the ONLY condition under which
 * plan gating and tenant scoping should be bypassed.
 */
export function hasPlatformOverride(): boolean {
  return isPlatformContext();
}

/**
 * Build a Firestore query constraint for tenant scoping.
 * Returns the tenantId to use in where() clauses.
 *
 * The subdomain is the authoritative tenant boundary, so a query on
 * `nations.theharvest.app` is ALWAYS scoped to `nations` — even for a super
 * admin. This prevents one tenant's data from leaking into another tenant's
 * app. Only on the root/marketing domain (no tenant subdomain) does a super
 * admin get null (unscoped — see all data); regular users there are scoped to
 * their own tenant from their user doc.
 */
export async function getTenantScope(): Promise<string | null> {
  const hostScope = getTenantIdFromHost();
  if (hostScope) return hostScope;
  if (isSuperAdmin()) return null;
  return getTenantId();
}

/**
 * Like getTenantScope(), but on the apex domain a super admin resolves to the
 * platform tenant instead of null — so writes are never orphaned with a null
 * tenantId. Use this for WRITE paths; use getTenantScope() for read scoping.
 *
 * Safe to call from user-initiated handlers (button clicks) and from effects in
 * admin screens, which only mount after auth has hydrated — so isSuperAdmin()
 * (which reads auth.currentUser) is reliable in those contexts.
 */
export async function getWriteTenantScope(): Promise<string | null> {
  const scope = await getTenantScope();
  if (scope) return scope;
  return isSuperAdmin() ? PLATFORM_TENANT_ID : null;
}

export { SUPER_ADMIN_EMAIL };
