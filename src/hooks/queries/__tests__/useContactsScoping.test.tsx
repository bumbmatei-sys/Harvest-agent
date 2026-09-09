import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Tenant scoping for the CRM contacts read.
 *
 * The bug this guards (THE-44): AdminCRM resolved its tenant WITHOUT reading
 * `isSuperAdmin`, so `tenantId` arrived null both for a super admin on the apex
 * domain — for whom the unscoped platform scan is correct — and for a tenant
 * admin whose tenant never resolved, for whom that same scan is a guaranteed
 * permission-denied. The `contacts` rule gates reads on
 * `isTenantAdmin(resource.data.tenantId)`, and rules are not filters: a query
 * constraining nothing about `resource.data` is rejected WHOLESALE. AdminCRM's
 * `data: contacts = []` then rendered that rejection as "this church has no
 * contacts" — the same lie the empty activity timeline told for weeks (#236).
 *
 * The contract now: the unscoped scan is reachable ONLY by a genuine super
 * admin; every real tenant gets the scoped query; and a caller with neither is
 * a FAULT that throws, never an empty list.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockGetDocs, mockIsSuperAdminEmail, authState } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockIsSuperAdminEmail: vi.fn(),
  authState: { currentUser: null as { uid: string; email: string } | null },
}));

/**
 * Record every query built, so a test can assert not just what came back but
 * WHICH query ran — "never issues the unscoped query" is the point of this file.
 */
// THE-342 added `orderBy(documentId())` to every read here: an unordered
// limit(N) is served in `__name__` order over random ids, so the window was an
// arbitrary and unstable N. The built query records the ordering so a test can
// assert it rather than merely tolerate it.
type BuiltQuery = {
  collection: string;
  whereClauses: Array<[string, string, unknown]>;
  limit: number | null;
  orderBy: string | null;
};
const built: BuiltQuery[] = [];

vi.mock('../../../firebase', () => ({
  db: {},
  get auth() { return authState; },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  where: (field: string, op: string, value: unknown) => ({ __where: [field, op, value] as [string, string, unknown] }),
  limit: (n: number) => ({ __limit: n }),
  orderBy: (field: unknown) => ({ __orderBy: field }),
  documentId: () => '__name__',
  // getTenantScope() falls back to the signed-in user's own doc for a non-super
  // admin; answer it so the members query is scoped the way it is in the app.
  getDoc: vi.fn(async () => ({ exists: () => true, data: () => ({ tenantId: 'harvest' }) })),
  doc: vi.fn(),
  query: (base: { __collection: string }, ...constraints: Array<Record<string, unknown>>) => {
    const q: BuiltQuery = {
      collection: base.__collection,
      whereClauses: constraints.filter(c => '__where' in c).map(c => c.__where as [string, string, unknown]),
      limit: (constraints.find(c => '__limit' in c)?.__limit as number) ?? null,
      orderBy: (constraints.find(c => '__orderBy' in c)?.__orderBy as string) ?? null,
    };
    built.push(q);
    return q;
  },
  getDocs: mockGetDocs,
}));

vi.mock('../../../utils/super-admins', () => ({
  isSuperAdminEmail: mockIsSuperAdminEmail,
  SUPER_ADMIN_EMAILS: ['super@theharvest.app'],
}));

const { useContacts, useContactsWithUsers, NO_TENANT_SCOPE_MESSAGE } = await import('../useCRMQueries');
const { clearTenantCache } = await import('../../../utils/tenant-scope');

/** A Firestore-shaped snapshot from plain rows. */
const snap = (rows: Array<Record<string, unknown> & { id: string }>) => ({
  docs: rows.map(({ id, ...data }) => ({ id, data: () => data })),
});

/** The `contacts` queries that were actually issued. */
const contactQueries = () => built.filter(q => q.collection === 'contacts');
const wasUnscopedContactsScan = () =>
  contactQueries().some(q => q.whereClauses.length === 0);

let container: HTMLDivElement;
let root: Root;

