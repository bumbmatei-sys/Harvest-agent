import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  seedBase, seedDoc, teardownEnv, member, member2, fullAdmin, adminB,
  TENANT_A, TENANT_B, MEMBER_UID,
} from './helpers';
import { migrateCourseContent, restoreInlineContent } from '../../src/lib/courses/migrate-content';
import { mergeCourseContent, splitCourseContent } from '../../src/lib/courses/content';

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
    // A stale content document (left by an earlier migration) next to a course that has inline content again.
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

  it('overwrites a stale content document from the inline copy, which is the newer one', async () => {
    const doc = await adminDb().doc('courses/open/lessonContent/c').get();
    expect(doc.data()).toEqual(splitCourseContent(levelsOf('c') as never).content.c);
    expect(JSON.stringify(doc.data())).not.toContain('ALREADY MOVED');
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

  it('restoreInlineContent is the way back: the previous release sees full lessons on the course doc again', async () => {
    const dry = await restoreInlineContent(adminDb(), { commit: false, tenantId: TENANT_A });
    expect(dry.restored).toBeGreaterThan(0);
    expect(JSON.stringify((await adminDb().doc('courses/restricted').get()).data())).not.toContain(SECRET);

    const r = await restoreInlineContent(adminDb(), { commit: true, tenantId: TENANT_A });
    expect(r.failed).toBe(0);
    const back = (await adminDb().doc('courses/restricted').get()).data() as { levels: ReturnType<typeof levelsOf> };
    expect(back.levels[0].sections[0].lessons[0]).toEqual(legacyLesson('a'));
    expect(back.levels[0].sections[0].lessons[1]).toEqual(legacyLesson('b'));
    // The content documents stay, so migrating forward again is safe.
    expect((await adminDb().collection('courses/restricted/lessonContent').get()).size).toBe(2);
  });
});

describe('migrating again after a revert: a stale lessonContent doc must not shadow newer inline content', () => {
  const newer = (id: string) => ({ ...legacyLesson(id), body: `<p>NEWER EDIT ${id}</p>` });
  const playerView = async (id: string) => {
    const outline = (await adminDb().doc(`courses/${id}`).get()).data() as { levels: ReturnType<typeof levelsOf> };
    const content: Record<string, Record<string, unknown>> = {};
    (await adminDb().collection(`courses/${id}/lessonContent`).get()).forEach((d) => { content[d.id] = d.data(); });
    return (mergeCourseContent(outline as never, content) as unknown as { levels: ReturnType<typeof levelsOf> }).levels[0].sections[0].lessons;
  };

  beforeAll(async () => {
    await seedBase();
    await seedDoc('courses/rr', { title: 'RR', tenantId: TENANT_A, status: 'published', levels: levelsOf('a', 'b') });
  });
  afterAll(async () => { await teardownEnv(); });

  it('migrate, revert (restore), old release edits inline, re-apply and migrate: the newer edit wins and nothing is lost', async () => {
    expect((await migrateCourseContent(adminDb(), { commit: true })).migrated).toBe(1);
    expect((await restoreInlineContent(adminDb(), { commit: true })).restored).toBe(1);

    // The old release saves lesson a inline. The content docs are now stale.
    const inline = (await adminDb().doc('courses/rr').get()).data() as { levels: ReturnType<typeof levelsOf> };
    inline.levels[0].sections[0].lessons[0] = newer('a') as never;
    await adminDb().doc('courses/rr').update({ levels: inline.levels });

    // Re-applied code, before the migration runs: the stale document is what the player sees.
    expect(JSON.stringify(await playerView('rr'))).not.toContain('NEWER EDIT a');

    const r = await migrateCourseContent(adminDb(), { commit: true });
    expect(r).toMatchObject({ scanned: 1, migrated: 1, failed: 0 });

    const newerA = splitCourseContent([{ id: 'lv', title: 'Course', sections: [{ id: 's', title: 'Start', lessons: [newer('a')] }] }] as never).content.a;
    expect((await adminDb().doc('courses/rr/lessonContent/a').get()).data()).toEqual(newerA);
    const lessons = await playerView('rr');
    expect(lessons[0]).toEqual(newer('a'));
    expect(lessons[1]).toEqual(legacyLesson('b'));
    expect(JSON.stringify((await adminDb().doc('courses/rr').get()).data())).not.toContain('NEWER EDIT');
  });

  it('a lesson with no inline content keeps its existing content document', async () => {
    const stub = (id: string) => ({ id, title: `Lesson ${id}`, duration: '5', authorId: 'au', type: 'video-text' });
    await seedDoc('courses/mixed', {
      title: 'M', tenantId: TENANT_A, status: 'published',
      levels: [{ id: 'lv', title: 'Course', sections: [{ id: 's', title: 'Start', lessons: [newer('m1'), stub('m2')] }] }],
    });
    await seedDoc('courses/mixed/lessonContent/m1', { body: '<p>stale m1</p>' });
    await seedDoc('courses/mixed/lessonContent/m2', { body: '<p>kept m2</p>' });

    expect((await migrateCourseContent(adminDb(), { commit: true, tenantId: TENANT_A })).failed).toBe(0);

    expect(((await adminDb().doc('courses/mixed/lessonContent/m1').get()).data() as { body: string }).body).toBe('<p>NEWER EDIT m1</p>');
    expect((await adminDb().doc('courses/mixed/lessonContent/m2').get()).data()).toEqual({ body: '<p>kept m2</p>' });
  });
});
