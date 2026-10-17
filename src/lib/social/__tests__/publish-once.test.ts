import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({
      doc: (id: string) => ({
        id,
        set: async (data: Record<string, unknown>) => {
          store.docs.set(id, { ...(store.docs.get(id) || {}), ...data });
        },
      }),
    }),
    runTransaction: async (fn: (tx: {
      get: (ref: { id: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
      set: (ref: { id: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
    }) => Promise<unknown>) => {
      const pending = new Map<string, Record<string, unknown>>();
      const result = await fn({
        get: async (ref) => {
          const data = store.docs.get(ref.id);
          return { exists: data !== undefined, data: () => data || {} };
        },
        set: (ref, data) => {
          pending.set(ref.id, { ...(store.docs.get(ref.id) || {}), ...data });
        },
      });
      for (const [id, data] of pending) store.docs.set(id, data);
      return result;
    },
  },
}));

import { oncePublish, resetPublishOnce } from '../publish-once';
import type { SocialPost } from '../types';

function post(id: string): SocialPost {
  return {
    id,
    content: 'Sunday at 10.',
    status: 'sent',
    scheduledFor: null,
    timezone: 'UTC',
    targets: [],
    media: [],
  };
}

describe('publish-once replay guard', () => {
  beforeEach(() => {
    resetPublishOnce();
    store.docs.clear();
  });

  it('clears the mock in-flight promise when create throws so the retry can create', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(post('local-2'));
    await expect(oncePublish('tenant-a', 'key-1', false, create)).rejects.toThrow('provider down');
    const second = await oncePublish('tenant-a', 'key-1', false, create);
    expect(create).toHaveBeenCalledTimes(2);
    expect(second?.id).toBe('local-2');
  });

  it('calls the provider once when the same key is published twice in this process', async () => {
    const create = vi.fn(async () => post('local-1'));
    const first = await oncePublish('tenant-a', 'key-1', false, create);
    const second = await oncePublish('tenant-a', 'key-1', false, create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(second?.id).toBe(first?.id);
  });

  it('recovers a pending key after the publish crashes or the claim goes stale', async () => {
    const create = vi.fn(async () => post('live-1'));
    store.docs.set('tenant-a_key-1', { pending: true, pendingAt: Date.now() });
    const blocked = await oncePublish('tenant-a', 'key-1', true, create);
    expect(blocked).toBeNull();
    expect(create).not.toHaveBeenCalled();

    store.docs.set('tenant-a_key-1', { pending: true, pendingAt: Date.now() - 3 * 60 * 1000 });
    const recovered = await oncePublish('tenant-a', 'key-1', true, create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(recovered?.id).toBe('live-1');

    store.docs.clear();
    const crashing = vi.fn(async () => {
      throw new Error('provider down');
    });
    const failed = await oncePublish('tenant-a', 'key-2', true, crashing);
    expect(failed).toBeNull();
    expect(store.docs.get('tenant-a_key-2')?.pending).toBe(false);
    const retry = vi.fn(async () => post('live-2'));
    const again = await oncePublish('tenant-a', 'key-2', true, retry);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(again?.id).toBe('live-2');
  });

  it('replays the stored post instead of creating again when the key is already published', async () => {
    let n = 0;
    const create = vi.fn(async () => post(`live-${++n}`));
    const first = await oncePublish('tenant-a', 'key-1', true, create);
    const second = await oncePublish('tenant-a', 'key-1', true, create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});
