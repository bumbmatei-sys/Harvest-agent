import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';
import { isCommunityTenantId, type CommunitySource } from '../community-membership';

/** Accept only literal same-origin paths; reject encoded separators/controls too. */
export function safeCommunityReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return null;
    const parsed = new URL(value, 'https://theharvest.app');
    if (parsed.origin !== 'https://theharvest.app' || !/^\/community\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parsed.pathname)) return null;
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
