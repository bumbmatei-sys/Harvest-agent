import { describe, it, beforeAll, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  seedBase, seedDoc, teardownEnv,
  member, adminB, fullAdmin, superAdmin,
  TENANT_A, TENANT_B,
} from './helpers';

/**
 * Authors + Categories are a PER-TENANT course library (mirrors the courses
 * rule). This suite locks in the white-label isolation fix: the read rule is
 * `belongsToTenant(resource.data.tenantId)` — it used to be `isAuthenticated()`,
 * so ANY signed-in user could read EVERY tenant's authors (names, bios, photos,
 * social links) and categories. The tenant-B/tenant-A pairs prove the leak is
 * closed for both single-doc gets and list queries, in both directions.
 *
 * Both tenants deliberately hold a category with the SAME label ("Discipleship")
 * to prove tenant scoping doesn't collide across tenants.
 */
describe('course library (authors + categories) tenant isolation', () => {
  beforeAll(async () => {
    await seedBase();
    await seedDoc('authors/a-author', { name: 'A. Teacher', title: 'Pastor', tenantId: TENANT_A });
    await seedDoc('categories/tenant-a__Discipleship', { name: 'Discipleship', tenantId: TENANT_A });
    await seedDoc('authors/b-author', { name: 'B. Teacher', title: 'Pastor', tenantId: TENANT_B });
    await seedDoc('categories/tenant-b__Discipleship', { name: 'Discipleship', tenantId: TENANT_B });
  });
  afterAll(async () => { await teardownEnv(); });

  describe('single-doc reads', () => {
    it('a tenant-A member can read their own tenant authors + categories', async () => {
      const db = (await member()).firestore();
      await assertSucceeds(db.doc('authors/a-author').get());
      await assertSucceeds(db.doc('categories/tenant-a__Discipleship').get());
    });

    it('a tenant-A member CANNOT read tenant-B authors or categories', async () => {
      const db = (await member()).firestore();
      await assertFails(db.doc('authors/b-author').get());
      await assertFails(db.doc('categories/tenant-b__Discipleship').get());
    });

    it('a tenant-B admin CANNOT read tenant-A authors or categories (the leak, closed)', async () => {
      const db = (await adminB()).firestore();
      await assertFails(db.doc('authors/a-author').get());
      await assertFails(db.doc('categories/tenant-a__Discipleship').get());
    });

    it("a super admin can read any tenant's library (platform context)", async () => {
      const db = (await superAdmin()).firestore();
      await assertSucceeds(db.doc('authors/a-author').get());
      await assertSucceeds(db.doc('authors/b-author').get());
    });
  });

  describe('list queries — the client read pattern', () => {
    it('a tenant-A member CAN list their own library filtered by tenantId', async () => {
      const db = (await member()).firestore();
      await assertSucceeds(db.collection('authors').where('tenantId', '==', TENANT_A).get());
      await assertSucceeds(db.collection('categories').where('tenantId', '==', TENANT_A).get());
    });

    it('an UNFILTERED collection query is rejected (rules are not filters)', async () => {
      const db = (await member()).firestore();
      await assertFails(db.collection('authors').get());
      await assertFails(db.collection('categories').get());
    });

    it("a tenant-A member CANNOT list tenant-B's library even with a filter (the rule enforces, not the query)", async () => {
      const db = (await member()).firestore();
      await assertFails(db.collection('authors').where('tenantId', '==', TENANT_B).get());
      await assertFails(db.collection('categories').where('tenantId', '==', TENANT_B).get());
    });

    it('a super admin may list unscoped (platform context)', async () => {
      const db = (await superAdmin()).firestore();
      await assertSucceeds(db.collection('authors').get());
      await assertSucceeds(db.collection('categories').get());
    });
  });

  describe('writes', () => {
    it('a tenant-A admin can create, update, and delete their own authors + categories', async () => {
      const db = (await fullAdmin()).firestore();
      await assertSucceeds(db.doc('authors/a-new').set({ name: 'New', tenantId: TENANT_A }));
      await assertSucceeds(db.doc('categories/tenant-a__Prayer').set({ name: 'Prayer', tenantId: TENANT_A }));
      await assertSucceeds(db.doc('authors/a-author').update({ title: 'Elder' }));
      await assertSucceeds(db.doc('authors/a-new').delete());
    });

    it('a tenant-A admin CANNOT stamp a new author/category for another tenant', async () => {
      const db = (await fullAdmin()).firestore();
      await assertFails(db.doc('authors/x-cross').set({ name: 'X', tenantId: TENANT_B }));
      await assertFails(db.doc('categories/x-cross').set({ name: 'X', tenantId: TENANT_B }));
    });

    it("a tenant-B admin CANNOT write into tenant-A's library", async () => {
      const db = (await adminB()).firestore();
      await assertFails(db.doc('authors/a-author').update({ title: 'hijacked' }));
      await assertFails(db.doc('authors/b-into-a').set({ name: 'B', tenantId: TENANT_A }));
    });

    it('a plain member cannot write to the library', async () => {
      const db = (await member()).firestore();
      await assertFails(db.doc('authors/m-new').set({ name: 'M', tenantId: TENANT_A }));
      await assertFails(db.doc('categories/tenant-a__Member').set({ name: 'M', tenantId: TENANT_A }));
    });
  });
});
