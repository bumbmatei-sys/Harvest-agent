import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAdmin } from '@/lib/api-auth';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';

// Hard cap on uploaded image size. Cloudinary's unsigned preset silently
// enforced a cap before; with the R2 flow this route is the only thing keeping
// it real, so validate here.
const MAX_IMAGE_UPLOAD_BYTES = 4 * 1024 * 1024; // 4MB

// Keep the object key filesystem/URL-safe: strip path separators, whitespace,
// and anything outside a conservative allow-list — same spirit as the
// `path.includes('..')` guard in signed-url/route.ts.
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '');
  return cleaned || 'upload';
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  // Super admin has tenantId: null — fall back to the platform tenant, exactly
  // as the other admin routes do. Never trust a client-supplied tenant id.
  const resolvedTenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  let body: { fileName?: string; contentType?: string; fileSize?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { fileName, contentType, fileSize } = body;

  if (!contentType || typeof contentType !== 'string' || !contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'Only image uploads are allowed' }, { status: 400 });
  }

  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ error: 'Invalid file size' }, { status: 400 });
  }
  if (fileSize > MAX_IMAGE_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Image exceeds the 4MB limit' }, { status: 400 });
  }

  if (!fileName || typeof fileName !== 'string') {
    return NextResponse.json({ error: 'Missing file name' }, { status: 400 });
  }

  const key = `tenants/${resolvedTenantId}/uploads/${randomUUID()}-${sanitizeFileName(fileName)}`;

  try {
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      // Path-style keeps the PUT on the same host as the configured endpoint
      // (<account>.r2.cloudflarestorage.com/<bucket>/...) rather than the
      // virtual-hosted subdomain form, which R2's CORS + signing expect.
      forcePathStyle: true,
      // AWS SDK >= 3.729 auto-adds CRC32 checksum headers to PutObjectCommand and
      // folds them into the presigned signature. A browser fetch PUT never sends
      // those headers, so R2 rejects the signed request (status 0 / Failed to fetch).
      // WHEN_REQUIRED stops the SDK injecting the checksum so unsigned browser PUTs work.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
    });

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 5 * 60 }, // 5 minutes
    );

    return NextResponse.json({
      uploadUrl,
      publicUrl: `${process.env.R2_PUBLIC_URL}/${key}`,
    });
  } catch (e: any) {
    console.error('presign error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 });
  }
}
