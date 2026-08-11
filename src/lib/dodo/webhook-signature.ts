/**
 * Dodo webhook signature verification.
 *
 * ⚠️ THE FIRST THING THE ENDPOINT DOES, FROM THE FIRST COMMIT. An unverified
 * webhook is an unauthenticated write to the money path: anyone who can POST to
 * the URL could claim a payment succeeded. Verification is not a hardening step
 * to add once handlers exist — the handlers are what make it exploitable, so it
 * lands first.
 *
 * SCHEME. Dodo implements Standard Webhooks (its own SDK delegates to the
 * `standardwebhooks` package), so this is the Standard Webhooks algorithm:
 *
 *   headers   webhook-id, webhook-timestamp, webhook-signature
 *   key       base64-decode(secret, after stripping the `whsec_` prefix)
 *   content   `${webhook-id}.${webhook-timestamp}.${raw body}`
 *   signature base64(HMAC-SHA256(key, content))
 *   header    space-separated list of `<version>,<signature>`; `v1` is ours
 *   replay    reject a timestamp more than 5 minutes from now, either direction
 *
 * Implemented here in ~60 lines against `node:crypto` rather than by adding a
 * dependency: the algorithm is small, fully specified, and pinned by the tests
 * beside this file, and a money-path verifier is the last place to want a
 * transitive supply chain.
 *
 * ⚠️ THE RAW BODY IS REQUIRED. Signatures cover the exact bytes Dodo sent.
 * `JSON.parse` followed by `JSON.stringify` reorders and reformats, and the
 * signature will never match again. Callers must pass `await request.text()`.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/** Standard Webhooks' replay window: 5 minutes either side of now. */
export const DODO_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

const SECRET_PREFIX = 'whsec_';
const SIGNATURE_VERSION = 'v1';

/**
 * Thrown for every rejection — missing headers, bad timestamp, no matching
 * signature. One error type because the endpoint must answer all of them
 * identically: telling a caller *which* part of their forgery failed is free
 * help for the next attempt.
 */
export class DodoWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DodoWebhookSignatureError';
  }
}

/** The three signature headers, however the caller obtained them. */
export interface DodoWebhookHeaders {
  /** `webhook-id` */
  id: string | null | undefined;
  /** `webhook-timestamp`, seconds since the epoch, as sent. */
  timestamp: string | null | undefined;
  /** `webhook-signature`, e.g. `v1,<base64> v1,<base64>`. */
  signature: string | null | undefined;
}

/** Pull the three signature headers off a Fetch `Headers` object. */
export function readDodoWebhookHeaders(headers: Headers): DodoWebhookHeaders {
  return {
    id: headers.get('webhook-id'),
    timestamp: headers.get('webhook-timestamp'),
    signature: headers.get('webhook-signature'),
  };
}

function decodeSecret(secret: string): Buffer {
  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  const key = Buffer.from(raw, 'base64');
  if (key.length === 0) {
    throw new DodoWebhookSignatureError('Webhook secret is empty or not valid base64');
  }
  return key;
}

/** Constant-time compare of two base64 signature strings. */
function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a leak-free
  // "no match" — a forged signature of the wrong length simply cannot be equal.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Compute the `v1` signature for a payload. Exported so the tests can sign a
 * body the same way Dodo does instead of pasting a captured signature that would
 * expire against the replay window.
 */
export function signDodoWebhookPayload(opts: {
  secret: string;
  id: string;
  timestampSeconds: number;
  payload: string;
}): string {
  const key = decodeSecret(opts.secret);
  const content = `${opts.id}.${opts.timestampSeconds}.${opts.payload}`;
  return createHmac('sha256', key).update(content, 'utf8').digest('base64');
}

/**
 * Verify an inbound Dodo webhook, or throw `DodoWebhookSignatureError`.
 *
 * Returns nothing on success, deliberately: a boolean return can be ignored at a
 * call site and an ignored `false` is an unauthenticated write. The caller must
 * catch to reject.
 */
export function verifyDodoWebhookSignature(opts: {
  /** The raw request body, byte for byte as received. */
  payload: string;
  headers: DodoWebhookHeaders;
  secret: string;
  /** Injectable clock for tests. Defaults to now. */
  nowMs?: number;
}): void {
  const { payload, headers, secret } = opts;

  if (!headers.id || !headers.timestamp || !headers.signature) {
    throw new DodoWebhookSignatureError(
      'Missing webhook-id, webhook-timestamp or webhook-signature header',
    );
  }

  const timestampSeconds = Number.parseInt(headers.timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) {
    throw new DodoWebhookSignatureError('webhook-timestamp is not an integer');
  }

  const nowSeconds = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const drift = nowSeconds - timestampSeconds;
  if (drift > DODO_WEBHOOK_TOLERANCE_SECONDS) {
    throw new DodoWebhookSignatureError('webhook-timestamp is too old (replay window exceeded)');
  }
  if (drift < -DODO_WEBHOOK_TOLERANCE_SECONDS) {
    throw new DodoWebhookSignatureError('webhook-timestamp is too far in the future');
  }

  const expected = signDodoWebhookPayload({
    secret,
    id: headers.id,
    timestampSeconds,
    payload,
  });

  // The header may carry several versioned signatures during a secret rotation.
  // Every `v1` entry is compared; anything else is ignored rather than trusted.
  for (const entry of headers.signature.split(' ')) {
    const separator = entry.indexOf(',');
    if (separator === -1) continue;
    const version = entry.slice(0, separator);
    const candidate = entry.slice(separator + 1);
    if (version !== SIGNATURE_VERSION) continue;
    if (signaturesMatch(candidate, expected)) return;
  }

  throw new DodoWebhookSignatureError('No matching v1 signature');
}
