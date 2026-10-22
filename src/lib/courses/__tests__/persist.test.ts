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

const fs = vi.hoisted(() => ({
  stored: null as null | Record<string, unknown>,
  updateDoc: vi.fn(async (..._args: unknown[]) => {}),
  addDoc: vi.fn(async (..._args: unknown[]) => ({ id: 'new-id' })),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async () => ({ exists: () => fs.stored !== null, data: () => fs.stored ?? {} }),
  updateDoc: fs.updateDoc,
  addDoc: fs.addDoc,
}));

import { saveCourse } from '../persist';

const course = (over: Partial<ProductCourse> = {}): ProductCourse =>
  ({ title: 'Prayer', description: '', category: '', thumbnail: '', featured: false, authorIds: [], levels: [], ...over }) as ProductCourse;

beforeEach(() => {
  scope.read = 'tenant-1';
  scope.write = 'tenant-1';
  fs.stored = null;
  fs.updateDoc.mockClear();
  fs.addDoc.mockClear();
  track.mockClear();
});

describe('saveCourse — editing', () => {
  it('refuses to save a course whose document belongs to another ministry, and never writes', async () => {
    fs.stored = { tenantId: 'tenant-OTHER' };
    await expect(saveCourse(course({ id: 'c1' }), 'draft')).rejects.toThrow('belongs to another ministry');
    expect(fs.updateDoc).not.toHaveBeenCalled();
    expect(fs.addDoc).not.toHaveBeenCalled();
  });

  it('updates a course that belongs to this ministry', async () => {
    fs.stored = { tenantId: 'tenant-1' };
    const id = await saveCourse(course({ id: 'c1', title: 'Renamed' }), 'draft');
    expect(id).toBe('c1');
    expect(fs.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = fs.updateDoc.mock.calls[0] as [{ __path: string }, Record<string, unknown>];
    expect(ref.__path).toBe('courses/c1');
    expect(payload).toMatchObject({ title: 'Renamed', status: 'draft' });
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('createdAt');
  });

  it('updates a legacy document that carries no tenantId', async () => {
    fs.stored = {};
    await saveCourse(course({ id: 'c1' }), 'draft');
    expect(fs.updateDoc).toHaveBeenCalledTimes(1);
  });

  it('skips the ownership check on the apex, where the read scope is null', async () => {
    scope.read = null;
    fs.stored = { tenantId: 'tenant-OTHER' };
    await saveCourse(course({ id: 'c1' }), 'draft');
    expect(fs.updateDoc).toHaveBeenCalledTimes(1);
  });

  it('propagates a failed write instead of swallowing it', async () => {
    fs.stored = { tenantId: 'tenant-1' };
    fs.updateDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(saveCourse(course({ id: 'c1' }), 'draft')).rejects.toThrow('permission-denied');
  });
});

describe('saveCourse — creating', () => {
  it('stamps the write-scope tenantId on the new document', async () => {
    scope.read = null;
    scope.write = 'harvest';
    const id = await saveCourse(course(), 'draft');
    expect(id).toBe('new-id');
    expect(fs.addDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = fs.addDoc.mock.calls[0] as [{ __path: string }, Record<string, unknown>];
    expect(ref.__path).toBe('courses');
    expect(payload.tenantId).toBe('harvest');
    expect(typeof payload.createdAt).toBe('string');
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });

  it('stamps an ordinary ministry tenant too', async () => {
    await saveCourse(course(), 'published');
    const payload = (fs.addDoc.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(payload).toMatchObject({ tenantId: 'tenant-1', status: 'published' });
  });

  it('records the publish event only when publishing', async () => {
    await saveCourse(course(), 'draft');
    expect(track).not.toHaveBeenCalled();
    await saveCourse(course(), 'published');
    expect(track).toHaveBeenCalledTimes(1);
  });
});
