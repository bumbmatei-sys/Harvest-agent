import { describe, it, expect } from 'vitest';
import {
  blocksStripeAction,
  resolveBillingOwnership,
  billingActionUnavailable,
  STRIPE_PLATFORM_ACCOUNT_OPERATIONAL,
} from '@/lib/billing-processor';

/**
 * Ownership resolution — the rule every billing write path routes on.
 *
 * These are the cases the PR body documents. They are unit tests rather than
 * route tests because the decision is a pure function of what the tenant carries,
 * and it must be provably right for every combination BEFORE any route trusts it.
 */

describe('resolveBillingOwnership', () => {
  it('reads the stored billingProcessor field as authoritative', () => {
    const own = resolveBillingOwnership({ billingProcessor: 'dodo', dodoSubscriptionId: 'sub_d' });
    expect(own).toMatchObject({ processor: 'dodo', reason: 'field' });
  });

  it('derives stripe from the Stripe identifiers when no field is stored', () => {
    // Every tenant that exists today. This is why the fix needs no migration to
    // be correct: they all derive to 'stripe', which is their behaviour already.
    expect(resolveBillingOwnership({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' }))
      .toMatchObject({ processor: 'stripe', reason: 'derived' });
  });

  it('derives stripe from a customer id alone (checkout started, no subscription yet)', () => {
    expect(resolveBillingOwnership({ stripeCustomerId: 'cus_1' }))
      .toMatchObject({ processor: 'stripe', reason: 'derived' });
  });

  it('derives dodo from the Dodo identifiers when no field is stored', () => {
    expect(resolveBillingOwnership({ dodoSubscriptionId: 'sub_d', dodoCustomerId: 'cus_d' }))
      .toMatchObject({ processor: 'dodo', reason: 'derived' });
  });

  // ── Test 5: a tenant with NEITHER identifier. ──────────────────────────────
  it('reports `none` for a tenant with no subscription identifier at all', () => {
    const own = resolveBillingOwnership({ adminEmails: ['a@b.test'] });
    expect(own).toMatchObject({ processor: null, reason: 'none' });
  });

  it('treats an empty / missing private doc as `none` rather than throwing', () => {
    expect(resolveBillingOwnership({})).toMatchObject({ processor: null, reason: 'none' });
    expect(resolveBillingOwnership(null)).toMatchObject({ processor: null, reason: 'none' });
    expect(resolveBillingOwnership(undefined)).toMatchObject({ processor: null, reason: 'none' });
  });

  it('does NOT block a `none` tenant — first-time signup through Stripe must still work', () => {
    // The documented rule: nothing to double-bill against, so Stripe (the default
    // processor) keeps its current behaviour. Routes needing an existing
    // subscription still refuse it with their own "no active subscription".
    expect(blocksStripeAction(resolveBillingOwnership({}))).toBe(false);
  });

  // ── Identifiers on both sides. ─────────────────────────────────────────────
  it('reports `conflict` when identifiers from both processors are present', () => {
    // The fingerprint of the double-billing bug having already happened.
    const own = resolveBillingOwnership({ stripeSubscriptionId: 'sub_s', dodoSubscriptionId: 'sub_d' });
    expect(own).toMatchObject({ processor: null, reason: 'conflict' });
    expect(blocksStripeAction(own)).toBe(true);
  });

  it('reports `conflict` even when the stored field claims one side — and keeps the claim', () => {
    // The field must not be able to HIDE a tenant that grew a second
    // subscription. `declared` survives so the portal can still let them cancel.
    const own = resolveBillingOwnership({
      billingProcessor: 'dodo',
      dodoSubscriptionId: 'sub_d',
      stripeSubscriptionId: 'sub_s',
    });
    expect(own).toMatchObject({ processor: null, reason: 'conflict', declared: 'dodo' });
  });

  // ── 🔴 Donations are not a subscription. ───────────────────────────────────
  it('IGNORES stripeConnectAccountId — that is donations, not the subscription', () => {
    // A Dodo-billed church that connects Stripe to receive giving is still
    // Dodo-owned. Counting Connect here would misroute it, or freeze its billing
    // as a false conflict, the moment it started accepting donations.
    const own = resolveBillingOwnership({
      dodoSubscriptionId: 'sub_d',
      dodoCustomerId: 'cus_d',
      stripeConnectAccountId: 'acct_1',
    });
    expect(own).toMatchObject({ processor: 'dodo', reason: 'derived' });
    expect(own.hasStripe).toBe(false);
    // Still Dodo-owned, so Stripe actions are still blocked — the Connect account
    // neither routes it to Stripe nor rescues it into a conflict.
    expect(blocksStripeAction(own)).toBe(true);
  });

  it('does not treat a Connect account alone as Stripe subscription ownership', () => {
    expect(resolveBillingOwnership({ stripeConnectAccountId: 'acct_1' }))
      .toMatchObject({ processor: null, reason: 'none' });
  });

  it('ignores a junk billingProcessor value rather than trusting it', () => {
    // An unrecognised value falls back to derivation; it must never be carried
    // through as a processor nobody can route to.
    expect(resolveBillingOwnership({ billingProcessor: 'paypal', stripeCustomerId: 'cus_1' }))
      .toMatchObject({ processor: 'stripe', reason: 'derived' });
  });
});

describe('blocksStripeAction', () => {
  it('blocks a Dodo-owned tenant', () => {
    expect(blocksStripeAction(resolveBillingOwnership({ dodoSubscriptionId: 'sub_d' }))).toBe(true);
  });

  // ── THE-353 — the Stripe platform account is closed. ─────────────────────
  it('assumes the Stripe platform account is inactive — flip this fixture with the flag', () => {
    // Every assertion below encodes CURRENT reality: the account is closed.
    // If `STRIPE_PLATFORM_ACCOUNT_OPERATIONAL` is ever restored to `true`
    // (a new account is live), this test — and the two below it — must be
    // revisited rather than silently passing against a stale assumption.
    expect(STRIPE_PLATFORM_ACCOUNT_OPERATIONAL).toBe(false);
  });

  it('blocks a Stripe-owned tenant while the platform account is inactive (THE-353)', () => {
    // 🔴 THE WHOLE TICKET: a tenant that confidently derives to 'stripe' must
    // not silently reach a closed account. Before THE-353 this returned
    // `false` — "allows a Stripe-owned tenant" — which was correct while
    // Stripe was live and is the exact defect once it was not.
    expect(blocksStripeAction(resolveBillingOwnership({ stripeSubscriptionId: 'sub_s' }))).toBe(true);
    expect(blocksStripeAction(resolveBillingOwnership({ stripeCustomerId: 'cus_s' }))).toBe(true);
  });

  it('blocks a tenant whose stored field explicitly declares stripe, not only a derived one', () => {
    // The field-wins rule (test 6) says the stored field is authoritative for
    // WHICH processor owns the tenant. It says nothing about whether that
    // processor is reachable — a `field`-reason 'stripe' resolution hits the
    // same closed account as a `derived` one.
    const own = resolveBillingOwnership({ billingProcessor: 'stripe', stripeCustomerId: 'cus_s' });
    expect(own).toMatchObject({ processor: 'stripe', reason: 'field' });
    expect(blocksStripeAction(own)).toBe(true);
  });

  it('does NOT block `none` — the account closure does not reach the no-identifier path', () => {
    // No-regression (test 5): blocking `none` would strand the one legacy path
    // that still legitimately depends on it. The account closure changes what
    // happens once Stripe is actually reached, not this predicate's shape.
    expect(blocksStripeAction(resolveBillingOwnership({}))).toBe(false);
  });
});

describe('billingActionUnavailable — a Stripe-owned tenant (THE-353)', () => {
  it('names the closed account, not "no active subscription"', async () => {
    // A tenant with a real Stripe subscription id is not "unbilled" — saying so
    // would be a different, less honest lie than the one this ticket exists to
    // fix. The refusal must say what is actually true: the processor it is on
    // is not reachable right now.
    const own = resolveBillingOwnership({ stripeSubscriptionId: 'sub_s' });
    const res = billingActionUnavailable('changing your plan', own);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/not currently active/i);
    expect(body.error).toMatch(/contact support/i);
    expect(body.error).not.toMatch(/no active subscription/i);
    expect(body).toMatchObject({ code: 'billing-action-unavailable', processor: 'stripe', reason: 'derived' });
  });
});

describe('billingActionUnavailable', () => {
  it('is a 409 carrying a message a person can act on, not a silent no-op', async () => {
    const own = resolveBillingOwnership({ dodoSubscriptionId: 'sub_d' });
    const res = billingActionUnavailable('changing your plan', own);

    expect(res.status).toBe(409);
    const body = await res.json();
    // `error` is the key every existing client already alerts on.
    expect(typeof body.error).toBe('string');
    expect(body.error).toMatch(/not available yet/i);
    expect(body.error).toMatch(/contact support/i);
    expect(body).toMatchObject({ code: 'billing-action-unavailable', processor: 'dodo', reason: 'derived' });
  });

  it('says something different, and honest, for a conflicting tenant', async () => {
    const own = resolveBillingOwnership({ dodoSubscriptionId: 'd', stripeSubscriptionId: 's' });
    const body = await billingActionUnavailable('changing your plan', own).json();
    expect(body.error).toMatch(/more than one payment processor/i);
    expect(body.reason).toBe('conflict');
  });
});
