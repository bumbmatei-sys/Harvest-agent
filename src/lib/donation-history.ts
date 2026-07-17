import { toSafeDate, type DateLike } from '@/utils/format-date';

/**
 * Shared helpers for the member-facing donation-history surface (list route,
 * download route, and the DonationHistory view).
 *
 * The two things that MUST be consistent everywhere live here:
 *
 *  1. Email normalization — the identity match is the security crux. Donation
 *     invoices are keyed by `recipientEmail`, which the Stripe webhook stores
 *     only `.trim()`ed (NOT lowercased — see webhook ~line 625/1474). A member's
 *     own receipts are matched by comparing the *normalized* stored email to the
 *     *normalized* email on their verified auth token. Normalizing on both sides
 *     is what makes "User A cannot see User B's receipts" hold regardless of the
 *     casing either was recorded in.
 *
 *  2. Cents → dollars — invoices store `amount` in CENTS (the accounting /
 *     giving-statements / QuickBooks subsystem is cents throughout). Every dollar
 *     value shown to a member must go through {@link formatCents}. AdminAccounting
 *     shipped the inverse bug (summed cents, formatted as dollars → $10,550,000
 *     for $105,500); routing all formatting through one tested helper prevents it.
 */

/** A donation receipt row as returned to the member's own client. */
export interface DonationReceiptRow {
  /** Firestore invoice doc id — the handle the download route re-resolves. */
  id: string;
  /** Human receipt number, e.g. R-1700000000000-AB12CD. */
  receiptNumber: string | null;
  /** ISO date the gift was issued, or null if unparseable. */
  date: string | null;
  /** Gift amount in CENTS. The client divides by 100 for display. */
  amountCents: number;
  /** ISO currency code, e.g. 'usd'. */
  currency: string;
  /** Short description of the gift. */
  description: string;
  /** Church/tenant name shown on the receipt. */
  tenantName: string;
  /** Whether a stored PDF exists to download (path itself is never exposed). */
  hasPdf: boolean;
}

/** Lifetime + per-calendar-year giving totals, all in CENTS. */
export interface DonationTotals {
  /** Sum of every matched receipt, in cents. */
  lifetimeCents: number;
  /** Map of calendar year → cents given that year, newest years first when listed. */
  byYear: Record<string, number>;
  /** Count of receipts. */
  count: number;
}

/**
 * Normalize an email for identity matching: trim + lowercase. Returns '' for
 * null/undefined so a token with no email can never accidentally equal a stored
 * empty `recipientEmail` in a way that leaks (both sides normalize the same way,
 * and callers must reject the empty case explicitly before trusting a match).
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

/**
 * Format an integer number of CENTS as a US-dollar string, e.g. 105500 → "$1,055.00".
 * The one place cents become dollars for display — never multiply/format cents
 * as dollars anywhere else. Non-finite input renders as $0.00.
 */
export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  return `$${(safe / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Aggregate lifetime + per-year totals from a set of receipt rows. Pure — the
 * same numbers can be computed server-side (for the API response) or re-derived
 * client-side. Years come from each row's issued date; undated rows still count
 * toward the lifetime total but not toward any year bucket.
 */
export function computeTotals(rows: DonationReceiptRow[]): DonationTotals {
  const totals: DonationTotals = { lifetimeCents: 0, byYear: {}, count: rows.length };
  for (const r of rows) {
    const cents = Number.isFinite(r.amountCents) ? r.amountCents : 0;
    totals.lifetimeCents += cents;
    if (r.date) {
      const d = new Date(r.date);
      if (!Number.isNaN(d.getTime())) {
        const year = String(d.getFullYear());
        totals.byYear[year] = (totals.byYear[year] || 0) + cents;
      }
    }
  }
  return totals;
}

/**
 * Map a raw Firestore invoice doc into a client-safe {@link DonationReceiptRow}.
 * Deliberately omits `recipientEmail` and the storage `pdfUrl` path — the client
 * only needs to know a PDF exists (`hasPdf`); it fetches a short-lived signed URL
 * by invoice id through the download route, which re-checks ownership.
 */
export function invoiceToRow(id: string, inv: Record<string, unknown>): DonationReceiptRow {
  const issued = toSafeDate(inv.issuedAt as DateLike);
  const amount = inv.amount;
  return {
    id,
    receiptNumber: typeof inv.receiptNumber === 'string' ? inv.receiptNumber : null,
    date: issued ? issued.toISOString() : null,
    amountCents: typeof amount === 'number' && Number.isFinite(amount) ? amount : 0,
    currency: typeof inv.currency === 'string' && inv.currency ? inv.currency : 'usd',
    description: typeof inv.description === 'string' && inv.description ? inv.description : 'Donation',
    tenantName: typeof inv.tenantName === 'string' && inv.tenantName ? inv.tenantName : 'Harvest',
    hasPdf: typeof inv.pdfUrl === 'string' && inv.pdfUrl.length > 0,
  };
}
