import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '@/lib/community/settings';
import { Newspaper } from 'lucide-react';
import { CommunitySwitcher, MobileCommunityTabs, enabledMobileTabs, splitMobileTabs } from './MobileCommunityNav';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
document.body.appendChild(host);
const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });

describe('mobile community navigation', () => {
  it('shows enabled tabs and puts overflow in More', async () => {
    const modules = defaultCommunitySettings().modules; modules.map = false;
    expect(enabledMobileTabs([{ id: 'news' }, { id: 'map' }, { id: 'events' }], modules).map(t => t.id)).toEqual(['news', 'events']);
    const enabled = ['Feed', 'Courses', 'Events', 'Groups', 'Bible', 'Blog'];
    const tabs = enabled.map(label => ({ id: label, label, icon: Newspaper, active: false, onClick: vi.fn() }));
    expect(splitMobileTabs(tabs).primary.map(t => t.label)).toEqual(enabled.slice(0, 4));
    await act(async () => root.render(<MobileCommunityTabs tabs={tabs} />));
    expect(host.textContent).not.toContain('Bible');
    expect(host.textContent).not.toContain('Map');
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'More')!.click(); });
    expect(document.body.textContent).toContain('Bible');
    expect(document.body.textContent).toContain('Blog');
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
