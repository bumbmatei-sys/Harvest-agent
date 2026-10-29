import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '@/lib/community/settings';
const h = vi.hoisted(() => ({ docs: {} as Record<string, any>, request: vi.fn(), memberListener: undefined as undefined | ((snapshot: any) => void) }));
vi.mock('@/firebase', () => ({ db: {}, auth: { currentUser: { getIdTokenResult: async () => ({ claims: {} }) } } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDoc: async (path: string) => ({ exists: () => path in h.docs, data: () => h.docs[path] }),
  onSnapshot: (_ref: unknown, next: (snapshot: any) => void) => { h.memberListener = next; return vi.fn(); },
}));
vi.mock('@/utils/auth-fetch', () => ({ authFetch: h.request }));
vi.mock('@/utils/tenant.utils', () => ({ checkRosterAdminStatus: async () => 'not-admin' }));
vi.mock('@/store/useAppStore', () => ({ useAppStore: () => ({ currentUser: { uid: 'u' } }) }));
vi.mock('@/contexts/TenantContext', () => ({ TenantProvider: ({ children }: any) => children }));
vi.mock('@/components/MainApp', () => ({ default: () => <p>Real member view mounted</p> }));
import { CommunityMemberPage } from './CommunityMemberPage';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)!;
function Destination() { return <p>{useLocation().pathname}{useLocation().search}</p>; }
async function mount(path: string) {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/community/:tenantId" element={<CommunityMemberPage />} /><Route path="/" element={<Destination />} /></Routes></MemoryRouter>));
}
beforeEach(() => {
  vi.clearAllMocks(); h.memberListener = undefined;
  h.docs = { 'users/u': { tenantId: 'other', role: 'admin' }, 'tenants/a': { name: 'Grace', ownerId: 'owner' }, 'tenants/a/settings/community': defaultCommunitySettings() };
  h.request.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});
afterEach(async () => { await act(async () => root.render(null)); });
describe('community member route', () => {
  it.each([['discover', 'discover'], ['website', 'website'], ['', 'link']])('joins with %s source, consent and enters the community', async (src, expected) => {
    await mount(`/community/a?join=1${src ? `&src=${src}` : ''}`);
    expect(document.body.textContent).toContain('By joining, you agree that the community owner can contact you and can see your name, email and answers.');
    expect(host.textContent).not.toContain('Real member view mounted');
    await act(async () => button('Join community').click());
    expect(JSON.parse(h.request.mock.calls[0][1].body)).toMatchObject({ tenantId: 'a', source: expected, consent: true, acceptedConsentVersion: 2 });
    expect(host.textContent).toContain('Real member view mounted');
  });
  it('shows already-member state and repairs the contact before opening', async () => {
    h.docs['tenants/a/communityMembers/u'] = { status: 'active' };
    await mount('/community/a?join=1&src=discover');
    expect(host.textContent).toContain('already a member');
    await act(async () => button('Open community').click());
    expect(h.request).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Real member view mounted');
  });
  it('keeps API errors visible in the consent popup when contact repair fails after membership commits', async () => {
    h.request.mockImplementation(async () => {
      h.memberListener?.({ data: () => ({ status: 'active' }) });
      return { ok: false, json: async () => ({ error: 'Could not update community membership. Please try again.' }) };
    });
    await mount('/community/a?join=1');
    await act(async () => button('Join community').click());
    expect(document.querySelector('[role=alert]')?.textContent).toContain('Could not update community membership');
    expect(host.textContent).not.toContain('Real member view mounted');
  });
  it('confirms leave, revokes content, preserves failure for retry and returns to the refreshed list', async () => {
    h.docs['tenants/a/communityMembers/u'] = { status: 'active' };
    await mount('/community/a');
    await act(async () => button('Leave community').click());
    h.request.mockImplementationOnce(async () => {
      h.memberListener?.({ data: () => ({ status: 'left' }) });
      return { ok: false, json: async () => ({ error: 'Contact update unavailable.' }) };
    });
    await act(async () => button('Confirm leave').click());
    expect(document.querySelector('[role=alert]')?.textContent).toBe('Contact update unavailable.');
    expect(host.textContent).not.toContain('Real member view mounted');
    await act(async () => button('Confirm leave').click());
    expect(h.request).toHaveBeenLastCalledWith('/api/community/leave', expect.objectContaining({ body: JSON.stringify({ tenantId: 'a' }) }));
    expect(host.textContent).toBe('/?communities=1');
  });
  it.each(['owner', 'admin'])('does not offer Leave to a scoped %s', async kind => {
    h.docs['tenants/a/communityMembers/u'] = { status: 'active' };
    if (kind === 'owner') h.docs['tenants/a'].ownerId = 'u';
    else h.docs['users/u'].tenantId = 'a';
    await mount('/community/a');
    expect(host.textContent).not.toContain('Leave community');
  });
});
