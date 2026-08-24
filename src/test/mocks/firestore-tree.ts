import { vi } from 'vitest';

/**
 * A tree-shaped Firestore Admin fake, for the deletion routes.
 *
 * The existing `src/test/mocks/firebase-admin.ts` models ONE flat level of
 * top-level collections, which is all the tenant cascade needed. Erasing a
 * member reaches three levels down — `tenants/{t}/checkinSessions/{s}/attendees`,
 * `tenants/{t}/forms/{f}/submissions` — and needs collection-group queries,
 * array-contains, per-doc updates and `FieldValue.arrayRemove`. So this fake
 * stores documents by full path and resolves queries against that tree.
 *
 * It is a FAKE, not a spy rig: assertions read the resulting document store, so
 * a test says "this collection is empty afterwards" rather than "delete was
 * called with these arguments". That is what makes a skipped collection fail the
 * test named for it.
 *
 * Every `where(...)` is recorded in {@link recordedWheres} so one test can assert
 * the property that matters most — that no delete-path query was ever built with
 * a null, undefined or empty scope value.
 */

export interface WhereCall {
  /** Collection path the query was built on ('' for a collection group). */
  path: string;
  /** Collection-group id, when this was a collectionGroup query. */
  group?: string;
  field: string;
  op: string;
  value: unknown;
}

/** Every `where()` the code under test built, in order. */
export const recordedWheres: WhereCall[] = [];

/** One `get()` against the store — the page bound it asked for, and from where. */
export interface ReadCall {
  /** Collection path the read was built on ('' for a collection group). */
  path: string;
  /** Collection-group id, when this was a collectionGroup query. */
  group?: string;
  /** The `limit()` in force. `Infinity` means the caller set none — an UNBOUNDED read. */
  limit: number;
  /** The `startAfter()` cursor doc id, or null on a first page. */
  after: string | null;
  /** How many documents came back. */
  returned: number;
}

/**
 * Every read the code under test performed, in order.
 *
 * Recorded so a test can prove a large collection was PAGED rather than pulled
 * in one `get()` — an export is a read path, so the write-batch cap that pins
 * the deletion side says nothing about it. An entry with `limit: Infinity` is an
 * unbounded read; a paged run shows repeated bounded reads with a moving
 * `after`.
 */
export const recordedReads: ReadCall[] = [];

type Data = Record<string, unknown>;

/** path → { docId → data }. Path is the parent collection, e.g. `tenants/t1/invoices`. */
const store = new Map<string, Map<string, Data>>();

export function __reset(): void {
  store.clear();
  recordedWheres.length = 0;
  recordedReads.length = 0;
  deletedObjects.length = 0;
  storageShouldThrow.value = false;
}

/** Seed a collection at an absolute path. Ids default to `<leaf>-<n>`. */
export function __seed(path: string, docs: Array<Data & { id?: string }>): void {
  const leaf = path.split('/').pop() || 'doc';
  const m = store.get(path) ?? new Map<string, Data>();
  docs.forEach((d, i) => {
    const { id, ...rest } = d;
    m.set((id as string) ?? `${leaf}-${i}`, { ...rest });
  });
  store.set(path, m);
}

/** Read a collection back as `[id, data]` pairs — how assertions inspect state. */
export function __docs(path: string): Array<[string, Data]> {
  return [...(store.get(path) ?? new Map<string, Data>()).entries()];
}

export function __count(path: string): number {
  return store.get(path)?.size ?? 0;
}

export function __doc(path: string, id: string): Data | undefined {
  return store.get(path)?.get(id);
}

// ── Sentinels, matching firebase-admin's FieldValue ───────────────────────────

const ARRAY_REMOVE = Symbol('arrayRemove');
const INCREMENT = Symbol('increment');

export const FieldValue = {
  arrayRemove: (...items: unknown[]) => ({ [ARRAY_REMOVE]: items }),
  arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }),
  increment: (n: number) => ({ [INCREMENT]: n }),
  serverTimestamp: () => 'server-ts',
};

const isArrayRemove = (v: unknown): v is { [ARRAY_REMOVE]: unknown[] } =>
  typeof v === 'object' && v !== null && ARRAY_REMOVE in (v as object);

