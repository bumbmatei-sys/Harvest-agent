import { useQuery } from '@tanstack/react-query';
import { collection, query, where, getDocs, getDoc, doc, limit, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Timestamp } from 'firebase/firestore';

export interface TicketType {
  id: string;             // uuid generated client-side
  name: string;           // e.g. "Adult", "Child", "Volunteer"
  description?: string | null; // null (never undefined) so Firestore accepts the write
  price: number;          // in cents (0 = free)
  capacity: number | null; // null = unlimited
  order: number;          // display order
}

export interface DiscountCode {
  code: string;           // e.g. "SCHOLAR50"
  type: 'percent' | 'fixed'; // percent off or fixed cents off
  value: number;          // percent (0-100) or cents
  maxUses: number | null; // null = unlimited
  usedCount: number;
}

export interface Event {
  id: string;
  title: string;
  description: string;
  coverImage: string | null;
  location: string;
  isOnline: boolean;
  onlineLink: string | null;
  startDate: Timestamp | null;
  endDate: Timestamp | null;
  capacity: number | null;
  registrationDeadline: Timestamp | null;
  price: number;
  currency: string;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  pinned?: boolean;
  createdAt: Timestamp | null;
  createdBy: string;
  tenantId: string;
  // Registration engine
  registrationEnabled?: boolean;       // hybrid toggle — false by default
  ticketTypes?: TicketType[];          // empty array by default
  waitlistEnabled?: boolean;           // false by default
  discountCodes?: DiscountCode[];      // empty array by default
  showOnPublicCalendar?: boolean;      // true by default for published events
  /**
   * THE-351 — which of the CHURCH'S OWN payment links accept payment for this
   * event. `GivingProviderId[]`, typed as `string[]` here so this hook stays
   * free of the provider table; every reader cleans it through
   * `readEventProviderIds`, which walks the table and drops anything this build
   * does not define. Empty (or absent) means every link the church publishes.
   */
  paymentProviders?: string[];
}

export interface Registration {
  id: string;
  eventId: string;
  userId: string | null;
  name: string;
  email: string;
  phone: string | null;
  ticketCode: string;
  status: 'confirmed' | 'cancelled' | 'attended' | 'waitlisted';
  amount: number;
  registeredAt: Timestamp | null;
  ticketTypeId?: string | null;
  ticketTypeName?: string | null;
  waitlisted?: boolean;
  discountCode?: string | null;
  discountAmount?: number;         // cents saved
  additionalAttendees?: { name: string; email?: string }[]; // household/group

  /**
   * ─── THE-351 · manual payment confirmation ────────────────────────────────
   *
   * 🔴 `status` ABOVE IS REGISTRATION STATUS AND HAS NEVER MEANT MONEY. These
   * are separate fields precisely so that check-in — which reads `status` — can
   * never come to depend on whether anybody has paid. See `paymentStateOf`,
   * which is the ONE place these are read into a state.
   */
  /** `'unpaid' | 'confirmed'`. Absent entirely on a free registration. */
  paymentStatus?: string;
  /** The code the member is asked to put in the payment note. Never the QR's. */
  paymentReference?: string;
  /** ISO — when the member pressed "I've paid". 🔴 Confirms NOTHING. */
  paymentClaimedAt?: string;
  /** Which provider the MEMBER SAYS they used. Their word, stored as theirs. */
  paymentClaimProvider?: string | null;
  /** ISO — when a named admin at the church vouched for it. */
  paymentConfirmedAt?: string;
  /** 🔴 The uid of the admin who vouched. The audit trail of WHO. */
  paymentConfirmedBy?: string;
  /** That admin's address, resolved at confirm time, for a human to read. */
  paymentConfirmedByName?: string;
  /** 🔴 The `tenants/{t}/invoices` id THE-350's writer returned. */
  paymentInvoiceId?: string;
}

export const useEvents = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    queryKey: ['events', tenantId],
    queryFn: async (): Promise<Event[]> => {
      if (!tenantId) return [];
      const q = query(
        collection(db, 'tenants', tenantId, 'events'),
        orderBy('startDate', 'desc'),
        limit(100),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Event);
    },
    enabled: isAuthReady && !!tenantId,
    staleTime: 1000 * 60 * 5,
  });

export const useEvent = (tenantId: string | null | undefined, eventId: string | null | undefined) =>
  useQuery({
    queryKey: ['event', tenantId, eventId],
    queryFn: async (): Promise<Event | null> => {
      if (!tenantId || !eventId) return null;
      const snap = await getDoc(doc(db, 'tenants', tenantId, 'events', eventId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as Event;
    },
    enabled: !!tenantId && !!eventId,
    staleTime: 1000 * 60 * 5,
  });

export const useEventRegistrations = (
  tenantId: string | null | undefined,
  eventId: string | null | undefined,
) =>
  useQuery({
    queryKey: ['eventRegistrations', tenantId, eventId],
    queryFn: async (): Promise<Registration[]> => {
      if (!tenantId || !eventId) return [];
      const q = query(
        collection(db, 'tenants', tenantId, 'registrations'),
        where('eventId', '==', eventId),
        limit(500),
      );
      const snap = await getDocs(q);
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Registration);
      rows.sort((a, b) => (b.registeredAt?.toMillis() || 0) - (a.registeredAt?.toMillis() || 0));
      return rows;
    },
    enabled: !!tenantId && !!eventId,
    staleTime: 1000 * 60 * 2,
  });
