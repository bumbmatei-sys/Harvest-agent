/**
 * The scheduler's Analytics tab (Eden Publish → Analytics,
 * docs/prd/screenshots/14-social-scheduler 009/010), from Zernio's
 * GET /v1/analytics: one row per published post with its metrics. Totals,
 * the daily series and the top and recent lists are computed here from
 * those rows, so the page shows nothing the provider did not report.
 */
import { parseSocialPlatform, type SocialPlatform } from './platforms';

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return (ANALYTICS_RANGES as readonly unknown[]).includes(value);
}

export interface AnalyticsPost {
  readonly id: string;
  readonly platform: SocialPlatform;
  readonly content: string;
  readonly publishedAt: string;
  readonly url: string | null;
  readonly views: number;
  readonly likes: number;
  readonly comments: number;
  readonly shares: number;
}

export interface AnalyticsTotals { readonly posts: number; readonly views: number; readonly likes: number; readonly comments: number; readonly shares: number }

export interface SocialAnalytics {
  readonly fromDate: string;
  readonly toDate: string;
  readonly posts: readonly AnalyticsPost[];
  readonly truncated: boolean;
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** One provider row, or null when it is not a published post on a network we offer. */
export function readAnalyticsPost(value: unknown): AnalyticsPost | null {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const platform = parseSocialPlatform(row.platform);
  const id = typeof row._id === 'string' ? row._id : typeof row.id === 'string' ? row.id : '';
  const publishedAt = typeof row.publishedAt === 'string' && !Number.isNaN(Date.parse(row.publishedAt)) ? row.publishedAt : '';
  if (!platform || !id || !publishedAt) return null;
  const metrics = row.analytics && typeof row.analytics === 'object' ? (row.analytics as Record<string, unknown>) : {};
  const url = typeof row.platformPostUrl === 'string' && /^https:\/\//.test(row.platformPostUrl) ? row.platformPostUrl : null;
  return {
    id, platform, publishedAt, url,
    content: typeof row.content === 'string' ? row.content : '',
    // A network that reports no views (Facebook pages report impressions) counts its impressions.
    views: count(metrics.views) || count(metrics.impressions),
    likes: count(metrics.likes),
    comments: count(metrics.comments),
    shares: count(metrics.shares),
  };
}

/** UTC day keys for a range ending today: [from, to], both inclusive. */
export function analyticsWindow(range: AnalyticsRange, now: Date): { fromDate: string; toDate: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (range - 1)));
  return { fromDate: from.toISOString().slice(0, 10), toDate: to };
}

export function filterByPlatform(posts: readonly AnalyticsPost[], platform: SocialPlatform | 'all'): AnalyticsPost[] {
  return platform === 'all' ? [...posts] : posts.filter((post) => post.platform === platform);
}

export function totalsOf(posts: readonly AnalyticsPost[]): AnalyticsTotals {
  return posts.reduce<AnalyticsTotals>((sum, post) => ({
    posts: sum.posts + 1, views: sum.views + post.views, likes: sum.likes + post.likes,
    comments: sum.comments + post.comments, shares: sum.shares + post.shares,
  }), { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 });
}

/** Views per UTC day across the window, every day present (zero when nothing was posted). */
export function viewsByDay(posts: readonly AnalyticsPost[], fromDate: string, toDate: string): { day: string; views: number }[] {
  const days: { day: string; views: number }[] = [];
  const index = new Map<string, number>();
  for (let at = Date.parse(`${fromDate}T00:00:00Z`); at <= Date.parse(`${toDate}T00:00:00Z`); at += 86_400_000) {
    const day = new Date(at).toISOString().slice(0, 10);
    index.set(day, days.length);
    days.push({ day, views: 0 });
  }
  for (const post of posts) {
    const i = index.get(post.publishedAt.slice(0, 10));
    if (i !== undefined) days[i] = { ...days[i], views: days[i].views + post.views };
  }
  return days;
}

/** Most viewed first, then most liked, then newest. */
export function topPosts(posts: readonly AnalyticsPost[], limit = 10): AnalyticsPost[] {
  return [...posts].sort((a, b) => b.views - a.views || b.likes - a.likes || Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, limit);
}

export function recentPosts(posts: readonly AnalyticsPost[], limit = 10): AnalyticsPost[] {
  return [...posts].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, limit);
}

/** Posts per network, for the filter pills. */
export function countsByPlatform(posts: readonly AnalyticsPost[]): Map<SocialPlatform, number> {
  const counts = new Map<SocialPlatform, number>();
  for (const post of posts) counts.set(post.platform, (counts.get(post.platform) ?? 0) + 1);
  return counts;
}
