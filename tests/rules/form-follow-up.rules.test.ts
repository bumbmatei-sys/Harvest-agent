import { afterAll, beforeAll, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { seedBase, seedDoc, teardownEnv, fullAdmin, adminB, member, TENANT_A } from './helpers';
beforeAll(async () => {
  await seedBase();
  await seedDoc(`tenants/${TENANT_A}/forms/existing`, { title: 'Form', followUp: { type: 'community', id: TENANT_A } });
});
afterAll(teardownEnv);
it('requires server validation to create, change or remove a follow-up, including for admins', async () => {
  const db = (await fullAdmin()).firestore();
  await assertFails(db.doc(`tenants/${TENANT_A}/forms/new`).set({ title: 'Bad', followUp: { type: 'community', id: 'tenant-b' } }));
  const ref = db.doc(`tenants/${TENANT_A}/forms/existing`);
  await assertFails(ref.update({ followUp: { type: 'product', id: 'foreign' } }));
  await assertFails(ref.update({ followUp: null }));
  await assertFails(ref.set({ title: 'Removed reference' }));
  await assertSucceeds(ref.update({ title: 'Renamed', active: false }));
  await assertSucceeds(db.doc(`tenants/${TENANT_A}/forms/legacy`).set({ title: 'No follow-up' }));
  await assertSucceeds(ref.delete());
});
it('keeps ordinary members and other tenants from managing forms', async () => {
  for (const ctx of [await member(), await adminB()]) await assertFails(ctx.firestore().doc(`tenants/${TENANT_A}/forms/blocked`).set({ title: 'Bad' }));
});
