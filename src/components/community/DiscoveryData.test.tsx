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
  it('reads the account tenant only and links to it when on a different tenant', async () => {
    mocks.getDoc.mockImplementation(async (path: string) => path === 'users/u' ? snap({ tenantId: 'one' }) : snap({ name: 'Grace', subdomain: 'grace', config: {} }));
    await act(async () => root.render(<CommunitiesData uid="u" currentTenantId="other" onEnter={() => {}} onDiscover={() => {}} />));
    expect(mocks.getDoc.mock.calls.map(call => call[0])).toEqual(['users/u', 'tenants/one']);
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://grace.theharvest.app');
  });
  it('does not treat the Free account identity as a community', async () => {
    mocks.getDoc.mockResolvedValue(snap({ tenantId: 'free-id' }));
    await act(async () => root.render(<CommunitiesData uid="u" currentTenantId={null} accountTenantId="free-id" onEnter={() => {}} onDiscover={() => {}} />));
    expect(mocks.getDoc.mock.calls.map(call => call[0])).toEqual(['users/u']);
    expect(host.textContent).toContain('You have no communities yet.');
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
