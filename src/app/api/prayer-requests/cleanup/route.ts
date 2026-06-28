import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

/**
 * GET /api/prayer-requests/cleanup
 * Delete expired prayer requests (past their `expiresAt`, i.e. older than 30 days).
 * Called by Vercel Cron daily at 4am UTC.
 */
export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');
    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const expired = await adminDb
      .collection('prayer_requests')
      .where('expiresAt', '<', Timestamp.now())
      .limit(200)
      .get();
    let deleted = 0;
    const batch = adminDb.batch();
    for (const doc of expired.docs) { batch.delete(doc.ref); deleted++; }
    if (deleted > 0) await batch.commit();
    return NextResponse.json({ deleted });
  } catch (error) {
    console.error('Prayer cleanup error:', error);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
