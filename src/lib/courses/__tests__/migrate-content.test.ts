import { describe, expect, it, vi } from 'vitest';
import { migrateCourseContent } from '../migrate-content';

/** A minimal Admin Firestore double, enough to prove the ORDER of the migration's steps. */
function fakeDb(opts: { readBackMissing: boolean; readBackStale?: boolean }) {
  const log: string[] = [];
  const course = {
    id: 'c1',
    data: () => ({ levels: [{ id: 'l', title: 'L', sections: [{ id: 's', title: 'S', lessons: [{ id: 'a', title: 'A', duration: '', authorId: '', body: '<p>x</p>' }] }] }] }),
  };
  const contentRef = (id: string) => ({ id, path: `courses/c1/lessonContent/${id}` });
  const db: any = {
    collection: () => ({
      orderBy: () => ({ limit: () => ({ get: async () => ({ empty: false, size: 1, docs: [course] }) }) }),
      doc: () => ({
        collection: () => ({ doc: contentRef }),
        update: async () => { log.push('update-course'); },
      }),
    }),
    getAll: vi.fn(async (...refs: Array<{ id: string }>) => {
      log.push('getAll');
      return refs.map(() => ({ exists: !opts.readBackMissing, data: () => (opts.readBackStale ? { body: '<p>stale</p>' } : { body: '<p>x</p>' }) }));
    }),
    batch: () => ({ set: () => { log.push('set-content'); }, commit: async () => { log.push('commit'); } }),
  };
  return { db, log };
}

describe('migrateCourseContent ordering', () => {
  it('writes content, reads it back, and only then strips the course document', async () => {
    const { db, log } = fakeDb({ readBackMissing: false });
    const r = await migrateCourseContent(db, { commit: true });
    expect(r.migrated).toBe(1);
    expect(log).toEqual(['set-content', 'commit', 'getAll', 'update-course']);
  });

  it('leaves the course document untouched when the content does not read back', async () => {
    const { db, log } = fakeDb({ readBackMissing: true });
    const r = await migrateCourseContent(db, { commit: true });
    expect(r.failed).toBe(1);
    expect(r.outcomes[0]).toMatchObject({ status: 'failed' });
    expect(log).not.toContain('update-course');
  });

  it('leaves the course document untouched when the read-back differs from what was written', async () => {
    const { db, log } = fakeDb({ readBackMissing: false, readBackStale: true });
    const r = await migrateCourseContent(db, { commit: true });
    expect(r.failed).toBe(1);
    expect(log).not.toContain('update-course');
  });

  it('writes nothing on a dry run', async () => {
    const { db, log } = fakeDb({ readBackMissing: false });
    const r = await migrateCourseContent(db, { commit: false });
    expect(r.wouldMigrate).toBe(1);
    expect(log).toEqual([]);
  });
});
