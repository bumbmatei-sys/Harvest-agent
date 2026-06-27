import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import sanitizeHtml from 'sanitize-html';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantFromHost } from '@/lib/server-tenant';

interface BlogPost {
  id: string;
  title: string;
  content: string;
  status: string;
  featuredImage?: string;
  tags?: string[];
  publishedAt?: string;
  createdAt: string;
  tenantId?: string | null;
  // SEO fields (present on AI-generated posts)
  seoTitle?: string;
  seoDescription?: string;
  slug?: string;
  keywords?: string[];
  estimatedReadTime?: number;
  isAiGenerated?: boolean;
}

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const snap = await adminDb.collection('blog_posts').doc(id).get();
  if (!snap.exists || snap.data()?.status !== 'published') {
    return { title: 'Post Not Found' };
  }

  const post = snap.data() as BlogPost;
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
      publishedTime: post.publishedAt,
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

  const headersList = await headers();
  const host = headersList.get('host') || '';

  const [snap, tenant] = await Promise.all([
    adminDb.collection('blog_posts').doc(id).get(),
    getTenantFromHost(host),
  ]);

  if (!snap.exists || snap.data()?.status !== 'published') {
    notFound();
  }

  const post = { id: snap.id, ...snap.data() } as BlogPost;
  const safeContent = sanitizeHtml(post.content, SANITIZE_OPTIONS);

  const appUrl = '/';
  const backLabel = tenant ? `Back to ${tenant.name}` : 'Back to Harvest';

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
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Minimal header */}
      <header className="border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <a
            href={appUrl}
            className="inline-flex items-center gap-1.5 text-sm text-[#D4AF37] hover:text-[#C9963A] font-medium transition-colors"
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
                className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-[#D4AF37]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <h1 className="text-3xl font-black text-[#0b1121] mb-3 leading-tight">
          {post.title}
        </h1>

        {post.publishedAt && (
          <time
            dateTime={post.publishedAt}
            className="block text-sm text-gray-400 mb-8"
          >
            {new Date(post.publishedAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
        )}

        <article
          className="prose prose-slate prose-headings:font-bold prose-a:text-[#D4AF37] prose-a:no-underline hover:prose-a:underline max-w-none"
          dangerouslySetInnerHTML={{ __html: safeContent }}
        />

        {/* CTA to open full app */}
        <div className="mt-12 pt-8 border-t border-gray-100 text-center">
          <p className="text-gray-500 text-sm mb-4">
            More from {tenant?.name || 'Harvest'}
          </p>
          <a
            href={appUrl}
            className="inline-block bg-[#D4AF37] text-white font-bold px-8 py-3 rounded-xl hover:bg-[#C9963A] transition-colors"
          >
            Open App
          </a>
        </div>
      </main>
    </div>
  );
}
