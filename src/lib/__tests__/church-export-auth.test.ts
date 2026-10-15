import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * THE-228 — who may export a church.
 *
 * `manageCRM` is enough for requireTenantAdmin. It is not enough here. A super
 * admin is not a bypass, and a token that already names a tenant cannot name
 * a different one.
 */

interface User {
  uid: string;
  email?: string;
  tenantId: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  authTime: number;
}

const state = vi.hoisted(() => ({
  user: null as User | NextResponse | null,
  tenants: {} as Record<string, { ownerId?: string } | undefined>,
  users: {} as Record<string, { role?: string; permissions?: Record<string, boolean> } | undefined>,
  roster: {} as Record<string, string[]>,
  tenantGets: 0,
}));

const mockRequireAuth = vi.hoisted(() => vi.fn(async () => state.user));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: async (tenantId: string) => ({ adminEmails: state.roster[tenantId] ?? [] }),
}));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (name === 'tenants') {
            state.tenantGets += 1;
            const data = state.tenants[id];
            return { exists: data !== undefined, data: () => data };
          }
          const data = state.users[id];
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  },
}));

const { requireChurchExportAdmin, CHURCH_EXPORT_DENIED } = await import('../church-export-auth');

const request = new NextRequest('http://localhost/api/church-export', { method: 'POST' });

function asUser(partial: Partial<User> & Pick<User, 'uid'>): User {
  return {
    email: 'admin@example.com',
    tenantId: 'tenant-a',
    isAdmin: true,
    isSuperAdmin: false,
    authTime: 1_700_000_000,
    ...partial,
  };
}

beforeEach(() => {
  state.user = asUser({ uid: 'admin-1' });
  state.tenants = { 'tenant-a': { ownerId: 'owner-1' } };
  state.users = {};
  state.roster = {};
  state.tenantGets = 0;
});

async function gate(tenantId: string | null = 'tenant-a') {
  return requireChurchExportAdmin(request, tenantId);
}

describe('requireChurchExportAdmin', () => {
  it('lets the owner, a roster admin, fullAccess and the legacy church admin through', async () => {
    state.user = asUser({ uid: 'owner-1', isAdmin: false });
    const owner = await gate();
    expect(owner).toMatchObject({ tenantId: 'tenant-a' });

    state.user = asUser({ uid: 'roster-1', tenantId: null, isAdmin: false, email: 'Roster@Example.com' });
    state.roster['tenant-a'] = ['roster@example.com'];
    const roster = await gate();
    expect(roster).toMatchObject({ tenantId: 'tenant-a' });

    state.user = asUser({ uid: 'full-1' });
    state.users['full-1'] = { role: 'admin', permissions: { fullAccess: true, manageCRM: true } };
    const full = await gate();
    expect(full).toMatchObject({ tenantId: 'tenant-a' });

    state.user = asUser({ uid: 'legacy-1' });
    state.users['legacy-1'] = { role: 'church_admin', permissions: { manageCRM: true } };
    const legacy = await gate();
    expect(legacy).toMatchObject({ tenantId: 'tenant-a' });
  });

  it('refuses manageCRM on its own, including an admin the wider tenant-admin gate would allow', async () => {
    state.user = asUser({ uid: 'crm-1', isAdmin: true });
    state.users['crm-1'] = { role: 'admin', permissions: { manageCRM: true } };
    const res = await gate();
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(403);
    expect(await (res as NextResponse).json()).toEqual({ error: CHURCH_EXPORT_DENIED });

    state.user = asUser({ uid: 'crm-2', isAdmin: false });
    state.users['crm-2'] = { role: 'user', permissions: { manageCRM: true } };
    const member = await gate();
    expect((member as NextResponse).status).toBe(403);
  });

  it('refuses another tenant before reading that church', async () => {
    state.user = asUser({ uid: 'admin-1', tenantId: 'tenant-a' });
    state.users['admin-1'] = { role: 'admin', permissions: { fullAccess: true } };
    const res = await gate('tenant-b');
    expect((res as NextResponse).status).toBe(403);
    expect(await (res as NextResponse).json()).toEqual({ error: 'Access denied to this tenant' });
    expect(state.tenantGets).toBe(0);
  });

  it('does not let a super admin export a church they do not administer', async () => {
    state.user = asUser({
      uid: 'super-1',
      email: 'platform@example.com',
      tenantId: null,
      isAdmin: true,
      isSuperAdmin: true,
    });
    const res = await gate('tenant-a');
    expect((res as NextResponse).status).toBe(403);
    expect(await (res as NextResponse).json()).toEqual({ error: CHURCH_EXPORT_DENIED });
  });

  it('refuses an unauthenticated caller and an unsafe tenant id', async () => {
    state.user = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const anon = await gate();
    expect((anon as NextResponse).status).toBe(401);
    expect(state.tenantGets).toBe(0);

    state.user = asUser({ uid: 'admin-1' });
    const unsafe = await gate('../tenant-a');
    expect((unsafe as NextResponse).status).toBe(403);
    expect(state.tenantGets).toBe(0);
  });
});
