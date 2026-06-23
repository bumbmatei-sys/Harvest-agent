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
 * Build a Firestore query constraint for tenant scoping.
 * Returns the tenantId to use in where() clauses.
 * Super admins get null (no filtering — see all data).
 */
export async function getTenantScope(): Promise<string | null> {
  if (isSuperAdmin()) return null;
  return getTenantId();
}

export { SUPER_ADMIN_EMAIL };