async function renderHook<T>(useHook: () => T): Promise<{ current: T }> {
  const ref: { current: T } = { current: null as unknown as T };
  function Probe() {
    ref.current = useHook();
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

/** Sign in as a super admin (apex platform operator) or an ordinary tenant admin. */
function signInAs(kind: 'super' | 'tenant') {
  authState.currentUser = {
    uid: kind === 'super' ? 'super-uid' : 'pastor-uid',
    email: kind === 'super' ? 'super@theharvest.app' : 'pastor@nations.church',
  };
  mockIsSuperAdminEmail.mockImplementation((email?: string | null) => email === 'super@theharvest.app');
  clearTenantCache();
}

beforeEach(() => {
  vi.clearAllMocks();
  built.length = 0;
  authState.currentUser = null;
  // Every test that reaches the `users` read resolves it to empty unless it
  // overrides this — the contacts scoping is what's under test here.
  mockGetDocs.mockResolvedValue(snap([]));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('CRM contacts scoping', () => {
  describe('super admin, no tenant in context (apex)', () => {
    it('runs the unscoped platform scan and keeps ONLY platform-owned rows', async () => {
      signInAs('super');
      mockGetDocs.mockImplementation(async (q: BuiltQuery) => {
        if (q.collection !== 'contacts') return snap([]);
        return snap([
          { id: 'c1', lastName: 'Anders', tenantId: 'harvest' },  // platform tenant
          { id: 'c2', lastName: 'Baker' },                        // legacy, no tenantId field
          { id: 'c3', lastName: 'Carter', tenantId: null },       // legacy null
          { id: 'c4', lastName: 'Dunn', tenantId: '' },           // legacy empty
          { id: 'c5', lastName: 'Evans', tenantId: 'nations' },   // ANOTHER tenant — must not leak
        ]);
      });

      const res = await renderHook(() => useContacts(null, true));
      await until(() => res.current.isSuccess, 'success');

      expect(wasUnscopedContactsScan()).toBe(true);
      expect(contactQueries()[0].limit).toBe(1000);
      // THE-342: the ceiling is only half a bounded read. Without a total order
      // this 1,000 is an ARBITRARY 1,000 — Firestore answers an unordered limit
      // in `__name__` order over random ids — so the same admin refreshing
      // could be shown a different thousand people. `__name__` is unique, so
      // the window is stable, and the equality filter plus this ordering is a
      // prefix scan of an automatic index: NO composite index is involved.
      expect(contactQueries()[0].orderBy, 'the contacts scan is unordered').toBe('__name__');
      expect(res.current.data?.map(c => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
      expect(res.current.data?.map(c => c.id)).not.toContain('c5');
    });

    it('scans the same way when the tenant resolves to the platform tenant', async () => {
      signInAs('super');
      const res = await renderHook(() => useContacts('harvest', true));
      await until(() => res.current.isSuccess, 'success');
      expect(wasUnscopedContactsScan()).toBe(true);
    });
  });

  describe('tenant admin with a resolved tenant', () => {
    it('issues the SCOPED query and never the unscoped one', async () => {
      signInAs('tenant');
      mockGetDocs.mockImplementation(async (q: BuiltQuery) => {
        if (q.collection !== 'contacts') return snap([]);
        return snap([{ id: 'c1', lastName: 'Anders', tenantId: 'harvest' }]);
      });

      const res = await renderHook(() => useContacts('harvest', true));
      await until(() => res.current.isSuccess, 'success');

      expect(wasUnscopedContactsScan()).toBe(false);
      expect(contactQueries()[0].whereClauses).toEqual([['tenantId', '==', 'harvest']]);
      // Ordered on the scoped path too (THE-342) — both paths or neither.
      expect(contactQueries()[0].orderBy, 'the scoped contacts read is unordered').toBe('__name__');
      // 1,000, NOT the 500 this used to be. The scoped path must never load less
      // than the unscoped one: a church's own admin seeing fewer of their people
      // than a platform operator does is the truncation bug at its most backwards.
      // See crm-list-coverage.test.tsx for the shared-ceiling guard.
      expect(contactQueries()[0].limit).toBe(1000);
    });

    it('scopes a NAMED tenant and never issues the unscoped query', async () => {
      signInAs('tenant');
      const res = await renderHook(() => useContactsWithUsers('harvest', true));
      await until(() => res.current.isSuccess, 'success');

      expect(wasUnscopedContactsScan()).toBe(false);
      expect(contactQueries()[0].whereClauses).toEqual([['tenantId', '==', 'harvest']]);
    });

    // A super admin ON a tenant subdomain is scoped exactly like its admins —
    // the subdomain is the authoritative tenant boundary (doc-1 scoping).
    it('scopes a super admin too when a real tenant is in context', async () => {
      signInAs('super');
      const res = await renderHook(() => useContacts('nations', true));
      await until(() => res.current.isSuccess, 'success');
      expect(wasUnscopedContactsScan()).toBe(false);
      expect(contactQueries()[0].whereClauses).toEqual([['tenantId', '==', 'nations']]);
    });
  });

  describe('tenant admin with NO tenant in context', () => {
    it('THROWS — does not return [] and does not issue the unscoped query', async () => {
      signInAs('tenant');
      const res = await renderHook(() => useContacts(null, true));
      await until(() => res.current.isError, 'error');

      expect(res.current.data).toBeUndefined();
      expect(res.current.data).not.toEqual([]);
      expect((res.current.error as Error).message).toBe(NO_TENANT_SCOPE_MESSAGE);
      expect(wasUnscopedContactsScan()).toBe(false);
      expect(contactQueries()).toHaveLength(0);
    });

    it('throws from useContactsWithUsers the same way', async () => {
      signInAs('tenant');
      const res = await renderHook(() => useContactsWithUsers(null, true));
      await until(() => res.current.isError, 'error');

      expect(res.current.data).toBeUndefined();
      expect((res.current.error as Error).message).toBe(NO_TENANT_SCOPE_MESSAGE);
      expect(wasUnscopedContactsScan()).toBe(false);
    });

    it('stays idle until auth is ready, so the throw is never premature', async () => {
      signInAs('tenant');
      const res = await renderHook(() => useContactsWithUsers(null, false));
      expect(res.current.fetchStatus).toBe('idle');
      expect(mockGetDocs).not.toHaveBeenCalled();
    });
  });

  describe('the app-members (`users`) half of the merged list', () => {
    it('SURFACES a failed members read as an error — never a silently shorter list', async () => {
      signInAs('tenant');
      mockGetDocs.mockImplementation(async (q: BuiltQuery) => {
        if (q.collection === 'contacts') {
          return snap([{ id: 'c1', firstName: 'Ada', lastName: 'Anders', email: 'ada@x.com', tenantId: 'harvest' }]);
        }
        throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      });

      const res = await renderHook(() => useContactsWithUsers('harvest', true));
      await until(() => res.current.isError, 'error');

      // The failure mode being killed: contacts loaded fine, so the old code
      // SUCCEEDED with that one row and the members were simply gone.
      expect(res.current.isSuccess).toBe(false);
      expect(res.current.data).toBeUndefined();
      expect((res.current.error as Error).message).toBe('Missing or insufficient permissions.');
    });

    it('merges members in when both reads succeed', async () => {
      signInAs('tenant');
      mockGetDocs.mockImplementation(async (q: BuiltQuery) => {
        if (q.collection === 'contacts') {
          return snap([{ id: 'c1', firstName: 'Ada', lastName: 'Anders', email: 'ada@x.com', tenantId: 'harvest' }]);
        }
        return snap([{ id: 'u1', displayName: 'Blaise Baker', email: 'blaise@x.com', tenantId: 'harvest' }]);
      });

      const res = await renderHook(() => useContactsWithUsers('harvest', true));
      await until(() => res.current.isSuccess, 'success');

      expect(res.current.data?.map(c => c.id)).toEqual(['c1', 'u1']);
    });
  });
});
