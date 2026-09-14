import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { notifyChurchOfPaymentClaim } from '@/lib/event-payment-notify';
import {
  CLAIM_QUEUE_FIELD,
  memberClaimFailed,
  PUBLIC_CLAIM_TOKEN_FIELD,
  isPublicClaimToken,
  paymentStateOf,
  providerFromClaim,
} from '@/lib/event-payment-claims';

export const dynamic = 'force-dynamic';

/**
 * THE-355 — 🔴 A REGISTRANT WITH NO ACCOUNT SAYS THEY PAID.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 1. WHY THIS ROUTE EXISTS AT ALL, WHEN `../claim` ALREADY DOES THIS
 *
 * THE FOUNDER, ON HIS OWN CRUSADE EVENT: "there is no confirm button in inbox,
 * only in event page."
 *
 * The inbox was empty and it was RIGHT to be empty: nothing had ever been
 * claimed. THE-351 built the claim flow behind `requireAuth` and mounted it on
 * `UserEvents` — the LOGGED-IN member app — and its own ownership record names
 * the hole that left: the admin's attendee row "is the only surface that
 * reaches a member who registered LOGGED OUT and can therefore never press
 * 'I've paid' themselves". For a crusade, where most attendees have no account
 * and never will, that is not an edge case. It is everybody.
 *
 * ⚠️ `../claim` IS NOT LOOSENED TO COVER THIS, AND THAT IS THE POINT. That route
 * authorises by VERIFIED uid or VERIFIED token email and must keep doing
 * exactly that — a signed-in member's claim is authenticated and should stay
 * authenticated. Widening it to also accept a bearer token would give one
 * handler two authorisation models and one branch to get wrong. Two doors, two
 * locks, and neither can be mistaken for the other.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 2. STOP CONDITION 3 — A CLAIM CANNOT LAND ON SOMEBODY ELSE'S REGISTRATION
 *
 * 🔴 THIS HANDLER ACCEPTS NO `registrationId`. It does not take one, it does not
 * read one, and there is nothing in it to compare one against. The document is
 * FOUND BY THE TOKEN:
 *
 *     .where(PUBLIC_CLAIM_TOKEN_FIELD, '==', token).limit(2)
 *
 * so the credential SELECTS the row rather than accompanying an id that a
 * forgotten check could let diverge from it. The strongest statement available
 * about "you cannot claim on another person's registration" is that there is no
 * expressible request that names one, and that is the shape above.
 *
 * ⚠️ `limit(2)`, NOT `limit(1)` — THE-324's reading, and for its reason. Two
 * documents sharing a token would mean the generator had collided (at 256 bits
 * it has not) or that one had been written by hand. Answering with an arbitrary
 * one of them would let a token address a row it was not minted for, so the
 * ambiguous case is refused rather than resolved.
 *
 * ⚠️ THE SHAPE IS CHECKED BEFORE FIRESTORE IS. `isPublicClaimToken` costs
 * nothing and stops `?token=<a megabyte of junk>` becoming a query.
 *
 * 🔴 AND THE TOKEN IS NEVER READ BACK OUT. It is written once by the submit
 * route, returned once to the person who just registered, and no response on
 * any surface — this one included — ever contains it again.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 3. WHAT IT MAY CHANGE: THE SAME THREE FIELDS, AND NO MONEY STATE
 *
 * Identical to `../claim`, deliberately:
 *
 *     paymentClaimedAt        ISO — when they pressed. An audit fact.
 *     paymentClaimProvider    which app they SAY they used. Their word.
 *     paymentClaimPendingAt   the inbox queue key.
 *
 * 🔴 `paymentStatus`, `paymentInvoiceId` AND `amount` ARE NOT WRITTEN BY ANY
 * BRANCH HERE. A bearer token cannot mark a ticket paid, because there is no
 * line in this handler that marks anything paid. `paymentStateOf` keys
 * `confirmed` on the INVOICE ID, which only the confirm route can write and
 * only through THE-350's writer — so the worst an unauthorised holder of a
 * token can do is move ONE registration from `unpaid` to `claimed` and put its
 * owner in front of an admin who then looks in their own bank account. That is
 * the whole blast radius, and it is the same one THE-324 accepted for a rota
 * invitation: "the worst an unauthorised holder can do is answer one".
 *
 * ⚠️ NO `firestore.rules` CHANGE. STOP condition 2 does not fire: this is the
 * Admin SDK inside a route, exactly as `../claim` is, and for the reason that
 * route already records — the rules gate a registration UPDATE on
 * `manageEvents`, and the alternative is loosening a rule on a document
 * carrying a money amount in a file that AUTO-DEPLOYS ON MERGE WITH NO EMULATOR
 * TESTS (THE-313's one line turned 46 files red). It is untouched.
 *
 * ⚠️ NO COMPOSITE INDEX. One equality `where` and no `orderBy` is a single-field
 * index Firestore maintains automatically, so `firestore.indexes.json` — which
 * does not deploy, and where an index would be INERT while the query threw
 * `failed-precondition` in production — is untouched.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 4. THE INBOX ITEM IS COMMITTED BEFORE ANYONE IS NOTIFIED
 *
 * ⚠️ A NOTIFICATION IS A PROMPT, NEVER THE RECORD — `../claim`'s rule, kept
 * here. The Firestore write is awaited and the notification is attempted
 * afterwards; its result is logged and never gates the response.
 */
