import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { MinistryPosts, ministryExcerpt } from '@/components/public/MinistryPosts';
import { createBlogService } from '@/lib/blog/service';
import { firestoreBlogStore } from '@/lib/blog/firestore-store';
import { getTenantFromHost } from '@/lib/server-tenant';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ministry',
};

export default async function MinistryPage() {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);
  if (!tenant) notFound();

  const listed = await createBlogService({ store: firestoreBlogStore }).listPublic(tenant.id);
  if (!listed.ok) {
    throw new Error(listed.message);
  }

  const posts = listed.posts.map((post) => ({
    id: post.id,
    title: post.title,
    excerpt: ministryExcerpt(post.content),
    publishedAt: post.publishedAt,
    timeZone: post.scheduleTimeZone || 'UTC',
  }));

  return (
    <>
      <PublicRouteAnalytics route="/p" />
      <MinistryPosts churchName={tenant.name} posts={posts} skipped={listed.skipped} />
    </>
  );
}
