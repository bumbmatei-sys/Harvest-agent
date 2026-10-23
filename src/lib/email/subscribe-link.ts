import { HARVEST_APEX } from '@/components/donations/giving-share';

/** The public page a ministry shares so people can join its newsletter. */
export const SUBSCRIBE_PATH = '/subscribe';

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * `https://{tenant}.theharvest.app/subscribe`, or null for anything that is not
 * a single DNS label under the Harvest apex. Built the way the giving page link
 * is, and re-asked of the parsed URL, so a tenant id can never produce a host
 * that is not Harvest's.
 */
export function buildSubscribePageUrl(tenantId: unknown): string | null {
  if (typeof tenantId !== 'string') return null;
  const label = tenantId.trim().toLowerCase();
  if (!label || !DNS_LABEL.test(label)) return null;
  let parsed: URL;
  try {
    parsed = new URL(`https://${label}.${HARVEST_APEX}${SUBSCRIBE_PATH}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(`.${HARVEST_APEX}`) || host.split('.').length !== HARVEST_APEX.split('.').length + 1) return null;
  return parsed.toString();
}
