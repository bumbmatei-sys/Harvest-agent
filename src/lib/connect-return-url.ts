import type { NextRequest } from 'next/server';
import { isHarvestHost } from '@/utils/non-tenant-subdomains';

/**
 * The apex default for Connect redirects. Used verbatim when a request's host
 * cannot be trusted, so this stays the historical behaviour (the routes used to
 * hardcode exactly this). `NEXT_PUBLIC_APP_URL` is a legitimate default and is
 * NOT overridden here.
 */
export function apexBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
}

/**
 * Derive the base URL (`https://<host>`) to send a user back to after Stripe
 * Connect onboarding — the host they STARTED from. An affiliate on
 * `affiliate.theharvest.app` must return there, not the apex; a church admin on
 * their tenant subdomain must return there. The request carries that host, so we
 * use it instead of a hardcoded apex.
 *
 * SECURITY: this turns a hardcoded constant into request-derived data on a money
 * path, so the derived host is validated against the Harvest allowlist
 * (`isHarvestHost`: the apex + any `*.theharvest.app`) BEFORE it is used. An
 * attacker-supplied `Host` / `X-Forwarded-Host` header pointing at a foreign
 * domain (`evil.com`, `theharvest.app.evil.com`, …) fails the allowlist and we
 * fall back to the apex — never an open redirect. `X-Forwarded-Host` is
 * preferred because the platform proxy sets it to the real external host; the
 * validation makes trusting it safe regardless.
 */
export function resolveReturnBaseUrl(request: NextRequest): string {
  const rawHost =
    request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  // A forwarded chain can be comma-separated; take the first hop, drop any port.
  const hostname = rawHost.split(',')[0].trim().split(':')[0].toLowerCase();
  if (isHarvestHost(hostname)) {
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    return `${proto}://${hostname}`;
  }
  return apexBaseUrl();
}
