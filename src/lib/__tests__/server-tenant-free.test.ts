import { describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: () => ({ doc: () => ({ get }) }) },
}));
const { getTenantFromHost } = await import('@/lib/server-tenant');

describe('tenant host resolution', () => {
  it('ignores a free tenant even when its document ID matches the host', async () => {
    get.mockResolvedValue({ exists: true, id: 'grace', data: () => ({ plan: 'free' }) });
    expect(await getTenantFromHost('grace.theharvest.app')).toBeNull();
  });
  it('resolves a legacy tenant without plan or subdomain fields', async () => {
    get.mockResolvedValue({ exists: true, id: 'grace', data: () => ({ name: 'Grace' }) });
    expect(await getTenantFromHost('grace.theharvest.app')).toEqual({ id: 'grace', name: 'Grace' });
  });
  it('rejects a mismatched subdomain even without a plan', async () => {
    get.mockResolvedValue({ exists: true, id: 'grace', data: () => ({ subdomain: 'other' }) });
    expect(await getTenantFromHost('grace.theharvest.app')).toBeNull();
  });
  it('resolves a paid tenant', async () => {
    get.mockResolvedValue({ exists: true, id: 'grace', data: () => ({ plan: 'church', subdomain: 'grace' }) });
    expect(await getTenantFromHost('grace.theharvest.app')).toEqual({ id: 'grace', plan: 'church', subdomain: 'grace' });
  });
  it.each([undefined, 'other'])('rejects a paid tenant with subdomain %s', async (subdomain) => {
    get.mockResolvedValue({ exists: true, id: 'grace', data: () => ({ plan: 'church', subdomain }) });
    expect(await getTenantFromHost('grace.theharvest.app')).toBeNull();
  });
});
