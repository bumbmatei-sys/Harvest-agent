import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ uid: 'member-1' as string | null, userDoc: null as Record<string, unknown> | null }));
vi.mock('../../firebase', () => ({
  db: {},
  auth: { get currentUser() { return session.uid ? { uid: session.uid } : null; } },
}));
vi.mock('../tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
}));

const data = vi.hoisted(() => ({ courses: [] as any[], userReads: 0 }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: any) => ({ __path: col?.__path }),
  where: () => ({}),
  limit: () => ({}),
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async (ref: any) => {
    if (ref.__path.startsWith('users/')) data.userReads += 1;
    return { exists: () => session.userDoc !== null, data: () => session.userDoc ?? {} };
  },
  getDocs: async (ref: any) => {
    const rows = ref?.__path === 'courses' ? data.courses : [];
    const docs = rows.map((r: any) => ({ id: r.id, data: () => r }));
    return { docs, forEach: (fn: (d: any) => void) => docs.forEach(fn) };
  },
}));

import { fetchMemberCourses, hasMemberVisibleCourses } from '../member-courses';

const course = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: id, status: 'published', levels: [], createdAt: '2026-01-01T00:00:00.000Z', ...over,
});
const ids = async (communities?: string[]) => (await fetchMemberCourses(communities)).map((c) => c.id).sort();

beforeEach(() => {
  session.uid = 'member-1';
  session.userDoc = null;
  data.courses = [];
  data.userReads = 0;
});

describe('member course list honours the access model', () => {
  it('drops a restricted course the member is not entitled to and keeps open ones', async () => {
    data.courses = [
      course('legacy'),
      course('everyone', { accessMode: 'everyone' }),
      course('hidden', { accessMode: 'restricted', accessUserIds: ['someone-else'] }),
    ];
    expect(await ids()).toEqual(['everyone', 'legacy']);
  });

  it('treats an unknown accessMode as restricted', async () => {
    data.courses = [course('odd', { accessMode: 'private', accessUserIds: ['someone-else'] })];
    expect(await ids()).toEqual([]);
  });

  it('keeps a restricted course for a member on the access list', async () => {
    data.courses = [course('mine', { accessMode: 'restricted', accessUserIds: ['member-1'] })];
    expect(await ids()).toEqual(['mine']);
  });

  it('keeps a restricted course for a member of an attached community', async () => {
    data.courses = [course('comm', { accessMode: 'restricted', communityIds: ['c-1'] })];
    expect(await ids()).toEqual([]);
    expect(await ids(['c-1'])).toEqual(['comm']);
  });

  it('keeps every restricted course for staff', async () => {
    session.userDoc = { role: 'admin' };
    data.courses = [course('hidden', { accessMode: 'restricted', accessUserIds: ['someone-else'] })];
    expect(await ids()).toEqual(['hidden']);
  });

  it('does not treat a plain member as staff', async () => {
    session.userDoc = { role: 'member' };
    data.courses = [course('hidden', { accessMode: 'restricted', accessUserIds: ['someone-else'] })];
    expect(await ids()).toEqual([]);
  });

  it('shows nothing restricted to a signed-out visitor', async () => {
    session.uid = null;
    data.courses = [course('hidden', { accessMode: 'restricted', accessUserIds: ['member-1'] })];
    expect(await ids()).toEqual([]);
  });

  it('reads the user document only when a restricted course is present', async () => {
    data.courses = [course('legacy')];
    await fetchMemberCourses();
    expect(data.userReads).toBe(0);
    data.courses = [course('hidden', { accessMode: 'restricted' })];
    await fetchMemberCourses();
    expect(data.userReads).toBe(1);
  });
});

describe('the Courses tab gate agrees with the list', () => {
  it('is false when the only course is a restricted one the member cannot open', async () => {
    data.courses = [course('hidden', { accessMode: 'restricted', accessUserIds: ['someone-else'] })];
    expect(await hasMemberVisibleCourses()).toBe(false);
  });

  it('is true once the member is on the list', async () => {
    data.courses = [course('mine', { accessMode: 'restricted', accessUserIds: ['member-1'] })];
    expect(await hasMemberVisibleCourses()).toBe(true);
  });
});
