import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { usePostComments } from './usePostComments';

const calls = vi.hoisted(() => ({ queries: [] as any[], callbacks: [] as any[], count: vi.fn() }));
vi.mock('@/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  orderBy: (field: string, direction: string) => ({ field, direction }),
  limit: (n: number) => ({ limit: n }),
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  getCountFromServer: calls.count,
  onSnapshot: (q: unknown, next: unknown, error: unknown) => { calls.queries.push(q); calls.callbacks.push({ next, error }); return () => {}; },
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('post comment subscriptions', () => {
  it('loads bounded summaries for visible posts and full comments only on expansion', async () => {
    calls.queries.length = 0; calls.callbacks.length = 0;
    calls.count.mockResolvedValue({ data: () => ({ count: 12 }) });
    let result: ReturnType<typeof usePostComments>;
    function Probe({ open }: { open: boolean }) {
      result = usePostComments(['visible'], { visible: open });
      return null;
    }
    const node = document.createElement('div');
    const root = createRoot(node);
    await act(async () => { root.render(<Probe open={false} />); });
    expect(calls.queries).toEqual([{ path: 'community_posts/visible/comments', constraints: [{ field: 'createdAt', direction: 'desc' }, { limit: 1 }] }]);
    await act(async () => { calls.callbacks[0].next({ docs: [{ id: 'c', data: () => ({ authorId: 'a', createdAt: '2040-01-01' }) }] }); });
    expect(result!.counts.visible).toBe(12);
    expect(result!.latest.visible?.id).toBe('c');
    await act(async () => { root.render(<Probe open />); });
    expect(calls.queries).toHaveLength(2);
    expect(calls.queries[1].constraints).toEqual([{ field: 'createdAt', direction: 'asc' }]);
    await act(async () => { calls.callbacks[1].error(new Error('denied')); });
    expect(result!.errors.visible).toBe(true);
    await act(async () => { root.unmount(); });
  });
});
