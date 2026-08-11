import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  BillingPeriod,
  BillingSubscription,
  CancelSubscriptionOptions,
  PlanCheckout,
  PlanCheckoutRequest,
  SubscriptionBillingProvider,
} from '../provider';
import type { TenantPlan } from '@/types/tenant.types';

/**
 * Test 9 — the interface is satisfiable by a second implementation.
 *
 * The seam only means something if a different processor can sit behind it. Dodo
 * is a 2024-founded merchant of record holding Harvest's subscription revenue
 * between twice-monthly payouts; that is an acceptable arrangement and not one to
 * make structurally irreversible. If a second move ever happens, it should be a
 * new implementation of four methods, not a rewrite of checkout and webhooks.
 *
 * `LedgerBillingProvider` below is a complete, working implementation that has
 * never heard of Dodo. It compiles against `SubscriptionBillingProvider` and
 * behaves correctly, which proves two things at once: the interface is
 * implementable by someone else, and it contains nothing Dodo-shaped that a
 * second implementation would have to fake.
 */

// ── A second implementation, with no knowledge of Dodo ───────────────────────

const LEDGER_SKUS: Record<`${TenantPlan}:${BillingPeriod}`, string> = {
  'plus:monthly': 'SKU-IND-M',
  'plus:yearly': 'SKU-IND-Y',
  'pro:monthly': 'SKU-TEAM-M',
  'pro:yearly': 'SKU-TEAM-Y',
  'max:monthly': 'SKU-MIN-M',
  'max:yearly': 'SKU-MIN-Y',
};

/**
 * An in-memory processor. Deliberately unlike Dodo in the ways that matter: it
 * has a product/price split (a SKU plus a separate rate card), it spells its
 * states differently, and it cancels by writing a date rather than a flag.
 */
class LedgerBillingProvider implements SubscriptionBillingProvider {
  readonly id = 'ledger';

  private readonly subs = new Map<string, { sku: string; state: string; endsAt: string; endDated: boolean }>();
  private counter = 0;

  async createPlanCheckout(request: PlanCheckoutRequest): Promise<PlanCheckout> {
    const sku = LEDGER_SKUS[`${request.plan}:${request.period}`];
    const id = `ldg_sub_${++this.counter}`;
    this.subs.set(id, {
      sku,
      state: 'AWAITING_MANDATE',
      endsAt: '2026-09-11T00:00:00Z',
      endDated: false,
    });
    return { url: `https://ledger.example/pay/${id}?back=${encodeURIComponent(request.returnUrl)}`, reference: id };
  }

  async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
    const row = this.subs.get(subscriptionId);
    if (!row) throw new Error(`no such subscription: ${subscriptionId}`);
    const resolved = this.resolvePlanFromProductRef(row.sku);
    return {
      id: subscriptionId,
      status:
        row.state === 'AWAITING_MANDATE'
          ? 'pending'
          : row.state === 'ARREARS'
            ? 'grace'
            : row.state === 'CLOSED'
              ? 'cancelled'
              : 'active',
      plan: resolved?.plan ?? null,
      period: resolved?.period ?? null,
      cancelAtPeriodEnd: row.endDated,
      currentPeriodEndsAt: row.endsAt,
      trialDays: 14,
      customerId: 'ldg_cust_1',
      metadata: {},
    };
  }

  async cancelSubscription(
    subscriptionId: string,
    options: CancelSubscriptionOptions,
  ): Promise<BillingSubscription> {
    const row = this.subs.get(subscriptionId);
    if (!row) throw new Error(`no such subscription: ${subscriptionId}`);
    if (options.atPeriodEnd) row.endDated = true;
    else row.state = 'CLOSED';
    return this.getSubscription(subscriptionId);
  }

  resolvePlanFromProductRef(productRef: string): { plan: TenantPlan; period: BillingPeriod } | null {
    for (const [key, sku] of Object.entries(LEDGER_SKUS)) {
      if (sku === productRef) {
        const [plan, period] = key.split(':') as [TenantPlan, BillingPeriod];
        return { plan, period };
      }
    }
    return null;
  }

  /** Test-only: drive the state machine the way a real webhook would. */
  setState(subscriptionId: string, state: string): void {
    this.subs.get(subscriptionId)!.state = state;
  }
}

