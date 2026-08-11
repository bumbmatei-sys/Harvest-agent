/**
 * Webhook signature verification — the lock on the money path's front door.
 *
 * An endpoint that accepts unsigned input is an unauthenticated write: once the
 * provisioning handlers land, anyone who can POST to the URL could claim a
 * payment succeeded and mint a tenant. These cases pin the rejections, so
 * deleting the verification call fails the suite by name rather than quietly
 * widening the door.
 *
 * Signatures are computed here rather than pasted from a captured request: a
 * fixed signature would carry a fixed timestamp and start failing the replay
 * window five minutes after it was recorded.
 */

import { describe, expect, it } from 'vitest';
import {
  DODO_WEBHOOK_TOLERANCE_SECONDS,
  DodoWebhookSignatureError,
  readDodoWebhookHeaders,
  signDodoWebhookPayload,
  verifyDodoWebhookSignature,
} from '../webhook-signature';

const SECRET = 'whsec_c2VjcmV0LWtleS1mb3ItdGVzdGluZw==';
const OTHER_SECRET = 'whsec_YW5vdGhlci1zZWNyZXQtZW50aXJlbHk=';
const PAYLOAD = JSON.stringify({
  type: 'subscription.active',
  data: { subscription_id: 'sub_123', product_id: 'pdt_max_monthly' },
});
const ID = 'msg_2abc';
const NOW_MS = 1_770_000_000_000;
const TS = Math.floor(NOW_MS / 1000);

function signedHeaders(overrides?: {
  secret?: string;
  id?: string;
  timestampSeconds?: number;
  payload?: string;
}) {
  const secret = overrides?.secret ?? SECRET;
  const id = overrides?.id ?? ID;
  const timestampSeconds = overrides?.timestampSeconds ?? TS;
  const payload = overrides?.payload ?? PAYLOAD;
  return {
    id,
    timestamp: String(timestampSeconds),
    signature: `v1,${signDodoWebhookPayload({ secret, id, timestampSeconds, payload })}`,
  };
}

