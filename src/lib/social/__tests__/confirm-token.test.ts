import { beforeEach, describe, expect, it, vi } from 'vitest';

const tokens = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({
      doc: (id: string) => ({
        get: async () => {
          const data = tokens.get(id);
          return { exists: data !== undefined, data: () => data };
        },
        set: async (data: Record<string, unknown>) => {
          tokens.set(id, { ...data });
        },
        update: async (patch: Record<string, unknown>) => {
          const current = tokens.get(id);
          if (!current) return;
          tokens.set(id, { ...current, ...patch });
        },
      }),
    }),
    runTransaction: async (fn: (tx: {
      get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>;
      update: (ref: { update: (patch: Record<string, unknown>) => Promise<void> }, patch: Record<string, unknown>) => Promise<void>;
    }) => Promise<unknown>) => fn({
      get: (ref) => ref.get(),
      update: (ref, patch) => ref.update(patch),
    }),
  },
}));

import { consumeConfirmToken, issueConfirmToken } from '../confirm-token';

const edit = {
  action: 'update' as const,
  tenantId: 'tenant-a',
  uid: 'admin-1',
  postId: 'sample-draft',
  draftHash: 'same-draft',
};

describe('confirm token action binding', () => {
  beforeEach(() => {
    tokens.clear();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VERCEL_ENV', '');
  });

  it('rejects an edit token spent as a cancel', async () => {
    const token = await issueConfirmToken(edit);
    expect(typeof token).toBe('string');
    const spent = await consumeConfirmToken(token as string, { ...edit, action: 'cancel' });
    expect(spent).toBe('mismatch');
    const stillThere = await consumeConfirmToken(token as string, edit);
    expect(stillThere).toBe('ok');
  });
});
