import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fx = vi.hoisted(() => ({ writes: [] as any[], updates: [] as any[], posts: [] as any[], events: [] as any[], comments: [] as any[], profile: { role: 'user', displayName: 'Member' } as Record<string, unknown> }));
vi.mock('@/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'member', displayName: 'Member', email: 'member@test.com', photoURL: 'https://example.com/auth-photo.jpg' } } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }), doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  query: (ref: any) => ref, where: () => ({}), orderBy: () => ({}), limit: () => ({}),
  onSnapshot: (q: any, callback: (snap: unknown) => void) => { const rows = q.path === 'community_posts' ? fx.posts : q.path?.endsWith('/events') ? fx.events : q.path?.endsWith('/comments') ? fx.comments : []; callback({ docs: rows.map((data: any) => ({ id: data.id, data: () => data })), forEach: () => {} }); return () => {}; },
  getDoc: async () => ({ exists: () => true, data: () => fx.profile }),
  getDocs: async () => ({ docs: [] }), getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  addDoc: async (...args: unknown[]) => { fx.writes.push(args); return { id: 'post' }; },
  updateDoc: async (...args: unknown[]) => { fx.updates.push(args); }, deleteDoc: async () => {}, arrayUnion: () => ({}), arrayRemove: () => ({}), deleteField: () => ({}), serverTimestamp: () => 'time', Timestamp: class {},
}));
vi.mock('@/utils/tenant-scope', () => ({ getTenantScope: async () => 'tenant', getWriteTenantScope: async () => 'tenant', hasPlatformOverride: () => false, PLATFORM_TENANT_ID: 'harvest' }));
vi.mock('@/utils/send-notification', () => ({ sendPushNotification: vi.fn() }));
vi.mock('@/utils/share-url', () => ({ useShareBaseUrl: () => '' }));
vi.mock('@/contexts/TenantContext', () => ({ useTenantOptional: () => ({ tenantPlan: 'church' }), useTenant: () => ({ tenantPlan: 'church' }) }));
import NewsTab from '../NewsTab';
import AllNews from '../AllNews';

let root: Root; let host: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); fx.writes = []; fx.updates = []; fx.posts = []; fx.events = []; fx.comments = []; fx.profile = { role: 'user', displayName: 'Member' }; });
describe('member feed composer', () => {
  it.each([
    { label: 'profile byline', profile: { role: 'user', displayName: 'Profile member', photoURL: 'https://example.com/profile.jpg' }, authorName: 'Profile member', authorPhoto: 'https://example.com/profile.jpg' },
    { label: 'auth name fallback', profile: { role: 'user', displayName: '', name: 'Unbound legacy name' }, authorName: 'Member', authorPhoto: '' },
  ])('accepts short text and writes a plain post with $label without rich controls', async ({ profile, authorName, authorPhoto }) => {
    fx.profile = profile;
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
    expect(fx.writes[0][1]).toMatchObject({ authorId: 'member', authorName, authorPhoto, tenantId: 'tenant', content: 'Hello community', type: 'post', imageUrls: [], imageUrl: '', isPinned: false });
    expect(fx.writes[0][1]).not.toHaveProperty('authorLevel');
    expect(fx.writes[0][1]).not.toHaveProperty('embed'); expect(fx.writes[0][1]).not.toHaveProperty('pollOptions');
  });
  it.each([
    { surface: 'NewsTab', profileName: 'Profile commenter', profilePhoto: 'https://example.com/profile.jpg' },
    { surface: 'AllNews', profileName: 'Profile commenter', profilePhoto: 'https://example.com/profile.jpg' },
    { surface: 'NewsTab', profileName: '', profilePhoto: '' },
    { surface: 'AllNews', profileName: '', profilePhoto: '' },
  ])('$surface writes the rule-bound comment byline ($profileName) and ignores legacy claimed levels', async ({ surface, profileName, profilePhoto }) => {
    fx.profile = { role: 'user', displayName: profileName, photoURL: profilePhoto, name: 'Unbound legacy name' };
    fx.posts = [{ id: 'post', type: 'post', content: 'Community update', authorName: 'Member', authorId: 'member', likes: [], createdAt: '2040-01-01' }];
    fx.comments = [{ id: 'legacy-comment', authorId: 'other', authorName: 'Commenter', authorLevel: 99, content: 'Legacy comment', createdAt: '2040-01-01' }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root.render(<QueryClientProvider client={client}>{surface === 'NewsTab' ? <NewsTab onOpenAllNews={() => {}} onOpenArticle={() => {}} /> : <AllNews onBack={() => {}} />}</QueryClientProvider>); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { host.querySelector('button svg.lucide-message-square')!.closest('button')!.click(); });
    expect(host.textContent).toContain('Legacy comment');
    expect(host.querySelector('[aria-label="Level 99"]')).toBeNull();
    const input = host.querySelector<HTMLInputElement>('input[placeholder="Write a comment..."]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Hello'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Send comment"]')!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(fx.writes).toHaveLength(1);
    expect(fx.writes[0][0].path).toBe('community_posts/post/comments');
    expect(fx.writes[0][1]).toEqual({ authorId: 'member', authorName: profileName || 'Member', authorPhoto: profilePhoto, content: 'Hello', createdAt: expect.any(String), tenantId: 'tenant' });
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
    await act(async () => { (host.querySelector('[aria-label="Post options"]') as HTMLElement).click(); });
    // shadcn renders the action as a menuitem in a portal under document.body.
    const editItem = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent === 'Edit post');
    expect(editItem).toBeDefined();
    await act(async () => { editItem!.click(); });
    const input = host.querySelector('textarea[aria-label="Share an update"]') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Edited'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Update')!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(fx.updates[0][1]).toMatchObject({ content: 'Edited' });
    expect(fx.updates[0][1]).not.toHaveProperty('isPinned');
  });

});
