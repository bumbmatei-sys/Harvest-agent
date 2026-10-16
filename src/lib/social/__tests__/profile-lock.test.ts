import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, Record<string, unknown>>();

function applySet(path: string, data: Record<string, unknown>, merge?: boolean) {
  const prev = merge ? store.get(path) || {} : {};
  store.set(path, { ...prev, ...data });
}

function makeDocRef(path: string) {
  return {
    path,
    async get() {
      const data = store.get(path);
      return { exists: data !== undefined, data: () => data };
    },
    async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
      applySet(path, data, opts?.merge);
    },
  };
}

let txQueue: Promise<unknown> = Promise.resolve();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => ({ doc: (id: string) => makeDocRef(`${name}/${id}`) }),
    runTransaction: (fn: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      set: (ref: { path: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => void;
    }) => Promise<unknown>) => {
      const run = () => fn({
        async get(ref) {
          const data = store.get(ref.path);
          return { exists: data !== undefined, data: () => data };
        },
        set(ref, data, opts) {
          applySet(ref.path, data, opts?.merge);
        },
      });
      const result = txQueue.then(run, run);
      txQueue = result.then(() => undefined, () => undefined);
      return result;
    },
  },
}));

import { commitZernioProfile, reserveZernioProfile } from '../profile-lock';

describe('reserveZernioProfile', () => {
  beforeEach(() => {
    store.clear();
    txQueue = Promise.resolve();
  });

  it('lets only one of two concurrent first loads create a profile', async () => {
    const now = Date.UTC(2024, 5, 1);
    const [first, second] = await Promise.all([
      reserveZernioProfile('grace-chapel', now),
      reserveZernioProfile('grace-chapel', now),
    ]);
    const created = [first, second].filter((row) => row.status === 'create');
    const busy = [first, second].filter((row) => row.status === 'busy');
    expect(created).toHaveLength(1);
    expect(busy).toHaveLength(1);
    if (created[0]?.status !== 'create') return;
    expect(created[0].profileName).not.toContain('grace-chapel');
    expect(created[0].profileName).not.toContain('tenant');

    const stored = await commitZernioProfile('grace-chapel', created[0].claim, 'profile-from-provider');
    expect(stored).toBe('profile-from-provider');
    const again = await reserveZernioProfile('grace-chapel', now);
    expect(again).toEqual({ status: 'ready', profileId: 'profile-from-provider' });
    const doc = store.get('tenant_private/grace-chapel');
    expect(doc?.zernioProfileId).toBe('profile-from-provider');
    expect(JSON.stringify(doc)).not.toContain('grace-chapel');
  });
});
