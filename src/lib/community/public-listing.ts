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
  const coverUrl = data.coverUrl === undefined ? '' : data.coverUrl;
  const galleryUrls = data.galleryUrls === undefined ? [] : data.galleryUrls;
  const longDescription = data.longDescription === undefined ? '' : data.longDescription;
  const ownerName = data.ownerName === undefined ? '' : data.ownerName;
  const isPublic = data.isPublic === undefined ? true : data.isPublic;
  const validImage = (value: unknown) => {
    if (typeof value !== 'string' || value.length > 2048) return false;
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  };
  if (!validImage(coverUrl) || !Array.isArray(galleryUrls) || galleryUrls.length > 8 || galleryUrls.some(url => !url || !validImage(url)) || typeof longDescription !== 'string' || longDescription.length > 10000 || typeof ownerName !== 'string' || ownerName.length > 120 || typeof isPublic !== 'boolean') throw new Error('Invalid public community details');
  return { tenantId, slug, name, logoUrl, shortDescription, memberCount: memberCount as number, coverUrl: coverUrl as string, galleryUrls: galleryUrls as string[], longDescription, ownerName, isPublic };

}