/** Apply an update patch, honouring dotted field paths and arrayRemove. */
function applyPatch(target: Data, patch: Data): void {
  for (const [key, value] of Object.entries(patch)) {
    const segments = key.split('.');
    let cursor: Data = target;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const next = cursor[segments[i]];
      if (typeof next !== 'object' || next === null) cursor[segments[i]] = {};
      cursor = cursor[segments[i]] as Data;
    }
    const leaf = segments[segments.length - 1];
    if (isArrayRemove(value)) {
      const current = Array.isArray(cursor[leaf]) ? (cursor[leaf] as unknown[]) : [];
      const drop = value[ARRAY_REMOVE];
      cursor[leaf] = current.filter(
        (item) => !drop.some((d) => JSON.stringify(d) === JSON.stringify(item)),
      );
    } else {
      cursor[leaf] = value;
    }
  }
}

// ── Query resolution ─────────────────────────────────────────────────────────

interface Filter { field: string; op: string; value: unknown }

function readField(data: Data, field: string): unknown {
  return field.split('.').reduce<unknown>(
    (acc, seg) => (typeof acc === 'object' && acc !== null ? (acc as Data)[seg] : undefined),
    data,
  );
}

function matches(data: Data, filters: Filter[]): boolean {
  return filters.every((f) => {
    const actual = readField(data, f.field);
    if (f.op === 'array-contains') return Array.isArray(actual) && actual.includes(f.value);
    return actual === f.value;
  });
}

/** Collect `[path, id, data]` for a concrete path, or across a collection group. */
function candidates(path: string | null, group: string | null): Array<[string, string, Data]> {
  const out: Array<[string, string, Data]> = [];
  for (const [p, docs] of store.entries()) {
    if (path !== null && p !== path) continue;
    if (group !== null && p.split('/').pop() !== group) continue;
    for (const [id, data] of docs.entries()) out.push([p, id, data]);
  }
  return out;
}

function snapshotFor(rows: Array<[string, string, Data]>) {
  const docs = rows.map(([p, id, data]) => ({
    id,
    data: () => data,
    ref: makeDocRef(p, id),
  }));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (fn: (d: unknown) => void) => docs.forEach(fn),
  };
}

function makeQuery(path: string | null, group: string | null, filters: Filter[], cap: number, after: string | null) {
  const self = {
    where(field: string, op: string, value: unknown) {
      recordedWheres.push({ path: path ?? '', ...(group ? { group } : {}), field, op, value });
      return makeQuery(path, group, [...filters, { field, op, value }], cap, after);
    },
    orderBy: () => self,
    limit: (n: number) => makeQuery(path, group, filters, n, after),
    startAfter: (cursor: { id?: string } | string) =>
      makeQuery(path, group, filters, cap, typeof cursor === 'string' ? cursor : cursor?.id ?? null),
    count: () => ({
      get: async () => ({ data: () => ({ count: candidates(path, group).filter(([, , d]) => matches(d, filters)).length }) }),
    }),
    async get() {
      let rows = candidates(path, group).filter(([, , d]) => matches(d, filters));
      if (after !== null) {
        const idx = rows.findIndex(([, id]) => id === after);
        rows = idx >= 0 ? rows.slice(idx + 1) : rows;
      }
      const page = rows.slice(0, cap);
      recordedReads.push({
        path: path ?? '',
        ...(group ? { group } : {}),
        limit: cap,
        after,
        returned: page.length,
      });
      return snapshotFor(page);
    },
  };
  return self;
}

function makeDocRef(parentPath: string, id: string) {
  const self = {
    id,
    path: `${parentPath}/${id}`,
    collection: (name: string) => makeCollection(`${parentPath}/${id}/${name}`),
    async get() {
      const data = store.get(parentPath)?.get(id);
      return { id, exists: data !== undefined, data: () => data, ref: self };
    },
    async delete() {
      store.get(parentPath)?.delete(id);
    },
    async set(data: Data, opts?: { merge?: boolean }) {
      const m = store.get(parentPath) ?? new Map<string, Data>();
      m.set(id, opts?.merge ? { ...(m.get(id) ?? {}), ...data } : { ...data });
      store.set(parentPath, m);
    },
    async update(patch: Data) {
      const existing = store.get(parentPath)?.get(id);
      if (!existing) throw new Error(`NOT_FOUND: no document to update at ${parentPath}/${id}`);
      applyPatch(existing, patch);
    },
  };
  return self;
}

