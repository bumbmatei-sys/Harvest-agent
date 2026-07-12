import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';

export const dynamic = 'force-dynamic';

const PLATFORM_TENANT_ID = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';

// Serialize a Firestore Timestamp (or ISO string) to an ISO string for rendering.
const toIso = (ts: any): string | null => {
  if (!ts) return null;
  if (typeof ts === 'string') return ts;
  if (ts?.toDate) return ts.toDate().toISOString();
  return null;
};

const isValidHex = (value: string | undefined): value is string =>
  !!value && /^#[0-9a-fA-F]{6}$/.test(value);

async function loadPost(postId: string, host: string) {
  const tenant = await getTenantFromHost(host);
  if (!tenant) return null;

  // Server-side read via the Admin SDK (bypasses client rules). A logged-out
  // visitor never opens a client Firestore session — the gate is structural.
  const { adminDb } = await import('@/lib/firebase-admin');
  const snap = await adminDb.collection('community_posts').doc(postId).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  // Verify the post belongs to THIS tenant before rendering anything.
  if (data.tenantId !== tenant.id) return null;

  // Comment count via an aggregation query — no comment bodies leave the server.
  let commentCount = 0;
  try {
    const countSnap = await adminDb
      .collection('community_posts').doc(postId)
      .collection('comments').count().get();
    commentCount = countSnap.data().count || 0;
  } catch {
    commentCount = 0;
  }

  return { tenant, data, commentCount };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ postId: string }>;
}): Promise<Metadata> {
  const { postId } = await params;
  const headersList = await headers();
  const host = headersList.get('host') || '';

  const loaded = await loadPost(postId, host);
  if (!loaded) return { title: 'Post Not Found' };

  const { tenant, data } = loaded;
  const isWhiteLabel = tenant.id !== PLATFORM_TENANT_ID;
  const siteName = isWhiteLabel ? tenant.name : 'Harvest';
  const excerpt = String(data.content || '').replace(/\s+/g, ' ').slice(0, 160).trim();
  const title = data.authorName ? `${data.authorName} on ${siteName}` : siteName;

  return {
    title,
    description: excerpt || undefined,
    openGraph: {
      title,
      description: excerpt || undefined,
      type: 'article',
      siteName,
      ...(data.imageUrl ? { images: [data.imageUrl] } : {}),
    },
    twitter: {
      card: data.imageUrl ? 'summary_large_image' : 'summary',
      title,
      description: excerpt || undefined,
      ...(data.imageUrl ? { images: [data.imageUrl] } : {}),
    },
  };
}

export default async function PublicPostPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;

  const headersList = await headers();
  const host = headersList.get('host') || '';

  const loaded = await loadPost(postId, host);
  if (!loaded) notFound();

  const { tenant, data, commentCount } = loaded;

  const branding = (tenant as any).config || {};
  const primaryColor = isValidHex(branding.primaryColor) ? branding.primaryColor : '#B8962E';
  const logo: string | null = branding.logo || null;

  const authorName: string = data.authorName || 'Member';
  const authorPhoto: string | null = data.authorPhoto || null;
  const content: string = data.content || '';
  const imageUrl: string | null = data.imageUrl || null;
  const likeCount: number = Array.isArray(data.likes) ? data.likes.length : 0;
  const createdIso = toIso(data.createdAt);
  const createdLabel = createdIso
    ? new Date(createdIso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const initials = authorName.trim().slice(0, 1).toUpperCase() || '•';

  return (
    <div className="min-h-screen bg-[#F7F6F3] py-10 px-4">
      <div className="max-w-xl mx-auto">
        {/* Tenant branding — never leak Harvest branding on a white-label host. */}
        <div className="text-center mb-6">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={tenant.name} className="h-12 mx-auto mb-2 object-contain" />
          ) : (
            <div className="font-display text-lg font-extrabold" style={{ color: primaryColor }}>
              {tenant.name}
            </div>
          )}
        </div>

        <article className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-6">
          {/* Author */}
          <div className="flex items-center gap-3 mb-4">
            {authorPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={authorPhoto} alt={authorName} className="h-11 w-11 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div
                className="h-11 w-11 rounded-full flex items-center justify-center text-white font-semibold"
                style={{ backgroundColor: primaryColor }}
              >
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 truncate">{authorName}</div>
              {createdLabel && <div className="text-xs text-gray-400">{createdLabel}</div>}
            </div>
          </div>

          {/* Content (plain text, whitespace preserved) */}
          {content && (
            <p className="text-[15px] text-gray-800 whitespace-pre-line leading-relaxed mb-4">{content}</p>
          )}

          {/* Image */}
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="w-full rounded-xl border border-gray-100 mb-4 object-cover"
              referrerPolicy="no-referrer"
            />
          )}

          {/* Read-only engagement counts — no like/comment controls for logged-out visitors. */}
          <div className="flex items-center gap-5 pt-4 border-t border-gray-100 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 21s-7.5-4.35-10-8.5C.5 9.5 1.5 6 5 6c2 0 3 1.5 3 1.5S9 6 11 6c.4 0 .7 0 1 .1.3-.1.6-.1 1-.1 2 0 3 1.5 3 1.5S20 6 19 6c3.5 0 4.5 3.5 3 6.5C19.5 16.65 12 21 12 21z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              {likeCount} {likeCount === 1 ? 'like' : 'likes'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
            </span>
          </div>
        </article>

        {/* Sign-in CTA — a plain link, NOT an interactive like/comment control.
            The app root shows the auth screen to logged-out visitors. */}
        <div className="bg-white rounded-[14px] shadow-sm border border-gray-100 p-5 mt-4 text-center">
          <p className="text-sm text-gray-500 mb-3">Sign in to join the conversation</p>
          <a
            href="/"
            className="inline-block px-6 py-2.5 rounded-xl text-white font-semibold transition-opacity hover:opacity-90"
            style={{ backgroundColor: primaryColor }}
          >
            Sign in to {tenant.name}
          </a>
        </div>
      </div>
    </div>
  );
}
