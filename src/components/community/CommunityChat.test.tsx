import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NewGroupDialog } from './NewGroupDialog';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fx = vi.hoisted(() => ({ role: 'user' }));
vi.mock('@/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'member', displayName: 'Member', email: 'member@test.com', getIdToken: async () => 'token' } } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }), doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }), query: (ref: any, ...filters: any[]) => ({ ...ref, filters }),
  orderBy: () => ({}), limit: () => ({}), getDoc: async () => ({ exists: () => true, data: () => ({ role: fx.role, displayName: 'Member' }) }), getDocs: async () => ({ docs: [] }),
  onSnapshot: (q: any, callback: (snapshot: unknown) => void) => {
    const groups = [ { id: 'legacy', name: 'Legacy group', members: ['member'] }, { id: 'selected', name: 'Selected group', audience: 'selected', members: ['member'] }, { id: 'all-members', name: 'All members', audience: 'all', members: [] }, { id: 'private', name: 'Admin secrets', audience: 'admins', members: ['member'] } ];
    const dms = [{ id: 'admin-dm', participants: ['member', 'admin'], participantNames: { admin: 'Pastor' } }, { id: 'member-dm', participants: ['member', 'other'], participantRoles: { member: 'user', other: 'user' }, participantNames: { other: 'Other member' } }];
    const docs = q.path.endsWith('/channels') ? groups.filter(g => (q.filters || []).every((f: any) => !f.field || (f.op === '==' ? (g as any)[f.field] === f.value : ((g as any)[f.field] as string[] | undefined)?.includes(f.value)))) : q.path.endsWith('/directMessages') ? dms : [];
    callback({ docs: docs.map(g => ({ id: g.id, data: () => g })) }); return () => {};
  },
  addDoc: async () => ({ id: 'new' }), updateDoc: async () => {}, serverTimestamp: () => 'time', Timestamp: class {},
}));
vi.mock('@/utils/tenant-scope', () => ({ getTenantScope: async () => 'tenant', isPlatformContext: () => false, PLATFORM_TENANT_ID: 'harvest' }));
vi.mock('@/utils/super-admins', () => ({ isSuperAdminEmail: () => false }));
vi.mock('@/lib/dm', () => ({ getOrCreateDm: vi.fn() }));
import UserMessages from '../UserMessages';

let root: Root; let host: HTMLDivElement;
async function mount(element: React.ReactNode) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); await act(async () => { root.render(element); await Promise.resolve(); await Promise.resolve(); }); }
function button(text: string) { return Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!; }
function input(label: string) { return Array.from(document.querySelectorAll('label')).find(l => l.textContent?.trim() === label)!.querySelector('input')!; }
async function change(el: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function click(el: HTMLElement) { await act(async () => { el.click(); await Promise.resolve(); }); }
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });

describe('member groups', () => {
  it('pins All members and shows legacy groups and direct messages while hiding admin-only groups', async () => {
    await mount(<UserMessages onBack={() => {}} />);
    expect(host.textContent).toContain('#All members'); expect(host.textContent).toContain('#Selected group');
    expect(host.textContent!.indexOf('#All members')).toBeLessThan(host.textContent!.indexOf('#Selected group'));
    expect(host.textContent).not.toContain('#Admin secrets'); expect(host.textContent).not.toContain('New Message');
    expect(host.textContent).toContain('Pastor'); expect(host.textContent).toContain('Other member'); expect(host.textContent).toContain('#Legacy group');
  });
  it('allows replies to legacy admin threads and makes member threads read-only', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => ({ isAdmin: url.includes('admin-dm') }) })));
    await mount(<UserMessages onBack={() => {}} />);
    await click(button('PPastor'));
    expect(host.querySelector('input[placeholder="Type a message..."]')).not.toBeNull();
    await click(button('OOther member'));
    expect(host.textContent).toContain('Direct messages between members are turned off');
    expect(host.querySelector('input[placeholder="Type a message..."]')).toBeNull();
    vi.unstubAllGlobals();
  });
});
describe('new group' , () => {
  it('creates a selected group with only the chosen people', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    await mount(<NewGroupDialog open onOpenChange={() => {}} people={[{ id: 'a', displayName: 'Alice' }, { id: 'b', displayName: 'Bob' }]} loadingPeople={false} peopleError={false} onCreate={create} />);
    await change(input('Group name'), ' Team '); await change(input('Description (optional)'), ' Welcome ');
    await click(Array.from(document.querySelectorAll('label')).find(l => l.textContent?.trim() === 'Selected people')!.querySelector('[role=radio]') as HTMLElement); expect(button('Create group').disabled).toBe(true);
    await change(document.querySelector('input[aria-label="Search people"]')!, 'Alice');
    expect(document.body.textContent).not.toContain('Bob');
    await click(Array.from(document.querySelectorAll('label')).find(l => l.textContent?.trim().endsWith('Alice'))!);
    await click(button('Create group'));
    expect(create).toHaveBeenCalledWith({ name: 'Team', description: 'Welcome', audience: 'selected', members: ['a'] });
  });
  it('offers everyone and admin-only audiences and reports save errors', async () => {
    const create = vi.fn().mockRejectedValue(new Error('offline'));
    await mount(<NewGroupDialog open onOpenChange={() => {}} people={[]} loadingPeople={false} peopleError={false} onCreate={create} />);
    expect(Array.from(document.querySelectorAll('label')).find(l => l.textContent?.trim() === 'Everyone')!.querySelector('[role=radio]')?.getAttribute('aria-checked')).toBe('true'); await change(input('Group name'), 'Leaders'); await click(Array.from(document.querySelectorAll('label')).find(l => l.textContent?.trim() === 'Admins only')!.querySelector('[role=radio]') as HTMLElement); await click(button('Create group'));
    expect(create).toHaveBeenCalledWith({ name: 'Leaders', description: '', audience: 'admins', members: [] });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not create');
  });
});
