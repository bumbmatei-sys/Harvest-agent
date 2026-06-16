import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

/**
 * Get the current user's tenantId from their Firestore user doc.
 * Returns null for super admins or users without a tenant.
 */
export async function getTenantId(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      return userDoc.data().tenantId || null;
    }
  } catch (e) {
    console.error('Failed to get tenantId:', e);
  }
  return null;
}

/**
 * Get the current user's tenantId synchronously from a cached value.
 * Falls back to cookie if available.
 */
export function getTenantIdSync(): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';');
  const tc = cookies.find(c => c.trim().startsWith('tenantId='));
  return tc ? tc.split('=')[1].trim() : null;
}

/**
 * Check if the current user is a super admin.
 */
export function isSuperAdmin(): boolean {
  const user = auth.currentUser;
  return !!user && user.email === 'bumbmatei@gmail.com';
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
