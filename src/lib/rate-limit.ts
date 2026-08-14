import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Only initialize if Redis credentials are present
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

// Rate limiters per endpoint category
export const rateLimiters = {
  // General API: 60 requests per minute per IP.
  //
  // Raised from 30 (THE-139). ⚠️ The raise is NOT the fix and must not be read
  // as one: an admin was hitting the old ceiling because the dashboard remounted
  // twice per tab change and re-asked both entitlement questions each time (see
  // RequireAdmin in src/App.tsx). That refetching is gone, and one admin screen
  // now costs 2 `/api/*` calls once per session rather than 4 per navigation.
  //
  // The headroom is for what remains legitimate. This limit is per IP, not per
  // user, so one church behind one NAT shares a single budget across everyone in
  // the building; and a client-rendered SPA screen honestly makes several calls
  // (Accounting alone opens with two QuickBooks status reads). 30/minute left
  // almost no margin for that. If this ceiling is ever reached again, the
  // question to ask is which caller became chatty — not what the number should
  // be next.
  api: redis ? new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, '60 s'),
    analytics: true,
    prefix: 'rl:api',
  }) : null,

  // Auth endpoints: 5 requests per minute (brute force protection)
  auth: redis ? new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '60 s'),
    analytics: true,
    prefix: 'rl:auth',
  }) : null,

  // Stripe checkout: 10 requests per minute
  stripe: redis ? new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '60 s'),
    analytics: true,
    prefix: 'rl:stripe',
  }) : null,

  // AI/chat: 20 requests per minute (costly backend)
  ai: redis ? new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, '60 s'),
    analytics: true,
    prefix: 'rl:ai',
  }) : null,
};

export type RateLimitCategory = keyof typeof rateLimiters;

/**
 * Apply rate limiting to a request.
 * Returns null if allowed, or a 429 Response if rate limited.
 * Gracefully passes through if Redis is not configured.
 */
export async function checkRateLimit(
  request: Request,
  category: RateLimitCategory
): Promise<Response | null> {
  const limiter = rateLimiters[category];
  if (!limiter) return null; // Redis not configured — allow through

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  const { success, limit, remaining, reset } = await limiter.limit(ip);

  if (!success) {
    return new Response(
      JSON.stringify({ error: 'Too many requests. Please try again later.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': reset.toString(),
          'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
        },
      }
    );
  }

  return null; // allowed
}
