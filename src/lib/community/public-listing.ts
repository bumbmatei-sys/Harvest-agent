import type { Listing } from '@/components/community/DiscoveryViews';
import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';

/** Validate and project the public index on every read, without passing extra fields to the browser. */
export function readPublicListing(data: Record<string, unknown>): Listing {
  const { tenantId, slug, name, logoUrl, shortDescription, memberCount } = data;
  if (typeof tenantId !== 'string' || !tenantId || typeof slug !== 'string' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) || isNonTenantSubdomain(slug) ||
      typeof name !== 'string' || !name.trim() || typeof logoUrl !== 'string' ||
      typeof shortDescription !== 'string' || !Number.isSafeInteger(memberCount) || (memberCount as number) < 0) {
    throw new Error('Invalid public community listing');
  }
  if (logoUrl) {
    const url = new URL(logoUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid public community logo');
  }
  return { tenantId, slug, name, logoUrl, shortDescription, memberCount: memberCount as number };
}
