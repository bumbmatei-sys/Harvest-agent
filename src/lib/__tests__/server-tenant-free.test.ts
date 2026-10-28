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
  it('resolves a paid tenant', async () => {
    get.mockResolvedValue({ exists: true, id: 'grace', data: () => ({ plan: 'church' }) });
    expect(await getTenantFromHost('grace.theharvest.app')).toEqual({ id: 'grace', plan: 'church' });
  });
});
