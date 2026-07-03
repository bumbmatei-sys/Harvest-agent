import { describe, it, beforeAll, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  seedBase, seedDoc, teardownEnv,
  superAdmin, owner, fullAdmin, rosterAdmin, member, member2, adminB, asUid,
  permsOnly,
  TENANT_A, MEMBER_UID, MEMBER2_UID, FULL_ADMIN_UID,
} from './helpers';

/**
 * Private messaging isolation — channels are visible only to their members
 * (plus tenant admins), and DMs only to their participants (plus the platform
 * super admin). Belonging to the tenant is NOT enough: a 100-member tenant
 * where a channel/DM has a handful of members must stay invisible to everyone
 * else.
 *
 * Actors (from helpers, all tenant-a unless noted):
 *  - member       IS a member of channel `ch-a` and a participant of DM `dm-a`
 *  - member2      a DIFFERENT plain member of tenant-a — NOT in ch-a, NOT in dm-a
 *  - owner/fullAdmin/rosterAdmin  tenant-a admins (manage every channel; get NO
 *                 blanket DM access — DMs are fully private)
 *  - adminB       full-access admin of tenant-b (cross-tenant attacker)
 *  - superAdmin   platform operator (reads everything)
 *
 * The channel doc carries `members: string[]`; the DM doc `participants:
 * string[]`; a dmMessages doc `dmId` (parent) + `senderId`.
 */

const T = TENANT_A;
const sub = (rest: string) => `tenants/${T}/${rest}`;

// A uid we never authenticate as — the "other side" of member's private DM.
const DM_PARTNER = 'dm-partner-uid';

beforeAll(async () => {
  await seedBase();
  // A channel whose only member is `member` — member2 was never added.
  await seedDoc(sub('channels/ch-a'), {
    name: 'Leaders', description: 'private group', members: [MEMBER_UID],
    lastMessage: 'hi', lastMessageAt: 1,
  });
  // A private DM between `member` and DM_PARTNER — member2 is not a participant.
  await seedDoc(sub('directMessages/dm-a'), {
    participants: [MEMBER_UID, DM_PARTNER],
    participantRoles: { [MEMBER_UID]: 'user', [DM_PARTNER]: 'admin' },
    lastMessage: 'yo', lastMessageAt: 1,
  });
  // Messages inside dm-a: one from member, one from the partner (so member has an
  // inbound message to mark read).
  await seedDoc(sub('dmMessages/dm-a-out'), { dmId: 'dm-a', senderId: MEMBER_UID, content: 'from me', read: true });
  await seedDoc(sub('dmMessages/dm-a-in'), { dmId: 'dm-a', senderId: DM_PARTNER, content: 'to me', read: false });
  // Ensure the manageCommunity holder exists (mirrors permissions.rules.test seeding).
  await seedDoc(`users/holder-manageCommunity`, {
    email: 'holder-manageCommunity@test.com', role: 'admin', tenantId: T,
    permissions: permsOnly('manageCommunity'),
  });
});

afterAll(async () => {
  await teardownEnv();
});

// ─── Channels ─────────────────────────────────────────────────────────────────

describe('channel isolation: members + admins only', () => {
  it('a channel MEMBER can read the channel doc', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(sub('channels/ch-a')).get());
  });

  it('a same-tenant NON-member is denied the channel doc (the core fix)', async () => {
    const db = (await member2()).firestore();
    await assertFails(db.doc(sub('channels/ch-a')).get());
  });

  it('every tenant admin (owner / full / roster / super) can read any channel', async () => {
    for (const ctx of [await owner(), await fullAdmin(), await rosterAdmin(), await superAdmin()]) {
      await assertSucceeds(ctx.firestore().doc(sub('channels/ch-a')).get());
    }
  });

  it('a cross-tenant admin is denied the channel doc', async () => {
    const db = (await adminB()).firestore();
    await assertFails(db.doc(sub('channels/ch-a')).get());
  });

  it("AdminCommunity's unfiltered channel LIST still loads for an admin", async () => {
    // AdminCommunity queries all channels (orderBy createdAt, no member filter);
    // it passes per-doc via isTenantAdmin.
    const db = (await fullAdmin()).firestore();
    await assertSucceeds(db.collection(sub('channels')).get());
  });

  it("a member's array-contains channel LIST works; an unfiltered one is denied", async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.collection(sub('channels')).where('members', 'array-contains', MEMBER_UID).get());
    // A member cannot enumerate every channel in the tenant.
    await assertFails(db.collection(sub('channels')).get());
  });

  it("member2's own scoped query is allowed but returns none of member's channels", async () => {
    const db = (await member2()).firestore();
    await assertSucceeds(db.collection(sub('channels')).where('members', 'array-contains', MEMBER2_UID).get());
    await assertFails(db.collection(sub('channels')).get());
  });
});

