import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommunityMemberships, CrmCommunityFilters } from './CrmCommunityFilters';
import { NO_COMMUNITY_FILTERS } from '@/lib/crm-communities';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
async function render(node: React.ReactNode) {
  host = document.createElement('div'); document.body.appendChild(host);
  await act(async () => { root = createRoot(host); root.render(node); });
}
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('CRM community filters', () => {
  // WAS 'draws the three dropdowns with their current choices'; #577 adds source and dates.
  it('draws every filter with its current choice', async () => {
    await render(<CrmCommunityFilters value={{ ...NO_COMMUNITY_FILTERS, community: 'youth', communityStatus: 'left', email: 'subscribed', source: 'discover', dateField: 'left', from: '2026-01-01', to: '2026-03-31' }} onChange={vi.fn()} communities={[{ id: 'default', name: 'Grace' }, { id: 'youth', name: 'Youth' }]} />);
    const labels = [...host.querySelectorAll('[aria-label]')].map(el => [el.getAttribute('aria-label'), el.textContent?.replace('▼', '').trim()]);
    expect(labels).toEqual([
      ['Filter by community', 'Youth'],
      ['Filter by community status', 'Left'],
      ['Filter by newsletter', 'Subscribed'],
      // #577
      ['Filter by source', 'Discover'],
      ['Date to filter by', 'Left'],
      ['From date', ''],
      ['To date', ''],
    ]);
    expect((host.querySelector('[aria-label="From date"]') as HTMLInputElement).value).toBe('2026-01-01');
    expect((host.querySelector('[aria-label="To date"]') as HTMLInputElement).value).toBe('2026-03-31');
  });
  it('turns the status filter off when "No community" is chosen', async () => {
    await render(<CrmCommunityFilters value={{ ...NO_COMMUNITY_FILTERS, community: 'none' }} onChange={vi.fn()} communities={[]} />);
    const status = host.querySelector('[aria-label="Filter by community status"]') as HTMLButtonElement;
    expect(status.disabled || status.getAttribute('data-disabled') !== null || status.getAttribute('aria-disabled') === 'true').toBe(true);
  });
  it('shows one badge per community on a contact, with when they left', async () => {
    await render(<CommunityMemberships defaultName="Grace" contact={{ source: 'community', communities: {
      default: { name: 'Grace', status: 'active', joinedAt: new Date(0), leftAt: null },
      youth: { name: 'Youth', status: 'left', joinedAt: new Date(0), leftAt: new Date(Date.UTC(2026, 9, 1)) },
    } }} />);
    expect([...host.querySelectorAll('[data-testid="crm-communities"] > *')].map(b => b.textContent)).toEqual(['Grace · Active', 'Youth · Left 1 Oct 2026']);
  });
  it('draws nothing for a contact in no community', async () => {
    await render(<CommunityMemberships contact={{ source: 'manual' }} />);
    expect(host.querySelector('[data-testid="crm-communities"]')).toBeNull();
  });
});
