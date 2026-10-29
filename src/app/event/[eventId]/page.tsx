import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantFromHost } from '@/lib/server-tenant';
import PublicEventRegistration from '@/components/PublicEventRegistration';
import PublicRouteAnalytics from '@/components/PublicRouteAnalytics';
import { readGivingLinks } from '@/components/donations/giving-providers';
import { resolveEventPaymentLinks } from '@/lib/event-payment-claims';

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

  // THE-379 (events remodel) — spots left, for the ticket type a fresh visitor
  // lands on. Computed the SAME way the submit route counts capacity (seats,
  // confirmed only), so the number on this page can never promise more than
  // the route that actually holds the seat will honour. Recurring events are
  // intentionally out of scope here (a visitor has not picked a run yet) —
  // the submit route still enforces the real per-run capacity regardless of
  // what this page shows.
  let spotsLeftByTicket: Record<string, number> | null = null;
  if (!data.recurrence && Array.isArray(data.ticketTypes) && data.ticketTypes.some((ticket: { capacity?: number | null }) => ticket.capacity != null)) {
    const regSnap = await adminDb
      .collection('tenants').doc(tenant.id)
      .collection('registrations')
      .where('eventId', '==', eventId)
      .select('status', 'ticketTypeId', 'quantity')
      .orderBy('__name__')
      .limit(5001)
      .get();
    if (regSnap.docs.length > 5000) throw new Error('Event capacity read exceeds the supported limit');
    const soldByTicket: Record<string, number> = {};
    for (const d of regSnap.docs) {
      const r = d.data();
      if (r.status !== 'confirmed') continue;
      soldByTicket[r.ticketTypeId] = (soldByTicket[r.ticketTypeId] || 0) + (Number(r.quantity) || 1);
    }
    spotsLeftByTicket = {};
    for (const t of data.ticketTypes) {
      if (t.capacity == null) continue;
      spotsLeftByTicket[t.id] = Math.max(0, t.capacity - (soldByTicket[t.id] || 0));
    }
  }

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
    // THE-379 (events remodel) — all optional, all absent on every event that
    // predates this feature, so the client component's existing render for
    // those events is untouched.
    recurrence: data.recurrence || null,
    timeZone: data.timeZone || null,
    registrationQuestions: Array.isArray(data.registrationQuestions) ? data.registrationQuestions : [],
    openToAnyone: data.openToAnyone ?? true,
    spotsLeftByTicket,
  };

  const branding = (tenant as any).config || {};

  /**
   * THE-355 — 🔴 THE CHURCH'S OWN PAYMENT LINKS, ON THE ONE SCREEN THAT NEEDS
   * THEM.
   *
   * THE FOUNDER CONFIGURED REVOLUT AND WAS NEVER SHOWN IT. THE-351 added the
   * per-event provider choice and resolved it for `/api/my-registrations` —
   * i.e. for the LOGGED-IN member app — and this page, the one a public
   * registrant actually lands on, rendered the reference code and the
   * disclaimer and nothing else. The one screen that needed the link was the
   * one screen without it.
   *
   * 🔴 RESOLVED HERE RATHER THAN FETCHED BY THE CLIENT. This component already
   * holds the tenant and the event; a second round trip would add an API
   * surface, a loading state and a failure mode to a page that has the answer
   * in hand. `my-registrations` resolves it server-side for the same reason.
   *
   * ⚠️ INTERSECTED ON EVERY READ, NEVER TRUSTED FROM THE EVENT DOCUMENT.
   * `readGivingLinks` re-validates each stored URL against the phishing
   * allow-list, so a link that no longer passes simply stops being a link, and
   * `resolveEventPaymentLinks` can only ever NARROW what the church currently
   * publishes — a provider ticked for this event and since deleted from
   * Donations cannot render as a dead tile.
   *
   * ⚠️ THESE ARE PUBLIC BY CONSTRUCTION. They are the same links the church
   * publishes on its own giving page; nothing private crosses this boundary.
   */
  const payOptions = resolveEventPaymentLinks(
    readGivingLinks(branding as { givingLinks?: unknown }),
    data.paymentProviders,
  ).map((l) => ({
    id: l.provider.id,
    label: l.provider.label,
    url: l.url,
    handle: l.handle,
    email: l.email,
  }));

  return (
    <>
      <PublicRouteAnalytics route="/event/[eventId]" />
      <PublicEventRegistration
        tenantId={tenant.id}
        tenantName={tenant.name}
        logo={branding.logo || null}
        primaryColor={branding.primaryColor || '#B8962E'}
        event={event}
        payOptions={payOptions}
      />
    </>
  );
}
