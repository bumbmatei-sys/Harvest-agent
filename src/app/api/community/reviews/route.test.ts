import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({ member: vi.fn(), admin: vi.fn(), docs: new Map<string, Record<string, unknown>>(), writes: [] as string[] }));
vi.mock('@/lib/api-auth', () => ({ requireCommunityMember: h.member, requireTenantAdmin: h.admin }));
vi.mock('@/lib/firebase-admin', () => {
  const ref = (path: string): any => ({ path, doc: (id: string) => ref(`${path}/${id}`), collection: (name: string) => ref(`${path}/${name}`), get: async () => snap(path), orderBy: () => ref(path), offset: () => ref(path), limit: () => ref(path) });
  const snap = (path: string) => path.endsWith('/reviews') ? { docs: [...h.docs.entries()].filter(([key]) => key.startsWith(`${path}/`)).map(([key]) => ({ id: key.split('/').pop(), data: () => h.docs.get(key) })) } : { exists: h.docs.has(path), data: () => h.docs.get(path) };
  return { adminDb: { collection: (name: string) => ref(name), runTransaction: async (fn: (tx: any) => Promise<void>) => fn({ get: async (r: any) => snap(r.path), set: (r: any, data: Record<string, unknown>, options?: { merge: boolean }) => { h.writes.push(r.path); h.docs.set(r.path, options?.merge ? { ...h.docs.get(r.path), ...data } : data); }, delete: (r: any) => { h.writes.push(r.path); h.docs.delete(r.path); } }) } };
});
import { DELETE, GET, POST } from './route';
const settings = 'tenants/a/settings/community';
const review = `${settings}/reviews/u`;
const listing = 'discovery_listings/a';
const req = (body: object, method = 'POST') => new NextRequest('http://localhost/api/community/reviews', { method, body: JSON.stringify(body) });
beforeEach(() => {
  h.docs.clear(); h.writes.length = 0;
  h.docs.set('tenants/a', { ownerId: 'owner' });
  h.docs.set('users/u', { tenantId: 'a', displayName: 'Jane Doe', createdAt: '2020-01-01T00:00:00Z' });
  h.docs.set(settings, {}); h.docs.set(listing, {});
  h.member.mockResolvedValue({ uid: 'u', tenantId: 'a' });
  h.admin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
});
describe('community reviews API', () => {
  it('refuses non-members, admins and attempts to address another reviewer', async () => {
    h.member.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await POST(req({ tenantId: 'a', rating: 5, text: 'x' }))).status).toBe(403);
    h.admin.mockResolvedValueOnce({ uid: 'u' });
    expect((await POST(req({ tenantId: 'a', rating: 5, text: 'x' }))).status).toBe(403);
    expect((await DELETE(req({ tenantId: 'a', uid: 'other' }, 'DELETE'))).status).toBe(403);
    expect(h.writes).toEqual([]);
  });
  it('validates rating and text', async () => {
    for (const rating of [0, 6, 2.5, '5']) expect((await POST(req({ tenantId: 'a', rating, text: 'x' }))).status).toBe(400);
    expect((await POST(req({ tenantId: 'a', rating: 5, text: 'x'.repeat(1001) }))).status).toBe(400);
  });
  it('creates, edits and deletes with both summaries updated', async () => {
    const created = await POST(req({ tenantId: 'a', rating: 5, text: 'First' }));
    expect(created.status).toBe(200);
    expect((await created.json()).aggregate).toMatchObject({ ratingSum: 5, ratingCount: 1, ratingAvg: 5 });
    expect(h.docs.get(review)).toMatchObject({ uid: 'u', rating: 5, authorName: 'Jane Doe' });
    expect(h.docs.get(settings)).toMatchObject({ ratingSum: 5, ratingCount: 1, ratingAvg: 5 });
    expect((await POST(req({ tenantId: 'a', rating: 3, text: 'Edit' }))).status).toBe(200);
    expect(h.docs.get(listing)).toMatchObject({ ratingSum: 3, ratingCount: 1, ratingAvg: 3 });
    expect((await DELETE(req({ tenantId: 'a' }, 'DELETE'))).status).toBe(200);
    expect(h.docs.has(review)).toBe(false);
    expect(h.docs.get(settings)).toMatchObject({ ratingSum: 0, ratingCount: 0, ratingAvg: 0 });
  });
  it("returns only the member's own review and denies admin review access", async () => {
    h.docs.set(review, { rating: 4, text: 'Mine', uid: 'u' });
    const mine = () => GET(new NextRequest('http://localhost/api/community/reviews?tenantId=a&mine=1'));
    expect(await (await mine()).json()).toEqual({ canReview: true, review: { rating: 4, text: 'Mine' } });
    h.admin.mockResolvedValueOnce({ uid: 'u' });
    expect(await (await mine()).json()).toEqual({ canReview: false, review: null });
    h.member.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await mine()).status).toBe(403);
  });
  it('allows an active joined admin from another tenant to review, then refuses an explicit leave', async () => {
    h.docs.set('users/u', { tenantId: 'other', role: 'admin', displayName: 'Jane Doe' });
    h.docs.set('tenants/a/communityMembers/u', { status: 'active' });
    expect((await POST(req({ tenantId: 'a', rating: 5, text: 'Joined' }))).status).toBe(200);
    expect(await (await GET(new NextRequest('http://localhost/api/community/reviews?tenantId=a&mine=1'))).json()).toMatchObject({ canReview: true });
    h.docs.set('tenants/a/communityMembers/u', { status: 'left' });
    expect((await POST(req({ tenantId: 'a', rating: 5, text: 'Left' }))).status).toBe(403);
    expect((await GET(new NextRequest('http://localhost/api/community/reviews?tenantId=a&mine=1'))).status).toBe(403);
  });
  it('projects public reviews without uid or email', async () => {
    h.docs.set(review, { uid: 'u', authorName: 'Jane Doe', email: 'jane@example.com', rating: 5, text: 'Great' });
    const response = await GET(new NextRequest('http://localhost/api/community/reviews?tenantId=a'));
    const body = await response.json();
    expect(body.reviews).toEqual([expect.objectContaining({ authorName: 'Jane D.', rating: 5 })]);
    expect(body.reviews[0]).not.toHaveProperty('uid');
    expect(body.reviews[0]).not.toHaveProperty('email');
  });
});
