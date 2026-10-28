import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { seedBase, seedDoc, teardownEnv, member, member2, fullAdmin, adminB, getEnv, asUid, permsOnly, TENANT_A, MEMBER_UID } from './helpers';

beforeAll(async () => {
  await seedBase();
  await seedDoc('signup_pages/page', { tenantId: TENANT_A, ownerUid: MEMBER_UID, handle: 'example' });
  await seedDoc('signup_pages/page/submissions/one', { tenantId: TENANT_A, answers: { name: 'A' }, createdAt: '2040-01-01' });
  await seedDoc('signup_handles/example', { tenantId: TENANT_A, ownerUid: MEMBER_UID, pageId: 'page' });
  await seedDoc('users/forms-admin', { tenantId: TENANT_A, role: 'admin', permissions: permsOnly('manageForms') });
  await seedDoc('users/other-admin', { tenantId: TENANT_A, role: 'admin', permissions: permsOnly('manageCRM') });
});
afterAll(teardownEnv);

describe('signup pages', () => {
  it('restricts pages and submissions to owner and permitted tenant admins', async () => {
    const ownerDb = (await member()).firestore();
    for (const db of [ownerDb, (await fullAdmin()).firestore(), (await asUid('forms-admin')).firestore()]) {
      await assertSucceeds(db.doc('signup_pages/page').get());
      await assertSucceeds(db.collection('signup_pages/page/submissions').get());
    }
    for (const ctx of [await member2(), await adminB(), await asUid('other-admin'), (await getEnv()).unauthenticatedContext()]) {
      const db = ctx.firestore();
      await assertFails(db.doc('signup_pages/page').get());
      await assertFails(db.doc('signup_pages/page/submissions/one').get());
    }
    await assertSucceeds(ownerDb.collection('signup_pages').where('ownerUid', '==', MEMBER_UID).get());
    await assertFails(ownerDb.collection('signup_pages').get());
  });
  it('denies every client write and handle read', async () => {
    for (const ctx of [await member(), await fullAdmin(), (await getEnv()).unauthenticatedContext()]) {
      const db = ctx.firestore();
      await assertFails(db.doc('signup_pages/page').set({ tenantId: TENANT_A, ownerUid: MEMBER_UID, extra: true }));
      await assertFails(db.doc('signup_pages/page').update({ title: 'Changed' }));
      await assertFails(db.doc('signup_pages/page').delete());
      await assertFails(db.doc('signup_handles/example').get());
      await assertFails(db.doc('signup_handles/new').set({ pageId: 'page', tenantId: TENANT_A, ownerUid: MEMBER_UID }));
      await assertFails(db.doc('signup_pages/page/submissions/new').set({ answers: {}, tenantId: TENANT_A }));
      await assertFails(db.doc('signup_pages/page/submissions/one').delete());
    }
  });
});
