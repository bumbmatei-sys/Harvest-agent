import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { sendAutomatedSms } from '@/lib/twilio';
import { captureHandledError } from '@/lib/money-path-sentry';
import { tenantFeaturesById } from '@/lib/tenant-features';

export const dynamic = 'force-dynamic';

/**
 * Public (no-auth) check-in endpoint. Records an attendee on the session and,
 * when the email matches an existing CRM contact, logs an "Attended" activity.
 * Unlike custom forms, a non-matching check-in does NOT create a contact
 * (check-ins are lighter-weight). All writes use the admin SDK.
 */
export async function POST(request: NextRequest) {
  let body: { tenantId?: string; sessionId?: string; firstName?: string; lastName?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { tenantId, sessionId } = body;
  const firstName = (body.firstName || '').trim();
  const lastName = (body.lastName || '').trim();
  const email = (body.email || '').trim().toLowerCase();

  if (!tenantId || !sessionId || !firstName) {
    return NextResponse.json({ error: 'tenantId, sessionId and firstName are required' }, { status: 400 });
  }

  try {
    // 🔴 THE TIER MUST HOLD CHECK-IN — THE-213, server side, and this is the
    // one that matters: THIS ROUTE WRITES. It appends an `attendees` document,
    // increments `attendeeCount`, adds a `contactActivities` row against a
    // matched CRM contact and can send an automated SMS — all through the
    // Admin SDK, which bypasses firestore.rules entirely, on a PUBLIC no-auth
    // endpoint. `checkInSystem` is false on Free and on Individual, so without
    // this a tier with no check-in still accumulates attendance records.
    //
    // A hidden sub-tab is not a gate and a disabled button is a suggestion:
    // the admin screen already withholds Check-In on those tiers, and the
    // founder still reached a working check-in. This is the refusal.
    //
    // 404, matching the missing-session answer below, rather than a 403 naming
    // the plan: the caller is an anonymous visitor at a door.
    //
    // Placed before the session read, so a refused tenant's documents are never
    // touched. Existing attendees, sessions and activities are untouched and
    // return whole on an upgrade.
    const features = await tenantFeaturesById(tenantId);
    if (!features?.checkInSystem) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const sessionRef = adminDb.collection('tenants').doc(tenantId).collection('checkinSessions').doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    const session = sessionSnap.data()!;
    if (session.status === 'closed') {
      return NextResponse.json({ error: 'This check-in session is closed.' }, { status: 410 });
    }

    let crmContactId: string | null = null;
    if (email) {
      // Single-field query, filter tenant client-side (no compound query).
      const matchSnap = await adminDb.collection('contacts').where('email', '==', email).limit(20).get();
      const match = matchSnap.docs.find((d) => (d.data().tenantId || null) === tenantId);
      if (match) {
        crmContactId = match.id;
        await adminDb.collection('contactActivities').add({
          contactId: match.id,
          tenantId,
          type: 'meeting',
          description: `Attended: ${session.name || 'Check-In'}`,
          amount: null,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'checkin',
        });
        // Automated SMS thank-you (if the matched contact has a phone & the
        // tenant enabled the trigger). Best-effort — never blocks check-in.
        const phone = match.data().phone as string | undefined;
        if (phone) {
          await sendAutomatedSms(tenantId, 'checkin_thankyou', phone, { name: firstName });
        }
      }
    }

    await sessionRef.collection('attendees').add({
      firstName,
      lastName,
      email: email || null,
      checkedInAt: FieldValue.serverTimestamp(),
      crmContactId,
    });

    await sessionRef.set({ attendeeCount: FieldValue.increment(1) }, { merge: true });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Check-in submit error:', e);
    // An attendee at the door didn't get checked in. The CRM "Attended" activity
    // is written before the attendee row, so a failure can also leave the contact
    // marked as having attended a session they were never recorded on.
    captureHandledError(e, { step: 'checkin-submit', tenantId, ids: { sessionId } });
    return NextResponse.json({ error: 'Failed to check in' }, { status: 500 });
  }
}
