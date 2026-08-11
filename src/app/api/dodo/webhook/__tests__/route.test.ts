/**
 * The Dodo webhook ENDPOINT rejects unsigned and wrongly-signed requests.
 *
 * `webhook-signature.test.ts` pins the algorithm; this pins that the route
 * actually calls it. Deleting the verification block would leave that suite
 * green and this one red, which is the point — a verifier nobody invokes is not
 * a lock.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signDodoWebhookPayload } from '@/lib/dodo/webhook-signature';
import { POST } from '../route';

const SECRET = 'whsec_c2VjcmV0LWtleS1mb3ItdGVzdGluZw==';
const EVENT = JSON.stringify({ type: 'subscription.active', data: { subscription_id: 'sub_1' } });

const ORIGINAL_SECRET = process.env.DODO_WEBHOOK_SECRET;

function post(body: string, headers: Record<string, string>) {
  return new NextRequest('https://theharvest.app/api/dodo/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

function signedNow(payload: string, secret = SECRET) {
  const id = 'msg_route';
  const timestampSeconds = Math.floor(Date.now() / 1000);
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestampSeconds),
    'webhook-signature': `v1,${signDodoWebhookPayload({ secret, id, timestampSeconds, payload })}`,
  };
}

beforeEach(() => {
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.DODO_WEBHOOK_SECRET;
  else process.env.DODO_WEBHOOK_SECRET = ORIGINAL_SECRET;
  vi.restoreAllMocks();
});

describe('POST /api/dodo/webhook', () => {
  it('rejects an UNSIGNED payload with 400', async () => {
    const res = await POST(post(EVENT, { 'content-type': 'application/json' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid signature' });
  });

  it('rejects a WRONGLY signed payload with 400', async () => {
    const headers = signedNow(EVENT, 'whsec_YW5vdGhlci1zZWNyZXQtZW50aXJlbHk=');
    const res = await POST(post(EVENT, headers));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid signature' });
  });

  it('rejects a payload altered after signing with 400', async () => {
    const headers = signedNow(EVENT);
    const res = await POST(post(EVENT.replace('sub_1', 'sub_999'), headers));
    expect(res.status).toBe(400);
  });

  it('accepts a correctly signed payload', async () => {
    const res = await POST(post(EVENT, signedNow(EVENT)));
    expect(res.status).toBe(200);
    // `handled: false` is the honest answer while there are no handlers: the
    // event was authenticated and deliberately not acted on.
    await expect(res.json()).resolves.toEqual({ received: true, handled: false });
  });

  it('refuses to process anything when the signing secret is not configured', async () => {
    delete process.env.DODO_WEBHOOK_SECRET;
    const res = await POST(post(EVENT, signedNow(EVENT)));
    // 500, never a 200 — an endpoint that cannot verify must not pretend it did.
    expect(res.status).toBe(500);
  });

  it('does not write anything — there are no handlers in this PR', () => {
    // The route's only imports are the signature helpers and the env reader; it
    // has no database client to write with. If a handler ever lands here without
    // its own PR, this assertion is where that shows up.
    const source = readFileSync(path.resolve(__dirname, '../route.ts'), 'utf8');
    expect(source).not.toMatch(/adminDb|firebase-admin|setCustomClaims/);
  });
});
