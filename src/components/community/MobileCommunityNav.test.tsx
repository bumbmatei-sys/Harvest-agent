import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '@/lib/community/settings';
import { Newspaper } from 'lucide-react';
import { CommunitySwitcher, MobileCommunityTabs, MobileCommunitySections, MobileProfileSheet, enabledMobileTabs } from './MobileCommunityNav';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
document.body.appendChild(host);
const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });

describe('mobile community navigation', () => {
  it('opens Communities and Discover through standard lucide tabs', async () => {
    const communities = vi.fn(), discover = vi.fn();
    await act(async () => root.render(<MobileCommunityTabs homeActive onHome={() => {}} onCommunities={communities} onDiscover={discover} onNotifications={() => {}} onProfile={() => {}} initial="M" />));
    const communityTab = host.querySelector<HTMLButtonElement>('[aria-label="Communities"]')!;
    const discoverTab = host.querySelector<HTMLButtonElement>('[aria-label="Discover"]')!;
    expect(communityTab.querySelector('.lucide-tool-case')).toBeTruthy();
    expect(discoverTab.querySelector('.lucide-compass')).toBeTruthy();
    await act(async () => { communityTab.click(); discoverTab.click(); });
    expect(communities).toHaveBeenCalledOnce(); expect(discover).toHaveBeenCalledOnce();
  });
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
    const renderSheet = (isAdmin: boolean) => <MobileProfileSheet open onOpenChange={() => {}} isAdmin={isAdmin} name="Alex Morgan" onProfile={() => {}} onAdmin={navigate} />;
    await act(async () => root.render(renderSheet(true)));
    const dashboard = [...document.body.querySelectorAll('button')].find(button => button.textContent === 'Admin dashboard');
    expect(dashboard).toBeTruthy();
    expect(document.body.textContent).toContain('Alex Morgan');
    expect(dashboard?.querySelector('.lucide-layout-dashboard')).toBeTruthy();
    const profile = [...document.body.querySelectorAll('button')].find(button => button.textContent === 'My profile and settings');
    expect(profile?.querySelector('.lucide-user-round')).toBeTruthy();
    expect(profile?.getAttribute('data-slot')).toBe('button');
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
