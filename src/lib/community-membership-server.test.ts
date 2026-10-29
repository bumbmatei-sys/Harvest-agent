import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const h = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), fail: false, token: vi.fn(), gets: [] as string[] }));
vi.mock('@/lib/firebase-admin', () => {
  const ref = (path: string): any => ({
    path, collection: (name: string) => ref(`${path}/${name}`), doc: (id: string) => ref(`${path}/${id}`),
    get: async () => {
      h.gets.push(path);
      if (h.fail) throw new Error('offline');
      return { exists: h.docs.has(path), data: () => h.docs.get(path) };
    },
  });
  return { adminAuth: { verifyIdToken: h.token }, adminDb: { collection: (name: string) => ref(name) } };
});
import { isActiveCommunityMember } from './community-membership-server';
import { requireCommunityMember, requireTenantMember, requireTenantAdmin, requireTenantPermission } from './api-auth';
const request = () => new NextRequest('https://example.com', { headers: { authorization: 'Bearer test' } });
beforeEach(() => {
  h.docs.clear(); h.gets.length = 0; h.fail = false;
  h.token.mockResolvedValue({ uid: 'u', tenantId: 'a', admin: true });
  h.docs.set('users/u', { tenantId: 'a', role: 'admin', permissions: { fullAccess: true } });
});
describe('server community membership boundary', () => {
  it.each([
    ['active', 'a', true], ['left', 'b', false], ['left', 'a', false],
    [undefined, 'b', true], [undefined, 'a', false], [null, 'b', false], ['unknown', 'b', false],
  ])('checks status %s with primary %s against community b', async (status, primary, expected) => {
    h.docs.set('users/u', { tenantId: primary });
    if (status !== undefined) h.docs.set('tenants/b/communityMembers/u', { status });
    expect(await isActiveCommunityMember('u', 'b')).toBe(expected);
    const response = await requireCommunityMember(request(), 'b');
    expect(response instanceof NextResponse ? response.status : 200).toBe(expected ? 200 : 403);
  });
  it('accepts a status-less onboarding record only with the actual primary tenant', async () => {
    h.docs.set('tenants/b/communityMembers/u', { rulesAcceptedVersion: 1 });
    expect(await isActiveCommunityMember('u', 'b')).toBe(false);
    h.docs.set('users/u', { tenantId: 'b' });
    expect(await isActiveCommunityMember('u', 'b')).toBe(true);
  });
  it('does not grant tenant admin, permission or ordinary tenant access to a joined foreign admin', async () => {
    h.docs.set('tenants/b/communityMembers/u', { status: 'active' });
    expect(await requireCommunityMember(request(), 'b')).not.toBeInstanceOf(NextResponse);
    for (const work of [requireTenantMember(request(), 'b'), requireTenantAdmin(request(), 'b'), requireTenantPermission(request(), 'b', 'manageCRM')]) {
      expect((await work as NextResponse).status).toBe(403);
    }
  });
  it('surfaces an unavailable membership read as 503 and withholds access', async () => {
    h.fail = true;
    await expect(isActiveCommunityMember('u', 'b')).rejects.toThrow('offline');
    expect((await requireCommunityMember(request(), 'b') as NextResponse).status).toBe(503);
  });
  it('uses the transaction reader for an atomic membership recheck', async () => {
    const get = vi.fn(async (ref: { path: string }) => ({ data: () => ref.path.startsWith('users/') ? { tenantId: 'a' } : { status: 'left' } }));
    expect(await isActiveCommunityMember('u', 'b', { get } as unknown as FirebaseFirestore.Transaction)).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
    expect(h.gets).toEqual([]);
  });
  it('returns 401 without reading membership when signed out', async () => {
    const response = await requireCommunityMember(new NextRequest('https://example.com'), 'b');
    expect((response as NextResponse).status).toBe(401);
    expect(h.gets).toEqual([]);
  });
});
