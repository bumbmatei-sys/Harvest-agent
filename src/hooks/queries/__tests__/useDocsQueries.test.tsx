import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * THE-262 — the docs reads truncated silently, and kept an ARBITRARY set.
 *
 * `useDocs` ran `limit(300)` with no `orderBy`. Firestore answers an unordered
 * query in `__name__` order and the ids are random, so a church with 400 notes
 * got 300 arbitrary ones. `sortByTime(…, 'updatedAt', 'desc')` then sorted THAT
 * — producing a tidy, newest-first list with no hint that a quarter of the
 * church's notes were missing. Same shape for `useDocFolders` (200) and
 * `useSharedDocs` (50).
 *
 * Every fixture below is LARGER than the cap it retires. That is the whole
 * point of this file: a five-document fixture against a 300 cap passes whether
 * the bug is fixed or not, and this repo has been bitten by exactly that.
 *
 * The mock Firestore is deliberately faithful on the two behaviours that made
 * this bug invisible:
 *   - a query with no `orderBy` still comes back in `__name__` order, so
 *     reinstating a bare `limit(N)` really does return an arbitrary slice; and
 *   - `where(A) + orderBy(B)` for B other than `__name__` THROWS, because it
 *     needs a composite index this repo does not create (query-helpers.ts) and
 *     a missing one fails silently in production. Trading a silent truncation
 *     for a silent index failure would not be a fix, so the mock refuses it.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Row = Record<string, unknown> & { id: string };
type Constraint =
  | { __type: 'where'; field: string; op: string; value: unknown }
  | { __type: 'orderBy'; field: string }
  | { __type: 'startAfter'; cursor: { id: string } }
  | { __type: 'limit'; n: number };
type BuiltQuery = { collection: string; constraints: Constraint[] };

const { store, built, mockIsSuperAdminEmail, authState } = vi.hoisted(() => ({
  store: {} as Record<string, Array<Record<string, unknown> & { id: string }>>,
  built: [] as Array<{ collection: string; constraints: unknown[] }>,
  mockIsSuperAdminEmail: vi.fn(),
  authState: { currentUser: null as { uid: string; email: string } | null },
}));

vi.mock('../../../firebase', () => ({
  db: {},
  get auth() { return authState; },
}));

vi.mock('../../../utils/super-admins', () => ({
  isSuperAdminEmail: mockIsSuperAdminEmail,
  SUPER_ADMIN_EMAILS: ['super@theharvest.app'],
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  where: (field: string, op: string, value: unknown) => ({ __type: 'where', field, op, value }),
  orderBy: (field: string) => ({ __type: 'orderBy', field }),
  startAfter: (cursor: { id: string }) => ({ __type: 'startAfter', cursor }),
  limit: (n: number) => ({ __type: 'limit', n }),
  documentId: () => '__name__',
  getDoc: vi.fn(),
  doc: vi.fn(),
  query: (base: { __collection?: string } & Partial<BuiltQuery>, ...cs: Constraint[]) => {
    const q: BuiltQuery = {
      collection: (base.__collection ?? base.collection) as string,
      constraints: cs,
    };
    built.push(q);
    return q;
  },
  getDocs: vi.fn(async (q: BuiltQuery) => {
    let rows: Row[] = (store[q.collection] ?? []).slice();

    for (const c of q.constraints) {
      if (c.__type !== 'where') continue;
      if (c.op === '==') rows = rows.filter(r => r[c.field] === c.value);
      else if (c.op === 'array-contains') {
        rows = rows.filter(r => Array.isArray(r[c.field]) && (r[c.field] as unknown[]).includes(c.value));
      } else throw new Error(`mock: unsupported operator ${c.op}`);
    }

    const orderBys = q.constraints.filter((c): c is Extract<Constraint, { __type: 'orderBy' }> => c.__type === 'orderBy');
    const wheres = q.constraints.filter((c): c is Extract<Constraint, { __type: 'where' }> => c.__type === 'where');
    for (const ob of orderBys) {
      if (ob.field === '__name__') continue;
      // Firestore needs a composite index for where(A) + orderBy(B) when B is
      // not the document key. This repo creates none, and a missing one fails
      // silently in production — so it fails LOUDLY here instead.
      if (wheres.some(w => w.field !== ob.field)) {
        throw new Error(
          `mock: query on '${q.collection}' needs a composite index ` +
            `(where '${wheres.map(w => w.field).join("','")}' + orderBy '${ob.field}')`,
        );
      }
    }

    // Firestore's default order, with or without an explicit orderBy(__name__).
    rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const after = q.constraints.find((c): c is Extract<Constraint, { __type: 'startAfter' }> => c.__type === 'startAfter');
    if (after) {
      const i = rows.findIndex(r => r.id === after.cursor.id);
      rows = i === -1 ? [] : rows.slice(i + 1);
    }

    const lim = q.constraints.find((c): c is Extract<Constraint, { __type: 'limit' }> => c.__type === 'limit');
    if (lim) rows = rows.slice(0, lim.n);

    return {
      empty: rows.length === 0,
      docs: rows.map(({ id, ...data }) => ({ id, data: () => data })),
    };
  }),
}));

