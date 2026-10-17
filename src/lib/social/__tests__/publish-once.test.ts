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

  it('calls the provider once when the same key is published twice in this process', async () => {
    const create = vi.fn(async () => post('local-1'));
    const first = await oncePublish('tenant-a', 'key-1', false, create);
    const second = await oncePublish('tenant-a', 'key-1', false, create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(second?.id).toBe(first?.id);
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