function makeCollection(path: string) {
  const base = makeQuery(path, null, [], Infinity, null);
  return Object.assign({}, base, {
    doc: (id?: string) => makeDocRef(path, id ?? `auto-${Math.random().toString(36).slice(2)}`),
    async add(data: Data) {
      const id = `auto-${(store.get(path)?.size ?? 0) + 1}`;
      const m = store.get(path) ?? new Map<string, Data>();
      m.set(id, { ...data });
      store.set(path, m);
      return makeDocRef(path, id);
    },
  });
}

// ── Batches ──────────────────────────────────────────────────────────────────

/** Set to have the NEXT commit reject — the partial-failure lever. */
export const commitShouldThrow: { on: string | null } = { on: null };
export const mockBatchCommit = vi.fn();

function makeBatch() {
  const ops: Array<() => void> = [];
  let touched: string[] = [];
  return {
    delete(ref: { path: string }) {
      touched.push(ref.path);
      ops.push(() => {
        const [id, ...rest] = ref.path.split('/').reverse();
        store.get(rest.reverse().join('/'))?.delete(id);
      });
    },
    update(ref: { path: string }, patch: Data) {
      touched.push(ref.path);
      ops.push(() => {
        const [id, ...rest] = ref.path.split('/').reverse();
        const existing = store.get(rest.reverse().join('/'))?.get(id);
        if (existing) applyPatch(existing, patch);
      });
    },
    async commit() {
      mockBatchCommit(ops.length);
      // Firestore rejects a batch over 500 operations outright — modelled so a
      // test can prove the code chunks rather than trusting that it does.
      if (ops.length > 500) throw new Error('maximum 500 writes allowed per request');
      if (commitShouldThrow.on && touched.some((p) => p.includes(commitShouldThrow.on!))) {
        commitShouldThrow.on = null;
        throw new Error('batch commit failed');
      }
      ops.forEach((op) => op());
      ops.length = 0;
      touched = [];
    },
  };
}

// ── Storage (the certificate PDFs) ───────────────────────────────────────────

/** Object paths deleted from the receipts bucket, in order. */
export const deletedObjects: string[] = [];
export const storageShouldThrow = { value: false };

export const getReceiptsBucket = vi.fn(() => ({
  file: (path: string) => ({
    async delete() {
      if (storageShouldThrow.value) throw new Error('storage unavailable');
      deletedObjects.push(path);
    },
  }),
}));

// ── The exported doubles ─────────────────────────────────────────────────────

export const mockRecursiveDelete = vi.fn(async (ref: { path: string }) => {
  // Removes the doc AND every collection nested beneath it — which is the whole
  // reason the route uses it for posts (their comments are a subcollection).
  const [id, ...rest] = ref.path.split('/').reverse();
  store.get(rest.reverse().join('/'))?.delete(id);
  for (const p of [...store.keys()]) {
    if (p.startsWith(`${ref.path}/`)) store.delete(p);
  }
});

export const adminDb = {
  collection: (name: string) => makeCollection(name),
  collectionGroup: (name: string) => makeQuery(null, name, [], Infinity, null),
  batch: () => makeBatch(),
  recursiveDelete: mockRecursiveDelete,
};

export const mockVerifyIdToken = vi.fn();
export const mockDeleteUser = vi.fn();
export const mockGetUser = vi.fn();
export const mockDeleteUsers = vi.fn(async (uids: string[]) => ({
  successCount: uids.length,
  failureCount: 0,
  errors: [] as { index: number; error: { message?: string } }[],
}));

export const adminAuth = {
  verifyIdToken: mockVerifyIdToken,
  getUser: mockGetUser,
  deleteUser: mockDeleteUser,
  deleteUsers: mockDeleteUsers,
  setCustomUserClaims: vi.fn(),
};