describe('a second implementation satisfies the interface', () => {
  // Typed as the interface, not the class — if the class were missing anything,
  // or had the wrong shape, this assignment would not compile.
  const provider: SubscriptionBillingProvider = new LedgerBillingProvider();

  it('creates a checkout for a plan', async () => {
    const checkout = await provider.createPlanCheckout({
      plan: 'max',
      period: 'yearly',
      returnUrl: 'https://grace.theharvest.app/?paid=1',
      cancelUrl: 'https://grace.theharvest.app/pricing',
      customer: { email: 'pastor@grace.example', name: 'Grace Chapel' },
      metadata: { tenantId: 'grace' },
    });

    expect(checkout.url).toContain('https://ledger.example/pay/');
    expect(checkout.reference).toMatch(/^ldg_sub_/);
  });

  it('reads a subscription back as the app’s own vocabulary', async () => {
    const { reference } = await provider.createPlanCheckout({
      plan: 'pro',
      period: 'monthly',
      returnUrl: 'https://x.test/ok',
      cancelUrl: 'https://x.test/no',
      customer: { email: 'a@b.test' },
    });

    const sub = await provider.getSubscription(reference);
    expect(sub).toMatchObject({ id: reference, status: 'pending', plan: 'pro', period: 'monthly' });
  });

  it('maps its own failure state onto `grace`', async () => {
    // The interface's states are Harvest's, not any processor's. This provider
    // says ARREARS; Dodo says on_hold; Stripe would say past_due. The app sees
    // one word and does not care which processor produced it.
    const ledger = new LedgerBillingProvider();
    const { reference } = await ledger.createPlanCheckout({
      plan: 'plus',
      period: 'monthly',
      returnUrl: 'https://x.test/ok',
      cancelUrl: 'https://x.test/no',
      customer: { email: 'a@b.test' },
    });

    ledger.setState(reference, 'ARREARS');
    expect((await ledger.getSubscription(reference)).status).toBe('grace');
  });

  it('cancels at period end without ending access immediately', async () => {
    // REP-4's recorded decision is downgrade, never lock out. The interface has
    // to be able to say "stop renewing" separately from "stop now".
    const { reference } = await provider.createPlanCheckout({
      plan: 'plus',
      period: 'yearly',
      returnUrl: 'https://x.test/ok',
      cancelUrl: 'https://x.test/no',
      customer: { email: 'a@b.test' },
    });

    const after = await provider.cancelSubscription(reference, { atPeriodEnd: true });
    expect(after.cancelAtPeriodEnd).toBe(true);
    expect(after.status).not.toBe('cancelled');
    expect(after.currentPeriodEndsAt).toBe('2026-09-11T00:00:00Z');
  });

  it('cancels immediately when asked to', async () => {
    const { reference } = await provider.createPlanCheckout({
      plan: 'plus',
      period: 'monthly',
      returnUrl: 'https://x.test/ok',
      cancelUrl: 'https://x.test/no',
      customer: { email: 'a@b.test' },
    });

    expect((await provider.cancelSubscription(reference, { atPeriodEnd: false })).status).toBe('cancelled');
  });

  it('resolves a plan from ITS OWN product reference, not a Dodo product id', () => {
    // `productRef` is deliberately vague so each implementation can mean its own
    // thing: a SKU here, a product id in Dodo, a price id in Stripe.
    expect(provider.resolvePlanFromProductRef('SKU-MIN-Y')).toEqual({ plan: 'max', period: 'yearly' });
    expect(provider.resolvePlanFromProductRef('pdt_0NlAMMsQBzMvRVNCY7zws')).toBeNull();
  });
});

// ── The interface leaks nothing processor-specific ───────────────────────────

