'use client';
import { useMemo, useState, type CSSProperties } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import type { StorefrontArticleCard } from './StorefrontPage';

const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso)) : '');

/**
 * Storefront > Blog > View all: a back arrow to the Storefront, a search box
 * and the blog's categories as filters, then every public article.
 */
export function StorefrontBlogIndex({ articles, accent, name }: { articles: readonly StorefrontArticleCard[]; accent: string; name: string }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const categories = useMemo(() => [...new Set(articles.map((a) => a.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [articles]);
  const needle = query.trim().toLowerCase();
  const shown = articles.filter((article) =>
    (!category || article.category === category)
    && (!needle || `${article.title} ${article.excerpt} ${article.category}`.toLowerCase().includes(needle)));

  return (
    <main data-storefront-blog-index style={{ '--sf-accent': accent, '--sf-ink': '#111312' } as CSSProperties} className="min-h-full bg-[#111312] px-4 pb-16 pt-6 text-white">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <a href="/storefront" aria-label={`Back to ${name}`} className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
            <ArrowLeft className="size-5" aria-hidden />
          </a>
          <label className="flex min-h-11 flex-1 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4">
            <Search className="size-4 text-white/50" aria-hidden />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search articles"
              aria-label="Search articles" className="w-full bg-transparent text-sm text-white outline-hidden placeholder:text-white/40" />
          </label>
        </div>
        {categories.length > 0 && (
          <div role="group" aria-label="Categories" className="flex flex-wrap gap-2">
            {[null, ...categories].map((entry) => (
              <button key={entry ?? 'all'} type="button" aria-pressed={category === entry} onClick={() => setCategory(entry)}
                className="min-h-9 rounded-full border border-white/15 px-3 text-xs font-semibold text-white/80 aria-pressed:border-[var(--sf-accent)] aria-pressed:bg-[var(--sf-accent)] aria-pressed:text-[var(--sf-ink)]">
                {entry ?? 'All'}
              </button>
            ))}
          </div>
        )}
        {shown.length === 0
          ? <p className="py-12 text-center text-sm text-white/50">{articles.length === 0 ? 'No articles yet.' : 'No articles match.'}</p>
          : <ul className="grid gap-3 sm:grid-cols-2">
              {shown.map((article) => (
                <li key={article.id} data-storefront-article={article.id}>
                  <a href={`/blog/${encodeURIComponent(article.id)}`} className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] hover:border-[var(--sf-accent)]">
                    {article.image
                      ? <img src={article.image} alt="" className="aspect-video w-full object-cover" />
                      : <span className="aspect-video w-full bg-[var(--sf-accent)]/20" aria-hidden />}
                    <span className="flex flex-1 flex-col gap-1 p-4">
                      {article.category && <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--sf-accent)]">{article.category}</span>}
                      <span className="font-semibold">{article.title}</span>
                      {article.excerpt && <span className="line-clamp-2 text-sm text-white/60">{article.excerpt}</span>}
                      <span className="mt-auto pt-2 text-xs text-white/40">{date(article.publishedAt)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>}
      </div>
    </main>
  );
}
