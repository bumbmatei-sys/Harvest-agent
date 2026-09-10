import { adminDb } from '@/lib/firebase-admin';
import { normalizeEmail } from '@/lib/donation-history';

/**
 * THE-350 — 🔴 THE ONE FUNCTION THAT WRITES A GIFT NOBODY'S CARD PAID FOR.
 *
 * ─── The defect this exists to close ────────────────────────────────────────
 *
 * The founder: "If I add a donation from a user in CRM it updates the CRM but
 * not the dashboard."
 *
 * There were TWO records of a gift and only ONE of them counted:
 *
 *   • `tenants/{t}/invoices` — THE money ledger. Keyed by `recipientEmail`,
 *     `amount` in CENTS. The Overview tab sums it (`dashboard-data.ts`
 *     `toInvoiceRow` / `readableReceipts`), `AdminAccounting` reads it,
 *     `/api/giving-statements/generate` aggregates it per donor per year, and
 *     `/api/donation-history` is how a MEMBER sees their own giving. Until this
 *     module the ONLY writer was `lib/donation-webhook.ts`.
 *   • `contactActivities` — what a manual CRM donation wrote. Nothing
 *     downstream reads it as money, so the gift existed on one contact's
 *     timeline and nowhere else.
 *
 * `AdminDonations`' own disclaimer (THE-249) tells churches to record gifts as
 * an Activity. That instruction was true about the CRM and false about
 * everything else, and this module is what makes it true about both.
 *
 * ─── 🔴 ONE WRITE, FIVE SURFACES — and not one of them is new code ──────────
 *
 * A manual donation writes an INVOICE. The church becomes the author the
 * webhook used to be, so every reader ALREADY BUILT starts working with no new
 * reading, no new display and no new reporting: the dashboard giving figure,
 * accounting, the member's own donation history, their per-year totals, their
 * downloadable receipt, and the year-end giving statement.
 *
 * That is only true because the document is shaped EXACTLY like a webhook
 * receipt — `type: 'donation_receipt'`, `amount` in cents, `issuedAt` an ISO
 * string, `recipientEmail` the identity key. A different `type` or a different
 * unit would have needed six readers changed, and a reader that was missed is
 * the same silent hole one layer down.
 *
 * ─── 🔴 WHY THIS IS SERVER-SIDE, AND WHY firestore.rules IS UNTOUCHED ───────
 *
 * `firestore.rules` gates `tenants/{t}/invoices` on
 * `hasPermission('manageAccounting', tenantId)`. A CRM admin holds `manageCRM`,
 * so a CLIENT write from the CRM screen would be REFUSED for exactly the admins
 * who do the recording — the founder's bug back again, wearing a permission
 * error. The alternative was to loosen the rule, and `firestore.rules`
 * AUTO-DEPLOYS on merge with no emulator tests in CI (THE-313's one-line change
 * turned 46 files red), for a file that guards the money ledger.
 *
 * So this runs on the Admin SDK behind `/api/donations/manual`, which gates on
 * `requireTenantPermission(request, tenantId, 'manageCRM')` — the documented use
 * for that helper: "admin-moderation API routes that stand in for a client write
 * the rules can't express". The rule stays exactly as strict as it is; no client
 * gains write access to the ledger; and the permission check moves to the one
 * place that can also validate the amount.
 *
 * ─── 🔴 THE ONLY INTERFACE — `sendTenantSms` is the shape ───────────────────
 *
 * ⚠️ THE-351 (the paid-event confirmation flow and the tenant inbox) is the
 * second caller this exists for, and it calls THIS FUNCTION. THE EVENT FLOW IS
 * NOT BUILT HERE and must not be.
 *
 * That is why the input is an AMOUNT, an EMAIL, a DESCRIPTION and a SOURCE —
 * never a contact. A CRM contact and an event registration have nothing in
 * common except those four facts, and a signature that took a contact would
 * force THE-351 to fake one or to inline a twelfth copy of an invoice write.
 * THE-340 built `lib/transactional-email.ts` after finding ELEVEN inlined copies
 * of a Resend send, none of them a function. Do not create the twelfth.
 *
 * 🔴 IT NEVER THROWS FOR A REFUSAL, exactly like `sendTenantSms`: every
 * rejection comes back as `{ ok: false, code, error }` so a caller renders it
 * rather than 500ing, and a genuine Firestore failure comes back as
 * `write_failed` rather than a swallowed success. There is no path that returns
 * `ok: true` without a document id.
 */

/** Where a manually recorded gift came from. */
export type ManualDonationSource =
  /** An admin typed it into the CRM's Add Activity → Donation dialog (THE-350). */
  | 'crm_manual'
  /** An admin confirmed a paid event registration by hand (THE-351's caller). */
  | 'event_manual';

