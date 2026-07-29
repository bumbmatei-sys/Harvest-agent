import { describe, it, beforeAll, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  getEnv, seedBase, seedDoc, seedAdmin, teardownEnv,
  member, adminB, fullAdmin, superAdmin, owner, asUid,
  permsOnly, permsAllBut,
  TENANT_A, TENANT_B, FULL_ADMIN_UID, MEMBER_UID, OWNER_UID, SUPER_ADMIN_UID,
} from './helpers';

/**
 * The PLATFORM COURSE LIBRARY: /libraryCourses, /libraryAuthors,
 * /libraryCategories, plus the per-tenant adoption record
 * tenants/{t}/adoptedCourses/{libraryCourseId}.
 *
 * Two properties are under test, and they pull in opposite directions:
 *
 *  1. The three library collections are a SHARED CATALOGUE. Every authenticated
 *     user of every tenant reads them; only a super admin writes. Their read
 *     rules reference no document field, which is what makes an UNFILTERED LIST
 *     query legal — the whole reason the library is not a flag on /courses.
 *     The list-query tests below are the regression guard: a `get`-only test
 *     would still pass against a resource.data-based read rule while every real
 *     catalogue query failed (#236, #239).
 *
 *  2. Adoption is PER-TENANT STATE, scoped by PATH. One tenant never reads or
 *     writes another's adoptions, and taking a course needs the same permission
 *     as creating one (createCourses).
 *
 * Tenant isolation for /courses, /authors and /categories is unchanged and is
 * covered by course-library-isolation.rules.test.ts + permissions.rules.test.ts.
 */

// Each library collection paired with a doc seeded below, so the "cannot
// update" assertions hit the RULE rather than failing on a missing document.
const LIBRARY_COLLECTIONS = [
  { col: 'libraryCourses', existingId: 'lib-course-1' },
  { col: 'libraryAuthors', existingId: 'lib-author-1' },
  { col: 'libraryCategories', existingId: 'discipleship' },
] as const;

// The two collections whose read rule references no document field, so any
// query shape stays legal. libraryCourses is excluded — see the header.
const FIELD_FREE_COLLECTIONS = [
  { col: 'libraryAuthors', existingId: 'lib-author-1' },
  { col: 'libraryCategories', existingId: 'discipleship' },
] as const;

// isSuperAdmin() (firestore.rules:15-19) admits the `superAdmin` token claim OR
// either of two literal founder emails. All three paths must be able to author
// the catalogue, or a super admin signed in without the claim propagated yet
// silently loses write access to it.
const SUPER_ADMIN_EMAILS = ['bumbmatei@proton.me', 'bumbmatei@zohomail.eu'] as const;

/** An authed context with an arbitrary email and NO custom claims. */
async function asEmail(uid: string, email: string) {
  const e = await getEnv();
  return e.authenticatedContext(uid, { email });
}

