import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunityAbout, type Listing } from './DiscoveryViews';
import { CommunityReviews, ReviewDialog } from './CommunityReviews';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const listing: Listing = { tenantId: 'one', name: 'Grace', slug: 'grace', logoUrl: '', shortDescription: 'Welcome', memberCount: 3, ratingAvg: 4.5, ratingCount: 2 };
const response = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); vi.unstubAllGlobals(); });

describe('community reviews', () => {
  it('shows the rating summary, reviews and Harvest link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ reviews: [{ authorName: 'Alex M.', rating: 5, text: 'A kind community', createdAt: '2024-01-01T00:00:00Z', memberSince: null }], nextOffset: null })));
    await act(async () => root.render(<CommunityAbout listing={listing} onBack={() => {}} />));
    expect(host.textContent).toContain('4.5 · 2 reviews'); expect(host.textContent).toContain('A kind community');
    expect(Array.from(host.querySelectorAll('a')).find(a => a.textContent === 'Made with Harvest')?.getAttribute('href')).toBe('https://theharvest.app');
  });
  it('sorts reviews through the API', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ reviews: [], nextOffset: null })); vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<CommunityReviews tenantId="one" />));
    await act(async () => { host.querySelector<HTMLElement>('[aria-label="Sort reviews"]')!.click(); });
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(element => element.textContent === 'Highest');
    expect(option).toBeTruthy(); await act(async () => option!.click());
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('sort=highest'))).toBe(true);
  });
  it('requires a rating and limits review text', async () => {
    const save = vi.fn(); await act(async () => root.render(<ReviewDialog open onOpenChange={() => {}} review={null} onSave={save} onDelete={async () => {}} />));
    const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent === 'Save review')!;
    await act(async () => button.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Choose a star rating.');
    expect(document.querySelector('textarea')?.getAttribute('maxlength')).toBe('1000'); expect(save).not.toHaveBeenCalled();
  });
  it('does not offer review controls to admins', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(response(url.includes('mine=1') ? { canReview: false, review: null } : { reviews: [], nextOffset: null }))));
    const access = { getToken: async () => 'token' }; await act(async () => root.render(<CommunityReviews tenantId="one" access={access} />));
    expect(host.textContent).toContain('No reviews yet.'); expect(host.textContent).not.toContain('Write a review');
  });
});
