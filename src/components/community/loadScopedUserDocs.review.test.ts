import { describe, expect, it, vi } from 'vitest';
import { loadScopedUserDocs } from './loadScopedUserDocs';
const calls = vi.hoisted(() => ({ getDocs: vi.fn() }));
vi.mock('@/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  documentId: () => '__name__',
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: (field: string) => ({ order: field }),
  limit: (max: number) => ({ max }),
  query: (collection: string, ...constraints: unknown[]) => ({ collection, constraints }),
  getDocs: calls.getDocs,
}));
describe('scoped user picker', () => {
  it('filters each platform scope before its cap and merges the results', async () => {
    calls.getDocs.mockImplementation(async (q) => ({ docs: [{ id: String(q.constraints[0].value) }] }));
    const docs = await loadScopedUserDocs('harvest', true, 200);
    expect(docs.map(doc => doc.id)).toEqual(['harvest', 'null', '']);
    expect(calls.getDocs.mock.calls.map(([q]) => q.constraints)).toEqual(['harvest', null, ''].map(value => [
      { field: 'tenantId', op: '==', value }, { order: '__name__' }, { max: 200 },
    ]));
  });
});
