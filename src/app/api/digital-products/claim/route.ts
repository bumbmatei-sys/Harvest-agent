import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { SAFE_DIGITAL_ID } from '@/lib/digital-products';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => null);
  if (!user.tenantId || !SAFE_DIGITAL_ID.test(user.tenantId) ||
      !SAFE_DIGITAL_ID.test(user.uid) || !SAFE_DIGITAL_ID.test(body?.productId || '')) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  try {
    const ref = adminDb.collection('tenants').doc(user.tenantId).collection('digitalProducts').doc(body.productId);
    await adminDb.runTransaction(async tx => {
      const product = await tx.get(ref);
      if (!product.exists || product.data()?.status !== 'published' || product.data()?.priceCents !== 0) {
        throw new Error('unavailable');
      }
      tx.set(ref.collection('entitlements').doc(user.uid), { active: true, claimedAt: Date.now() }, { merge: true });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'unavailable') {
      return NextResponse.json({ error: 'Product unavailable' }, { status: 404 });
    }
    console.error('Digital claim failed', error);
    return NextResponse.json({ error: 'Could not claim product' }, { status: 500 });
  }
}