const mod = await import('../useDocsQueries');
const {
  useDocs, useDocFolders, useSharedDocs,
  DOCS_PAGE_SIZE, DOCS_FETCH_CEILING, NO_TENANT_SCOPE_MESSAGE,
} = mod;
const { clearTenantCache } = await import('../../../utils/tenant-scope');
const { getDocs } = await import('firebase/firestore');

// ─── Fixtures, every one LARGER than the cap it retires ──────────────────────

/** The caps this ticket removes. Fixtures are sized against these on purpose. */
const OLD_DOCS_CAP = 300;
const OLD_FOLDERS_CAP = 200;
const OLD_SHARED_CAP = 50;

/** 1,250 > the old 300 cap and > 2× DOCS_PAGE_SIZE, so completeness needs 3 pages. */
const DOC_COUNT = 1250;
/** 720 > the old 200 cap and > DOCS_PAGE_SIZE, so completeness needs 2 pages. */
const FOLDER_COUNT = 720;
/** 610 > the old 50 cap and > DOCS_PAGE_SIZE, so completeness needs 2 pages. */
const SHARED_COUNT = 610;

const UID = 'pastor-uid';

/**
 * `updatedAt` runs OPPOSITE to id order: the newest note has the LAST id, so it
 * lands on the final page. Any read that stops early loses the newest note —
 * and then sorts what it happened to get into a convincing newest-first list.
 */
const makeDocs = (n: number, tenantId = 'nations'): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `doc-${String(i).padStart(5, '0')}`,
    title: `Note ${i}`,
    tenantId,
    updatedAt: { toMillis: () => 1_000_000 + i },
    sharedWith: [] as string[],
  }));

/** `order` also runs opposite to id order: folder order 0 has the last id. */
const makeFolders = (n: number, tenantId = 'nations'): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `fld-${String(i).padStart(5, '0')}`,
    name: `Folder ${i}`,
    tenantId,
    order: n - 1 - i,
  }));

const makeShared = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `shr-${String(i).padStart(5, '0')}`,
    title: `Shared ${i}`,
    tenantId: 'nations',
    sharedWith: [UID],
    updatedAt: { toMillis: () => 2_000_000 + i },
  }));

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

