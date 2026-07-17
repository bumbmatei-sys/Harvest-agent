import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import {
  computeTotals,
  invoiceToRow,
  normalizeEmail,
  type DonationReceiptRow,
} from '@/lib/donation-history';

export const dynamic = 'force-dynamic';

/**
 * Upper bound on invoices scanned per request. Mirrors the admin giving-statements
 * generator, which reads this same collection the same way. Generous for any single
 * tenant's donation volume; the newest are kept if a tenant ever exceeds it.
 */
const SCAN_LIMIT = 5000;

/**
 * GET /api/donation-history?tenantId={id} — authenticated, member-scoped.
 *
 * Returns the CALLER'S OWN donation receipts for a tenant, plus lifetime and
 * per-year giving totals, so a member can retrieve receipts they may have
 * deleted from email. Donation invoices live at tenants/{tenantId}/invoices and
 * are admin-read-only in firestore.rules — a member cannot query them from the
 * client — so this route reads them with the Admin SDK behind requireAuth.
 *
 * SECURITY — the match is the crux:
 *   • Identity is the caller's email from their VERIFIED auth token. No email
 *     (or userId) from the request body/query is ever trusted.
 *   • Invoices are keyed by `recipientEmail`, stored only trimmed (NOT lowercased)
 *     by the webhook — its casing is whatever the donor typed at Stripe checkout,
 *     independent of the Firebase token casing (e.g. Firebase lowercases Google
 *     emails). A case-sensitive equality query would therefore miss a member's own
 *     receipts. So we SCAN the tenant's donation invoices and match the caller by
 *     NORMALIZED email in memory — case-insensitive on BOTH sides. This mirrors
 *     the admin giving-statements generator's read of the same collection, and
 *     uses a single-field orderBy (auto-indexed) — firestore.indexes.json untouched.
 *   • The in-memory `normalizeEmail(recipientEmail) === callerEmail` check is the
 *     authoritative ownership gate: a member only ever sees a row matching their
 *     own verified email, so it can never over-match into another user's receipts.
 *   • The `tenantId` query param only selects WHICH tenant's invoices to search;
 *     it is not a trust boundary. Because every returned row must match the
 *     caller's own verified email, passing another tenant's id can only ever
 *     surface the caller's own receipts in that tenant — never anyone else's.
 *
 * Failure modes (documented in the PR):
 *   • A donor whose account email changed after giving won't match older
 *     receipts recorded under the previous address (we match the current token).
 *   • A donor who gave to a different tenant than the one queried won't see those
 *     receipts here (single-tenant scope, mirroring the app's tenant boundary).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const normalizedCaller = normalizeEmail(auth.email);
  // A verified token with no email can never own an emailed receipt — return an
  // empty history rather than querying with an empty string (which could match a
  // stored empty recipientEmail).
  if (!normalizedCaller) {
    return NextResponse.json({
      receipts: [],
      totals: computeTotals([]),
    });
  }

  try {
    // Scan the tenant's donation invoices (newest first, single-field orderBy —
    // auto-indexed) and match the caller by normalized email in memory. A
    // case-sensitive equality query can't be used because the stored casing is
    // arbitrary (see header). Same read shape as the admin giving-statements route.
    const snap = await adminDb
      .collection('tenants').doc(tenantId)
      .collection('invoices')
      .orderBy('issuedAt', 'desc')
      .limit(SCAN_LIMIT)
      .get();

    const rows: DonationReceiptRow[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      if (data.type !== 'donation_receipt') continue;
      // Authoritative ownership gate — case-insensitive on BOTH sides. Only a
      // receipt whose recipientEmail normalizes to the caller's own is returned.
      if (normalizeEmail(data.recipientEmail) !== normalizedCaller) continue;
      rows.push(invoiceToRow(d.id, data));
    }

    // Newest first; undated rows sink to the bottom.
    rows.sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : -Infinity;
      const tb = b.date ? new Date(b.date).getTime() : -Infinity;
      return tb - ta;
    });

    return NextResponse.json({ receipts: rows, totals: computeTotals(rows) });
  } catch (e) {
    console.error('donation-history error:', e);
    return NextResponse.json({ error: 'Failed to load donation history' }, { status: 500 });
  }
}
