import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { seedBase, seedDoc, teardownEnv, member, member2, fullAdmin, adminB, superAdmin, asUid, getEnv, permsOnly, TENANT_A, MEMBER_UID, MEMBER2_UID, FULL_ADMIN_UID, ADMIN_B_UID, OWNER_EMAIL, ROSTER_ADMIN_EMAIL } from './helpers';
import { SUPER_ADMIN_EMAILS } from '../../src/utils/super-admins';

const sub = (p: string) => `tenants/${TENANT_A}/${p}`;
beforeAll(async () => {
  await seedBase();
  await seedDoc('email_log/private', { tenantId: 'other', subject: 'private' });
  await seedDoc('users/settings-manager', { role: 'admin', tenantId: TENANT_A, permissions: permsOnly('manageSettings') });
  await seedDoc('users/community-manager', { role: 'admin', tenantId: TENANT_A, permissions: permsOnly('manageCommunity') });
  await seedDoc('users/church-admin', { role: 'church_admin', tenantId: TENANT_A, displayName: 'Church admin' });
  await seedDoc('users/spoofer', { role: 'user', tenantId: TENANT_A, email: 'spoofer@test.com' });
  await seedDoc(sub('channels/everyone'), { audience: 'all', members: [] });
  await seedDoc(sub('channels/admins'), { audience: 'admins', members: [FULL_ADMIN_UID] });
  await seedDoc(sub('channels/private'), { members: [MEMBER_UID] });
});
afterAll(teardownEnv);

