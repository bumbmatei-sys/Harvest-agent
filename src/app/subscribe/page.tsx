import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { getTenantFromHost } from '@/lib/server-tenant';
import { NEWSLETTER_FEATURE_ENABLED } from '@/lib/newsletter-feature';
import { hasFeature, toTenantPlan } from '@/utils/plan-features';
import PublicSubscribe from '@/components/PublicSubscribe';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';

/**
 * The newsletter sign-up page a ministry shares. Public and server-rendered, and
 * it reads the tenant document through the Admin SDK, so no rule is consulted or
 * changed. Only the ministry's name and logo, both already public, reach the page.
 *
 * It answers `notFound()` for an unresolvable host, for a ministry whose plan
 * does not include the newsletter, and while the newsletter is switched off, so
 * a stranger is never offered a form that cannot work.
 */
export const dynamic = 'force-dynamic';

async function loadTenant() {
  const headersList = await headers();
  return getTenantFromHost(headersList.get('host') || '');
}

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await loadTenant();
  const name = tenant?.name || 'Newsletter';
  return { title: `Subscribe · ${name}`, description: `Get updates from ${name} by email.` };
}

export default async function SubscribePage() {
  if (!NEWSLETTER_FEATURE_ENABLED) notFound();
  const tenant = await loadTenant();
  if (!tenant) notFound();
  if (!hasFeature(toTenantPlan(typeof tenant.plan === 'string' ? tenant.plan : null), 'newsletterAutomation')) notFound();
  const config = ((tenant as { config?: { logo?: string | null } }).config || {});
  return (
    <>
      <PublicRouteAnalytics route="/subscribe" />
      <PublicSubscribe tenantName={tenant.name} logo={config.logo || null} />
    </>
  );
}
