import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Rate limit config per path pattern (most specific first)
const RATE_LIMIT_PATHS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /^\/api\/stripe\//, category: 'stripe' },
  { pattern: /^\/api\/auth\//, category: 'auth' },
  { pattern: /^\/api\/gemini/, category: 'ai' },
  { pattern: /^\/api\/ai-assistant/, category: 'ai' },
  { pattern: /^\/api\//, category: 'api' },
];

export async function middleware(request: NextRequest) {
  // Only rate-limit API routes
  if (!request.nextUrl.pathname.startsWith('/api/')) {
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
  matcher: '/api/:path*',
};
