import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

/**
 * GET /api/canvas/cleanup
 * Delete expired canvases (older than 7 days).
 * Called by Vercel Cron daily at 3am.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    // Fix 2: CRON_SECRET undefined bypass — reject if secret is not set
    const secret = process.env.CRON_SECRET;
    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Query for expired canvases using collectionGroup
    const expiredSnapshot = await adminDb
      .collectionGroup('canvases')
      .where('expiresAt', '<', Timestamp.now())
      .limit(100)
      .get();

    let deleted = 0;

    // Delete each expired canvas
    const batch = adminDb.batch();
    for (const doc of expiredSnapshot.docs) {
      batch.delete(doc.ref);
      deleted++;
    }

    if (deleted > 0) {
      await batch.commit();
    }

    return NextResponse.json({ deleted });
  } catch (error) {
    console.error('Canvas cleanup error:', error);
    return NextResponse.json(
      { error: 'Cleanup failed' },
      { status: 500 }
    );
  }
}
