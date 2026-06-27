import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * Submit a prayer request during a live stream. Written to the active session's
 * prayers subcollection via the admin SDK so the live admin panel can see it in
 * real time. Any authenticated viewer may submit.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  let body: { tenantId?: string; name?: string; prayerText?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { tenantId } = body;
  const name = (body.name || 'Anonymous').trim().slice(0, 120);
  const prayerText = (body.prayerText || '').trim().slice(0, 2000);
  if (!tenantId || !prayerText) {
    return NextResponse.json({ error: 'tenantId and prayerText are required' }, { status: 400 });
  }

  try {
    const currentRef = adminDb.collection('tenants').doc(tenantId).collection('livestream').doc('current');
    const current = await currentRef.get();
    const sessionId = current.data()?.sessionId;
    if (!current.exists || current.data()?.active !== true || !sessionId) {
      return NextResponse.json({ error: 'No live stream is active.' }, { status: 410 });
    }

    const sessionRef = adminDb.collection('tenants').doc(tenantId).collection('livestreamSessions').doc(sessionId);
    await sessionRef.collection('prayers').add({
      name,
      prayerText,
      submittedAt: FieldValue.serverTimestamp(),
      prayed: false,
    });
    await sessionRef.set({ prayerCount: FieldValue.increment(1) }, { merge: true });
    await currentRef.set({ prayerCount: FieldValue.increment(1) }, { merge: true });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Prayer submit error:', e);
    return NextResponse.json({ error: 'Failed to submit prayer' }, { status: 500 });
  }
}
