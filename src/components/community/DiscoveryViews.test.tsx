import { act } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunitiesView, DiscoverView, CommunityAbout, filterListings, type Listing } from './DiscoveryViews';
import { Compass, ToolCase, Wallpaper, Mailbox, ClipboardList } from 'lucide-react';
import { NAV_ICONS } from '@/components/layout/nav-icons';

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
  it('shares only the founder-selected standard Lucide navigation icons', () => {
    expect(NAV_ICONS).toEqual({ signups: ClipboardList, discover: Compass, communities: ToolCase, website: Wallpaper, newsletter: Mailbox });
  });
  it('uses shared controls throughout the community surfaces', () => {
    const root = process.cwd();
    const sources = (dir: string): string[] => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
      const file = `${dir}/${entry.name}`;
      return entry.isDirectory() ? sources(file) : /\.tsx?$/.test(file) && !/\.test\./.test(file) ? [file] : [];
    });
    const files = [...sources('src/components/community'), ...sources('src/app/discover'), ...sources('src/app/api/community'), 'src/components/MainApp.tsx', 'src/components/AdminDashboard.tsx', 'src/components/admin-shell/AdminShellPreview.tsx'];
    const nativeControl = new RegExp('<' + '(?:button|input|select|textarea|dialog)' + '(?:\\s|>)');
    for (const file of files) expect(stripComments(readFileSync(path.join(root, file), 'utf8')), file).not.toMatch(nativeControl);
  });
  it('renders public cards, filters them and links to the tenant', async () => {
    await act(async () => root.render(<DiscoverView state={{ status: 'ready', data: listings }} />));
    expect(host.textContent).toContain('12 members');
    await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Grace'))!.click(); });
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://grace.theharvest.app');
    await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Back to discover'))!.click(); });
    const input = host.querySelector('input')!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(input, 'welcoming'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(host.textContent).toContain('Grace');
    expect(host.textContent).not.toContain('Hope');
  });
  it('disables the paid filter while all cards show Free', async () => {
    await act(async () => root.render(<DiscoverView state={{ status: 'ready', data: [{ ...listings[0], price: 12 }] }} />));
    expect(host.textContent).toContain('Free'); expect(host.textContent).not.toContain('$12');
    await act(async () => host.querySelector<HTMLElement>('[aria-label="Filter by price"]')!.click());
    const paid = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(item => item.textContent?.includes('Paid'));
    expect(paid?.getAttribute('aria-disabled')).toBe('true'); expect(paid?.textContent).toContain('Soon');
  });
  it('uses compact ratings and member counts on cards', async () => {
    await act(async () => root.render(<DiscoverView state={{ status: 'ready', data: [{ ...listings[0], memberCount: 1248, ratingAvg: 4.8, ratingCount: 24 }] }} />));
    expect(host.textContent).toContain('1,248 members');
    expect(host.textContent).toContain('4.8 (24)');
    expect(host.textContent).not.toContain('at listing');
    expect(host.querySelector('[aria-label="4.8 out of 5, 24 reviews"]')).toBeTruthy();
  });
  it('filters by search and price together', () => {
    const items = [listings[0], { ...listings[1], price: 12 }];
    expect(filterListings(items, ' WELCOMING ', 'free')).toEqual([items[0]]);
    expect(filterListings(items, '', 'paid')).toEqual([]);
    expect(filterListings(items, 'hope', 'free')).toEqual([items[1]]);
  });
  it('filters and sorts by published ratings', () => {
    const items = [{ ...listings[0], ratingAvg: 4.5, ratingCount: 2 }, { ...listings[1], ratingAvg: 3, ratingCount: 1 }, { ...listings[1], tenantId: 'c' }];
    expect(filterListings(items, '', 'all', 'four')).toEqual([items[0]]);
    expect(filterListings(items, '', 'all', 'sort').map(item => item.tenantId)).toEqual(['a', 'b', 'c']);
  });
  it('shows public details and gallery images in a carousel', async () => {
    const listing = { ...listings[0], coverUrl: 'https://example.com/cover.jpg', galleryUrls: ['https://example.com/gallery.jpg'], longDescription: 'First line\nSecond line', ownerName: 'Alex', isPublic: true };
    await act(async () => root.render(<CommunityAbout listing={listing} onBack={() => {}} />));
    expect(host.textContent).toContain('By Alex');
    expect(host.textContent).toContain('12 members');
    expect(host.textContent).not.toContain('at listing');
    expect(host.textContent).toContain('First line\nSecond line');
    expect(host.querySelector('[aria-roledescription="carousel"]')).toBeTruthy();
    expect(Array.from(host.querySelectorAll('img[alt="Grace cover"]')).map(image => image.getAttribute('src'))).toEqual(['https://example.com/cover.jpg', 'https://example.com/gallery.jpg']);
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
  it('offers a desktop header join and reserves space for the mobile join bar', async () => {
    await act(async () => root.render(<CommunityAbout listing={listings[0]} onBack={() => {}} />));
    const joins = [...host.querySelectorAll<HTMLAnchorElement>('a')].filter(link => link.textContent === 'Join Grace');
    expect(joins).toHaveLength(2);
    const desktop = joins.find(link => link.parentElement?.classList.contains('lg:block'))!;
    expect(desktop.parentElement?.classList.contains('hidden')).toBe(true);
    expect(desktop.parentElement?.parentElement?.querySelector('h2')?.textContent).toBe('Grace');
    const bar = joins.find(link => link.parentElement?.classList.contains('fixed'))!.parentElement!;
    expect(bar.classList.contains('lg:hidden')).toBe(true);
    expect(bar.classList.contains('bottom-[var(--community-bottom-nav-height,0px)]')).toBe(true);
    expect(host.querySelector('section')?.classList.contains('pb-[calc(77px+env(safe-area-inset-bottom))]')).toBe(true);
  });
  it('shows the account community and opens it or discovery', async () => {
    const enter = vi.fn(), discover = vi.fn();
    await act(async () => root.render(<CommunitiesView state={{ status: 'ready', data: [{ name: 'Grace' }] }} onEnter={enter} onDiscover={discover} />));
    expect(host.textContent).toContain('Grace');
    const buttons = host.querySelectorAll('button');
    await act(async () => { buttons[0].click(); buttons[1].click(); });
    expect(enter).toHaveBeenCalledOnce(); expect(discover).toHaveBeenCalledOnce();
  });
  it.each([ToolCase, Compass])('renders standard lucide navigation icons', async Icon => {
    await act(async () => root.render(<Icon size={20} className="example" aria-hidden="true" />));
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.classList.contains('lucide')).toBe(true);
    expect(svg.classList.contains('example')).toBe(true);
  });
});

describe('community branding', () => {
  it('scopes the selected accent to cards and the About page', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const item = { tenantId: 'brand', slug: 'brand', name: 'Brand', logoUrl: '', shortDescription: 'Hello', memberCount: 1, brandColor: '#112233' };
    await act(async () => root.render(<DiscoverView state={{ status: 'ready', data: [item] }} />));
    expect((host.querySelector('.community-brand-scope') as HTMLElement).style.getPropertyValue('--community-brand-light')).toBe('#112233');
    await act(async () => root.render(<CommunityAbout listing={item} onBack={() => {}} />));
    expect((host.querySelector('.community-brand-scope') as HTMLElement).style.getPropertyValue('--community-brand-light')).toBe('#112233');
    await act(async () => root.unmount());
    host.remove();
  });
});
