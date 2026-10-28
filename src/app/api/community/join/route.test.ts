import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { defaultCommunitySettings } from '@/lib/community/settings';

const fx = vi.hoisted(() => ({
  auth: vi.fn(), contact: vi.fn(), writes: vi.fn(),
  docs: {} as Record<string, Record<string, unknown>>,
  failRead: '', failWrite: false,
}));
type Ref = { path: string; collection: (id: string) => { doc: (id: string) => Ref } };
function ref(path: string): Ref {
  return { path, collection: id => ({ doc: key => ref(`${path}/${id}/${key}`) }) };
}
// Firestore merge:true recursively retains map keys, including the pending
// marker. Model that behavior so the rejoin test catches accidental map merges.
function mergeDocument(old: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const result = { ...old };
  for (const [key, value] of Object.entries(next)) {
    if (value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length) {
      const before = old[key];
      result[key] = mergeDocument(before && Object.getPrototypeOf(before) === Object.prototype ? before as Record<string, unknown> : {}, value as Record<string, unknown>);
    } else result[key] = value;
  }
  return result;
}
vi.mock('@/lib/api-auth', () => ({ requireAuth: fx.auth }));
vi.mock('@/lib/community-contact', () => ({ upsertCommunityContact: fx.contact }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {
  collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
  runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
    const pending: Array<{ ref: Ref; data: Record<string, unknown>; merge: boolean }> = [];
    await fn({
      get: async (reference: Ref) => {
        if (pending.length) throw new Error('Transaction reads must precede writes');
        if (fx.failRead === reference.path) throw new Error('Read unavailable');
        return { exists: !!fx.docs[reference.path], data: () => fx.docs[reference.path] };
      },
      set: (reference: Ref, data: Record<string, unknown>, options?: { merge: boolean }) => {
        pending.push({ ref: reference, data, merge: options?.merge === true });
      },
    });
    if (fx.failWrite) throw new Error('Write unavailable');
    for (const write of pending) {
      fx.writes(write.ref.path, write.data);
      fx.docs[write.ref.path] = write.merge ? mergeDocument(fx.docs[write.ref.path] ?? {}, write.data) : write.data;
    }
  },
} }));
import { POST as join } from './route';
import { POST as leave } from '../leave/route';
const memberPath = 'tenants/target/communityMembers/person';
const indexPath = 'users/person/memberships/target';
const joinBody = { tenantId: 'target', source: 'discover', consent: true };
function request(body: unknown) { return new NextRequest('http://localhost/api/community/join', { method: 'POST', body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.clearAllMocks();
  fx.auth.mockResolvedValue({ uid: 'person', email: 'person@test.com', tenantId: 'original', isAdmin: false });
  fx.contact.mockResolvedValue(undefined);
  fx.failRead = ''; fx.failWrite = false;
  fx.docs = {
    'tenants/target': { ownerId: 'owner', status: 'active' },
    'tenants/target/settings/community': { ...defaultCommunitySettings(), isPublic: true },
    'discovery_listings/target': { isPublic: true },
    'users/person': { tenantId: 'original', role: 'user' },
    'tenant_private/target': { adminEmails: [] },
  };
});

describe('join and leave API', () => {
  it.each([join, leave])('requires authentication', async handler => {
    fx.auth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    expect((await handler(request(joinBody))).status).toBe(401);
    expect(fx.writes).not.toHaveBeenCalled();
  });
  it.each([join, leave])('rejects malformed JSON', async handler => {
    expect((await handler(new NextRequest('http://localhost', { method: 'POST', body: '{' }))).status).toBe(400);
  });
  it.each([null, [], {}, { tenantId: '../target' }, { tenantId: 'a/b' }, { tenantId: ' ' }, { tenantId: 1 }])('rejects malformed tenant input %j', async body => {
    expect((await join(request(body))).status).toBe(400);
    expect((await leave(request(body))).status).toBe(400);
    expect(fx.writes).not.toHaveBeenCalled();
  });
  it.each([join, leave])('returns 404 for a nonexistent tenant', async handler => {
    delete fx.docs['tenants/target'];
    expect((await handler(request(handler === join ? joinBody : { tenantId: 'target' }))).status).toBe(404);
  });
  it.each([undefined, false, 'true', 1])('requires explicit consent %s', async consent => {
    expect((await join(request({ ...joinBody, consent }))).status).toBe(400);
    expect(fx.writes).not.toHaveBeenCalled();
  });
  it.each([
    { source: 'other' }, { source: 'Discover' }, { source: undefined },
    { rulesAcceptedVersion: -1 }, { rulesAcceptedVersion: 1.5 }, { rulesAcceptedVersion: '1' },
    { answers: [] }, { answers: { q: false } }, { answers: { q: 'a'.repeat(4001) } },
    { answers: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, 'x'])) },
    { uid: 'victim' }, { joinedAt: 'forged' }, { status: 'active' },
  ])('rejects invalid or forged join input %j', async invalid => {
    expect((await join(request({ ...joinBody, ...invalid }))).status).toBe(400);
    expect(fx.writes).not.toHaveBeenCalled();
  });
  it('rejects extra leave fields', async () => {
    expect((await leave(request({ tenantId: 'target', uid: 'victim' }))).status).toBe(400);
  });
  it.each(['private', 'unlisted', 'missing-settings', 'stale-listing', 'suspended'])('rejects %s communities', async kind => {
    if (kind === 'private') fx.docs['tenants/target/settings/community'].isPublic = false;
    if (kind === 'unlisted') delete fx.docs['discovery_listings/target'];
    if (kind === 'missing-settings') delete fx.docs['tenants/target/settings/community'];
    if (kind === 'stale-listing') fx.docs['discovery_listings/target'].isPublic = false;
    if (kind === 'suspended') fx.docs['tenants/target'].status = 'suspended';
    expect((await join(request(joinBody))).status).toBe(403);
    expect(fx.writes).not.toHaveBeenCalled();
    expect(fx.contact).not.toHaveBeenCalled();
  });
  it('atomically joins without changing primary tenant or writing a CRM contact', async () => {
    expect((await join(request({ ...joinBody, answers: { q: 'yes' }, rulesAcceptedVersion: 2 }))).status).toBe(200);
    const member = fx.docs[memberPath];
    expect(member).toMatchObject({ uid: 'person', tenantId: 'target', status: 'active', source: 'discover', leftAt: null, answers: { q: 'yes' }, rulesAcceptedVersion: 2 });
    expect(member.joinedAt).toBeInstanceOf(Timestamp);
    expect(member.consentAt).toEqual(member.joinedAt);
    expect(member.updatedAt).toEqual(member.joinedAt);
    expect(fx.docs[indexPath]).toEqual({ tenantId: 'target', status: 'active', joinedAt: member.joinedAt, leftAt: null });
    expect(fx.writes.mock.calls.map(call => call[0])).toEqual([memberPath, indexPath]);
    expect(fx.docs['users/person']).toEqual({ tenantId: 'original', role: 'user' });
    expect(fx.contact).toHaveBeenCalledWith({ uid: 'person', tenantId: 'target' });
  });
  it('keeps active rejoin a no-op, preserving consent, source, answers and all timestamps', async () => {
    await join(request(joinBody));
    const original = { ...fx.docs[memberPath] };
    fx.writes.mockClear();
    expect((await join(request({ ...joinBody, source: 'website', answers: { q: 'changed' } }))).status).toBe(200);
    expect(fx.docs[memberPath]).toEqual(original);
    expect(fx.writes).not.toHaveBeenCalled();
  });
  it('keeps genuine legacy members active, but does not accept an unrelated legacy entry', async () => {
    fx.docs[memberPath] = { rulesAcceptedVersion: 1, answers: { q: 'old' }, answeredAt: Timestamp.fromMillis(1) };
    fx.docs['users/person'].tenantId = 'target';
    expect((await join(request(joinBody))).status).toBe(200);
    expect(fx.writes).not.toHaveBeenCalled();
    fx.docs['users/person'].tenantId = 'original';
    expect((await join(request(joinBody))).status).toBe(200);
    expect(fx.docs[memberPath]).toMatchObject({ status: 'active', answers: { q: 'old' }, rulesAcceptedVersion: 1 });
  });
  it('leaves without deleting history and rejoins with fresh join/consent times', async () => {
    const old = Timestamp.fromMillis(1);
    fx.docs[memberPath] = { status: 'active', joinedAt: old, consentAt: old, source: 'link', rulesAcceptedVersion: 2, answers: { q: 'old' }, answeredAt: old };
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(200);
    expect(fx.docs[memberPath]).toMatchObject({ status: 'left', joinedAt: old, answers: { q: 'old' }, source: 'link' });
    expect(fx.docs[memberPath].leftAt).toBeInstanceOf(Timestamp);
    expect(fx.docs[indexPath]).toMatchObject({ status: 'left', joinedAt: old, leftAt: fx.docs[memberPath].leftAt });
    expect((await join(request(joinBody))).status).toBe(200);
    expect(fx.docs[memberPath]).toMatchObject({ status: 'active', leftAt: null, answers: { q: 'old' }, rulesAcceptedVersion: 2, answeredAt: old });
    expect(fx.docs[memberPath].joinedAt).not.toEqual(old);
    expect(fx.docs[memberPath].consentAt).toEqual(fx.docs[memberPath].joinedAt);
    expect(fx.docs[indexPath].status).toBe('active');
  });
  it('leaves a legacy primary membership without fabricating consent or join time', async () => {
    fx.docs['users/person'].tenantId = 'target';
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(200);
    expect(fx.docs[memberPath]).toMatchObject({ uid: 'person', tenantId: 'target', status: 'left' });
    expect(fx.docs[memberPath]).not.toHaveProperty('consentAt');
    expect(fx.docs[indexPath].joinedAt).toBeNull();
    fx.writes.mockClear();
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(200);
    expect(fx.writes).not.toHaveBeenCalled();
    expect((await join(request(joinBody))).status).toBe(200);
    expect(fx.docs[memberPath].status).toBe('active');
  });
  it('replaces pending answers on rejoin instead of retaining the pending marker', async () => {
    fx.docs[memberPath] = { status: 'left', answers: { __community_questions_pending__: 'true' }, answeredAt: Timestamp.fromMillis(1) };
    expect((await join(request({ ...joinBody, answers: { q: 'yes' } }))).status).toBe(200);
    expect(fx.docs[memberPath].answers).toEqual({ q: 'yes' });
  });
  it('makes leave for a nonmember a no-op', async () => {
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(200);
    expect(fx.writes).not.toHaveBeenCalled();
  });
  it.each(['owner', 'admin', 'church_admin', 'roster', 'claim-admin'])('prevents %s from leaving their tenant', async kind => {
    fx.docs[memberPath] = { status: 'active' };
    if (kind === 'owner') fx.docs['tenants/target'].ownerId = 'person';
    if (kind === 'admin' || kind === 'church_admin') fx.docs['users/person'] = { tenantId: 'target', role: kind };
    if (kind === 'roster') fx.docs['tenant_private/target'].adminEmails = ['PERSON@test.com'];
    if (kind === 'claim-admin') fx.auth.mockResolvedValue({ uid: 'person', tenantId: 'target', isAdmin: true });
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(400);
    expect(fx.writes).not.toHaveBeenCalled();
  });
  it('allows an admin of a different tenant to leave their joined community', async () => {
    fx.docs['users/person'].role = 'admin';
    fx.docs[memberPath] = { status: 'active' };
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(200);
    expect(fx.docs[memberPath].status).toBe('left');
  });
  it('requires current rules and required question answers on a new join', async () => {
    const settings = defaultCommunitySettings();
    settings.isPublic = true;
    settings.rules = { enabled: true, version: 3, items: ['Be kind'] };
    settings.questions = { enabled: true, items: [{ id: 'q', type: 'choice', label: 'Choice', required: true, options: ['Yes', 'No'] }] };
    fx.docs['tenants/target/settings/community'] = settings;
    expect((await join(request(joinBody))).status).toBe(400);
    expect((await join(request({ ...joinBody, rulesAcceptedVersion: 3, answers: { q: 'Invalid' } }))).status).toBe(400);
    expect(fx.writes).not.toHaveBeenCalled();
    expect((await join(request({ ...joinBody, rulesAcceptedVersion: 3, answers: { q: 'Yes' } }))).status).toBe(200);
  });
  it.each(['tenants/target', 'users/person', memberPath, 'tenants/target/settings/community', 'discovery_listings/target'])('surfaces failed join read %s without writing', async path => {
    fx.failRead = path;
    expect((await join(request(joinBody))).status).toBe(503);
    expect(fx.writes).not.toHaveBeenCalled();
  });
  it('surfaces failed leave authorization reads without writing', async () => {
    fx.failRead = 'tenant_private/target';
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(503);
    expect(fx.writes).not.toHaveBeenCalled();
  });
  it('fails closed when the saved admin roster is malformed', async () => {
    fx.docs[memberPath] = { status: 'active' };
    fx.docs['tenant_private/target'].adminEmails = 'person@test.com';
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(503);
    expect(fx.writes).not.toHaveBeenCalled();
  });
  it('surfaces invalid saved settings', async () => {
    fx.docs['tenants/target/settings/community'] = { isPublic: true };
    expect((await join(request(joinBody))).status).toBe(503);
    expect(fx.writes).not.toHaveBeenCalled();
  });
  it('does not report a failed transaction as a successful membership', async () => {
    fx.failWrite = true;
    expect((await join(request(joinBody))).status).toBe(503);
    expect(fx.docs[memberPath]).toBeUndefined();
    expect(fx.docs[indexPath]).toBeUndefined();
    expect(fx.contact).not.toHaveBeenCalled();
  });
  it('retries the future contact hook after a failure without rewriting membership', async () => {
    fx.contact.mockRejectedValueOnce(new Error('Contact unavailable'));
    expect((await join(request(joinBody))).status).toBe(503);
    const saved = fx.docs[memberPath];
    fx.writes.mockClear();
    expect((await join(request(joinBody))).status).toBe(200);
    expect(fx.contact).toHaveBeenCalledTimes(2);
    expect(fx.writes).not.toHaveBeenCalled();
    expect(fx.docs[memberPath]).toEqual(saved);
  });
});
