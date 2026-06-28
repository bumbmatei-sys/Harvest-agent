import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicEventRegistration from '@/components/PublicEventRegistration';

export const dynamic = 'force-dynamic';

export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);
  if (!tenant) notFound();

  const { adminDb } = await import('@/lib/firebase-admin');
  const snap = await adminDb
    .collection('tenants').doc(tenant.id)
    .collection('events').doc(eventId)
    .get();

  if (!snap.exists) notFound();

  const data = snap.data() || {};

  // Block access to draft/cancelled events on the public page.
  if (data.status === 'draft' || data.status === 'cancelled') notFound();

  // Serialize Firestore Timestamps to ISO strings so the client component can
  // render dates without pulling in firebase types.
  const toIso = (ts: any): string | null => (ts?.toDate ? ts.toDate().toISOString() : null);
  const event = {
    id: snap.id,
    title: data.title || 'Event',
    description: data.description || '',
    coverImage: data.coverImage || null,
    location: data.location || null,
    isOnline: data.isOnline || false,
    onlineLink: data.onlineLink || null,
    startDate: toIso(data.startDate),
    endDate: toIso(data.endDate),
    price: data.price || 0,
    currency: data.currency || 'usd',
    status: data.status,
    registrationEnabled: data.registrationEnabled || false,
    ticketTypes: Array.isArray(data.ticketTypes) ? data.ticketTypes : [],
    waitlistEnabled: data.waitlistEnabled || false,
    // discountCodes are intentionally NOT exposed to the client — codes are
    // validated server-side via /api/event-registration/apply-discount.
    hasDiscounts: Array.isArray(data.discountCodes) && data.discountCodes.length > 0,
  };

  const branding = (tenant as any).config || {};

  return (
    <PublicEventRegistration
      tenantId={tenant.id}
      tenantName={tenant.name}
      logo={branding.logo || null}
      primaryColor={branding.primaryColor || '#B8962E'}
      event={event}
    />
  );
}
