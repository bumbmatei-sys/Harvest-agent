import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAdmin } from '@/lib/api-auth';
import { createR2Client, r2Bucket } from '@/lib/r2';
import { digitalKeyPrefix, SAFE_DIGITAL_ID } from '@/lib/digital-products';
import { MAX_PDF_UPLOAD_BYTES } from '@/utils/upload-limits';

export const dynamic = 'force-dynamic';

function validUpload(body: any): boolean {
  return !!body && SAFE_DIGITAL_ID.test(body.productId || '') && body.contentType === 'application/pdf' &&
    typeof body.fileSize === 'number' && Number.isInteger(body.fileSize) &&
    body.fileSize > 0 && body.fileSize <= MAX_PDF_UPLOAD_BYTES;
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;
  if (!user.tenantId || !SAFE_DIGITAL_ID.test(user.tenantId)) {
    return NextResponse.json({ error: 'Tenant required' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!validUpload(body)) return NextResponse.json({ error: 'Choose a PDF of at most 15MB' }, { status: 400 });
  try {
    const bucket = r2Bucket();
    if (!bucket) throw new Error('Storage not configured');
    const key = `${digitalKeyPrefix(user.tenantId, body.productId)}${randomUUID()}.pdf`;
    const uploadUrl = await getSignedUrl(createR2Client(), new PutObjectCommand({
      Bucket: bucket, Key: key, ContentType: 'application/pdf', ContentLength: body.fileSize,
    }), { expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length']) });
    return NextResponse.json({ uploadUrl, key });
  } catch (error) {
    console.error('Digital upload preparation failed', error);
    return NextResponse.json({ error: 'Could not prepare upload' }, { status: 500 });
  }
}
