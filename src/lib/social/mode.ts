import { readZernioSocialKey } from './zernio-key';

/**
 * Which Zernio client this process may use.
 *
 * Preview is always the mock, even when a key is present and `NODE_ENV` is
 * `production` (Vercel builds preview that way). Dev and test may use the
 * mock when the live flag is off.
 *
 * Production (`VERCEL_ENV=production`, or `NODE_ENV=production` outside a
 * preview) never falls back to the mock. A missing key or a missing
 * `ZERNIO_SOCIAL_LIVE=1` is unavailable: callers answer 503. `ZERNIO_SOCIAL_MODE`
 * is ignored there, so a leftover mock or sample flag cannot fake a success.
 */

export type SocialMode = 'mock' | 'live' | 'unavailable';

/**
 * In-memory scope for a super admin whose token carries no tenant, and only
 * while the process is allowed to serve the sample. A tilde cannot be a
 * subdomain, so this is not a ministry id and it is never written to Firestore.
 */
export const SOCIAL_SAMPLE_SCOPE = '~social-sample';

export function isSocialProduction(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV === 'preview') return false;
  if (env.VERCEL_ENV === 'production') return true;
  return env.NODE_ENV === 'production';
}

export function socialMode(
  env: Record<string, string | undefined> = process.env,
): SocialMode {
  if (env.VERCEL_ENV === 'preview') return 'mock';
  const key = readZernioSocialKey(env);
  const liveFlag = env.ZERNIO_SOCIAL_LIVE === '1';
  if (isSocialProduction(env)) {
    if (key && liveFlag) return 'live';
    return 'unavailable';
  }
  if (env.ZERNIO_SOCIAL_MODE === 'mock') return 'mock';
  if (!key || !liveFlag) return 'mock';
  return 'live';
}

/**
 * Preview may show seeded fiction when the ministry does not hold the add-on.
 * Dev and test may opt in with `ZERNIO_SOCIAL_MODE=sample`. Production never
 * does: an unentitled ministry gets the upgrade wall.
 */
export function socialSampleWithoutEntitlement(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (isSocialProduction(env)) return false;
  if (env.VERCEL_ENV === 'preview') return true;
  return env.ZERNIO_SOCIAL_MODE === 'sample';
}
