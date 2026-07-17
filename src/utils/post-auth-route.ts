/**
 * Post-auth funnel routing — the single decision for where a signed-in user
 * who still needs onboarding is sent. Extracted from App.tsx so the doc-exists
 * and no-user-doc code paths share ONE precedence order and can never drift
 * apart, and so that order is directly unit-testable.
 *
 * Precedence (highest first):
 *   1. Affiliate host + confirmed tenant-less → '/'. An affiliate is a
 *      tenant-less account on the affiliate product surface; it must NEVER be
 *      routed into a purchase/onboarding funnel — regardless of any church or
 *      plan signup intent in play. This is the incident guard: a stale
 *      `?signup=<plan>` intent stashed in sessionStorage by an earlier visit
 *      in the tab (e.g. the pricing page via a referral link) once hijacked a
 *      would-be affiliate into church onboarding, through a real Stripe
 *      payment, and created a real tenant. Signup intent is session state;
 *      the hostname is not — the host wins.
 *   2. Church/plan signup intent, or an established church_admin role →
 *      '/church-onboarding' (the paid build-on-payment funnel).
 *   3. Otherwise → '/onboarding' (generic member onboarding).
 *
 * `confirmedTenantless` must be true only when the user's doc state is
 * RESOLVED and shows no tenant: the doc read succeeded and `tenantId` is
 * null/absent, or the doc does not exist at all (so no tenantId field can
 * exist). An unresolved/errored read is NOT tenant-less (the #194 tri-state
 * discipline) — callers must not invoke this with guessed values. The gate
 * also keeps a church admin who lands on the affiliate origin out of branch 1:
 * they have a tenantId, so they still reach their church flow.
 *
 * Callers derive `onAffiliateHost` from isAffiliateHost()
 * (src/utils/non-tenant-subdomains.ts) — never a hardcoded 'affiliate'.
 */
export type PostAuthFunnelRoute = '/' | '/church-onboarding' | '/onboarding';

export interface PostAuthFunnelArgs {
  /** isAffiliateHost(window.location.hostname) — the affiliate product surface. */
  onAffiliateHost: boolean;
  /** Doc state RESOLVED and tenant-less (tenantId null/absent, or no doc). */
  confirmedTenantless: boolean;
  /** ?signup=church intent (URL or sessionStorage). */
  churchSignupIntent: boolean;
  /** ?signup=<plus|pro|max|ultra> intent (URL or sessionStorage). */
  planSignupIntent: boolean;
  /** The user doc's role is 'church_admin' (false when there is no doc). */
  isChurchAdminRole: boolean;
}

export function resolvePostAuthFunnelRoute(args: PostAuthFunnelArgs): PostAuthFunnelRoute {
  if (args.onAffiliateHost && args.confirmedTenantless) return '/';
  if (args.churchSignupIntent || args.planSignupIntent || args.isChurchAdminRole) {
    return '/church-onboarding';
  }
  return '/onboarding';
}
