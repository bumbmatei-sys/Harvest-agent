import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  DodoWebhookSignatureError,
  readDodoWebhookHeaders,
  verifyDodoWebhookSignature,
} from '@/lib/dodo/webhook-signature';
import { requireDodoEnv } from '@/lib/dodo/required-env';

export const dynamic = 'force-dynamic';

/**
 * Dodo Payments webhook endpoint — SIGNATURE VERIFICATION ONLY.
 *
 * ⚠️ THERE ARE NO HANDLERS, DELIBERATELY. Tenant provisioning is the single
 * riskiest change in this migration and it gets its own PR; landing it next to a
 * brand-new processor integration would make a failure impossible to attribute.
 * What ships here is the door and its lock. A verified event is acknowledged and
 * logged so Dodo does not retry it, and nothing is written anywhere.
 *
 * ⚠️ THE LOCK SHIPS WITH THE DOOR. An endpoint that accepts unsigned input is an
 * unauthenticated write to the money path the moment the first handler lands.
 * Verification is therefore in the first commit, not the one that adds handlers.
 *
 * ⚠️ NO DODO WEBHOOK IS CONFIGURED TO POST HERE YET. Until the cutover, this
 * route receives nothing; a request that does arrive is either a probe or a
 * forgery, and both are rejected or ignored.
 *
 * ⚠️ WHY THE SECRET IS READ INSIDE THE HANDLER. `src/lib/dodo/config.ts` reads
 * every Dodo variable at module scope and throws when one is missing — the right
 * behaviour, and the whole argument against `billing.ts`'s `??` fallbacks. But a
 * module-scope throw in a ROUTE runs during `next build`, and the Dodo variables
 * are not in Vercel yet, so a static import here would turn "add a dark module"
 * into "break every deployment". Reading it in the handler through the same
 * `requireDodoEnv` keeps one spelling of the variable and one no-fallback rule,
 * and moves the failure from build time to a request nobody is making yet.
 */
export async function POST(request: NextRequest) {
  let secret: string;
  try {
    secret = requireDodoEnv('DODO_WEBHOOK_SECRET');
  } catch (err) {
    // Loud, and never "accepted anyway": an endpoint that cannot verify must not
    // pretend it did.
    console.error('Dodo webhook rejected — not configured:', err);
    return NextResponse.json({ error: 'Dodo webhook not configured' }, { status: 500 });
  }

  // The RAW body. Parsing first and re-serialising would change the bytes the
  // signature covers and no legitimate event would ever verify again.
  const payload = await request.text();

  try {
    verifyDodoWebhookSignature({
      payload,
      headers: readDodoWebhookHeaders(request.headers),
      secret,
    });
  } catch (err) {
    if (err instanceof DodoWebhookSignatureError) {
      console.error('Dodo webhook signature verification failed:', err.message);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
    throw err;
  }

  // Verified. Read the event type for the log only — nothing branches on it yet.
  let eventType = 'unknown';
  try {
    const parsed = JSON.parse(payload) as { type?: unknown };
    if (typeof parsed?.type === 'string') eventType = parsed.type;
  } catch {
    // A body that verified but is not JSON is worth seeing; it is not worth a
    // 400, because the signature proves Dodo sent it.
    eventType = 'unparseable';
  }

  console.log(`📬 Dodo webhook verified: ${eventType} (no handler — handlers land with the cutover)`);
  return NextResponse.json({ received: true, handled: false });
}
