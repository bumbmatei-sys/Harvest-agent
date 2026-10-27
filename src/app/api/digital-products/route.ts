import { NextRequest, NextResponse } from 'next/server';
import { FieldPath } from 'firebase-admin/firestore';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { requireAuth, requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { isDigitalKey, SAFE_DIGITAL_ID, hasDigitalEntitlement } from '@/lib/digital-products';
import { createR2Client, r2Bucket } from '@/lib/r2';
import { MAX_PDF_UPLOAD_BYTES } from '@/utils/upload-limits';
import { getPlanFeatures, toTenantPlan, UNLIMITED_CAP } from '@/utils/plan-features';

export const dynamic = 'force-dynamic';
const collection = (tenant: string) => adminDb.collection('tenants').doc(tenant).collection('digitalProducts');

function validProduct(body: any, tenantId: string): boolean {
  return !!body && SAFE_DIGITAL_ID.test(body.id || '') &&
    typeof body.title === 'string' && !!body.title.trim() && body.title.length <= 200 &&
    typeof body.description === 'string' && body.description.length <= 10000 &&
    typeof body.coverUrl === 'string' && body.coverUrl.length <= 2048 &&
    Number.isSafeInteger(body.priceCents) && body.priceCents >= 0 &&
    ['draft', 'published'].includes(body.status) && isDigitalKey(body.objectKey, tenantId, body.id);
}

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  if (!user.tenantId || !SAFE_DIGITAL_ID.test(user.tenantId)) return NextResponse.json({ error: 'Tenant required' }, { status: 403 });
  const tenantId = user.tenantId;
  const admin = request.nextUrl.searchParams.get('admin') === '1';
  if (admin && !user.isAdmin && !user.isSuperAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
  try {
    if (!admin && request.nextUrl.searchParams.get('presence') === '1') {
      const docs = await collection(tenantId).where('status', '==', 'published').orderBy(FieldPath.documentId()).limit(1).get();
      return NextResponse.json({ present: !docs.empty }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const docs = await collection(tenantId).get();
    const products = await Promise.all(docs.docs.filter(d => admin || d.data().status === 'published').map(async d => {
      const data = d.data();
      return {
        id: d.id, title: data.title, description: data.description, coverUrl: data.coverUrl,
        priceCents: data.priceCents, status: data.status,
        ...(admin ? { objectKey: data.objectKey, fileName: data.fileName, fileSize: data.fileSize } : { entitled: await hasDigitalEntitlement(tenantId, d.id, user.uid) }),
      };
    }));
    return NextResponse.json({ products }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Digital products read failed', error);
    return NextResponse.json({ error: 'Could not load products' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;
  if (!user.tenantId || !SAFE_DIGITAL_ID.test(user.tenantId)) return NextResponse.json({ error: 'Tenant required' }, { status: 403 });
  const tenantId = user.tenantId;
  const body = await request.json().catch(() => null);
  if (!validProduct(body, tenantId)) return NextResponse.json({ error: 'Invalid product details or PDF' }, { status: 400 });
  try {
    const bucket = r2Bucket();
    if (!bucket) throw new Error('Storage not configured');
    const object = await createR2Client().send(new HeadObjectCommand({ Bucket: bucket, Key: body.objectKey }));
    if (object.ContentType !== 'application/pdf' || !object.ContentLength || object.ContentLength > MAX_PDF_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'PDF must be at most 15MB' }, { status: 400 });
    }
    const tenantRef = adminDb.collection('tenants').doc(tenantId);
    const productRef = collection(tenantId).doc(body.id);
    const saved = await adminDb.runTransaction(async tx => {
      const existing = await tx.get(productRef);
      if (!existing.exists) {
        const tenant = await tx.get(tenantRef);
        if (!tenant.exists) throw new Error('Tenant not found');
        const cap = getPlanFeatures(toTenantPlan(tenant.data()?.plan)).maxProducts;
        if (cap !== UNLIMITED_CAP) {
          const products = await tx.get(collection(tenantId));
          if (products.size >= cap) return false;
        }
      }
      tx.set(productRef, {
        title: body.title.trim(), description: body.description, coverUrl: body.coverUrl,
        priceCents: body.priceCents, status: body.status, objectKey: body.objectKey,
        fileName: typeof body.fileName === 'string' ? body.fileName.slice(0, 255) : '',
        fileSize: object.ContentLength, updatedAt: Date.now(),
      });
      return true;
    });
    if (!saved) return NextResponse.json({ error: 'Your plan has reached its digital product limit.', code: 'product_limit_reached' }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Digital product save failed', error);
    return NextResponse.json({ error: 'Could not save product; check the uploaded PDF and try again' }, { status: 500 });
  }
}
