import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicCheckin from '@/components/PublicCheckin';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { tenantFeatures } from '@/lib/tenant-features';

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

  // 🔴 THE TIER MUST HOLD CHECK-IN — THE-213, the page half of the same gate
  // the two /api/checkin routes now carry. `checkInSystem` is false on Free and
  // on Individual; this page is public, `force-dynamic` and reads through the
  // Admin SDK, so nothing else stands between a kept QR and a rendered form.
  //
  // `notFound()` rather than an explanatory screen, exactly as the missing-
  // session branch below: the reader is an anonymous visitor and the church's
  // tier is not theirs to be told — the same reasoning written on the news-feed
  // permalink's refusal in app/post/[postId]/page.tsx.
  //
  // Before the session read, so a refused tenant's sessions are never fetched.
  // Refuses the SURFACE, not the data: sessions and attendees are untouched.
  if (!tenantFeatures(tenant).checkInSystem) notFound();

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
    <>
      <PublicRouteAnalytics route="/checkin/[sessionId]" />
      <PublicCheckin
        tenantId={tenant.id}
        tenantName={tenant.name}
        logo={branding.logo || null}
        primaryColor={branding.primaryColor || '#B8962E'}
        sessionId={sessionId}
        sessionName={data.name || 'Check-In'}
        closed={closed}
      />
    </>
  );
}
