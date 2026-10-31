import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';
import { isCommunityTenantId, type CommunitySource } from '../community-membership';

/**
 * A ministry's default community page, or (#576) one of its other communities:
 * /community/{tenantId} or /community/{tenantId}/{communityId}.
 */
const COMMUNITY_RETURN_PATH = /^\/community\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?:\/[a-z0-9][a-z0-9-]{0,62})?$/;
const COMMUNITY_SPACE_PATH = /^\/community\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/([a-z0-9][a-z0-9-]{0,62})$/;

/** Accept only literal same-origin paths; reject encoded separators/controls too. */
export function safeCommunityReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return null;
    const parsed = new URL(value, 'https://theharvest.app');
    if (parsed.origin !== 'https://theharvest.app' || !COMMUNITY_RETURN_PATH.test(parsed.pathname)) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch { return null; }
}
export function communityPath(tenantId: string): string {
  if (!isCommunityTenantId(tenantId)) throw new Error('Invalid community.');
  return `/community/${tenantId}`;
}
export function communitySource(search: string): CommunitySource {
  const params = new URLSearchParams(search);
  return params.get('src') === 'website' ? 'website' : params.get('src') === 'discover' ? 'discover' : 'link';
}
export function communityJoinPath(tenantId: string, source: CommunitySource): string {
  return `${communityPath(tenantId)}?join=1&src=${source}`;
}
/**
 * A community join signs up through `?signup=free`. Starting any other funnel
 * in the same tab drops a leftover join return, so a church or paid signup is
 * never pulled into a community page when its onboarding completes.
 */
export function dropCommunityReturnForFunnel(signup: string, storage: Pick<Storage, 'removeItem'>): void {
  if (signup !== 'free') storage.removeItem('harvest_community_return');
}
export function communitySignupPath(returnPath: string): string {
  const safe = safeCommunityReturnPath(returnPath);
  if (!safe) throw new Error('Invalid community return path.');
  return `/auth?signup=free&returnTo=${encodeURIComponent(safe)}`;
}
/** Explicit member-page scope only. Never changes host/account/staff identity. */
export function communityIdFromPath(pathname: string): string | null {
  const match = /^\/community\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(pathname);
  return match ? match[1] : null;
}

/** Tenant-host discovery hands off to the central member app. Local/apex links
 * stay relative, preserving the signed-in central-origin Firebase session. */
export function communityHref(path: string, hostname = typeof window === 'undefined' ? '' : window.location.hostname): string {
  if (!safeCommunityReturnPath(path)) throw new Error('Invalid community path.');
  const tenantHost = hostname.endsWith('.theharvest.app') && !isNonTenantSubdomain(hostname.split('.')[0]);
  return tenantHost ? `https://theharvest.app${path}` : path;
}

/** #576: the tenant and community of a community space page, or null. */
export function communitySpaceFromPath(pathname: string): { tenantId: string; communityId: string } | null {
  const match = COMMUNITY_SPACE_PATH.exec(pathname);
  return match ? { tenantId: match[1], communityId: match[2] } : null;
}
export function communitySpacePath(tenantId: string, communityId: string): string {
  const path = `/community/${tenantId}/${communityId}`;
  if (!communitySpaceFromPath(path)) throw new Error('Invalid community.');
  return path;
}
