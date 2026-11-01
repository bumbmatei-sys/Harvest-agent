import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialAnalyticsView } from './SocialAnalyticsView';
import type { SocialAnalytics } from '@/lib/social/analytics';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });

const data: SocialAnalytics = {
  fromDate: '2026-10-29', toDate: '2026-10-31', truncated: false,
  posts: [
    { id: 'a', platform: 'instagram', content: 'Sunday recap', publishedAt: '2026-10-29T15:00:00Z', url: 'https://instagram.com/p/a', views: 100, likes: 10, comments: 1, shares: 2 },
    { id: 'b', platform: 'youtube', content: 'Full sermon', publishedAt: '2026-10-31T15:00:00Z', url: null, views: 300, likes: 5, comments: 0, shares: 0 },
  ],
};
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith(label))!;
const tile = (label: string) => host.querySelector(`[data-analytics-tile="${label}"]`)?.textContent;

describe('the scheduler Analytics tab (#582)', () => {
  it('shows the tiles, the daily chart and both lists, and filters by network', async () => {
    const load = vi.fn().mockResolvedValue(data);
    await act(async () => root.render(<SocialAnalyticsView load={load} />));
    expect(load).toHaveBeenCalledWith(30);
    expect(tile('Total views')).toBe('Total views4002 posts in 30 days');
    expect(tile('Engagement')).toContain('18');
    expect(tile('Most viewed')).toContain('300 views');
    expect(tile('Most liked')).toContain('Sunday recap');
    expect([...host.querySelectorAll<HTMLElement>('[data-chart-day]')].map((d) => [d.dataset.chartDay, d.dataset.views])).toEqual([
      ['2026-10-29', '100'], ['2026-10-30', '0'], ['2026-10-31', '300'],
    ]);
    expect(host.querySelector('[data-analytics-list="Top posts"] li')?.textContent).toContain('Full sermon');
    expect(host.querySelector('[data-analytics-list="Recent posts"] a')?.getAttribute('href')).toBe('https://instagram.com/p/a');
    await act(async () => { button('Instagram').click(); });
    expect(button('Instagram').getAttribute('aria-pressed')).toBe('true');
    expect(tile('Total views')).toBe('Total views1001 post in 30 days');
  });
  it('asks again for another range', async () => {
    const load = vi.fn().mockResolvedValue(data);
    await act(async () => root.render(<SocialAnalyticsView load={load} />));
    await act(async () => { button('7d').click(); });
    expect(load).toHaveBeenLastCalledWith(7);
    expect(button('7d').getAttribute('aria-pressed')).toBe('true');
  });
  it('says when a window was cut short, and when it could not load', async () => {
    await act(async () => root.render(<SocialAnalyticsView load={vi.fn().mockResolvedValue({ ...data, truncated: true })} />));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('the newest 2 posts only');
    await act(async () => root.render(null));
    await act(async () => root.render(<SocialAnalyticsView load={vi.fn().mockRejectedValue(new Error('down'))} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Could not load analytics. Please try again.');
  });
});
