import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';
import type { CommunitySettings } from './settings';

/** Construct an explicit public projection; tenant and user documents never leave the server. */
export function makeDiscoveryListing(tenantId: string, tenant: Record<string, unknown>, settings: CommunitySettings, memberCount: number, updatedAt: Date) {
  const slug = tenant.subdomain;
  const name = tenant.name;
  if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) || isNonTenantSubdomain(slug) ||
      typeof name !== 'string' || !name.trim() || !Number.isSafeInteger(memberCount) || memberCount < 0 || settings.shortDescription.length > 240) {
    throw new Error('Invalid community listing details.');
  }
  const config = tenant.config && typeof tenant.config === 'object' ? tenant.config as Record<string, unknown> : {};
  const logoUrl = settings.logoUrl.trim() || (typeof config.logo === 'string' ? config.logo : '');
  if (logoUrl) {
    let url: URL;
    try { url = new URL(logoUrl); } catch { throw new Error('Enter a valid HTTPS logo URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Enter a valid HTTPS logo URL.');
  }
  return { tenantId, slug, name: name.trim(), logoUrl, shortDescription: settings.shortDescription.trim(), memberCount, updatedAt };
}
