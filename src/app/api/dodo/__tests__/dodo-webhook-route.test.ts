import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { Webhook } from 'standardwebhooks';

/**
 * The route's two response shapes.
 *
 * ⚠️ BEST-EFFORT events keep #290's shape: acknowledge 2xx BEFORE THE HANDLER
 * DOES ANY WORK. That is the opposite of the Stripe webhook, which does
 * everything it is going to do and then responds. Dodo's documentation is
 * explicit that a handler should acknowledge immediately; copying the Stripe
 * handler wholesale would produce an endpoint that works in testing and
 * generates duplicate retries under any real load.
 *
 * ⚠️ AMENDED BY THE-302, and narrowed rather than dropped. The claim used to be
 * "before doing any work" full stop, and the route proved it by never awaiting
 * the dispatcher at all. One step now happens first: the idempotency
 * RESERVATION. The reason is in the route's own docblock — a reservation that
 * fails is the difference between "already handled" and "not handled at all",
 * and a route that cannot tell them apart answers 200 to an event Dodo will
 * never send again. That was 24 dropped events in production.
 *
 * 🔴 So the fast-ack property MOVED, it did not disappear. It is now the
 * dispatcher's, pinned in `dodo-webhook-dispatch.test.ts` under `deferHandler`:
 * a handler that hangs forever must not delay the outcome. What is pinned HERE
 * is that this route asks for that deferral on every best-effort event and never
 * on the durable one, and that it turns each outcome into the right status code.
 * Replacing `{ deferHandler: true }` with `{}` would make the route wait on a
 * handler again, and the first test below is what catches it.
 *
 * 🔴 The DURABLE event is the deliberate exception, added by REP-4 PR 2. #290's
 * own module note said provisioning must not sit behind a fire-and-forget
 * handoff without a durable retry, because a dropped provisioning event is a
 * church that paid and has no account. So `subscription.active` — and nothing
 * else — is awaited, and a failure is answered 5xx so Dodo redelivers. The
 * fast-ack tests below therefore run against `payment.succeeded`; that is not a
 * weakening of the original assertion, it is the same assertion moved to the
 * events it still applies to.
 */

const OUR_SECRET = 'whsec_' + Buffer.from('harvest-dodo-route-secret').toString('base64');

process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
process.env.DODO_PAYMENTS_WEBHOOK_KEY = OUR_SECRET;
process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';

const { mockReceive } = vi.hoisted(() => ({ mockReceive: vi.fn() }));

// `isDurableDodoEventType` is NOT mocked: the route's branch has to be driven by
// the real table, or this file could pass while the two disagreed about which
// events are provisioning events.
vi.mock('@/lib/dodo/webhook-dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dodo/webhook-dispatch')>()),
  receiveDodoWebhookEvent: mockReceive,
}));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn() } }));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: vi.fn() }));

let POST: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/dodo/webhook/route'));
});

/** A BEST-EFFORT event: the route must not wait for it. */
const BODY = JSON.stringify({
  business_id: 'bus_test',
  type: 'payment.succeeded',
  timestamp: '2026-08-11T12:00:00Z',
  data: { payload_type: 'Payment', payment_id: 'pay_1' },
});

/** The DURABLE event: the route awaits it and 5xxs on failure. */
const DURABLE_BODY = JSON.stringify({
  business_id: 'bus_test',
  type: 'subscription.active',
  timestamp: '2026-08-11T12:00:00Z',
  data: { payload_type: 'Subscription', subscription_id: 'sub_1' },
});

function signedRequest(body = BODY, secret = OUR_SECRET, id = 'whk_route_1') {
  const at = new Date();
  return new NextRequest('https://theharvest.app/api/dodo/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-signature': new Webhook(secret).sign(id, at, body),
      'webhook-timestamp': String(Math.floor(at.getTime() / 1000)),
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReceive.mockResolvedValue({ outcome: 'routed', type: 'payment.succeeded', webhookId: 'whk_route_1' });
});

// ── Test 5 ───────────────────────────────────────────────────────────────────

