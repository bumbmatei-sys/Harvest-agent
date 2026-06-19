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
  // General API: 30 requests per minute per IP
  api: redis ? new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '60 s'),
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
