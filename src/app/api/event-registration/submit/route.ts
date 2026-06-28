import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import QRCode from 'qrcode';
import { Resend } from 'resend';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

interface TicketType {
  id: string;
  name: string;
  description?: string;
  price: number;
  capacity: number | null;
  order: number;
}
interface DiscountCode {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  maxUses: number | null;
  usedCount: number;
}
interface AdditionalAttendee { name: string; email?: string }

/**
 * Public (no-auth) event registration endpoint. Records a registration on the
 * event's ticket type, enforces capacity / waitlist, applies a discount code,
 * emails a confirmation with a QR ticket, and logs a CRM activity when the
 * email matches an existing contact. All writes use the admin SDK.
 */
export async function POST(request: NextRequest) {
  let body: {
    tenantId?: string;
    eventId?: string;
    ticketTypeId?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    additionalAttendees?: AdditionalAttendee[];
    discountCode?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { tenantId, eventId, ticketTypeId } = body;
  const firstName = (body.firstName || '').trim();
  const lastName = (body.lastName || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const phone = (body.phone || '').trim();
  const discountCodeInput = (body.discountCode || '').trim().toUpperCase();
  const additionalAttendees = Array.isArray(body.additionalAttendees)
    ? body.additionalAttendees.filter((a) => a && a.name && a.name.trim()).slice(0, 9)
    : [];

  if (!tenantId || !eventId || !ticketTypeId || !firstName || !lastName || !email) {
    return NextResponse.json(
      { error: 'tenantId, eventId, ticketTypeId, firstName, lastName and email are required' },
      { status: 400 },
    );
  }

  try {
    const eventRef = adminDb.collection('tenants').doc(tenantId).collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    const event = eventSnap.data() || {};

    if (event.status !== 'published' || !event.registrationEnabled) {
      return NextResponse.json({ error: 'Registration is not available for this event.' }, { status: 410 });
    }

    const ticketTypes: TicketType[] = Array.isArray(event.ticketTypes) ? event.ticketTypes : [];
    const ticketType = ticketTypes.find((t) => t.id === ticketTypeId);
    if (!ticketType) {
      return NextResponse.json({ error: 'Selected ticket type is no longer available.' }, { status: 400 });
    }

    // ── Capacity check (single-field query on eventId; filter client-side) ──
    const regSnap = await adminDb
      .collection('tenants').doc(tenantId).collection('registrations')
      .where('eventId', '==', eventId)
      .limit(5000)
      .get();
    const soldForType = regSnap.docs.filter((d) => {
      const r = d.data();
      return r.ticketTypeId === ticketTypeId && r.waitlisted !== true;
    }).length;

    let waitlisted = false;
    if (ticketType.capacity != null && soldForType >= ticketType.capacity) {
      if (event.waitlistEnabled) {
        waitlisted = true;
      } else {
        return NextResponse.json({ error: 'This ticket type is sold out' }, { status: 410 });
      }
    }

    // ── Discount code validation ──
    const discountCodes: DiscountCode[] = Array.isArray(event.discountCodes) ? event.discountCodes : [];
    let discountAmount = 0;
    let appliedCode: DiscountCode | null = null;
    if (discountCodeInput) {
      appliedCode = discountCodes.find((d) => d.code.toUpperCase() === discountCodeInput) || null;
      if (!appliedCode) {
        return NextResponse.json({ error: 'Invalid discount code' }, { status: 400 });
      }
      if (appliedCode.maxUses != null && appliedCode.usedCount >= appliedCode.maxUses) {
        return NextResponse.json({ error: 'Discount code has reached its limit' }, { status: 400 });
      }
      discountAmount = appliedCode.type === 'percent'
        ? Math.round((ticketType.price * appliedCode.value) / 100)
        : appliedCode.value;
      discountAmount = Math.min(discountAmount, ticketType.price);
    }

    const amount = Math.max(0, ticketType.price - discountAmount);
    const ticketCode = Math.random().toString(36).slice(2, 10).toUpperCase();

    // ── Write registration ──
    await adminDb.collection('tenants').doc(tenantId).collection('registrations').add({
      eventId,
      tenantId,
      userId: null,
      name: `${firstName} ${lastName}`,
      email,
      phone: phone || null,
      ticketTypeId,
      ticketTypeName: ticketType.name,
      ticketCode,
      status: waitlisted ? 'waitlisted' : 'confirmed',
      waitlisted: !!waitlisted,
      amount,
      discountCode: appliedCode ? appliedCode.code : null,
      discountAmount: discountAmount || 0,
      additionalAttendees,
      registeredAt: FieldValue.serverTimestamp(),
    });

    // ── Increment discount usage (read-modify-write the array) ──
    if (appliedCode) {
      const nextCodes = discountCodes.map((d) =>
        d.code.toUpperCase() === appliedCode!.code.toUpperCase()
          ? { ...d, usedCount: (d.usedCount || 0) + 1 }
          : d,
      );
      await eventRef.set({ discountCodes: nextCodes }, { merge: true }).catch(() => {});
    }

    // ── Confirmation email (best-effort) ──
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
        const tenantName = tenantSnap.data()?.name || tenantSnap.data()?.displayName || 'Harvest';
        const qrDataUrl = await QRCode.toDataURL(ticketCode, { width: 240, margin: 1 });
        const resend = new Resend(resendKey);
        const intro = waitlisted
          ? `You're on the waitlist for <strong>${event.title}</strong>. We'll contact you if a spot opens.`
          : `you're registered for <strong>${event.title}</strong>. Your ticket code is <strong>${ticketCode}</strong>.`;
        await resend.emails.send({
          from: 'Harvest <noreply@theharvest.app>',
          to: email,
          subject: `Your registration for ${event.title}`,
          html: `<p>Hi ${firstName}, ${intro}</p>` +
            (waitlisted ? '' : `<p>Present this QR code at the door:</p><p><img src="${qrDataUrl}" alt="Ticket QR" width="200" height="200" /></p>`) +
            `<br><p>— ${tenantName}</p>`,
        });
      } catch (e) {
        console.warn('Registration confirmation email failed:', e);
      }
    }

    // ── CRM activity (best-effort; single-field email query, filter tenant client-side) ──
    try {
      const matchSnap = await adminDb.collection('contacts').where('email', '==', email).limit(20).get();
      const match = matchSnap.docs.find((d) => (d.data().tenantId || null) === tenantId);
      if (match) {
        await adminDb.collection('contactActivities').add({
          contactId: match.id,
          tenantId,
          type: 'meeting',
          description: `Registered: ${event.title}`,
          amount: null,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'event-registration',
        });
      }
    } catch (e) {
      console.warn('Registration CRM activity log failed:', e);
    }

    return NextResponse.json({ success: true, ticketCode, waitlisted });
  } catch (e) {
    console.error('Event registration submit error:', e);
    return NextResponse.json({ error: 'Failed to register' }, { status: 500 });
  }
}
