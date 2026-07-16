import { describe, it, expect } from 'vitest';
import { NON_TENANT_SUBDOMAINS, isNonTenantSubdomain } from '../non-tenant-subdomains';

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
