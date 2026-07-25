import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAdmin } from '@/lib/api-auth';
import { createR2Client, r2Bucket } from '@/lib/r2';
import { tenantUploadKey } from '@/utils/r2-keys';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_PDF_UPLOAD_BYTES, limitMb } from '@/utils/upload-limits';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';

// Hard caps on uploaded size. Cloudinary's unsigned preset silently enforced one
// for images before; with the R2 flow this route is the only thing keeping it
// real, so validate here. `fileSize` is client-declared and therefore advisory —
// it stops the obvious case cheaply; the PDF path re-checks the true size from
// R2 in /api/rag/extract before doing any work with the bytes.

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

  if (!contentType || typeof contentType !== 'string') {
    return NextResponse.json({ error: 'Missing content type' }, { status: 400 });
  }

  // Images (cover art, logos) and PDFs (AI Knowledge sources) are the only two
  // things the app uploads. PDFs go direct-to-R2 because a 15MB file cannot fit
  // through a Vercel Function's 4.5MB request body.
  const isImage = contentType.startsWith('image/');
  const isPdf = contentType === 'application/pdf';
  if (!isImage && !isPdf) {
    return NextResponse.json({ error: 'Only image and PDF uploads are allowed' }, { status: 400 });
  }

  const maxBytes = isPdf ? MAX_PDF_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES;

  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ error: 'Invalid file size' }, { status: 400 });
  }
  if (fileSize > maxBytes) {
    return NextResponse.json(
      { error: `${isPdf ? 'PDF' : 'Image'} exceeds the ${limitMb(maxBytes)}MB limit` },
      { status: 400 },
    );
  }

  if (!fileName || typeof fileName !== 'string') {
    return NextResponse.json({ error: 'Missing file name' }, { status: 400 });
  }

  const key = tenantUploadKey(resolvedTenantId, randomUUID(), fileName);

  try {
    const s3 = createR2Client();

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: r2Bucket(),
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: 5 * 60 }, // 5 minutes
    );

    return NextResponse.json({
      uploadUrl,
      // The image flow saves `publicUrl` into Firestore. The PDF flow hands
      // `key` straight back to /api/rag/extract, which re-derives ownership
      // from the caller's own token rather than trusting this value.
      key,
      publicUrl: `${process.env.R2_PUBLIC_URL}/${key}`,
    });
  } catch (e: any) {
    console.error('presign error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 });
  }
}
