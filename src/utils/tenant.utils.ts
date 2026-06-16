import { db } from '../firebase';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp
} from 'firebase/firestore';
import { Tenant, TenantPlan, TenantStatus, TenantConfig } from '../types/tenant.types';

const TENANTS_COLLECTION = 'tenants';

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
  const id = data.subdomain.toLowerCase().trim();
  const now = new Date().toISOString();

  const config: Record<string, any> = {};
  if (data.config?.logo) config.logo = data.config.logo;
  if (data.config?.primaryColor) config.primaryColor = data.config.primaryColor;
  if (data.config?.description) config.description = data.config.description;
  if (data.config?.customDomain) config.customDomain = data.config.customDomain;

  const tenantData = {
    name: data.name,
    subdomain: id,
    plan: data.plan,
    status: 'active' as TenantStatus,
    config,
    adminEmails: data.adminEmails,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, TENANTS_COLLECTION, id), tenantData);
  return id;
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
 * Update a tenant's fields.
 */
export async function updateTenant(
  id: string,
  data: Partial<Pick<Tenant, 'name' | 'plan' | 'status' | 'adminEmails'> & { config: Partial<TenantConfig> }>
): Promise<void> {
  const ref = doc(db, TENANTS_COLLECTION, id);
  const updateData: Record<string, any> = {
    updatedAt: new Date().toISOString(),
  };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.plan !== undefined) updateData.plan = data.plan;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.adminEmails !== undefined) updateData.adminEmails = data.adminEmails;
  // Use dot notation for partial config updates to avoid overwriting existing fields
  if (data.config) {
    if (data.config.logo !== undefined) updateData['config.logo'] = data.config.logo;
    if (data.config.primaryColor !== undefined) updateData['config.primaryColor'] = data.config.primaryColor;
    if (data.config.description !== undefined) updateData['config.description'] = data.config.description;
    if (data.config.customDomain !== undefined) updateData['config.customDomain'] = data.config.customDomain;
  }
  await updateDoc(ref, updateData);
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
