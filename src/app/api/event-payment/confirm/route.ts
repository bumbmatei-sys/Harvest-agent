import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { requireTenantPermission } from '@/lib/api-auth';
import { recordManualDonation } from '@/lib/manual-donation';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import {
  CLAIM_QUEUE_FIELD,
  CONFIRM_ALREADY,
  CONFIRM_FAILED,
  CONFIRM_LOCK_TTL_MS,
  EVENT_CONFIRMATION_SOURCE,
  paymentStateOf,
} from '@/lib/event-payment-claims';

export const dynamic = 'force-dynamic';

/**
 * THE-351 — 🔴 ONE BUTTON. THE CHURCH VOUCHES, AND HARVEST RECORDS IT.
 *
 * THE FOUNDER: "When pressed, the activity is created, dashboard CRM accounting
 * invoice updated."
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 1. IT CALLS THE-350'S WRITER. IT DOES NOT WRITE AN INVOICE.
 *
 * `lib/manual-donation.ts` says so in its own header: "THE-351 (the paid-event
 * confirmation flow and the tenant inbox) is the second caller this exists for,
 * and it calls THIS FUNCTION. THE EVENT FLOW IS NOT BUILT HERE and must not
 * be." Its signature takes an amount, an email, a description and a source —
 * never a contact — for exactly this call.
 *
 * ⚠️ THAT IS WHAT MAKES ONE BUTTON REACH FIVE SURFACES WITH NO NEW READER.
 * `recordManualDonation` writes a `donation_receipt` shaped byte-for-byte like a
 * webhook receipt, so the Overview tab's giving figure, `AdminAccounting`, the
 * year-end giving statement, `/api/donation-history` (the member's own giving
 * history and per-year totals) and their downloadable receipt all start
 * counting it with nothing added anywhere. THE-340 found ELEVEN inlined copies
 * of a Resend send with none of them a function; a second invoice write here
 * would be that mistake in the money ledger.
 *
 * 🔴 AND `source: 'event_manual'` IS WHAT KEEPS IT SEPARABLE. An invoice the
 * Stripe webhook wrote carries no `source` at all, so
 * `isManuallyRecordedDonation` reads absence as "processed" and either manual
 * value as "a person vouched for this". The day a real rail exists, a gift a
 * church confirmed by hand and a gift a processor cleared are told apart by a
 * field rather than by a guess.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 2. IDEMPOTENCE — TWO TAPS, ONE INVOICE
 *
 * A double invoice is a FALSE FINANCIAL RECORD: the church's books, the
 * dashboard figure and the member's giving statement all say they gave twice.
 * Two taps on a slow connection, or a double-submit, must not produce one.
 *
 * ⚠️ THE INVOICE WRITE CANNOT BE INSIDE THE TRANSACTION — it is a different
 * collection reached through a different module, and `recordManualDonation`
 * takes no transaction. So the guard is a two-phase lock on the registration,
 * which is the only document both presses touch:
 *
 *   PHASE 1 (transaction, on the registration alone)
 *     · already has `paymentInvoiceId` → RETURN IT. The second press is told
 *       what the first one did and writes nothing. This is the case that holds
 *       forever, long after any lock has expired.
 *     · a fresh `paymentConfirmStartedAt` → REFUSE. Another press is in flight.
 *     · otherwise → take the lock.
 *   PHASE 2  call THE-350's writer.
 *   PHASE 3  on success, stamp the invoice id, who, when, and DELETE the queue
 *            key so the row leaves the inbox. On failure, RELEASE the lock and
 *            write nothing else.
 *
 * 🔴 THE LOCK EXPIRES ({@link CONFIRM_LOCK_TTL_MS}) so a crashed request cannot
 * strand a person in the inbox unconfirmable forever. The permanent guard is
 * the invoice id, not the lock; the lock only narrows the window in which two
 * presses could race, and the id closes it afterwards.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 3. A FAILED CONFIRMATION DOES NOT MARK THE TICKET PAID
 *
 * THE-321's `saveState` machine is the model and THE-342's rule is the reason.
 * If the invoice write fails, this route writes NO payment state at all: the
 * lock is released, `paymentInvoiceId` stays absent, `paymentStateOf` still
 * reads `claimed`, the queue key is still there so the row is still in the
 * inbox, and the response carries `CONFIRM_FAILED` for the admin to read. There
 * is no path that reports a confirmation without an invoice id behind it.
 */
