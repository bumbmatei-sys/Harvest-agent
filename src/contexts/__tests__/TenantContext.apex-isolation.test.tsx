import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ authCallback: null as null | ((u: unknown) => void), membership: null as null | ((s: unknown) => void), get: vi.fn(), reads: [] as string[] }));
vi.mock('../../firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_: unknown, cb: (u: unknown) => void) => { mock.authCallback = cb; return () => {}; } }));
vi.mock('firebase/firestore', () => ({
  doc: (_: unknown, collection: string, id: string) => ({ collection, id }),
  onSnapshot: (ref: { id: string }, cb: (s: unknown) => void) => { mock.reads.push(`users/${ref.id}`); mock.membership = cb; return () => {}; },
  getDoc: (ref: { collection: string; id: string }) => { mock.reads.push(`${ref.collection}/${ref.id}`); return mock.get(ref); },
}));
vi.mock('../../utils/tenant-scope', () => ({ hasPlatformOverride: () => false, clearTenantCache: vi.fn() }));
import { TenantProvider, useTenant } from '../TenantContext';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let container: HTMLDivElement;
function Probe() { const t = useTenant(); return <p>{t.tenantId}|{t.tenantName}|{t.tenantPlan}|{t.error}</p>; }
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
beforeEach(() => {
  vi.clearAllMocks(); mock.reads = []; mock.membership = null;
  (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL('https://theharvest.app/');
  document.cookie = 'tenantId=tenant-B';
  mock.get.mockImplementation(async (ref: { id: string }) => ({ exists: () => true, data: () => ({ name: `Name ${ref.id}`, plan: ref.id === 'tenant-A' ? 'church' : 'ministry', status: 'active', config: {} }) }));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(<TenantProvider><Probe /></TenantProvider>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); document.cookie = 'tenantId=; max-age=0'; });
describe('apex tenant membership isolation', () => {
  it('A ignores a B cookie and reads only their membership and tenant A', async () => {
    act(() => mock.authCallback!({ uid: 'A' }));
    act(() => mock.membership!({ data: () => ({ tenantId: 'tenant-A' }) })); await flush();
    expect(container.textContent).toContain('tenant-A|Name tenant-A|church');
    expect(mock.reads).toEqual(['users/A', 'tenants/tenant-A']);
    expect(container.textContent).not.toContain('tenant-B');
  });
  it('sign-out removes tenant state and never loads a cookie tenant', async () => {
    act(() => mock.authCallback!({ uid: 'A' }));
    act(() => mock.membership!({ data: () => ({ tenantId: 'tenant-A' }) })); await flush();
    act(() => mock.authCallback!(null)); await flush();
    expect(container.textContent).not.toContain('tenant-A');
    expect(mock.reads).not.toContain('tenants/tenant-B');
  });
  it('ignores a late membership callback belonging to the previous signed-in user', async () => {
    act(() => mock.authCallback!({ uid: 'A' }));
    const staleMembership = mock.membership!;
    act(() => mock.authCallback!({ uid: 'B' }));
    act(() => mock.membership!({ data: () => ({ tenantId: 'tenant-B' }) })); await flush();
    act(() => staleMembership({ data: () => ({ tenantId: 'tenant-A' }) })); await flush();
    expect(container.textContent).toContain('tenant-B|Name tenant-B|ministry');
    expect(mock.reads).not.toContain('tenants/tenant-A');
  });
  it('account switch resets A branding and entitlements before loading B', async () => {
    act(() => mock.authCallback!({ uid: 'A' }));
    act(() => mock.membership!({ data: () => ({ tenantId: 'tenant-A' }) })); await flush();
    act(() => mock.authCallback!({ uid: 'B' }));
    expect(container.textContent).not.toContain('tenant-A');
    act(() => mock.membership!({ data: () => ({ tenantId: 'tenant-B' }) })); await flush();
    expect(container.textContent).toContain('tenant-B|Name tenant-B|ministry');
    expect(mock.reads).toEqual(['users/A', 'tenants/tenant-A', 'users/B', 'tenants/tenant-B']);
  });
});
