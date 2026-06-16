import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Subdomain routing middleware.
 *
 * Extracts tenant subdomain from hostname and stores it in a cookie.
 * - gracechurch.theharvest.app → tenantId = "gracechurch"
 * - gracechurch.harvest-agent.vercel.app → tenantId = "gracechurch"
 * - theharvest.app → no tenant (global platform)
 * - harvest-agent.vercel.app → no tenant (global platform)
 *
 * Also supports ?tenant=xxx query param for local testing.
 */
export function middleware(request: NextRequest) {
  const { hostname } = request.nextUrl;
  const response = NextResponse.next();

  // Detect admin subdomain → set isAdmin cookie
  // This runs before any tenant detection so admin always wins
  // Only match exact admin subdomains for known base domains
  const isAdminSubdomain = hostname === 'admin.theharvest.app' ||
    hostname === 'admin.harvest-agent.vercel.app' ||
    /^admin-[a-z0-9-]+\.vercel\.app$/.test(hostname);
  if (isAdminSubdomain) {
    response.cookies.set('isAdmin', 'true', { path: '/', maxAge: 60 * 60 * 24 * 30 });
  } else {
    response.cookies.delete('isAdmin');
  }

  // Allow query param override for local/testing
  const tenantParam = request.nextUrl.searchParams.get('tenant');

  if (tenantParam) {
    response.cookies.set('tenantId', tenantParam, { path: '/', maxAge: 60 * 60 * 24 * 30 });
    return response;
  }

  // Admin subdomain always goes to admin — no tenant context needed
  if (isAdminSubdomain) {
    response.cookies.delete('tenantId');
    return response;
  }

  // Base domains that represent the global platform (no tenant)
  const baseDomains = [
    'theharvest.app',
    'www.theharvest.app',
    'harvest-agent.vercel.app',
    'localhost',
  ];

  // If hostname is a known base domain → global platform
  if (baseDomains.includes(hostname)) {
    response.cookies.delete('tenantId');
    return response;
  }

  // Check if hostname ends with a known base domain
  // e.g. gracechurch.theharvest.app → parts = ["gracechurch", "theharvest", "app"]
  const parts = hostname.split('.');

  // Need at least 3 parts for a subdomain (subdomain.base.tld)
  if (parts.length >= 3) {
    // Reconstruct the base domain (everything after the first part)
    const baseDomain = parts.slice(1).join('.');

    // Treat as tenant subdomain if base is theharvest.app
    // OR if it's a *.vercel.app preview deployment (e.g. gracechurch.harvest-agent-abc123.vercel.app)
    if (baseDomain === 'theharvest.app' || baseDomain.endsWith('.vercel.app')) {
      const subdomain = parts[0];
      response.cookies.set('tenantId', subdomain, { path: '/', maxAge: 60 * 60 * 24 * 30 });
      return response;
    }
  }

  // No tenant context
  response.cookies.delete('tenantId');
  return response;
}

export const config = {
  // Only run on page routes, skip static files and API routes
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