export async function POST(request: NextRequest) {
  let body: { tenantId?: string; registrationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const tenantId = (body.tenantId || '').trim();
  const registrationId = (body.registrationId || '').trim();
  if (!tenantId || !registrationId) {
    return NextResponse.json({ error: 'tenantId and registrationId are required' }, { status: 400 });
  }

  // 🔴 THE SAME PERMISSION THE INBOX READ TAKES, on the same tenant, from the
  // same verified token. An admin at another church is refused here exactly as
  // they are refused there.
  const gate = await requireTenantPermission(request, tenantId, 'manageEvents');
  if (gate instanceof NextResponse) return gate;
  const admin = gate;

  const ref = adminDb
    .collection('tenants').doc(tenantId)
    .collection('registrations').doc(registrationId);

  // ── PHASE 1 — the lock ────────────────────────────────────────────────────
  let claim: {
    amountCents: number;
    email: string | null;
    memberName: string;
    eventId: string | null;
  };
  try {
    claim = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new ConfirmRefusal(404, 'That registration no longer exists.');
      const reg = snap.data() || {};

      const existingInvoice = reg.paymentInvoiceId;
      if (typeof existingInvoice === 'string' && existingInvoice) {
        throw new ConfirmRefusal(200, CONFIRM_ALREADY, { alreadyConfirmed: true, invoiceId: existingInvoice });
      }

      if (paymentStateOf(reg) === 'free') {
        throw new ConfirmRefusal(400, 'This ticket is free — there is nothing to confirm.');
      }

      const lock = reg.paymentConfirmStartedAt;
      if (typeof lock === 'string' && lock) {
        const age = Date.now() - new Date(lock).getTime();
        if (Number.isFinite(age) && age >= 0 && age < CONFIRM_LOCK_TTL_MS) {
          throw new ConfirmRefusal(409, 'Another confirmation is already in progress for this person.');
        }
      }

      tx.update(ref, { paymentConfirmStartedAt: new Date().toISOString() });
      return {
        amountCents: typeof reg.amount === 'number' ? reg.amount : 0,
        email: typeof reg.email === 'string' ? reg.email : null,
        memberName: typeof reg.name === 'string' && reg.name ? reg.name : 'Anonymous',
        eventId: typeof reg.eventId === 'string' ? reg.eventId : null,
      };
    });
  } catch (e) {
    if (e instanceof ConfirmRefusal) return e.toResponse();
    console.error('event payment confirm lock failed:', e);
    return NextResponse.json({ error: CONFIRM_FAILED }, { status: 500 });
  }

  // ── PHASE 2 — THE-350's writer, and nothing that resembles a second one ───
  let eventTitle = 'an event';
  try {
    if (claim.eventId) {
      const es = await adminDb
        .collection('tenants').doc(tenantId)
        .collection('events').doc(claim.eventId).get();
      eventTitle = es.data()?.title || eventTitle;
    }
  } catch {
    // The description falls back; a title that could not be read is not a
    // reason to refuse to record money the church has already received.
  }

  const donation = await recordManualDonation({
    tenantId,
    amountCents: claim.amountCents,
    email: claim.email,
    // What the giving statement and the member's own receipt will say this was.
    description: `Event ticket — ${eventTitle}`,
    source: EVENT_CONFIRMATION_SOURCE,
    recipientName: claim.memberName,
    // 🔴 The AUDIT TRAIL of who vouched. `manual-donation.ts` stores it as
    // `recordedBy`, never as a display value.
    recordedBy: admin.uid,
  });

  if (!donation.ok || !donation.invoiceId) {
    // ── PHASE 3a — release, and change NOTHING about the payment state ──────
    await ref.update({ paymentConfirmStartedAt: FieldValue.delete() }).catch(() => {});
    captureMoneyPathError(new Error(donation.error || 'manual donation refused'), {
      step: 'event-payment-confirm-invoice',
      tenantId,
      ids: { registrationId, code: donation.code || 'unknown' },
    });
    return NextResponse.json(
      { error: donation.error || CONFIRM_FAILED, code: donation.code },
      { status: 500 },
    );
  }

  // ── PHASE 3b — the confirmation record: WHO, WHEN, and which invoice ──────
  const confirmedAt = new Date().toISOString();
  try {
    await ref.update({
      paymentStatus: 'confirmed',
      paymentInvoiceId: donation.invoiceId,
      paymentConfirmedAt: confirmedAt,
      // 🔴 WHO PRESSED THE BUTTON. If a member disputes the gift later, the
      // church needs the name of the admin who vouched for it — Harvest has no
      // opinion of its own to offer.
      paymentConfirmedBy: admin.uid,
      paymentConfirmedByName: admin.email || admin.uid,
      paymentConfirmStartedAt: FieldValue.delete(),
      // Leaves the inbox. `paymentClaimedAt` is KEPT — it is the audit fact of
      // when the member pressed, and the queue key is only an index key.
      [CLAIM_QUEUE_FIELD]: FieldValue.delete(),
    });
  } catch (e) {
    // ⚠️ THE INVOICE EXISTS AND THE MONEY IS RECORDED. Losing this stamp means
    // the row stays in the inbox and a second press would find no
    // `paymentInvoiceId` — the one way a double invoice could still happen — so
    // it is reported as a money-path error rather than swallowed, and the
    // response tells the admin the gift IS recorded so they do not simply
    // press again.
    console.error('event payment confirm stamp failed after invoice write:', e);
    captureMoneyPathError(e, {
      step: 'event-payment-confirm-stamp',
      tenantId,
      ids: { registrationId, invoiceId: donation.invoiceId },
    });
    return NextResponse.json(
      {
        error: 'The gift was recorded but this ticket could not be updated. '
          + 'Do not confirm it again — check your accounting before retrying.',
        invoiceId: donation.invoiceId,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    invoiceId: donation.invoiceId,
    receiptNumber: donation.receiptNumber,
    confirmedAt,
    // THE-350 returns this rather than letting a caller infer it: a gift
    // recorded against no email is real money the giver can never retrieve a
    // receipt for, and the inbox says so on screen.
    visibleToMember: donation.visibleToMember === true,
  });
}

/** A refusal that carries its own status and body. Never a thrown 500. */
class ConfirmRefusal extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(detail);
  }

  toResponse(): NextResponse {
    if (this.status === 200) {
      return NextResponse.json({ ok: true, message: this.detail, ...this.extra });
    }
    return NextResponse.json({ error: this.detail, ...this.extra }, { status: this.status });
  }
}
