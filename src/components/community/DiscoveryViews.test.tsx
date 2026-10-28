import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunitiesView, DiscoverView, CommunityAbout, filterListings, type Listing } from './DiscoveryViews';
import { CommunityIcon } from '../icons/CommunityIcon';
import { DiscoverIcon } from '../icons/DiscoverIcon';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const listings: Listing[] = [
  { tenantId: 'a', slug: 'grace', name: 'Grace', logoUrl: '', shortDescription: 'A welcoming community', memberCount: 12 },
  { tenantId: 'b', slug: 'hope', name: 'Hope', logoUrl: '', shortDescription: 'Meet together', memberCount: 1 },
];
const host = document.createElement('div');
document.body.appendChild(host);
const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });
describe('community views', () => {
  it('renders public cards, filters them and links to the tenant', async () => {
    await act(async () => root.render(<DiscoverView state={{ status: 'ready', data: listings }} />));
    expect(host.textContent).toContain('12 members at listing');
    await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Grace'))!.click(); });
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://grace.theharvest.app');
    await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Back to discover'))!.click(); });
    const input = host.querySelector('input')!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(input, 'welcoming'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(host.textContent).toContain('Grace');
    expect(host.textContent).not.toContain('Hope');
  });
  it('filters by search and price together', () => {
    const items = [listings[0], { ...listings[1], price: 12 }];
    expect(filterListings(items, ' WELCOMING ', 'free')).toEqual([items[0]]);
    expect(filterListings(items, '', 'paid')).toEqual([items[1]]);
    expect(filterListings(items, 'hope', 'free')).toEqual([]);
  });
  it('shows public details and switches gallery images', async () => {
    const listing = { ...listings[0], coverUrl: 'https://example.com/cover.jpg', galleryUrls: ['https://example.com/gallery.jpg'], longDescription: 'First line\nSecond line', ownerName: 'Alex', isPublic: true };
    await act(async () => root.render(<CommunityAbout listing={listing} onBack={() => {}} />));
    expect(host.textContent).toContain('By Alex');
    expect(host.textContent).toContain('First line\nSecond line');
    await act(async () => (host.querySelector('[aria-label="Show image 2"]') as HTMLButtonElement).click());
    expect(host.querySelector('img[alt="Grace cover"]')?.getAttribute('src')).toBe('https://example.com/gallery.jpg');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://grace.theharvest.app');
  });
  it('distinguishes loading, errors and empty listings', async () => {
    await act(async () => root.render(<DiscoverView state={{ status: 'loading' }} />));
    expect(host.querySelector('[aria-label="Loading communities"]')).toBeTruthy();
    await act(async () => root.render(<DiscoverView state={{ status: 'error', message: 'Read failed' }} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Read failed');
    await act(async () => root.render(<DiscoverView state={{ status: 'ready', data: [] }} />));
    expect(host.textContent).toContain('No public communities to discover yet.');
  });
  it('shows the account community and opens it or discovery', async () => {
    const enter = vi.fn(), discover = vi.fn();
    await act(async () => root.render(<CommunitiesView state={{ status: 'ready', data: [{ name: 'Grace' }] }} onEnter={enter} onDiscover={discover} />));
    expect(host.textContent).toContain('Grace');
    const buttons = host.querySelectorAll('button');
    await act(async () => { buttons[0].click(); buttons[1].click(); });
    expect(enter).toHaveBeenCalledOnce(); expect(discover).toHaveBeenCalledOnce();
  });
  it.each([CommunityIcon, DiscoverIcon])('renders scalable icons with an optional accent', async Icon => {
    await act(async () => root.render(<Icon size={20} className="example" />));
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toBe('example');
    expect(svg.querySelector('[fill-opacity]')).toBeNull();
    await act(async () => root.render(<Icon active />));
    expect(svg.querySelector('[fill-opacity="0.15"]')).toBeTruthy();
  });
  it('uses the tenant accent for the compass needle', async () => {
    await act(async () => root.render(<DiscoverIcon />));
    expect(host.querySelector('path[fill="var(--brand-color)"]')).toBeTruthy();
  });
});
