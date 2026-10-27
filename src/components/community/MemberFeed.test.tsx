import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fx = vi.hoisted(() => ({ writes: [] as any[] }));
vi.mock('@/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'member', displayName: 'Member', email: 'member@test.com', photoURL: '' } } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }), doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  query: (ref: any) => ref, where: () => ({}), orderBy: () => ({}), limit: () => ({}),
  onSnapshot: (_q: unknown, callback: (snap: unknown) => void) => { callback({ docs: [], forEach: () => {} }); return () => {}; },
  getDoc: async () => ({ exists: () => true, data: () => ({ role: 'user', displayName: 'Member' }) }),
  getDocs: async () => ({ docs: [] }), getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  addDoc: async (...args: unknown[]) => { fx.writes.push(args); return { id: 'post' }; },
  updateDoc: async () => {}, deleteDoc: async () => {}, arrayUnion: () => ({}), arrayRemove: () => ({}), deleteField: () => ({}), serverTimestamp: () => 'time', Timestamp: class {},
}));
vi.mock('@/utils/tenant-scope', () => ({ getTenantScope: async () => 'tenant', getWriteTenantScope: async () => 'tenant', hasPlatformOverride: () => false, PLATFORM_TENANT_ID: 'harvest' }));
vi.mock('@/utils/send-notification', () => ({ sendPushNotification: vi.fn() }));
vi.mock('@/utils/share-url', () => ({ useShareBaseUrl: () => '' }));
vi.mock('@/contexts/TenantContext', () => ({ useTenantOptional: () => ({ tenantPlan: 'church' }), useTenant: () => ({ tenantPlan: 'church' }) }));
import NewsTab from '../NewsTab';

let root: Root; let host: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); fx.writes = []; });
describe('member feed composer', () => {
  it('accepts short text and writes a plain post without rich controls', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root.render(<QueryClientProvider client={client}><NewsTab onOpenAllNews={() => {}} onOpenArticle={() => {}} /></QueryClientProvider>); await Promise.resolve(); await Promise.resolve(); });
    const input = host.querySelector('textarea[aria-label="Share an update"]') as HTMLTextAreaElement;
    expect(input.maxLength).toBe(500); expect(host.textContent).toContain('0 / 500');
    expect(host.querySelector('[aria-label="Add attachment"]')).toBeNull(); expect(host.querySelector('[aria-label="Pin to top"]')).toBeNull();
    expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent === 'Poll')).toBe(false);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Hello community'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(host.textContent).toContain('15 / 500');
    await act(async () => { Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Post')!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(fx.writes.length).toBe(1);
    expect(fx.writes[0][1]).toMatchObject({ authorId: 'member', tenantId: 'tenant', content: 'Hello community', type: 'post', imageUrls: [], imageUrl: '', isPinned: false });
    expect(fx.writes[0][1]).not.toHaveProperty('embed'); expect(fx.writes[0][1]).not.toHaveProperty('pollOptions');
  });
});
