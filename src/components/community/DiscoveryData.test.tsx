import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunitiesData, DiscoverData } from './DiscoveryData';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn() }));
vi.mock('@/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ collection: (_db: unknown, ...parts: string[]) => parts.join('/'), doc: (_db: unknown, ...parts: string[]) => parts.join('/'), getDoc: mocks.getDoc, getDocs: mocks.getDocs }));
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); vi.resetAllMocks(); });
const snap = (data: unknown) => ({ exists: () => true, data: () => data });
describe('community data', () => {
  it('includes the legacy account tenant and links to it from another community', async () => {
    mocks.getDocs.mockResolvedValue({ docs: [] });
    mocks.getDoc.mockImplementation(async (path: string) => path === 'users/u' ? snap({ tenantId: 'one' }) : snap({ name: 'Grace', subdomain: 'grace', config: {} }));
    await act(async () => root.render(<CommunitiesData uid="u" currentTenantId="other" onEnter={() => {}} onDiscover={() => {}} />));
    expect(mocks.getDoc.mock.calls.map(call => call[0])).toEqual(['users/u', 'tenants/one/communityMembers/u', 'tenants/one']);
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/community/one');
  });
  it('surfaces a failed account read', async () => {
    mocks.getDoc.mockRejectedValue(new Error('offline'));
    await act(async () => root.render(<CommunitiesData uid="u" currentTenantId="one" onEnter={() => {}} onDiscover={() => {}} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not load');
  });
  it('reads public listings and rejects malformed destinations', async () => {
    mocks.getDocs.mockResolvedValue({ docs: [{ data: () => ({ tenantId: 'one', slug: 'grace', name: 'Grace', logoUrl: '', shortDescription: '', memberCount: 2 }) }] });
    await act(async () => root.render(<DiscoverData />));
    expect(mocks.getDocs).toHaveBeenCalledWith('discovery_listings');
    expect(host.textContent).toContain('Grace');
    await act(async () => root.render(null));
    mocks.getDocs.mockResolvedValue({ docs: [{ data: () => ({ tenantId: 'one', slug: 'evil.example', name: 'Grace', logoUrl: '', shortDescription: '', memberCount: 2 }) }] });
    await act(async () => root.render(<DiscoverData />));
    expect(host.querySelector('[role="alert"]')).toBeTruthy();
    expect(host.querySelector('a')).toBeNull();
  });
});

describe('joined community index', () => {
  it('deduplicates the legacy tenant, excludes leaves, and opens a joined community', async () => {
    const docs: Record<string, unknown> = {
      'users/u': { tenantId: 'one' },
      'tenants/one/communityMembers/u': { status: 'left' },
      'tenants/two/communityMembers/u': { status: 'active' },
      'tenants/two': { name: 'Second community', subdomain: 'second', config: {} },
    };
    mocks.getDoc.mockImplementation(async (path: string) => ({ exists: () => path in docs, data: () => docs[path] }));
    mocks.getDocs.mockResolvedValue({ docs: ['one', 'two'].map(id => ({ id, data: () => ({ tenantId: id, status: 'active' }) })) });
    await act(async () => root.render(<CommunitiesData uid="u" currentTenantId="one" onEnter={() => {}} onDiscover={() => {}} />));
    expect(host.textContent).toContain('Second community');
    expect(host.querySelectorAll('a')).toHaveLength(1);
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/community/two');
    expect(mocks.getDocs).toHaveBeenCalledWith('users/u/memberships');
    expect(mocks.getDoc.mock.calls.filter(([path]) => path === 'tenants/one/communityMembers/u')).toHaveLength(1);
  });
  it('lists joined communities for Free accounts whose personal workspace has no subdomain', async () => {
    const docs: Record<string, unknown> = {
      'users/u': { tenantId: 'free-personal' },
      'tenants/free-personal': { ownerId: 'u', name: 'My Ministry', plan: 'free' },
      'tenants/two/communityMembers/u': { status: 'active' },
      'tenants/two': { name: 'Joined community', subdomain: 'joined', config: {} },
    };
    mocks.getDoc.mockImplementation(async (path: string) => ({ exists: () => path in docs, data: () => docs[path] }));
    mocks.getDocs.mockResolvedValue({ docs: [{ id: 'two', data: () => ({ tenantId: 'two', status: 'active' }) }] });
    await act(async () => root.render(<CommunitiesData uid="u" currentTenantId={null} onEnter={() => {}} onDiscover={() => {}} />));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('Joined community');
    expect(host.textContent).not.toContain('My Ministry');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/community/two');
  });
  it('shows an error when the index read fails instead of an empty community list', async () => {
    mocks.getDoc.mockResolvedValue(snap({ tenantId: 'one' }));
    mocks.getDocs.mockRejectedValue(new Error('offline'));
    await act(async () => root.render(<CommunitiesData uid="u" currentTenantId="one" onEnter={() => {}} onDiscover={() => {}} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not load');
  });
});
