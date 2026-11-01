'use client';
import { characterCount, platformCounts, strictestLimit } from '@/lib/social/limits';
import { PLATFORM_LABELS, type SocialPlatform } from '@/lib/social/platforms';
import type { SocialAccount } from '@/lib/social/types';

/**
 * Eden's composer preview (docs/prd/screenshots/14-social-scheduler, 017): the
 * post as followers will see it, counted against the strictest network, then
 * each selected network with its own count.
 */
export function PostPreview({ content, mediaCount, accounts, platforms }: {
  content: string;
  mediaCount: number;
  accounts: readonly SocialAccount[];
  platforms: readonly SocialPlatform[];
}) {
  const author = accounts.find((account) => platforms.includes(account.platform)) ?? accounts[0];
  const limit = strictestLimit(platforms);
  const used = characterCount(content);
  const counts = platformCounts(content, platforms);
  return (
    <aside data-testid="social-preview" className="flex w-full flex-col gap-3 lg:w-[22rem] lg:shrink-0">
      <section className="rounded-xl border border-line bg-surface-raised p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-faint">
          <span>Main preview</span>
          <span data-testid="social-preview-count" className={limit !== null && used > limit ? 'font-semibold text-destructive' : ''}>
            {used.toLocaleString()} / {limit === null ? '–' : limit.toLocaleString()}
          </span>
        </div>
        <article className="rounded-lg border border-line bg-card p-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-muted">
              {(author?.displayName || author?.username || '?').slice(0, 1).toUpperCase()}
            </span>
            <p className="text-sm font-semibold text-strong">{author?.displayName || 'Your ministry'}
              {author?.username && <span className="font-normal text-faint"> @{author.username}</span>}</p>
          </div>
          <p data-testid="social-preview-text" className={`mt-2 whitespace-pre-wrap text-sm ${content.trim() ? 'text-strong' : 'text-faint'}`}>{content.trim() ? content : 'No text'}</p>
          {mediaCount > 0 && <p className="mt-2 text-xs text-faint">{mediaCount === 1 ? '1 attachment' : `${mediaCount} attachments`}</p>}
        </article>
      </section>
      <section className="rounded-xl border border-line bg-surface-raised p-3">
        <h3 className="mb-2 text-xs font-semibold text-strong">Each platform</h3>
        {counts.length === 0
          ? <p className="text-xs text-faint">Pick an account to post to.</p>
          : <ul className="flex flex-col gap-1.5">{counts.map((count) => (
            <li key={count.platform} data-preview-platform={count.platform} className="rounded-lg border border-line bg-card px-3 py-2">
              <p className="text-sm font-medium text-strong">{PLATFORM_LABELS[count.platform]}</p>
              <p className={`text-xs ${count.over ? 'font-semibold text-destructive' : 'text-faint'}`}>
                Same as all · {count.used.toLocaleString()} of {count.limit.toLocaleString()} characters
              </p>
            </li>
          ))}</ul>}
      </section>
    </aside>
  );
}
