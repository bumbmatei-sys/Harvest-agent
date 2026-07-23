import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
// Node runtime: unpdf's serverless pdf.js build needs Node APIs.
export const runtime = 'nodejs';

// Reject oversized uploads before we buffer them. A sermon PDF is comfortably
// under this; the cap only stops abuse / accidental huge files from pinning the
// function. The 50KB-per-embed cap lives downstream in /api/gemini — chunking
// (client) keeps each embed call within it, so this ceiling is about the file.
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

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
 * POST /api/rag/extract  (multipart/form-data, field `file`)
 *
 * Server-side PDF text extraction for AI Knowledge uploads. Chosen over
 * client-side parsing so pdf.js stays out of the app bundle and large sermon
 * PDFs are parsed off the phone's main thread. Admin-only; the tenant is never
 * read from the client — extraction writes nothing, and the embed that follows
 * (client → /api/gemini) resolves the tenant server-side from the caller's token.
 *
 * Returns { text } on success. On a bad file returns 422 with a clear message so
 * the caller can mark the source failed and embed NOTHING (embedding an error
 * string is the exact bug this route exists to kill).
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get('file');
    if (f && typeof f !== 'string') file = f as File;
  } catch {
    return NextResponse.json({ error: 'Invalid form data — expected a file upload.' }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File is too large (max ${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB).` },
      { status: 413 },
    );
  }

  const name = (file.name || '').toLowerCase();
  const ext = name.split('.').pop() || '';

  if (ext !== 'pdf') {
    return NextResponse.json(
      { error: `Unsupported file type ".${ext}". This route extracts text from PDF files.` },
      { status: 400 },
    );
  }

  try {
    const buf = await file.arrayBuffer();
    const text = await extractPdf(new Uint8Array(buf));
    return NextResponse.json({ text });
  } catch (e) {
    if (e instanceof ExtractError) {
      // The file itself is unusable — 422 so the caller marks the source failed
      // and embeds nothing.
      return NextResponse.json({ error: e.userMessage, code: e.code }, { status: 422 });
    }
    console.error('RAG extract error:', e);
    return NextResponse.json({ error: 'Failed to extract text from this file.' }, { status: 500 });
  }
}