/**
 * 🔴 THE VALUES `source` MAY HOLD, and the reason the field exists.
 *
 * A manual entry must be distinguishable from a processed one — for
 * reconciliation now, and for the day a real payment rail exists. An invoice
 * this module writes always carries one of these. An invoice the Stripe webhook
 * wrote carries NO `source` at all, and `lib/donation-webhook.ts` is byte-pinned
 * by `AdminDonations.section.test.tsx` as a money path this ticket must not
 * touch — so the reading is one-way and stated once, in
 * {@link isManuallyRecordedDonation}: a document is manual when it carries one
 * of these values, and processed otherwise. An ABSENT `source` therefore means
 * "processed", which is exactly what every historical receipt is.
 */
export const MANUAL_DONATION_SOURCES: readonly ManualDonationSource[] = [
  'crm_manual',
  'event_manual',
];

/**
 * Is this invoice document one a person recorded by hand?
 *
 * 🔴 THE ONE PLACE THAT ANSWERS IT. A caller comparing `inv.source === 'manual'`
 * against a value this module does not emit would silently file every manual
 * gift as processed, and a reconciliation built on it would be wrong in the
 * direction nobody checks.
 */
export function isManuallyRecordedDonation(inv: { source?: unknown }): boolean {
  return MANUAL_DONATION_SOURCES.includes(inv.source as ManualDonationSource);
}

/** Why a manual donation was refused. Never `ok: true` alongside one of these. */
export type ManualDonationCode =
  | 'invalid_tenant'
  | 'invalid_amount'
  | 'invalid_description'
  | 'invalid_source'
  | 'write_failed';

export interface ManualDonationInput {
  /** The church receiving the gift. Concrete — never null, never a guess. */
  tenantId: string;
  /**
   * 🔴 INTEGER CENTS. `AdminAccounting` shipped the inverse bug — summed cents,
   * formatted as dollars, showed `$10,550,000` for `$105,500` — so this is
   * refused unless it is a positive safe integer. A caller holding dollars
   * converts BEFORE calling; there is deliberately no `amountDollars` overload,
   * because two units in one signature is how the inversion happens.
   */
  amountCents: number;
  /**
   * The giver's email — THE IDENTITY KEY, normalised here (see the header of
   * `lib/donation-history.ts`). Null/empty is ACCEPTED and recorded, and the
   * result says the member will never see the gift; see {@link ManualDonationResult}.
   */
  email: string | null | undefined;
  /** What the gift was. Shown on the receipt and the giving statement. */
  description: string;
  /** 🔴 Required. See {@link MANUAL_DONATION_SOURCES}. */
  source: ManualDonationSource;
  /** Name for the receipt. Falls back to the normalised email, then to 'Anonymous'. */
  recipientName?: string | null;
  /** ISO currency code. Defaults to 'usd', matching every webhook receipt. */
  currency?: string | null;
  /** The admin's uid, for the audit trail. Never a display value. */
  recordedBy?: string | null;
}

export interface ManualDonationResult {
  ok: boolean;
  /** The `tenants/{t}/invoices` document id. Present on every success. */
  invoiceId?: string;
  /** `R-1700000000000-AB12CD` — the format every receipt in this product uses. */
  receiptNumber?: string;
  /** The normalised email actually stored. `''` when none was supplied. */
  recipientEmail?: string;
  /**
   * 🔴 WILL THE GIVER EVER SEE THIS GIFT? False when no email was supplied.
   *
   * Returned rather than inferred, because the consequence has to reach a
   * SCREEN: `/api/donation-history` refuses an empty caller email outright and
   * the giving-statement generator skips an empty `recipientEmail`, so a gift
   * recorded without one is real money the church received that its giver can
   * never retrieve a receipt for. A caller that ignores this field is telling
   * the quiet lie this ticket exists to remove.
   */
  visibleToMember?: boolean;
  /** ISO string written to `issuedAt`. Returned so a caller can echo the date. */
  issuedAt?: string;
  error?: string;
  code?: ManualDonationCode;
}

/**
 * `R-<epoch millis>-<6 upper-case base36>` — byte-for-byte the format
 * `donation-webhook.ts` writes at all three of its receipt sites. Kept identical
 * so a church reading its books cannot tell a manual receipt from a processed
 * one by its NUMBER; `source` is what tells them, and it says so in a field
 * rather than in a naming convention nobody documented.
 */
