import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Subdomain + custom domain routing middleware.
 *
 * Resolution order:
 * 1. ?tenant=xxx query param (testing override)
 * 2. admin.theharvest.app → isAdmin cookie
 * 3. *.theharvest.app subdomain → tenantId cookie
 * 4. Custom domain → resolve via API, cache in cookie
 * 5. Base domains → no tenant (global platform)
 */
export async function middleware(request: NextRequest) {
  const { hostname } = request.nextUrl;
  const response = NextResponse.next();

  // ─── 1. Query param override for testing ────────────────────────
  const tenantParam = request.nextUrl.searchParams.get('tenant');
  if (tenantParam) {
    response.cookies.set('tenantId', tenantParam, { path: '/', maxAge: 60 * 60 * 24 * 30 });
    return response;
  }

  // ─── 2. Admin subdomain detection ───────────────────────────────
  const isAdminSubdomain = hostname === 'admin.theharvest.app' ||
    hostname === 'admin.harvest-agent.vercel.app' ||
    /^admin-[a-z0-9-]+\.vercel\.app$/.test(hostname);

  if (isAdminSubdomain) {
    response.cookies.set('isAdmin', 'true', { path: '/', maxAge: 60 * 60 * 24 * 30 });
    response.cookies.delete('tenantId');
    return response;
  }
  response.cookies.delete('isAdmin');

  // ─── 3. Known base domains → no tenant ──────────────────────────
  const baseDomains = [
    'theharvest.app',
    'www.theharvest.app',
    'harvest-agent.vercel.app',
    'localhost',
  ];

  if (baseDomains.includes(hostname)) {
    response.cookies.delete('tenantId');
    return response;
  }

  // ─── 4. Subdomain of theharvest.app ─────────────────────────────
  const parts = hostname.split('.');
  if (parts.length >= 3) {
    const baseDomain = parts.slice(1).join('.');
    if (baseDomain === 'theharvest.app' || baseDomain.endsWith('.vercel.app')) {
      const subdomain = parts[0];
      response.cookies.set('tenantId', subdomain, { path: '/', maxAge: 60 * 60 * 24 * 30 });
      return response;
    }
  }

  // ─── 5. Custom domain resolution ────────────────────────────────
  // Strip www. prefix for consistent domain resolution
  const resolveHostname = hostname.replace(/^www\./, '');

  // Check if we already resolved this domain (cached in cookie)
  const cachedDomain = request.cookies.get('customDomain')?.value;
  const cachedTenantId = request.cookies.get('tenantId')?.value;

  if ((cachedDomain === hostname || cachedDomain === resolveHostname) && cachedTenantId) {
    // Already resolved, use cached tenantId
    return response;
  }

  // Unknown domain — redirect to API route to resolve on the base domain
  // Must use theharvest.app (not request.url which is the custom domain)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
  const resolveUrl = new URL('/api/resolve-domain', baseUrl);
  resolveUrl.searchParams.set('domain', resolveHostname);
  resolveUrl.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search);
  
  return NextResponse.redirect(resolveUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