// ─── Direct messages (container doc) ────────────────────────────────────────────

describe('DM isolation: participants only (fully private)', () => {
  it('a PARTICIPANT can read the directMessages doc', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(sub('directMessages/dm-a')).get());
  });

  it('a same-tenant NON-participant member is denied the directMessages doc', async () => {
    const db = (await member2()).firestore();
    await assertFails(db.doc(sub('directMessages/dm-a')).get());
  });

  it('community admins get NO blanket DM access (owner / full / roster / manageCommunity all denied)', async () => {
    const holder = await asUid('holder-manageCommunity');
    for (const ctx of [await owner(), await fullAdmin(), await rosterAdmin(), holder]) {
      await assertFails(ctx.firestore().doc(sub('directMessages/dm-a')).get());
    }
  });

  it('a cross-tenant admin is denied; the super admin can read', async () => {
    await assertFails((await adminB()).firestore().doc(sub('directMessages/dm-a')).get());
    await assertSucceeds((await superAdmin()).firestore().doc(sub('directMessages/dm-a')).get());
  });

  it("a member's array-contains DM LIST works; an unfiltered one is denied — even for an admin", async () => {
    const mem = (await member()).firestore();
    await assertSucceeds(mem.collection(sub('directMessages')).where('participants', 'array-contains', MEMBER_UID).get());
    await assertFails(mem.collection(sub('directMessages')).get());
    // Admins have no DM blanket read either: their own array-contains query works,
    // an unfiltered one does not.
    const adm = (await fullAdmin()).firestore();
    await assertFails(adm.collection(sub('directMessages')).get());
    // The super admin may enumerate (platform moderation).
    await assertSucceeds((await superAdmin()).firestore().collection(sub('directMessages')).get());
  });

  it('creating a thread requires including yourself as a participant', async () => {
    // An admin opening a DM with a member (client startMemberDm) includes self.
    const adm = (await fullAdmin()).firestore();
    await assertSucceeds(adm.doc(sub('directMessages/dm-new-ok')).set({
      participants: [FULL_ADMIN_UID, MEMBER_UID],
      participantRoles: { [FULL_ADMIN_UID]: 'admin', [MEMBER_UID]: 'user' },
      lastMessage: '',
    }));
    // You cannot fabricate a thread between two OTHER people.
    await assertFails(adm.doc(sub('directMessages/dm-new-bad')).set({
      participants: [MEMBER_UID, DM_PARTNER], lastMessage: '',
    }));
  });

  it('a participant can update the preview and delete their own thread; a non-participant cannot', async () => {
    const mem = (await member()).firestore();
    await seedDoc(sub('directMessages/dm-upd'), { participants: [MEMBER_UID, DM_PARTNER], lastMessage: '' });
    await assertSucceeds(mem.doc(sub('directMessages/dm-upd')).update({ lastMessage: 'hi', lastMessageAt: 2 }));
    // Non-participant member2 can neither update nor delete.
    const m2 = (await member2()).firestore();
    await assertFails(m2.doc(sub('directMessages/dm-upd')).update({ lastMessage: 'x' }));
    await assertFails(m2.doc(sub('directMessages/dm-upd')).delete());
    await assertSucceeds(mem.doc(sub('directMessages/dm-upd')).delete());
  });

  it('a participant CANNOT mutate the participant set (no adding an outsider, no removing the other party)', async () => {
    // The preview update is fenced to lastMessage/lastMessageAt, so the roster
    // stays closed: a participant can't quietly add a third reader (which the
    // parent-scoped dmMessages get() would then expose the whole thread to) or
    // lock the other party out. This is the invariant the isolation depends on.
    await seedDoc(sub('directMessages/dm-roster'), { participants: [MEMBER_UID, DM_PARTNER], lastMessage: '' });
    const mem = (await member()).firestore();
    await assertFails(mem.doc(sub('directMessages/dm-roster')).update({ participants: [MEMBER_UID, DM_PARTNER, MEMBER2_UID] }));
    await assertFails(mem.doc(sub('directMessages/dm-roster')).update({ participants: [MEMBER_UID] }));
    // ...even bundled with a legitimate preview bump.
    await assertFails(mem.doc(sub('directMessages/dm-roster')).update({ lastMessage: 'hi', participants: [MEMBER_UID, DM_PARTNER, MEMBER2_UID] }));
  });
});

