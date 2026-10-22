import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  seedBase, seedDoc, teardownEnv, member, member2, fullAdmin, adminB,
  TENANT_A, TENANT_B, MEMBER_UID,
} from './helpers';
import { migrateCourseContent } from '../../src/lib/courses/migrate-content';
import { mergeCourseContent } from '../../src/lib/courses/content';

/**
 * The one-time move of lesson content out of the tenant-readable course doc,
 * run against the emulator (never production). The point is not just that the
 * documents move: it is that, afterwards, a same-church member can no longer
 * read the content through the SDK, and the player still gets it back whole.
 */

const SECRET = 'SECRET-LESSON-BODY';
const legacyLesson = (id: string) => ({
  id, title: `Lesson ${id}`, duration: '5', authorId: 'au', type: 'video-text', summary: '',
  body: `<p>${SECRET} ${id}</p>`, youtubeUrl: 'https://youtu.be/AAAAAAAAAAA',
  quiz: [{ id: 'q', q: '?', options: [{ id: 'o', text: 'x', correct: true }] }],
});
const levelsOf = (...ids: string[]) => [{ id: 'lv', title: 'Course', sections: [{ id: 's', title: 'Start', lessons: ids.map(legacyLesson) }] }];

const adminDb = () => {
  if (getApps().length === 0) initializeApp({ projectId: 'demo-rules-test' });
  return getFirestore();
};

describe('migrateCourseContent on the emulator', () => {
  beforeAll(async () => {
    await seedBase();
    await seedDoc('courses/restricted', { title: 'R', tenantId: TENANT_A, status: 'published', accessMode: 'restricted', accessUserIds: [MEMBER_UID], levels: levelsOf('a', 'b') });
    await seedDoc('courses/open', { title: 'O', tenantId: TENANT_A, status: 'published', levels: levelsOf('c') });
    await seedDoc('courses/b-course', { title: 'B', tenantId: TENANT_B, status: 'published', levels: levelsOf('z') });
    await seedDoc('courses/done', {
      title: 'D', tenantId: TENANT_A, status: 'published',
      levels: [{ id: 'lv', title: 'C', sections: [{ id: 's', title: 'S', lessons: [{ id: 'd1', title: 'D1', duration: '', authorId: '', type: 'text' }] }] }],
    });
    // A pre-existing content document must survive untouched.
    await seedDoc('courses/open/lessonContent/c', { body: '<p>ALREADY MOVED</p>' });
  });
  afterAll(async () => { await teardownEnv(); });

  it('before the move, any same-church member can read the content straight off the course doc (the leak)', async () => {
    const snap = await assertSucceeds((await member2()).firestore().doc('courses/restricted').get());
    expect(JSON.stringify(snap.data())).toContain(SECRET);
  });

  it('a dry run reports what would move and writes nothing', async () => {
    const r = await migrateCourseContent(adminDb(), { commit: false });
    expect(r).toMatchObject({ scanned: 4, wouldMigrate: 3, alreadySplit: 1, migrated: 0, failed: 0 });
    const doc = await adminDb().doc('courses/restricted').get();
    expect(JSON.stringify(doc.data())).toContain(SECRET);
    expect((await adminDb().collection('courses/restricted/lessonContent').get()).size).toBe(0);
  });

  it('limiting to one tenant leaves the other tenant untouched', async () => {
    const r = await migrateCourseContent(adminDb(), { commit: false, tenantId: TENANT_B });
    expect(r.scanned).toBe(1);
  });

  it('commit moves the content; the course doc is left with the outline only', async () => {
    const r = await migrateCourseContent(adminDb(), { commit: true, tenantId: TENANT_A });
    expect(r).toMatchObject({ scanned: 3, migrated: 2, alreadySplit: 1, failed: 0 });

    const after = await adminDb().doc('courses/restricted').get();
    const raw = JSON.stringify(after.data());
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('youtu.be');
    expect(raw).not.toContain('"correct"');
    expect(raw).toContain('Lesson a');

    const content = await adminDb().collection('courses/restricted/lessonContent').get();
    expect(content.docs.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('the player gets the original lessons back: outline plus content equals what was stored', async () => {
    const outline = (await adminDb().doc('courses/restricted').get()).data() as { levels: ReturnType<typeof levelsOf> };
    const content: Record<string, Record<string, unknown>> = {};
    (await adminDb().collection('courses/restricted/lessonContent').get()).forEach((d) => { content[d.id] = d.data(); });
    const merged = mergeCourseContent(outline as never, content) as unknown as { levels: ReturnType<typeof levelsOf> };
    expect(merged.levels[0].sections[0].lessons[0]).toEqual(legacyLesson('a'));
  });

  it('never overwrites a content document that already exists', async () => {
    const doc = await adminDb().doc('courses/open/lessonContent/c').get();
    expect(doc.data()).toEqual({ body: '<p>ALREADY MOVED</p>' });
  });

  it('afterwards an unentitled member cannot read the content, by any route', async () => {
    const m2 = (await member2()).firestore();
    const courseDoc = await assertSucceeds(m2.doc('courses/restricted').get());
    expect(JSON.stringify(courseDoc.data())).not.toContain(SECRET);
    await assertFails(m2.doc('courses/restricted/lessonContent/a').get());
    await assertFails(m2.collection('courses/restricted/lessonContent').get());
    await assertFails((await adminB()).firestore().doc('courses/restricted/lessonContent/a').get());
  });

  it('afterwards the entitled member and staff still can', async () => {
    await assertSucceeds((await member()).firestore().collection('courses/restricted/lessonContent').get());
    await assertSucceeds((await fullAdmin()).firestore().collection('courses/restricted/lessonContent').get());
  });

  it('running it again changes nothing', async () => {
    const r = await migrateCourseContent(adminDb(), { commit: true, tenantId: TENANT_A });
    expect(r).toMatchObject({ scanned: 3, migrated: 0, alreadySplit: 3, failed: 0 });
  });

  it('tenant B was not touched by the tenant A run', async () => {
    const doc = await adminDb().doc('courses/b-course').get();
    expect(JSON.stringify(doc.data())).toContain(SECRET);
  });
});
