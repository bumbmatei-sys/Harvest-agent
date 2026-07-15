import { vi } from 'vitest';

export const mockVerifyIdToken = vi.fn();
export const mockGetUser = vi.fn();
export const mockSetCustomUserClaims = vi.fn();
export const mockDeleteUser = vi.fn();
export const mockDeleteUsers = vi.fn(async (uids: string[]) => ({
  successCount: uids.length,
  failureCount: 0,
  errors: [] as { index: number; error: { code?: string; message?: string } }[],
}));
export const mockGetDoc = vi.fn();
export const mockUpdate = vi.fn();
export const mockDelete = vi.fn();
export const mockRecursiveDelete = vi.fn();
export const mockAdd = vi.fn().mockResolvedValue({ id: 'new-doc-id' });
export const mockCollectionGet = vi.fn().mockResolvedValue({ docs: [], empty: true, forEach: vi.fn() });
export const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

// ─── Per-collection doc store (opt-in) ───────────────────────────────────────
// The cross-collection tenant-deletion cascade queries and deletes many separate
// top-level collections, so tests need per-collection control (which the single
// shared `mockCollectionGet` can't give). Register docs with
// __setCollectionDocs('courses', [{ tenantId: 't1' }, ...]); queries then
// page/delete against that store, and batch/recursiveDelete remove from it so the
// paginated re-query loops terminate. Collections with NO registered store fall
// back to `mockCollectionGet` (default: empty), keeping existing tests unchanged.
type StoreDoc = { id: string; data: Record<string, unknown> };
const store = new Map<string, StoreDoc[]>();

export function __setCollectionDocs(name: string, docs: Array<Record<string, unknown>>): void {
  store.set(
    name,
    docs.map((d, i) => ({ id: (d.id as string) ?? `${name}-${i}`, data: d })),
  );
}
export function __resetStore(): void {
  store.clear();
}

function spliceFromStore(ref: { __collection?: string; id?: string } | undefined): void {
  if (!ref?.__collection) return;
  const arr = store.get(ref.__collection);
  if (!arr) return;
  const idx = arr.findIndex((d) => d.id === ref.id);
  if (idx >= 0) arr.splice(idx, 1);
}

function docSnap(name: string, d: StoreDoc) {
  return {
    id: d.id,
    data: () => d.data,
    ref: { __collection: name, id: d.id },
  };
}

const mockDocRef = () => ({
  get: mockGetDoc,
  set: vi.fn(),
  update: mockUpdate,
  delete: mockDelete,
});

function makeQuery(name: string) {
  let pageLimit = Infinity;
  const q: Record<string, unknown> = {
    where: vi.fn(() => q),
    orderBy: vi.fn(() => q),
    startAfter: vi.fn(() => q),
    limit: vi.fn((n: number) => {
      pageLimit = n;
      return q;
    }),
    count: vi.fn(() => ({
      get: vi.fn(async () => ({ data: () => ({ count: (store.get(name) || []).length }) })),
    })),
    get: vi.fn(async () => {
      if (!store.has(name)) return mockCollectionGet();
      const all = store.get(name)!;
      const page = all.slice(0, pageLimit === Infinity ? all.length : pageLimit);
      const docs = page.map((d) => docSnap(name, d));
      return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: (d: unknown) => void) => docs.forEach(fn) };
    }),
    doc: vi.fn(() => mockDocRef()),
    add: mockAdd,
  };
  return q;
}

function makeBatch() {
  const pending: Array<{ __collection?: string; id?: string }> = [];
  return {
    delete: vi.fn((ref: { __collection?: string; id?: string }) => {
      pending.push(ref);
    }),
    commit: vi.fn(async () => {
      pending.forEach(spliceFromStore);
      pending.length = 0;
      return mockBatchCommit();
    }),
  };
}

// recursiveDelete removes the doc from the store too, so the paginated recursive
// delete loop terminates. Tests that need it to throw can override with
// mockRecursiveDelete.mockRejectedValue(...); call __applyDefaultImpls() (e.g. in
// beforeEach) to restore the store-splicing default afterwards.
export function __applyDefaultImpls(): void {
  mockRecursiveDelete.mockImplementation(async (ref: { __collection?: string; id?: string }) => {
    spliceFromStore(ref);
    return undefined;
  });
  mockDeleteUsers.mockImplementation(async (uids: string[]) => ({
    successCount: uids.length,
    failureCount: 0,
    errors: [] as { index: number; error: { code?: string; message?: string } }[],
  }));
}
__applyDefaultImpls();

vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: {
    verifyIdToken: mockVerifyIdToken,
    getUser: mockGetUser,
    setCustomUserClaims: mockSetCustomUserClaims,
    deleteUser: mockDeleteUser,
    deleteUsers: mockDeleteUsers,
  },
  adminDb: {
    collection: vi.fn((name: string) => makeQuery(name)),
    batch: vi.fn(() => makeBatch()),
    recursiveDelete: mockRecursiveDelete,
  },
}));
