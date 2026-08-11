import { Webhook } from 'standardwebhooks';
import { dodoConfig } from './config';
import type { DodoWebhookEvent } from './events';

/**
 * Dodo webhook signature verification.
 *
 * Dodo follows the Standard Webhooks specification, so verification is the
 * `standardwebhooks` package rather than anything hand-rolled. Manually, the
 * signature is an HMAC-SHA256 over `id.timestamp.payload` joined by periods,
 * base64-encoded, presented as `v1,<sig>` in `webhook-signature` — but a
 * hand-rolled comparison is how you end up with a non-constant-time equality
 * check on the one string that decides whether a request is authentic.
 *
 * ⚠️ THE RAW BODY, ALWAYS. The signature covers the exact bytes Dodo sent.
 * `JSON.parse` followed by `JSON.stringify` produces different bytes — key order,
 * whitespace, unicode escaping — and every signature fails. The caller must pass
 * the untouched request text; see the route for how it is obtained.
 *
 * The library also enforces a five-minute timestamp tolerance, which is what
 * stops a valid signature from being replayed indefinitely.
 */

export class DodoWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DodoWebhookVerificationError';
  }
}

/** The three Standard Webhooks headers Dodo sends. */
export interface DodoWebhookHeaders {
  'webhook-id': string;
  'webhook-signature': string;
  'webhook-timestamp': string;
}

/**
 * Pull the Standard Webhooks headers off a request.
 *
 * Returns null when any of the three is absent — an unsigned payload, which is
 * rejected without ever being parsed.
 */
export function readDodoWebhookHeaders(headers: Headers): DodoWebhookHeaders | null {
  const id = headers.get('webhook-id');
  const signature = headers.get('webhook-signature');
  const timestamp = headers.get('webhook-timestamp');
  if (!id || !signature || !timestamp) return null;
  return { 'webhook-id': id, 'webhook-signature': signature, 'webhook-timestamp': timestamp };
}

/**
 * Verify a raw webhook body and return the parsed event.
 *
 * @param rawBody The request body EXACTLY as received. Not re-serialised.
 * @throws {DodoWebhookVerificationError} for a missing, malformed, wrongly
 *   signed, stale, or wrong-secret signature. The caller must not fall back to
 *   trusting the payload on any of them.
 */
export function verifyDodoWebhook(
  rawBody: string,
  headers: DodoWebhookHeaders,
): DodoWebhookEvent {
  let verified: unknown;
  try {
    verified = new Webhook(dodoConfig.webhookSecret).verify(rawBody, { ...headers });
  } catch (err) {
    // The underlying message distinguishes "no matching signature" from an
    // expired timestamp, which is worth keeping for diagnosis. It contains no
    // secret material — the secret is never echoed by the library.
    throw new DodoWebhookVerificationError(
      `Dodo webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!verified || typeof verified !== 'object' || typeof (verified as { type?: unknown }).type !== 'string') {
    throw new DodoWebhookVerificationError(
      'Dodo webhook payload verified but carries no event type.',
    );
  }

  return verified as DodoWebhookEvent;
}