describe('provider.ts names no processor', () => {
  const code = readFileSync(resolve(__dirname, '../provider.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  it.each(['dodo', 'product_cart', 'on_hold', 'pdt_', 'stripe', 'price_'])(
    'does not mention %s in its code',
    (term) => {
      expect(code.toLowerCase()).not.toContain(term.toLowerCase());
    },
  );

  it('imports nothing from the Dodo implementation', () => {
    // A type imported from catalogue.ts or dodo-provider.ts would make the
    // "interface" a description of Dodo wearing a neutral name.
    expect(code).not.toMatch(/from\s+['"]\.\/(catalogue|dodo-provider|config|events)['"]/);
  });
});

// ── The Dodo implementation satisfies the same interface ─────────────────────

describe('the Dodo implementation satisfies the interface too', () => {
  let dodo: SubscriptionBillingProvider;

  beforeAll(async () => {
    process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
    process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
    process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
    ({ dodoBillingProvider: dodo } = await import('../dodo-provider'));
  });

  it('is assignable to SubscriptionBillingProvider', () => {
    expect(dodo.id).toBe('dodo');
    expect(typeof dodo.createPlanCheckout).toBe('function');
    expect(typeof dodo.getSubscription).toBe('function');
    expect(typeof dodo.cancelSubscription).toBe('function');
    expect(typeof dodo.resolvePlanFromProductRef).toBe('function');
  });

  it('resolves the catalogue’s product ids through the neutral method name', () => {
    expect(dodo.resolvePlanFromProductRef('pdt_0NlAMMsQBzMvRVNCY7zws')).toEqual({
      plan: 'max',
      period: 'yearly',
    });
    expect(dodo.resolvePlanFromProductRef('SKU-MIN-Y')).toBeNull();
  });

  it('translates every Dodo status into the app’s vocabulary', async () => {
    const { toBillingStatus } = await import('../dodo-provider');
    expect(toBillingStatus('pending')).toBe('pending');
    expect(toBillingStatus('active')).toBe('active');
    // ⚠️ The two that must never be confused: on_hold is recoverable, failed is
    // terminal. Collapsing them means either dunning someone who never had a
    // subscription, or cutting off a paying church over an expired card.
    expect(toBillingStatus('on_hold')).toBe('grace');
    expect(toBillingStatus('failed')).toBe('failed');
    expect(toBillingStatus('paused')).toBe('paused');
    expect(toBillingStatus('cancelled')).toBe('cancelled');
    expect(toBillingStatus('expired')).toBe('expired');
  });

  it('maps an unknown status to pending rather than active', async () => {
    // A state this build has never heard of must not be read as "keep serving
    // them", and must not be read as "cut them off" either.
    const { toBillingStatus } = await import('../dodo-provider');
    expect(toBillingStatus('some_new_dodo_state')).toBe('pending');
  });

  it('maps a Dodo subscription payload onto the neutral shape', async () => {
    const { toBillingSubscription } = await import('../dodo-provider');

    expect(
      toBillingSubscription({
        subscription_id: 'sub_abc',
        status: 'on_hold',
        product_id: 'pdt_0NlAMMhi90q5Ovk6QBzcf',
        cancel_at_next_billing_date: false,
        next_billing_date: '2026-09-11T00:00:00Z',
        trial_period_days: 14,
        customer: { customer_id: 'cus_1' },
        metadata: { tenantId: 'grace', nonString: 7 as unknown as string },
      }),
    ).toEqual({
      id: 'sub_abc',
      status: 'grace',
      plan: 'pro',
      period: 'monthly',
      cancelAtPeriodEnd: false,
      currentPeriodEndsAt: '2026-09-11T00:00:00Z',
      trialDays: 14,
      customerId: 'cus_1',
      // Non-string metadata is dropped rather than coerced.
      metadata: { tenantId: 'grace' },
    });
  });

  it('reports a null plan for a product outside the catalogue', async () => {
    const { toBillingSubscription } = await import('../dodo-provider');
    const sub = toBillingSubscription({
      subscription_id: 'sub_addon',
      status: 'active',
      product_id: 'pdt_some_future_addon',
    });
    // An add-on product (REP-5) is not a plan. Null, never a default tier.
    expect(sub.plan).toBeNull();
    expect(sub.period).toBeNull();
  });
});