function newReceiptNumber(): string {
  return `R-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/**
 * 🔴 RECORD A GIFT NO PAYMENT RAIL PROCESSED. The only interface — see header.
 *
 * ⚠️ `issuedAt` IS AN ISO STRING, and the choice is not free. Firestore orders
 * ACROSS TYPES BY TYPE FIRST, and `/api/donation-history`,
 * `/api/giving-statements/generate` and `/api/quickbooks/sync` all read this
 * collection with `orderBy('issuedAt','desc').limit(N)`. Every one of the three
 * webhook receipt writes stores `issuedAt: nowIso`, so a Timestamp written here
 * would sort into a different type band from every receipt already on disk —
 * and under a `limit()` a manual gift could be truncated out of a giving
 * statement entirely while every test stayed green. One representation, and it
 * is the one the ledger already holds.
 */
export async function recordManualDonation(
  input: ManualDonationInput,
): Promise<ManualDonationResult> {
  const tenantId = (input.tenantId || '').trim();
  if (!tenantId) {
    return { ok: false, error: 'A church is required to record a gift.', code: 'invalid_tenant' };
  }

  // 🔴 CENTS, and refused rather than coerced. `Math.round`ing a stray float
  // here would silently accept dollars from a caller that forgot to convert,
  // and 105500 dollars would land in the ledger as 105500 cents' worth of
  // document carrying a hundred times the money. A refusal a caller has to see
  // is the only reading that cannot be wrong quietly.
  const amountCents = input.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return {
      ok: false,
      error: 'Enter an amount greater than zero.',
      code: 'invalid_amount',
    };
  }

  const description = (input.description || '').trim();
  if (!description) {
    return { ok: false, error: 'Describe what the gift was for.', code: 'invalid_description' };
  }

  if (!MANUAL_DONATION_SOURCES.includes(input.source)) {
    return { ok: false, error: 'Unknown donation source.', code: 'invalid_source' };
  }

  // 🔴 THE SECURITY CRUX, and it is one line. `normalizeEmail` trims AND
  // lowercases — the same function `/api/donation-history` runs over the
  // CALLER's verified token before comparing. Normalising on both sides is what
  // makes "User A cannot see User B's receipts" hold regardless of the casing
  // either was recorded in, and writing the already-normalised form means this
  // path cannot drift from the readers even if a reader is added tomorrow.
  //
  // ⚠️ `normalizeEmail` returns '' for null. That empty string is STORED as-is
  // and never treated as a match: the history route refuses an empty caller
  // email before it queries, the statement generator skips an empty
  // `recipientEmail`, and both GDPR paths guard on a non-empty `ctx.email`. So
  // an emailless gift counts for the church and is invisible to any member —
  // which is true, and which `visibleToMember` forces the caller to say on screen.
  const recipientEmail = normalizeEmail(input.email);
  const recipientName = (input.recipientName || '').trim() || recipientEmail || 'Anonymous';

  const issuedAt = new Date().toISOString();
  const receiptNumber = newReceiptNumber();
  const currency = (input.currency || '').trim().toLowerCase() || 'usd';

  try {
    const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) {
      return { ok: false, error: 'That church was not found.', code: 'invalid_tenant' };
    }
    const tData = tenantSnap.data() || {};
    const tenantName = tData.name || tData.displayName || 'Harvest';

    const ref = await adminDb
      .collection('tenants').doc(tenantId)
      .collection('invoices')
      .add({
        // ── The shape every existing reader already understands ──────────────
        type: 'donation_receipt',
        recipientName,
        recipientEmail,
        amount: amountCents,
        currency,
        description,
        receiptNumber,
        issuedAt,
        tenantName,
        // Derived, never stored twice: `donation-history.ts`'s `invoiceToRow`
        // computes `hasPdf` from this field, and no manual gift has a PDF —
        // nothing generated one, and claiming otherwise would put a download
        // button on a file that does not exist.
        pdfUrl: null,

        // ── 🔴 What makes it distinguishable ─────────────────────────────────
        source: input.source,
        /**
         * `recorded` rather than the webhook's `pending`: `pending` means "a
         * receipt email is on its way", which `issueDonationReceipt` sends and
         * this path does not. Saying `pending` would promise the giver an email
         * nothing will send.
         */
        status: 'recorded',
        /**
         * The ADMIN's uid, from their verified token — an audit trail of who
         * recorded the gift, never a display value and never the giver's.
         *
         * ⚠️ IT IS NOT SWEPT BY THE ERASURE, AND THAT IS THE ESTABLISHED
         * POLICY rather than a gap: `member-erasure.ts` already declares NINE
         * collections that "hold only an admin's `createdBy`/`authorId` uid on
         * church-owned content — an unresolvable reference once the profile is
         * gone, not member data". An invoice is church-owned (a tax record,
         * kept and anonymised rather than deleted), so this field is that same
         * class. What the erasure DOES rewrite on this document — the giver's
         * `recipientName` and `recipientEmail` — is untouched by it.
         */
        recordedBy: (input.recordedBy || '').trim() || null,
        /**
         * ⚠️ NAMESPACED so it can never collide with a Stripe id.
         * `donationReceiptAlreadyRecorded` gates redeliveries on
         * `relatedId == <PaymentIntent|subscription|invoice id>`; a manual gift
         * has no payment to dedup against — two gifts of the same amount on the
         * same day are two gifts — so this identifies THIS RECORD and nothing
         * else, and cannot be mistaken for a payment that was processed.
         */
        relatedId: `manual:${receiptNumber}`,
      });

    return {
      ok: true,
      invoiceId: ref.id,
      receiptNumber,
      recipientEmail,
      visibleToMember: recipientEmail.length > 0,
      issuedAt,
    };
  } catch (e) {
    // 🔴 A FAILED WRITE IS A FAILURE, never an empty success (THE-342). The
    // caller keeps the admin's typed value and shows a banner; returning
    // `ok: true` with no id would lose a real gift silently.
    console.error('recordManualDonation failed:', e);
    return {
      ok: false,
      error: 'The gift could not be recorded. Nothing was saved — try again.',
      code: 'write_failed',
    };
  }
}
