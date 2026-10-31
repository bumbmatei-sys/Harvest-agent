import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { defaultCommunitySettings } from '@/lib/community/settings';

const h = vi.hoisted(() => ({ permission: vi.fn(), admin: vi.fn(), get: vi.fn(), set: vi.fn(), delete: vi.fn(), count: vi.fn(), people: vi.fn() }));
vi.mock('@/lib/community-membership-server', () => ({ communityPeople: h.people }));
vi.mock('@/lib/api-auth', () => ({ requireTenantPermission: h.permission, requireTenantAdmin: h.admin }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {
  collection: (name: string) => ({
    doc: (id: string) => ({ path: `${name}/${id}`, collection: (sub: string) => ({ doc: (doc: string) => ({ path: `${name}/${id}/${sub}/${doc}` }) }) }),
    where: () => ({ count: () => ({ get: h.count }) }),
  }),
  runTransaction: (fn: (tx: unknown) => unknown) => fn({ get: h.get, set: h.set, delete: h.delete }),
} }));
import { GET, POST } from './route';

function request(next = defaultCommunitySettings(), previous = defaultCommunitySettings()) {
  return new NextRequest('http://localhost/api/community/settings', { method: 'POST', body: JSON.stringify({ tenantId: 'ministry', next, previous }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  h.admin.mockResolvedValue({ uid: 'admin', tenantId: 'ministry', isSuperAdmin: false });
  h.permission.mockResolvedValue({ uid: 'admin' });
  h.people.mockResolvedValue(Array.from({ length: 7 }, (_, i) => [String(i), { tenantId: 'ministry', displayName: 'Member', email: '', role: 'user' }]));
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
    expect(Object.keys(listing).sort()).toEqual(['brandColor', 'logoUrl', 'memberCount', 'name', 'shortDescription', 'slug', 'tenantId', 'updatedAt', 'coverUrl', 'galleryUrls', 'longDescription', 'ownerName', 'isPublic', 'ratingSum', 'ratingCount', 'ratingAvg'].sort());
  });
  it('preserves server-owned ratings when settings are saved or republished', async () => {
    h.get.mockImplementation((ref: { path: string }) => ref.path.includes('/settings/') ? { exists: true, data: () => ({ ...defaultCommunitySettings(), ratingSum: 9, ratingCount: 2, ratingAvg: 4.5 }) } : { exists: true, data: () => ({ name: 'Ministry', subdomain: 'ministry' }) });
    const next = { ...defaultCommunitySettings(), isPublic: true, ratingSum: 999, ratingCount: 1, ratingAvg: 5 };
    expect((await POST(request(next))).status).toBe(200);
    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'discovery_listings/ministry' }), expect.objectContaining({ ratingSum: 9, ratingCount: 2, ratingAvg: 4.5 }));
    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'tenants/ministry/settings/community' }), expect.objectContaining({ ratingSum: 9, ratingCount: 2, ratingAvg: 4.5 }));
  });
  it('accepts tenant uploads and rejects foreign, malformed and oversized media', async () => {
    vi.stubEnv('R2_PUBLIC_URL', 'https://media.example');
    const base = defaultCommunitySettings();
    expect((await POST(request({ ...base, brandColor: 'red' }))).status).toBe(400);
    expect((await POST(request({ ...base, logoUrl: 'https://evil.example/logo.jpg' }))).status).toBe(400);
    expect((await POST(request({ ...base, logoUrl: 'https://media.example/tenants/ministry/uploads/id-image.jpg' }))).status).toBe(200);
    expect((await POST(request({ ...base, coverUrl: 'https://media.example/tenants/ministry/uploads/id-image.jpg' }))).status).toBe(200);
    for (const coverUrl of ['https://evil.example/tenants/ministry/uploads/id-image.jpg', 'https://media.example/tenants/other/uploads/id-image.jpg', 'https://media.example/tenants/ministry/uploads/../secret']) {
      expect((await POST(request({ ...base, coverUrl }))).status).toBe(400);
    }
    expect((await POST(request({ ...base, galleryUrls: Array(9).fill('https://media.example/tenants/ministry/uploads/id.jpg') }))).status).toBe(400);
    expect((await POST(request({ ...base, longDescription: 'x'.repeat(10001) }))).status).toBe(400);
    vi.unstubAllEnvs();
  });
  it('deletes a private listing atomically with the settings save', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(h.delete).toHaveBeenCalledWith(expect.objectContaining({ path: 'discovery_listings/ministry' }));
    expect(h.set).toHaveBeenCalledWith({ path: 'tenants/ministry/settings/community' }, expect.anything());
    expect(h.count).not.toHaveBeenCalled();
  });
  it('creates the default group only when it is missing', async () => {
    h.get.mockImplementation((ref: { path: string }) => ref.path.includes('/settings/') || ref.path.includes('/channels/') ? { exists: false } : { exists: true, data: () => ({}) });
    expect((await POST(request())).status).toBe(200);
    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'tenants/ministry/channels/all-members' }), expect.objectContaining({ audience: 'all', createdBy: 'admin', type: 'announcement' }));
  });
  it('does not write when settings changed or the count fails', async () => {
    h.get.mockImplementation((ref: { path: string }) => ref.path.includes('/settings/') ? { exists: true, data: () => ({ ...defaultCommunitySettings(), isPublic: true }) } : { exists: true, data: () => ({}) });
    expect((await POST(request())).status).toBe(400);
    expect(h.set).not.toHaveBeenCalled();
    h.people.mockRejectedValue(new Error('offline'));
    h.get.mockImplementation(() => ({ exists: false }));
    expect((await POST(request({ ...defaultCommunitySettings(), isPublic: true }))).status).toBe(500);
    expect(h.set).not.toHaveBeenCalled();
  });
});

