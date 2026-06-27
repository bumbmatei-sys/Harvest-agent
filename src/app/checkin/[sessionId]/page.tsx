import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicCheckin from '@/components/PublicCheckin';

export const dynamic = 'force-dynamic';

export default async function PublicCheckinPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);
  if (!tenant) notFound();

  const { adminDb } = await import('@/lib/firebase-admin');
  const snap = await adminDb
    .collection('tenants').doc(tenant.id)
    .collection('checkinSessions').doc(sessionId)
    .get();
  if (!snap.exists) notFound();

  const data = snap.data()!;
  const branding = (tenant as any).config || {};
  const closed = data.status === 'closed';

  return (
    <PublicCheckin
      tenantId={tenant.id}
      tenantName={tenant.name}
      logo={branding.logo || null}
      primaryColor={branding.primaryColor || '#B8962E'}
      sessionId={sessionId}
      sessionName={data.name || 'Check-In'}
      closed={closed}
    />
  );
}
