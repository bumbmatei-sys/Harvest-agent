import 'server-only';

import { adminDb } from '@/lib/firebase-admin';
import { handleProblem } from './handle';

/**
 * Storefront addresses. A ministry starts at its own id
 * ({tenantId}.theharvest.app) and may move to another handle. A handle is
 * claimed in storefront_handles/{handle} → { tenantId }; the ministry doc keeps
 * `storefrontHandle`. Changing the handle never moves data: only the address
 * changes. A ministry's own id stays its own, so nobody else can take it.
 */
const handleRef = (handle: string) => adminDb.collection('storefront_handles').doc(handle);

/** The ministry a claimed handle points to, or null when none has claimed it. */
export async function tenantIdForHandle(handle: string): Promise<string | null> {
  const snap = await handleRef(handle).get();
  const tenantId = snap.exists ? snap.data()?.tenantId : null;
  return typeof tenantId === 'string' && tenantId ? tenantId : null;
}

/** The handle a ministry is served at today. */
export function currentHandle(tenantId: string, tenant: Record<string, unknown> | undefined): string {
  return typeof tenant?.storefrontHandle === 'string' && tenant.storefrontHandle ? tenant.storefrontHandle : tenantId;
}

export async function isHandleAvailable(handle: string, tenantId: string): Promise<boolean> {
  if (handle === tenantId) return true;
  const [claimed, tenant] = await Promise.all([handleRef(handle).get(), adminDb.collection('tenants').doc(handle).get()]);
  if (tenant.exists) return false;
  return !claimed.exists || claimed.data()?.tenantId === tenantId;
}

export type HandleChange = { ok: true; handle: string } | { ok: false; status: number; error: string };

/** Moves a ministry's Storefront to a new handle in one transaction, freeing the old one. */
export async function changeHandle(tenantId: string, desired: string): Promise<HandleChange> {
  const problem = handleProblem(desired);
  if (problem) return { ok: false, status: 400, error: problem };
  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  try {
    return await adminDb.runTransaction(async (tx) => {
      const [tenantSnap, claimedSnap, otherTenantSnap] = await Promise.all([
        tx.get(tenantRef), tx.get(handleRef(desired)), tx.get(adminDb.collection('tenants').doc(desired)),
      ]);
      if (!tenantSnap.exists) return { ok: false as const, status: 404, error: 'Ministry not found.' };
      const previous = currentHandle(tenantId, tenantSnap.data());
      if (previous === desired) return { ok: true as const, handle: desired };
      if (desired !== tenantId) {
        if (otherTenantSnap.exists) return { ok: false as const, status: 409, error: 'That address is taken.' };
        if (claimedSnap.exists && claimedSnap.data()?.tenantId !== tenantId) return { ok: false as const, status: 409, error: 'That address is taken.' };
        tx.set(handleRef(desired), { tenantId, claimedAt: new Date().toISOString() });
      }
      if (previous !== tenantId) tx.delete(handleRef(previous));
      tx.update(tenantRef, { storefrontHandle: desired === tenantId ? null : desired, updatedAt: new Date().toISOString() });
      return { ok: true as const, handle: desired };
    });
  } catch {
    return { ok: false, status: 503, error: 'Could not change the address. Please try again.' };
  }
}
