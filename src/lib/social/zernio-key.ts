import 'server-only';

/**
 * The social scheduler's only read of the provider key.
 * SMS keeps its own read in `src/lib/zernio.ts` and must not be imported here.
 * The value is never logged, returned, or placed on a URL.
 */
export function readZernioSocialKey(
  env: Record<string, string | undefined> = process.env,
): string {
  return (env.ZERNIO_API_KEY || '').trim();
}
