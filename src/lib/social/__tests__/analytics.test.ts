import { describe, expect, it } from 'vitest';
import {
  analyticsWindow, countsByPlatform, filterByPlatform, isAnalyticsRange, readAnalyticsPost, recentPosts, topPosts, totalsOf, viewsByDay,
  type AnalyticsPost,
} from '../analytics';
import { LiveSocialClient } from '../live-client';

const post = (id: string, over: Partial<AnalyticsPost> = {}): AnalyticsPost => ({
  id, platform: 'instagram', content: id, publishedAt: '2026-10-20T15:00:00Z', url: null, views: 0, likes: 0, comments: 0, shares: 0, ...over,
});

describe('scheduler analytics (#582)', () => {
  it('reads a provider row, counting impressions where a network reports no views', () => {
    expect(readAnalyticsPost({
      _id: 'p1', platform: 'facebook', content: 'Hi', publishedAt: '2026-10-20T15:00:00Z', platformPostUrl: 'https://facebook.com/p1',
      analytics: { impressions: 120, likes: 4, comments: 2, shares: 1.4, saves: 9 },
    })).toEqual({ id: 'p1', platform: 'facebook', content: 'Hi', publishedAt: '2026-10-20T15:00:00Z', url: 'https://facebook.com/p1', views: 120, likes: 4, comments: 2, shares: 1 });
    expect(readAnalyticsPost({ _id: 'p2', platform: 'tiktok', publishedAt: '2026-10-20T15:00:00Z', analytics: { views: 50, impressions: 999 } })?.views).toBe(50);
  });
  it('drops rows it cannot place, and never trusts a non-https link or a negative count', () => {
    expect(readAnalyticsPost({ _id: 'x', platform: 'myspace', publishedAt: '2026-10-20T15:00:00Z' })).toBeNull();
    expect(readAnalyticsPost({ _id: 'x', platform: 'instagram' })).toBeNull();
    expect(readAnalyticsPost({ platform: 'instagram', publishedAt: '2026-10-20T15:00:00Z' })).toBeNull();
    const row = readAnalyticsPost({ _id: 'x', platform: 'instagram', publishedAt: '2026-10-20T15:00:00Z', platformPostUrl: 'javascript:alert(1)', analytics: { likes: -5 } })!;
    expect(row.url).toBeNull();
    expect(row.likes).toBe(0);
  });
  it('takes only the offered ranges, and a window that ends today', () => {
    expect([7, 30, 90].every(isAnalyticsRange)).toBe(true);
    expect([0, 31, '30'].some(isAnalyticsRange)).toBe(false);
    expect(analyticsWindow(7, new Date('2026-11-01T03:00:00Z'))).toEqual({ fromDate: '2026-10-26', toDate: '2026-11-01' });
  });
  it('sums, filters, ranks and charts what the provider reported', () => {
    const posts = [
      post('a', { views: 10, likes: 5, publishedAt: '2026-10-19T10:00:00Z' }),
      post('b', { platform: 'youtube', views: 30, likes: 1, comments: 2, shares: 3, publishedAt: '2026-10-21T10:00:00Z' }),
      post('c', { views: 10, likes: 9, publishedAt: '2026-10-21T20:00:00Z' }),
    ];
    expect(totalsOf(posts)).toEqual({ posts: 3, views: 50, likes: 15, comments: 2, shares: 3 });
    expect(filterByPlatform(posts, 'youtube').map(p => p.id)).toEqual(['b']);
    expect(topPosts(posts).map(p => p.id)).toEqual(['b', 'c', 'a']);
    expect(recentPosts(posts).map(p => p.id)).toEqual(['c', 'b', 'a']);
    expect([...countsByPlatform(posts)]).toEqual([['instagram', 2], ['youtube', 1]]);
    expect(viewsByDay(posts, '2026-10-19', '2026-10-21')).toEqual([
      { day: '2026-10-19', views: 10 }, { day: '2026-10-20', views: 0 }, { day: '2026-10-21', views: 40 },
    ]);
  });
  it('reads every page the provider has, and says so when the window is cut short', async () => {
    const urls: string[] = [];
    const pages = (total: number) => new LiveSocialClient('key', async (url) => {
      urls.push(url);
      const page = Number(new URL(url).searchParams.get('page'));
      return new Response(JSON.stringify({ posts: [{ _id: `p${page}`, platform: 'threads', publishedAt: '2026-10-20T15:00:00Z', analytics: { views: page } }], pagination: { pages: total } }), { status: 200 });
    });
    const two = await pages(2).analytics('prof', '2026-10-01', '2026-10-30');
    expect(two).toMatchObject({ truncated: false, posts: [{ id: 'p1' }, { id: 'p2' }] });
    expect(new URL(urls[0]).searchParams.toString()).toBe('profileId=prof&fromDate=2026-10-01&toDate=2026-10-30&limit=100&page=1');
    expect(new URL(urls[0]).pathname).toBe('/v1/analytics');
    const many = await pages(9).analytics('prof', '2026-10-01', '2026-10-30');
    expect(many?.truncated).toBe(true);
    expect(many?.posts).toHaveLength(5);
    const refused = await new LiveSocialClient('key', async () => new Response('{}', { status: 500 })).analytics('prof', '2026-10-01', '2026-10-30');
    expect(refused).toBeNull();
  });
});
