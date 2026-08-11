/**
 * The seam holds: `BillingProvider` is satisfiable by a SECOND implementation.
 *
 * A "provider-agnostic" interface that only one vendor has ever implemented is a
 * rename of that vendor's SDK. The stub below is written against the interface
 * alone — no Dodo, no HTTP, no env — and the same assertions run against it and
 * against the real Dodo provider (driven by a fake `fetch`). Anything that leaks
 * a processor concept into the interface makes the stub impossible to write
 * without importing that processor, and this file stops compiling.
 *
 * It also pins the translations that make the seam worth having: Dodo's
 * `on_hold` becoming the canonical `past_due`, and an unrecognised status
 * throwing rather than being guessed into an entitlement.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  BillingProviderError,
  type BillingProvider,
  type BillingSubscription,
  type CancelSubscriptionOptions,
  type CreateSubscriptionCheckoutInput,
  type PlanRef,
  type SubscriptionCheckout,
} from '@/lib/billing-provider';
import { createDodoBillingProvider, type DodoProviderConfig } from '../provider';

/* ── Implementation #2: an in-memory stub, written against the interface only ── */

const STUB_PLANS: Record<string, PlanRef> = {
  'stub_plus_m': { plan: 'plus', interval: 'monthly' },
  'stub_max_y': { plan: 'max', interval: 'yearly' },
};

function createStubBillingProvider(): BillingProvider {
  const subscriptions = new Map<string, BillingSubscription>();
  let counter = 0;

  return {
    id: 'stub',

    async createSubscriptionCheckout(
      input: CreateSubscriptionCheckoutInput,
    ): Promise<SubscriptionCheckout> {
      const id = `stub_sub_${++counter}`;
      subscriptions.set(id, {
        id,
        status: 'active',
        plan: { plan: input.plan, interval: input.interval },
        productRef: `stub_${input.plan}_${input.interval}`,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: '2026-09-11T00:00:00.000Z',
        trialPeriodDays: input.trialDays ?? 14,
        trialEndsAt: '2026-08-25T00:00:00.000Z',
        customerEmail: input.customer.email,
        metadata: input.metadata ?? {},
      });
      return { url: `https://stub.example/checkout/${id}`, sessionId: `stub_sess_${counter}` };
    },

    async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
      const sub = subscriptions.get(subscriptionId);
      // No default: an unreadable subscription must not look like a cancelled one.
      if (!sub) throw new BillingProviderError('stub', 'getSubscription', 'No such subscription');
      return sub;
    },

    async cancelSubscription(
      subscriptionId: string,
      options?: CancelSubscriptionOptions,
    ): Promise<BillingSubscription> {
      const sub = await this.getSubscription(subscriptionId);
      const atPeriodEnd = options?.atPeriodEnd ?? true;
      const updated: BillingSubscription = atPeriodEnd
        ? { ...sub, cancelAtPeriodEnd: true }
        : { ...sub, status: 'canceled', cancelAtPeriodEnd: false };
      subscriptions.set(subscriptionId, updated);
      return updated;
    },

    resolvePlan(productRef: string): PlanRef | null {
      return STUB_PLANS[productRef] ?? null;
    },
  };
}

/* ── Implementation #1: the real Dodo provider, over a fake fetch ─────────── */

const DODO_SUB = {
  subscription_id: 'sub_dodo_1',
  status: 'active',
  product_id: 'pdt_max_yearly',
  cancel_at_next_billing_date: false,
  next_billing_date: '2027-08-11T00:00:00Z',
  created_at: '2026-08-11T00:00:00Z',
  trial_period_days: 14,
  customer: { email: 'admin@grace.example' },
  metadata: { tenantId: 'grace', userId: 'u1' },
};

function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status = 200, body } = handler(String(input), init ?? {});
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

function dodoProvider(fetchImpl: typeof fetch): BillingProvider {
  const config: DodoProviderConfig = {
    apiBaseUrl: 'https://test.dodopayments.com',
    apiKey: 'dodo_test_key',
    productId: (plan, interval) => `pdt_${plan}_${interval}`,
    resolvePlan: (id) =>
      id === 'pdt_max_yearly' ? { plan: 'max', interval: 'yearly' } : null,
    fetchImpl,
  };
  return createDodoBillingProvider(config);
}

/* ── The shared contract, run against both ───────────────────────────────── */

