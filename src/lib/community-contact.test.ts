import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
const h = vi.hoisted(() => ({ docs: new Map<string, Record<string, any>>(), getUser: vi.fn(), writes: vi.fn(), fail: false }));
vi.mock('./firebase-admin', () => {
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), collection: (key: string) => ref(`${path}/${key}`), doc: (key: string) => ref(`${path}/${key}`), where: (field: string, op: string, value: unknown) => ({ query: true, path, field, op, value }) });
  const snap = (path: string) => ({ id: path.split('/').at(-1), ref: ref(path), exists: h.docs.has(path), data: () => h.docs.get(path) });
  return { adminAuth: { getUser: h.getUser }, adminDb: { collection: ref, runTransaction: async (fn: (tx: any) => Promise<void>) => {
    const pending: Array<[any, any, any]> = [];
    await fn({ get: async (r: any) => {
      if (h.fail) throw new Error('offline');
      if (pending.length) throw new Error('read after write');
      if (r.query) return { docs: [...h.docs].filter(([path, data]) => path.startsWith(`${r.path}/`) && data[r.field] === r.value).map(([path]) => snap(path)) };
      return snap(r.path);
    }, set: (...args: [any, any, any]) => pending.push(args) });
    for (const [r, data, options] of pending) { h.writes(r.path, data); h.docs.set(r.path, options?.merge ? { ...h.docs.get(r.path), ...data } : data); }
  } } };
});
import { upsertCommunityContact } from './community-contact';
const joined = Timestamp.fromMillis(1000);
const left = Timestamp.fromMillis(2000);
const input = { uid: 'u', tenantId: 'target' };
const contactRows = () => [...h.docs].filter(([path]) => path.startsWith('contacts/'));
beforeEach(() => {
  vi.clearAllMocks(); h.docs.clear(); h.fail = false;
  h.getUser.mockResolvedValue({ displayName: 'Auth Name', email: 'auth@example.org', phoneNumber: 'PRIVATE' });
  h.docs.set('users/u', { name: 'Ada Lovelace', email: ' ADA@Example.org ', phone: 'PRIVATE', address: 'PRIVATE', memberships: ['PRIVATE'], tenantId: 'other', role: 'admin' });
  h.docs.set('tenants/target/communityMembers/u', { status: 'active', source: 'discover', joinedAt: joined, consentAt: joined, leftAt: null, answers: { private: 'PRIVATE' } });
});
describe('community contact upsert', () => {
  it('creates a flat, tenant-scoped CRM contact with only consented profile fields', async () => {
    await upsertCommunityContact(input);
    expect(contactRows()).toHaveLength(1);
    const [path, data] = contactRows()[0];
    expect(path).toMatch(/^contacts\/community_target_[a-f0-9]{64}$/);
    expect(data).toMatchObject({ tenantId: 'target', name: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.org', type: 'member', source: 'community', communityUserId: 'u', communitySource: 'discover', communityStatus: 'active', communityJoinedAt: joined, communityLeftAt: null, phone: '' });
    expect(JSON.stringify(data)).not.toContain('PRIVATE');
    expect(data).not.toHaveProperty('role'); expect(data).not.toHaveProperty('memberships'); expect(data).not.toHaveProperty('answers');
    expect(h.getUser).not.toHaveBeenCalled();
  });
  it('is idempotent and preserves the original timestamps on active retries', async () => {
    await upsertCommunityContact(input);
    const original = contactRows()[0];
    await upsertCommunityContact(input);
    expect(contactRows()).toEqual([original]);
  });
  it('links the first same-tenant normalised email match, preserving owner edits and gifts', async () => {
    h.docs.set('contacts/existing', { tenantId: 'target', firstName: 'Owner edited', email: ' Ada@EXAMPLE.org ', notes: 'keep', totalDonated: 50, type: 'donor' });
    await upsertCommunityContact(input);
    expect(contactRows()).toHaveLength(1);
    expect(h.docs.get('contacts/existing')).toMatchObject({ firstName: 'Owner edited', notes: 'keep', totalDonated: 50, type: 'donor', communityUserId: 'u', communityStatus: 'active' });
  });
  it('retains the UID link even when the profile email changes before leaving', async () => {
    await upsertCommunityContact(input);
    h.docs.get('users/u')!.email = 'changed@example.org';
    Object.assign(h.docs.get('tenants/target/communityMembers/u')!, { status: 'left', leftAt: left });
    await upsertCommunityContact(input);
    expect(contactRows()).toHaveLength(1);
    expect(contactRows()[0][1]).toMatchObject({ email: 'ada@example.org', communityStatus: 'left', communityJoinedAt: joined, communityLeftAt: left });
    await upsertCommunityContact(input);
    expect(contactRows()[0][1].communityLeftAt).toEqual(left);
  });
  it('repairs a failed join contact even after leave and clears leftAt on rejoin', async () => {
    Object.assign(h.docs.get('tenants/target/communityMembers/u')!, { status: 'left', leftAt: left });
    await upsertCommunityContact(input);
    expect(contactRows()[0][1].communityStatus).toBe('left');
    Object.assign(h.docs.get('tenants/target/communityMembers/u')!, { status: 'active', source: 'website', joinedAt: left, leftAt: null });
    await upsertCommunityContact(input);
    expect(contactRows()[0][1]).toMatchObject({ communityStatus: 'active', communitySource: 'website', communityJoinedAt: left, communityLeftAt: null });
  });
  it('does not link another tenant contact with the same email', async () => {
    const foreign = { tenantId: 'other', email: 'ada@example.org', notes: 'PRIVATE' };
    h.docs.set('contacts/foreign', foreign);
    await upsertCommunityContact(input);
    expect(contactRows()).toHaveLength(2);
    expect(h.docs.get('contacts/foreign')).toEqual(foreign);
    expect(h.writes.mock.calls.every(([path]) => path !== 'contacts/foreign')).toBe(true);
  });
  it('falls back only to Auth name/email and surfaces Auth failures', async () => {
    h.docs.set('users/u', { tenantId: 'elsewhere' });
    await upsertCommunityContact(input);
    expect(contactRows()[0][1]).toMatchObject({ name: 'Auth Name', email: 'auth@example.org', phone: '' });
    h.docs.delete(contactRows()[0][0]);
    h.getUser.mockRejectedValue(new Error('auth offline'));
    await expect(upsertCommunityContact(input)).rejects.toThrow('auth offline');
  });
  it('surfaces a missing shareable identity instead of inventing one', async () => {
    h.docs.set('users/u', {});
    h.getUser.mockResolvedValue({ email: 'ada@example.org' });
    await expect(upsertCommunityContact(input)).rejects.toThrow('A name and email are required');
    expect(h.writes).not.toHaveBeenCalled();
  });
  it('marks an already linked contact left even if the shareable profile is now unavailable', async () => {
    await upsertCommunityContact(input);
    h.docs.set('users/u', {}); h.getUser.mockRejectedValue(new Error('Auth offline'));
    Object.assign(h.docs.get('tenants/target/communityMembers/u')!, { status: 'left', leftAt: left });
    await upsertCommunityContact(input);
    expect(contactRows()[0][1]).toMatchObject({ communityStatus: 'left', communityLeftAt: left });
    expect(h.getUser).not.toHaveBeenCalled();
  });
  it('does not quietly accept a corrupt server membership with missing consent', async () => {
    delete h.docs.get('tenants/target/communityMembers/u')!.consentAt;
    await expect(upsertCommunityContact(input)).rejects.toThrow('Missing community sharing consent');
    expect(h.writes).not.toHaveBeenCalled();
  });
  it('does not fabricate contact consent for legacy membership or a non-member', async () => {
    h.docs.set('tenants/target/communityMembers/u', { status: 'left' });
    await upsertCommunityContact(input);
    h.docs.delete('tenants/target/communityMembers/u');
    await upsertCommunityContact(input);
    expect(h.writes).not.toHaveBeenCalled();
  });
  it('propagates failed reads rather than reporting an empty CRM', async () => {
    h.fail = true;
    await expect(upsertCommunityContact(input)).rejects.toThrow('offline');
    expect(h.writes).not.toHaveBeenCalled();
  });
});
