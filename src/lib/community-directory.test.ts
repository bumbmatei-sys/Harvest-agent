import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ profiles: new Map<string, Record<string, unknown>>(), members: new Map<string, Record<string, unknown>>(), fail: false }));
vi.mock('@/lib/firebase-admin', () => {
  const snap = (id: string, data: Record<string, unknown>) => ({ id, exists: true, data: () => data });
  const query = (path: string, filter?: unknown): any => ({
    collection: (name: string) => query(`${path}/${name}`),
    doc: (id: string) => ({
      collection: (name: string) => query(`${path}/${id}/${name}`),
      get: async () => h.profiles.has(id) ? snap(id, h.profiles.get(id)!) : { id, exists: false, data: () => undefined },
    }),
    where: (_field: string, _op: string, value: unknown) => query(path, value),
    get: async () => {
      if (h.fail) throw new Error('offline');
      return { docs: [...(path === 'users' ? h.profiles : h.members)].filter(([, data]) => path !== 'users' || data.tenantId === filter).map(([id, data]) => snap(id, data)) };
    },
  });
  return { adminDb: { collection: (path: string) => query(path) } };
});
import { communityPeople } from './community-membership-server';
beforeEach(() => { h.profiles.clear(); h.members.clear(); h.fail = false; });
describe('complete community directory union', () => {
  it('deduplicates active primary members, includes joined people and excludes left and foreign legacy entries', async () => {
    for (const [id, tenantId] of [['legacy', 'a'], ['left', 'a'], ['active', 'a'], ['joined', 'b'], ['outsider', 'b']]) h.profiles.set(id, { tenantId });
    for (const [id, status] of [['left', 'left'], ['active', 'active'], ['joined', 'active']]) h.members.set(id, { status });
    h.members.set('outsider', { rulesAcceptedVersion: 1 });
    expect((await communityPeople('a')).map(([uid]) => uid)).toEqual(['active', 'joined', 'legacy']);
  });
  it('does not silently drop a joined member with a missing profile', async () => {
    h.members.set('missing', { status: 'active' });
    await expect(communityPeople('a')).rejects.toThrow('profile missing');
  });
  it('fails visibly when a directory query fails', async () => {
    h.fail = true;
    await expect(communityPeople('a')).rejects.toThrow('offline');
  });
});
