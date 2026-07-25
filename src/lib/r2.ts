import { S3Client } from '@aws-sdk/client-s3';

/**
 * The Cloudflare R2 client, configured once.
 *
 * Both /api/storage/presign (signs browser PUTs) and /api/rag/extract (reads
 * and deletes the uploaded object server-side) talk to the same bucket, and a
 * mismatch in endpoint/addressing style between them would show up as an opaque
 * signature error — so the configuration lives here, not in each route.
 */
export function createR2Client(): S3Client {
  return new S3Client({
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
}

export function r2Bucket(): string | undefined {
  return process.env.R2_BUCKET_NAME;
}
