/**
 * Retryable-vs-terminal classification for caught failures on the Stripe webhook
 * money path.
 *
 * WHY THIS EXISTS. Returning a non-2xx from the webhook is how a lost money event
 * gets a second chance: Stripe redelivers, and (because the failure path also
 * deletes the `webhook_events/{event.id}` marker) the redelivery re-processes
 * instead of being skipped as a duplicate. That is the right answer for a
 * TRANSIENT failure — a Firestore `UNAVAILABLE`, a Stripe connection reset — where
 * the next attempt has a real chance of succeeding.
 *
 * It is the WRONG answer for a PERMANENT one. A malformed document id, a missing
 * referrer user doc, a `resource_missing` from Stripe: those fail identically on
 * every attempt. Blanket-500ing them turns the event into a poison pill that
 * Stripe redelivers for three days, and — because the handler returns early — each
 * of those attempts also re-skips everything AFTER the failing block (the campaign
 * credit, the renewal donation receipt), which would otherwise have been recorded
 * on the very first delivery at 200. A permanent failure is strictly better off
 * reported to Sentry and left at 200.
 *
 * DEFAULT: retryable. An unrecognised error is far more likely to be an infra
 * blip than a data defect, and the cost of being wrong in that direction is
 * bounded (Stripe gives up after its retry window) while the cost of being wrong
 * the other way is a silently lost commission — the exact bug this classification
 * exists to close. Every terminal case below is therefore a POSITIVE match.
 */

/**
 * gRPC status codes that a Firestore Admin call will keep returning no matter how
 * many times it is retried. Everything not listed — CANCELLED(1), UNKNOWN(2),
 * DEADLINE_EXCEEDED(4), RESOURCE_EXHAUSTED(8), ABORTED(10), INTERNAL(13),
 * UNAVAILABLE(14) — is transient and falls through to the retryable default.
 */
const PERMANENT_GRPC_CODES = new Set([
  3,  // INVALID_ARGUMENT   — bad field value / bad path
  5,  // NOT_FOUND          — batch.update() on a document that does not exist
  6,  // ALREADY_EXISTS
  7,  // PERMISSION_DENIED  — service-account / rules problem
  9,  // FAILED_PRECONDITION— e.g. a query needing a composite index that is absent
  11, // OUT_OF_RANGE
  12, // UNIMPLEMENTED
  15, // DATA_LOSS
  16, // UNAUTHENTICATED    — bad credentials
]);

/**
 * Stripe SDK error types that describe the REQUEST rather than the connection.
 * Replaying the identical request produces the identical error.
 * `StripeConnectionError` / `StripeAPIError` / `StripeRateLimitError` are absent
 * on purpose: those are transient and take the retryable default.
 */
const PERMANENT_STRIPE_TYPES = new Set([
  'StripeInvalidRequestError',
  'StripeAuthenticationError',
  'StripePermissionError',
  'StripeIdempotencyError',
  'StripeSignatureVerificationError',
]);

/**
 * Client-side argument validation from @google-cloud/firestore. These are thrown
 * SYNCHRONOUSLY, as a plain `Error` with no `code`, before anything leaves the
 * process — `doc('a/b')`, `set({ x: undefined })`, `where('f', '==', undefined)`.
 * They are pure data defects and can never succeed on a retry.
 *
 * Matching on message text is brittle by nature, so it is defence in depth rather
 * than the primary guard: the likeliest source of one on this path (a malformed
 * `referrerId` arriving in subscription metadata) is rejected by
 * `isValidFirestoreDocId` at the call site, before Firestore is ever handed it.
 */
const FIRESTORE_VALIDATION_MESSAGES = [
  /^Value for argument /,
  /Cannot use "undefined" as a Firestore value/,
  /not a valid resource path/,
];

export function isRetryableWebhookError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return true;
  const e = err as { type?: unknown; code?: unknown; statusCode?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';

  // ── Stripe SDK ──────────────────────────────────────────────────────────────
  // Checked before `code` because Stripe errors carry a STRING `code`
  // ('resource_missing'), which must not be confused with a numeric gRPC status.
  if (typeof e.type === 'string' && e.type.startsWith('Stripe')) {
    if (PERMANENT_STRIPE_TYPES.has(e.type)) return false;
    const status = typeof e.statusCode === 'number' ? e.statusCode : undefined;
    // 4xx is us; 5xx is them; 429 is a rate limit that clears on its own.
    if (status !== undefined && status >= 400 && status < 500 && status !== 429) return false;
    return true;
  }

  // ── Firestore / google-gax: numeric gRPC status ─────────────────────────────
  if (typeof e.code === 'number') return !PERMANENT_GRPC_CODES.has(e.code);

  // ── Firestore client-side argument validation ───────────────────────────────
  if (FIRESTORE_VALIDATION_MESSAGES.some((re) => re.test(message))) return false;

  // ── Native programmer errors ────────────────────────────────────────────────
  // A TypeError reading a property of undefined will throw identically forever.
  // The one exception is undici's `TypeError: fetch failed`, which is how Node
  // surfaces a DNS/connection failure at the raw fetch layer — genuinely transient.
  if (err instanceof TypeError && /fetch failed/i.test(message)) return true;
  if (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError
  ) {
    return false;
  }

  return true;
}

/**
 * Whether `id` is usable as a single-segment Firestore document id.
 *
 * `adminDb.collection(c).doc(id)` throws SYNCHRONOUSLY on a malformed id, and ids
 * that arrive in Stripe subscription metadata are only as well-formed as whatever
 * wrote them. Checking first turns a would-be poison event into a reported,
 * terminal no-op.
 *
 * Rules per Firestore: non-empty, at most 1500 BYTES, no '/', not '.' or '..',
 * and not of the reserved `__…__` form.
 */
export function isValidFirestoreDocId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0) return false;
  if (id.includes('/')) return false;
  if (id === '.' || id === '..') return false;
  if (/^__.*__$/.test(id)) return false;
  return new TextEncoder().encode(id).length <= 1500;
}
