/** Validate a tenant document for a Harvest subdomain, preserving legacy documents. */
export function tenantMatchesSubdomain(data: { plan?: unknown; subdomain?: unknown } | undefined, label: string): boolean {
  return !!data && data.plan !== 'free' && ((data.plan == null && data.subdomain == null) || data.subdomain === label);
}
