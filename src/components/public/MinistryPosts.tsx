import { formatInstantInZone } from '@/lib/blog/visibility';

export interface MinistryPostCard {
  readonly id: string;
  readonly title: string;
  readonly excerpt: string;
  readonly publishedAt: string | null;
  readonly timeZone: string;
}

/**
 * The ministry page's post list. The container matches the public article page
 * (`max-w-2xl`, `px-4`) so the narrow and wide layouts stay the ones that page
 * already uses.
 */
export function MinistryPosts({
  churchName,
  posts,
  skipped,
}: {
  churchName: string;
  posts: readonly MinistryPostCard[];
  skipped: number;
}) {
  return (
    <div className="min-h-screen bg-surface-raised">
      <header className="border-b border-line-subtle">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <a href="/" className="text-sm font-medium text-[var(--brand-color)]">
            {churchName}
          </a>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-faint mb-2">Ministry</p>
        <h1 className="font-display text-3xl font-light text-strong mb-8">{churchName}</h1>
        {skipped > 0 && (
          <p className="text-sm text-danger mb-6" role="alert">
            Some posts could not be read.
          </p>
        )}
        {posts.length === 0 ? (
          <p className="text-muted">No articles yet.</p>
        ) : (
          <ul className="space-y-6">
            {posts.map((post) => (
              <li key={post.id} className="border-b border-line-subtle pb-6">
                <a href={`/blog/${post.id}`} className="font-display text-2xl font-semibold text-strong hover:opacity-80">
                  {post.title}
                </a>
                {post.publishedAt && (
                  <time dateTime={post.publishedAt} className="block text-sm text-faint mt-1">
                    {formatInstantInZone(post.publishedAt, post.timeZone || 'UTC')}
                  </time>
                )}
                {post.excerpt && <p className="text-sm text-body mt-2">{post.excerpt}</p>}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

export function ministryExcerpt(html: string): string {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}
