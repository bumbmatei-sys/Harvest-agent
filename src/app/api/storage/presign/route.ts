import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAdmin } from '@/lib/api-auth';
import { createR2Client, r2Bucket } from '@/lib/r2';
import { tenantUploadKey } from '@/utils/r2-keys';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_PDF_UPLOAD_BYTES, MAX_SOCIAL_IMAGE_UPLOAD_BYTES, MAX_SOCIAL_VIDEO_UPLOAD_BYTES, limitMb } from '@/utils/upload-limits';
import { SOCIAL_MEDIA_MIME_TYPES } from '@/lib/social/media-rules';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';
import { requireSocialAccess } from '@/lib/social/access';
import { SOCIAL_SAMPLE_SCOPE } from '@/lib/social/mode';

export const dynamic = 'force-dynamic';

// Hard caps on uploaded size. Cloudinary's unsigned preset silently enforced one
// for images before; with the R2 flow this route is the only thing keeping it
// real, so validate here. Social uploads bind the declared size and type to
// the signature; the PDF path re-checks the true size in /api/rag/extract.

export async function POST(request: NextRequest) {
  let body: { fileName?: string; contentType?: string; fileSize?: number; purpose?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { fileName, contentType, fileSize, purpose } = body;
  const social = purpose === 'social';
  let resolvedTenantId: string;
  if (social) {
    const access = await requireSocialAccess(request);
    if (access instanceof NextResponse) return access;
    if (!access.tenantId || access.tenantId === SOCIAL_SAMPLE_SCOPE) {
      return NextResponse.json({ error: 'A tenant is required for uploads' }, { status: 403 });
    }
    resolvedTenantId = access.tenantId;
  } else {
    const authResult = await requireAdmin(request);
    if (authResult instanceof NextResponse) return authResult;
    resolvedTenantId = authResult.tenantId || PLATFORM_TENANT_ID;
  }

  if (!contentType || typeof contentType !== 'string') {
    return NextResponse.json({ error: 'Missing content type' }, { status: 400 });
  }

  // Images (cover art, logos) and PDFs (AI Knowledge sources) are the only two
  // things the app uploads. PDFs go direct-to-R2 because a 15MB file cannot fit
  // through a Vercel Function's 4.5MB request body.
  const isImage = contentType.startsWith('image/');
  const isPdf = contentType === 'application/pdf';
  const socialImage = (SOCIAL_MEDIA_MIME_TYPES.image as readonly string[]).includes(contentType);
  const socialVideo = (SOCIAL_MEDIA_MIME_TYPES.video as readonly string[]).includes(contentType);
  if (social && !socialImage && !socialVideo) {
    return NextResponse.json({ error: 'Unsupported social media type' }, { status: 400 });
  }
  if (!social && !isImage && !isPdf) {
    return NextResponse.json({ error: 'Only image and PDF uploads are allowed' }, { status: 400 });
  }

  const maxBytes = social ? (socialVideo ? MAX_SOCIAL_VIDEO_UPLOAD_BYTES : MAX_SOCIAL_IMAGE_UPLOAD_BYTES) : (isPdf ? MAX_PDF_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES);

  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ error: 'Invalid file size' }, { status: 400 });
  }
  if (fileSize > maxBytes) {
    return NextResponse.json(
      { error: `${socialVideo && social ? 'Video' : isPdf ? 'PDF' : 'Image'} exceeds the ${limitMb(maxBytes)}MB limit` },
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
        ...(social ? { ContentLength: fileSize } : {}),
      }),
      social
        ? { expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length']) }
        : { expiresIn: 300 },
    );

    return NextResponse.json({
      uploadUrl,
      // The image flow saves `publicUrl` into Firestore. The PDF flow hands
      // `key` straight back to /api/rag/extract, which re-derives ownership
      // from the caller's own token rather than trusting this value.
      key,
      publicUrl: `${process.env.R2_PUBLIC_URL?.replace(/\/+$/, '')}/${key}`,
    });
  } catch (e: any) {
    console.error('presign error:', e?.message || e);
    return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 });
  }
}
