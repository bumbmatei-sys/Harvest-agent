import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the client firebase module so importing tenant-scope doesn't init a real
// Firebase app. `auth.currentUser` is mutable per-test to simulate sign-in state.
const { authMock } = vi.hoisted(() => ({
  authMock: { currentUser: null as { email: string } | null },
}));
vi.mock('../../firebase', () => ({ auth: authMock, db: {} }));

const { getTenantIdFromHost, isPlatformContext, hasPlatformOverride, getWriteTenantScope, PLATFORM_TENANT_ID } = await import('../tenant-scope');

const SUPER_ADMIN_EMAIL = 'bumbmatei@proton.me'; // present in SUPER_ADMIN_EMAILS
const REGULAR_EMAIL = 'someone@example.com';

function setHostname(hostname: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname },
  });
}

beforeEach(() => {
  authMock.currentUser = null;
});

describe('getTenantIdFromHost', () => {
  it('extracts the tenant slug from a tenant subdomain', () => {
    setHostname('nations.theharvest.app');
    expect(getTenantIdFromHost()).toBe('nations');
  });

  it('returns null on the apex domain', () => {
    setHostname('theharvest.app');
    expect(getTenantIdFromHost()).toBeNull();
  });

  it('returns null for non-tenant aliases (www / admin)', () => {
    setHostname('www.theharvest.app');
    expect(getTenantIdFromHost()).toBeNull();
    setHostname('admin.theharvest.app');
    expect(getTenantIdFromHost()).toBeNull();
  });

  it('returns null for the affiliate subdomain (non-tenant product surface)', () => {
    setHostname('affiliate.theharvest.app');
    expect(getTenantIdFromHost()).toBeNull();
  });
});

describe('isPlatformContext / hasPlatformOverride', () => {
  it('is FALSE on a tenant subdomain even for a super admin (the core fix)', () => {
    setHostname('nations.theharvest.app');
    authMock.currentUser = { email: SUPER_ADMIN_EMAIL };
    expect(isPlatformContext()).toBe(false);
    expect(hasPlatformOverride()).toBe(false);
  });

  it('is FALSE on a tenant subdomain for a regular user', () => {
    setHostname('nations.theharvest.app');
    authMock.currentUser = { email: REGULAR_EMAIL };
    expect(isPlatformContext()).toBe(false);
  });

  it('is TRUE on the apex domain for a super admin', () => {
    setHostname('theharvest.app');
    authMock.currentUser = { email: SUPER_ADMIN_EMAIL };
    expect(isPlatformContext()).toBe(true);
    expect(hasPlatformOverride()).toBe(true);
  });

  it('is FALSE on the apex domain for a regular user', () => {
    setHostname('theharvest.app');
    authMock.currentUser = { email: REGULAR_EMAIL };
    expect(isPlatformContext()).toBe(false);
  });

  it('is FALSE on the apex domain when signed out', () => {
    setHostname('theharvest.app');
    authMock.currentUser = null;
    expect(isPlatformContext()).toBe(false);
  });

  it('treats www/admin aliases as platform context for a super admin', () => {
    authMock.currentUser = { email: SUPER_ADMIN_EMAIL };
    setHostname('www.theharvest.app');
    expect(isPlatformContext()).toBe(true);
    setHostname('admin.theharvest.app');
    expect(isPlatformContext()).toBe(true);
  });
});

describe('getWriteTenantScope', () => {
  it('resolves a super admin on the apex to the platform tenant (never null)', async () => {
    setHostname('theharvest.app');
    authMock.currentUser = { email: SUPER_ADMIN_EMAIL };
    await expect(getWriteTenantScope()).resolves.toBe(PLATFORM_TENANT_ID);
  });

  it('resolves to the subdomain tenant on a tenant subdomain, even for a super admin (no platform fallback)', async () => {
    setHostname('nations.theharvest.app');
    authMock.currentUser = { email: SUPER_ADMIN_EMAIL };
    await expect(getWriteTenantScope()).resolves.toBe('nations');
  });

  it('resolves to null on the apex when signed out (no platform fallback for non-super-admins)', async () => {
    setHostname('theharvest.app');
    authMock.currentUser = null;
    await expect(getWriteTenantScope()).resolves.toBeNull();
  });
});