describe('community access', () => {
  it('keeps email logs platform-admin only while preserving scoped church admin access', async () => {
    const churchAdmin = (await asUid('church-admin')).firestore();
    await assertFails(churchAdmin.collection('email_log').get());
    await assertFails(churchAdmin.doc('email_log/private').get());
    await assertSucceeds((await superAdmin()).firestore().collection('email_log').get());
    await assertSucceeds(churchAdmin.doc(sub('settings/community')).get());
    await assertFails(churchAdmin.doc('tenants/other/settings/community').get());
  });
  it('restricts limited admins to permitted channels when posting', async () => {
    const limited = (await asUid('settings-manager')).firestore();
    const manager = (await asUid('community-manager')).firestore();
    const message = { senderId: 'settings-manager', senderName: 'Member', senderRole: 'admin' };
    await assertFails(limited.doc(sub('channelMessages/limited-private')).set({ ...message, channelId: 'private' }));
    await assertFails(limited.doc(sub('channelMessages/limited-admins')).set({ ...message, channelId: 'admins' }));
    await assertSucceeds(limited.doc(sub('channelMessages/limited-all')).set({ ...message, channelId: 'everyone' }));
    await assertSucceeds(manager.doc(sub('channelMessages/manager-private')).set({ channelId: 'private', senderId: 'community-manager', senderName: 'Member', senderRole: 'admin' }));
  });
  it('scopes settings and member answers to their tenant and owner', async () => {
    const m = (await member()).firestore();
    const other = (await member2()).firestore();
    const admin = (await fullAdmin()).firestore();
    const manager = (await asUid('community-manager')).firestore();
    const foreign = (await adminB()).firestore();
    await assertSucceeds(manager.doc(sub('settings/community')).set({ isPublic: false }));
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
    const base = { tenantId: TENANT_A, authorId: MEMBER_UID, authorName: 'Member', type: 'post', content: 'hello', imageUrl: '', imageUrls: [], isPinned: false };
    await assertSucceeds(m.doc('community_posts/plain').set(base));
    await assertSucceeds(m.doc('community_posts/legacy').set({ tenantId: TENANT_A, authorId: MEMBER_UID, authorName: 'Member', content: 'legacy' }));
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
  it('binds member post names and photos to their profile and forbids claimed levels', async () => {
    await seedDoc('users/post-author', { role: 'user', tenantId: TENANT_A, displayName: 'Profile member', photoURL: 'https://example.com/member.jpg' });
    const env = await getEnv();
    const db = env.authenticatedContext('post-author', { tenantId: TENANT_A, name: 'Token member' }).firestore();
    const base = { tenantId: TENANT_A, authorId: 'post-author', authorName: 'Profile member', content: 'hello' };
    await assertSucceeds(db.doc('community_posts/profile-photo').set({ ...base, authorPhoto: 'https://example.com/member.jpg' }));
    await assertSucceeds(db.doc('community_posts/profile-no-photo').set(base));
    await assertSucceeds(db.doc('community_posts/profile-empty-photo').set({ ...base, authorPhoto: '' }));
    await assertFails(db.doc('community_posts/forged-name').set({ ...base, authorName: 'Pastor' }));
    await assertFails(db.doc('community_posts/stale-token-name').set({ ...base, authorName: 'Token member' }));
    await assertFails(db.doc('community_posts/missing-name').set({ tenantId: TENANT_A, authorId: 'post-author', content: 'hello' }));
    await assertFails(db.doc('community_posts/forged-photo').set({ ...base, authorPhoto: 'https://example.com/pastor.jpg' }));
    for (const level of [0, 1, 99, 'admin', 'pastor']) {
      await assertFails(db.doc(`community_posts/forged-level-${level}`).set({ ...base, authorLevel: level }));
    }
    await assertFails(db.doc('community_posts/profile-photo').update({ authorName: 'Pastor' }));
    await assertFails(db.doc('community_posts/profile-photo').update({ authorPhoto: 'https://example.com/pastor.jpg' }));
    await assertFails(db.doc('community_posts/profile-photo').update({ authorLevel: 99 }));
  });
  it('uses the auth name fallback for missing or empty profile names, then Member', async () => {
    const env = await getEnv();
    for (const [uid, profile] of [
      ['post-no-profile', null],
      ['post-empty-name', { displayName: '', name: 'Unbound legacy name' }],
    ] as const) {
      if (profile) await seedDoc(`users/${uid}`, { ...profile, role: 'user', tenantId: TENANT_A });
      const db = env.authenticatedContext(uid, { tenantId: TENANT_A, name: 'Auth member' }).firestore();
      const base = { tenantId: TENANT_A, authorId: uid, content: 'hello' };
      await assertSucceeds(db.doc(`community_posts/${uid}`).set({ ...base, authorName: 'Auth member', authorPhoto: '' }));
      await assertFails(db.doc(`community_posts/${uid}-spoof`).set({ ...base, authorName: 'Unbound legacy name' }));
      await assertFails(db.doc(`community_posts/${uid}-photo`).set({ ...base, authorName: 'Auth member', authorPhoto: 'https://example.com/unbound.jpg' }));
    }
    const m = (await member()).firestore();
    await assertSucceeds(m.doc('community_posts/no-names').set({ tenantId: TENANT_A, authorId: MEMBER_UID, authorName: 'Member', content: 'hello', authorPhoto: '' }));
  });
  it('requires a real tenant admin as the other DM participant', async () => {
    const m = (await member()).firestore();
    const admin = (await fullAdmin()).firestore();
    // Future email writes are Auth-bound as a separate defence; the counterpart
    // check must also reject legacy forged emails already stored before deploy.
    await assertFails((await asUid('spoofer')).firestore().doc('users/spoofer').update({ email: 'owner-a@test.com' }));
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
  it('blocks sends and previews in existing member-to-member threads, regardless of role labels', async () => {
    const m = (await member()).firestore();
    const other = (await member2()).firestore();
    for (const [id, counterpart] of [['peer', MEMBER2_UID], ['foreign', ADMIN_B_UID], ['spoofed-email', 'spoofer']]) {
      await seedDoc(sub(`directMessages/old-${id}`), { participants: [MEMBER_UID, counterpart], participantRoles: { [counterpart]: 'admin' }, lastMessage: 'old' });
      await assertFails(m.doc(sub(`dmMessages/old-${id}`)).set({ dmId: `old-${id}`, senderId: MEMBER_UID, content: 'bypass' }));
      await assertFails(m.doc(sub(`directMessages/old-${id}`)).update({ lastMessage: 'bypass', lastMessageAt: 2 }));
    }
    await assertFails(other.doc(sub('dmMessages/peer-reply')).set({ dmId: 'old-peer', senderId: MEMBER2_UID }));
    await assertFails(other.doc(sub('directMessages/old-peer')).update({ lastMessage: 'reply' }));
    // Historical threads remain readable, and recipients can acknowledge old messages.
    await seedDoc(sub('dmMessages/old-peer-inbound'), { dmId: 'old-peer', senderId: MEMBER2_UID, read: false });
    await assertSucceeds(m.doc(sub('dmMessages/old-peer-inbound')).get());
    await assertSucceeds(m.doc(sub('dmMessages/old-peer-inbound')).update({ read: true }));
  });
  it.each([OWNER_EMAIL, ROSTER_ADMIN_EMAIL, ...SUPER_ADMIN_EMAILS].map((email, i) => ({ email, uid: `stale-email-${i}` })))(
    'rejects a pre-existing member profile spoofing $email for new and existing DMs', async ({ email, uid }) => {
      // Bypass rules to model an email stored BEFORE Auth-bound writes deployed.
      // No attempted profile write can mask the stale-identity vulnerability.
      await seedDoc(`users/${uid}`, { role: 'user', tenantId: TENANT_A, email });
      const m = (await member()).firestore();
      const spoofed = (await asUid(uid)).firestore();
      const dmId = `legacy-${uid}`;
      const data = { participants: [uid, MEMBER_UID], participantRoles: { [uid]: 'admin' }, lastMessage: 'Old' };
      await assertFails(m.doc(sub(`directMessages/new-${uid}`)).set(data));
      await assertFails(spoofed.doc(sub(`directMessages/new-caller-${uid}`)).set(data));
      await seedDoc(sub(`directMessages/${dmId}`), data);
      for (const [db, senderId] of [[m, MEMBER_UID], [spoofed, uid]] as const) {
        const message = db.doc(sub(`dmMessages/${dmId}-${senderId}`));
        const thread = db.doc(sub(`directMessages/${dmId}`));
        await assertFails(message.set({ dmId, senderId, content: 'Blocked' }));
        await assertFails(thread.update({ lastMessage: 'Blocked', lastMessageAt: 2 }));
        const batch = db.batch();
        batch.set(message, { dmId, senderId, content: 'Blocked batch' });
        batch.update(thread, { lastMessage: 'Blocked batch', lastMessageAt: 3 });
        await assertFails(batch.commit());
      }
    },
  );
  it('keeps sends and preview updates working in both directions with tenant admins', async () => {
    for (const counterpart of [FULL_ADMIN_UID, 'church-admin', 'settings-manager']) {
      const thread = `reply-${counterpart}`;
      await seedDoc(sub(`directMessages/${thread}`), { participants: [counterpart, MEMBER_UID], lastMessage: '' });
      for (const uid of [MEMBER_UID, counterpart]) {
        const db = (await asUid(uid)).firestore();
        await assertSucceeds(db.doc(sub(`dmMessages/${thread}-${uid}`)).set({ dmId: thread, senderId: uid, content: 'hello' }));
        await assertSucceeds(db.doc(sub(`directMessages/${thread}`)).update({ lastMessage: uid, lastMessageAt: 1 }));
      }
      const outsider = (await member2()).firestore();
      await assertFails(outsider.doc(sub(`dmMessages/${thread}-outsider`)).set({ dmId: thread, senderId: MEMBER2_UID }));
      await assertFails(outsider.doc(sub(`directMessages/${thread}`)).update({ lastMessage: 'injected' }));
    }
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
