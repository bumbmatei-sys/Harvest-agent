import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), userDoc: {} as Record<string, unknown> }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'A', getIdToken: async () => 'token' } } }));
vi.mock('firebase/auth', () => ({ getIdToken: vi.fn(async () => 'fresh'), onAuthStateChanged: (_: unknown, cb: (u: unknown) => void) => { cb({ uid: 'A' }); return () => {}; } }));
vi.mock('firebase/firestore', () => ({ doc: (_: unknown, collection: string, id: string) => ({ collection, id }), onSnapshot: (ref: { collection: string }, cb: (s: unknown) => void) => { cb({ exists: () => true, data: () => ref.collection === 'users' ? mocks.userDoc : { plan: 'church', setupCompleted: false } }); return () => {}; } }));
vi.mock('../../utils/super-admins', () => ({ isSuperAdminEmail: () => false, SUPER_ADMIN_EMAILS: [] }));
vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdmin: async () => false }));
vi.mock('../../lib/theme-runtime', () => ({ useForcedLightTheme: () => {} }));
vi.mock('../FirstRunSetup', () => ({ default: () => <p>First run setup</p> }));
vi.mock('../WorkspaceHandoff', () => ({ default: ({ onContinue }: { onContinue?: () => void }) => <button onClick={onContinue}>Account ready</button>, CONFIRMS_ACCOUNT: 'account', CONFIRMS_PAYMENT: 'payment' }));
import OnboardingGate from '../OnboardingGate';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };
const mount = async () => { act(() => { root.render(<OnboardingGate><p>Private app</p></OnboardingGate>); }); await flush(); };
beforeEach(() => {
  vi.clearAllMocks();
  // Timers are advanced deliberately here to test the actual deadline.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.userDoc = { signupInProgress: true, signupPlan: 'church', signupBilling: 'yearly', signupMinistryName: 'Grace Ministry', signupSubdomain: 'saved-legacy-slug' };
  sessionStorage.clear();
  window.history.replaceState({}, '', '/?dodo=success&subscription_id=sub-A');
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('payment recovery at a checkout return', () => {
  it.each(['failed', 'cancelled'])('renders actionable shadcn recovery for %s', async status => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ status }) });
    await mount();
    expect(container.textContent).toContain("Payment didn't go through");
    expect(container.querySelector('[data-slot="card"]')).not.toBeNull();
    expect(container.querySelector('button')?.textContent).toBe('Try again');
    expect(container.textContent).toContain('Choose another plan');
    expect(container.textContent).not.toContain('Private app');
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
  it('retries with the same plan, annual term and name, preserving the old slug marker', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'failed' }) });
    await mount();
    mocks.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Checkout unavailable' }) });
    await act(async () => container.querySelector('button')!.click()); await flush();
    const [endpoint, options] = mocks.fetch.mock.calls.find(([endpoint]) => endpoint === '/api/dodo/checkout')!;
    expect(endpoint).toBe('/api/dodo/checkout');
    expect(JSON.parse(options.body)).toMatchObject({ plan: 'church', billing: 'yearly', ministryName: 'Grace Ministry', subscriptionId: 'sub-A' });
    expect(mocks.userDoc.signupSubdomain).toBe('saved-legacy-slug');
    expect(container.textContent).toContain('Checkout unavailable');
  });
  it('pending hits a hard 60s timeout and Retry rechecks status', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(container.textContent).toContain("Payment didn't go through");
    expect(container.textContent).toContain('still be processing');
    expect(container.querySelector('.animate-spin')).toBeNull();
    const count = mocks.fetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(count);
    await act(async () => container.querySelector('button')!.click()); await flush();
    expect(mocks.fetch).toHaveBeenCalledTimes(count + 1);
  });
  it('hung network also times out with support and a status Retry', async () => {
    mocks.fetch.mockReturnValue(new Promise(() => {}));
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(container.textContent).toContain('Contact support');
    expect(container.querySelector('button')?.textContent).toBe('Retry');
  });
  it('a provisioned tenant cannot skip the server check via dodo=success', async () => {
    mocks.userDoc = { ...mocks.userDoc, tenantId: 'tenant-A', role: 'admin' };
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'failed' }) });
    await mount();
    expect(container.textContent).toContain("Payment didn't go through");
    expect(container.textContent).not.toContain('First run setup');
  });
  it('success refreshes claims and continues to first-run setup on the apex', async () => {
    mocks.userDoc = { ...mocks.userDoc, tenantId: 'tenant-A', role: 'admin' };
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ready', tenantId: 'tenant-A' }) });
    await mount();
    expect(container.textContent).toContain('Account ready');
    await act(async () => container.querySelector('button')!.click()); await flush();
    expect(container.textContent).toContain('First run setup');
    expect(window.location.hostname).not.toContain('tenant-A');
  });
});
