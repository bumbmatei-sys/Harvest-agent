import { adminDb } from './firebase-admin';
import type { Tenant } from '@/types/tenant.types';
import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';

/**
 * Resolves a tenant from the HTTP Host header (server-side only).
 * Handles both subdomain pattern (nations.theharvest.app) and custom domains.
 * Returns null for the root domain, non-tenant subdomains (www/app/admin/
 * affiliate), or unknown hosts.
 */
export async function getTenantFromHost(host: string): Promise<Tenant | null> {
  const hostname = host.split(':')[0]; // strip port
  const parts = hostname.split('.');

  // Subdomain pattern: <tenantId>.theharvest.app
  if (parts.length >= 3 && hostname.endsWith('.theharvest.app')) {
    const subdomain = parts[0];
    // Non-tenant subdomains (www/app/admin/affiliate) are platform aliases, not
    // tenants — mirror the client resolvers so SSR branding never treats them as
    // a tenant. Shared NON_TENANT_SUBDOMAINS keeps server and client in sync.
    if (isNonTenantSubdomain(subdomain)) return null;

    try {
      const snap = await adminDb.collection('tenants').doc(subdomain).get();
      if (!snap.exists || snap.data()?.plan === 'free' || ((snap.data()?.plan != null || snap.data()?.subdomain != null) && snap.data()?.subdomain !== subdomain)) return null;
      return { id: snap.id, ...snap.data() } as Tenant;
    } catch {
      return null;
    }
  }

  // Custom domain fallback (Community / max+)
  try {
    const snap = await adminDb
      .collection('tenants')
      .where('config.customDomain', '==', hostname)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() } as Tenant;
  } catch {
    return null;
  }
}

/**
 * `getTenantFromHost`, with a fallback for a tenant that has no subdomain and
 * therefore no host of its own: every hostless tenant's public pages live on
 * theharvest.app, carrying their own tenant id as a query param instead of a
 * host segment. Only reached when the host itself resolves nothing, so a
 * tenant that DOES have a subdomain is never looked up any other way.
 */
export async function getTenantFromHostOrId(host: string, idHint?: string | string[] | null): Promise<Tenant | null> {
  const tenant = await getTenantFromHost(host);
  if (tenant) return tenant;
  const id = Array.isArray(idHint) ? idHint[0] : idHint;
  if (typeof id !== 'string' || !id || id.length > 150 || id.includes('/')) return null;
  try {
    const snap = await adminDb.collection('tenants').doc(id).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() } as Tenant;
  } catch {
    return null;
  }
}
