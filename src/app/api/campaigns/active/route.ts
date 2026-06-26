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

    // Single-field filter only (isActive); tenant scoping is applied in-memory
    // so no composite (tenantId + isActive) index is required.
    const snapshot = await adminDb
      .collection('campaigns')
      .where('isActive', '==', true)
      .limit(20)
      .get();

    const docs = tenantId
      ? snapshot.docs.filter((d) => d.data().tenantId === tenantId)
      : snapshot.docs;

    if (docs.length === 0) {
      return NextResponse.json({ campaign: null });
    }

    const doc = docs[0];
    return NextResponse.json({
      campaign: { id: doc.id, ...doc.data() },
    });
  } catch (error) {
    console.error('GET /api/campaigns/active error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