export async function POST(request: NextRequest) {
  let body: { tenantId?: string; token?: string; provider?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const tenantId = (body.tenantId || '').trim();
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!tenantId || !isPublicClaimToken(token)) {
    // 🔴 ONE MESSAGE FOR A MISSING TENANT AND A MALFORMED TOKEN. A response that
    // distinguished them would confirm which half was right to whoever was
    // guessing, and neither answer is useful to a real registrant.
    return NextResponse.json({ error: 'That link is not valid.' }, { status: 400 });
  }

  try {
    // 🔴 THE TOKEN SELECTS THE ROW. See section 2 — there is no id to mismatch.
    const found = await adminDb
      .collection('tenants').doc(tenantId)
      .collection('registrations')
      .where(PUBLIC_CLAIM_TOKEN_FIELD, '==', token)
      .limit(2)
      .get();

    if (found.docs.length !== 1) {
      return NextResponse.json({ error: 'That link is not valid.' }, { status: 404 });
    }
    const doc = found.docs[0];
    const reg = doc.data() || {};

    const state = paymentStateOf(reg);
    if (state === 'free') {
      // A free seat has no payment and must never acquire the vocabulary of one.
      return NextResponse.json({ error: 'This ticket is free.' }, { status: 400 });
    }
    if (state === 'confirmed') {
      // Already vouched for by the church. Pressing again must not re-open a
      // resolved row — that would put a confirmed gift back in the queue and
      // invite a second invoice.
      return NextResponse.json({ ok: true, state: 'confirmed' });
    }

    const provider = providerFromClaim(body.provider);
    const claimedAt = new Date().toISOString();

    // ⚠️ `state === 'claimed'` reaches here too, and re-pressing is allowed on
    // purpose: it refreshes the timestamp of an unanswered claim and re-notifies
    // a church that missed the first one. It cannot create a second inbox row —
    // the row IS this document — so the idempotency that matters (one
    // registration, one queue entry, one invoice) is a property of the shape.
    await doc.ref.update({
      paymentClaimedAt: claimedAt,
      paymentClaimProvider: provider ? provider.id : null,
      [CLAIM_QUEUE_FIELD]: claimedAt,
    });

    // ── Everything below is best-effort. The row above is the record. ──
    try {
      const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
      const tData = tenantSnap.data() || {};
      const churchName = tData.name || tData.displayName || 'Your church';

      let eventTitle = 'an event';
      if (typeof reg.eventId === 'string' && reg.eventId) {
        const evSnap = await adminDb
          .collection('tenants').doc(tenantId)
          .collection('events').doc(reg.eventId).get();
        eventTitle = evSnap.data()?.title || eventTitle;
      }

      const result = await notifyChurchOfPaymentClaim({
        tenantId,
        churchName,
        memberName: typeof reg.name === 'string' && reg.name ? reg.name : 'Someone',
        eventTitle,
        amountCents: typeof reg.amount === 'number' ? reg.amount : 0,
        reference: typeof reg.paymentReference === 'string' ? reg.paymentReference : '',
        providerLabel: provider ? provider.label : null,
        inboxUrl: `https://${tenantId}.theharvest.app/admin`,
      });
      if (result.noRecipients || result.emailed < result.attempted) {
        // 🔴 NOT AN ERROR TO THE REGISTRANT, and not a silence either. The claim
        // is saved; what failed is the prompt.
        console.warn('public payment claim notification incomplete:', {
          tenantId, registrationId: doc.id, ...result,
        });
      }
    } catch (e) {
      console.warn('public payment claim notification failed:', e);
      captureHandledError(e, {
        step: 'event-payment-public-claim-notify',
        level: 'warning',
        tenantId,
        ids: { registrationId: doc.id },
      });
    }

    return NextResponse.json({ ok: true, state: 'claimed', claimedAt });
  } catch (e) {
    console.error('public event payment claim error:', e);
    captureHandledError(e, { step: 'event-payment-public-claim', tenantId });
    // 🔴 The registrant is told nothing changed, because nothing did. THE-342's
    // rule: a default that hides an error is a bug.
    // THE-359 — this route holds a tenantId, not a tenant NAME, and a doc read
    // on the failure path to fetch one would be a second way to fail while
    // already failing. `tenantLabel`'s fallback is exactly what it is for.
    // The surfaces that DO hold the name render their own copy of this
    // sentence with it interpolated; this is the body of a 500.
    return NextResponse.json({ error: memberClaimFailed(null) }, { status: 500 });
  }
}
