'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ANALYTICS_RANGES, countsByPlatform, filterByPlatform, recentPosts, topPosts, totalsOf, viewsByDay,
  type AnalyticsPost, type AnalyticsRange, type SocialAnalytics,
} from '@/lib/social/analytics';
import { PLATFORM_LABELS, type SocialPlatform } from '@/lib/social/platforms';
import { PlatformLogo } from './PlatformLogo';

export type AnalyticsLoader = (range: AnalyticsRange) => Promise<SocialAnalytics>;

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: SocialAnalytics };

const PILL = 'min-h-11 sm:min-h-[34px] h-auto gap-1.5 rounded-lg px-2.5 text-xs font-semibold aria-pressed:bg-surface-sunken aria-pressed:text-strong';
const number = (n: number) => n.toLocaleString('en-US');
const shortDate = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso));

/**
 * Eden's Publish → Analytics (docs/prd/screenshots/14-social-scheduler,
 * 009/010): network filter and range, four tiles, a daily chart, then recent
 * and top posts. Every figure is a sum of what the provider reported for the
 * posts in the window, and a window the provider cut short says so.
 */
export function SocialAnalyticsView({ load }: { load: AnalyticsLoader }) {
  const [range, setRange] = useState<AnalyticsRange>(30);
  const [platform, setPlatform] = useState<SocialPlatform | 'all'>('all');
  const [state, setState] = useState<Load>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    load(range).then(
      (data) => { if (!cancelled) setState({ status: 'ready', data }); },
      () => { if (!cancelled) setState({ status: 'error', message: 'Could not load analytics. Please try again.' }); },
    );
    return () => { cancelled = true; };
  }, [load, range]);

  const all = useMemo(() => (state.status === 'ready' ? state.data.posts : []), [state]);
  const shown = useMemo(() => filterByPlatform(all, platform), [all, platform]);
  const counts = useMemo(() => countsByPlatform(all), [all]);
  const totals = totalsOf(shown);
  const days = state.status === 'ready' ? viewsByDay(shown, state.data.fromDate, state.data.toDate) : [];
  const peak = Math.max(1, ...days.map((d) => d.views));
  const [mostViewed] = topPosts(shown, 1);
  const [mostLiked] = [...shown].sort((a, b) => b.likes - a.likes);

  return (
    <section data-testid="social-analytics" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="ghost" aria-pressed={platform === 'all'} className={PILL} onClick={() => setPlatform('all')}>
          All <span className="text-faint">{number(all.length)}</span>
        </Button>
        {[...counts].map(([key, n]) => (
          <Button key={key} type="button" variant="ghost" aria-pressed={platform === key} className={PILL} onClick={() => setPlatform(key)}>
            <PlatformLogo platform={key} className="size-3.5" decorative />{PLATFORM_LABELS[key]} <span className="text-faint">{number(n)}</span>
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Range">
          {ANALYTICS_RANGES.map((r) => (
            <Button key={r} type="button" variant="ghost" aria-pressed={range === r} className={PILL} onClick={() => setRange(r)}>{r}d</Button>
          ))}
        </div>
      </div>

      {state.status === 'loading' && <Skeleton className="h-64 w-full rounded-xl" />}
      {state.status === 'error' && <p role="alert" className="rounded-xl border border-line bg-surface-raised p-4 text-sm">{state.message}</p>}
      {state.status === 'ready' && <>
        {state.data.truncated && <p role="status" className="rounded-lg border border-line bg-surface-sunken p-3 text-xs text-muted">
          This window has more posts than one read covers, so these figures count the newest {number(all.length)} posts only.
        </p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Total views" value={number(totals.views)} note={`${number(totals.posts)} ${totals.posts === 1 ? 'post' : 'posts'} in ${range} days`} />
          <Tile label="Engagement" value={number(totals.likes + totals.comments + totals.shares)} note={`${number(totals.likes)} likes · ${number(totals.comments)} comments · ${number(totals.shares)} shares`} />
          <Tile label="Most viewed" value={mostViewed ? `${number(mostViewed.views)} views` : '—'} note={mostViewed?.content || 'Nothing posted yet'} />
          <Tile label="Most liked" value={mostLiked ? `${number(mostLiked.likes)} likes` : '—'} note={mostLiked?.content || 'Nothing posted yet'} />
        </div>

        <section className="rounded-xl border border-line bg-surface-raised p-4">
          <h3 className="text-sm font-semibold text-strong">Views</h3>
          <p className="text-xs text-faint">Views of the posts published each day, last {range} days</p>
          <div data-testid="social-analytics-chart" className="mt-4 flex h-40 items-end gap-px" role="img"
            aria-label={`Views per day over the last ${range} days, ${number(totals.views)} in all`}>
            {days.map((d) => (
              <div key={d.day} data-chart-day={d.day} data-views={d.views} title={`${shortDate(`${d.day}T12:00:00Z`)}: ${number(d.views)} views`}
                className="min-w-0 flex-1 rounded-t-sm bg-[var(--brand-color,currentColor)] opacity-80"
                style={{ height: `${d.views === 0 ? 1 : Math.max(4, Math.round((d.views / peak) * 100))}%` }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-faint">
            <span>{days[0] ? shortDate(`${days[0].day}T12:00:00Z`) : ''}</span>
            <span>{days.at(-1) ? shortDate(`${days.at(-1)!.day}T12:00:00Z`) : ''}</span>
          </div>
        </section>

        <div className="grid gap-3 lg:grid-cols-2">
          <PostList title="Recent posts" note="Across every connected platform" posts={recentPosts(shown)} />
          <PostList title="Top posts" note="Most viewed in this window" posts={topPosts(shown)} />
        </div>
      </>}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div data-analytics-tile={label} className="rounded-xl border border-line bg-surface-raised p-4">
      <p className="text-xs text-faint">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-strong">{value}</p>
      <p className="mt-1 line-clamp-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function PostList({ title, note, posts }: { title: string; note: string; posts: readonly AnalyticsPost[] }) {
  return (
    <section data-analytics-list={title} className="rounded-xl border border-line bg-surface-raised p-4">
      <h3 className="text-sm font-semibold text-strong">{title}</h3>
      <p className="mb-2 text-xs text-faint">{note}</p>
      {posts.length === 0 ? <p className="py-6 text-center text-sm text-faint">No posts in this window.</p> : (
        <ul className="flex flex-col divide-y divide-line">
          {posts.map((post) => (
            <li key={post.id} className="flex items-center gap-3 py-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-muted"><PlatformLogo platform={post.platform} className="size-3.5" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-strong">{post.url ? <a href={post.url} target="_blank" rel="noreferrer" className="hover:underline">{post.content || 'Untitled post'}</a> : (post.content || 'Untitled post')}</p>
                <p className="text-xs text-faint">{PLATFORM_LABELS[post.platform]} · {shortDate(post.publishedAt)}</p>
              </div>
              <span className="shrink-0 text-xs text-muted" title="Views">{number(post.views)} views</span>
              <span className="shrink-0 text-xs text-muted" title="Likes">{number(post.likes)} likes</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
