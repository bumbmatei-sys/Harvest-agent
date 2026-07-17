import { describe, it, expect } from 'vitest';
import { resolvePostAuthFunnelRoute } from '../post-auth-route';

/**
 * Precedence spec for the post-auth funnel decision. The affiliate-host branch
 * must be authoritative for a CONFIRMED tenant-less user: no combination of
 * church/plan signup intent (URL param or a stale sessionStorage value — both
 * arrive here as the same booleans) may route them into an onboarding funnel.
 * This is the guard against the production incident where a stale ?signup=<plan>
 * intent hijacked an affiliate signup into church onboarding and a real payment.
 */
describe('resolvePostAuthFunnelRoute', () => {
  const base = {
    onAffiliateHost: false,
    confirmedTenantless: true,
    churchSignupIntent: false,
    planSignupIntent: false,
    isChurchAdminRole: false,
  };

  describe('affiliate host, confirmed tenant-less — authoritative, never a funnel', () => {
    it('lands on / with no signup intent', () => {
      expect(resolvePostAuthFunnelRoute({ ...base, onAffiliateHost: true })).toBe('/');
    });

    it('lands on / even with a plan intent in play (THE BUG: stale sessionStorage plan)', () => {
      expect(
        resolvePostAuthFunnelRoute({ ...base, onAffiliateHost: true, planSignupIntent: true })
      ).toBe('/');
    });

    it('lands on / even with a church signup intent', () => {
      expect(
        resolvePostAuthFunnelRoute({ ...base, onAffiliateHost: true, churchSignupIntent: true })
      ).toBe('/');
    });

    it('lands on / even when EVERY funnel signal fires at once', () => {
      expect(
        resolvePostAuthFunnelRoute({
          onAffiliateHost: true,
          confirmedTenantless: true,
          churchSignupIntent: true,
          planSignupIntent: true,
          isChurchAdminRole: true,
        })
      ).toBe('/');
    });
  });

  describe('affiliate host, NOT tenant-less — church users are never trapped', () => {
    it('a church_admin with a tenant still reaches the church flow', () => {
      expect(
        resolvePostAuthFunnelRoute({
          ...base,
          onAffiliateHost: true,
          confirmedTenantless: false,
          isChurchAdminRole: true,
        })
      ).toBe('/church-onboarding');
    });

    it('a tenanted user with a plan intent still reaches the church flow', () => {
      expect(
        resolvePostAuthFunnelRoute({
          ...base,
          onAffiliateHost: true,
          confirmedTenantless: false,
          planSignupIntent: true,
        })
      ).toBe('/church-onboarding');
    });

    it('a tenanted user with no intent gets member onboarding', () => {
      expect(
        resolvePostAuthFunnelRoute({ ...base, onAffiliateHost: true, confirmedTenantless: false })
      ).toBe('/onboarding');
    });
  });

  describe('apex / tenant hosts — the paid funnel is unchanged', () => {
    it('?signup=church → church onboarding', () => {
      expect(resolvePostAuthFunnelRoute({ ...base, churchSignupIntent: true })).toBe(
        '/church-onboarding'
      );
    });

    it('?signup=<plan> → church onboarding', () => {
      expect(resolvePostAuthFunnelRoute({ ...base, planSignupIntent: true })).toBe(
        '/church-onboarding'
      );
    });

    it('church_admin role → church onboarding', () => {
      expect(resolvePostAuthFunnelRoute({ ...base, isChurchAdminRole: true })).toBe(
        '/church-onboarding'
      );
    });

    it('no intent, no role → member onboarding', () => {
      expect(resolvePostAuthFunnelRoute(base)).toBe('/onboarding');
    });

    it('tenantless-ness alone never bypasses the funnel off the affiliate host', () => {
      expect(
        resolvePostAuthFunnelRoute({ ...base, confirmedTenantless: true, planSignupIntent: true })
      ).toBe('/church-onboarding');
    });
  });
});
