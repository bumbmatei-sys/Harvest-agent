import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { Webhook } from 'standardwebhooks';

/**
 * Test 5 — the handler returns 2xx BEFORE doing any work.
 *
 * ⚠️ This is the opposite of the Stripe webhook's shape, which does everything it
 * is going to do and then responds. Dodo's documentation is explicit that a
 * handler must acknowledge immediately and process asynchronously; anything else
 * is treated as a failure and retried. Copying the Stripe handler here would
 * produce an endpoint that works in testing and generates duplicate retries under
 * any real load.
 *
 * "Before doing any work" is asserted as a property, not as call ordering:
 * dispatch is invoked from inside the handler, so merely observing that it was
 * called proves nothing. What must be true is that THE RESPONSE DOES NOT WAIT FOR
 * IT. So the dispatcher below is made to hang forever, and the route still has to
 * answer 200. Replacing `void receive(...)` with `await receive(...)` makes that
 * test hang and fail, which is exactly the regression worth catching.
 */

const OUR_SECRET = 'whsec_' + Buffer.from('harvest-dodo-route-secret').toString('base64');

process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
process.env.DODO_PAYMENTS_WEBHOOK_KEY = OUR_SECRET;
process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';

const { mockReceive } = vi.hoisted(() => ({ mockReceive: vi.fn() }));

vi.mock('@/lib/dodo/webhook-dispatch', () => ({ receiveDodoWebhookEvent: mockReceive }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn() } }));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: vi.fn() }));

let POST: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/dodo/webhook/route'));
});

const BODY = JSON.stringify({
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
  mockReceive.mockResolvedValue({ outcome: 'routed', type: 'subscription.active', webhookId: 'whk_route_1' });
});

// ── Test 5 ───────────────────────────────────────────────────────────────────

describe('the handler returns 2xx before doing any work', () => {
  it('answers 200 while the dispatcher is still running', async () => {
    // A dispatcher that never settles. If the route awaited it, this test would
    // never finish.
    let release!: () => void;
    mockReceive.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));

    const res = await POST(signedRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });

    release();
  });

  it('answers 200 before a slow dispatcher completes', async () => {
    const order: string[] = [];
    mockReceive.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => { order.push('work'); resolve(undefined); }, 50)),
    );

    const res = await POST(signedRequest());
    order.push('responded');

    expect(res.status).toBe(200);
    // The response is recorded first. On the Stripe handler's shape it would be
    // second, every time.
    expect(order).toEqual(['responded']);

    await new Promise((r) => setTimeout(r, 80));
    expect(order).toEqual(['responded', 'work']);
  });

  it('still answers 200 when the dispatcher rejects', async () => {
    // A non-2xx would make Dodo retry an event we already accepted. Failure on
    // our side must not become a redelivery loop.
    mockReceive.mockRejectedValue(new Error('dispatch blew up'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(signedRequest());

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    err.mockRestore();
  });

  it('hands the dispatcher the webhook-id from the header, for idempotency', async () => {
    await POST(signedRequest(BODY, OUR_SECRET, 'whk_specific_id'));

    expect(mockReceive).toHaveBeenCalledWith(
      'whk_specific_id',
      expect.objectContaining({ type: 'subscription.active' }),
    );
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
    );
  });
});
