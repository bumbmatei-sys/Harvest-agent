import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  seedBase, seedDoc, teardownEnv,
  superAdmin, owner, fullAdmin, rosterAdmin, member, member2, adminB, asUid,
  permsOnly, permsAllBut,
  TENANT_A,
} from './helpers';

/**
 * Livestream live comments — the ONE member-readable livestream surface.
 *
 * The crux of this feature is a firestore.rules change:
 *   tenants/{t}/livestreamSessions/{s}/comments
 *     read:  belongsToTenant(tenantId)          // members of THIS tenant
 *     write: hasPermission('manageLivestream')  // API route (Admin SDK) + admins
 *
 * These tests pin that the read is tenant-scoped (members in, cross-tenant + anon
 * out) and that writes/deletes stay manageLivestream-gated — while the SIBLING
 * prayers subcollection and the parent livestreamSessions doc remain admin-only
 * read (unchanged). Actors come from tests/rules/helpers.
 */

const T = TENANT_A;
const SESSION = 'sess-1';
const commentsPath = `tenants/${T}/livestreamSessions/${SESSION}/comments`;

beforeAll(async () => {
  await seedBase();
  // An active session with one comment and one prayer already present.
  await seedDoc(`tenants/${T}/livestreamSessions/${SESSION}`, {
    youtubeVideoId: 'abc', title: 'Sunday', startedAt: 1, endedAt: null, commentCount: 1, prayerCount: 1,
  });
  await seedDoc(`${commentsPath}/c-1`, { name: 'Sam', text: 'Amen', authorId: 'someone', createdAt: 1 });
  await seedDoc(`tenants/${T}/livestreamSessions/${SESSION}/prayers/p-1`, {
    name: 'Sam', prayerText: 'pray', submittedAt: 1, prayed: false,
  });
  // A limited admin holding ONLY manageLivestream, and one holding everything but.
  await seedDoc('users/holder-manageLivestream', {
    email: 'holder-manageLivestream@test.com', role: 'admin', tenantId: T, permissions: permsOnly('manageLivestream'),
  });
  await seedDoc('users/holder-noLivestream', {
    email: 'holder-noLivestream@test.com', role: 'admin', tenantId: T, permissions: permsAllBut('manageLivestream'),
  });
});

afterAll(async () => {
  await teardownEnv();
});

describe('livestream comments — member read is tenant-scoped', () => {
  it('a tenant member can READ a comment and realtime-LIST the comments feed', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(`${commentsPath}/c-1`).get());
    await assertSucceeds(db.collection(commentsPath).orderBy('createdAt', 'desc').get());
  });

  it('a SECOND plain member of the same tenant can also read (belongsToTenant, not channel-scoped)', async () => {
    const db = (await member2()).firestore();
    await assertSucceeds(db.collection(commentsPath).orderBy('createdAt', 'desc').get());
  });

  it('tenant admins (owner / full / roster / super) can read the feed too', async () => {
    for (const ctx of [await owner(), await fullAdmin(), await rosterAdmin(), await superAdmin()]) {
      await assertSucceeds(ctx.firestore().collection(commentsPath).orderBy('createdAt', 'desc').get());
    }
  });

  it('a CROSS-TENANT admin cannot read another tenant\'s comments (isolation)', async () => {
    const db = (await adminB()).firestore();
    await assertFails(db.doc(`${commentsPath}/c-1`).get());
    await assertFails(db.collection(commentsPath).orderBy('createdAt', 'desc').get());
  });
});

describe('livestream comments — writes stay admin/permission-gated (no member client write)', () => {
  it('a plain member CANNOT create a comment from the client (must go via the API route)', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`${commentsPath}/c-member`).set({ name: 'Sam', text: 'sneak', createdAt: 2 }));
  });

  it('a member CANNOT delete a comment (delete-only moderation is admin-side)', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`${commentsPath}/c-1`).delete());
  });

  it('a manageLivestream holder (and owner/full/roster/super) CAN delete a comment', async () => {
    // Owner, full admin, roster admin, super admin, and the limited manageLivestream
    // holder all pass the write gate — deletion needs no new permission.
    for (const ctx of [await owner(), await fullAdmin(), await rosterAdmin(), await superAdmin(), await asUid('holder-manageLivestream')]) {
      await seedDoc(`${commentsPath}/c-del`, { name: 'x', text: 'y', createdAt: 1 });
      await assertSucceeds(ctx.firestore().doc(`${commentsPath}/c-del`).delete());
    }
  });

  it('an admin WITHOUT manageLivestream cannot delete a comment', async () => {
    const db = (await asUid('holder-noLivestream')).firestore();
    await assertFails(db.doc(`${commentsPath}/c-1`).delete());
  });

  it('a cross-tenant admin cannot delete (manageLivestream is tenant-scoped)', async () => {
    const db = (await adminB()).firestore();
    await assertFails(db.doc(`${commentsPath}/c-1`).delete());
  });
});

describe('sibling surfaces are UNCHANGED by the comments block', () => {
  it('prayers remain admin-only read: a member is still DENIED the prayers feed', async () => {
    const db = (await member()).firestore();
    await assertFails(db.collection(`tenants/${T}/livestreamSessions/${SESSION}/prayers`).get());
    // ...while an admin still reads it.
    await assertSucceeds((await fullAdmin()).firestore().collection(`tenants/${T}/livestreamSessions/${SESSION}/prayers`).get());
  });

  it('the parent livestreamSessions doc remains admin-only read (member denied)', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`tenants/${T}/livestreamSessions/${SESSION}`).get());
    await assertSucceeds((await fullAdmin()).firestore().doc(`tenants/${T}/livestreamSessions/${SESSION}`).get());
  });
});
