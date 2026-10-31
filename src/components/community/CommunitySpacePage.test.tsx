import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCommunityDraft, type CommunityRecord } from '@/lib/community/communities';

type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };
const h = vi.hoisted(() => ({
  record: { status: 'loading' } as Load<unknown>,
  member: { status: 'ready', data: false } as Load<boolean>,
  posts: { status: 'ready', data: [] } as Load<unknown[]>,
  channels: { status: 'ready', data: [] } as Load<unknown[]>,
  messages: { status: 'ready', data: [] } as Load<unknown[]>,
  roster: 'not-admin', tenant: { name: 'Grace Chapel', ownerId: 'owner' } as Record<string, unknown>,
  changeMembership: vi.fn(), createPost: vi.fn(), sendMessage: vi.fn(), messagesFor: vi.fn(),
}));
vi.mock('@/firebase', () => ({ db: {}, auth: { currentUser: { getIdTokenResult: async () => ({ claims: {} }) } } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDoc: async (path: string) => path === 'tenants/grace' ? { exists: () => true, data: () => h.tenant } : { exists: () => false, data: () => undefined },
}));
vi.mock('@/utils/tenant.utils', () => ({ checkRosterAdminStatus: async () => h.roster }));
vi.mock('@/store/useAppStore', () => ({ useAppStore: () => ({ currentUser: { uid: 'u' } }) }));
vi.mock('@/lib/community/space', () => ({
  useCommunityRecord: () => h.record, useIsMember: () => h.member, usePosts: () => h.posts, useChannels: () => h.channels,
  useMessages: (_t: string, _c: string, channelId: string | null) => { h.messagesFor(channelId); return h.messages; },
  changeMembership: h.changeMembership, createPost: h.createPost, sendMessage: h.sendMessage,
}));
import { CommunitySpacePage, joinBlocker } from './CommunitySpacePage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text) as HTMLButtonElement | undefined;
const youth = (over: Partial<CommunityRecord> = {}): CommunityRecord => ({ id: 'youth', ...newCommunityDraft('Youth Night'), tagline: 'Ages 13 to 18', about: 'Fridays at seven.', visibility: 'public', status: 'published', isDefault: false, ...over });
function Where() { const location = useLocation(); return <p data-where>{location.pathname}{location.search}</p>; }
async function mount(path = '/community/grace/youth') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/community/:tenantId/:communityId" element={<CommunitySpacePage />} />
    <Route path="/community/:tenantId" element={<Where />} />
    <Route path="/" element={<Where />} />
  </Routes></MemoryRouter>));
  await act(async () => { await Promise.resolve(); });
}
async function type(label: string, value: string) {
  const area = document.querySelector(`textarea[aria-label="${label}"]`) as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(el: HTMLElement | undefined) { expect(el).toBeTruthy(); await act(async () => { el!.click(); await Promise.resolve(); }); }

beforeEach(() => {
  vi.clearAllMocks();
  h.record = { status: 'ready', data: youth() };
  h.member = { status: 'ready', data: false };
  h.posts = { status: 'ready', data: [] }; h.channels = { status: 'ready', data: [] }; h.messages = { status: 'ready', data: [] };
  h.roster = 'not-admin'; h.tenant = { name: 'Grace Chapel', ownerId: 'owner' };
  h.changeMembership.mockResolvedValue(undefined); h.createPost.mockResolvedValue(undefined); h.sendMessage.mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.render(null)); });

