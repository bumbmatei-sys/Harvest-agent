import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { routeForHost } from '@/lib/storefront/host-routing';

// Rate limit config per path pattern (most specific first)
const RATE_LIMIT_PATHS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /^\/api\/stripe\//, category: 'stripe' },
  { pattern: /^\/api\/auth\//, category: 'auth' },
  { pattern: /^\/api\/gemini/, category: 'ai' },
  { pattern: /^\/api\/ai-assistant/, category: 'ai' },
  { pattern: /^\/api\//, category: 'api' },
];

export async function middleware(request: NextRequest) {
  // A ministry's subdomain serves its Storefront and public pages only; the app
  // lives on theharvest.app (Matei's hard switch). See routeForHost.
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    const route = routeForHost(request.headers.get('host') ?? '', request.nextUrl.pathname);
    if (route.action === 'rewrite') {
      const url = request.nextUrl.clone();
      url.pathname = route.to;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // Skip rate limiting if Redis is not configured (graceful degradation)
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    return NextResponse.next();
  }

  const { checkRateLimit } = await import('@/lib/rate-limit');

  const matched = RATE_LIMIT_PATHS.find(({ pattern }) =>
    pattern.test(request.nextUrl.pathname)
  );

  if (matched) {
    const rateLimitResponse = await checkRateLimit(request, matched.category as any);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
  }

  return NextResponse.next();
}

export const config = {
  // Every path but Next's own static assets: API routes for rate limiting, and
  // page routes so a ministry subdomain can be routed to its Storefront.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