describe('platform course library', () => {
  beforeAll(async () => {
    await seedBase();
    await seedDoc('libraryCourses/lib-course-1', {
      title: 'Foundations of Faith', category: 'Discipleship', status: 'published',
      authorIds: ['lib-author-1'], levels: [], featured: false,
    });
    await seedDoc('libraryCourses/lib-course-2', {
      title: 'Prayer', category: 'Prayer', status: 'draft',
      authorIds: [], levels: [], featured: false,
    });
    await seedDoc('libraryAuthors/lib-author-1', { name: 'Platform Teacher', title: 'Pastor' });
    await seedDoc('libraryCategories/discipleship', { name: 'Discipleship' });

    // Adoption records for both tenants — used by the isolation tests.
    await seedDoc(`tenants/${TENANT_A}/adoptedCourses/lib-course-1`, {
      libraryCourseId: 'lib-course-1', adoptedAt: '2026-01-01T00:00:00.000Z', adoptedBy: FULL_ADMIN_UID,
    });
    await seedDoc(`tenants/${TENANT_B}/adoptedCourses/lib-course-1`, {
      libraryCourseId: 'lib-course-1', adoptedAt: '2026-01-02T00:00:00.000Z', adoptedBy: 'owner-b-uid',
    });

    // Two limited tenant-A admins: one holding ONLY createCourses, one holding
    // every flag EXCEPT it — the pair that proves adoption is gated on exactly
    // that permission and no other.
    await seedAdmin('courses-admin-uid', TENANT_A, permsOnly('createCourses'));
    await seedAdmin('no-courses-admin-uid', TENANT_A, permsAllBut('createCourses'));
  });
  afterAll(async () => { await teardownEnv(); });

  // ── Reads: the shared catalogue ──────────────────────────────────────

  describe('reads', () => {
    for (const { col } of FIELD_FREE_COLLECTIONS) {
      it(`a tenant admin can LIST ${col} UNFILTERED (rules are not filters)`, async () => {
        // THE regression test for these two. Their read rule must not reference
        // resource.data: if it does, this unfiltered list is rejected outright
        // even though a single-doc get still succeeds, and the catalogue
        // renders empty with no error.
        const db = (await fullAdmin()).firestore();
        await assertSucceeds(db.collection(col).get());
      });

      it(`a plain member can list ${col}`, async () => {
        const db = (await member()).firestore();
        await assertSucceeds(db.collection(col).get());
      });

      it(`an admin of ANOTHER tenant can list ${col} (shared catalogue, deliberate)`, async () => {
        const db = (await adminB()).firestore();
        await assertSucceeds(db.collection(col).get());
      });
    }

    for (const { col } of LIBRARY_COLLECTIONS) {
      it(`an UNAUTHENTICATED user CANNOT read ${col}`, async () => {
        const e = await getEnv();
        const db = e.unauthenticatedContext().firestore();
        await assertFails(db.collection(col).get());
      });
    }

    it('a tenant admin can get a single PUBLISHED library course, author and category', async () => {
      const db = (await fullAdmin()).firestore();
      await assertSucceeds(db.doc('libraryCourses/lib-course-1').get());
      await assertSucceeds(db.doc('libraryAuthors/lib-author-1').get());
      await assertSucceeds(db.doc('libraryCategories/discipleship').get());
    });

    it('an UNAUTHENTICATED user CANNOT get a single library doc', async () => {
      const e = await getEnv();
      const db = e.unauthenticatedContext().firestore();
      await assertFails(db.doc('libraryCourses/lib-course-1').get());
      await assertFails(db.doc('libraryAuthors/lib-author-1').get());
      await assertFails(db.doc('libraryCategories/discipleship').get());
    });

    it('the catalogue accepts a category filter alongside the required status filter', async () => {
      const db = (await member()).firestore();
      await assertSucceeds(
        db.collection('libraryCourses')
          .where('status', '==', 'published')
          .where('category', '==', 'Discipleship')
          .get(),
      );
    });
  });

  // ── Draft visibility, and the query-shape cost of it ────────────────
  describe('libraryCourses draft visibility', () => {
    it('a tenant admin CANNOT list libraryCourses unfiltered (the cost of the status rule)', async () => {
      // Deliberate behaviour change. The read rule dereferences
      // resource.data.status, so an unconstrained list is rejected outright for
      // any non-super-admin. AdminCourses and CoursePage therefore MUST send
      // where('status','==','published') — without it the browse view silently
      // renders empty.
      const db = (await fullAdmin()).firestore();
      await assertFails(db.collection('libraryCourses').get());
    });

    it('a plain member CANNOT list libraryCourses unfiltered either', async () => {
      const db = (await member()).firestore();
      await assertFails(db.collection('libraryCourses').get());
    });

    it("a tenant admin CAN list libraryCourses filtered to published — the client's query", async () => {
      const db = (await fullAdmin()).firestore();
      await assertSucceeds(db.collection('libraryCourses').where('status', '==', 'published').get());
    });

    it('a plain member CAN list libraryCourses filtered to published', async () => {
      const db = (await member()).firestore();
      await assertSucceeds(db.collection('libraryCourses').where('status', '==', 'published').get());
    });

    it("an admin of ANOTHER tenant CAN list published courses (shared catalogue)", async () => {
      const db = (await adminB()).firestore();
      await assertSucceeds(db.collection('libraryCourses').where('status', '==', 'published').get());
    });

    it('a tenant admin CANNOT get an unpublished draft', async () => {
      // The whole point: before this rule, a draft was readable by anyone with
      // an SDK console and only a client-side filter hid it.
      const db = (await fullAdmin()).firestore();
      await assertFails(db.doc('libraryCourses/lib-course-2').get());
    });

    it('a plain member CANNOT get an unpublished draft', async () => {
      const db = (await member()).firestore();
      await assertFails(db.doc('libraryCourses/lib-course-2').get());
    });

    it('a tenant admin CANNOT list drafts by asking for them', async () => {
      const db = (await fullAdmin()).firestore();
      await assertFails(db.collection('libraryCourses').where('status', '==', 'draft').get());
    });

    it('a SUPER ADMIN can still list unfiltered and read drafts (the authoring screen)', async () => {
      // isSuperAdmin() short-circuits the condition true without touching
      // resource.data, so AdminLibraryCourses keeps working unchanged.
      const db = (await superAdmin()).firestore();
      await assertSucceeds(db.collection('libraryCourses').get());
      await assertSucceeds(db.doc('libraryCourses/lib-course-2').get());
      await assertSucceeds(db.collection('libraryCourses').where('status', '==', 'draft').get());
    });
  });

  // ── Writes: super admin only ─────────────────────────────────────────

  describe('writes', () => {
    for (const { col, existingId } of LIBRARY_COLLECTIONS) {
      it(`a full-access tenant admin CANNOT write ${col}`, async () => {
        const db = (await fullAdmin()).firestore();
        await assertFails(db.doc(`${col}/tenant-authored`).set({ name: 'X', title: 'X' }));
        await assertFails(db.doc(`${col}/${existingId}`).update({ title: 'hijacked' }));
        await assertFails(db.doc(`${col}/${existingId}`).delete());
      });

      it(`a plain member CANNOT write ${col}`, async () => {
        const db = (await member()).firestore();
        await assertFails(db.doc(`${col}/member-authored`).set({ name: 'M', title: 'M' }));
      });

      it(`an UNAUTHENTICATED user CANNOT write ${col}`, async () => {
        const e = await getEnv();
        const db = e.unauthenticatedContext().firestore();
        await assertFails(db.doc(`${col}/anon-authored`).set({ name: 'A', title: 'A' }));
      });

      it(`a super admin (superAdmin claim) can create, update and delete ${col}`, async () => {
        const db = (await superAdmin()).firestore();
        await assertSucceeds(db.doc(`${col}/claim-authored`).set({ name: 'New', title: 'New' }));
        await assertSucceeds(db.doc(`${col}/claim-authored`).update({ title: 'Edited' }));
        await assertSucceeds(db.doc(`${col}/claim-authored`).delete());
      });

      for (const [i, email] of SUPER_ADMIN_EMAILS.entries()) {
        it(`a super admin by literal email ${email} can write ${col}`, async () => {
          // No superAdmin claim — authority comes purely from the email literal.
          const db = (await asEmail(`email-super-${i}-uid`, email)).firestore();
          await assertSucceeds(db.doc(`${col}/email-authored`).set({ name: 'New', title: 'New' }));
          await assertSucceeds(db.doc(`${col}/email-authored`).update({ title: 'Edited' }));
          await assertSucceeds(db.doc(`${col}/email-authored`).delete());
        });
      }

      it(`some OTHER email does not grant ${col} writes`, async () => {
        const db = (await asEmail('impostor-uid', 'bumbmatei@example.com')).firestore();
        await assertFails(db.doc(`${col}/impostor-authored`).set({ name: 'X', title: 'X' }));
      });
    }
  });

  // ── Adoption records: per-tenant, scoped by path ─────────────────────

  describe('adoption records', () => {
    it('a tenant-A member can read their own tenant adoptions, unfiltered', async () => {
      const db = (await member()).firestore();
      await assertSucceeds(db.collection(`tenants/${TENANT_A}/adoptedCourses`).get());
      await assertSucceeds(db.doc(`tenants/${TENANT_A}/adoptedCourses/lib-course-1`).get());
    });

    it('a tenant-A admin CANNOT read tenant-B adoptions', async () => {
      const db = (await fullAdmin()).firestore();
      await assertFails(db.collection(`tenants/${TENANT_B}/adoptedCourses`).get());
      await assertFails(db.doc(`tenants/${TENANT_B}/adoptedCourses/lib-course-1`).get());
    });

    it('a tenant-B admin CANNOT read tenant-A adoptions', async () => {
      const db = (await adminB()).firestore();
      await assertFails(db.collection(`tenants/${TENANT_A}/adoptedCourses`).get());
      await assertFails(db.doc(`tenants/${TENANT_A}/adoptedCourses/lib-course-1`).get());
    });

    it('an UNAUTHENTICATED user CANNOT read adoptions', async () => {
      const e = await getEnv();
      const db = e.unauthenticatedContext().firestore();
      await assertFails(db.collection(`tenants/${TENANT_A}/adoptedCourses`).get());
    });

    // ── Writes are SERVER-ONLY now ────────────────────────────────────
    // Adoption moved to /api/courses/adopt (Admin SDK). The rule is the
    // certificates shape, `allow write: if false`, because only a server can
    // verify the pointer targets a real, PUBLISHED library course — rules
    // cannot read across into libraryCourses to check. A client write could
    // otherwise invent an id, disagree with its own doc id, aim at a draft, or
    // dangle at a deleted course, and the rule would have to accept all of it.
    it('a full-access tenant admin CANNOT write their own adoption records', async () => {
      const db = (await fullAdmin()).firestore();
      const ref = db.doc(`tenants/${TENANT_A}/adoptedCourses/lib-course-2`);
      await assertFails(ref.set({
        libraryCourseId: 'lib-course-2', adoptedAt: '2026-02-01T00:00:00.000Z', adoptedBy: FULL_ADMIN_UID,
      }));
      await assertFails(db.doc(`tenants/${TENANT_A}/adoptedCourses/lib-course-1`).update({ status: 'draft' }));
      await assertFails(db.doc(`tenants/${TENANT_A}/adoptedCourses/lib-course-1`).delete());
    });

    it('the tenant OWNER cannot write one either — nobody can from a client', async () => {
      const db = (await owner()).firestore();
      await assertFails(db.doc(`tenants/${TENANT_A}/adoptedCourses/lib-course-2`).set({
        libraryCourseId: 'lib-course-2', adoptedAt: '2026-02-01T00:00:00.000Z', adoptedBy: OWNER_UID,
      }));
    });

    it('not even a SUPER ADMIN can write one from a client', async () => {
      // The certificates precedent: server-only means server-only. The Admin
      // SDK bypasses rules, so the route is unaffected.
      const db = (await superAdmin()).firestore();
      await assertFails(db.doc(`tenants/${TENANT_A}/adoptedCourses/lib-course-2`).set({
        libraryCourseId: 'lib-course-2', adoptedAt: '2026-02-01T00:00:00.000Z', adoptedBy: SUPER_ADMIN_UID,
      }));
    });

    it('a tenant-A admin CANNOT write into tenant-B adoptions', async () => {
      const db = (await fullAdmin()).firestore();
      await assertFails(db.doc(`tenants/${TENANT_B}/adoptedCourses/lib-course-2`).set({
        libraryCourseId: 'lib-course-2', adoptedAt: '2026-02-01T00:00:00.000Z', adoptedBy: FULL_ADMIN_UID,
      }));
      await assertFails(db.doc(`tenants/${TENANT_B}/adoptedCourses/lib-course-1`).delete());
    });

    it('a plain member CANNOT adopt', async () => {
      const db = (await member()).firestore();
      await assertFails(db.doc(`tenants/${TENANT_A}/adoptedCourses/lib-course-2`).set({
        libraryCourseId: 'lib-course-2', adoptedAt: '2026-02-01T00:00:00.000Z', adoptedBy: MEMBER_UID,
      }));
    });

    it('holding createCourses does NOT restore the client write path', async () => {
      // It used to be sufficient; the permission now gates the ROUTE instead.
      const db = (await asUid('courses-admin-uid')).firestore();
      await assertFails(db.doc(`tenants/${TENANT_A}/adoptedCourses/lib-course-2`).set({
        libraryCourseId: 'lib-course-2', adoptedAt: '2026-02-01T00:00:00.000Z', adoptedBy: 'courses-admin-uid',
      }));
    });

    it('an admin holding every flag EXCEPT createCourses also cannot adopt', async () => {
      const db = (await asUid('no-courses-admin-uid')).firestore();
      await assertFails(db.doc(`tenants/${TENANT_A}/adoptedCourses/lib-course-2`).set({
        libraryCourseId: 'lib-course-2', adoptedAt: '2026-02-01T00:00:00.000Z', adoptedBy: 'no-courses-admin-uid',
      }));
    });

    it('members can still READ adoptions — only writes moved server-side', async () => {
      const db = (await member()).firestore();
      await assertSucceeds(db.collection(`tenants/${TENANT_A}/adoptedCourses`).get());
      await assertSucceeds(db.doc(`tenants/${TENANT_A}/adoptedCourses/lib-course-1`).get());
    });

    it('adopting does NOT grant library write access (the pointer is one-way)', async () => {
      const db = (await fullAdmin()).firestore();
      await assertFails(db.doc('libraryCourses/lib-course-1').update({ title: 'edited by an adopter' }));
    });
  });
});
