import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readDodoWebhookHeaders, verifyDodoWebhook } from '@/lib/dodo/webhook-verify';
import { receiveDodoWebhookEvent } from '@/lib/dodo/webhook-dispatch';

/**
 * Dodo Payments webhook endpoint.
 *
 * ⚠️ THIS ROUTE IS NOT WIRED TO ANYTHING A USER TOUCHES. Signup still goes
 * through Stripe; `src/app/api/stripe/webhook/route.ts` is still the only thing
 * that creates a tenant. This endpoint verifies, deduplicates and routes, and its
 * handlers are empty (see `webhook-dispatch.ts`).
 *
 * ─── This route's shape is the OPPOSITE of the Stripe handler's ──────────────
 *
 * 🔴 The Stripe handler does all of its work and THEN responds. Dodo's
 * documentation is explicit that a handler must return 2xx immediately and
 * process asynchronously; anything slower is treated as a failure and retried.
 * So the ordering here is inverted on purpose, and the Stripe handler must not be
 * used as the template:
 *
 *     verify signature → hand off WITHOUT awaiting → 2xx
 *
 * The idempotency reservation lives on the far side of that handoff, in
 * `receiveDodoWebhookEvent`, which is why it has to be atomic rather than a
 * read-then-write.
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

  // Hand off WITHOUT awaiting. `receiveDodoWebhookEvent` is documented never to
  // reject; the `.catch` is a belt-and-braces guard so that a future change
  // breaking that promise cannot produce an unhandled rejection in the runtime.
  void receiveDodoWebhookEvent(headers['webhook-id'], event).catch((err) => {
    console.error('[dodo] Webhook processing failed after acknowledgement:', err);
  });

  // 2xx before any work. Dodo retries anything else.
  return NextResponse.json({ received: true });
}
