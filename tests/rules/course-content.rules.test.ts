import { describe, it, beforeAll, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  seedBase, seedDoc, seedAdmin, teardownEnv, getEnv,
  member, member2, adminB, fullAdmin, rosterAdmin, owner, superAdmin, asUid,
  permsOnly, permsAllBut,
  TENANT_A, TENANT_B, MEMBER_UID, ADMIN_B_UID,
} from './helpers';

/**
 * Lesson CONTENT of a tenant course lives in courses/{id}/lessonContent/{lessonId}
 * and is readable only by people entitled to the course. The course doc itself
 * stays tenant-readable (it is the landing record: title, cover, price, outline
 * of lesson titles). Rules mirror canAccessCourse() in src/lib/courses/access.ts.
 *
 * Also pins tenantId on course updates.
 */

const LESSON = { body: '<p>secret</p>', youtubeUrl: 'https://youtu.be/AAAAAAAAAAA', quiz: [{ id: 'q', q: '?', options: [{ id: 'o', text: 'x', correct: true }] }] };

const COURSES: Record<string, Record<string, unknown>> = {
  // Legacy: no accessMode at all. Open to the tenant once published.
  legacyOpen: { status: 'published' },
  everyone: { status: 'published', accessMode: 'everyone' },
  restricted: { status: 'published', accessMode: 'restricted', accessUserIds: [MEMBER_UID, ADMIN_B_UID] },
  restrictedEmpty: { status: 'published', accessMode: 'restricted', accessUserIds: [] },
  restrictedNoList: { status: 'published', accessMode: 'restricted' },
  // An accessMode this build does not know is restricted, never open.
  typo: { status: 'published', accessMode: 'Restricted' },
  modeNull: { status: 'published', accessMode: null },
  draftOpen: { status: 'draft', accessMode: 'everyone', accessUserIds: [MEMBER_UID] },
  noStatus: { accessMode: 'everyone' },
};

const path = (id: string, lesson = 'l1') => `courses/${id}/lessonContent/${lesson}`;

describe('course lesson content: read', () => {
  beforeAll(async () => {
    await seedBase();
    await seedAdmin('course-mgr', TENANT_A, permsOnly('createCourses'));
    await seedAdmin('other-mgr', TENANT_A, permsAllBut('createCourses'));
    for (const [id, data] of Object.entries(COURSES)) {
      await seedDoc(`courses/${id}`, { title: id, tenantId: TENANT_A, levels: [], ...data });
      await seedDoc(path(id), LESSON);
    }
    await seedDoc('courses/b-course', { title: 'b', tenantId: TENANT_B, status: 'published', accessMode: 'everyone' });
    await seedDoc(path('b-course'), LESSON);
  });
  afterAll(async () => { await teardownEnv(); });

  describe('entitled member reads', () => {
    it.each(['legacyOpen', 'everyone'])('a same-tenant member reads an open published course (%s)', async (id) => {
      const db = (await member()).firestore();
      await assertSucceeds(db.doc(path(id)).get());
      await assertSucceeds(db.collection(`courses/${id}/lessonContent`).get());
    });

    it('a member on the access list reads a restricted course', async () => {
      const db = (await member()).firestore();
      await assertSucceeds(db.doc(path('restricted')).get());
      await assertSucceeds(db.collection('courses/restricted/lessonContent').get());
    });
  });

  describe('unentitled same-church member is denied (the leak)', () => {
    it.each(['restricted', 'restrictedEmpty', 'restrictedNoList', 'typo', 'modeNull'])(
      'member2 (not on the list) cannot read %s, by get or list',
      async (id) => {
        const db = (await member2()).firestore();
        await assertFails(db.doc(path(id)).get());
        await assertFails(db.collection(`courses/${id}/lessonContent`).get());
      },
    );

    it('a listed member cannot read a DRAFT, nor a course with no status', async () => {
      const db = (await member()).firestore();
      await assertFails(db.doc(path('draftOpen')).get());
      await assertFails(db.doc(path('noStatus')).get());
    });

    it('the course doc (landing record) stays readable to every same-church member', async () => {
      const db = (await member2()).firestore();
      await assertSucceeds(db.doc('courses/restricted').get());
      await assertSucceeds(db.collection('courses').where('tenantId', '==', TENANT_A).get());
    });
  });

  describe('another church is denied', () => {
    it('a tenant-B admin cannot read tenant-A content, even for an open course or when listed', async () => {
      const db = (await adminB()).firestore();
      await assertFails(db.doc(path('everyone')).get());
      await assertFails(db.doc(path('legacyOpen')).get());
      await assertFails(db.doc(path('restricted')).get());
      await assertFails(db.collection('courses/everyone/lessonContent').get());
    });

    it('a tenant-A member cannot read tenant-B content', async () => {
      const db = (await member()).firestore();
      await assertFails(db.doc(path('b-course')).get());
    });

    it('content of a course that does not exist is unreadable', async () => {
      await seedDoc(path('ghost'), LESSON);
      const db = (await member()).firestore();
      await assertFails(db.doc(path('ghost')).get());
    });

    it('signed-out callers are denied', async () => {
      const e = await getEnv();
      const db = e.unauthenticatedContext().firestore();
      await assertFails(db.doc(path('everyone')).get());
    });
  });

  describe('staff are allowed', () => {
    it.each([
      ['owner', owner],
      ['full-access admin', fullAdmin],
      ['roster admin', rosterAdmin],
      ['super admin', superAdmin],
      ['createCourses manager', () => asUid('course-mgr')],
      ['admin without createCourses (role admin is staff)', () => asUid('other-mgr')],
    ] as const)('%s reads restricted, draft and unknown-mode content', async (_n, who) => {
      const db = (await who()).firestore();
      for (const id of ['restricted', 'restrictedEmpty', 'typo', 'draftOpen', 'noStatus']) {
        await assertSucceeds(db.doc(path(id)).get());
      }
      await assertSucceeds(db.collection('courses/restrictedEmpty/lessonContent').get());
    });

    it('a tenant-B admin is not staff of tenant A', async () => {
      const db = (await adminB()).firestore();
      await assertFails(db.doc(path('draftOpen')).get());
    });
  });
});

