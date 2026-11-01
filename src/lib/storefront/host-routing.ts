import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';

/**
 * What a ministry's subdomain serves (Matei, 2026-11-01: a hard switch). The
 * admin and member app live on theharvest.app only; {handle}.theharvest.app is
 * the ministry's public face: its Storefront at the root and its public pages.
 * App paths are not served there any more and land on the Storefront.
 *
 * Pure and edge-safe, so the middleware and its tests share it.
 */
const PUBLIC_PREFIXES = [
  '/storefront', '/blog', '/event', '/form', '/giving', '/calendar', '/courses', '/campaign', '/pledge',
  '/post', '/checkin', '/rota', '/n', '/s', '/subscribe', '/p', '/api', '/_next', '/preview', '/dev',
] as const;
const PUBLIC_FILES = new Set(['/manifest.webmanifest', '/robots.txt', '/sitemap.xml', '/favicon.ico', '/llms.txt']);

/** The label of a ministry subdomain, or null for theharvest.app itself, platform aliases and other hosts. */
export function ministrySubdomain(host: string): string | null {
  const hostname = host.split(':')[0].toLowerCase();
  if (!hostname.endsWith('.theharvest.app')) return null;
  const parts = hostname.split('.');
  if (parts.length !== 3) return null;
  return isNonTenantSubdomain(parts[0]) ? null : parts[0];
}

export type HostRoute = { readonly action: 'next' } | { readonly action: 'rewrite'; readonly to: string };

export function routeForHost(host: string, pathname: string): HostRoute {
  if (!ministrySubdomain(host)) return { action: 'next' };
  if (pathname === '/' || pathname === '') return { action: 'rewrite', to: '/storefront' };
  if (pathname === '/blog' || pathname === '/blog/') return { action: 'rewrite', to: '/storefront/blog' };
  if (PUBLIC_FILES.has(pathname) || /\.[a-z0-9]{2,5}$/i.test(pathname)) return { action: 'next' };
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return { action: 'next' };
  }
  return { action: 'rewrite', to: '/storefront' };
}
