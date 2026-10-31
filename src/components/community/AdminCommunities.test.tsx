import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defaultCommunityRecord, newCommunityDraft } from '@/lib/community/communities';
import { defaultCommunitySettings } from '@/lib/community/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/utils/auth-fetch', () => ({ authFetch: h.fetch }));
import { AdminCommunities } from './AdminCommunities';

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const youth = { id: 'youth', ...newCommunityDraft('Youth'), status: 'draft', isDefault: false };
let list: Record<string, unknown>;
let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => { root = createRoot(container); root.render(<AdminCommunities tenantId="grace" defaultSetup={<div data-testid="default-setup" />} />); });
  await act(async () => { await Promise.resolve(); });
}
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
async function click(el: Element | undefined) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); }); }

beforeEach(() => {
  list = { communities: [defaultCommunityRecord('Grace Chapel', defaultCommunitySettings()), youth], limit: -1, defaultClosed: false };
  h.fetch.mockReset();
  h.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!init?.method) return json(list);
    return json({ ok: true, id: 'new-one' });
  });
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); document.body.innerHTML = ''; });

describe('admin Communities page', () => {
  it('lists every community like Products, the default first, with a New community button', async () => {
    await mount();
    expect(container.querySelector('h1')?.textContent).toBe('Communities');
    expect([...container.querySelectorAll('[data-community-row]')].map(r => r.getAttribute('data-community-row'))).toEqual(['default', 'youth']);
    expect(container.querySelector('[data-community-row="default"]')!.textContent).toContain('Default');
    expect(container.querySelector('[data-community-row="youth"]')!.textContent).toContain('Draft');
    expect(button('New community')!.disabled).toBe(false);
  });

  it('opens the existing setup for the default community and the editor for the others', async () => {
    await mount();
    await click(container.querySelector('[data-community-row="default"]')!.querySelector('button')!);
    expect(container.querySelector('[data-testid="default-setup"]')).not.toBeNull();
    await click(button('Communities'));
    await click(container.querySelector('[data-community-row="youth"]')!.querySelector('button')!);
    expect(container.querySelector('[data-community-editor="youth"]')).not.toBeNull();
    // The live preview redraws as the admin types (AGENTS.md: steps, options, preview).
    const preview = () => container.querySelector('[data-community-preview]')!;
    expect(preview().textContent).toContain('Youth');
    const nameInput = container.querySelector('[data-community-editor] input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput, 'Youth Night');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(preview().textContent).toContain('Youth Night');
    expect(preview().textContent).toContain('Join community');
    // Paid waits for the business entity that can take payments.
    const paid = [...container.querySelectorAll('[data-community-editor] button')].find(b => b.textContent?.startsWith('Paid')) as HTMLButtonElement;
    expect(paid.disabled).toBe(true);
    expect(paid.textContent).toContain('Coming soon');
    await click(button('Publish'));
    // #576: a free community that lets anyone in can be published from here.
    const publishButtons = () => [...container.querySelectorAll('[data-community-editor] button')].filter(b => b.textContent === 'Publish') as HTMLButtonElement[];
    expect(publishButtons().map(b => b.disabled)).toEqual([false, false]);
    await click(publishButtons()[1]);
    expect(h.fetch).toHaveBeenCalledWith('/api/communities/youth', expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"status":"published"') }));
    expect(container.textContent).toContain('Your community is live');
    expect(container.querySelector('[data-community-link]')!.textContent).toMatch(/\/community\/grace\/youth$/);
    expect(button('Unpublish')).toBeTruthy();
  });

  it('explains why an apply-first community cannot be published yet', async () => {
    list = { ...list, communities: [defaultCommunityRecord('Grace Chapel', defaultCommunitySettings()), { ...youth, joining: { mode: 'apply' } }] };
    await mount();
    await click(container.querySelector('[data-community-row="youth"]')!.querySelector('button')!);
    await click(button('Publish'));
    const publishButtons = [...container.querySelectorAll('[data-community-editor] button')].filter(b => b.textContent === 'Publish') as HTMLButtonElement[];
    expect(publishButtons.map(b => b.disabled)).toEqual([false, true]);
    expect(container.textContent).toContain('once approvals open');
  });

  it('disables New community at the plan limit and says why', async () => {
    list = { ...list, limit: 2 };
    await mount();
    expect(button('New community')!.disabled).toBe(true);
    expect(button('New community')!.title).toBe('Your plan includes 2 communities.');
  });

  it('asks before deleting the default community, explains the restore, then deletes', async () => {
    await mount();
    await click([...container.querySelector('[data-community-row="default"]')!.querySelectorAll('button')].find(b => b.textContent === 'Delete'));
    expect(document.body.textContent).toContain('Its posts and members are kept, so you can restore it');
    expect(h.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/communities/default'), expect.objectContaining({ method: 'DELETE' }));
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === 'Delete');
    await click(confirm);
    expect(h.fetch).toHaveBeenCalledWith('/api/communities/default?tenantId=grace', { method: 'DELETE' });
  });

  it('offers a restore once the default community is deleted', async () => {
    list = { communities: [youth], limit: -1, defaultClosed: true };
    await mount();
    expect(container.textContent).toContain('Your default community is deleted');
    await click(button('Restore'));
    expect(h.fetch).toHaveBeenCalledWith('/api/communities/default', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ tenantId: 'grace', restore: true }) }));
  });

  it('shows the server message when the list fails to load', async () => {
    h.fetch.mockResolvedValue(json({ error: 'Could not load communities. Please try again.' }, 503));
    await mount();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('Could not load communities. Please try again.');
  });
});