describe('a best-effort event is acknowledged before the handler does any work', () => {
  it('asks the dispatcher to DEFER the handler — the fast ack, as a request', async () => {
    // 🔴 The whole fast-ack property in one assertion. `deferHandler` is what
    // makes the dispatcher return the moment the reservation settles, leaving
    // the handler running; dropping it puts the response back behind a handler
    // that can take as long as it likes.
    await POST(signedRequest(BODY, OUR_SECRET, 'whk_specific_id'));

    expect(mockReceive).toHaveBeenCalledWith(
      'whk_specific_id',
      expect.objectContaining({ type: 'payment.succeeded' }),
      { deferHandler: true },
    );
  });

  it('and does NOT defer it for the durable event', async () => {
    mockReceive.mockResolvedValue({ outcome: 'routed', type: 'subscription.active', webhookId: 'whk_d' });

    await POST(signedRequest(DURABLE_BODY, OUR_SECRET, 'whk_d'));

    // Provisioning is the one event the connection is held open for.
    expect(mockReceive).toHaveBeenCalledWith(
      'whk_d',
      expect.objectContaining({ type: 'subscription.active' }),
      {},
    );
  });

  it('answers 200 as soon as the reservation is settled, handler still running', async () => {
    const order: string[] = [];
    // What the real dispatcher does under `deferHandler`: settle on the
    // reservation, leave the handler to finish later.
    mockReceive.mockImplementation(() => {
      setTimeout(() => order.push('handler'), 50);
      return Promise.resolve({ outcome: 'routed', type: 'payment.succeeded', webhookId: 'whk_route_1' });
    });

    const res = await POST(signedRequest());
    order.push('responded');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(order).toEqual(['responded']);

    await new Promise((r) => setTimeout(r, 80));
    expect(order).toEqual(['responded', 'handler']);
  });

  it('answers 500 when the dispatcher rejects, which it is documented not to do', async () => {
    // ⚠️ REVERSED BY THE-302, deliberately. This used to answer 200 on the
    // reasoning that "a non-2xx would make Dodo retry an event we already
    // accepted" — but a rejected dispatch is precisely the case where we do NOT
    // know whether it was accepted, and the reservation makes guessing
    // unnecessary: if the claim WAS recorded, Dodo's redelivery is discarded as
    // a duplicate and costs one wasted request; if it was not, the redelivery is
    // the only thing that saves the event. Answering 200 to an unknown outcome
    // is the quiet lie the Silent-Failure Rule names.
    mockReceive.mockRejectedValue(new Error('dispatch blew up'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(signedRequest());

    expect(res.status).toBe(500);
    err.mockRestore();
  });
});

// ── The durable path: provisioning failure must come back ────────────────────

describe('the provisioning event is awaited, and its failure becomes a retry', () => {
  it('answers 500 when provisioning reports `failed`', async () => {
    // 5xx is the ONLY thing that makes Dodo redeliver. Answering 200 here would
    // be a church that paid and has no account, with nothing to bring the event
    // back — the exact failure #290's module note told this PR to prevent.
    mockReceive.mockResolvedValue({
      outcome: 'failed',
      type: 'subscription.active',
      webhookId: 'whk_durable_fail',
      error: new Error('firestore batch failed'),
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(signedRequest(DURABLE_BODY, OUR_SECRET, 'whk_durable_fail'));

    expect(res.status).toBe(500);
    err.mockRestore();
  });

  it('answers 200 when provisioning succeeds', async () => {
    mockReceive.mockResolvedValue({
      outcome: 'routed',
      type: 'subscription.active',
      webhookId: 'whk_durable_ok',
    });

    const res = await POST(signedRequest(DURABLE_BODY, OUR_SECRET, 'whk_durable_ok'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
  });

  it('answers 200 for a redelivery the dispatcher skipped as a duplicate', async () => {
    // A duplicate is a SUCCESS: the work already happened. Answering 5xx would
    // make Dodo retry forever against a guard designed to keep saying no.
    mockReceive.mockResolvedValue({
      outcome: 'duplicate',
      type: 'subscription.active',
      webhookId: 'whk_durable_dup',
    });

    const res = await POST(signedRequest(DURABLE_BODY, OUR_SECRET, 'whk_durable_dup'));

    expect(res.status).toBe(200);
  });

  it('actually WAITS for provisioning before responding', async () => {
    // The mirror image of the fast-ack assertion above. If the durable branch
    // were changed back to `void receive(...)`, the response would be recorded
    // before the work and this ordering assertion would fail.
    const order: string[] = [];
    mockReceive.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => {
        order.push('work');
        resolve({ outcome: 'routed', type: 'subscription.active', webhookId: 'whk_wait' });
      }, 30)),
    );

    const res = await POST(signedRequest(DURABLE_BODY, OUR_SECRET, 'whk_wait'));
    order.push('responded');

    expect(res.status).toBe(200);
    expect(order).toEqual(['work', 'responded']);
  });
});

// ── Test 3, at the route boundary ────────────────────────────────────────────

describe('the route rejects anything it cannot verify, without dispatching', () => {
  it('401s an unsigned request', async () => {
    const res = await POST(
      new NextRequest('https://theharvest.app/api/dodo/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: BODY,
      }),
    );

    expect(res.status).toBe(401);
    expect(mockReceive).not.toHaveBeenCalled();
  });

  it('401s a wrongly-signed request', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const at = new Date();
    const res = await POST(
      new NextRequest('https://theharvest.app/api/dodo/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'webhook-id': 'whk_bad',
          'webhook-signature': new Webhook(OUR_SECRET).sign('whk_bad', at, 'a different body'),
          'webhook-timestamp': String(Math.floor(at.getTime() / 1000)),
        },
        body: BODY,
      }),
    );

    expect(res.status).toBe(401);
    expect(mockReceive).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('401s a request signed with the wrong secret', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const other = 'whsec_' + Buffer.from('not-our-secret').toString('base64');

    const res = await POST(signedRequest(BODY, other, 'whk_wrong_secret'));

    expect(res.status).toBe(401);
    expect(mockReceive).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('the route reads the RAW body', () => {
  it('verifies bytes that a JSON round trip would not reproduce', async () => {
    // If the route parsed the body and re-stringified it before verifying, this
    // payload's signature would fail. It passes, which is the proof that
    // request.text() reaches the verifier untouched.
    const rawWithOddSpacing = '{"type":"payment.succeeded",  "business_id":"bus_x","data":{"payload_type":"Payment"}}';
    expect(JSON.stringify(JSON.parse(rawWithOddSpacing))).not.toBe(rawWithOddSpacing);

    const res = await POST(signedRequest(rawWithOddSpacing, OUR_SECRET, 'whk_raw'));

    expect(res.status).toBe(200);
    expect(mockReceive).toHaveBeenCalledWith(
      'whk_raw',
      expect.objectContaining({ type: 'payment.succeeded' }),
      { deferHandler: true },
    );
  });
});
