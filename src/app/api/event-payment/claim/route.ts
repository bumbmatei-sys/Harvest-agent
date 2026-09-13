import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { captureHandledError } from '@/lib/money-path-sentry';
import { notifyChurchOfPaymentClaim } from '@/lib/event-payment-notify';
import {
  CLAIM_QUEUE_FIELD,
  memberClaimFailed,
  paymentStateOf,
  providerFromClaim,
} from '@/lib/event-payment-claims';

export const dynamic = 'force-dynamic';

/**
 * THE-351 — 🔴 THE MEMBER PRESSES "I'VE PAID", AND IT CONFIRMS NOTHING.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 1. WHAT THIS ROUTE IS ALLOWED TO CHANGE
 *
 * THE FOUNDER: "Don't let Harvest imply it verified anything."
 *
 * So this route writes THREE fields and not one of them is a money state:
 *
 *     paymentClaimedAt        ISO — when they pressed. An audit fact.
 *     paymentClaimProvider    which app they SAY they used. Their word.
 *     paymentClaimPendingAt   the inbox queue key (see event-payment-claims.ts)
 *
 * 🔴 IT DOES NOT TOUCH `paymentStatus`, `paymentInvoiceId` OR `amount`. A member
 * cannot mark their own ticket paid, and the shape of this handler is what makes
 * that structural rather than a policy someone could edit out: there is no
 * branch here that writes any of them. `paymentStateOf` keys `confirmed` on the
 * INVOICE ID, which only the confirm route can write and only through THE-350's
 * writer, so even a member who forged every field this route accepts moves their
 * ticket from `unpaid` to `claimed` and no further.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 2. WHY IT IS THE ADMIN SDK BEHIND `requireAuth`, NOT A CLIENT WRITE
 *
 * `firestore.rules` gates a registration UPDATE on
 * `hasPermission('manageEvents', tenantId)` — an admin permission. A member
 * writing their own claim from the client would be REFUSED, and the alternative
 * is to loosen a rule on a document that carries a money amount, in a file that
 * AUTO-DEPLOYS ON MERGE WITH NO EMULATOR TESTS (THE-313's one-line change
 * turned 46 files red).
 *
 * So the write goes through the Admin SDK here, and the ownership check this
 * route imposes itself is STRICTER than the rule would have been: the caller
 * must match the registration by verified uid OR by verified token email —
 * exactly the pair `/api/my-registrations` uses to decide which tickets are
 * yours. `firestore.rules` is untouched by this ticket.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 3. THE INBOX ITEM IS COMMITTED BEFORE ANYONE IS NOTIFIED
 *
 * ⚠️ A NOTIFICATION IS A PROMPT, NEVER THE RECORD. The Firestore write is
 * awaited and the notification is attempted afterwards; its result is logged and
 * never gates the response. A church with an empty roster, an unset
 * `RESEND_API_KEY` or a Resend outage still has the person sitting in the inbox
 * with everything needed to match them to a bank line.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: { tenantId?: string; registrationId?: string; provider?: string };
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

  try {
    const ref = adminDb
      .collection('tenants').doc(tenantId)
      .collection('registrations').doc(registrationId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }
    const reg = snap.data() || {};

    // 🔴 OWNERSHIP, BY VERIFIED IDENTITY ONLY. Never by a client-supplied field.
    // The email half is what lets a member who registered logged-OUT and later
    // signed in still press their own button; it is the same dual match
    // `/api/my-registrations` uses to decide whose tickets are whose.
    const callerEmail = (auth.email || '').toLowerCase();
    const owns =
      (typeof reg.userId === 'string' && reg.userId === auth.uid) ||
      (!!callerEmail && typeof reg.email === 'string' && reg.email.toLowerCase() === callerEmail);
    if (!owns) {
      return NextResponse.json({ error: 'Not your registration' }, { status: 403 });
    }

    const state = paymentStateOf(reg);
    if (state === 'free') {
      // Nothing to claim. A free seat has no payment and must never acquire the
      // vocabulary of one.
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
    await ref.update({
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
        // 🔴 NOT AN ERROR TO THE MEMBER, and not a silence either. The claim is
        // saved; what failed is the prompt. Recorded so a church that never
        // hears about its inbox is diagnosable.
        console.warn('payment claim notification incomplete:', {
          tenantId, registrationId, ...result,
        });
      }
    } catch (e) {
      console.warn('payment claim notification failed:', e);
      captureHandledError(e, {
        step: 'event-payment-claim-notify',
        level: 'warning',
        tenantId,
        ids: { registrationId },
      });
    }

    return NextResponse.json({ ok: true, state: 'claimed', claimedAt });
  } catch (e) {
    console.error('event payment claim error:', e);
    captureHandledError(e, {
      step: 'event-payment-claim',
      tenantId,
      ids: { registrationId },
    });
    // 🔴 The member is told nothing changed, because nothing did. THE-342's
    // rule: a default that hides an error is a bug.
    // THE-359 — this route holds a tenantId, not a tenant NAME, and a doc read
    // on the failure path to fetch one would be a second way to fail while
    // already failing. `tenantLabel`'s fallback is exactly what it is for.
    // The surfaces that DO hold the name render their own copy of this
    // sentence with it interpolated; this is the body of a 500.
    return NextResponse.json({ error: memberClaimFailed(null) }, { status: 500 });
  }
}
