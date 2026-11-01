import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockSocialClient, resetSocialMock } from '@/lib/social/mock-client';
import { SocialScheduler, socialViewFromRoute, type SocialView } from './SocialScheduler';
import { SocialAccountsSettings } from './SocialAccountsSettings';

const authFetch = vi.hoisted(() => vi.fn());
vi.mock('@/utils/auth-fetch', () => ({ authFetch }));
vi.mock('@/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const clock = new Date(Date.UTC(2024, 2, 15, 12));

describe('the Social media section (sidebar rows, Planner tabs, Accounts in Settings)', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { resetSocialMock(); authFetch.mockReset(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); });

  it('maps a route to its section, opening the Planner on Compose by default', () => {
    expect([undefined, null, 'planner', 'compose', 'nonsense'].map(socialViewFromRoute)).toEqual(['compose', 'compose', 'compose', 'compose', 'compose']);
    expect(['analytics', 'inbox', 'autodm', 'calendar', 'queue', 'accounts'].map(socialViewFromRoute)).toEqual(['analytics', 'inbox', 'autodm', 'calendar', 'queue', 'accounts']);
  });

  async function show(view: SocialView, onManageAccounts?: () => void) {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(<SocialScheduler initial={{ ...workspace, entitled: true }} initialView={view} onUpgrade={() => {}} onManageAccounts={onManageAccounts}
        analyticsLoader={async () => ({ fromDate: '2024-02-15', toDate: '2024-03-15', posts: [], truncated: false })} />);
    });
  }
  const title = () => container.querySelector('h1')?.textContent;
  const tabs = () => [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);

  it('titles each section and shows tabs only in the Planner', async () => {
    await show('analytics');
    expect([title(), tabs()]).toEqual(['Analytics', []]);
    await show('calendar');
    expect([title(), tabs()]).toEqual(['Planner', ['Compose', 'Calendar', 'Queue']]);
    expect(container.querySelector('[data-testid="social-calendar"]')).toBeTruthy();
    // A sidebar row changes the route, and the screen follows without a remount.
    await show('autodm');
    expect([title(), tabs()]).toEqual(['Auto-DM', []]);
  });

  it('shows the connected accounts in the composer with a plus that opens Social accounts', async () => {
    const onManageAccounts = vi.fn();
    await show('compose', onManageAccounts);
    const plus = container.querySelector<HTMLButtonElement>('[data-testid="composer-add-account"]');
    expect(plus?.getAttribute('aria-label')).toBe('Connect another account');
    await act(async () => { plus!.click(); });
    expect(onManageAccounts).toHaveBeenCalledTimes(1);
    await show('compose');
    expect(container.querySelector('[data-testid="composer-add-account"]')).toBeNull();
  });

  it('lists and connects accounts from Settings, and says so when the plan has no scheduler', async () => {
    authFetch.mockImplementation(async (url: string) => String(url).includes('bootstrap')
      ? { ok: true, status: 200, json: async () => ({ accounts: [{ id: 'ig', platform: 'instagram', username: 'grace', displayName: 'Grace Chapel' }], sample: false }) }
      : { ok: true, status: 200, json: async () => ({ authUrl: null }) });
    await act(async () => { root.render(<SocialAccountsSettings />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="social-accounts"]')?.textContent).toContain('Grace Chapel · @grace');
    await act(async () => { (container.querySelector('[data-testid="connect-facebook"]') as HTMLButtonElement).click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(authFetch).toHaveBeenCalledWith('/api/social/connect', expect.objectContaining({ method: 'POST', body: JSON.stringify({ platform: 'facebook' }) }));
    expect(container.textContent).toContain('This preview does not connect a real account.');

    authFetch.mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({ error: 'social_scheduler_not_entitled' }) }));
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await act(async () => { root.render(<SocialAccountsSettings />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('Social scheduling is not on this plan.');
  });
});
