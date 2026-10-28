import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '@/lib/community/settings';
import { Newspaper } from 'lucide-react';
import { CommunitySwitcher, MobileCommunitySections, MobileProfileSheet, enabledMobileTabs } from './MobileCommunityNav';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
document.body.appendChild(host);
const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });

describe('mobile community navigation', () => {
  it('hides disabled sections', async () => {
    const modules = defaultCommunitySettings().modules; modules.map = false;
    const tabs = enabledMobileTabs(['news', 'map', 'events'].map(id => ({ id, label: id, icon: Newspaper, active: false, onClick: vi.fn() })), modules);
    await act(async () => root.render(<MobileCommunitySections tabs={tabs} active="news" />));
    expect(host.textContent).toContain('news');
    expect(host.textContent).toContain('events');
    expect(host.textContent).not.toContain('map');
  });
  it('lets an admin open the dashboard and hides it from members', async () => {
    const navigate = vi.fn();
    const renderSheet = (isAdmin: boolean) => <MobileProfileSheet open onOpenChange={() => {}} isAdmin={isAdmin} onProfile={() => {}} onAdmin={navigate} />;
    await act(async () => root.render(renderSheet(true)));
    const dashboard = [...document.body.querySelectorAll('button')].find(button => button.textContent === 'Admin dashboard');
    expect(dashboard).toBeTruthy();
    await act(async () => dashboard!.click());
    expect(navigate).toHaveBeenCalledOnce();
    await act(async () => root.render(renderSheet(false)));
    expect(document.body.textContent).not.toContain('Admin dashboard');
  });
  it('shows communities and opens Discover', async () => {
    const discover = vi.fn();
    await act(async () => root.render(<CommunitySwitcher open onOpenChange={() => {}} state={{ status: 'ready', data: [{ name: 'Grace' }, { name: 'Hope', href: 'https://hope.theharvest.app' }] }} onEnter={() => {}} onDiscover={discover} />));
    expect(document.body.textContent).toContain('Grace');
    expect(document.body.querySelector('a[href="https://hope.theharvest.app"]')).toBeTruthy();
    await act(async () => { [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Discover communities')!.click(); });
    expect(discover).toHaveBeenCalledOnce();
  });
});
