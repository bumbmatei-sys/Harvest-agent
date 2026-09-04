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
 *     verify signature → reserve the webhook-id → hand the HANDLER off
 *                        WITHOUT awaiting → 2xx
 *
 * But "fast" cannot win over "a church paid and has no account". For the one
 * DURABLE event — `subscription.active`, which provisions — the handler is
 * AWAITED and a failure is answered 5xx so Dodo redelivers. That work is a
 * handful of Firestore writes, well inside Dodo's tolerance, and the
 * alternative is a signup that silently evaporates. `isDurableDodoEventType`
 * names the split; `webhook-dispatch.ts` explains why releasing the idempotency
 * reservation on that path is safe.
 *
 * ─── THE-302: the reservation is awaited on BOTH shapes now ──────────────────
 *
 * ⚠️ THE BEST-EFFORT PATH USED TO ACKNOWLEDGE BEFORE ANY WORK AT ALL, and one
 * step moved: the idempotency reservation is now settled before the 2xx, and a
 * reservation that FAILS is answered 5xx like any other. The handler is still
 * handed off unawaited, so the claim these two shapes make about handler work is
 * unchanged.
 *
 * 🔴 Why the move is worth its latency. Sentry `JAVASCRIPT-NEXTJS-B` recorded 24
 * `DEADLINE_EXCEEDED` failures on this endpoint in three weeks, every one of
 * them inside that reservation — the FIRST Firestore call in the request, and
 * therefore the one that fails first when Firestore is unreachable. The
 * dispatcher reported them as `duplicate`, this route read `duplicate` as
 * "already handled", and Dodo — which retries only a non-2xx — never sent the
 * event again. A `subscription.active` caught by the same outage would have been
 * a paying church with no account and nothing to redeliver it. Answering 5xx
 * requires knowing the reservation failed, and knowing that requires waiting for
 * it: one document create, bounded by `DODO_STORE_TIMEOUT_MS`.
 *
 * ⚠️ Safe by construction, not by luck: when the reservation fails NOTHING was
 * claimed and NO handler ran, so the redelivery is a clean first delivery rather
 * than a second run of anything.
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

  // ── Durable events wait for the handler; everything else only for the
  //    reservation. Either way a failure comes back as a redelivery. ──────────
  const durable = isDurableDodoEventType(event.type);

  // `receiveDodoWebhookEvent` is documented never to reject; the `.catch` is a
  // belt-and-braces guard so that a future change breaking that promise cannot
  // produce an unhandled rejection in the runtime. It answers `unreserved` so
  // this route still decides the status code rather than inheriting a 500 from
  // the framework.
  const result = await receiveDodoWebhookEvent(
    headers['webhook-id'],
    event,
    durable ? {} : { deferHandler: true },
  ).catch((err) => {
    console.error('[dodo] Webhook dispatch rejected, which it is documented not to do:', err);
    return { outcome: 'unreserved' as const, type: event.type, webhookId: headers['webhook-id'], error: err };
  });

  // 🔴 THE-302. The event was NOT accepted: no claim was recorded and no handler
  // ran, so Dodo must send it again. Every event type, not just the durable one
  // — this is the failure that silently dropped writes in production, and it is
  // the first Firestore call in the request, so it is where an outage lands.
  if (result.outcome === 'unreserved') {
    console.error(`[dodo] Could not accept ${event.type} (${headers['webhook-id']}); asking Dodo to retry.`);
    return NextResponse.json(
      { error: 'Could not record this event; will retry' },
      { status: 500 },
    );
  }

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

  // 2xx before any HANDLER work, on the best-effort path. Dodo retries anything
  // else.
  return NextResponse.json({ received: true });
}
