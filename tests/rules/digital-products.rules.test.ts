import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import { adminB, fullAdmin, member, owner, rosterAdmin, seedBase, seedDoc, teardownEnv, TENANT_A, MEMBER_UID } from './helpers';

describe('digital products remain server-only', () => {
  const product = `tenants/${TENANT_A}/digitalProducts/product1`;
  const entitlement = `${product}/entitlements/${MEMBER_UID}`;
  beforeAll(async () => { await seedBase(); await seedDoc(product, { title: 'Book' }); await seedDoc(entitlement, { active: true }); });
  afterAll(teardownEnv);
  it.each([['member', member], ['owner', owner], ['full admin', fullAdmin], ['roster admin', rosterAdmin], ['other tenant admin', adminB]])('%s cannot get, list or write products or entitlements', async (_, actor) => {
    const db = (await actor()).firestore();
    await assertFails(db.doc(product).get());
    await assertFails(db.collection(`tenants/${TENANT_A}/digitalProducts`).get());
    await assertFails(db.doc(product).set({ title: 'Changed' }));
    await assertFails(db.doc(entitlement).get());
    await assertFails(db.collection(`${product}/entitlements`).get());
    await assertFails(db.doc(entitlement).set({ active: true }));
  });
});
