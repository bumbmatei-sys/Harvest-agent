import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { createR2Client, r2Bucket } from '@/lib/r2';
import { DIGITAL_URL_TTL_SECONDS, hasDigitalEntitlement, isDigitalKey, SAFE_DIGITAL_ID } from '@/lib/digital-products';

export const dynamic = 'force-dynamic';

function downloadFilename(title: unknown): string {
  const slug = typeof title === 'string'
    ? title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '')
    : '';
  return `${slug || 'product'}.pdf`;
}

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => null);
  if (!user.tenantId || !SAFE_DIGITAL_ID.test(user.tenantId) || !SAFE_DIGITAL_ID.test(body?.productId || '')) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  try {
    if (!await hasDigitalEntitlement(user.tenantId, body.productId, user.uid)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    const product = await adminDb.collection('tenants').doc(user.tenantId)
      .collection('digitalProducts').doc(body.productId).get();
    const key = product.data()?.objectKey;
    if (!product.exists || !isDigitalKey(key, user.tenantId, body.productId)) {
      return NextResponse.json({ error: 'Product unavailable' }, { status: 404 });
    }
    const bucket = r2Bucket();
    if (!bucket) throw new Error('Storage not configured');
    const url = await getSignedUrl(createR2Client(), new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${downloadFilename(product.data()?.title)}"`,
    }), { expiresIn: DIGITAL_URL_TTL_SECONDS });
    return NextResponse.json({ url, expiresInSeconds: DIGITAL_URL_TTL_SECONDS }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Digital download failed', error);
    return NextResponse.json({ error: 'Could not prepare download' }, { status: 500 });
  }
}
