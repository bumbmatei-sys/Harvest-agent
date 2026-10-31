import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { newCommunityDraft } from '@/lib/community/communities';
import { COMMUNITY_CONSENT_VERSION } from '@/lib/community-membership';

/** A tiny in-memory Firestore: documents by path, collections by prefix. */
const h = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const docRef = (path: string): any => ({
    path, id: path.split('/').pop(),
    collection: (name: string) => colRef(`${path}/${name}`),
    get: async () => snap(path),
  });
  const snap = (path: string) => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => docs.get(path) });
  const children = (path: string) => [...docs.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).sort();
  const colRef = (path: string): any => {
    const query = { isQuery: true, path, get: async () => ({ docs: children(path).map(snap) }) };
    return { path, doc: (id: string) => docRef(`${path}/${id}`), select: () => query, orderBy: () => query };
  };
  const tx = {
    get: async (ref: any) => (ref.isQuery ? ref.get() : snap(ref.path)),
    set: (ref: any, data: Record<string, unknown>, opts?: { merge?: boolean }) => { docs.set(ref.path, opts?.merge ? { ...(docs.get(ref.path) ?? {}), ...data } : data); },
    create: (ref: any, data: Record<string, unknown>) => { if (docs.has(ref.path)) throw new Error('exists'); docs.set(ref.path, data); },
    update: (ref: any, data: Record<string, unknown>) => { docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data }); },
    delete: (ref: any) => { docs.delete(ref.path); },
  };
  return {
    docs, auth: vi.fn(),
    db: { collection: (name: string) => colRef(name), runTransaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
  };
});
vi.mock('@/lib/firebase-admin', () => ({ adminDb: h.db }));
vi.mock('@/lib/api-auth', () => ({ requireAuth: h.auth, requireTenantAdmin: vi.fn(), requireTenantPermission: vi.fn() }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: { now: () => 'now' } }));
import { DELETE, POST } from './[communityId]/membership/route';

const T = 'tenants/grace';
const join = (id: string, over: Record<string, unknown> = {}) => POST(new NextRequest(`http://localhost/api/communities/${id}/membership`, { method: 'POST', body: JSON.stringify({ tenantId: 'grace', consent: true, acceptedConsentVersion: COMMUNITY_CONSENT_VERSION, ...over }) }), { params: { communityId: id } });
const leave = (id: string) => DELETE(new NextRequest(`http://localhost/api/communities/${id}/membership`, { method: 'DELETE', body: JSON.stringify({ tenantId: 'grace' }) }), { params: { communityId: id } });
const open = { ...newCommunityDraft('Youth'), visibility: 'public', status: 'published' };

beforeEach(() => {
  h.docs.clear();
  h.auth.mockResolvedValue({ uid: 'u1', email: 'u1@test.com' });
  h.docs.set('users/u1', { displayName: 'Ana' });
  h.docs.set(`${T}/communities/youth`, open);
});

describe('joining and leaving a community', () => {
  it('needs a signed-in user', async () => {
    h.auth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    expect((await join('youth')).status).toBe(401);
    expect(h.docs.has(`${T}/communities/youth/members/u1`)).toBe(false);
  });

  it('joins an open, public, published, free community with consent, and indexes it for the member', async () => {
    expect((await join('youth')).status).toBe(200);
    expect(h.docs.get(`${T}/communities/youth/members/u1`)).toMatchObject({ uid: 'u1', tenantId: 'grace', communityId: 'youth', status: 'active', consentVersion: COMMUNITY_CONSENT_VERSION });
    expect(h.docs.get('users/u1/communityMemberships/grace__youth')).toMatchObject({ status: 'active', communityId: 'youth' });
  });

  it.each([
    ['a draft', { status: 'draft' }],
    ['a private community', { visibility: 'private' }],
    ['an apply-first community', { joining: { mode: 'apply' } }],
    ['a paid community', { pricing: { type: 'paid', amountCents: 500, currency: 'usd', interval: 'month' } }],
  ])('refuses %s', async (_, over) => {
    h.docs.set(`${T}/communities/youth`, { ...open, ...over });
    expect((await join('youth')).status).toBe(403);
    expect(h.docs.has(`${T}/communities/youth/members/u1`)).toBe(false);
  });

  it('refuses without the current consent, without an account, and for the default community', async () => {
    expect((await join('youth', { consent: false })).status).toBe(400);
    expect((await join('youth', { acceptedConsentVersion: 1 })).status).toBe(400);
    expect((await join('default')).status).toBe(400);
    h.docs.delete('users/u1');
    expect((await join('youth')).status).toBe(409);
    expect((await join('missing')).status).toBe(404);
  });

  it('leaves, keeping the join date, and leaving twice changes nothing', async () => {
    await join('youth');
    expect((await leave('youth')).status).toBe(200);
    expect(h.docs.get(`${T}/communities/youth/members/u1`)).toMatchObject({ status: 'left', leftAt: 'now' });
    expect(h.docs.get('users/u1/communityMemberships/grace__youth')).toMatchObject({ status: 'left', joinedAt: 'now' });
    expect((await leave('youth')).status).toBe(200);
  });
});
