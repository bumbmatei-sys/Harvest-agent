import { adminDb } from './firebase-admin';
import type { Tenant } from '@/types/tenant.types';

/**
 * Resolves a tenant from the HTTP Host header (server-side only).
 * Handles both subdomain pattern (nations.theharvest.app) and custom domains.
 * Returns null for the root domain, www, or unknown hosts.
 */
export async function getTenantFromHost(host: string): Promise<Tenant | null> {
  const hostname = host.split(':')[0]; // strip port
  const parts = hostname.split('.');

  // Subdomain pattern: <tenantId>.theharvest.app
  if (parts.length >= 3 && hostname.endsWith('.theharvest.app')) {
    const subdomain = parts[0];
    if (subdomain === 'www') return null;

    try {
      const snap = await adminDb.collection('tenants').doc(subdomain).get();
      if (!snap.exists) return null;
      return { id: snap.id, ...snap.data() } as Tenant;
    } catch {
      return null;
    }
  }

  // Custom domain fallback (Ministry only)
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
