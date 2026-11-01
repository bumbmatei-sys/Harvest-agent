import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { StorefrontBlogIndex } from '@/components/storefront/StorefrontBlogIndex';
import { loadStorefront, loadStorefrontArticles } from '@/lib/storefront/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = { title: 'Blog' };

/** Storefront > Blog > View all: every public article, searchable and filtered by category. */
export default async function StorefrontBlogRoute() {
  const tenant = await getTenantFromHost(headers().get('host') || '');
  if (!tenant) notFound();
  const storefront = await loadStorefront(tenant.id, tenant.name ?? '');
  if (!storefront.published) notFound();
  const articles = await loadStorefrontArticles(tenant.id);
  return (
    <>
      <PublicRouteAnalytics route="/storefront/blog" />
      <StorefrontBlogIndex articles={articles} accent={storefront.look.accent} name={storefront.profile.name} />
    </>
  );
}
