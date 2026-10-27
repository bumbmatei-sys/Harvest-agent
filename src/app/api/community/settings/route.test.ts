import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { defaultCommunitySettings } from '@/lib/community/settings';

const h = vi.hoisted(() => ({ permission: vi.fn(), admin: vi.fn(), get: vi.fn(), set: vi.fn(), delete: vi.fn(), count: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireTenantPermission: h.permission, requireTenantAdmin: h.admin }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {
  collection: (name: string) => ({
    doc: (id: string) => ({ path: `${name}/${id}`, collection: (sub: string) => ({ doc: (doc: string) => ({ path: `${name}/${id}/${sub}/${doc}` }) }) }),
    where: () => ({ count: () => ({ get: h.count }) }),
  }),
  runTransaction: (fn: (tx: unknown) => unknown) => fn({ get: h.get, set: h.set, delete: h.delete }),
} }));
import { POST } from './route';

function request(next = defaultCommunitySettings(), previous = defaultCommunitySettings()) {
  return new NextRequest('http://localhost/api/community/settings', { method: 'POST', body: JSON.stringify({ tenantId: 'ministry', next, previous }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  h.admin.mockResolvedValue({ uid: 'admin', tenantId: 'ministry', isSuperAdmin: false });
  h.permission.mockResolvedValue({ uid: 'admin' });
  h.count.mockResolvedValue({ data: () => ({ count: 7 }) });
  h.get.mockImplementation((ref: { path: string }) => ref.path.includes('/settings/') ? { exists: false } : { exists: true, data: () => ({ name: 'Ministry', subdomain: 'ministry', ownerId: 'secret' }) });
});
describe('community settings API', () => {
  it('enforces the tenant community permission', async () => {
    h.permission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await POST(request())).status).toBe(403);
    expect(h.permission).toHaveBeenCalledWith(expect.anything(), 'ministry', 'manageCommunity');
    expect(h.set).not.toHaveBeenCalled();
  });
  it('publishes only projected fields with a server-side count', async () => {
    const result = await POST(request({ ...defaultCommunitySettings(), isPublic: true, shortDescription: 'Hello' }));
    expect(result.status).toBe(200);
    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'discovery_listings/ministry' }), expect.objectContaining({ tenantId: 'ministry', memberCount: 7, shortDescription: 'Hello' }));
    const listing = h.set.mock.calls[0][1];
    expect(Object.keys(listing).sort()).toEqual(['logoUrl', 'memberCount', 'name', 'shortDescription', 'slug', 'tenantId', 'updatedAt'].sort());
  });
  it('deletes a private listing atomically with the settings save', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(h.delete).toHaveBeenCalledWith(expect.objectContaining({ path: 'discovery_listings/ministry' }));
    expect(h.set).toHaveBeenCalledWith({ path: 'tenants/ministry/settings/community' }, expect.anything());
    expect(h.count).not.toHaveBeenCalled();
  });
  it('does not write when settings changed or the count fails', async () => {
    h.get.mockImplementation((ref: { path: string }) => ref.path.includes('/settings/') ? { exists: true, data: () => ({ ...defaultCommunitySettings(), isPublic: true }) } : { exists: true, data: () => ({}) });
    expect((await POST(request())).status).toBe(400);
    expect(h.set).not.toHaveBeenCalled();
    h.count.mockRejectedValue(new Error('offline'));
    expect((await POST(request({ ...defaultCommunitySettings(), isPublic: true }))).status).toBe(500);
    expect(h.set).not.toHaveBeenCalled();
  });
});
