import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const store = new Map<string, Record<string, unknown>>();
const snap = (path: string) => ({ exists: store.has(path), data: () => store.get(path) });
const ref = (path: string) => ({ path, get: async () => snap(path) });
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: unknown) => unknown) => fn({
      get: async (r: { path: string }) => snap(r.path),
      set: (r: { path: string }, data: Record<string, unknown>) => { store.set(r.path, data); },
      delete: (r: { path: string }) => { store.delete(r.path); },
      update: (r: { path: string }, data: Record<string, unknown>) => { store.set(r.path, { ...store.get(r.path), ...data }); },
    }),
  },
}));

import { changeHandle, currentHandle, isHandleAvailable, tenantIdForHandle } from './handle-server';
import { handleProblem, normalizeHandle } from './handle';

beforeEach(() => {
  store.clear();
  store.set('tenants/grace', { name: 'Grace' });
  store.set('tenants/hope', { name: 'Hope' });
});

describe('Storefront address', () => {
  it('reads and checks a handle before it is claimed', () => {
    expect(normalizeHandle('  Grace Chapel ')).toBe('grace-chapel');
    expect(handleProblem('ab')).toBe('Use at least 3 characters.');
    expect(handleProblem('a--b')).toBe('Use lower-case letters, numbers and single hyphens.');
    expect(handleProblem('blog')).toBe('That address is reserved.');
    expect(handleProblem('grace-chapel')).toBeNull();
  });

  it('starts at the ministry id and moves to a new handle, freeing the old one', async () => {
    expect(currentHandle('grace', store.get('tenants/grace'))).toBe('grace');
    expect(await changeHandle('grace', 'gracechapel')).toEqual({ ok: true, handle: 'gracechapel' });
    expect(await tenantIdForHandle('gracechapel')).toBe('grace');
    expect(currentHandle('grace', store.get('tenants/grace'))).toBe('gracechapel');

    expect(await changeHandle('grace', 'grace-city')).toEqual({ ok: true, handle: 'grace-city' });
    expect(await tenantIdForHandle('gracechapel')).toBeNull();
    expect(await tenantIdForHandle('grace-city')).toBe('grace');

    expect(await changeHandle('grace', 'grace')).toEqual({ ok: true, handle: 'grace' });
    expect(await tenantIdForHandle('grace-city')).toBeNull();
    expect(store.get('tenants/grace')?.storefrontHandle).toBeNull();
  });

  it('never hands out another ministry id or another ministry handle', async () => {
    expect(await isHandleAvailable('hope', 'grace')).toBe(false);
    expect(await changeHandle('grace', 'hope')).toMatchObject({ ok: false, status: 409 });
    await changeHandle('hope', 'hope-city');
    expect(await isHandleAvailable('hope-city', 'grace')).toBe(false);
    expect(await changeHandle('grace', 'hope-city')).toMatchObject({ ok: false, status: 409 });
    expect(await isHandleAvailable('hope-city', 'hope')).toBe(true);
    expect(await changeHandle('grace', 'ab')).toMatchObject({ ok: false, status: 400 });
    expect(await changeHandle('nobody', 'nobody-new')).toMatchObject({ ok: false, status: 404 });
  });
});
