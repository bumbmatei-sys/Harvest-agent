import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getTenantFromHost } from '@/lib/server-tenant';

export const dynamic = 'force-dynamic';

export async function GET() {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);
  if (!tenant) return new NextResponse('Not found', { status: 404 });

  const { adminDb } = await import('@/lib/firebase-admin');

  // Single-field query only (status); filtering happens client-side to avoid a
  // composite index.
  const snap = await adminDb
    .collection('tenants').doc(tenant.id)
    .collection('events')
    .where('status', '==', 'published')
    .limit(100)
    .get();

  const tenantName = tenant.name || 'Harvest';
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const events = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter((ev: any) => ev.showOnPublicCalendar !== false);

  const formatDt = (ts: any): string => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  const escape = (s: string) => (s || '').replace(/[,;\\]/g, c => '\\' + c).replace(/\n/g, '\\n');

  const vevents = events.map((ev: any) => [
    'BEGIN:VEVENT',
    `UID:${ev.id}@theharvest.app`,
    `DTSTAMP:${now}`,
    ev.startDate ? `DTSTART:${formatDt(ev.startDate)}` : '',
    ev.endDate ? `DTEND:${formatDt(ev.endDate)}` : '',
    `SUMMARY:${escape(ev.title || '')}`,
    ev.description ? `DESCRIPTION:${escape(ev.description)}` : '',
    ev.location ? `LOCATION:${escape(ev.location)}` : '',
    ev.isOnline && ev.onlineLink ? `URL:${ev.onlineLink}` : '',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n')).join('\r\n');

  const ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Harvest//${tenantName}//EN`,
    `X-WR-CALNAME:${escape(tenantName)} Events`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    vevents,
    'END:VCALENDAR',
  ].join('\r\n');

  return new NextResponse(ical, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${tenantName.replace(/\s/g, '-')}-events.ics"`,
      'Cache-Control': 'no-cache',
    },
  });
}
