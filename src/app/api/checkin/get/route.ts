import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { tenantFeaturesById } from '@/lib/tenant-features';

export const dynamic = 'force-dynamic';

/**
 * Public (no-auth) fetch of a check-in session so the public page at
 * /checkin/{sessionId} can render the form. Returns 404 for missing sessions
 * and 410 for closed ones.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  const sessionId = searchParams.get('sessionId');

  if (!tenantId || !sessionId) {
    return NextResponse.json({ error: 'tenantId and sessionId are required' }, { status: 400 });
  }

  try {
    // 🔴 THE TIER MUST HOLD CHECK-IN — THE-213, server side.
    //
    // `checkInSystem` is false on Free and on Individual, and this route is
    // PUBLIC: no auth, `force-dynamic`, served through the Admin SDK, which
    // bypasses firestore.rules entirely. AdminCheckin hiding its Check-In
    // sub-tab is not a gate — precedent THE-193 — so a QR printed before a
    // downgrade, or a link someone kept, would otherwise still open the form
    // that POSTs to /api/checkin/submit.
    //
    // Refused as the 404 this route already gives a missing session, not as an
    // explanatory 403: the caller is an anonymous visitor at a door, and a
    // church's subscription tier is not theirs to be told.
    //
    // Placed before the session read, so a refused tenant's sessions are never
    // fetched. Nothing is deleted — the sessions and their attendees are
    // untouched and come back whole on an upgrade.
    const features = await tenantFeaturesById(tenantId);
    if (!features?.checkInSystem) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const snap = await adminDb
      .collection('tenants').doc(tenantId)
      .collection('checkinSessions').doc(sessionId)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    const data = snap.data()!;
    if (data.status === 'closed') {
      return NextResponse.json({ error: 'This check-in session is closed.' }, { status: 410 });
    }

    return NextResponse.json({
      id: snap.id,
      name: data.name || 'Check-In',
      location: data.location || '',
      date: data.date || null,
      status: data.status || 'active',
    });
  } catch (e) {
    console.error('Check-in get error:', e);
    return NextResponse.json({ error: 'Failed to load session' }, { status: 500 });
  }
}
