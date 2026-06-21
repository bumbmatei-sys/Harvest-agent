import { describe, it, expect } from 'vitest';
import { resolveTenantIdFromHostname } from '../TenantContext';

describe('resolveTenantIdFromHostname', () => {
  it('extracts tenant slug from *.theharvest.app subdomains', () => {
    expect(resolveTenantIdFromHostname('mychurch.theharvest.app', null)).toBe('mychurch');
    expect(resolveTenantIdFromHostname('acme.theharvest.app', null)).toBe('acme');
  });

  it('falls through to cookie for apex theharvest.app (no subdomain)', () => {
    expect(resolveTenantIdFromHostname('theharvest.app', 'cookieTenant')).toBe('cookieTenant');
    expect(resolveTenantIdFromHostname('theharvest.app', null)).toBeNull();
  });

  it('falls through to cookie for Vercel preview URLs (not treated as tenant subdomains)', () => {
    const previewHost = 'harvest-agent-git-claude-harvest-3a9d48-bumbmatei-sys-projects.vercel.app';
    expect(resolveTenantIdFromHostname(previewHost, null)).toBeNull();
    expect(resolveTenantIdFromHostname(previewHost, 'cookieTenant')).toBe('cookieTenant');
  });

  it('falls through to cookie for *.vercel.app in general', () => {
    expect(resolveTenantIdFromHostname('some-deployment.vercel.app', null)).toBeNull();
    expect(resolveTenantIdFromHostname('some-deployment.vercel.app', 'org')).toBe('org');
  });

  it('falls through to cookie for localhost', () => {
    expect(resolveTenantIdFromHostname('localhost', 'localTenant')).toBe('localTenant');
    expect(resolveTenantIdFromHostname('localhost', null)).toBeNull();
  });

  it('returns null when no cookie and non-tenant hostname', () => {
    expect(resolveTenantIdFromHostname('example.com', null)).toBeNull();
    expect(resolveTenantIdFromHostname('127.0.0.1', null)).toBeNull();
  });
});
