import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicPledge from '@/components/PublicPledge';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { readGivingLinks } from '@/components/donations/giving-providers';

export const dynamic = 'force-dynamic';

export default async function PublicPledgePage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;

  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);
  if (!tenant) notFound();

  const { adminDb } = await import('@/lib/firebase-admin');
  const snap = await adminDb.collection('campaigns').doc(campaignId).get();
  if (!snap.exists) notFound();
  const data = snap.data() || {};

  // Verify the campaign belongs to this tenant and is an active pledge campaign.
  if (data.tenantId !== tenant.id) notFound();
  if (data.campaignType !== 'pledge') notFound();
  if (!data.isActive) notFound();

  const campaign = {
    id: snap.id,
    title: data.title || 'Pledge Campaign',
    description: data.description || '',
    goal: data.goal || 0,
    raised: data.raised || 0,
    pledgeDeadline: data.pledgeDeadline || null,
  };

  const branding = (tenant as any).config || {};

  // THE-303 — the church's OWN payment links, on the pledge page a member is
  // actually looking at. The founder: "these don't appear on the fundraising
  // page." `/campaign/[campaignId]` has carried them since THE-251 and this
  // route did not, so which links a member saw depended on which KIND of
  // campaign they opened.
  //
  // 🔴 THE GATE IS UNTOUCHED. Everything above already refused a missing
  // campaign, a foreign tenant, a non-pledge campaign and an inactive one, and
  // this reads nothing that was not already read — `tenant.config` is the same
  // object the logo and the brand colour come from, one line up. No new
  // document, no new query, and nothing here can make a page render that would
  // not have rendered before.
  //
  // `readGivingLinks` re-derives every URL against its provider's host
  // allow-list on READ, so a stored link that no longer passes stops being a
  // link rather than being trusted because it was accepted once.
  const givingLinks = readGivingLinks(branding);

  return (
    <>
      <PublicRouteAnalytics route="/pledge/[campaignId]" />
      <PublicPledge
        tenantId={tenant.id}
        tenantName={tenant.name}
        logo={branding.logo || null}
        primaryColor={branding.primaryColor || '#B8962E'}
        campaign={campaign}
        links={givingLinks}
      />
    </>
  );
}
