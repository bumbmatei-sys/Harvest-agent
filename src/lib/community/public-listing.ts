import { DEFAULT_COMMUNITY_BRAND, isCommunityBrandColor } from './branding';
import type { Listing } from '@/components/community/DiscoveryViews';
import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';
import { DEFAULT_COMMUNITY_ID, isCommunityId } from './communities';

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
  const brandColor = data.brandColor === undefined ? DEFAULT_COMMUNITY_BRAND : data.brandColor;
  if (!isCommunityBrandColor(brandColor)) throw new Error('Invalid public community colour');
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
  const ratingCount = data.ratingCount === undefined && data.ratingAvg === undefined ? 0 : data.ratingCount;
  const ratingAvg = data.ratingCount === undefined && data.ratingAvg === undefined ? 0 : data.ratingAvg;
  if (!Number.isSafeInteger(ratingCount) || (ratingCount as number) < 0 || typeof ratingAvg !== 'number' || !Number.isFinite(ratingAvg) || (ratingCount === 0 ? ratingAvg !== 0 : ratingAvg < 1 || ratingAvg > 5)) throw new Error('Invalid public community rating');
  // #576: a listing for a community other than the ministry's default one.
  const communityId = data.communityId;
  if (communityId !== undefined && (!isCommunityId(communityId) || communityId === DEFAULT_COMMUNITY_ID)) throw new Error('Invalid public community listing');
  return { ...(communityId !== undefined ? { communityId } : {}), tenantId, slug, name, logoUrl, brandColor, shortDescription, memberCount: memberCount as number, coverUrl: coverUrl as string, galleryUrls: galleryUrls as string[], longDescription, ownerName, isPublic, ratingCount: ratingCount as number, ratingAvg };

}
