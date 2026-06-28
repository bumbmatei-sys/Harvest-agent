import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicPledge from '@/components/PublicPledge';

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
  return (
    <PublicPledge
      tenantId={tenant.id}
      tenantName={tenant.name}
      logo={branding.logo || null}
      primaryColor={branding.primaryColor || '#B8962E'}
      campaign={campaign}
    />
  );
}
