import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fx = vi.hoisted(() => ({ writes: [] as any[], updates: [] as any[], posts: [] as any[], events: [] as any[] }));
vi.mock('@/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'member', displayName: 'Member', email: 'member@test.com', photoURL: '' } } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }), doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  query: (ref: any) => ref, where: () => ({}), orderBy: () => ({}), limit: () => ({}),
  onSnapshot: (q: any, callback: (snap: unknown) => void) => { const rows = q.path === 'community_posts' ? fx.posts : q.path?.endsWith('/events') ? fx.events : []; callback({ docs: rows.map((data: any) => ({ id: data.id, data: () => data })), forEach: () => {} }); return () => {}; },
  getDoc: async () => ({ exists: () => true, data: () => ({ role: 'user', displayName: 'Member' }) }),
  getDocs: async () => ({ docs: [] }), getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  addDoc: async (...args: unknown[]) => { fx.writes.push(args); return { id: 'post' }; },
  updateDoc: async (...args: unknown[]) => { fx.updates.push(args); }, deleteDoc: async () => {}, arrayUnion: () => ({}), arrayRemove: () => ({}), deleteField: () => ({}), serverTimestamp: () => 'time', Timestamp: class {},
}));
vi.mock('@/utils/tenant-scope', () => ({ getTenantScope: async () => 'tenant', getWriteTenantScope: async () => 'tenant', hasPlatformOverride: () => false, PLATFORM_TENANT_ID: 'harvest' }));
vi.mock('@/utils/send-notification', () => ({ sendPushNotification: vi.fn() }));
vi.mock('@/utils/share-url', () => ({ useShareBaseUrl: () => '' }));
vi.mock('@/contexts/TenantContext', () => ({ useTenantOptional: () => ({ tenantPlan: 'church' }), useTenant: () => ({ tenantPlan: 'church' }) }));
import NewsTab from '../NewsTab';

let root: Root; let host: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); fx.writes = []; fx.updates = []; fx.posts = []; fx.events = []; });
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
  it('hides event posts, embeds and event cards when events are disabled', async () => {
    fx.posts = [
      { id: 'event', type: 'event', content: 'Hidden legacy event' },
      { id: 'embed', type: 'post', content: 'Hidden event embed', embed: { type: 'event', id: 'e' } },
      { id: 'post', type: 'post', content: 'Visible update', authorName: 'Member', authorId: 'member', likes: [], createdAt: '2020-01-01' },
    ];
    fx.events = [{ id: 'e', title: 'Hidden pinned event', pinned: true }];
    const client = new QueryClient(); host = document.createElement('div'); root = createRoot(host);
    await act(async () => { root.render(<QueryClientProvider client={client}><NewsTab eventsEnabled={false} onOpenAllNews={() => {}} onOpenArticle={() => {}} /></QueryClientProvider>); await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain('Visible update');
    expect(host.textContent).not.toContain('Hidden legacy event');
    expect(host.textContent).not.toContain('Hidden event embed');
    expect(host.textContent).not.toContain('Hidden pinned event');
  });

  it('edits a pinned member post without writing its pin state', async () => {
    fx.posts = [{ id: 'pinned', type: 'post', content: 'Original', authorName: 'Member', authorId: 'member', likes: [], isPinned: true, createdAt: '2020-01-01' }];
    const client = new QueryClient(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root.render(<QueryClientProvider client={client}><NewsTab onOpenAllNews={() => {}} onOpenArticle={() => {}} /></QueryClientProvider>); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => (host.querySelector('[aria-label="Post options"]') as HTMLElement).click());
    await act(async () => Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Edit post')!.click());
    const input = host.querySelector('textarea[aria-label="Share an update"]') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Edited'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Update')!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(fx.updates[0][1]).toMatchObject({ content: 'Edited' });
    expect(fx.updates[0][1]).not.toHaveProperty('isPinned');
  });

});
