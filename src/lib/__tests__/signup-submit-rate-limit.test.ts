import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ configs: [] as any[], windows: [] as any[] }));
vi.mock('@upstash/redis', () => ({ Redis: class Redis {} }));
vi.mock('@upstash/ratelimit', () => ({ Ratelimit: class Ratelimit {
  static slidingWindow(count: number, duration: string) { calls.windows.push([count, duration]); return { count, duration }; }
  constructor(config: unknown) { calls.configs.push(config); }
} }));

describe('public signup submission limiter', () => {
  it('uses a dedicated 10 per minute bucket on the shared Redis client', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test');
    vi.resetModules();
    try {
      const { rateLimiters } = await import('../rate-limit');
      const signup = calls.configs.find(config => config.prefix === 'rl:signup-submit');
      const auth = calls.configs.find(config => config.prefix === 'rl:auth');
      expect(rateLimiters.signupSubmit).toBeTruthy();
      expect(signup.limiter).toEqual({ count: 10, duration: '60 s' });
      expect(signup.redis).toBe(auth.redis);
      expect(rateLimiters.signupSubmit).not.toBe(rateLimiters.auth);
    } finally { vi.unstubAllEnvs(); }
  });
});
