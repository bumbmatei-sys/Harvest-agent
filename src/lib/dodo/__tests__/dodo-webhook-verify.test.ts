import { describe, it, expect, beforeAll } from 'vitest';
import { Webhook } from 'standardwebhooks';

/**
 * Test 3 — signature verification, against the RAW body.
 *
 * Three rejections are required and each fails differently:
 *
 *  • UNSIGNED — no headers at all. Anyone who finds the URL can POST.
 *  • WRONGLY SIGNED — headers present, signature does not match the body. This is
 *    the tampered-payload case: the shape is right, the content was changed.
 *  • WRONG SECRET — a correctly-constructed signature from a key that is not
 *    ours. This is the one a naive "did they send a v1,... header?" check passes.
 *
 * Plus the case that motivates all of it: verification is over the EXACT BYTES.
 * `JSON.parse` then `JSON.stringify` produces a payload that is semantically
 * identical and byte-different, and it must fail.
 */

const OUR_SECRET = 'whsec_' + Buffer.from('harvest-dodo-test-secret').toString('base64');
const SOMEONE_ELSES_SECRET = 'whsec_' + Buffer.from('a-different-secret-entirely').toString('base64');

// The config module throws at import if these are absent, and it is imported
// transitively by webhook-verify. Set before the dynamic import below.
process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
process.env.DODO_PAYMENTS_WEBHOOK_KEY = OUR_SECRET;
process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';

type VerifyModule = typeof import('../webhook-verify');
let mod: VerifyModule;

beforeAll(async () => {
  mod = await import('../webhook-verify');
});

const RAW_BODY = JSON.stringify({
  business_id: 'bus_test',
  type: 'subscription.active',
  timestamp: '2026-08-11T12:00:00Z',
  data: { payload_type: 'Subscription', subscription_id: 'sub_1', status: 'active' },
});

/** Sign `body` the way Dodo does: Standard Webhooks, over the raw bytes. */
function sign(body: string, secret: string, id = 'whk_test_1', at = new Date()) {
  return {
    'webhook-id': id,
    'webhook-signature': new Webhook(secret).sign(id, at, body),
    'webhook-timestamp': String(Math.floor(at.getTime() / 1000)),
  };
}

describe('a correctly signed payload verifies', () => {
  it('returns the parsed event', () => {
    const event = mod.verifyDodoWebhook(RAW_BODY, sign(RAW_BODY, OUR_SECRET));
    expect(event.type).toBe('subscription.active');
    expect(event.data?.payload_type).toBe('Subscription');
  });
});

describe('verification rejects', () => {
  it('an UNSIGNED payload — no signature headers at all', () => {
    expect(
      mod.readDodoWebhookHeaders(new Headers({ 'content-type': 'application/json' })),
    ).toBeNull();

    // And if the headers are somehow fabricated as empty strings, the library
    // still refuses rather than treating absent as valid.
    expect(() =>
      mod.verifyDodoWebhook(RAW_BODY, {
        'webhook-id': '',
        'webhook-signature': '',
        'webhook-timestamp': '',
      }),
    ).toThrow(mod.DodoWebhookVerificationError);
  });

  it('a WRONGLY SIGNED payload — signature does not match the body', () => {
    // Signed correctly, then the body was tampered with in flight.
    const headers = sign(RAW_BODY, OUR_SECRET);
    const tampered = JSON.stringify({
      ...JSON.parse(RAW_BODY),
      data: { payload_type: 'Subscription', subscription_id: 'sub_ATTACKER', status: 'active' },
    });

    expect(() => mod.verifyDodoWebhook(tampered, headers)).toThrow(
      mod.DodoWebhookVerificationError,
    );
  });

  it('a payload signed with the WRONG SECRET', () => {
    // Structurally perfect — right algorithm, right header format, current
    // timestamp. Only the key is wrong. This is the case a format check passes.
    const headers = sign(RAW_BODY, SOMEONE_ELSES_SECRET);
    expect(headers['webhook-signature']).toMatch(/^v1,/);

    expect(() => mod.verifyDodoWebhook(RAW_BODY, headers)).toThrow(
      mod.DodoWebhookVerificationError,
    );
  });

  it('a replayed payload whose timestamp has gone stale', () => {
    const old = new Date(Date.now() - 10 * 60 * 1000); // 10 min; tolerance is 5
    expect(() => mod.verifyDodoWebhook(RAW_BODY, sign(RAW_BODY, OUR_SECRET, 'whk_old', old))).toThrow(
      mod.DodoWebhookVerificationError,
    );
  });
});

describe('verification is over the RAW body, not a re-serialised one', () => {
  it('fails when the payload is parsed and re-stringified', () => {
    const headers = sign(RAW_BODY, OUR_SECRET);

    // Semantically identical. Byte-different, because JSON.stringify does not
    // reproduce the original key order, spacing or escaping. This is the single
    // most common way a webhook integration is broken, and it is why the route
    // reads request.text() before anything can touch the body.
    const reserialised = JSON.stringify(JSON.parse(RAW_BODY), null, 2);
    expect(reserialised).not.toBe(RAW_BODY);
    expect(JSON.parse(reserialised)).toEqual(JSON.parse(RAW_BODY));

    expect(() => mod.verifyDodoWebhook(reserialised, headers)).toThrow(
      mod.DodoWebhookVerificationError,
    );
  });

  it('accepts a body whose key order would not survive a round trip', () => {
    // Proves the point positively: bytes Dodo could plausibly send, that
    // JSON.stringify would never produce, verify fine when passed through raw.
    const oddlyOrdered = '{"type":"payment.succeeded","business_id":"bus_x","data":{"payload_type":"Payment"}}';
    const event = mod.verifyDodoWebhook(oddlyOrdered, sign(oddlyOrdered, OUR_SECRET, 'whk_2'));
    expect(event.type).toBe('payment.succeeded');
  });
});

describe('readDodoWebhookHeaders', () => {
  it('reads all three Standard Webhooks headers', () => {
    const headers = mod.readDodoWebhookHeaders(
      new Headers({
        'webhook-id': 'whk_1',
        'webhook-signature': 'v1,abc',
        'webhook-timestamp': '1770000000',
      }),
    );
    expect(headers).toEqual({
      'webhook-id': 'whk_1',
      'webhook-signature': 'v1,abc',
      'webhook-timestamp': '1770000000',
    });
  });

  it.each(['webhook-id', 'webhook-signature', 'webhook-timestamp'])(
    'returns null when %s is missing',
    (missing) => {
      const all: Record<string, string> = {
        'webhook-id': 'whk_1',
        'webhook-signature': 'v1,abc',
        'webhook-timestamp': '1770000000',
      };
      delete all[missing];
      expect(mod.readDodoWebhookHeaders(new Headers(all))).toBeNull();
    },
  );
});
