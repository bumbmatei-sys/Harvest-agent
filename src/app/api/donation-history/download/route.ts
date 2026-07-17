import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb, getReceiptsBucket } from '@/lib/firebase-admin';
import { normalizeEmail } from '@/lib/donation-history';

export const dynamic = 'force-dynamic';

/** Signed-URL lifetime: short-lived so a leaked link expires quickly. */
export const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

/**
 * POST /api/donation-history/download — authenticated, member-scoped.
 *
 * Body: { tenantId: string, invoiceId: string }
 * Returns: { url } — a short-lived (15 min) v4 signed READ url for ONE receipt PDF.
 *
 * The receipts bucket is private and MUST stay private: we never make an object
 * public and never return a permanent url. The caller only receives a link after
 * we confirm they own that specific invoice.
 *
 * SECURITY:
 *   • Ownership is proven by the invoice's own `recipientEmail` matching the
 *     caller's VERIFIED token email (case-insensitive). Knowing/guessing another
 *     member's invoice id yields 403, not their receipt.
 *   • The storage path signed is the invoice doc's own `pdfUrl` — never a path
 *     from the request — so the request can't point the signer at an arbitrary
 *     object. A defensive guard additionally rejects traversal / off-prefix paths.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId : '';
  const invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId : '';
  if (!tenantId || !invoiceId) {
    return NextResponse.json({ error: 'tenantId and invoiceId are required' }, { status: 400 });
  }

  const normalizedCaller = normalizeEmail(auth.email);
  if (!normalizedCaller) {
    // No email on the token → cannot own an emailed receipt.
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const snap = await adminDb
      .collection('tenants').doc(tenantId)
      .collection('invoices').doc(invoiceId)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    }
    const inv = snap.data() || {};

    // Ownership: must be a donation receipt addressed to the caller's own email.
    // Same 403 for "not a donation receipt" and "not yours" — don't leak which.
    if (inv.type !== 'donation_receipt' || normalizeEmail(inv.recipientEmail) !== normalizedCaller) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const pdfPath = typeof inv.pdfUrl === 'string' ? inv.pdfUrl : '';
    // TRANSIENT case: the PDF may not exist yet (receipt generation is best-effort on
    // the webhook, and pdfUrl is null for the brief 'pending' window before it lands).
    if (!pdfPath) {
      return NextResponse.json({ error: 'Receipt PDF is not available yet' }, { status: 404 });
    }
    // Defense-in-depth: the stored path is server-derived (receipts/{tenant}/...), so
    // never sign something outside that prefix or containing traversal. This ALSO
    // catches legacy rows created before the private-file hardening, which stored a
    // full public URL (https://storage.googleapis.com/...) instead of a bare path.
    // Those fail the prefix check correctly. We fix forward — no migration, no legacy
    // format support — but the copy is distinct and HONEST: a member who was emailed
    // their receipt is told it's an older format to seek from the church, NOT the
    // transient "not available yet" above (which would read as "never existed").
    if (pdfPath.includes('..') || !pdfPath.startsWith('receipts/')) {
      console.error('donation-history download: unexpected pdf path', pdfPath);
      return NextResponse.json(
        { error: "This receipt was issued in an older format and can't be downloaded here. Please contact the church for a copy." },
        { status: 404 },
      );
    }

    const [url] = await getReceiptsBucket().file(pdfPath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return NextResponse.json({ url });
  } catch (e) {
    console.error('donation-history download error:', e);
    return NextResponse.json({ error: 'Failed to generate download link' }, { status: 500 });
  }
}
