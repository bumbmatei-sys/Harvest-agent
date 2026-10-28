import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  seedBase, seedDoc, teardownEnv, getEnv, member, member2, fullAdmin, adminB, owner, rosterAdmin, asUid, superAdmin,
  TENANT_A, TENANT_B, MEMBER_UID,
} from './helpers';

const memberPath = `tenants/${TENANT_A}/communityMembers/${MEMBER_UID}`;
const indexPath = `users/${MEMBER_UID}/memberships/${TENANT_A}`;
const entry = { rulesAcceptedVersion: 1, answers: { q: 'yes' }, answeredAt: new Date(1000) };
const membership = {
  ...entry, uid: MEMBER_UID, tenantId: TENANT_A, status: 'active', source: 'discover',
  joinedAt: new Date(1000), leftAt: null, consentAt: new Date(1000), updatedAt: new Date(1000),
};

beforeAll(async () => {
  await seedBase();
  await seedDoc(memberPath, membership);
  await seedDoc(indexPath, { tenantId: TENANT_A, status: 'active', joinedAt: new Date(1000), leftAt: null });
  // A multi-community member whose primary user-doc tenant is elsewhere.
  await seedDoc('users/multi-member', { tenantId: TENANT_B, role: 'user' });
  await seedDoc(`tenants/${TENANT_A}/communityMembers/multi-member`, { ...membership, uid: 'multi-member' });
  await seedDoc('users/legacy-outsider', { tenantId: TENANT_B, role: 'user' });
  await seedDoc(`tenants/${TENANT_A}/communityMembers/legacy-outsider`, entry);
  await seedDoc('users/left-member', { tenantId: TENANT_A, role: 'user' });
  await seedDoc(`tenants/${TENANT_A}/communityMembers/left-member`, { ...membership, uid: 'left-member', status: 'left', leftAt: new Date(2000) });
  await seedDoc('users/owner-without-role', { role: 'user', tenantId: TENANT_B });
  await seedDoc('tenants/owner-without-role', { ownerId: 'owner-without-role' });
  await seedDoc(`tenants/owner-without-role/communityMembers/${MEMBER_UID}`, membership);
});
afterAll(teardownEnv);

describe('community membership server authority', () => {
  it.each([
    ['status', 'left'], ['source', 'website'], ['joinedAt', new Date(2000)], ['leftAt', new Date(2000)],
    ['consentAt', new Date(2000)], ['updatedAt', new Date(2000)], ['uid', 'victim'], ['tenantId', TENANT_B],
  ])('refuses client updates to %s', async (field, value) => {
    const db = (await member()).firestore();
    await assertFails(db.doc(memberPath).update({ [field as string]: value }));
  });
  it.each(['status', 'source', 'joinedAt', 'leftAt', 'consentAt', 'updatedAt', 'uid', 'tenantId'])('refuses forging %s during legacy entry creation', async field => {
    const db = (await member2()).firestore();
    const path = `tenants/${TENANT_A}/communityMembers/member2-uid`;
    await assertFails(db.doc(path).set({ ...entry, [field]: membership[field as keyof typeof membership] }));
  });
  it('refuses a full membership create, replacement that removes server fields, and deletion', async () => {
    const db = (await member()).firestore();
    const another = (await member2()).firestore();
    await assertFails(another.doc(`tenants/${TENANT_A}/communityMembers/member2-uid`).set(membership));
    await assertFails(db.doc(memberPath).set(entry));
    await assertFails(db.doc(memberPath).delete());
  });
  it('permits onboarding merges while preserving all server fields', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(memberPath).set({ ...entry, rulesAcceptedVersion: 2 }, { mergeFields: ['rulesAcceptedVersion', 'answers', 'answeredAt'] }));
    const saved = (await db.doc(memberPath).get()).data()!;
    expect(saved.status).toBe('active');
    expect(saved.source).toBe('discover');
    expect(saved.consentAt.toMillis()).toBe(1000);
  });
  it('permits legacy onboarding create and update for an actual primary member', async () => {
    const db = (await member2()).firestore();
    const path = `tenants/${TENANT_A}/communityMembers/member2-uid`;
    await assertSucceeds(db.doc(path).set(entry));
    await assertSucceeds(db.doc(path).update({ rulesAcceptedVersion: 2 }));
  });
  it('permits onboarding for an active multi-community member without a primary tenant match', async () => {
    const db = (await asUid('multi-member')).firestore();
    await assertSucceeds(db.doc(`tenants/${TENANT_A}/communityMembers/multi-member`).set(entry, { merge: true }));
  });
  it('permits replacing the answers map to clear the pending marker', async () => {
    const path = `tenants/${TENANT_A}/communityMembers/multi-member`;
    await seedDoc(path, { ...membership, uid: 'multi-member', answers: { __community_questions_pending__: 'true' } });
    const db = (await asUid('multi-member')).firestore();
    await assertSucceeds(db.doc(path).set(entry, { mergeFields: ['rulesAcceptedVersion', 'answers', 'answeredAt'] }));
    const saved = (await db.doc(path).get()).data()!;
    expect(saved.answers).toEqual({ q: 'yes' });
    expect(saved.status).toBe('active');
  });
  it('rejects onboarding for a foreign legacy entry and an explicitly left primary member', async () => {
    const foreign = (await asUid('legacy-outsider')).firestore();
    const left = (await asUid('left-member')).firestore();
    await assertFails(foreign.doc(`tenants/${TENANT_A}/communityMembers/legacy-outsider`).update({ rulesAcceptedVersion: 2 }));
    await assertFails(left.doc(`tenants/${TENANT_A}/communityMembers/left-member`).set(entry, { merge: true }));
    await assertFails(left.doc(`tenants/${TENANT_A}/communityMembers/left-member`).update({ status: 'active' }));
  });
  it('does not trust a tenant token claim for legacy membership', async () => {
    const db = (await getEnv()).authenticatedContext('legacy-outsider', { tenantId: TENANT_A }).firestore();
    await assertFails(db.doc(`tenants/${TENANT_A}/communityMembers/legacy-outsider`).update({ rulesAcceptedVersion: 2 }));
  });
  it.each([fullAdmin, owner, rosterAdmin, superAdmin])('does not allow an admin client to mutate membership', async actor => {
    const db = (await actor()).firestore();
    await assertFails(db.doc(memberPath).update({ status: 'left' }));
    await assertFails(db.doc(memberPath).set(membership));
    await assertFails(db.doc(memberPath).delete());
  });
});

