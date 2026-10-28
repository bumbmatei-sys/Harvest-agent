import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import sanitizeHtml from 'sanitize-html';
import { createBlogService } from '@/lib/blog/service';
import { firestoreBlogStore } from '@/lib/blog/firestore-store';
import { publicPostMatchesHost } from '@/lib/blog/visibility';
import { getTenantFromHost } from '@/lib/server-tenant';
import { getPlanFeatures } from '@/utils/plan-features';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';

const DEFAULT_BRAND_COLOR = '#D4AF37';
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'a', 'img', 'blockquote',
    'strong', 'em', 'br', 'div', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
  },
  allowedSchemes: ['https', 'http', 'mailto', 'tel'],
};

async function loadPublicArticle(id: string) {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const [post, tenant] = await Promise.all([
    createBlogService({ store: firestoreBlogStore }).readPublic(id),
    getTenantFromHost(host),
  ]);
  if (!post || !publicPostMatchesHost(post.tenantId, tenant?.id ?? null)) {
    return { post: null, tenant: null };
  }
  return { post, tenant };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { post } = await loadPublicArticle(id);
  if (!post) {
    return { title: 'Post Not Found' };
  }
  const excerpt = post.content.replace(/<[^>]*>/g, '').slice(0, 160).trim();
  const metaTitle = post.seoTitle || post.title;
  const metaDescription = post.seoDescription || excerpt;

  return {
    title: metaTitle,
    description: metaDescription,
    ...(post.keywords && post.keywords.length > 0 ? { keywords: post.keywords.join(', ') } : {}),
    openGraph: {
      title: metaTitle,
      description: metaDescription,
      type: 'article',
      ...(post.publishedAt ? { publishedTime: post.publishedAt } : {}),
      ...(post.featuredImage ? { images: [post.featuredImage] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: metaTitle,
      description: metaDescription,
      ...(post.featuredImage ? { images: [post.featuredImage] } : {}),
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { post, tenant } = await loadPublicArticle(id);

  if (!post) {
    notFound();
  }
  const safeContent = sanitizeHtml(post.content, SANITIZE_OPTIONS);

  const appUrl = '/';
  const backLabel = tenant ? `Back to ${tenant.name}` : 'Back to Harvest';

  // Custom branding (logo/colors) is a paid Community+/Ministry feature — a
  // tenant on Individual/Small Team keeps the Harvest default even if
  // config.primaryColor happens to be set (e.g. downgraded from a higher plan).
  const canBrand = tenant ? getPlanFeatures(tenant.plan).customBranding : false;
  const rawColor = tenant?.config?.primaryColor;
  const brandColor = canBrand && rawColor && HEX_COLOR_RE.test(rawColor) ? rawColor : DEFAULT_BRAND_COLOR;
  const brandColorVars = { '--brand-color': brandColor } as CSSProperties;

  // JSON-LD Article structured data for search engines.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.seoTitle || post.title,
    description: post.seoDescription || post.content.replace(/<[^>]*>/g, '').slice(0, 160).trim(),
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    author: { '@type': 'Organization', name: tenant?.name || 'Harvest' },
    ...(post.keywords && post.keywords.length > 0 ? { keywords: post.keywords.join(', ') } : {}),
  };

  return (
    <div className="min-h-screen bg-surface-raised" style={brandColorVars}>
      <PublicRouteAnalytics route="/blog/[id]" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Minimal header */}
      <header className="border-b border-line-subtle">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <a
            href={appUrl}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--brand-color)] hover:text-[color-mix(in_srgb,var(--brand-color)_85%,black)] font-medium transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {backLabel}
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10">
        {post.featuredImage && (
          <img
            src={post.featuredImage}
            alt={post.title}
            className="w-full rounded-2xl mb-8 aspect-video object-cover"
          />
        )}

        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {post.tags.map(tag => (
              <span
                key={tag}
                className="text-xs font-medium px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)] text-[var(--brand-color)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Title scale: 30px on mobile (16px root), 36px on desktop. The lg
            value is pinned in px because the desktop rem trim (:root 14.5px at
            1024px in globals.css) makes every rem-based text token render ~10%
            under its name above the breakpoint. */}
        <h1 className="font-display text-3xl lg:text-[36px] font-black text-[#0b1121] dark:text-strong mb-3 leading-tight">
          {post.title}
        </h1>

        {post.publishedAt && (
          <time
            dateTime={post.publishedAt}
            className="block text-sm text-faint mb-8"
          >
            {new Date(post.publishedAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
        )}

        {/* Article type scale. The rich-text editor can emit h1 tags inside the
            body, and globals.css clamps .prose h1/h2 with unlayered !important
            rem sizes — so h1/h2 are pinned with Tailwind's important modifier
            (which wins that cascade) and an in-body h1 renders at the h2 size.
            Body is 16px on mobile and 18px on desktop; px values sidestep the
            14.5px desktop rem trim noted above. */}
        <article
          className="prose prose-slate lg:text-[18px] prose-h1:text-[24px]! prose-h2:text-[24px]! prose-h3:text-[20px] prose-h4:text-[18px] prose-headings:font-bold prose-a:text-[var(--brand-color)] prose-a:no-underline hover:prose-a:underline max-w-none"
          dangerouslySetInnerHTML={{ __html: safeContent }}
        />

        {/* CTA to open full app */}
        <div className="mt-12 pt-8 border-t border-line-subtle text-center">
          <p className="text-muted text-sm mb-4">
            More from {tenant?.name || 'Harvest'}
          </p>
          <a
            href={appUrl}
            className="inline-block bg-[var(--brand-color)] text-white font-bold px-8 py-3 rounded-xl hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] transition-colors"
          >
            Open App
          </a>
        </div>
      </main>
    </div>
  );
}
