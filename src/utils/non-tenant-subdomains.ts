/**
 * Subdomains under *.theharvest.app that are NOT tenant slugs. A host like
 * `affiliate.theharvest.app` must never resolve to a tenant named `affiliate`;
 * these labels are platform / marketing / app aliases (and `affiliate`, which is
 * a separate product surface) that render the platform/apex experience instead.
 *
 * This is the SINGLE source of truth shared by every place that resolves a
 * *.theharvest.app subdomain, so the server and client can never disagree about
 * which subdomains are tenants — a disagreement here is the bug class behind the
 * livestream misroute (#181) and the dead-tenant redirect (#185):
 *   - getTenantIdFromHost()          — src/utils/tenant-scope.ts      (client scope)
 *   - resolveTenantIdFromHostname()  — src/contexts/TenantContext.tsx (client context)
 *   - getTenantFromHost()            — src/lib/server-tenant.ts        (server SSR)
 *   - AuthPage tenant derivation     — src/components/AuthPage.tsx     (auth screen)
 *
 * It is also the basis for the RESERVED subdomain blocklists at signup
 * (api/tenants/finish-setup, api/stripe/webhook): a non-tenant subdomain must
 * never be claimable as a tenant slug, or a church could register `affiliate`
 * and the resolvers above would then refuse to serve it.
 *
 * Kept as a zero-dependency leaf module on purpose: server-tenant.ts is
 * server-only (firebase-admin) and must not transitively import the client
 * Firebase SDK, so this shared constant cannot live in tenant-scope.ts.
 */
/**
 * The subdomain label for the affiliate product surface
 * (`affiliate.theharvest.app`). Defined here, in the single source of truth, so
 * no call site hardcodes the string `'affiliate'` — they derive the affiliate
 * host from `isAffiliateHost()` / this constant instead.
 */
export const AFFILIATE_SUBDOMAIN = 'affiliate';

export const NON_TENANT_SUBDOMAINS = new Set(['www', 'app', 'admin', AFFILIATE_SUBDOMAIN]);

/**
 * True when `subdomain` (the first label of a *.theharvest.app host) is a
 * platform / marketing / app alias rather than a tenant slug.
 */
export function isNonTenantSubdomain(subdomain: string): boolean {
  return NON_TENANT_SUBDOMAINS.has(subdomain);
}

/**
 * True when `hostname` is the affiliate product surface (`affiliate.theharvest.app`).
 *
 * The affiliate subdomain implies affiliate intent — this is the single signal
 * that drives the affiliate auth copy (AuthPage) and the tenant-less post-signup
 * routing (App.tsx), so neither has to hardcode `'affiliate'`.
 *
 * Server-safe by design: it reads only its `hostname` argument and never touches
 * `window`, so it is valid in SSR / API routes as well as the client. Mirrors the
 * `*.theharvest.app` host-matching used by the tenant resolvers (getTenantIdFromHost,
 * resolveTenantIdFromHostname, getTenantFromHost) so "is this a tenant?" and
 * "is this the affiliate host?" can never disagree about host shape.
 */
export function isAffiliateHost(hostname: string): boolean {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  const parts = host.split('.');
  return parts.length >= 3 && host.endsWith('.theharvest.app') && parts[0] === AFFILIATE_SUBDOMAIN;
}