describe('community directory projection', () => {
  it('requires the existing tenant admin gate', async () => {
    h.admin.mockResolvedValue(NextResponse.json({ error: 'Denied' }, { status: 403 }));
    expect((await GET(new NextRequest('http://localhost/api/community/settings?tenantId=other'))).status).toBe(403);
    expect(h.people).not.toHaveBeenCalled();
  });
  it('returns directory fields only, treating foreign admins as members', async () => {
    h.people.mockResolvedValue([['joined', { tenantId: 'other', role: 'admin', permissions: { fullAccess: true }, plan: 'ministry', displayName: 'Joined', email: 'joined@example.test', affiliateEarnings: 99 }]]);
    const response = await GET(new NextRequest('http://localhost/api/community/settings?tenantId=ministry&includeNull=true'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ people: [{ id: 'joined', displayName: 'Joined', email: 'joined@example.test', role: 'user' }] });
    expect(h.people).toHaveBeenCalledWith('ministry', false);
  });
  it('keeps a deleted default community closed and off Discover, whatever the client sends', async () => {
    h.get.mockImplementation((ref: { path: string }) => ref.path.includes('/settings/')
      ? { exists: true, data: () => ({ ...defaultCommunitySettings(), closed: true }) }
      : { exists: true, data: () => ({ name: 'Ministry', subdomain: 'ministry' }) });
    const reopen = { ...defaultCommunitySettings(), isPublic: true, closed: false };
    expect((await POST(request(reopen, { ...defaultCommunitySettings(), closed: true }))).status).toBe(200);
    expect(h.set).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'discovery_listings/ministry' }), expect.anything());
    expect(h.delete).toHaveBeenCalledWith(expect.objectContaining({ path: 'discovery_listings/ministry' }));
    const settings = h.set.mock.calls.find(([ref]) => ref.path.includes('/settings/'))![1];
    expect(settings.closed).toBe(true);
  });
  it('surfaces failed directory reads', async () => {
    h.people.mockRejectedValue(new Error('offline'));
    expect((await GET(new NextRequest('http://localhost/api/community/settings?tenantId=ministry'))).status).toBe(503);
  });
});
