import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/active
 * Returns the single currently active fundraising campaign for the requesting
 * tenant (determined from the `x-tenant-id` header), or null if none exists.
 *
 * Public endpoint — no auth required so the widget works for anonymous visitors.
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = request.headers.get('x-tenant-id');

    let snapshot;
    if (tenantId) {
      snapshot = await adminDb
        .collection('campaigns')
        .where('tenantId', '==', tenantId)
        .where('isActive', '==', true)
        .limit(1)
        .get();
    } else {
      // Main Harvest site — fetch global (tenant-less) active campaign
      snapshot = await adminDb
        .collection('campaigns')
        .where('isActive', '==', true)
        .limit(1)
        .get();
    }

    if (snapshot.empty) {
      return NextResponse.json({ campaign: null });
    }

    const doc = snapshot.docs[0];
    return NextResponse.json({
      campaign: { id: doc.id, ...doc.data() },
    });
  } catch (error) {
    console.error('GET /api/campaigns/active error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
