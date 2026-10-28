import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { seedBase, seedDoc, teardownEnv, member, member2, fullAdmin, adminB, asUid, getEnv, permsOnly, TENANT_A, MEMBER_UID, MEMBER2_UID, FULL_ADMIN_UID, ADMIN_B_UID } from './helpers';

const sub = (p: string) => `tenants/${TENANT_A}/${p}`;
beforeAll(async () => {
  await seedBase();
  await seedDoc('users/settings-manager', { role: 'admin', tenantId: TENANT_A, permissions: permsOnly('manageSettings') });
  await seedDoc('users/community-manager', { role: 'admin', tenantId: TENANT_A, permissions: permsOnly('manageCommunity') });
  await seedDoc('users/church-admin', { role: 'church_admin', tenantId: TENANT_A, displayName: 'Church admin' });
  await seedDoc('users/spoofer', { role: 'user', tenantId: TENANT_A, email: 'owner-a@test.com' });
  await seedDoc(sub('channels/everyone'), { audience: 'all', members: [] });
  await seedDoc(sub('channels/admins'), { audience: 'admins', members: [FULL_ADMIN_UID] });
  await seedDoc(sub('channels/private'), { members: [MEMBER_UID] });
});
afterAll(teardownEnv);

describe('community access', () => {
  it('allows public listing reads but no client listing writes', async () => {
    await seedDoc(`discovery_listings/${TENANT_A}`, { tenantId: TENANT_A, name: 'Public' });
    const anonymous = (await getEnv()).unauthenticatedContext().firestore();
    const admin = (await fullAdmin()).firestore();
    await assertSucceeds(anonymous.collection('discovery_listings').get());
    await assertSucceeds(anonymous.doc(`discovery_listings/${TENANT_A}`).get());
    await assertFails(admin.doc(`discovery_listings/${TENANT_A}`).set({ name: 'Changed' }));
    await assertFails(admin.doc(`discovery_listings/${TENANT_A}`).delete());
  });
  it('allows tenant members to read reviews and denies all client writes', async () => {
    const path = sub(`settings/community/reviews/${MEMBER_UID}`);
    await seedDoc(path, { uid: MEMBER_UID, rating: 5, text: 'Good' });
    await seedDoc(sub('settings/community'), { ratingSum: 5, ratingCount: 1, ratingAvg: 5 });
    const m = (await member()).firestore();
    const foreign = (await adminB()).firestore();
    const admin = (await fullAdmin()).firestore();
    await assertSucceeds(m.collection(sub('settings/community/reviews')).get());
    await assertFails(foreign.doc(path).get());
    await assertFails(m.doc(path).set({ uid: MEMBER_UID, rating: 4, text: 'Edit' }));
    await assertFails(m.doc(path).update({ rating: 3 }));
    await assertFails(m.doc(path).delete());
    await assertFails(admin.doc(path).set({ uid: FULL_ADMIN_UID, rating: 5, text: 'Good' }));
    await assertFails(m.doc(sub(`settings/community/reviews/${MEMBER2_UID}`)).set({ uid: MEMBER2_UID, rating: 5, text: 'Good' }));
    await assertFails(admin.doc(sub('settings/community')).update({ ratingSum: 0, ratingCount: 0, ratingAvg: 0 }));
    await assertFails(admin.doc(`discovery_listings/${TENANT_A}`).set({ ratingSum: 5, ratingCount: 1, ratingAvg: 5 }));
  });
  it('scopes settings and member answers to their tenant and owner', async () => {
    const m = (await member()).firestore();
    const other = (await member2()).firestore();
    const admin = (await fullAdmin()).firestore();
    const manager = (await asUid('community-manager')).firestore();
    const foreign = (await adminB()).firestore();
    await assertFails(manager.doc(sub('settings/community')).set({ isPublic: false }));
    await assertFails(manager.doc(sub('settings/other')).set({ value: true }));
    await assertSucceeds(m.doc(sub('settings/community')).get());
    await assertFails(m.doc(sub('settings/community')).set({ isPublic: true }));
    await assertFails(foreign.doc(sub('settings/community')).get());
    const data = { rulesAcceptedVersion: 1, answers: { q: 'answer' }, answeredAt: new Date() };
    await assertSucceeds(m.doc(sub(`communityMembers/${MEMBER_UID}`)).set(data));
    await assertSucceeds(m.doc(sub(`communityMembers/${MEMBER_UID}`)).update({ rulesAcceptedVersion: 2 }));
    await assertSucceeds(admin.doc(sub(`communityMembers/${MEMBER_UID}`)).get());
    await assertFails(other.doc(sub(`communityMembers/${MEMBER_UID}`)).get());
    await assertFails(other.doc(sub(`communityMembers/${MEMBER_UID}`)).set(data));
    await assertFails(m.doc(sub(`communityMembers/${MEMBER_UID}`)).set({ ...data, role: 'admin' }));
    await assertFails(m.doc(sub(`communityMembers/${MEMBER_UID}`)).set({ ...data, answers: [] }));
    await assertFails(m.doc(sub(`communityMembers/${MEMBER_UID}`)).set({ ...data, answeredAt: 'now' }));
  });
  it('allows setup managers to create only the fixed default group', async () => {
    const manager = (await asUid('settings-manager')).firestore();
    const data = { name: 'All members', description: '', audience: 'all', members: [], createdBy: 'settings-manager', type: 'announcement' };
    await assertSucceeds(manager.doc(sub('channels/all-members')).set({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() }));
    await assertFails(manager.doc(sub('channels/all-members')).update({ name: 'Changed' }));
    await assertFails(manager.doc(sub('channels/other')).set({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() }));
  });
  it('permits only plain short member posts while preserving rich admin posts and reactions', async () => {
    const m = (await member()).firestore();
    const admin = (await fullAdmin()).firestore();
    const base = { tenantId: TENANT_A, authorId: MEMBER_UID, type: 'post', content: 'hello', imageUrl: '', imageUrls: [], isPinned: false };
    await assertSucceeds(m.doc('community_posts/plain').set(base));
    await assertSucceeds(m.doc('community_posts/legacy').set({ tenantId: TENANT_A, authorId: MEMBER_UID, content: 'legacy' }));
    await assertSucceeds(m.doc('community_posts/legacy').update({ content: 'edited' }));
    await assertSucceeds(m.doc('community_posts/plain').update({ content: 'edited' }));
    for (const [key, value] of Object.entries({ imageUrl: 'https://example.com/a', imageUrls: ['a'], tags: ['x'], embed: { id: 'x' }, attachment: {}, pollOptions: [], eventDetails: {}, type: 'poll', content: 'x'.repeat(501), isPinned: true })) {
      await assertFails(m.doc(`community_posts/bad-${key}`).set({ ...base, [key]: value }));
      await assertFails(m.doc('community_posts/plain').update({ [key]: value }));
    }
    await seedDoc('community_posts/pinned', { ...base, isPinned: true });
    await assertSucceeds(m.doc('community_posts/pinned').update({ content: 'edited' }));
    await assertFails(m.doc('community_posts/pinned').update({ isPinned: false }));
    await assertFails(m.doc('community_posts/plain').update({ authorId: MEMBER2_UID }));
    await assertSucceeds(admin.doc('community_posts/rich').set({ ...base, authorId: FULL_ADMIN_UID, type: 'poll', pollOptions: [] }));
    await assertSucceeds(m.doc('community_posts/rich').update({ likes: [MEMBER_UID], pollOptions: [] }));
    await seedDoc('community_posts/event', { ...base, authorId: FULL_ADMIN_UID, type: 'event', eventDetails: { attendees: [] } });
    await assertSucceeds(m.doc('community_posts/event').update({ eventDetails: { attendees: [MEMBER_UID] } }));
  });
  it('requires a real tenant admin as the other DM participant', async () => {
    const m = (await member()).firestore();
    const admin = (await fullAdmin()).firestore();
    await assertSucceeds(m.doc(sub('directMessages/admin')).set({ participants: [MEMBER_UID, FULL_ADMIN_UID] }));
    await assertSucceeds(m.doc(sub('directMessages/church-admin')).set({ participants: [MEMBER_UID, 'church-admin'] }));
    await assertFails(m.doc(sub('directMessages/spoofer')).set({ participants: [MEMBER_UID, 'spoofer'] }));
    await assertFails(m.doc(sub('directMessages/member')).set({ participants: [MEMBER_UID, MEMBER2_UID], participantRoles: { [MEMBER2_UID]: 'admin' } }));
    await assertFails(m.doc(sub('directMessages/foreign')).set({ participants: [MEMBER_UID, ADMIN_B_UID] }));
    await assertFails(m.doc(sub('directMessages/three')).set({ participants: [MEMBER_UID, MEMBER2_UID, FULL_ADMIN_UID] }));
    await assertSucceeds(admin.doc(sub('directMessages/admin-start')).set({ participants: [FULL_ADMIN_UID, MEMBER_UID] }));
    await seedDoc(sub('directMessages/legacy'), { participants: [MEMBER_UID, FULL_ADMIN_UID] });
    await assertSucceeds(m.collection(sub('directMessages')).where('participants', 'array-contains', MEMBER_UID).get());
    await assertSucceeds(m.doc(sub('directMessages/legacy')).update({ lastMessage: 'hello' }));
    await assertSucceeds(m.doc(sub('dmMessages/legacy-reply')).set({ dmId: 'legacy', senderId: MEMBER_UID }));
  });
  it('applies all, admins and explicit membership to channels and messages', async () => {
    const m = (await member()).firestore();
    const other = (await member2()).firestore();
    const admin = (await fullAdmin()).firestore();
    const foreign = (await adminB()).firestore();
    await assertSucceeds(other.doc(sub('channels/everyone')).get());
    await assertSucceeds(other.doc(sub('channelMessages/all-msg')).set({ channelId: 'everyone', senderId: MEMBER2_UID, senderName: 'Member', senderRole: 'user' }));
    await assertSucceeds(other.doc(sub('channelMessages/all-msg')).get());
    await assertFails(other.doc(sub('channelMessages/spoof-id')).set({ channelId: 'everyone', senderId: MEMBER_UID, senderName: 'Member', senderRole: 'user' }));
    await assertFails(other.doc(sub('channelMessages/spoof-name')).set({ channelId: 'everyone', senderId: MEMBER2_UID, senderName: 'Admin', senderRole: 'user' }));
    await assertFails(other.doc(sub('channelMessages/spoof-role')).set({ channelId: 'everyone', senderId: MEMBER2_UID, senderName: 'Member', senderRole: 'admin' }));
    const churchAdmin = (await asUid('church-admin')).firestore();
    await assertSucceeds(churchAdmin.collection(sub('channels')).get());
    await assertSucceeds(other.doc(sub('channels/everyone')).update({ lastMessage: 'hello' }));
    await assertFails(m.doc(sub('channels/admins')).get());
    await assertFails(m.doc(sub('channelMessages/admin-msg')).set({ channelId: 'admins', senderId: MEMBER_UID, senderName: 'Member', senderRole: 'user' }));
    await assertSucceeds(admin.doc(sub('channelMessages/admin-msg')).set({ channelId: 'admins', senderId: FULL_ADMIN_UID, senderName: 'Member', senderRole: 'admin' }));
    await assertFails(m.doc(sub('channelMessages/admin-msg')).get());
    await assertSucceeds(m.doc(sub('channels/private')).get());
    await assertSucceeds(m.doc(sub('channelMessages/private-msg')).set({ channelId: 'private', senderId: MEMBER_UID, senderName: 'Member', senderRole: 'user' }));
    await assertSucceeds(m.doc(sub('channelMessages/private-msg')).get());
    await assertFails(other.doc(sub('channelMessages/private-msg')).get());
    await assertSucceeds(m.collection(sub('channels')).where('members', 'array-contains', MEMBER_UID).get());
    await assertSucceeds(m.collection(sub('channels')).where('audience', '==', 'all').get());
    await assertFails(other.doc(sub('channels/private')).get());
    await assertFails(other.doc(sub('channelMessages/private-msg')).set({ channelId: 'private', senderId: MEMBER_UID, senderName: 'Member', senderRole: 'user' }));
    await assertFails(foreign.doc(sub('channels/everyone')).get());
  });
});
