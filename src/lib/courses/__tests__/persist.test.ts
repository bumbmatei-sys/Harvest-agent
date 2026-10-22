import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductCourse } from '@/types/course-product.types';

vi.mock('@/firebase', () => ({ db: { __db: true } }));

const scope = vi.hoisted(() => ({ read: 'tenant-1' as string | null, write: 'tenant-1' as string | null }));
vi.mock('@/utils/tenant-scope', () => ({
  getTenantScope: async () => scope.read,
  getWriteTenantScope: async () => scope.write,
}));

const track = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics/client', () => ({ trackProductEvent: track }));

const fs = vi.hoisted(() => {
  const ops: Array<{ op: string; path: string; data?: Record<string, unknown> }> = [];
  return {
    stored: null as null | Record<string, unknown>,
    existingContent: [] as string[],
    ops,
    commit: vi.fn(async () => {}),
    commits: 0,
  };
});
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/'), __col: true }),
  doc: (a: unknown, ...seg: string[]) => {
    const parts = (a as { __col?: boolean; __path?: string }).__col ? [(a as { __path: string }).__path, 'new-id'] : seg;
    return { __path: parts.join('/'), id: parts[parts.length - 1] };
  },
  getDoc: async () => ({ exists: () => fs.stored !== null, data: () => fs.stored ?? {} }),
  getDocs: async () => ({ docs: fs.existingContent.map((id) => ({ id, ref: { __path: `x/${id}` } })) }),
  writeBatch: () => ({
    set: (ref: { __path: string }, data: Record<string, unknown>) => fs.ops.push({ op: 'set', path: ref.__path, data }),
    update: (ref: { __path: string }, data: Record<string, unknown>) => fs.ops.push({ op: 'update', path: ref.__path, data }),
    delete: (ref: { __path: string }) => fs.ops.push({ op: 'delete', path: ref.__path }),
    commit: fs.commit,
  }),
}));

import { MAX_SAVE_WRITES, deleteCourse, saveCourse } from '../persist';