describe('a correctly signed payload', () => {
  it('is accepted', () => {
    expect(() =>
      verifyDodoWebhookSignature({
        payload: PAYLOAD,
        headers: signedHeaders(),
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).not.toThrow();
  });

  it('is accepted when the header carries several versioned signatures (secret rotation)', () => {
    const good = signedHeaders().signature;
    expect(() =>
      verifyDodoWebhookSignature({
        payload: PAYLOAD,
        headers: { ...signedHeaders(), signature: `v1,bm90LXRoZS1yaWdodC1vbmU= ${good}` },
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).not.toThrow();
  });
});

describe('an UNSIGNED payload is rejected', () => {
  it.each([
    ['no headers at all', { id: null, timestamp: null, signature: null }],
    ['no signature header', { ...signedHeaders(), signature: null }],
    ['no id header', { ...signedHeaders(), id: null }],
    ['no timestamp header', { ...signedHeaders(), timestamp: null }],
    ['an empty signature header', { ...signedHeaders(), signature: '' }],
  ])('%s', (_label, headers) => {
    expect(() =>
      verifyDodoWebhookSignature({ payload: PAYLOAD, headers, secret: SECRET, nowMs: NOW_MS }),
    ).toThrow(DodoWebhookSignatureError);
  });
});

describe('a WRONGLY signed payload is rejected', () => {
  it('when the signature was made with a different secret', () => {
    expect(() =>
      verifyDodoWebhookSignature({
        payload: PAYLOAD,
        headers: signedHeaders({ secret: OTHER_SECRET }),
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toThrow(/no matching v1 signature/i);
  });

  it('when the body was altered after signing — the tampered-amount case', () => {
    const headers = signedHeaders();
    const tampered = PAYLOAD.replace('pdt_max_monthly', 'pdt_plus_monthly');
    expect(() =>
      verifyDodoWebhookSignature({ payload: tampered, headers, secret: SECRET, nowMs: NOW_MS }),
    ).toThrow(DodoWebhookSignatureError);
  });

  it('when the message id was swapped', () => {
    expect(() =>
      verifyDodoWebhookSignature({
        payload: PAYLOAD,
        headers: { ...signedHeaders(), id: 'msg_someone_elses' },
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toThrow(DodoWebhookSignatureError);
  });

  it('when the signature is well-formed base64 but simply wrong', () => {
    expect(() =>
      verifyDodoWebhookSignature({
        payload: PAYLOAD,
        headers: { ...signedHeaders(), signature: 'v1,YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=' },
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toThrow(DodoWebhookSignatureError);
  });

  it('when the only signature offered is of an unknown version', () => {
    // A future `v2` we do not understand is not a reason to trust the request.
    const v1 = signedHeaders().signature.slice('v1,'.length);
    expect(() =>
      verifyDodoWebhookSignature({
        payload: PAYLOAD,
        headers: { ...signedHeaders(), signature: `v2,${v1}` },
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toThrow(DodoWebhookSignatureError);
  });
});

describe('replay protection', () => {
  it('rejects a signature older than the tolerance', () => {
    expect(() =>
      verifyDodoWebhookSignature({
        payload: PAYLOAD,
        headers: signedHeaders({ timestampSeconds: TS - DODO_WEBHOOK_TOLERANCE_SECONDS - 1 }),
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toThrow(/too old/i);
  });

  it('rejects a timestamp from the future', () => {
    expect(() =>
      verifyDodoWebhookSignature({
        payload: PAYLOAD,
        headers: signedHeaders({ timestampSeconds: TS + DODO_WEBHOOK_TOLERANCE_SECONDS + 1 }),
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toThrow(/future/i);
  });

  it('rejects a non-numeric timestamp', () => {
    expect(() =>
      verifyDodoWebhookSignature({
        payload: PAYLOAD,
        headers: { ...signedHeaders(), timestamp: 'yesterday' },
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).toThrow(DodoWebhookSignatureError);
  });

  it('accepts one right at the edge of the window', () => {
    expect(() =>
      verifyDodoWebhookSignature({
        payload: PAYLOAD,
        headers: signedHeaders({ timestampSeconds: TS - DODO_WEBHOOK_TOLERANCE_SECONDS }),
        secret: SECRET,
        nowMs: NOW_MS,
      }),
    ).not.toThrow();
  });
});

describe('the Standard Webhooks scheme', () => {
  it('signs `id.timestamp.body` with HMAC-SHA256 over the base64-decoded secret', () => {
    // Pinned against an independently computed value, so a change to the signed
    // content or the digest encoding is caught rather than silently agreed with
    // by both sides of the test.
    expect(
      signDodoWebhookPayload({ secret: SECRET, id: 'msg_1', timestampSeconds: 1700000000, payload: '{"a":1}' }),
    ).toBe('89KGqHbw/tmldxtpztcTqpfJ3YBubYgo6hBcfSH0P6k=');
  });

  it('treats the secret identically with and without the whsec_ prefix', () => {
    const withPrefix = signDodoWebhookPayload({ secret: SECRET, id: ID, timestampSeconds: TS, payload: PAYLOAD });
    const without = signDodoWebhookPayload({
      secret: SECRET.slice('whsec_'.length),
      id: ID,
      timestampSeconds: TS,
      payload: PAYLOAD,
    });
    expect(withPrefix).toBe(without);
  });

  it('reads the three headers off a Fetch Headers object, case-insensitively', () => {
    const headers = new Headers({
      'Webhook-Id': ID,
      'WEBHOOK-TIMESTAMP': String(TS),
      'webhook-signature': 'v1,sig',
    });
    expect(readDodoWebhookHeaders(headers)).toEqual({
      id: ID,
      timestamp: String(TS),
      signature: 'v1,sig',
    });
  });
});
