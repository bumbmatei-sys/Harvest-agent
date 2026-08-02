import { db, auth } from '../firebase';
import {
  collection, doc, getDoc, getDocs, deleteDoc,
} from 'firebase/firestore';
import { Tenant, TenantPlan, TenantConfig } from '../types/tenant.types';

const TENANTS_COLLECTION = 'tenants';

// Tenant create/update go through /api/tenants/save (Admin SDK) rather than
// the client SDK: the adminEmails roster is dual-written to the server-only
// tenant_private/{id} doc, which a client is not allowed to write, and the
// two writes must land in one atomic batch.
async function postTenantSave(body: Record<string, unknown>): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in.');
  const res = await fetch('/api/tenants/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to save tenant.');
  return data.id as string;
}

/** Outcome of a roster lookup: the roster said yes, said no, or we failed to ask. */
export type RosterAdminStatus = 'admin' | 'not-admin' | 'error';

/**
 * "Is the current user on this tenant's admin roster?", three-state. The roster
 * lives on the server-only tenant_private doc (clients can't read it), so the
 * check goes through /api/tenants/roster-status.
 *
 * A caller that *gates UI* on the answer needs "we could not ask" kept separate
 * from an authoritative "no" — collapsing the two is THE-64, where a roster-only
 * tenant admin's nav was built from a not-yet-answered `false` and the dashboard
 * bounced them back to /admin. Such callers should use this, not the boolean
 * wrapper below, and should also treat "have not asked yet" as its own state.
 */
export async function checkRosterAdminStatus(tenantId: string): Promise<RosterAdminStatus> {
  try {
    const { authFetch } = await import('./auth-fetch');
    const res = await authFetch(`/api/tenants/roster-status?tenantId=${encodeURIComponent(tenantId)}`);
    if (!res.ok) return 'error';
    return (await res.json()).isRosterAdmin === true ? 'admin' : 'not-admin';
  } catch {
    return 'error';
  }
}

/**
 * Boolean form of the roster check. Returns false on any failure — callers
 * treat the roster as a grant, never a denial, so a failed lookup costs the
 * roster bonus but never removes access the user holds via role/permissions.
 */
export async function checkRosterAdmin(tenantId: string): Promise<boolean> {
  return (await checkRosterAdminStatus(tenantId)) === 'admin';
}

/**
 * Create a new tenant.
 * Returns the tenant ID (same as subdomain for easy lookup).
 */
export async function createTenant(data: {
  name: string;
  subdomain: string;
  plan: TenantPlan;
  adminEmails: string[];
  config?: TenantConfig;
}): Promise<string> {
  return postTenantSave({
    name: data.name,
    subdomain: data.subdomain.toLowerCase().trim(),
    plan: data.plan,
    adminEmails: data.adminEmails,
    config: data.config,
  });
}

/**
 * Get a tenant by ID (which is the subdomain).
 */
export async function getTenant(id: string): Promise<Tenant | null> {
  const snap = await getDoc(doc(db, TENANTS_COLLECTION, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Tenant;
}

/**
 * Get all tenants.
 */
export async function getAllTenants(): Promise<Tenant[]> {
  const snap = await getDocs(collection(db, TENANTS_COLLECTION));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Tenant);
}

/**
 * Update a tenant's fields. (`plan` is intentionally not sent — the Stripe
 * webhook is the source of truth for plan changes on live tenants.)
 */
export async function updateTenant(
  id: string,
  data: Partial<Pick<Tenant, 'name' | 'plan' | 'status'>> & { adminEmails?: string[]; config?: Partial<TenantConfig> }
): Promise<void> {
  await postTenantSave({
    id,
    name: data.name,
    status: data.status,
    adminEmails: data.adminEmails,
    config: data.config,
  });
}

/**
 * Delete a tenant.
 */
export async function deleteTenant(id: string): Promise<void> {
  await deleteDoc(doc(db, TENANTS_COLLECTION, id));
}

/**
 * Check if a subdomain is already taken.
 */
export async function isSubdomainAvailable(subdomain: string): Promise<boolean> {
  const snap = await getDoc(doc(db, TENANTS_COLLECTION, subdomain.toLowerCase().trim()));
  return !snap.exists();
}