async function renderHook<T>(useHook: () => T): Promise<{ current: T }> {
  const ref: { current: T } = { current: null as unknown as T };
  function Probe() { ref.current = useHook(); return null; }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return ref;
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await act(async () => { await new Promise(r => setTimeout(r, 2)); });
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function signInAs(kind: 'super' | 'tenant') {
  authState.currentUser = {
    uid: kind === 'super' ? 'super-uid' : UID,
    email: kind === 'super' ? 'super@theharvest.app' : 'pastor@nations.church',
  };
  mockIsSuperAdminEmail.mockImplementation((email?: string | null) => email === 'super@theharvest.app');
  clearTenantCache();
}

const queriesOn = (collection: string) => built.filter(q => q.collection === collection);

beforeEach(() => {
  vi.clearAllMocks();
  built.length = 0;
  for (const k of Object.keys(store)) delete store[k];
  authState.currentUser = null;
  signInAs('tenant');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

// ─── 1. A tenant with more notes than the cap loses none ─────────────────────

describe('useDocs — a tenant with more notes than the old cap', () => {
  beforeEach(() => { store.docs = makeDocs(DOC_COUNT); });

  it(`returns ALL ${DOC_COUNT} notes, not the old ${OLD_DOCS_CAP}`, async () => {
    expect(DOC_COUNT).toBeGreaterThan(OLD_DOCS_CAP);
    const res = await renderHook(() => useDocs('nations', true));
    await until(() => res.current.isSuccess, 'useDocs success');

    expect(res.current.data?.items).toHaveLength(DOC_COUNT);
    expect(res.current.data?.truncated).toBe(false);
  });

  it('loses no individual note — every id in the tenant comes back exactly once', async () => {
    const res = await renderHook(() => useDocs('nations', true));
    await until(() => res.current.isSuccess, 'useDocs success');

    const ids = res.current.data!.items.map(d => d.id);
    expect(new Set(ids).size).toBe(DOC_COUNT);
    expect(new Set(ids)).toEqual(new Set(store.docs.map(r => r.id)));
  });

  it('never returns another church\'s notes while paging', async () => {
    store.docs = [...makeDocs(DOC_COUNT), ...makeDocs(400, 'other-church').map(r => ({ ...r, id: `x-${r.id}` }))];
    const res = await renderHook(() => useDocs('nations', true));
    await until(() => res.current.isSuccess, 'useDocs success');

    expect(res.current.data!.items).toHaveLength(DOC_COUNT);
    expect(res.current.data!.items.every(d => d.tenantId === 'nations')).toBe(true);
  });
});

// ─── 2. The same for folders ─────────────────────────────────────────────────

describe('useDocFolders — a tenant with more folders than the old cap', () => {
  beforeEach(() => { store.docFolders = makeFolders(FOLDER_COUNT); });

  it(`returns ALL ${FOLDER_COUNT} folders, not the old ${OLD_FOLDERS_CAP}`, async () => {
    expect(FOLDER_COUNT).toBeGreaterThan(OLD_FOLDERS_CAP);
    const res = await renderHook(() => useDocFolders('nations', true));
    await until(() => res.current.isSuccess, 'useDocFolders success');

    expect(res.current.data?.items).toHaveLength(FOLDER_COUNT);
    expect(res.current.data?.truncated).toBe(false);
  });
});

// ─── 3. The same for shared docs ─────────────────────────────────────────────

describe('useSharedDocs — more shared notes than the old cap', () => {
  beforeEach(() => { store.docs = [...makeShared(SHARED_COUNT), ...makeDocs(200)]; });

  it(`returns ALL ${SHARED_COUNT} shared notes, not the old ${OLD_SHARED_CAP}`, async () => {
    expect(SHARED_COUNT).toBeGreaterThan(OLD_SHARED_CAP);
    const res = await renderHook(() => useSharedDocs(UID));
    await until(() => res.current.isSuccess, 'useSharedDocs success');

    expect(res.current.data?.items).toHaveLength(SHARED_COUNT);
    expect(res.current.data?.truncated).toBe(false);
    // The unshared notes in the same collection must not leak in.
    expect(res.current.data!.items.every(d => d.sharedWith.includes(UID))).toBe(true);
  });

  it('returns [] without querying when there is no uid', async () => {
    const res = await renderHook(() => useSharedDocs(null));
    expect(res.current.fetchStatus).toBe('idle');
    expect(getDocs).not.toHaveBeenCalled();
  });
});

// ─── 4. If any cap survives, the consumer can tell ───────────────────────────

describe('the surviving ceiling is VISIBLE, never silent', () => {
  it(`reports truncated:true when the read stops at DOCS_FETCH_CEILING (${DOCS_FETCH_CEILING})`, async () => {
    store.docs = makeDocs(DOCS_FETCH_CEILING + 600);
    const res = await renderHook(() => useDocs('nations', true));
    await until(() => res.current.isSuccess, 'useDocs success');

    expect(res.current.data?.items).toHaveLength(DOCS_FETCH_CEILING);
    // The whole ticket in one assertion: the list is short, and it SAYS so.
    expect(res.current.data?.truncated).toBe(true);
  });

  it('reports truncated:false when the set lands exactly on the ceiling — the flag is exact, not conservative', async () => {
    store.docs = makeDocs(DOCS_FETCH_CEILING);
    const res = await renderHook(() => useDocs('nations', true));
    await until(() => res.current.isSuccess, 'useDocs success');

    expect(res.current.data?.items).toHaveLength(DOCS_FETCH_CEILING);
    expect(res.current.data?.truncated).toBe(false);
  });

  it('reports truncated:false on a set that lands exactly on a page boundary', async () => {
    store.docs = makeDocs(DOCS_PAGE_SIZE * 2);
    const res = await renderHook(() => useDocs('nations', true));
    await until(() => res.current.isSuccess, 'useDocs success');

    expect(res.current.data?.items).toHaveLength(DOCS_PAGE_SIZE * 2);
    expect(res.current.data?.truncated).toBe(false);
  });
});

// ─── 5. Ordering is correct across the FULL set, not just within a page ──────

describe('ordering spans the whole set', () => {
  it('useDocs puts the genuinely newest note first, even though its id sorts LAST', async () => {
    store.docs = makeDocs(DOC_COUNT);
    const newest = store.docs[DOC_COUNT - 1];        // highest updatedAt, last page
    const oldest = store.docs[0];

    const res = await renderHook(() => useDocs('nations', true));
    await until(() => res.current.isSuccess, 'useDocs success');

    const items = res.current.data!.items;
    expect(items[0].id).toBe(newest.id);
    expect(items[items.length - 1].id).toBe(oldest.id);

    // Monotonically non-increasing by updatedAt across the ENTIRE result, which
    // a per-page sort of an arbitrary slice cannot produce.
    const millis = items.map(d => (d.updatedAt as unknown as { toMillis(): number }).toMillis());
    expect(millis).toEqual([...millis].sort((a, b) => b - a));
  });

  it('useDocFolders puts order:0 first, even though its id sorts LAST', async () => {
    store.docFolders = makeFolders(FOLDER_COUNT);
    const res = await renderHook(() => useDocFolders('nations', true));
    await until(() => res.current.isSuccess, 'useDocFolders success');

    const items = res.current.data!.items;
    expect(items[0].order).toBe(0);
    expect(items[0].id).toBe(`fld-${String(FOLDER_COUNT - 1).padStart(5, '0')}`);
    const orders = items.map(f => f.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

// ─── 6. The null-tenant branch, pinned to what it actually does ──────────────

describe('the null-tenant branch', () => {
  it('a genuine super admin still gets the unscoped platform-wide scan', async () => {
    signInAs('super');
    store.docs = [...makeDocs(600, 'nations'), ...makeDocs(600, 'harvest').map(r => ({ ...r, id: `h-${r.id}` }))];

    const res = await renderHook(() => useDocs(null, true));
    await until(() => res.current.isSuccess, 'useDocs success');

    // No tenantId filter — the branch is preserved, not refused.
    expect(queriesOn('docs')[0].constraints.some((c: any) => c.__type === 'where' && c.field === 'tenantId')).toBe(false);
    expect(res.current.data!.items).toHaveLength(1200);
  });

  it('a NON-super-admin with no tenant THROWS and issues no query — it no longer reads every church', async () => {
    signInAs('tenant');
    store.docs = makeDocs(DOC_COUNT);

    const res = await renderHook(() => useDocs(null, true));
    await until(() => res.current.isError, 'useDocs error');

    expect((res.current.error as Error).message).toBe(NO_TENANT_SCOPE_MESSAGE);
    expect(res.current.data).toBeUndefined();
    // The old code returned an arbitrary 300 documents drawn from every church.
    expect(queriesOn('docs')).toHaveLength(0);
    expect(getDocs).not.toHaveBeenCalled();
  });

  it('useDocFolders behaves identically for a non-super-admin with no tenant', async () => {
    signInAs('tenant');
    store.docFolders = makeFolders(FOLDER_COUNT);

    const res = await renderHook(() => useDocFolders(null, true));
    await until(() => res.current.isError, 'useDocFolders error');

    expect((res.current.error as Error).message).toBe(NO_TENANT_SCOPE_MESSAGE);
    expect(queriesOn('docFolders')).toHaveLength(0);
  });

  it('a super admin ON a tenant subdomain is scoped like any other admin', async () => {
    signInAs('super');
    store.docs = makeDocs(DOC_COUNT);

    const res = await renderHook(() => useDocs('nations', true));
    await until(() => res.current.isSuccess, 'useDocs success');

    expect(queriesOn('docs')[0].constraints).toContainEqual({ __type: 'where', field: 'tenantId', op: '==', value: 'nations' });
  });
});

// ─── 7. No-regression: queryKey, enabled, staleTime ──────────────────────────

describe('the React Query contract is unchanged', () => {
  it('keeps the queryKeys ["docs"|"docFolders"|"sharedDocs", …]', async () => {
    store.docs = makeDocs(10);
    store.docFolders = makeFolders(10);

    await renderHook(() => {
      useDocs('nations', true);
      useDocFolders('nations', true);
      useSharedDocs(UID);
      return null;
    });

    const keys = client.getQueryCache().getAll().map(q => q.queryKey);
    expect(keys).toContainEqual(['docs', 'nations']);
    expect(keys).toContainEqual(['docFolders', 'nations']);
    expect(keys).toContainEqual(['sharedDocs', UID]);
  });

  it('keeps staleTime at 5 minutes on every hook', async () => {
    store.docs = makeDocs(10);
    store.docFolders = makeFolders(10);

    await renderHook(() => {
      useDocs('nations', true);
      useDocFolders('nations', true);
      useSharedDocs(UID);
      return null;
    });

    const staleTimes = client.getQueryCache().getAll()
      .map(q => q.observers[0]?.options.staleTime);
    expect(staleTimes).toHaveLength(3);
    expect(staleTimes.every(t => t === 1000 * 60 * 5)).toBe(true);
  });

  it('stays idle until isAuthReady, so nothing reads before auth resolves', async () => {
    store.docs = makeDocs(10);
    const res = await renderHook(() => useDocs('nations', false));
    expect(res.current.fetchStatus).toBe('idle');
    expect(getDocs).not.toHaveBeenCalled();
  });
});

// ─── 8. No-regression: undefined vs null tenantId stay different ─────────────

describe('undefined and null tenantId are still different things', () => {
  it('undefined (tenant not resolved yet) stays IDLE — no query, no throw', async () => {
    store.docs = makeDocs(10);
    const res = await renderHook(() => useDocs(undefined, true));

    expect(res.current.fetchStatus).toBe('idle');
    expect(res.current.isError).toBe(false);
    expect(getDocs).not.toHaveBeenCalled();
  });

  it('null (resolved to no tenant) RUNS the query function — it does not stay idle', async () => {
    signInAs('tenant');
    store.docs = makeDocs(10);
    const res = await renderHook(() => useDocs(null, true));
    await until(() => res.current.isError, 'useDocs error');

    expect(res.current.fetchStatus).toBe('idle');
    expect(res.current.isError).toBe(true);
  });
});

// ─── 9. The fix needs no composite index — so no index and no rules change ───

describe('no query requires a composite index', () => {
  it('every issued query orders by __name__ only, so the automatic index serves it', async () => {
    store.docs = makeDocs(DOC_COUNT);
    store.docFolders = makeFolders(FOLDER_COUNT);

    const res = await renderHook(() => {
      const a = useDocs('nations', true);
      const b = useDocFolders('nations', true);
      const c = useSharedDocs(UID);
      return { a, b, c };
    });
    await until(() => res.current.a.isSuccess && res.current.b.isSuccess && res.current.c.isSuccess, 'all success');

    const orderBys = built.flatMap(q =>
      q.constraints.filter((c: any) => c.__type === 'orderBy').map((c: any) => c.field));
    expect(orderBys.length).toBeGreaterThan(0);
    expect([...new Set(orderBys)]).toEqual(['__name__']);
  });

  it('the mock would have thrown had the fix ordered by updatedAt alongside a tenant filter', async () => {
    store.docs = makeDocs(10);
    const { query, collection, where, orderBy, getDocs: gd } = await import('firebase/firestore');
    await expect(
      gd(query(collection({} as never, 'docs'), where('tenantId', '==', 'nations'), orderBy('updatedAt')) as never),
    ).rejects.toThrow(/composite index/);
  });
});
