import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readDodoWebhookHeaders, verifyDodoWebhook } from '@/lib/dodo/webhook-verify';
import { isDurableDodoEventType, receiveDodoWebhookEvent } from '@/lib/dodo/webhook-dispatch';

/**
 * Dodo Payments webhook endpoint.
 *
 * 🔴 THIS ROUTE CREATES TENANTS. With `DODO_BILLING_ENABLED` true it is the only
 * thing that turns a paid signup into a church account — the role
 * `src/app/api/stripe/webhook/route.ts` plays for the Stripe path, which stays
 * in place as the rollback.
 *
 * ─── Two response shapes, chosen per event ───────────────────────────────────
 *
 * Dodo's documentation asks for a fast 2xx and retries anything else, so the
 * DEFAULT here is still the opposite of the Stripe handler's do-everything-first
 * shape:
 *
 *     verify signature → hand off WITHOUT awaiting → 2xx
 *
 * But "fast" cannot win over "a church paid and has no account". For the one
 * DURABLE event — `subscription.active`, which provisions — the handler is
 * AWAITED and a failure is answered 5xx so Dodo redelivers. That work is a
 * handful of Firestore writes, well inside Dodo's tolerance, and the
 * alternative is a signup that silently evaporates. `isDurableDodoEventType`
 * names the split; `webhook-dispatch.ts` explains why releasing the idempotency
 * reservation on that path is safe.
 *
 * ⚠️ The flag is NOT consulted here, deliberately. `DODO_BILLING_ENABLED` gates
 * whether new Dodo checkouts are CREATED. A subscription that was already paid
 * for must still be provisioned even if the flag has since been turned off, or
 * rolling back would strand the customers who were mid-checkout at the moment it
 * happened.
 *
 * ─── The raw body ────────────────────────────────────────────────────────────
 *
 * `await request.text()` is how the untouched bytes are obtained. Next.js App
 * Router route handlers receive a standard `Request`, whose body has not been
 * parsed by any middleware — no `bodyParser` to disable, unlike the Pages Router
 * or Express. `request.text()` returns exactly what Dodo sent.
 *
 * ⚠️ Nothing may call `request.json()` before this. Parsing and re-stringifying
 * changes the bytes and every signature fails.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // RAW, first, before anything else can consume the body.
  const rawBody = await request.text();

  const headers = readDodoWebhookHeaders(request.headers);
  if (!headers) {
    // Unsigned. Rejected without parsing the payload.
    return NextResponse.json(
      { error: 'Missing webhook signature headers' },
      { status: 401 },
    );
  }

  let event;
  try {
    event = verifyDodoWebhook(rawBody, headers);
  } catch (err) {
    console.error('[dodo] Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // ── Durable events: wait, and let a failure become a redelivery. ───────────
  if (isDurableDodoEventType(event.type)) {
    const result = await receiveDodoWebhookEvent(headers['webhook-id'], event);
    if (result.outcome === 'failed') {
      // 5xx is the ONLY thing that brings this event back. The reservation has
      // already been released by the dispatcher so the redelivery is processed
      // rather than skipped as a duplicate.
      console.error(`[dodo] Provisioning failed for ${event.type}; asking Dodo to retry.`);
      return NextResponse.json(
        { error: 'Provisioning failed; will retry' },
        { status: 500 },
      );
    }
    return NextResponse.json({ received: true });
  }

  // ── Everything else: hand off WITHOUT awaiting. ────────────────────────────
  // `receiveDodoWebhookEvent` is documented never to reject; the `.catch` is a
  // belt-and-braces guard so that a future change breaking that promise cannot
  // produce an unhandled rejection in the runtime.
  void receiveDodoWebhookEvent(headers['webhook-id'], event).catch((err) => {
    console.error('[dodo] Webhook processing failed after acknowledgement:', err);
  });

  // 2xx before any work. Dodo retries anything else.
  return NextResponse.json({ received: true });
}