const lesson = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Lesson ${id}`, duration: '5', authorId: '', summary: '', type: 'text', body: `<p>body ${id}</p>`, ...extra,
});
const withLessons = (...lessons: Record<string, unknown>[]) =>
  [{ id: 'l1', title: 'Course', sections: [{ id: 's1', title: 'Start', lessons }] }] as unknown as ProductCourse['levels'];

const course = (over: Partial<ProductCourse> = {}): ProductCourse =>
  ({ title: 'Prayer', description: '', category: '', thumbnail: '', featured: false, authorIds: [], levels: [], ...over }) as ProductCourse;

const opsOf = (op: string) => fs.ops.filter((o) => o.op === op);

beforeEach(() => {
  scope.read = 'tenant-1';
  scope.write = 'tenant-1';
  fs.stored = null;
  fs.existingContent = [];
  fs.ops.length = 0;
  fs.commit.mockReset();
  fs.commit.mockResolvedValue(undefined);
  track.mockClear();
});

describe('saveCourse: editing', () => {
  it('refuses to save a course whose document belongs to another ministry, and never writes', async () => {
    fs.stored = { tenantId: 'tenant-OTHER' };
    await expect(saveCourse(course({ id: 'c1' }), 'draft')).rejects.toThrow('belongs to another ministry');
    expect(fs.ops).toEqual([]);
    expect(fs.commit).not.toHaveBeenCalled();
  });

  it('updates a course that belongs to this ministry in one batch', async () => {
    fs.stored = { tenantId: 'tenant-1' };
    const id = await saveCourse(course({ id: 'c1', title: 'Renamed' }), 'draft');
    expect(id).toBe('c1');
    expect(fs.commit).toHaveBeenCalledTimes(1);
    const [update] = opsOf('update');
    expect(update.path).toBe('courses/c1');
    expect(update.data).toMatchObject({ title: 'Renamed', status: 'draft' });
    expect(update.data).not.toHaveProperty('id');
    expect(update.data).not.toHaveProperty('createdAt');
  });

  it('updates a legacy document that carries no tenantId', async () => {
    fs.stored = {};
    await saveCourse(course({ id: 'c1' }), 'draft');
    expect(opsOf('update')).toHaveLength(1);
  });

  it('skips the ownership check on the apex, where the read scope is null', async () => {
    scope.read = null;
    fs.stored = { tenantId: 'tenant-OTHER' };
    await saveCourse(course({ id: 'c1' }), 'draft');
    expect(opsOf('update')).toHaveLength(1);
  });

  it('propagates a failed write instead of swallowing it', async () => {
    fs.stored = { tenantId: 'tenant-1' };
    fs.commit.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(saveCourse(course({ id: 'c1' }), 'draft')).rejects.toThrow('permission-denied');
  });
});

describe('saveCourse: creating', () => {
  it('stamps the write-scope tenantId on the new document', async () => {
    scope.read = null;
    scope.write = 'harvest';
    const id = await saveCourse(course(), 'draft');
    expect(id).toBe('new-id');
    const [set] = opsOf('set');
    expect(set.path).toBe('courses/new-id');
    expect(set.data?.tenantId).toBe('harvest');
    expect(typeof set.data?.createdAt).toBe('string');
    expect(opsOf('update')).toHaveLength(0);
  });

  it('stamps an ordinary ministry tenant too', async () => {
    await saveCourse(course(), 'published');
    expect(opsOf('set')[0].data).toMatchObject({ tenantId: 'tenant-1', status: 'published' });
  });

  it('records the publish event only when publishing', async () => {
    await saveCourse(course(), 'draft');
    expect(track).not.toHaveBeenCalled();
    await saveCourse(course(), 'published');
    expect(track).toHaveBeenCalledTimes(1);
  });
});

describe('saveCourse: lesson content leaves the readable course document', () => {
  const secret = lesson('a', {
    body: '<p>SECRET BODY</p>', youtubeUrl: 'https://youtu.be/AAAAAAAAAAA', teacherNote: 'private note',
    attachments: [{ url: 'https://files.example/x.pdf' }],
    quiz: [{ id: 'q', q: '?', options: [{ id: 'o', text: 'x', correct: true }] }],
  });

  it('writes only the outline into the course doc and the content into lessonContent', async () => {
    await saveCourse(course({ levels: withLessons(secret) }), 'published');
    const courseDoc = JSON.stringify(opsOf('set')[0].data);
    for (const leak of ['SECRET BODY', 'youtu.be', 'private note', 'x.pdf', '"correct"']) {
      expect(courseDoc).not.toContain(leak);
    }
    expect(courseDoc).toContain('Lesson a');
    const content = opsOf('set').find((o) => o.path === 'courses/new-id/lessonContent/a');
    expect(content?.data).toMatchObject({ body: '<p>SECRET BODY</p>', teacherNote: 'private note' });
    expect(content?.data).not.toHaveProperty('title');
  });

  it('keeps the outline able to say a lesson has a quiz, with ids only', async () => {
    await saveCourse(course({ levels: withLessons(secret, lesson('b')) }), 'draft');
    const saved = opsOf('set')[0].data as { levels: Array<{ sections: Array<{ lessons: Array<Record<string, unknown>> }> }> };
    const [a, b] = saved.levels[0].sections[0].lessons;
    expect(a.quiz).toEqual([{ id: 'q' }]);
    expect(b).not.toHaveProperty('quiz');
  });

  it('deletes content of lessons that are no longer in the outline', async () => {
    fs.stored = { tenantId: 'tenant-1' };
    fs.existingContent = ['a', 'gone'];
    await saveCourse(course({ id: 'c1', levels: withLessons(secret) }), 'draft');
    expect(opsOf('delete').map((o) => o.path)).toEqual(['courses/c1/lessonContent/gone']);
  });

  it('never overwrites real content with an un-hydrated lesson that carries none', async () => {
    fs.stored = { tenantId: 'tenant-1' };
    fs.existingContent = ['a'];
    await saveCourse(course({ id: 'c1', levels: withLessons({ id: 'a', title: 'Lesson a', duration: '5', type: 'text' }) }), 'draft');
    expect(opsOf('set')).toEqual([]);
    expect(opsOf('delete')).toEqual([]);
  });

  it('refuses a course too large for one atomic save, writing nothing', async () => {
    const many = Array.from({ length: MAX_SAVE_WRITES }, (_, i) => lesson(`l${i}`));
    await expect(saveCourse(course({ levels: withLessons(...many) }), 'draft')).rejects.toThrow('too many lessons');
    expect(fs.commit).not.toHaveBeenCalled();
  });
});

describe('deleteCourse', () => {
  it('deletes lesson content before the course document', async () => {
    fs.existingContent = ['a', 'b'];
    await deleteCourse('c1');
    expect(fs.commit).toHaveBeenCalledTimes(2);
    expect(fs.ops.map((o) => o.path)).toEqual(['x/a', 'x/b', 'courses/c1']);
  });
});
