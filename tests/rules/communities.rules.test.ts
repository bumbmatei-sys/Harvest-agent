import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  seedBase, seedDoc, teardownEnv, member, member2, fullAdmin, adminB, seedAdmin, asUid, permsOnly,
  TENANT_A, MEMBER_UID, MEMBER2_UID,
} from './helpers';

/**
 * #571 — communities other than the default one. MEMBER is a member of tenant
 * A's DEFAULT community only (their user doc names tenant A). MEMBER2 is an
 * active member of the `youth` community. Membership of one community must
 * grant nothing in another, in either direction.
 */
const base = `tenants/${TENANT_A}/communities`;
const youth = `${base}/youth`;
const post = { authorId: MEMBER2_UID, authorName: 'Member', authorPhoto: '', content: 'Hello youth', type: 'post', tenantId: TENANT_A, communityId: 'youth', createdAt: new Date(1000) };

beforeAll(async () => {
  await seedBase();
  await seedDoc(youth, { name: 'Youth', status: 'published', visibility: 'private' });
  await seedDoc(`${base}/open`, { name: 'Open', status: 'published', visibility: 'public' });
  await seedDoc(`${base}/draft`, { name: 'Draft', status: 'draft', visibility: 'public' });
  await seedDoc(`${youth}/members/${MEMBER2_UID}`, { uid: MEMBER2_UID, status: 'active' });
  await seedDoc(`${youth}/members/left-member`, { uid: 'left-member', status: 'left' });
  await seedDoc('users/left-member', { role: 'user', tenantId: TENANT_A });
  await seedDoc(`${youth}/posts/p1`, post);
  await seedDoc(`${youth}/posts/p1/comments/c1`, { authorId: MEMBER2_UID, authorName: 'Member', authorPhoto: '', content: 'Hi', createdAt: new Date(1000), tenantId: TENANT_A });
  await seedDoc(`${youth}/channels/general`, { name: 'General', audience: 'all', members: [] });
  await seedDoc(`${youth}/channelMessages/m1`, { channelId: 'general', senderId: MEMBER2_UID, senderName: 'Member', senderRole: 'user', text: 'Hey' });
  await seedAdmin('community-mgr', TENANT_A, permsOnly('manageCommunity'));
});
afterAll(teardownEnv);

describe('community records', () => {
  it('a public published community is readable by anyone signed in; a draft only by admins', async () => {
    await assertSucceeds((await member()).firestore().doc(`${base}/open`).get());
    await assertFails((await member()).firestore().doc(`${base}/draft`).get());
    await assertSucceeds((await fullAdmin()).firestore().doc(`${base}/draft`).get());
  });
  it('a private community is readable only by its members and admins', async () => {
    await assertFails((await member()).firestore().doc(youth).get());
    await assertSucceeds((await member2()).firestore().doc(youth).get());
    await assertFails((await adminB()).firestore().doc(youth).get());
  });
  it('no client writes a record or a membership, not even an admin', async () => {
    await assertFails((await fullAdmin()).firestore().doc(`${base}/new`).set({ name: 'X', status: 'published' }));
    await assertFails((await member2()).firestore().doc(youth).update({ status: 'draft' }));
    await assertFails((await member()).firestore().doc(`${youth}/members/${MEMBER_UID}`).set({ uid: MEMBER_UID, status: 'active' }));
    await assertFails((await member2()).firestore().doc(`${youth}/members/${MEMBER2_UID}`).update({ status: 'active', role: 'admin' }));
  });
  it('a member reads their own membership; a default-community member cannot list another community', async () => {
    await assertSucceeds((await member2()).firestore().doc(`${youth}/members/${MEMBER2_UID}`).get());
    await assertFails((await member()).firestore().collection(`${youth}/members`).get());
  });
});

describe("the member's own community index", () => {
  it('is readable only by its owner and never client-written', async () => {
    const key = `users/${MEMBER2_UID}/communityMemberships/${TENANT_A}__youth`;
    await seedDoc(key, { tenantId: TENANT_A, communityId: 'youth', status: 'active' });
    await assertSucceeds((await member2()).firestore().doc(key).get());
    await assertFails((await member()).firestore().doc(key).get());
    await assertFails((await member2()).firestore().doc(key).update({ status: 'left' }));
    await assertFails((await member()).firestore().doc(`users/${MEMBER_UID}/communityMemberships/${TENANT_A}__youth`).set({ tenantId: TENANT_A, communityId: 'youth', status: 'active' }));
  });
});

