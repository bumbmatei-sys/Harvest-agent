import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { readGivingLinks } from '@/components/donations/giving-providers';
import { paymentStateOf, resolveEventPaymentLinks, type PaymentState } from '@/lib/event-payment-claims';

export const dynamic = 'force-dynamic';

// Only a genuinely-held seat shows a QR in-app. A pending_payment reg hasn't been
// paid, and expired/cancelled regs are dead — showing any of them a scannable
// ticket would let someone through a door they never paid for / that was voided.
const SHOWABLE_STATUSES = new Set(['confirmed', 'waitlisted']);

/**
 * THE-351 — one provider the member may pay this church through, flattened for
 * the client so `UserEvents` needs no provider table of its own.
 */
interface PayOption {
  id: string;
  label: string;
  /** A normalised https URL on the provider's own host, or null. */
  url: string | null;
  handle: string | null;
  email: string | null;
}

interface Ticket {
  id: string;
  eventId: string | null;
  ticketCode: string | null;
  status: string;
  ticketTypeName: string | null;
  waitlisted: boolean;
  amount: number;
  /**
   * 🔴 THE-351 — the payment state, DERIVED SERVER-SIDE by `paymentStateOf`.
   * Sent as a computed value rather than as raw fields so the client cannot
   * form a second opinion about what "paid" means; `confirmed` is keyed on the
   * invoice id, which only the confirm route can write.
   */
  payment: PaymentState;
  paymentReference: string | null;
  paymentConfirmedAt: string | null;
  /**
   * The links THIS event accepts, already intersected against what the church
   * currently publishes — so a provider the church has since deleted cannot
   * render as a dead tile on somebody's ticket.
   */
  payOptions: PayOption[];
  event: {
    title: string;
    startMillis: number | null;
    location: string | null;
    isOnline: boolean;
    status: string | null;
  } | null;
}

/**
 * Authenticated "my tickets" read. Returns the caller's own event registrations
 * for a tenant so the in-app "My Events" screen can render the QR + ticket code
 * without depending on the confirmation email.
 *
 * Matching is dual: userId PRIMARY (stamped by the logged-in register path) and
 * email FALLBACK (pre-existing regs written with userId:null before this feature,
 * or the public logged-out path where the same person used their account email).
 * Both are single-field queries; results are merged + deduped by doc id.
 *
 * Uses the Admin SDK behind requireAuth rather than a client Firestore read, so
 * the email fallback works WITHOUT widening firestore.rules (the registrations
 * read rule only allows resource.data.userId == request.auth.uid). The caller
 * only ever sees rows matching their own verified uid/email — never anyone else's.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  try {
    const regsCol = adminDb.collection('tenants').doc(tenantId).collection('registrations');
    const email = auth.email ? auth.email.toLowerCase() : null;

    const [byUid, byEmail] = await Promise.all([
      regsCol.where('userId', '==', auth.uid).limit(500).get(),
      email
        ? regsCol.where('email', '==', email).limit(500).get()
        : Promise.resolve({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }),
    ]);

    // Merge + dedupe, keeping only showable statuses.
    const seen = new Set<string>();
    const rows: Array<{ id: string; data: FirebaseFirestore.DocumentData }> = [];
    for (const d of [...byUid.docs, ...byEmail.docs]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data();
      if (!SHOWABLE_STATUSES.has(data.status)) continue;
      rows.push({ id: d.id, data });
    }

    // Join event docs (for title/date/location) so each ticket renders on its own.
    const eventIds = Array.from(new Set(rows.map((r) => r.data.eventId).filter(Boolean))) as string[];
    const eventMap: Record<string, Ticket['event']> = {};
    /** Raw `paymentProviders` per event, cleaned below against the church's own links. */
    const eventProviders: Record<string, unknown> = {};
    await Promise.all(
      eventIds.map(async (eid) => {
        try {
          const es = await adminDb.collection('tenants').doc(tenantId).collection('events').doc(eid).get();
          if (es.exists) {
            const e = es.data() || {};
            const start = e.startDate;
            eventProviders[eid] = e.paymentProviders;
            eventMap[eid] = {
              title: e.title || 'Event',
              startMillis: start && typeof start.toMillis === 'function' ? start.toMillis() : null,
              location: e.location || null,
              isOnline: !!e.isOnline,
              status: e.status || null,
            };
          }
        } catch {
          // Best-effort join — a missing event still returns the raw ticket.
        }
      }),
    );

    /**
     * 🔴 THE CHURCH'S OWN LINKS, RE-VALIDATED ON READ. `readGivingLinks` re-runs
     * the phishing allow-list over every stored URL rather than trusting one
     * that was accepted once, so a link a church has since broken stops being an
     * `href` on a member's ticket at the same moment it stops being one on the
     * Give page. One read of the tenant document serves every row.
     */
    let churchLinks: ReturnType<typeof readGivingLinks> = [];
    try {
      const tSnap = await adminDb.collection('tenants').doc(tenantId).get();
      churchLinks = readGivingLinks(tSnap.data()?.config as { givingLinks?: unknown } | undefined);
    } catch {
      // A ticket without its payment options is still a ticket. The reference
      // code is on the row either way, so the member can still be told what to
      // put in the note.
    }

    const tickets: Ticket[] = rows.map((r) => {
      const eventId = r.data.eventId || null;
      const payment = paymentStateOf(r.data);
      return {
        id: r.id,
        eventId,
        ticketCode: r.data.ticketCode || null,
        status: r.data.status,
        ticketTypeName: r.data.ticketTypeName || null,
        waitlisted: !!r.data.waitlisted,
        amount: typeof r.data.amount === 'number' ? r.data.amount : 0,
        payment,
        paymentReference: typeof r.data.paymentReference === 'string' ? r.data.paymentReference : null,
        paymentConfirmedAt: typeof r.data.paymentConfirmedAt === 'string' ? r.data.paymentConfirmedAt : null,
        payOptions: payment === 'free' || payment === 'confirmed'
          ? []
          : resolveEventPaymentLinks(churchLinks, eventId ? eventProviders[eventId] : undefined)
              .map((l) => ({
                id: l.provider.id,
                label: l.provider.label,
                url: l.url,
                handle: l.handle,
                email: l.email,
              })),
        event: (eventId && eventMap[eventId]) || null,
      };
    });

    return NextResponse.json({ tickets });
  } catch (e) {
    console.error('my-registrations error:', e);
    return NextResponse.json({ error: 'Failed to load registrations' }, { status: 500 });
  }
}