describe('community public page', () => {
  it('shows the community and the approved consent notice before Join, then joins', async () => {
    await mount();
    expect(host.querySelector('h1')!.textContent).toBe('Youth Night');
    expect(host.textContent).toContain('Ages 13 to 18');
    expect(host.textContent).toContain('Fridays at seven.');
    expect(host.textContent).toContain('Free · Run by Grace Chapel');
    // Matei's wording, verbatim.
    expect(host.querySelector('[data-consent-notice]')!.textContent).toBe('Joining Youth Night shares your name and email with Grace Chapel, who runs it. They can see your answers to any questions and may contact you about the community. You can leave anytime.');
    expect(host.querySelector('[data-community-space]')).toBeNull();
    await click(button('Join community'));
    expect(h.changeMembership).toHaveBeenCalledWith('grace', 'youth', true);
  });

  it('shows the server message when a join fails', async () => {
    h.changeMembership.mockRejectedValue(new Error('This community is not open to join.'));
    await mount();
    await click(button('Join community'));
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('This community is not open to join.');
  });

  it('says why a community cannot be joined, and offers no Join', async () => {
    h.record = { status: 'ready', data: youth({ joining: { mode: 'apply' } }) };
    await mount();
    expect(host.textContent).toContain('reviews applications');
    expect(button('Join community')).toBeUndefined();
    expect(host.querySelector('[data-consent-notice]')).toBeNull();
  });

  it('mirrors every rule of the join API', () => {
    expect(joinBlocker(youth())).toBeNull();
    expect(joinBlocker(youth({ status: 'draft' }))).toContain('not published');
    expect(joinBlocker(youth({ visibility: 'private' }))).toContain('private');
    expect(joinBlocker(youth({ pricing: { type: 'paid', amountCents: 500, currency: 'usd', interval: 'month' } }))).toContain('coming soon');
    expect(joinBlocker(youth({ joining: { mode: 'apply' } }))).toContain('applications');
  });

  it('treats an unreadable community as private', async () => {
    h.record = { status: 'ready', data: null };
    await mount();
    expect(host.querySelector('h1')!.textContent).toBe('This community is private');
  });

  it('sends the default community to its own page and refuses a malformed id', async () => {
    await mount('/community/grace/default');
    expect(host.querySelector('[data-where]')!.textContent).toBe('/community/grace');
    await act(async () => root.render(null));
    await mount('/community/grace/Bad_Id');
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Community not found.');
  });
});

describe('community space', () => {
  beforeEach(() => { h.member = { status: 'ready', data: true }; });

  it('shows members the feed and posts to it', async () => {
    h.posts = { status: 'ready', data: [{ id: 'p1', authorId: 'x', authorName: 'Ana', authorPhoto: '', content: 'Hello all', createdAt: null }] };
    await mount();
    expect(host.querySelector('[data-community-space="youth"]')).not.toBeNull();
    expect(host.querySelector('[data-post="p1"]')!.textContent).toContain('Ana');
    expect(host.querySelector('[data-post="p1"]')!.textContent).toContain('Hello all');
    expect(button('Post')!.disabled).toBe(true);
    await type('Write something…', 'See you Friday');
    await click(button('Post'));
    expect(h.createPost).toHaveBeenCalledWith('grace', 'youth', 'See you Friday');
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps the draft and shows why when a post is refused', async () => {
    h.createPost.mockRejectedValue(new Error('Posts can be up to 500 characters.'));
    await mount();
    await type('Write something…', 'Too long');
    await click(button('Post'));
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Posts can be up to 500 characters.');
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Too long');
  });

  it('opens the first chat, switches chats and sends a message', async () => {
    h.channels = { status: 'ready', data: [{ id: 'general', name: 'General', lastMessage: '' }, { id: 'prayer', name: 'Prayer', lastMessage: '' }] };
    h.messages = { status: 'ready', data: [{ id: 'm1', senderId: 'x', senderName: 'Ana', content: 'Hi', createdAt: null }] };
    await mount();
    await click(button('Chat'));
    expect(h.messagesFor).toHaveBeenLastCalledWith('general');
    expect(host.querySelector('[data-message="m1"]')!.textContent).toContain('Hi');
    await click(button('# Prayer'));
    expect(h.messagesFor).toHaveBeenLastCalledWith('prayer');
    await type('Message', 'Praying for you');
    await click(button('Send'));
    expect(h.sendMessage).toHaveBeenCalledWith('grace', 'youth', 'prayer', 'Praying for you');
  });

  it('lets a member leave', async () => {
    await mount();
    await click(button('Leave community'));
    await click(button('Confirm leave'));
    expect(h.changeMembership).toHaveBeenCalledWith('grace', 'youth', false);
    expect(host.querySelector('[data-where]')!.textContent).toBe('/?communities=1');
  });

  it('opens a draft to the ministry admin, who cannot leave it', async () => {
    h.member = { status: 'ready', data: false };
    h.roster = 'admin';
    h.record = { status: 'ready', data: youth({ status: 'draft' }) };
    await mount();
    expect(host.querySelector('[data-community-space="youth"]')).not.toBeNull();
    expect(host.textContent).toContain('This community is a draft');
    expect(button('Leave community')).toBeUndefined();
  });
});
