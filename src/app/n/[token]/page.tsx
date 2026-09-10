import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import sanitizeHtml from 'sanitize-html';

import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { resolvePublicNote } from '@/lib/public-note';

/**
 * THE-346 — the reader's half of "Share on web".
 *
 * `force-dynamic` IS THE HALF OF REVOCATION THAT LIVES IN THIS FILE, and it
 * is not a performance setting. Next would otherwise be free to render this
 * page once and serve the HTML from a cache — and a cached copy of a note
 * OUTLIVES the revocation that was supposed to make it unreachable, which is
 * exactly the leak this feature must not have. Every request resolves the token
 * again, and every request reads the note again.
 *
 * THE URL CARRIES NO TENANT AND NO DOCUMENT ID. `/n/{token}` and nothing
 * else — see `lib/public-note.ts`. A path of `/n/{tenant}/{docId}` would say
 * which church the link belongs to before it had been opened, and would make
 * the secret half of a guess rather than all of it.
 */
export const dynamic = 'force-dynamic';

/**
 * THE SAME ALLOW-LIST THE BLOG PAGE USES, and it is `sanitize-html` rather
 * than `utils/sanitize`'s DOMPurify because this runs on the SERVER, where
 * there is no DOM for DOMPurify to work against.
 *
 * THE NOTE IS UNTRUSTED HTML EVEN THOUGH A CHURCH ADMIN WROTE IT. It reaches
 * a signed-out stranger's browser on our origin, so a `<script>` pasted into a
 * note — deliberately or out of a copied email — would run there. No package is
 * added: `sanitize-html` is already a dependency, so THE-274's exact lockfile
 * pin is untouched.
 */
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

/**
 * `noindex`. A church chose to give ONE person a link; it did not ask to be
 * in a search index, and a note that is findable by searching its own text is
 * public in a way "share this link" never implied. Revoking the link would then
 * still leave the content in somebody's cache.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const note = await resolvePublicNote(token);
  return {
    title: note ? note.title : 'Not Found',
    robots: { index: false, follow: false },
  };
}

export default async function PublicNotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const note = await resolvePublicNote(token);

  /**
   * ONE `notFound()` FOR EVERY WAY OF FAILING. A malformed token, an unknown
   * token, a token whose link was revoked, and a note that has since been
   * deleted all land here — see `resolvePublicNote`, which collapses them
   * deliberately. Telling them apart would let anyone holding a candidate
   * string learn whether it had ever been a real link.
   */
  if (!note) notFound();

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl bg-surface px-4 py-10 sm:px-6">
      {/*
        The PATTERN, never the resolved path. `PublicRouteAnalytics` is handed
        `/n/[token]` verbatim, so the 256-bit capability in the URL never
        reaches an analytics property - the same rule `/rota/[token]` follows,
        and the reason it matters more on these two routes than on any other.
      */}
      <PublicRouteAnalytics route="/n/[token]" />
      <article>
        <h1 className="font-display text-2xl font-semibold text-strong sm:text-3xl">
          {note.title}
        </h1>
        <div
          className="docs-editor prose mt-6 max-w-none text-body"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(note.contentHtml, SANITIZE_OPTIONS) }}
        />
      </article>
    </main>
  );
}
