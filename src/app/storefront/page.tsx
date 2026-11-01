import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { StorefrontPage } from '@/components/storefront/StorefrontPage';
import { loadStorefront, loadStorefrontArticles, loadStorefrontEvents } from '@/lib/storefront/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function load() {
  const tenant = await getTenantFromHost(headers().get('host') || '');
  if (!tenant) return null;
  const storefront = await loadStorefront(tenant.id, tenant.name ?? '');
  if (!storefront.published) return null;
  return { tenant, storefront };
}

export async function generateMetadata(): Promise<Metadata> {
  const loaded = await load();
  if (!loaded) return { title: 'Not found' };
  return { title: loaded.storefront.profile.name, description: loaded.storefront.profile.bio || undefined };
}

/** The ministry's Storefront, on its own host: {subdomain}.theharvest.app/storefront. */
export default async function StorefrontRoute() {
  const loaded = await load();
  if (!loaded) notFound();
  const { tenant, storefront } = loaded;
  const wants = (type: string) => storefront.blocks.some((block) => block.enabled && block.type === type);
  const eventsBlock = storefront.blocks.find((block) => block.enabled && block.type === 'events');
  const [articles, events] = await Promise.all([
    wants('blog') ? loadStorefrontArticles(tenant.id) : Promise.resolve([]),
    eventsBlock && eventsBlock.type === 'events' ? loadStorefrontEvents(tenant.id, eventsBlock.count) : Promise.resolve([]),
  ]);
  return (
    <>
      <PublicRouteAnalytics route="/storefront" />
      <StorefrontPage storefront={storefront} tenantId={tenant.id} articles={articles.slice(0, 3)} events={events} />
    </>
  );
}