describe('posts are isolated per community', () => {
  it('only the community’s members and the tenant’s admins read its posts', async () => {
    await assertSucceeds((await member2()).firestore().doc(`${youth}/posts/p1`).get());
    await assertSucceeds((await fullAdmin()).firestore().doc(`${youth}/posts/p1`).get());
    // A member of the default community only, a member who left, and another tenant's admin.
    await assertFails((await member()).firestore().doc(`${youth}/posts/p1`).get());
    await assertFails((await asUid('left-member')).firestore().doc(`${youth}/posts/p1`).get());
    await assertFails((await adminB()).firestore().doc(`${youth}/posts/p1`).get());
    await assertFails((await member()).firestore().collection(`${youth}/posts`).get());
  });
  it('a member posts plain posts in their community, scoped to it', async () => {
    const db = (await member2()).firestore();
    await assertSucceeds(db.doc(`${youth}/posts/p2`).set({ ...post }));
    await assertFails(db.doc(`${youth}/posts/p3`).set({ ...post, communityId: 'open' }));
    await assertFails(db.doc(`${youth}/posts/p4`).set({ ...post, isPinned: true }));
    await assertFails(db.doc(`${youth}/posts/p5`).set({ ...post, authorId: MEMBER_UID }));
    await assertFails((await member()).firestore().doc(`${youth}/posts/p6`).set({ ...post, authorId: MEMBER_UID }));
  });
  it('a post never moves to another community or tenant', async () => {
    const db = (await member2()).firestore();
    await assertSucceeds(db.doc(`${youth}/posts/p1`).update({ content: 'Edited' }));
    await assertFails(db.doc(`${youth}/posts/p1`).update({ communityId: 'open' }));
    await assertFails((await fullAdmin()).firestore().doc(`${youth}/posts/p1`).update({ tenantId: 'tenant-b' }));
  });
  it('comments follow the same membership', async () => {
    const comment = { authorId: MEMBER2_UID, authorName: 'Member', authorPhoto: '', content: 'Yes', createdAt: new Date(2000), tenantId: TENANT_A };
    await assertSucceeds((await member2()).firestore().doc(`${youth}/posts/p1/comments/c2`).set(comment));
    await assertFails((await member()).firestore().doc(`${youth}/posts/p1/comments/c1`).get());
    await assertFails((await member()).firestore().doc(`${youth}/posts/p1/comments/c3`).set({ ...comment, authorId: MEMBER_UID }));
  });
});

describe('chat is isolated per community', () => {
  it('members read and post in their community’s channels; others cannot', async () => {
    await assertSucceeds((await member2()).firestore().doc(`${youth}/channels/general`).get());
    await assertSucceeds((await member2()).firestore().doc(`${youth}/channelMessages/m1`).get());
    await assertSucceeds((await member2()).firestore().doc(`${youth}/channelMessages/m2`).set({ channelId: 'general', senderId: MEMBER2_UID, senderName: 'Member', senderRole: 'user', text: 'Hi' }));
    await assertFails((await member()).firestore().doc(`${youth}/channels/general`).get());
    await assertFails((await member()).firestore().doc(`${youth}/channelMessages/m1`).get());
    await assertFails((await member()).firestore().doc(`${youth}/channelMessages/m3`).set({ channelId: 'general', senderId: MEMBER_UID, senderName: 'Member', senderRole: 'user', text: 'Hi' }));
  });
  it('only manageCommunity creates channels; a member may only touch the preview', async () => {
    await assertSucceeds((await asUid('community-mgr')).firestore().doc(`${youth}/channels/new`).set({ name: 'New', audience: 'all', members: [] }));
    await assertFails((await member2()).firestore().doc(`${youth}/channels/other`).set({ name: 'Other', audience: 'all', members: [] }));
    await assertSucceeds((await member2()).firestore().doc(`${youth}/channels/general`).update({ lastMessage: 'Hi', lastMessageAt: new Date(3000) }));
    await assertFails((await member2()).firestore().doc(`${youth}/channels/general`).update({ name: 'Renamed' }));
  });
});

// #576: the community space page's own reads, exactly as src/lib/community/space.ts
// and the Your communities list make them.
describe('the community space queries', () => {
  it('a member can run every query the space makes; a member of another community cannot', async () => {
    type Db = ReturnType<Awaited<ReturnType<typeof member2>>['firestore']>;
    const feedAndChat = [
      (db: Db) => db.collection(`${youth}/posts`).orderBy('createdAt', 'desc').limit(50).get(),
      (db: Db) => db.collection(`${youth}/channels`).where('audience', '==', 'all').get(),
      (db: Db) => db.collection(`${youth}/channelMessages`).where('channelId', '==', 'general').limit(300).get(),
    ];
    const inside = (await member2()).firestore();
    for (const run of feedAndChat) await assertSucceeds(run(inside));
    await assertSucceeds(inside.doc(`${youth}/members/${MEMBER2_UID}`).get());
    const outsider = (await member()).firestore();
    for (const run of feedAndChat) await assertFails(run(outsider));
  });
  it('a member reads their own joined-community index by status', async () => {
    await seedDoc(`users/${MEMBER2_UID}/communityMemberships/${TENANT_A}__youth`, { tenantId: TENANT_A, communityId: 'youth', status: 'active' });
    await assertSucceeds((await member2()).firestore().collection(`users/${MEMBER2_UID}/communityMemberships`).where('status', '==', 'active').get());
    await assertFails((await member()).firestore().collection(`users/${MEMBER2_UID}/communityMemberships`).where('status', '==', 'active').get());
  });
});
