import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

interface TicketType { id: string; price: number }
interface DiscountCode {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  maxUses: number | null;
  usedCount: number;
}

/**
 * Public (no-auth) discount-code validation. Read-only — performs NO writes.
 * Returns the computed discount amount (in cents) for the selected ticket type
 * so the public registration page can show an order summary before submitting.
 */
export async function POST(request: NextRequest) {
  let body: { tenantId?: string; eventId?: string; discountCode?: string; ticketTypeId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ valid: false, error: 'Invalid request body' }, { status: 400 });
  }

  const { tenantId, eventId, ticketTypeId } = body;
  const code = (body.discountCode || '').trim().toUpperCase();

  if (!tenantId || !eventId || !code || !ticketTypeId) {
    return NextResponse.json({ valid: false, error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const snap = await adminDb
      .collection('tenants').doc(tenantId).collection('events').doc(eventId)
      .get();
    if (!snap.exists) {
      return NextResponse.json({ valid: false, error: 'Event not found' }, { status: 404 });
    }
    const event = snap.data() || {};

    const ticketTypes: TicketType[] = Array.isArray(event.ticketTypes) ? event.ticketTypes : [];
    const ticketType = ticketTypes.find((t) => t.id === ticketTypeId);
    if (!ticketType) {
      return NextResponse.json({ valid: false, error: 'Select a ticket type first' });
    }

    const discountCodes: DiscountCode[] = Array.isArray(event.discountCodes) ? event.discountCodes : [];
    const found = discountCodes.find((d) => d.code.toUpperCase() === code);
    if (!found) {
      return NextResponse.json({ valid: false, error: 'Invalid discount code' });
    }
    if (found.maxUses != null && found.usedCount >= found.maxUses) {
      return NextResponse.json({ valid: false, error: 'Discount code has reached its limit' });
    }

    let discountAmount = found.type === 'percent'
      ? Math.round((ticketType.price * found.value) / 100)
      : found.value;
    discountAmount = Math.min(discountAmount, ticketType.price);

    return NextResponse.json({ valid: true, discountAmount, type: found.type, value: found.value });
  } catch (e) {
    console.error('Apply discount error:', e);
    return NextResponse.json({ valid: false, error: 'Failed to validate code' }, { status: 500 });
  }
}
