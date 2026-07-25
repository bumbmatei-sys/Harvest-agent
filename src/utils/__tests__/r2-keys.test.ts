import { describe, it, expect } from 'vitest';
import {
  sanitizeFileName,
  tenantUploadPrefix,
  tenantUploadKey,
  isTenantUploadKey,
} from '../r2-keys';

describe('sanitizeFileName', () => {
  it('strips path separators, spaces and anything outside the allow-list', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('....etcpasswd');
    expect(sanitizeFileName('Sunday Sermon (final).pdf')).toBe('SundaySermonfinal.pdf');
  });

  it('falls back to "upload" when nothing survives', () => {
    expect(sanitizeFileName('«»')).toBe('upload');
  });
});

describe('tenantUploadKey', () => {
  it('mints keys inside the tenant prefix', () => {
    const key = tenantUploadKey('grace', 'abc-123', 'sermon.pdf');
    expect(key).toBe('tenants/grace/uploads/abc-123-sermon.pdf');
    expect(key.startsWith(tenantUploadPrefix('grace'))).toBe(true);
  });

  it('produces keys its own validator accepts — even for a hostile file name', () => {
    const key = tenantUploadKey('grace', 'abc-123', '../../other/secret.pdf');
    expect(isTenantUploadKey(key, 'grace')).toBe(true);
    expect(key.includes('/', tenantUploadPrefix('grace').length)).toBe(false);
  });
});

describe('isTenantUploadKey — the tenant boundary', () => {
  const key = tenantUploadKey('grace', 'abc-123', 'sermon.pdf');

  it('accepts the tenant\'s own upload key', () => {
    expect(isTenantUploadKey(key, 'grace')).toBe(true);
  });

  it('rejects another tenant\'s key', () => {
    expect(isTenantUploadKey(key, 'nations')).toBe(false);
    expect(isTenantUploadKey('tenants/nations/uploads/x-secret.pdf', 'grace')).toBe(false);
  });

  it('rejects a prefix-collision tenant name (grace vs grace-church)', () => {
    expect(isTenantUploadKey('tenants/grace-church/uploads/x.pdf', 'grace')).toBe(false);
  });

  it('rejects keys outside the uploads/ prefix', () => {
    expect(isTenantUploadKey('tenants/grace/private/x.pdf', 'grace')).toBe(false);
    expect(isTenantUploadKey('tenants/grace/x.pdf', 'grace')).toBe(false);
    expect(isTenantUploadKey('x.pdf', 'grace')).toBe(false);
  });

  it('rejects traversal past the prefix', () => {
    expect(isTenantUploadKey('tenants/grace/uploads/../../nations/uploads/x.pdf', 'grace')).toBe(false);
    expect(isTenantUploadKey('tenants/grace/uploads/sub/dir/x.pdf', 'grace')).toBe(false);
  });

  it('rejects an empty object name and non-string keys', () => {
    expect(isTenantUploadKey('tenants/grace/uploads/', 'grace')).toBe(false);
    expect(isTenantUploadKey(null, 'grace')).toBe(false);
    expect(isTenantUploadKey(undefined, 'grace')).toBe(false);
    expect(isTenantUploadKey(42, 'grace')).toBe(false);
  });

  it('rejects everything when the tenant is empty — no accidental open door', () => {
    expect(isTenantUploadKey('tenants//uploads/x.pdf', '')).toBe(false);
  });
});
