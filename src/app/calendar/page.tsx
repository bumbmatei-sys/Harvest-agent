import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicCalendar from '@/components/PublicCalendar';

export const dynamic = 'force-dynamic';

export default async function PublicCalendarPage() {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);
  if (!tenant) notFound();

  const { adminDb } = await import('@/lib/firebase-admin');

  // Single-field query only (status); ordering + future-event filtering happen
  // client-side to avoid a composite index (status + startDate).
  const eventsSnap = await adminDb
    .collection('tenants').doc(tenant.id)
    .collection('events')
    .where('status', '==', 'published')
    .limit(100)
    .get();

  const now = new Date();
  const events = eventsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter((ev: any) => {
      // Include future events + events with no endDate (ongoing)
      const end = ev.endDate?.toDate ? ev.endDate.toDate() : null;
      const start = ev.startDate?.toDate ? ev.startDate.toDate() : null;
      const cutoff = end || start;
      if (cutoff && cutoff < now) return false;
      // Respect showOnPublicCalendar flag (default true if field absent)
      return ev.showOnPublicCalendar !== false;
    })
    .map((ev: any) => ({
      id: ev.id,
      title: ev.title,
      description: ev.description || '',
      location: ev.location || null,
      isOnline: ev.isOnline || false,
      startDate: ev.startDate?.toDate ? ev.startDate.toDate().toISOString() : null,
      endDate: ev.endDate?.toDate ? ev.endDate.toDate().toISOString() : null,
      coverImage: ev.coverImage || null,
      price: ev.price || 0,
      registrationEnabled: ev.registrationEnabled || false,
      status: ev.status,
    }))
    // Sort chronologically client-side (events with no startDate sort last).
    .sort((a, b) => {
      const at = a.startDate ? new Date(a.startDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bt = b.startDate ? new Date(b.startDate).getTime() : Number.MAX_SAFE_INTEGER;
      return at - bt;
    });

  const branding = (tenant as any).config || {};

  return (
    <PublicCalendar
      tenantId={tenant.id}
      tenantName={tenant.name}
      logo={branding.logo || null}
      primaryColor={branding.primaryColor || '#B8962E'}
      events={events}
    />
  );
}
