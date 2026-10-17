import type { StoredBlogPost } from '@/lib/blog/service';

/**
 * Public RSS and sitemap for one ministry's blog.
 * Callers pass posts that are already public. This module does not decide
 * visibility; it only renders the documents it is given.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function excerpt(html: string): string {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

export function renderBlogRss(input: {
  churchName: string;
  origin: string;
  posts: readonly Pick<StoredBlogPost, 'id' | 'title' | 'content' | 'publishedAt' | 'createdAt'>[];
}): string {
  const items = input.posts.map((post) => {
    const link = `${input.origin}/blog/${post.id}`;
    const when = post.publishedAt || post.createdAt;
    return [
      '<item>',
      `<title>${escapeXml(post.title)}</title>`,
      `<link>${escapeXml(link)}</link>`,
      `<guid>${escapeXml(link)}</guid>`,
      `<pubDate>${escapeXml(new Date(when).toUTCString())}</pubDate>`,
      `<description>${escapeXml(excerpt(post.content))}</description>`,
      '</item>',
    ].join('');
  }).join('');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    `<title>${escapeXml(input.churchName)}</title>`,
    `<link>${escapeXml(`${input.origin}/p`)}</link>`,
    `<description>${escapeXml(`Posts from ${input.churchName}`)}</description>`,
    items,
    '</channel>',
    '</rss>',
  ].join('');
}

export function renderBlogSitemap(input: {
  origin: string;
  posts: readonly Pick<StoredBlogPost, 'id' | 'publishedAt' | 'updatedAt'>[];
}): string {
  const urls = [
    `<url><loc>${escapeXml(`${input.origin}/p`)}</loc></url>`,
    ...input.posts.map((post) => {
      const lastmod = post.publishedAt || post.updatedAt;
      return `<url><loc>${escapeXml(`${input.origin}/blog/${post.id}`)}</loc><lastmod>${escapeXml(lastmod)}</lastmod></url>`;
    }),
  ].join('');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
  ].join('');
}
