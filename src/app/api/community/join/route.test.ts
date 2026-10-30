import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { defaultCommunitySettings } from '@/lib/community/settings';

const fx = vi.hoisted(() => ({
  auth: vi.fn(), contact: vi.fn(), writes: vi.fn(),
  docs: {} as Record<string, Record<string, unknown>>,
  failRead: '', failWrite: false,
}));
type Ref = { path: string; id: string; field?: string; op?: string; value?: unknown; collection: (id: string) => Ref; doc: (id: string) => Ref; where: (field: string, op: string, value: unknown) => Ref; get: () => Promise<any>; update: (data: Record<string, unknown>) => Promise<void>; set: (data: Record<string, unknown>) => Promise<void> };
function read(reference: Ref): any {
  if (fx.failRead === reference.path) throw new Error('Read unavailable');
  if (reference.field || reference.path.split('/').length % 2 === 1) return { docs: Object.entries(fx.docs).filter(([path, data]) => path.startsWith(reference.path + '/') && path.split('/').length === reference.path.split('/').length + 1 && (!reference.field || (reference.op === 'array-contains' ? Array.isArray(data[reference.field!]) && (data[reference.field!] as unknown[]).includes(reference.value) : data[reference.field!] === reference.value))).map(([path]) => read(ref(path))) };
  return { id: reference.id, ref: reference, exists: !!fx.docs[reference.path], data: () => fx.docs[reference.path] };
}
function ref(path: string): Ref {
  const result: Ref = { path, id: path.split('/').at(-1)!, collection: id => ref(`${path}/${id}`), doc: id => ref(`${path}/${id}`), where: (field, op, value) => ({ ...ref(path), field, op, value }), get: async function () { return read(this); }, update: async data => { if (fx.failWrite) throw new Error('Write unavailable'); fx.docs[path] = mergeDocument(fx.docs[path], data); }, set: async data => { if (fx.failWrite) throw new Error('Write unavailable'); fx.docs[path] = data; } };
  return result;
}
// Firestore merge:true recursively retains map keys, including the pending
// marker. Model that behavior so the rejoin test catches accidental map merges.
function mergeDocument(old: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const result = { ...old };
  for (const [key, value] of Object.entries(next)) {
    if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) { delete result[key]; continue; }
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
  collection: (name: string) => ref(name),
  runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
    const pending: Array<{ ref: Ref; data: Record<string, unknown>; merge: boolean }> = [];
    await fn({
      get: async (reference: Ref) => {
        if (pending.length) throw new Error('Transaction reads must precede writes');
        if (fx.failRead === reference.path) throw new Error('Read unavailable');
        return read(reference);
      },
      delete: (reference: Ref) => pending.push({ ref: reference, data: { __delete: true }, merge: false }),
      update: (reference: Ref, data: Record<string, unknown>) => pending.push({ ref: reference, data, merge: true }),
      set: (reference: Ref, data: Record<string, unknown>, options?: { merge: boolean }) => {
        pending.push({ ref: reference, data, merge: options?.merge === true });
      },
    });
    if (fx.failWrite) throw new Error('Write unavailable');
    for (const write of pending) {
      fx.writes(write.ref.path, write.data);
      if (write.data.__delete) { delete fx.docs[write.ref.path]; continue; }
      fx.docs[write.ref.path] = write.merge ? mergeDocument(fx.docs[write.ref.path] ?? {}, write.data) : write.data;
    }
  },
} }));
import { POST as join } from './route';
import { POST as leave } from '../leave/route';
import { POST as erase } from '../delete-data/route';
import { firestoreEmailStore } from '@/lib/email/firestore-store';
import { build, admin } from '@/lib/email/__tests__/helpers';
import { resolveAudience } from '@/lib/email/audience';
import { communitySuppressionId, tenantEmailBlocked, tenantBlockedEmailHashes } from '@/lib/community-privacy';
const memberPath = 'tenants/target/communityMembers/person';
const indexPath = 'users/person/memberships/target';
const joinBody = { tenantId: 'target', source: 'discover', consent: true, acceptedConsentVersion: 2 };
function request(body: unknown) { return new NextRequest('http://localhost/api/community/join', { method: 'POST', body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'community-test-secret');
  fx.auth.mockResolvedValue({ uid: 'person', email: 'person@test.com', emailVerified: true, tenantId: 'original', isAdmin: false });
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
  it('rejects Firestore-reserved answer keys before any write', async () => {
    expect((await join(request({ ...joinBody, answers: { __reserved__: 'bad' } }))).status).toBe(400);
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
    { consentScope: 'forged' }, { consentVersion: 1 }, { acceptedConsentVersion: 1 }, { acceptedConsentVersion: undefined },
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
  it('atomically joins without changing primary tenant and awaits the CRM upsert', async () => {
    expect((await join(request({ ...joinBody, answers: { q: 'yes' }, rulesAcceptedVersion: 2 }))).status).toBe(200);
    const member = fx.docs[memberPath];
    expect(member).toMatchObject({ uid: 'person', tenantId: 'target', status: 'active', source: 'discover', leftAt: null, answers: { q: 'yes' }, rulesAcceptedVersion: 2 });
    expect(member.joinedAt).toBeInstanceOf(Timestamp);
    expect(member.consentAt).toEqual(member.joinedAt);
    expect(member.consentScope).toBe('owner_contact_and_view_name_email_answers');
    expect(member.consentVersion).toBe(2);
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
  it('retries contact updates after a failed leave without changing the leave timestamp', async () => {
    await join(request(joinBody));
    fx.contact.mockRejectedValueOnce(new Error('CRM offline'));
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(503);
    const leftAt = fx.docs[memberPath].leftAt;
    fx.writes.mockClear();
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(200);
    expect(fx.docs[memberPath].leftAt).toEqual(leftAt);
    expect(fx.writes).not.toHaveBeenCalled();
    expect(fx.contact).toHaveBeenLastCalledWith({ uid: 'person', tenantId: 'target' });
  });
  it('retries the contact upsert after a failure without rewriting membership', async () => {
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

describe('departure privacy', () => {
  beforeEach(async () => {
    // The token email is the one rejoin trusts; keep it equal to the member's
    // real address here so happy-path unblocking still exercises that path.
    fx.auth.mockResolvedValue({ uid: 'person', email: 'member@example.org', emailVerified: true, tenantId: 'original', isAdmin: false });
    await join(request(joinBody));
    fx.docs['users/person'].email = ' MEMBER@Example.org ';
    fx.docs['contacts/linked'] = { tenantId: 'target', communityUserId: 'person', email: 'member@example.org', emailStatus: 'subscribed', notes: 'private' };
    fx.docs['contacts/duplicate'] = { tenantId: 'target', email: ' MEMBER@example.org ', emailStatus: 'subscribed' };
    fx.docs['contacts/foreign'] = { tenantId: 'foreign', communityUserId: 'person', email: 'member@example.org', emailStatus: 'subscribed' };
    fx.docs['tenants/target/channels/private'] = { members: ['person', 'other'], audience: 'selected' };
    fx.docs['tenants/target/channels/all'] = { members: ['person'], audience: 'all' };
    fx.docs['tenants/foreign/channels/private'] = { members: ['person'] };
  });
  it('blocks email and removes all channel rosters atomically even if CRM repair fails', async () => {
    fx.contact.mockRejectedValueOnce(new Error('CRM offline'));
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(503);
    expect(fx.docs[memberPath].status).toBe('left');
    expect(fx.docs['contacts/linked']).toMatchObject({ communityStatus: 'left', emailStatus: 'unsubscribed', communityLeftAt: fx.docs[memberPath].leftAt });
    expect(fx.docs['contacts/duplicate'].emailStatus).toBe('unsubscribed');
    expect(fx.docs['contacts/foreign'].emailStatus).toBe('subscribed');
    expect(await tenantEmailBlocked('target', ' Member@EXAMPLE.org ')).toBe(true);
    expect(await tenantEmailBlocked('foreign', 'member@example.org')).toBe(false);
    expect(fx.docs['tenants/target/channels/private'].members).toEqual(['other']);
    expect(fx.docs['tenants/target/channels/all'].members).toEqual([]);
    expect(fx.docs['tenants/foreign/channels/private'].members).toEqual(['person']);
    expect((await join(request(joinBody))).status).toBe(200);
    expect(fx.docs['tenants/target/channels/private'].members).toEqual(['other']);
    expect(await tenantEmailBlocked('target', 'member@example.org')).toBe(false);
    expect(fx.docs[memberPath].consentVersion).toBe(2);
    expect(fx.docs['contacts/linked']).toMatchObject({ communityStatus: 'active', communityLeftAt: null, emailStatus: 'none' });
    // Unlinked (no communityUserId) means rejoin never touches it, even though
    // its address matches: that match is exactly the forgeable surface in B1.
    expect(fx.docs['contacts/duplicate'].emailStatus).toBe('unsubscribed');
    expect(fx.docs['contacts/foreign'].emailStatus).toBe('subscribed');
  });
  it('does not let a manageCRM-edited contact email unblock a victim address on rejoin (B1)', async () => {
    await leave(request({ tenantId: 'target' }));
    // The victim separately left this same community, so their address is
    // genuinely blocked under their own 'community-leave' record.
    fx.docs[`tenants/target/emailSuppressions/${communitySuppressionId('victim@example.org')}`] =
      { emailHash: communitySuppressionId('victim@example.org'), status: 'unsubscribed', from: 'community-leave', at: '2020-01-01' };
    // An admin with manageCRM repoints the left member's own contact at the
    // victim's address after both leave blocks were already written.
    fx.docs['contacts/linked'].email = 'victim@example.org';
    expect((await join(request(joinBody))).status).toBe(200);
    // The member's own address is legitimately unblocked by their rejoin...
    expect(await tenantEmailBlocked('target', 'member@example.org')).toBe(false);
    // ...but the victim's block, reachable only through the forged contact
    // email, must survive.
    expect(await tenantEmailBlocked('target', 'victim@example.org')).toBe(true);
    expect(fx.docs['contacts/linked']).toMatchObject({ communityStatus: 'active', email: 'victim@example.org' });
  });
  it('does not unblock an address from a stale profile email that differs from the verified token email (B1)', async () => {
    await leave(request({ tenantId: 'target' }));
    // The Firestore profile document still carries the member's address, but
    // the signed-in token (what rejoin must trust) now has a different email.
    fx.auth.mockResolvedValue({ uid: 'person', email: 'other@example.org', emailVerified: true, tenantId: 'original', isAdmin: false });
    expect((await join(request(joinBody))).status).toBe(200);
    expect(await tenantEmailBlocked('target', 'member@example.org')).toBe(true);
    expect(fx.docs['contacts/linked']).toMatchObject({ communityStatus: 'active', emailStatus: 'unsubscribed' });
  });
  it('clears nothing on rejoin when the token email is unverified (B1)', async () => {
    await leave(request({ tenantId: 'target' }));
    fx.auth.mockResolvedValue({ uid: 'person', email: 'member@example.org', emailVerified: false, tenantId: 'original', isAdmin: false });
    expect((await join(request(joinBody))).status).toBe(200);
    expect(await tenantEmailBlocked('target', 'member@example.org')).toBe(true);
    expect(fx.docs['contacts/linked']).toMatchObject({ communityStatus: 'active', emailStatus: 'unsubscribed' });
  });
  it('excludes left members and duplicates from the real newsletter store and audience', async () => {
    fx.docs['contacts/allowed'] = { tenantId: 'target', email: 'allowed@example.org', emailStatus: 'subscribed' };
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(200);
    // Even a stale server-side opt-in cannot override the left marker.
    fx.docs['contacts/linked'].emailStatus = 'subscribed';
    const contacts = await firestoreEmailStore.listContacts('target');
    expect(contacts.find(contact => contact.id === 'linked')?.status).toBe('unsubscribed');
    const suppressed = await firestoreEmailStore.listSuppressed('target');
    expect(suppressed.has(communitySuppressionId(' MEMBER@example.org '))).toBe(true);
    expect(resolveAudience(contacts, [], new Set(contacts.filter(c => suppressed.has(communitySuppressionId(c.email))).map(c => c.email))).recipients.map(contact => contact.email)).toEqual(['allowed@example.org']);
    delete fx.docs['contacts/linked']; delete fx.docs['contacts/duplicate'];
    fx.docs['contacts/reimported'] = { tenantId: 'target', email: 'member@example.org', emailStatus: 'subscribed' };
    const reimported = await firestoreEmailStore.listContacts('target');
    const hashes = await firestoreEmailStore.listSuppressed('target');
    expect(resolveAudience(reimported, [], new Set(reimported.filter(c => hashes.has(communitySuppressionId(c.email))).map(c => c.email))).recipients.map(contact => contact.email)).toEqual(['allowed@example.org']);
  });
  it('keeps a stale subscribed left contact out of newsletters even without a suppression document', async () => {
    fx.docs['contacts/linked'].communityStatus = 'left';
    delete fx.docs['contacts/duplicate'];
    const contacts = await firestoreEmailStore.listContacts('target');
    expect((await firestoreEmailStore.listSuppressed('target')).size).toBe(0);
    expect(resolveAudience(contacts, []).recipients).toEqual([]);
  });
  it('keeps a stale subscribed contact out of every block lookup solely by its hash record', async () => {
    await leave(request({ tenantId: 'target' }));
    fx.docs['contacts/linked'] = { tenantId: 'target', email: ' MEMBER@Example.org ', emailStatus: 'subscribed' };
    delete fx.docs['contacts/duplicate'];
    const key = communitySuppressionId('member@example.org');
    expect(fx.docs[`tenants/target/emailSuppressions/${key}`]).not.toHaveProperty('email');
    expect(await tenantEmailBlocked('target', 'member@example.org')).toBe(true);
    expect(await firestoreEmailStore.isSuppressedNow('target', ' MEMBER@example.org ')).toBe(true);
    expect(await firestoreEmailStore.isSuppressedNow('foreign', 'member@example.org')).toBe(false);
    expect((await tenantBlockedEmailHashes('target')).has(key)).toBe(true);
    const hashes = await firestoreEmailStore.listSuppressed('target');
    expect(hashes.has(key)).toBe(true);
    const contacts = await firestoreEmailStore.listContacts('target');
    expect(contacts[0].status).toBe('subscribed');
    fx.docs['contacts/allowed'] = { tenantId: 'target', email: 'allowed@example.org', emailStatus: 'subscribed' };
    const ctx = build({ domainOwners: { 'grace.org': 'target' } });
    ctx.mem.store.listContacts = firestoreEmailStore.listContacts;
    ctx.mem.store.listSuppressed = firestoreEmailStore.listSuppressed;
    ctx.mem.store.isSuppressedNow = firestoreEmailStore.isSuppressedNow;
    const actor = { ...admin, tenantId: 'target' };
    const saved = await ctx.service.saveDraft(actor, 'target', { subject: 'News', bodyHtml: '<p>Hello</p>' });
    if (!saved.ok) throw new Error('Draft failed');
    const preview = await ctx.service.send(actor, 'target', { id: saved.broadcast.id, when: { mode: 'now' }, mode: 'preview' });
    expect(preview).toMatchObject({ ok: true, preview: { recipientCount: 1, skipped: { suppressed: 1 } } });
    if (!preview.ok || !('confirmToken' in preview)) throw new Error('Preview failed');
    const sent = await ctx.service.send(actor, 'target', { id: saved.broadcast.id, when: { mode: 'now' }, mode: 'confirm', confirmToken: preview.confirmToken });
    expect(sent).toMatchObject({ ok: true, outcome: 'sent' });
    expect(ctx.provider.sent.map(message => message.to)).toEqual(['allowed@example.org']);
  });
  it.each(['individual', 'newsletter-list', 'announcement-list'])('reads and scrubs legacy plaintext blocks through %s', async path => {
    const key = createHash('sha256').update('member@example.org').digest('hex');
    const record = `tenants/target/emailSuppressions/${key}`;
    fx.docs[record] = { email: 'member@example.org', status: 'unsubscribed', from: 'community-leave', at: '2020-01-01' };
    if (path === 'individual') expect(await tenantEmailBlocked('target', ' MEMBER@example.org ')).toBe(true);
    if (path === 'newsletter-list') expect((await firestoreEmailStore.listSuppressed('target')).has(key)).toBe(true);
    if (path === 'announcement-list') expect((await tenantBlockedEmailHashes('target')).has(key)).toBe(true);
    expect(fx.docs[record]).toEqual({ emailHash: key, status: 'unsubscribed', from: 'community-leave', at: '2020-01-01' });
  });
  it.each(['unsubscribed', 'bounced', 'complained'])('writes hash-only newsletter %s records over legacy plaintext', async status => {
    const key = communitySuppressionId('member@example.org');
    const path = `tenants/target/emailSuppressions/${key}`;
    fx.docs[path] = { email: 'member@example.org' };
    // No matching contact: the durable block still has to be written.
    delete fx.docs['contacts/linked']; delete fx.docs['contacts/duplicate'];
    if (status === 'unsubscribed') await firestoreEmailStore.recordOptOut('target', ' MEMBER@example.org ', 'broadcast', '2020-01-01');
    else await firestoreEmailStore.markContactStatus('target', ' MEMBER@example.org ', status as 'bounced' | 'complained', '2020-01-01');
    expect(fx.docs[path]).toMatchObject({ emailHash: key, status });
    expect(fx.docs[path]).not.toHaveProperty('email');
  });
  it('requires current consent before unblocking rejoin, even when CRM repair later fails', async () => {
    await leave(request({ tenantId: 'target' }));
    expect((await join(request({ ...joinBody, acceptedConsentVersion: 1 }))).status).toBe(400);
    expect(await tenantEmailBlocked('target', 'member@example.org')).toBe(true);
    fx.contact.mockRejectedValueOnce(new Error('CRM unavailable'));
    expect((await join(request(joinBody))).status).toBe(503);
    expect(fx.docs[memberPath]).toMatchObject({ status: 'active', consentVersion: 2 });
    expect(fx.docs['contacts/linked']).toMatchObject({ communityStatus: 'active', communityLeftAt: null });
    expect(await tenantEmailBlocked('target', 'member@example.org')).toBe(false);
    expect((await join(request(joinBody))).status).toBe(200);
  });
  it('fails closed if legacy plaintext cannot be scrubbed', async () => {
    const path = `tenants/target/emailSuppressions/${communitySuppressionId('member@example.org')}`;
    fx.docs[path] = { email: 'member@example.org', status: 'unsubscribed' };
    fx.failWrite = true;
    await expect(tenantEmailBlocked('target', 'member@example.org')).rejects.toThrow('Write unavailable');
    await expect(firestoreEmailStore.listSuppressed('target')).rejects.toThrow('Write unavailable');
    await expect(tenantBlockedEmailHashes('target')).rejects.toThrow('Write unavailable');
  });
  it('does not commit a rejoin or clear its block when block reads fail', async () => {
    await leave(request({ tenantId: 'target' }));
    fx.failRead = `tenants/target/emailSuppressions/${communitySuppressionId('member@example.org')}`;
    expect((await join(request(joinBody))).status).toBe(503);
    expect(fx.docs[memberPath].status).toBe('left');
    expect(fx.docs['contacts/linked'].communityStatus).toBe('left');
    expect(fx.docs[fx.failRead]).toBeDefined();
  });
  it('does not turn an existing newsletter complaint into a clearable departure block', async () => {
    const path = `tenants/target/emailSuppressions/${communitySuppressionId('member@example.org')}`;
    fx.docs[path] = { email: 'member@example.org', status: 'complained', from: '', at: '2020-01-01' };
    await leave(request({ tenantId: 'target' }));
    expect(fx.docs[path]).not.toHaveProperty('email');
    expect((await join(request(joinBody))).status).toBe(200);
    expect(fx.docs[path].status).toBe('complained');
    expect(await tenantEmailBlocked('target', 'member@example.org')).toBe(true);
  });
  it('retains a later bounce block on rejoin', async () => {
    await leave(request({ tenantId: 'target' }));
    const path = `tenants/target/emailSuppressions/${communitySuppressionId('member@example.org')}`;
    fx.docs[path] = { emailHash: communitySuppressionId('member@example.org'), status: 'bounced', from: '' };
    expect((await join(request(joinBody))).status).toBe(200);
    expect(fx.docs[path].status).toBe('bounced');
    expect(await tenantEmailBlocked('target', 'member@example.org')).toBe(true);
    expect(fx.docs['contacts/linked'].communityStatus).toBe('active');
  });
  it('rolls back membership when channel/contact reads or writes fail', async () => {
    for (const path of ['contacts', 'tenants/target/channels']) {
      fx.failRead = path;
      expect((await leave(request({ tenantId: 'target' }))).status).toBe(503);
      expect(fx.docs[memberPath].status).toBe('active');
    }
    fx.failRead = ''; fx.failWrite = true;
    expect((await leave(request({ tenantId: 'target' }))).status).toBe(503);
    expect(fx.docs[memberPath].status).toBe('active');
    expect(fx.docs['contacts/linked'].emailStatus).toBe('subscribed');
  });
  it.each(['member', 'owner'])('allows the %s to erase CRM and answers without restoring access or email', async actor => {
    fx.docs['contactActivities/one'] = { tenantId: 'target', contactId: 'linked', description: 'private' };
    fx.docs['contactActivities/foreign'] = { tenantId: 'foreign', contactId: 'linked' };
    fx.docs['invoices/gift'] = { tenantId: 'target', amount: 100 };
    fx.docs[`tenants/target/emailSuppressions/${communitySuppressionId('member@example.org')}`] = { email: 'member@example.org', from: 'community-leave', status: 'unsubscribed' };
    if (actor === 'owner') fx.auth.mockResolvedValue({ uid: 'owner' });
    expect((await erase(request({ tenantId: 'target', uid: 'person' }))).status).toBe(200);
    expect(fx.docs['contacts/linked']).toBeUndefined();
    expect(fx.docs['contactActivities/one']).toBeUndefined();
    expect(fx.docs['contacts/foreign']).toBeDefined();
    expect(fx.docs['contactActivities/foreign']).toBeDefined();
    expect(fx.docs['invoices/gift']).toEqual({ tenantId: 'target', amount: 100 });
    expect(fx.docs[memberPath]).toMatchObject({ status: 'left', dataDeletedAt: expect.any(Timestamp) });
    expect(fx.docs[memberPath]).not.toHaveProperty('answers');
    expect(fx.docs[memberPath]).not.toHaveProperty('consentAt');
    expect(fx.docs[indexPath]).toBeUndefined();
    const block = fx.docs[`tenants/target/emailSuppressions/${communitySuppressionId('member@example.org')}`];
    expect(block).toEqual({ emailHash: createHash('sha256').update('member@example.org').digest('hex'), status: 'unsubscribed', from: 'community-leave', at: expect.any(String) });
    expect(await tenantEmailBlocked('target', 'member@example.org')).toBe(true);
    expect((await erase(request({ tenantId: 'target', uid: 'person' }))).status).toBe(200);
  });
  it('rejects other members, foreign owners and staff, regardless of token admin claims', async () => {
    for (const uid of ['outsider', 'foreign-owner', 'staff']) {
      fx.auth.mockResolvedValue({ uid, tenantId: 'target', isAdmin: true, isSuperAdmin: true });
      expect((await erase(request({ tenantId: 'target', uid: 'person' }))).status).toBe(403);
      expect(fx.docs['contacts/linked']).toBeDefined();
    }
  });
  it('uses current Firestore ownership even when a former owner still has admin claims', async () => {
    fx.docs['tenants/target'].ownerId = 'new-owner';
    fx.auth.mockResolvedValue({ uid: 'owner', tenantId: 'target', isAdmin: true, ownerId: 'owner' });
    expect((await erase(request({ tenantId: 'target', uid: 'person' }))).status).toBe(403);
    expect(fx.docs['contacts/linked']).toBeDefined();
    fx.auth.mockResolvedValue({ uid: 'new-owner', isAdmin: false });
    expect((await erase(request({ tenantId: 'target', uid: 'person' }))).status).toBe(200);
  });
  it('does not claim deletion succeeded when reads or writes fail', async () => {
    fx.failRead = 'contactActivities';
    expect((await erase(request({ tenantId: 'target' }))).status).toBe(503);
    expect(fx.docs['contacts/linked']).toBeDefined();
    fx.failRead = ''; fx.failWrite = true;
    expect((await erase(request({ tenantId: 'target' }))).status).toBe(503);
    expect(fx.docs['contacts/linked']).toBeDefined();
  });
});
