/**
 * Which Zernio client this process may use.
 *
 * Preview deployments always use the mock, even if a key is present, so a
 * preview never connects a real account or reads a real church's posts.
 * A missing key uses the mock. The live client also requires
 * `ZERNIO_SOCIAL_LIVE=1`, so a key left in the environment does not by itself
 * publish.
 */

export type SocialMode = 'mock' | 'live';

export function socialMode(
  env: Record<string, string | undefined> = process.env,
): SocialMode {
  if (env.VERCEL_ENV === 'preview') return 'mock';
  if (env.ZERNIO_SOCIAL_MODE === 'mock') return 'mock';
  const key = env.ZERNIO_API_KEY;
  if (!key || !key.trim()) return 'mock';
  if (env.ZERNIO_SOCIAL_LIVE !== '1') return 'mock';
  return 'live';
}

/**
 * Preview (and an explicit sample flag) may show the scheduler with seeded
 * fiction when the ministry does not hold the add-on. Production never does:
 * an unentitled ministry gets the upgrade wall and the routes answer 403.
 */
export function socialSampleWithoutEntitlement(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV === 'preview') return true;
  if (env.ZERNIO_SOCIAL_MODE === 'sample') return true;
  return false;
}
