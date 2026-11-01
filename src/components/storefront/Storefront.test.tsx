import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyStorefront, newStorefrontBlock, type Storefront } from '@/lib/storefront/storefront';
import { StorefrontPage } from './StorefrontPage';
import { StorefrontBlogIndex } from './StorefrontBlogIndex';
import { AdminStorefront, type StorefrontApi, type StorefrontLoaded } from './AdminStorefront';

vi.mock('@/utils/auth-fetch', () => ({ authFetch: vi.fn() }));
vi.mock('@/components/ImageUpload', () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });

const ARTICLES = [
  { id: 'a1', title: 'Berlin school', category: 'Mission Report', excerpt: 'We went', image: null, publishedAt: '2026-10-13T00:00:00Z' },
  { id: 'a2', title: 'Thailand', category: 'Mission Report', excerpt: 'Gospel', image: null, publishedAt: '2026-10-12T00:00:00Z' },
  { id: 'a3', title: 'Kenya', category: 'Testimony', excerpt: 'Fire', image: null, publishedAt: '2026-10-11T00:00:00Z' },
  { id: 'a4', title: 'Suriname', category: 'Testimony', excerpt: 'Campaign', image: null, publishedAt: '2026-08-03T00:00:00Z' },
];

function page(blocks: Storefront['blocks']): Storefront {
  return { ...emptyStorefront('Grace Chapel'), profile: { name: 'Grace Chapel', bio: 'One life, one shot.', photoUrl: '' }, socials: [{ network: 'instagram', url: 'https://instagram.com/grace' }], blocks, published: true };
}
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); };

