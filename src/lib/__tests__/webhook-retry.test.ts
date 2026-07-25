import { describe, it, expect } from 'vitest';
import { isRetryableWebhookError, isValidFirestoreDocId } from '../webhook-retry';

/**
 * The classification decides whether a caught money-path failure becomes a 5xx
 * (Stripe redelivers the event) or stays a 200 (reported to Sentry, never retried).
 * Getting it wrong in one direction loses a commission; in the other it creates a
 * poison event that Stripe redelivers for three days while the side effects AFTER
 * the failing block are re-skipped on every attempt. Both directions are pinned.
 */

describe('isRetryableWebhookError — Firestore / gRPC', () => {
  it.each([
    ['CANCELLED', 1],
    ['UNKNOWN', 2],
    ['DEADLINE_EXCEEDED', 4],
    ['RESOURCE_EXHAUSTED', 8],
    ['ABORTED', 10],
    ['INTERNAL', 13],
    ['UNAVAILABLE', 14],
  ])('retries %s (%i)', (_name, code) => {
    expect(isRetryableWebhookError(Object.assign(new Error('boom'), { code }))).toBe(true);
  });

  it.each([
    ['INVALID_ARGUMENT', 3],
    ['NOT_FOUND', 5],
    ['ALREADY_EXISTS', 6],
    ['PERMISSION_DENIED', 7],
    ['FAILED_PRECONDITION', 9],
    ['OUT_OF_RANGE', 11],
    ['UNIMPLEMENTED', 12],
    ['DATA_LOSS', 15],
    ['UNAUTHENTICATED', 16],
  ])('does NOT retry %s (%i)', (_name, code) => {
    expect(isRetryableWebhookError(Object.assign(new Error('boom'), { code }))).toBe(false);
  });

  it('NOT_FOUND is the real case: batch.update() on a deleted referrer users doc', () => {
    const err = Object.assign(new Error('5 NOT_FOUND: no entity to update'), { code: 5 });
    expect(isRetryableWebhookError(err)).toBe(false);
  });
});

describe('isRetryableWebhookError — Stripe SDK', () => {
  const stripeErr = (type: string, statusCode?: number) =>
    Object.assign(new Error(type), { type, ...(statusCode ? { statusCode } : {}) });

  it.each(['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'])('retries %s', (type) => {
    expect(isRetryableWebhookError(stripeErr(type))).toBe(true);
  });

  it.each([
    'StripeInvalidRequestError',
    'StripeAuthenticationError',
    'StripePermissionError',
    'StripeIdempotencyError',
  ])('does NOT retry %s', (type) => {
    expect(isRetryableWebhookError(stripeErr(type))).toBe(false);
  });

  it('does not retry a 404 resource_missing (a canceled/deleted subscription)', () => {
    const err = Object.assign(new Error('No such subscription'), {
      type: 'StripeInvalidRequestError', statusCode: 404, code: 'resource_missing',
    });
    // Stripe's string `code` must never be read as a numeric gRPC status.
    expect(isRetryableWebhookError(err)).toBe(false);
  });

  it('retries a 5xx and a 429 from Stripe', () => {
    expect(isRetryableWebhookError(stripeErr('StripeAPIError', 503))).toBe(true);
    expect(isRetryableWebhookError(stripeErr('StripeRateLimitError', 429))).toBe(true);
  });

  it('does not retry an unlisted Stripe type carrying a 4xx', () => {
    expect(isRetryableWebhookError(stripeErr('StripeUnknownError', 400))).toBe(false);
  });
});

describe('isRetryableWebhookError — client-side validation and programmer errors', () => {
  it('does not retry Firestore argument validation', () => {
    expect(isRetryableWebhookError(new Error('Value for argument "documentPath" is not a valid resource path'))).toBe(false);
    expect(isRetryableWebhookError(new Error('Value for argument "data" is not a valid Firestore document. Cannot use "undefined" as a Firestore value'))).toBe(false);
  });

  it('does not retry native programmer errors', () => {
    expect(isRetryableWebhookError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isRetryableWebhookError(new RangeError('Invalid array length'))).toBe(false);
    expect(isRetryableWebhookError(new ReferenceError('x is not defined'))).toBe(false);
  });

  it("retries undici's TypeError: fetch failed — that one IS a network fault", () => {
    expect(isRetryableWebhookError(new TypeError('fetch failed'))).toBe(true);
  });
});

describe('isRetryableWebhookError — the default', () => {
  it('retries an unrecognised error: an infra blip is likelier than a data defect', () => {
    expect(isRetryableWebhookError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableWebhookError(new Error('simulated Firestore batch failure'))).toBe(true);
  });

  it('retries non-object throws rather than swallowing them', () => {
    expect(isRetryableWebhookError('boom')).toBe(true);
    expect(isRetryableWebhookError(null)).toBe(true);
    expect(isRetryableWebhookError(undefined)).toBe(true);
  });
});

describe('isValidFirestoreDocId', () => {
  it('accepts ordinary ids', () => {
    expect(isValidFirestoreDocId('refUser')).toBe(true);
    expect(isValidFirestoreDocId('aBc123_-.x')).toBe(true);
    expect(isValidFirestoreDocId('a'.repeat(1500))).toBe(true);
  });

  it('rejects what would throw synchronously inside .doc()', () => {
    expect(isValidFirestoreDocId('')).toBe(false);
    expect(isValidFirestoreDocId('users/refUser')).toBe(false);
    expect(isValidFirestoreDocId('.')).toBe(false);
    expect(isValidFirestoreDocId('..')).toBe(false);
    expect(isValidFirestoreDocId('__name__')).toBe(false);
    expect(isValidFirestoreDocId('a'.repeat(1501))).toBe(false);
    expect(isValidFirestoreDocId('é'.repeat(751))).toBe(false); // 1502 BYTES
    expect(isValidFirestoreDocId(undefined)).toBe(false);
    expect(isValidFirestoreDocId(42)).toBe(false);
  });
});