describe('community membership privacy', () => {
  it('allows self reads across tenants, including after leave', async () => {
    const primary = (await member()).firestore();
    const multi = (await asUid('multi-member')).firestore();
    const left = (await asUid('left-member')).firestore();
    await assertSucceeds(primary.doc(memberPath).get());
    await assertSucceeds(multi.doc(`tenants/${TENANT_A}/communityMembers/multi-member`).get());
    await assertSucceeds(left.doc(`tenants/${TENANT_A}/communityMembers/left-member`).get());
  });
  it.each([fullAdmin, owner, rosterAdmin])('allows tenant admins to get and list their member documents', async actor => {
    const db = (await actor()).firestore();
    await assertSucceeds(db.doc(memberPath).get());
    await assertSucceeds(db.collection(`tenants/${TENANT_A}/communityMembers`).get());
  });
  it('allows an owner identified by ownerId without an admin role or matching primary tenant', async () => {
    const db = (await asUid('owner-without-role')).firestore();
    await assertSucceeds(db.doc(`tenants/owner-without-role/communityMembers/${MEMBER_UID}`).get());
  });
  it.each([member2, adminB])('denies other people and other tenant admins both gets and lists', async actor => {
    const db = (await actor()).firestore();
    await assertFails(db.doc(memberPath).get());
    await assertFails(db.collection(`tenants/${TENANT_A}/communityMembers`).get());
  });
  it('denies unauthenticated reads and writes', async () => {
    const db = (await getEnv()).unauthenticatedContext().firestore();
    await assertFails(db.doc(memberPath).get());
    await assertFails(db.doc(indexPath).get());
    await assertFails(db.doc(memberPath).set(entry));
  });
});

describe('per-user membership index', () => {
  it('permits self get and list', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(indexPath).get());
    await assertSucceeds(db.collection(`users/${MEMBER_UID}/memberships`).get());
  });
  it.each([member2, fullAdmin, owner, adminB, superAdmin])('denies others including tenant and platform admins', async actor => {
    const db = (await actor()).firestore();
    await assertFails(db.doc(indexPath).get());
    await assertFails(db.collection(`users/${MEMBER_UID}/memberships`).get());
  });
  it.each([member, fullAdmin, superAdmin])('denies all client creates, updates, and deletes', async actor => {
    const db = (await actor()).firestore();
    await assertFails(db.doc(indexPath).update({ status: 'left' }));
    await assertFails(db.doc(`users/${MEMBER_UID}/memberships/${TENANT_B}`).set({ tenantId: TENANT_B, status: 'active', joinedAt: new Date(1000), leftAt: null }));
    await assertFails(db.doc(indexPath).delete());
  });
});
