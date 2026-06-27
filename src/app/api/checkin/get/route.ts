import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

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
