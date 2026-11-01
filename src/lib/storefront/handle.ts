import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';

/**
 * A Storefront address: the label in {handle}.theharvest.app. Lower-case
 * letters, digits and single hyphens, 3 to 40 long, not starting or ending with
 * a hyphen. Platform labels (www, app, admin, affiliate) and a few words that
 * would read as Harvest's own pages are never handles.
 */
export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,38}[a-z0-9]$/;

const RESERVED = new Set(['api', 'mail', 'help', 'support', 'docs', 'blog', 'status', 'harvest', 'login', 'signup', 'billing', 'storefront']);

export function normalizeHandle(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '-') : '';
}

/** Why a handle cannot be used, or null when its shape is fine. Availability is a separate, server-side check. */
export function handleProblem(handle: string): string | null {
  if (handle.length < 3) return 'Use at least 3 characters.';
  if (handle.length > 40) return 'Use at most 40 characters.';
  if (!HANDLE_RE.test(handle)) return 'Use lower-case letters, numbers and single hyphens.';
  if (isNonTenantSubdomain(handle) || RESERVED.has(handle)) return 'That address is reserved.';
  return null;
}

export const storefrontAddress = (handle: string) => `https://${handle}.theharvest.app`;
