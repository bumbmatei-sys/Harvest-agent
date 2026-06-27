import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * Adjust the live viewer count for a tenant's active stream. Called by the
 * user app on open (+1) and close (-1). Any authenticated user may report.
 * Also bumps the session's peakViewers high-water mark.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  let body: { tenantId?: string; delta?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { tenantId } = body;
  const delta = body.delta === -1 ? -1 : 1;
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  try {
    const currentRef = adminDb.collection('tenants').doc(tenantId).collection('livestream').doc('current');
    const snap = await currentRef.get();
    if (!snap.exists || snap.data()?.active !== true) {
      return NextResponse.json({ viewerCount: 0 });
    }

    await currentRef.set({ viewerCount: FieldValue.increment(delta) }, { merge: true });
    const after = await currentRef.get();
    const viewerCount = Math.max(0, after.data()?.viewerCount || 0);
    // Clamp negative drift back to 0.
    if (viewerCount === 0 && (after.data()?.viewerCount || 0) < 0) {
      await currentRef.set({ viewerCount: 0 }, { merge: true });
    }

    // Update the session's peak.
    const sessionId = after.data()?.sessionId;
    if (delta === 1 && sessionId) {
      const sessionRef = adminDb.collection('tenants').doc(tenantId).collection('livestreamSessions').doc(sessionId);
      const sess = await sessionRef.get();
      if (sess.exists && viewerCount > (sess.data()?.peakViewers || 0)) {
        await sessionRef.set({ peakViewers: viewerCount }, { merge: true });
      }
    }

    return NextResponse.json({ viewerCount });
  } catch (e) {
    console.error('Viewer count error:', e);
    return NextResponse.json({ error: 'Failed to update viewer count' }, { status: 500 });
  }
}
