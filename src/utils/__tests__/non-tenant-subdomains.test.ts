import { describe, it, expect } from 'vitest';
import {
  NON_TENANT_SUBDOMAINS,
  isNonTenantSubdomain,
  isAffiliateHost,
  isHarvestHost,
  AFFILIATE_SUBDOMAIN,
} from '../non-tenant-subdomains';

describe('NON_TENANT_SUBDOMAINS', () => {
  it('reserves the platform aliases, including affiliate', () => {
    expect(NON_TENANT_SUBDOMAINS.has('www')).toBe(true);
    expect(NON_TENANT_SUBDOMAINS.has('app')).toBe(true);
    expect(NON_TENANT_SUBDOMAINS.has('admin')).toBe(true);
    expect(NON_TENANT_SUBDOMAINS.has('affiliate')).toBe(true);
  });

  it('does not reserve real tenant slugs', () => {
    expect(NON_TENANT_SUBDOMAINS.has('nations')).toBe(false);
    expect(NON_TENANT_SUBDOMAINS.has('gracechurch')).toBe(false);
  });
});

describe('isNonTenantSubdomain', () => {
  it('is true for platform aliases', () => {
    expect(isNonTenantSubdomain('affiliate')).toBe(true);
    expect(isNonTenantSubdomain('www')).toBe(true);
    expect(isNonTenantSubdomain('app')).toBe(true);
    expect(isNonTenantSubdomain('admin')).toBe(true);
  });

  it('is false for real tenant slugs', () => {
    expect(isNonTenantSubdomain('nations')).toBe(false);
    expect(isNonTenantSubdomain('mychurch')).toBe(false);
  });
});

describe('isAffiliateHost', () => {
  it('is true only for the affiliate.theharvest.app host', () => {
    expect(isAffiliateHost('affiliate.theharvest.app')).toBe(true);
    // case-insensitive (hostnames are)
    expect(isAffiliateHost('Affiliate.TheHarvest.app')).toBe(true);
  });

  it('is the reserved affiliate subdomain, kept in NON_TENANT_SUBDOMAINS', () => {
    expect(AFFILIATE_SUBDOMAIN).toBe('affiliate');
    expect(NON_TENANT_SUBDOMAINS.has(AFFILIATE_SUBDOMAIN)).toBe(true);
  });

  it('is false for the apex, other subdomains and tenant slugs', () => {
    expect(isAffiliateHost('theharvest.app')).toBe(false);
    expect(isAffiliateHost('www.theharvest.app')).toBe(false);
    expect(isAffiliateHost('app.theharvest.app')).toBe(false);
    expect(isAffiliateHost('nations.theharvest.app')).toBe(false);
  });

  it('does not match affiliate on foreign hosts or previews', () => {
    // Only *.theharvest.app counts — a look-alike host must never be trusted as
    // the affiliate surface, and Vercel previews are not tenants either.
    expect(isAffiliateHost('affiliate.evil.com')).toBe(false);
    expect(isAffiliateHost('affiliate.theharvest.app.evil.com')).toBe(false);
    expect(isAffiliateHost('harvest-git-main.vercel.app')).toBe(false);
    expect(isAffiliateHost('')).toBe(false);
  });
});

describe('isHarvestHost (Connect redirect allowlist)', () => {
  it('accepts the apex and every *.theharvest.app host', () => {
    expect(isHarvestHost('theharvest.app')).toBe(true);
    expect(isHarvestHost('affiliate.theharvest.app')).toBe(true);
    expect(isHarvestHost('www.theharvest.app')).toBe(true);
    expect(isHarvestHost('app.theharvest.app')).toBe(true);
    expect(isHarvestHost('admin.theharvest.app')).toBe(true);
    // Tenant (church-admin) subdomains
    expect(isHarvestHost('nations.theharvest.app')).toBe(true);
    expect(isHarvestHost('gracechurch.theharvest.app')).toBe(true);
    // Case-insensitive (hostnames are)
    expect(isHarvestHost('Affiliate.TheHarvest.app')).toBe(true);
  });

  it('rejects attacker-supplied / foreign hosts so they can never open-redirect', () => {
    expect(isHarvestHost('evil.com')).toBe(false);
    expect(isHarvestHost('theharvest.app.evil.com')).toBe(false);
    expect(isHarvestHost('affiliate.theharvest.app.evil.com')).toBe(false);
    // A suffix without the separating dot must not slip through endsWith.
    expect(isHarvestHost('eviltheharvest.app')).toBe(false);
    expect(isHarvestHost('nottheharvest.app')).toBe(false);
    // Vercel previews are not Harvest hosts.
    expect(isHarvestHost('harvest-git-main.vercel.app')).toBe(false);
    expect(isHarvestHost('')).toBe(false);
  });
});
