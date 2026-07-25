import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { captureHandledError } from '@/lib/money-path-sentry';

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
    // Unattended nightly cron, and the data it fails to delete is sensitive:
    // prayer requests are meant to age out after 30 days, so a silently broken
    // sweep quietly retains them past their intended lifetime.
    captureHandledError(error, { step: 'prayer-requests-cleanup-cron', level: 'warning' });
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