describe('course lesson content: write', () => {
  beforeAll(async () => {
    await seedBase();
    await seedAdmin('course-mgr', TENANT_A, permsOnly('createCourses'));
    await seedAdmin('no-course-perm', TENANT_A, permsAllBut('createCourses'));
    await seedDoc('courses/c1', { title: 'c1', tenantId: TENANT_A, status: 'published', accessMode: 'everyone' });
    await seedDoc(path('c1'), LESSON);
    await seedDoc('courses/b1', { title: 'b1', tenantId: TENANT_B, status: 'published' });
  });
  afterAll(async () => { await teardownEnv(); });

  it('a createCourses holder writes, updates and deletes content of their tenant course', async () => {
    const db = (await asUid('course-mgr')).firestore();
    await assertSucceeds(db.doc(path('c1', 'l2')).set(LESSON));
    await assertSucceeds(db.doc(path('c1', 'l2')).update({ body: '<p>edited</p>' }));
    await assertSucceeds(db.doc(path('c1', 'l2')).delete());
  });

  it('a plain member cannot write content, even on an open course', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(path('c1', 'l3')).set(LESSON));
    await assertFails(db.doc(path('c1')).update({ body: 'x' }));
    await assertFails(db.doc(path('c1')).delete());
  });

  it('an admin without createCourses cannot write content', async () => {
    const db = (await asUid('no-course-perm')).firestore();
    await assertFails(db.doc(path('c1', 'l3')).set(LESSON));
  });

  it('another church admin cannot write content under this tenant course', async () => {
    const db = (await adminB()).firestore();
    await assertFails(db.doc(path('c1', 'l3')).set(LESSON));
    await assertFails(db.doc(path('c1')).delete());
  });

  it('nobody can write content under a course that does not exist and is not created in the same batch', async () => {
    const db = (await fullAdmin()).firestore();
    await assertFails(db.doc(path('nope', 'l1')).set(LESSON));
  });

  it('creating a course and its content in ONE batch works (the builder save)', async () => {
    const db = (await fullAdmin()).firestore();
    const b = db.batch();
    b.set(db.doc('courses/new1'), { title: 'n', tenantId: TENANT_A, status: 'draft' });
    b.set(db.doc(path('new1', 'a')), LESSON);
    b.set(db.doc(path('new1', 'b')), LESSON);
    await assertSucceeds(b.commit());
  });

  it('a batch that creates a course in another tenant cannot smuggle content into a tenant-A course', async () => {
    const db = (await adminB()).firestore();
    const b = db.batch();
    b.set(db.doc(path('c1', 'evil')), LESSON);
    await assertFails(b.commit());
  });

  it('a batch of 120 lessons (course update + content) stays inside the rules access-call budget', async () => {
    const db = (await fullAdmin()).firestore();
    const b = db.batch();
    b.update(db.doc('courses/c1'), { title: 'big' });
    for (let i = 0; i < 120; i++) b.set(db.doc(path('c1', `many${i}`)), LESSON);
    await assertSucceeds(b.commit());
  });

  it('deleting a course and its content in one batch works', async () => {
    const db = (await fullAdmin()).firestore();
    const b = db.batch();
    b.delete(db.doc('courses/new1'));
    b.delete(db.doc(path('new1', 'a')));
    b.delete(db.doc(path('new1', 'b')));
    await assertSucceeds(b.commit());
  });
});

describe('course update pins tenantId', () => {
  beforeAll(async () => {
    await seedBase();
    await seedDoc('courses/c1', { title: 'c1', tenantId: TENANT_A, status: 'draft' });
  });
  afterAll(async () => { await teardownEnv(); });

  it('an update that keeps the tenant is allowed', async () => {
    const db = (await fullAdmin()).firestore();
    await assertSucceeds(db.doc('courses/c1').update({ title: 'renamed' }));
    await assertSucceeds(db.doc('courses/c1').set({ title: 'again', tenantId: TENANT_A }, { merge: true }));
  });

  it('moving the course to another tenant is denied for a tenant admin', async () => {
    const db = (await fullAdmin()).firestore();
    await assertFails(db.doc('courses/c1').update({ tenantId: TENANT_B }));
  });

  it('moving the course is denied for a super admin too', async () => {
    const db = (await superAdmin()).firestore();
    await assertFails(db.doc('courses/c1').update({ tenantId: TENANT_B }));
  });

  it('removing or nulling the tenantId is denied', async () => {
    const db = (await fullAdmin()).firestore();
    await assertFails(db.doc('courses/c1').update({ tenantId: null }));
    await assertFails(db.doc('courses/c1').set({ title: 'x' }));
  });

  it('create still stamps the writer tenant, and cross-tenant create is still denied', async () => {
    const a = (await fullAdmin()).firestore();
    await assertSucceeds(a.doc('courses/c2').set({ title: 'n', tenantId: TENANT_A }));
    await assertFails(a.doc('courses/c3').set({ title: 'n', tenantId: TENANT_B }));
  });
});