describe('the public Storefront', () => {
  it('shows the profile, socials and blocks, and the blog block shows three articles and View all', async () => {
    const blocks = [
      { ...newStorefrontBlock('link', 'l'), title: 'Our website', url: 'https://grace.test' },
      newStorefrontBlock('give', 'g'),
      { ...newStorefrontBlock('community', 'c'), targetId: 'youth' },
      newStorefrontBlock('blog', 'b'),
      { ...newStorefrontBlock('video', 'v'), url: 'https://youtu.be/abc' },
      newStorefrontBlock('events', 'e'),
    ];
    await act(async () => root.render(<StorefrontPage storefront={page(blocks)} tenantId="grace" articles={ARTICLES.slice(0, 3)} events={[]} titles={{ youth: 'Youth' }} />));
    expect(host.querySelector('h1')?.textContent).toBe('Grace Chapel');
    expect(host.querySelector('[aria-label="Instagram"]')?.getAttribute('href')).toBe('https://instagram.com/grace');
    const links = [...host.querySelectorAll<HTMLAnchorElement>('[data-storefront-link]')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([['Our website', 'https://grace.test'], ['GiveSupport the ministry.', '/giving'], ['Youth', '/community/grace/youth']]);
    expect(host.querySelectorAll('[data-storefront-blog] li')).toHaveLength(3);
    expect(host.querySelector('[data-storefront-view-all]')?.getAttribute('href')).toBe('/storefront/blog');
    expect(host.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc');
    // An events block with no upcoming events shows nothing rather than an empty card.
    expect(host.textContent).not.toContain('Upcoming events');
  });

  it('filters by category once there are two, and the preview never navigates', async () => {
    const blocks = [
      { ...newStorefrontBlock('category', 'c1'), title: 'Watch' },
      { ...newStorefrontBlock('link', 'l1'), title: 'Sermons', url: 'https://a.test' },
      { ...newStorefrontBlock('category', 'c2'), title: 'Serve' },
      { ...newStorefrontBlock('link', 'l2'), title: 'Volunteer', url: 'https://b.test' },
    ];
    await act(async () => root.render(<StorefrontPage storefront={page(blocks)} tenantId="grace" articles={[]} events={[]} preview />));
    const chips = () => [...host.querySelectorAll('[aria-label="Filter"] button')];
    expect(chips().map((b) => b.textContent)).toEqual(['All', 'Watch', 'Serve']);
    await click(chips()[2]);
    expect([...host.querySelectorAll('[data-storefront-link]')].map((a) => a.textContent)).toEqual(['Volunteer']);
    expect(host.querySelector('[data-storefront-link]')?.hasAttribute('href')).toBe(false);
  });
});

describe('the Storefront blog View all page', () => {
  it('searches and filters by category, with a way back', async () => {
    await act(async () => root.render(<StorefrontBlogIndex articles={ARTICLES} accent="#C9963A" name="Grace Chapel" />));
    expect(host.querySelector('[aria-label="Back to Grace Chapel"]')?.getAttribute('href')).toBe('/storefront');
    const shown = () => [...host.querySelectorAll<HTMLElement>('[data-storefront-article]')].map((a) => a.dataset.storefrontArticle);
    expect(shown()).toEqual(['a1', 'a2', 'a3', 'a4']);
    await click([...host.querySelectorAll('[aria-label="Categories"] button')].find((b) => b.textContent === 'Testimony'));
    expect(shown()).toEqual(['a3', 'a4']);
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'kenya');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(shown()).toEqual(['a3']);
  });
});

describe('the Storefront editor', () => {
  function api(storefront = page([])) {
    const saves: Storefront[] = [];
    const value: StorefrontApi = {
      load: vi.fn(async (): Promise<StorefrontLoaded> => ({
        storefront, subdomain: 'grace', articles: ARTICLES.slice(0, 3), events: [],
        choices: { community: [{ id: 'youth', title: 'Youth' }], course: [], form: [] },
      })),
      save: vi.fn(async (next: Storefront) => { saves.push(next); return next; }),
    };
    return { value, saves };
  }
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);

  it('adds blocks from the Add block list, reorders, hides and saves them', async () => {
    const harness = api();
    await act(async () => root.render(<AdminStorefront api={harness.value} />));
    await act(async () => { await Promise.resolve(); });
    expect(button('Saved')?.disabled).toBe(true);
    await click(button('Add block'));
    expect(document.querySelectorAll('[data-add-block]')).toHaveLength(13);
    await click(document.querySelector('[data-add-block="blog"]'));
    await click(button('Add block'));
    await click(document.querySelector('[data-add-block="give"]'));
    expect([...host.querySelectorAll<HTMLElement>('[data-storefront-block]')].map((b) => b.dataset.storefrontBlock)).toEqual(['blog', 'give']);
    await click(host.querySelectorAll('[data-storefront-block="give"] [aria-label="Move up"]')[0]);
    expect([...host.querySelectorAll<HTMLElement>('[data-storefront-block]')].map((b) => b.dataset.storefrontBlock)).toEqual(['give', 'blog']);
    // The live preview follows the draft: the blog block shows the articles.
    expect(host.querySelectorAll('[data-storefront-preview] [data-storefront-blog] li')).toHaveLength(3);
    await click(host.querySelector('[data-storefront-block="blog"] [role="switch"]'));
    expect(host.querySelector('[data-storefront-preview] [data-storefront-blog]')).toBeNull();
    await click(button('Save'));
    expect(harness.saves).toHaveLength(1);
    expect(harness.saves[0].blocks.map((b) => [b.type, b.enabled])).toEqual([['give', true], ['blog', false]]);
    expect(button('Saved')).toBeTruthy();
  });

  it('turns the page on and shows its address', async () => {
    const harness = api({ ...page([]), published: false });
    await act(async () => root.render(<AdminStorefront api={harness.value} />));
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector('[data-storefront-publish]')?.textContent).toContain('Your page is offhttps://grace.theharvest.app/storefront');
    await click(host.querySelector('[aria-label="Page is live"]'));
    await click(button('Save'));
    expect(harness.saves[0].published).toBe(true);
  });
});
