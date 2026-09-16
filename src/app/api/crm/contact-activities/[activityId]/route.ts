import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireTenantPermission } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { isManuallyRecordedDonation } from '@/lib/manual-donation';
import { captureMoneyPathError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

/**
 * THE-369 — ONE ROW OFF ONE CONTACT'S TIMELINE, AND THE MONEY BEHIND IT.
 *
 * THE FOUNDER: "make sure that if i delete the activity, it is deleted from the
 * dashboard analytics donation as well."
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 1. WHY THIS IS A SECOND ROUTE AND NOT A BRANCH IN THE FIRST
 *
 * `../route.ts` already exports a DELETE, and it removes EVERY activity of one
 * contact for THE-362's contact-deletion cascade. That route's docblock spends
 * a section on what it does NOT touch:
 *
 *     `tenants/{t}/invoices` IS NEVER READ OR WRITTEN HERE … a donation row's
 *     `invoiceId` points AT the receipt; deleting the row removes a pointer,
 *     never its target.
 *
 * 🔴 THAT IS STILL TRUE OF IT, AND THIS FILE IS WHY IT CAN STAY TRUE. Deleting a
 * PERSON keeps their receipts; deliberately deleting ONE GIFT does not. Those
 * are two different acts with two different answers, and a shared handler would
 * have had to decide between them from the shape of a query string. The
 * collection route is BYTE-IDENTICAL to what THE-362 left, and a guard pins its
 * digest so this decision cannot leak into the cascade later either.
 *
 * ⚠️ The gate, the helper, the argument and the per-document cross-tenant check
 * are all COPIED from it, because the security shape is established and this is
 * not the place to invent a second one.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 2. A DELETE THAT REMOVES ONLY THE ACTIVITY LEAVES THE MONEY BEHIND
 *
 * A donation row carries `invoiceId` and `invoiceAmountCents`. THE INVOICE IS
 * THE MONEY: the dashboard giving figure sums `tenants/{t}/invoices`,
 * `AdminAccounting` reads it, `/api/giving-statements/generate` aggregates it
 * per donor per year and `/api/donation-history` is how a MEMBER sees their own
 * giving. `contactActivities` is read as money by nothing at all — THE-350 made
 * `amount` null on these rows precisely so nothing sums the gift twice.
 *
 * So there are three reasons a church deletes one, and the money is wrong in ALL
 * THREE if only the row goes: logged on the wrong contact (the gift is real, the
 * attribution is not), typed at the wrong amount (the invoice is wrong too), and
 * never happened at all (income is overstated). In every one of them the row
 * vanishes, the church reasonably assumes the figure moved, and it did not.
 *
 * 🔴 THE FOUNDER'S DECISION IS THAT THE GIFT LEAVES THE DASHBOARD TOO, so the
 * INVOICE IS DELETED WITH THE ACTIVITY. Not anonymised — see section 5.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 3. WHICH INVOICES THIS MAY REACH, AND WHY `manageCRM` IS THE RIGHT BAR
 *
 * `firestore.rules` gates `tenants/{t}/invoices` on `manageAccounting`, and the
 * CRM admin who records a gift holds `manageCRM` — which is why THE-350's write
 * runs on the Admin SDK behind a `manageCRM` route rather than from the client.
 * This is the same wall from the other side, and the answer is the same shape.
 *
 * ⚠️ THE BAR IS NOT RAISED TO `manageAccounting`, and that is a decision with a
 * reason rather than an omission. Requiring it would put the correction out of
 * reach of exactly the person who made the mistake — the founder's original bug
 * wearing a permission error, which is the trade THE-350 already refused once.
 *
 * 🔴 WHAT MAKES THAT SAFE IS NOT THE PERMISSION, IT IS THE SOURCE CHECK BELOW.
 * The invoice is read before anything is deleted and the operation is REFUSED
 * unless it is `source: 'crm_manual'` — a gift a `manageCRM` admin typed into
 * this very screen. So the delete bar and the AUTHORSHIP bar are the same bar:
 * this route can only undo what a CRM admin created through the CRM.
 *
 *   · `source: 'event_manual'` → REFUSED. See section 4.
 *   · NO `source` at all → REFUSED. `isManuallyRecordedDonation` reads absence
 *     as "a payment rail processed this", which every historical receipt is. The
 *     money really moved; its receipt is not a CRM screen's to remove. Not
 *     reachable today — `lib/donation-webhook.ts` writes its CRM row with an
 *     `amount` in DOLLARS and NO `invoiceId` at all, so a processed gift's
 *     activity has no pointer for this route to follow — and refused anyway,
 *     because "unreachable" is a property of today's writers.
 *   · anything else → REFUSED, so a third manual source added tomorrow is
 *     refused until somebody decides what deleting it should mean.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 4. AN EVENT TICKET IS REFUSED, AND IT IS NOT ABOUT REVOKING ONE
 *
 * THE-351 stamps `paymentInvoiceId` on the registration when an admin confirms a
 * paid ticket, and THE-359 writes the matching CRM donation activity.
 *
 * ⚠️ DELETING THE INVOICE COULD NOT REVOKE THAT TICKET — checked rather than
 * assumed. `paymentStateOf` reads the `paymentInvoiceId` STRING on the
 * registration and never fetches the invoice, and the check-in path reads
 * registration status alone. The ticket would survive.
 *
 * 🔴 IT IS REFUSED FOR THE OPPOSITE REASON: the ticket survives, AND SO DOES THE
 * CONFIRMED STATE, with no way back. `paymentInvoiceId` is also THE-351's
 * permanent idempotence guard — a second press finds it and returns it without
 * writing — and the queue key was deleted, so the row has left the inbox. The
 * church would be left holding a ticket it says is paid for, no receipt on its
 * books, and a Confirm button that can never write the gift again. That is a
 * one-way trap, and it is not the correction the founder asked for.
 *
 * ⚠️ SO THIS REFUSES RATHER THAN GUESSING, and says so on screen. Correcting an
 * event payment belongs to the event, where the registration and the receipt can
 * move together; this route will not take half of it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 5. THREE OPERATIONS, THREE PURPOSES, AND NONE OF THEM IS ANOTHER
 *
 *   · CRM DELETE (here) — the church is correcting ITS OWN record. The gift is
 *     wrong, so the money record goes.
 *   · MEMBER EXPORT (`lib/member-export.ts`) — the member reads their data.
 *   · ERASURE (`lib/member-erasure.ts`) — a member erases themselves, and the
 *     invoice is ANONYMISED rather than deleted: it is a tax record, so the
 *     money stays and only the person is removed.
 *
 * 🔴 THIS IS THE OPPOSITE OF ERASURE AND MUST NOT BORROW ITS MECHANISM. An
 * anonymised receipt still counts on the dashboard, which is the one thing the
 * founder asked for the removal of.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 6. ATOMIC, BECAUSE HERE IT CAN BE
 *
 * The collection route argues RESUMABLE over ATOMIC, and it is right to: a batch
 * cannot span an unbounded number of rows, so "atomic" is not on offer for a
 * contact's whole timeline. Here it is exactly TWO documents, so a transaction
 * spans them and either both go or neither does.
 *
 * ⚠️ WHICH MATTERS BECAUSE ONE ORDERING IS UNRECOVERABLE. Activity first would
 * mean a failure that removes the row and leaves the gift on the books with no
 * pointer left to find it by — the silent money-behind failure this whole file
 * exists to prevent — and no screen from which to retry. A transaction refuses
 * that state rather than ordering around it.
 */

/** Why a single-activity delete was refused. Never alongside a deletion. */
export type ActivityDeleteRefusal = 'event_ticket' | 'processed_gift' | 'unrecognised_source';

/** What a transaction decided. Exactly one of these shapes comes back. */
type Outcome =
  | { kind: 'not_found' }
  | { kind: 'refused'; code: ActivityDeleteRefusal }
  | { kind: 'deleted'; invoiceRemoved: boolean; amountCents: number | null };

/**
 * What the church is told when this refuses. Written here rather than on the
 * client so the reason and the rule that produced it cannot drift apart.
 */
const REFUSAL_COPY: Record<ActivityDeleteRefusal, string> = {
  event_ticket:
    'This gift paid for an event ticket that somebody is holding. Removing the receipt here '
    + 'would take the money off your books while the ticket stays confirmed, and it could not '
    + 'be confirmed again. Correct it from the event instead.',
  processed_gift:
    'This gift was processed by a payment provider, so the money really moved and its receipt '
    + 'is not this screen’s to remove. Your accounting admin can correct it from Accounting.',
  unrecognised_source:
    'This gift’s receipt was not recorded from the CRM, so this screen cannot tell what '
    + 'removing it would change. Nothing was deleted.',
};

/**
 * DELETE /api/crm/contact-activities/<activityId>?tenantId=<id>
 *
 * Removes ONE timeline row, and the invoice it points at when that invoice is a
 * gift the CRM itself recorded. See the header for every branch below.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { activityId: string } },
) {
  const activityId = (params?.activityId || '').trim();
  const tenantId = request.nextUrl.searchParams.get('tenantId');
  if (!activityId) {
    return NextResponse.json({ error: 'activityId is required' }, { status: 400 });
  }
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  // The gate, copied from the collection route. `requireTenantPermission`
  // verifies the caller BELONGS to this tenant before it checks the permission,
  // so a client-supplied id can only ever name a tenant they are a member of.
  const auth = await requireTenantPermission(request, tenantId, 'manageCRM');
  if (auth instanceof NextResponse) return auth;

  try {
    const outcome = await adminDb.runTransaction<Outcome>(async (tx) => {
      const actRef = adminDb.collection('contactActivities').doc(activityId);
      const actSnap = await tx.get(actRef);
      if (!actSnap.exists) return { kind: 'not_found' };
      const act = actSnap.data() || {};

      /**
       * 🔴 THE CROSS-TENANT GUARD, and it is the whole reason an id is not
       * enough. `contactActivities` is a TOP-LEVEL collection, so a document id
       * alone proves NOTHING about which church a row belongs to — the
       * collection route applies the same check per document for the same
       * reason, and `deleteByQuery` skips rather than deletes a row that fails
       * it. A 404 rather than a 403: another tenant's row must not be
       * distinguishable from one that does not exist.
       */
      if ((act.tenantId ?? null) !== tenantId) return { kind: 'not_found' };

      const invoiceId =
        typeof act.invoiceId === 'string' && act.invoiceId.length > 0 ? act.invoiceId : null;

      // A note, a call, a meeting, an email, or a pre-THE-350 donation row that
      // never pointed at a receipt. No money, so exactly what it looks like.
      if (!invoiceId) {
        tx.delete(actRef);
        return { kind: 'deleted', invoiceRemoved: false, amountCents: null };
      }

      const invRef = adminDb
        .collection('tenants').doc(tenantId)
        .collection('invoices').doc(invoiceId);
      const invSnap = await tx.get(invRef);

      // The pointer outlived its target — a half-finished delete from an earlier
      // attempt, which is the one partial state this route can produce. Removing
      // the row finishes it, and there is no money left to weigh.
      if (!invSnap.exists) {
        tx.delete(actRef);
        return { kind: 'deleted', invoiceRemoved: false, amountCents: null };
      }

      const inv = invSnap.data() || {};
      // 🔴 SECTION 3'S LADDER, IN ORDER AND FAILING CLOSED. Only a gift this
      // screen recorded reaches the delete below.
      if (!isManuallyRecordedDonation(inv)) return { kind: 'refused', code: 'processed_gift' };
      if (inv.source === 'event_manual') return { kind: 'refused', code: 'event_ticket' };
      if (inv.source !== 'crm_manual') return { kind: 'refused', code: 'unrecognised_source' };

      // 🔴 BOTH, IN ONE COMMIT. See section 6: the alternative orderings each
      // have a failure that leaves the money and the row disagreeing.
      tx.delete(invRef);
      tx.delete(actRef);
      return {
        kind: 'deleted',
        invoiceRemoved: true,
        // The ledger's own figure in CENTS, returned rather than echoed back
        // from the request, so a caller reporting what was removed is reporting
        // what the books actually lost.
        amountCents: typeof inv.amount === 'number' ? inv.amount : null,
      };
    });

    if (outcome.kind === 'not_found') {
      return NextResponse.json({ error: 'That activity could not be found.' }, { status: 404 });
    }
    if (outcome.kind === 'refused') {
      // 409, not 403: the caller holds the permission — this particular row is
      // not one that may be removed here, and the body says which rule refused.
      return NextResponse.json(
        { error: REFUSAL_COPY[outcome.code], code: outcome.code },
        { status: 409 },
      );
    }
    return NextResponse.json({
      removed: 1,
      invoiceRemoved: outcome.invoiceRemoved,
      amountCents: outcome.amountCents,
    });
  } catch (e) {
    // 🔴 A MONEY-PATH CAPTURE, because this transaction can delete a receipt. A
    // failure here wrote NOTHING (that is what the transaction buys), and the
    // caller is told so rather than being left to guess.
    console.error('contact-activity delete error:', e);
    captureMoneyPathError(e, {
      step: 'crm-contact-activity-delete',
      tenantId,
      ids: { activityId },
    });
    return NextResponse.json(
      { error: 'This activity could not be removed. Nothing was deleted — try again.' },
      { status: 500 },
    );
  }
}