// ─── DM messages (inherit parent thread's participants) ──────────────────────────

describe('dmMessages isolation: scoped to the parent thread participants', () => {
  it('a participant reads, sends, and marks received messages read', async () => {
    const db = (await member()).firestore();
    // Read the thread's messages (scoped query by dmId).
    await assertSucceeds(db.collection(sub('dmMessages')).where('dmId', '==', 'dm-a').get());
    // Send a new message (senderId must be self; must be a participant of dm-a).
    await assertSucceeds(db.doc(sub('dmMessages/dm-a-send')).set({
      dmId: 'dm-a', senderId: MEMBER_UID, content: 'hello', read: false,
    }));
    // Mark an inbound message (from the partner) read — read-flag only.
    await assertSucceeds(db.doc(sub('dmMessages/dm-a-in')).update({ read: true }));
    // ...but cannot edit its content.
    await assertFails(db.doc(sub('dmMessages/dm-a-in')).update({ content: 'tampered' }));
  });

  it('a non-participant member is denied read, send, and delete', async () => {
    const db = (await member2()).firestore();
    await assertFails(db.collection(sub('dmMessages')).where('dmId', '==', 'dm-a').get());
    await assertFails(db.doc(sub('dmMessages/dm-a-out')).get());
    // Cannot inject a message into a thread they're not in (even claiming self as sender).
    await assertFails(db.doc(sub('dmMessages/inject')).set({
      dmId: 'dm-a', senderId: MEMBER2_UID, content: 'sneak', read: false,
    }));
    await assertFails(db.doc(sub('dmMessages/dm-a-out')).delete());
  });

  it('you cannot forge senderId when creating a message in your own thread', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(sub('dmMessages/forged')).set({
      dmId: 'dm-a', senderId: DM_PARTNER, content: 'spoofed', read: false,
    }));
  });

  it('community admins get no dmMessages access; the super admin can read', async () => {
    const holder = await asUid('holder-manageCommunity');
    for (const ctx of [await fullAdmin(), holder, await adminB()]) {
      await assertFails(ctx.firestore().doc(sub('dmMessages/dm-a-out')).get());
    }
    await assertSucceeds((await superAdmin()).firestore().doc(sub('dmMessages/dm-a-out')).get());
  });

  it('a participant may delete their own thread messages; the super admin may too', async () => {
    await seedDoc(sub('dmMessages/dm-a-del'), { dmId: 'dm-a', senderId: MEMBER_UID, content: 'bye', read: true });
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(sub('dmMessages/dm-a-del')).delete());
    await seedDoc(sub('dmMessages/dm-a-del2'), { dmId: 'dm-a', senderId: MEMBER_UID, content: 'bye', read: true });
    await assertSucceeds((await superAdmin()).firestore().doc(sub('dmMessages/dm-a-del2')).delete());
  });
});

// ─── Full member flows (no lockout) + channelMessages carve-out unchanged ────────

describe('member flows keep working end-to-end (no lockout)', () => {
  it('a channel member can post a channelMessage; a non-member cannot', async () => {
    const mem = (await member()).firestore();
    await assertSucceeds(mem.doc(sub('channelMessages/cm-1')).set({
      channelId: 'ch-a', senderId: MEMBER_UID, senderName: 'M', content: 'hi', createdAt: 1,
    }));
    const m2 = (await member2()).firestore();
    await assertFails(m2.doc(sub('channelMessages/cm-2')).set({
      channelId: 'ch-a', senderId: MEMBER2_UID, senderName: 'M2', content: 'nope', createdAt: 1,
    }));
  });

  it('a channel member can bump the last-message preview (fields-limited update)', async () => {
    const mem = (await member()).firestore();
    await assertSucceeds(mem.doc(sub('channels/ch-a')).update({ lastMessage: 'new', lastMessageAt: 3 }));
    // ...but not rename the channel.
    await assertFails(mem.doc(sub('channels/ch-a')).update({ name: 'hijacked' }));
  });

  it('a channel member can read that channel\'s messages; a non-member cannot', async () => {
    const mem = (await member()).firestore();
    await assertSucceeds(mem.collection(sub('channelMessages')).where('channelId', '==', 'ch-a').get());
    const m2 = (await member2()).firestore();
    await assertFails(m2.collection(sub('channelMessages')).where('channelId', '==', 'ch-a').get());
  });
});