const IMPLEMENTATIONS: Array<[string, () => BillingProvider]> = [
  ['stub', createStubBillingProvider],
  [
    'dodo',
    () =>
      dodoProvider(
        fakeFetch((url) => {
          if (url.endsWith('/checkouts')) {
            return { body: { session_id: 'sess_1', checkout_url: 'https://checkout.dodo/sess_1' } };
          }
          if (url.includes('/subscriptions/')) return { body: DODO_SUB };
          return { status: 404, body: { error: 'unexpected' } };
        }),
      ),
  ],
];

describe.each(IMPLEMENTATIONS)('BillingProvider contract — %s', (_name, make) => {
  it('creates a checkout a buyer can be redirected to', async () => {
    const checkout = await make().createSubscriptionCheckout({
      plan: 'max',
      interval: 'yearly',
      customer: { email: 'admin@grace.example', name: 'Grace Church' },
      returnUrl: 'https://theharvest.app/?dodo=success',
      metadata: { tenantId: 'grace' },
    });
    expect(checkout.url).toMatch(/^https:\/\//);
    expect(checkout.sessionId).toBeTruthy();
  });

  it('reads a subscription back in canonical shape', async () => {
    const provider = make();
    const created = await provider.createSubscriptionCheckout({
      plan: 'max',
      interval: 'yearly',
      customer: { email: 'admin@grace.example' },
      returnUrl: 'https://theharvest.app/',
    });
    const id = provider.id === 'stub' ? created.url.split('/').pop()! : 'sub_dodo_1';

    const sub = await provider.getSubscription(id);
    expect(sub.status).toBe('active');
    expect(sub.plan).toEqual({ plan: 'max', interval: 'yearly' });
    expect(sub.trialPeriodDays).toBe(14);
    expect(sub.customerEmail).toBe('admin@grace.example');
  });

  it('resolves a plan from a product reference, and null for an unknown one', () => {
    const provider = make();
    expect(provider.resolvePlan('definitely-not-ours')).toBeNull();
  });
});

describe('the stub proves the seam without knowing a processor exists', () => {
  it('cancels at period end by default — downgrade, never lock out', async () => {
    const provider = createStubBillingProvider();
    const { url } = await provider.createSubscriptionCheckout({
      plan: 'plus',
      interval: 'monthly',
      customer: { email: 'a@b.example' },
      returnUrl: 'https://theharvest.app/',
    });
    const id = url.split('/').pop()!;

    const cancelled = await provider.cancelSubscription(id);
    expect(cancelled.cancelAtPeriodEnd).toBe(true);
    expect(cancelled.status).toBe('active');

    const now = await provider.cancelSubscription(id, { atPeriodEnd: false });
    expect(now.status).toBe('canceled');
  });

  it('throws rather than inventing a subscription it does not have', async () => {
    await expect(createStubBillingProvider().getSubscription('nope')).rejects.toBeInstanceOf(
      BillingProviderError,
    );
  });
});

describe('the Dodo implementation translates rather than leaks', () => {
  it('maps Dodo on_hold to the canonical past_due', async () => {
    const provider = dodoProvider(
      fakeFetch(() => ({ body: { ...DODO_SUB, status: 'on_hold' } })),
    );
    expect((await provider.getSubscription('sub_dodo_1')).status).toBe('past_due');
  });

  it('maps Dodo cancelled to canceled', async () => {
    const provider = dodoProvider(
      fakeFetch(() => ({ body: { ...DODO_SUB, status: 'cancelled' } })),
    );
    expect((await provider.getSubscription('sub_dodo_1')).status).toBe('canceled');
  });

  it('REFUSES to guess an entitlement from a status it does not know', async () => {
    // Neither 'active' nor 'canceled' is a safe default: one grants access
    // nobody paid for, the other takes a paying church's account away.
    const provider = dodoProvider(
      fakeFetch(() => ({ body: { ...DODO_SUB, status: 'paused_by_dodo' } })),
    );
    await expect(provider.getSubscription('sub_dodo_1')).rejects.toThrow(/unrecognised subscription status/i);
  });

  it('reports a plan of null for a product outside Harvest’s catalogue', async () => {
    const provider = dodoProvider(
      fakeFetch(() => ({ body: { ...DODO_SUB, product_id: 'pdt_some_addon' } })),
    );
    const sub = await provider.getSubscription('sub_dodo_1');
    expect(sub.plan).toBeNull();
    expect(sub.productRef).toBe('pdt_some_addon');
  });

  it('derives the trial end from the start date and the trial length', async () => {
    const provider = dodoProvider(fakeFetch(() => ({ body: DODO_SUB })));
    // Dodo reports a DURATION, not an end date. 2026-08-11 + 14 days.
    expect((await provider.getSubscription('sub_dodo_1')).trialEndsAt).toBe(
      '2026-08-25T00:00:00.000Z',
    );
  });

  it('reports no trial end when there is no trial, rather than guessing one', async () => {
    const provider = dodoProvider(
      fakeFetch(() => ({ body: { ...DODO_SUB, trial_period_days: 0 } })),
    );
    expect((await provider.getSubscription('sub_dodo_1')).trialEndsAt).toBeNull();
  });

  it('sends the catalogue product, the buyer and the metadata to /checkouts', async () => {
    const fetchImpl = fakeFetch(() => ({
      body: { session_id: 'sess_9', checkout_url: 'https://checkout.dodo/sess_9' },
    }));
    await dodoProvider(fetchImpl).createSubscriptionCheckout({
      plan: 'pro',
      interval: 'monthly',
      customer: { email: 'pastor@hope.example', name: 'Hope Chapel' },
      returnUrl: 'https://theharvest.app/?dodo=success',
      trialDays: 14,
      metadata: { userId: 'u9', ministryName: 'Hope Chapel' },
    });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://test.dodopayments.com/checkouts');
    expect(init.headers.Authorization).toBe('Bearer dodo_test_key');
    expect(JSON.parse(init.body)).toEqual({
      product_cart: [{ product_id: 'pdt_pro_monthly', quantity: 1 }],
      customer: { email: 'pastor@hope.example', name: 'Hope Chapel' },
      return_url: 'https://theharvest.app/?dodo=success',
      metadata: { userId: 'u9', ministryName: 'Hope Chapel' },
      subscription_data: { trial_period_days: 14 },
    });
  });

  it('omits the trial override entirely when the caller does not set one', async () => {
    const fetchImpl = fakeFetch(() => ({
      body: { session_id: 's', checkout_url: 'https://checkout.dodo/s' },
    }));
    await dodoProvider(fetchImpl).createSubscriptionCheckout({
      plan: 'plus',
      interval: 'monthly',
      customer: { email: 'a@b.example' },
      returnUrl: 'https://theharvest.app/',
    });
    const body = JSON.parse((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    // The product's own 14-day trial applies; `undefined` must not become `0`.
    expect(body).not.toHaveProperty('subscription_data');
  });

  it('keeps trialDays: 0 as a real "no trial" instruction', async () => {
    const fetchImpl = fakeFetch(() => ({
      body: { session_id: 's', checkout_url: 'https://checkout.dodo/s' },
    }));
    await dodoProvider(fetchImpl).createSubscriptionCheckout({
      plan: 'plus',
      interval: 'monthly',
      customer: { email: 'a@b.example' },
      returnUrl: 'https://theharvest.app/',
      trialDays: 0,
    });
    const body = JSON.parse((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.subscription_data).toEqual({ trial_period_days: 0 });
  });

  it('throws when Dodo returns a session with nowhere to send the buyer', async () => {
    const provider = dodoProvider(fakeFetch(() => ({ body: { session_id: 'sess_x' } })));
    await expect(
      provider.createSubscriptionCheckout({
        plan: 'plus',
        interval: 'monthly',
        customer: { email: 'a@b.example' },
        returnUrl: 'https://theharvest.app/',
      }),
      // A checkout with no URL is a dead button, not a successful call.
    ).rejects.toThrow(/no checkout_url/);
  });

  it('surfaces an HTTP failure as a BillingProviderError carrying the status', async () => {
    const provider = dodoProvider(
      fakeFetch(() => ({ status: 402, body: { error: 'payment_required' } })),
    );
    await expect(provider.getSubscription('sub_dodo_1')).rejects.toMatchObject({
      name: 'BillingProviderError',
      provider: 'dodo',
      operation: 'getSubscription',
      status: 402,
    });
  });

  it('cancels at the period end with a flag, and immediately with a status change', async () => {
    const fetchImpl = fakeFetch(() => ({ body: { ...DODO_SUB, cancel_at_next_billing_date: true } }));
    const provider = dodoProvider(fetchImpl);

    await provider.cancelSubscription('sub_dodo_1');
    let body = JSON.parse((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.cancel_at_next_billing_date).toBe(true);
    expect(body.status).toBeUndefined();

    await provider.cancelSubscription('sub_dodo_1', { atPeriodEnd: false });
    body = JSON.parse((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1].body);
    expect(body.status).toBe('cancelled');
    expect(body.cancel_at_next_billing_date).toBeUndefined();
  });
});
