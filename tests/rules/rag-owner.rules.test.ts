import { describe, it, beforeAll, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { getEnv, seedDoc, teardownEnv, asUid, permsFull } from './helpers';

/**
 * Repro for the production bug: the tenant OWNER of `bumb` (uid 3qT1…) could
 * CREATE rag_sources + rag_chunks but "Failed to add knowledge source" — the
 * subsequent client READ (finalizeSource's getDocs, the delete-cleanup getDoc,
 * the onSnapshot listener) was denied with "Missing or insufficient
 * permissions".
 *
 * This fixture models that owner EXACTLY: authority comes purely from
 * tenants/{t}.ownerId. They are NOT otherwise a tenant admin — role 'user',
 * NOT on the adminEmails roster, NO permissions map, no admin/superAdmin claim.
 *
 * The asymmetry under test:
 *   - WRITE rules gate on hasPermission('uploadRag', …) which DOES honor the
 *     owner via isTenantOwner → every create/update/delete passes (matches
 *     prod: the source doc appears in Firestore).
 *   - READ rules gate on isTenantAdmin(…) which (pre-fix) does NOT check
 *     ownerId → every read is denied → the flow throws on the read-back.
 */

const PURE_TENANT = 'pure-tenant';
const PURE_OWNER_UID = 'pure-owner-uid';        // asUid() derives email pure-owner-uid@test.com
const PURE_MEMBER_UID = 'pure-member-uid';      // a plain member of the same tenant (NOT the owner)
const OTHER_TENANT = 'other-tenant';
const OTHER_ADMIN_UID = 'other-admin-uid';      // full-access admin of a DIFFERENT tenant

// A real 3072-float embedding vector (model gemini-embedding-001, no
// outputDimensionality) — included to ALSO rule out any field-size / array
// constraint on the chunk write (candidate cause #3).
const VECTOR = Array.from({ length: 3072 }, (_, i) => ((i % 997) / 1000) - 0.5);

async function seedScenario(): Promise<void> {
  const e = await getEnv();
  await e.clearFirestore();

  // The owner's tenant. adminEmails deliberately does NOT contain the owner's
  // email — the owner is identified ONLY by ownerId (as in the reported prod
  // data: tenants/bumb.ownerId == 3qT1…).
  await seedDoc(`tenants/${PURE_TENANT}`, {
    name: 'Pure Tenant', ownerId: PURE_OWNER_UID,
    adminEmails: ['someone-else@test.com'], plan: 'ministry', status: 'active',
  });
  // Pure owner: role 'user', NO permissions map, tenantId set. NOT an admin.
  await seedDoc(`users/${PURE_OWNER_UID}`, {
    email: 'pure-owner-uid@test.com', role: 'user', tenantId: PURE_TENANT,
  });
  // A plain member of the SAME tenant — proves the fix grants the OWNER only,
  // not every tenant member.
  await seedDoc(`users/${PURE_MEMBER_UID}`, {
    email: 'pure-member-uid@test.com', role: 'user', tenantId: PURE_TENANT,
  });

  // A second tenant + its full-access admin — proves tenant isolation survives.
  await seedDoc(`tenants/${OTHER_TENANT}`, {
    name: 'Other Tenant', ownerId: 'other-owner-uid',
    adminEmails: ['other@test.com'], plan: 'ministry', status: 'active',
  });
  await seedDoc(`users/${OTHER_ADMIN_UID}`, {
    email: 'other-admin-uid@test.com', role: 'admin', tenantId: OTHER_TENANT, permissions: permsFull(),
  });

  // Pre-seeded docs (rules-bypassing) for the READ / update / delete cases.
  await seedDoc(`rag_sources/seeded-src`, {
    sourceId: 'sid-seed', title: 'Seeded', type: 'text', status: 'processing', chunks: 0, tenantId: PURE_TENANT,
  });
  await seedDoc(`rag_chunks/seeded-chunk`, {
    sourceId: 'sid-seed', title: 'Seeded', type: 'text', chunk: 'seed', vector: VECTOR, tenantId: PURE_TENANT,
  });
}

beforeAll(seedScenario);
afterAll(teardownEnv);

describe('RAG owner — WRITE path (already works via hasPermission → isTenantOwner)', () => {
  it('owner CREATES rag_sources (matches prod: the source doc is written)', async () => {
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    await assertSucceeds(db.doc('rag_sources/create-src').set({
      sourceId: 'sid1', title: 'Doc', type: 'text', status: 'processing', chunks: 0, tenantId: PURE_TENANT,
    }));
  });

  it('owner CREATES a rag_chunks doc carrying a 3072-float vector (rules AND field-size both OK)', async () => {
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    await assertSucceeds(db.doc('rag_chunks/create-chunk').set({
      sourceId: 'sid1', title: 'Doc', type: 'text', chunk: 'hello world', vector: VECTOR, tenantId: PURE_TENANT,
    }));
  });

  it('owner UPDATEs the source (finalizeSource updateDoc) and DELETEs source + chunk', async () => {
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    await assertSucceeds(db.doc('rag_sources/seeded-src').update({ status: 'processed', chunks: 1, error: null }));
    await seedDoc('rag_sources/del-src', { tenantId: PURE_TENANT, sourceId: 'x' });
    await seedDoc('rag_chunks/del-chunk', { tenantId: PURE_TENANT, sourceId: 'x' });
    await assertSucceeds(db.doc('rag_sources/del-src').delete());
    await assertSucceeds(db.doc('rag_chunks/del-chunk').delete());
  });
});

describe('RAG owner — READ path (the bug: pre-fix these are DENIED)', () => {
  it('owner can READ their own rag_sources doc (finalizeSource getDocs / onSnapshot / delete getDoc)', async () => {
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    await assertSucceeds(db.doc('rag_sources/seeded-src').get());
  });

  it('owner can READ their own rag_chunks doc (AIChat retrieval / delete cleanup getDocs)', async () => {
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    await assertSucceeds(db.doc('rag_chunks/seeded-chunk').get());
  });
});

describe('RAG owner — QUERY patterns (getDocs). tenant-scoped queries pass; sourceId-only ones cannot', () => {
  // These document the SECOND, non-owner-specific defect: Firestore's "rules are
  // not filters" analysis rejects any rag query that is NOT constrained by
  // tenantId (the read rule keys off resource.data.tenantId), for everyone but a
  // super admin. This is why the client fix (AdminRAG.tsx) writes finalize/mark-
  // error straight to the source's DocumentReference and scopes the delete
  // cleanup by tenantId, instead of querying `where sourceId ==`.

  it('onSnapshot list: query rag_sources where tenantId == own tenant → PASS', async () => {
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    await assertSucceeds(db.collection('rag_sources').where('tenantId', '==', PURE_TENANT).get());
  });

  it('AIChat retrieval: query rag_chunks where tenantId == own tenant → PASS', async () => {
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    await assertSucceeds(db.collection('rag_chunks').where('tenantId', '==', PURE_TENANT).get());
  });

  it('delete cleanup (FIXED): query rag_chunks where tenantId == T AND sourceId == X → PASS', async () => {
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    await assertSucceeds(
      db.collection('rag_chunks').where('tenantId', '==', PURE_TENANT).where('sourceId', '==', 'sid-seed').get(),
    );
  });

  it('the OLD sourceId-only queries are denied for the owner (rules-are-not-filters — why the client no longer uses them)', async () => {
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    await assertFails(db.collection('rag_sources').where('sourceId', '==', 'sid-seed').get());
    await assertFails(db.collection('rag_chunks').where('sourceId', '==', 'sid-seed').get());
  });

  it('a cross-tenant admin CANNOT run the tenantId-scoped query on the owner tenant', async () => {
    const db = (await asUid(OTHER_ADMIN_UID)).firestore();
    await assertFails(db.collection('rag_sources').where('tenantId', '==', PURE_TENANT).get());
    await assertFails(db.collection('rag_chunks').where('tenantId', '==', PURE_TENANT).get());
  });
});

describe('RAG owner — end-to-end add + delete, mirroring the FIXED client', () => {
  it('handlePasteSubmit → chunkAndEmbed → finalizeSource(sourceRef) — no sourceId read', async () => {
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    // handlePasteSubmit: addDoc rag_sources (this is the "sourceRef")
    await assertSucceeds(db.doc('rag_sources/flow-src').set({
      sourceId: 'flow-sid', title: 'Flow', type: 'text', status: 'processing', chunks: 0, tenantId: PURE_TENANT,
    }));
    // chunkAndEmbed: addDoc rag_chunks after the /api/gemini 200
    await assertSucceeds(db.doc('rag_chunks/flow-chunk').set({
      sourceId: 'flow-sid', title: 'Flow', type: 'text', chunk: 'c', vector: VECTOR, tenantId: PURE_TENANT,
    }));
    // finalizeSource: updateDoc straight to the source ref (NO read-back).
    await assertSucceeds(db.doc('rag_sources/flow-src').update({ status: 'processed', chunks: 1, error: null }));
  });

  it('confirmDelete → getDoc(source) → deleteDoc(source) → tenant-scoped chunk query → deleteDoc(chunks)', async () => {
    await seedDoc('rag_sources/del-flow-src', { sourceId: 'del-flow', tenantId: PURE_TENANT, status: 'processed' });
    await seedDoc('rag_chunks/del-flow-chunk', { sourceId: 'del-flow', tenantId: PURE_TENANT, chunk: 'x' });
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    await assertSucceeds(db.doc('rag_sources/del-flow-src').get());            // tenant-mismatch guard
    await assertSucceeds(db.doc('rag_sources/del-flow-src').delete());          // delete source
    await assertSucceeds(                                                       // find chunks (tenant-scoped)
      db.collection('rag_chunks').where('tenantId', '==', PURE_TENANT).where('sourceId', '==', 'del-flow').get(),
    );
    await assertSucceeds(db.doc('rag_chunks/del-flow-chunk').delete());         // delete chunk
  });
});

describe('RAG owner — tenant isolation MUST hold (fix grants owner only, no cross-tenant leak)', () => {
  it('a cross-tenant full-access admin CANNOT read the owner tenant\'s rag docs', async () => {
    const db = (await asUid(OTHER_ADMIN_UID)).firestore();
    await assertFails(db.doc('rag_sources/seeded-src').get());
    await assertFails(db.doc('rag_chunks/seeded-chunk').get());
  });

  it('a cross-tenant full-access admin CANNOT write the owner tenant\'s rag docs', async () => {
    const db = (await asUid(OTHER_ADMIN_UID)).firestore();
    await assertFails(db.doc('rag_sources/cross-write').set({ tenantId: PURE_TENANT, sourceId: 'z' }));
    await assertFails(db.doc('rag_chunks/cross-write').set({ tenantId: PURE_TENANT, sourceId: 'z', vector: VECTOR }));
  });

  it('the owner CANNOT read/write ANOTHER tenant\'s rag docs (owner of pure-tenant is not owner of other-tenant)', async () => {
    await seedDoc('rag_sources/other-src', { tenantId: OTHER_TENANT, sourceId: 'o' });
    const db = (await asUid(PURE_OWNER_UID)).firestore();
    await assertFails(db.doc('rag_sources/other-src').get());
    await assertFails(db.doc('rag_sources/other-create').set({ tenantId: OTHER_TENANT, sourceId: 'o' }));
  });

  it('a plain MEMBER of the owner\'s tenant is still DENIED rag reads (fix is scoped to the owner)', async () => {
    const db = (await asUid(PURE_MEMBER_UID)).firestore();
    await assertFails(db.doc('rag_sources/seeded-src').get());
    await assertFails(db.doc('rag_chunks/seeded-chunk').get());
  });
});
