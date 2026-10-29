import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), request: vi.fn() }));
vi.mock('@/firebase', () => ({ auth: { currentUser: { uid: 'self' } }, db: {} }));
vi.mock('firebase/firestore', () => ({ collection: (_db: unknown, ...path: string[]) => path.join('/'), doc: (_db: unknown, ...path: string[]) => path.join('/'), getDocs: h.list, getDoc: h.get }));
vi.mock('@/utils/auth-fetch', () => ({ authFetch: h.request }));
import { CommunityDataRequests } from './CommunityDataRequests';
import { DeleteCommunityData } from './DeleteCommunityData';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
const button = (label: string) => [...document.querySelectorAll('button')].find(item => item.textContent === label)!;
beforeEach(() => {
  vi.clearAllMocks();
  h.list.mockResolvedValue({ docs: [{ id: 'former', data: () => ({ status: 'left' }) }] });
  h.get.mockResolvedValue({ exists: () => true, data: () => ({ name: 'Former community' }) });
  h.request.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});
afterEach(async () => { await act(async () => root.render(null)); });
describe('community data request controls', () => {
  it('lets an account erase a former membership after confirmation and surfaces errors for retry', async () => {
    await act(async () => root.render(<CommunityDataRequests />));
    expect(h.list).not.toHaveBeenCalled();
    await act(async () => button('Manage community data').click());
    expect(h.list).toHaveBeenCalledExactlyOnceWith('users/self/memberships');
    expect(host.textContent).toContain('Former community');
    await act(async () => button('Delete community contact data').click());
    expect(document.querySelector('[role=dialog]')).toBeTruthy();
    expect(h.request).not.toHaveBeenCalled();
    h.request.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Deletion unavailable. Try again.' }) });
    await act(async () => button('Confirm data deletion').click());
    expect(document.querySelector('[role=alert]')?.textContent).toContain('Deletion unavailable');
    expect(host.textContent).toContain('Former community');
    await act(async () => button('Confirm data deletion').click());
    expect(h.request).toHaveBeenCalledWith('/api/community/delete-data', { method: 'POST', body: JSON.stringify({ tenantId: 'former' }) });
    expect(host.textContent).toContain('No retained community memberships.');
  });
  it('sends the selected member UID for an owner request and respects cancellation', async () => {
    const deleted = vi.fn();
    await act(async () => root.render(<DeleteCommunityData tenantId="target" uid="member" onDeleted={deleted} />));
    await act(async () => button('Delete community contact data').click());
    await act(async () => button('Cancel').click());
    expect(h.request).not.toHaveBeenCalled();
    await act(async () => button('Delete community contact data').click());
    await act(async () => button('Confirm data deletion').click());
    expect(h.request).toHaveBeenCalledWith('/api/community/delete-data', { method: 'POST', body: JSON.stringify({ tenantId: 'target', uid: 'member' }) });
    expect(deleted).toHaveBeenCalledOnce();
  });
  it('distinguishes a failed index read from an empty list', async () => {
    h.list.mockRejectedValue(new Error('Could not load retained memberships.'));
    await act(async () => root.render(<CommunityDataRequests />));
    await act(async () => button('Manage community data').click());
    expect(document.querySelector('[role=alert]')?.textContent).toContain('Could not load');
    expect(host.textContent).not.toContain('No retained community memberships.');
  });
});
