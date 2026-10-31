import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';
import type { CommunitySettings } from './settings';
import type { CommunityRecord } from './communities';
import { readPublicListing } from './public-listing';

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
  return { tenantId, slug, name: name.trim(), logoUrl, brandColor: settings.brandColor, shortDescription: settings.shortDescription.trim(), coverUrl: settings.coverUrl, galleryUrls: settings.galleryUrls, longDescription: settings.longDescription, ownerName: settings.ownerName.trim(), isPublic: settings.isPublic, memberCount, updatedAt };
}

/** #576: the Discover listing of a community other than the default one. */
export const communityListingId = (tenantId: string, communityId: string) => `${tenantId}__${communityId}`;

/**
 * #576: the public projection of a published, public community that is not
 * the ministry's default one. Only what its public page already shows leaves.
 */
export function makeCommunitySpaceListing(tenantId: string, tenant: Record<string, unknown>, record: CommunityRecord, memberCount: number, updatedAt: Date) {
  const ownerName = typeof tenant.name === 'string' ? tenant.name.trim().slice(0, 120) : '';
  if (record.isDefault || !Number.isSafeInteger(memberCount) || memberCount < 0) throw new Error('Invalid community listing details.');
  const listing = {
    tenantId, communityId: record.id,
    // The default listing's slug is the ministry's subdomain; this one has no
    // host of its own, so the community id stands in (same shape).
    slug: record.id,
    name: record.name, logoUrl: record.iconUrl, shortDescription: record.tagline.trim(),
    longDescription: record.about, ownerName, isPublic: true, coverUrl: '', galleryUrls: [],
    memberCount, ratingCount: 0, ratingAvg: 0, updatedAt,
  };
  // Discover reads every listing through readPublicListing, and one it refuses
  // fails the whole page: never write one it would refuse.
  readPublicListing(listing);
  return listing;
}
