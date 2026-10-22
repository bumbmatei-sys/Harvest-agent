import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/firebase', () => ({ db: { __db: true } }));

const scope = vi.hoisted(() => ({ read: 'tenant-1' as string | null }));
vi.mock('@/utils/tenant-scope', () => ({ getTenantScope: async () => scope.read }));

const read = vi.hoisted(() => ({ base: null as any, limit: 0 }));
vi.mock('@/utils/bounded-list-read', () => ({
  readBoundedList: async (base: unknown, limit: number, map: (id: string, d: Record<string, unknown>) => unknown) => {
    read.base = base;
    read.limit = limit;
    return {
      rows: [map('u1', { displayName: ' Ana ', email: ' ana@x.org ' }), map('u2', { name: 'Bo' })],
      total: 250,
      truncated: true,
    };
  },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ __path: path }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (col: unknown, ...clauses: unknown[]) => ({ col, clauses }),
}));

import { loadTenantMembers, MEMBER_PICKER_LIMIT } from '../members';

beforeEach(() => {
  scope.read = 'tenant-1';
  read.base = null;
});

describe('loadTenantMembers', () => {
  it('queries users with where(tenantId == scope) when there is a scope', async () => {
    await loadTenantMembers();
    expect(read.base.col).toEqual({ __path: 'users' });
    expect(read.base.clauses).toEqual([{ field: 'tenantId', op: '==', value: 'tenant-1' }]);
    expect(read.limit).toBe(MEMBER_PICKER_LIMIT);
  });

  it('scopes to the resolved tenant, not a fixed one', async () => {
    scope.read = 'tenant-9';
    await loadTenantMembers();
    expect(read.base.clauses).toEqual([{ field: 'tenantId', op: '==', value: 'tenant-9' }]);
  });

  it('reads users unfiltered only when there is no scope (apex super admin)', async () => {
    scope.read = null;
    await loadTenantMembers();
    expect(read.base).toEqual({ __path: 'users' });
  });

  it('maps rows and reports the exact total and truncation', async () => {
    const list = await loadTenantMembers();
    expect(list.members).toEqual([
      { uid: 'u1', name: 'Ana', email: 'ana@x.org' },
      { uid: 'u2', name: 'Bo', email: '' },
    ]);
    expect(list.total).toBe(250);
    expect(list.truncated).toBe(true);
  });
});
