import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { requireAdmin } from '@/lib/api-auth';
import { createR2Client, r2Bucket } from '@/lib/r2';
import { isTenantUploadKey } from '@/utils/r2-keys';
import { MAX_PDF_UPLOAD_BYTES, limitMb } from '@/utils/upload-limits';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';
// Node runtime: unpdf's serverless pdf.js build needs Node APIs.
export const runtime = 'nodejs';

// Reject oversized uploads before we buffer them. A sermon PDF is comfortably
// under this; the cap only stops abuse / accidental huge files from pinning the
// function. The 50KB-per-embed cap lives downstream in /api/gemini — chunking
// (client) keeps each embed call within it, so this ceiling is about the file.
//
// This is now genuinely enforceable: the bytes never travel through this
// function's request body (Vercel caps that at 4.5MB), so the size we check is
// the one R2 reports for the stored object.
const MAX_FILE_BYTES = MAX_PDF_UPLOAD_BYTES; // 15MB

/** A caller-facing extraction failure. `status` 422 = the file itself is the
 *  problem (encrypted / scanned / corrupt); the admin should see `message`. */
class ExtractError extends Error {
  constructor(public readonly userMessage: string, public readonly code: string) {
    super(userMessage);
  }
}

/**
 * Extract readable text from a PDF using unpdf's serverless pdf.js build.
 * The three real failure modes are surfaced as ExtractError so the route can
 * tell the admin exactly what went wrong — and, crucially, so nothing is
 * embedded when there is no genuine text to embed.
 */
async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');

  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (e: any) {
    // pdf.js throws PasswordException for encrypted / password-protected files.
    if (e?.name === 'PasswordException') {
      throw new ExtractError(
        'This PDF is password-protected. Remove the password and upload it again.',
        'encrypted',
      );
    }
    // Anything else at parse time means the bytes aren't a readable PDF.
    throw new ExtractError(
      'This PDF could not be read — the file looks corrupt or is not a valid PDF.',
      'corrupt',
    );
  }

  let text = '';
  try {
    const res = await extractText(pdf, { mergePages: true });
    text = (Array.isArray(res.text) ? res.text.join('\n') : res.text) || '';
  } catch {
    throw new ExtractError(
      'This PDF could not be read — the file looks corrupt or is not a valid PDF.',
      'corrupt',
    );
  }

  if (!text.trim()) {
    // Parsed fine but carries no text layer → scanned / image-only PDF.
    throw new ExtractError(
      'No readable text found — this looks like a scanned or image-only PDF. Upload a text-based PDF, or paste the text directly.',
      'no_text',
    );
  }
  return text.trim();
}

/**
 * POST /api/rag/extract   body: { r2Key: string }
 *
 * Server-side PDF text extraction for AI Knowledge uploads. The file itself does
 * NOT come through this request: the browser first PUTs it straight to R2 with a
 * short-lived presigned URL from /api/storage/presign, then posts only the
 * object key here. That is not an optimisation — Vercel caps a function's
 * request body at 4.5MB and rejects anything larger with a 413 raised before the
 * handler runs, so the previous multipart upload could never honour the 15MB cap
 * this route advertises.
 *
 * Extraction is still server-side (pdf.js stays out of the app bundle, and large
 * sermon PDFs are parsed off the phone's main thread). Admin-only; the tenant is
 * never read from the client — extraction writes nothing, and the embed that
 * follows (client → /api/gemini) resolves the tenant server-side from the
 * caller's token.
 *
 * Returns { text } on success. On a bad file returns 422 with a clear message so
 * the caller can mark the source failed and embed NOTHING (embedding an error
 * string is the exact bug this route exists to kill). The uploaded object is a
 * temp file and is deleted either way.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  // Super admin has tenantId: null — fall back to the platform tenant, exactly
  // as /api/storage/presign does when it mints the key. Never trust a
  // client-supplied tenant id.
  const resolvedTenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  let body: { r2Key?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body — expected JSON { r2Key }.' },
      { status: 400 },
    );
  }

  const r2Key = body?.r2Key;
  if (typeof r2Key !== 'string' || !r2Key) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }

  // ─── TENANT BOUNDARY ──────────────────────────────────────────────────────
  // `r2Key` is client-supplied and therefore hostile until proven otherwise.
  // Ownership is decided HERE, from the tenant resolved out of the caller's own
  // verified token — a key naming another tenant's prefix, a key outside
  // uploads/, or a traversal-shaped forgery is refused before a single byte is
  // read from storage. Nothing downstream re-checks this, so it cannot move.
  if (!isTenantUploadKey(r2Key, resolvedTenantId)) {
    return NextResponse.json(
      { error: 'This file does not belong to your organisation.' },
      { status: 403 },
    );
  }

  const ext = r2Key.toLowerCase().split('.').pop() || '';
  if (ext !== 'pdf') {
    return NextResponse.json(
      { error: `Unsupported file type ".${ext}". This route extracts text from PDF files.` },
      { status: 400 },
    );
  }

  const s3 = createR2Client();
  const Bucket = r2Bucket();

  try {
    // Size comes from R2's own metadata, never from anything the client said.
    let head;
    try {
      head = await s3.send(new HeadObjectCommand({ Bucket, Key: r2Key }));
    } catch (e: any) {
      if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) {
        return NextResponse.json(
          { error: 'The uploaded file could not be found. Please try uploading it again.' },
          { status: 404 },
        );
      }
      throw e;
    }

    if (typeof head?.ContentLength === 'number' && head.ContentLength > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File is too large (max ${limitMb(MAX_FILE_BYTES)}MB).` },
        { status: 413 },
      );
    }

    const obj = await s3.send(new GetObjectCommand({ Bucket, Key: r2Key }));
    const bytes = await (obj.Body as any).transformToByteArray();

    const text = await extractPdf(bytes as Uint8Array);
    return NextResponse.json({ text });
  } catch (e) {
    if (e instanceof ExtractError) {
      // The file itself is unusable — 422 so the caller marks the source failed
      // and embeds nothing.
      return NextResponse.json({ error: e.userMessage, code: e.code }, { status: 422 });
    }
    console.error('RAG extract error:', e);
    return NextResponse.json({ error: 'Failed to extract text from this file.' }, { status: 500 });
  } finally {
    // The object is a temp file that exists only to get the bytes past Vercel's
    // request-body cap. `finally` — not the success path — so a 413, a 422
    // (encrypted / no_text / corrupt), or an unexpected 500 leaves nothing
    // behind either. Best-effort: a failed delete is logged, never surfaced,
    // and never changes the response the admin sees.
    try {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: r2Key }));
    } catch (delErr: any) {
      console.error('RAG extract: failed to delete temp object', r2Key, delErr?.message || delErr);
    }
  }
}
