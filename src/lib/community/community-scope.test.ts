import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/firebase', () => ({ auth: { currentUser: { uid: 'u', email: 'member@example.org' } }, db: {} }));
vi.mock('firebase/firestore', () => ({ doc: () => ({}), getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: 'account-tenant' }) }) }));
import { getTenantIdFromHost, getTenantScope, getWriteTenantScope } from '@/utils/tenant-scope';
const original = window.location.href;
afterEach(() => { window.history.replaceState({}, '', original); });
describe('selected community scope', () => {
  it('uses the member path for reads/writes while the host resolver remains independent', async () => {
    window.history.replaceState({}, '', '/community/joined');
    expect(getTenantIdFromHost()).toBeNull();
    expect(await getTenantScope()).toBe('joined');
    expect(await getWriteTenantScope()).toBe('joined');
  });
  it('does not apply member scope to admin routes or unrelated query strings', async () => {
    window.history.replaceState({}, '', '/admin?community=joined');
    expect(await getTenantScope()).toBe('account-tenant');
    window.history.replaceState({}, '', '/community/joined/admin');
    expect(await getTenantScope()).toBe('account-tenant');
  });
});
