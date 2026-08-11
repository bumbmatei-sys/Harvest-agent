import { NextResponse } from 'next/server';
import { getTenantPrivate } from '@/lib/tenant-private';

/**
 * Which processor owns a tenant's SUBSCRIPTION, and therefore where every
 * billing action for that tenant must be sent.
 *
 * ─── The bug this exists to make impossible ──────────────────────────────────
 *
 * 🔴 With `DODO_BILLING_ENABLED` true, signup creates a DODO subscription
 * (`/api/dodo/checkout` → `provisionTenantFromDodoSubscription`). Every other
 * billing path in the app still went straight to Stripe. So a church that signed
 * up through Dodo and later upgraded got a live Dodo subscription AND a brand-new
 * Stripe subscription — billed twice, by two processors, for one product.
 *
 * For this audience that is not a support ticket. A church treasurer reconciling
 * two card charges against one contract tells other churches about it.
 *
 * Every write path now resolves ownership through this module first. Getting the
 * answer wrong must be impossible, so "I don't know" is a first-class outcome
 * that BLOCKS rather than a value that falls through to Stripe.
 *
 * ─── How ownership is determined, and why in this order ──────────────────────
 *
 * 1. THE STORED `billingProcessor` FIELD, when present, is authoritative.
 *    An explicit statement of fact recorded by whoever created the subscription
 *    beats anything reconstructed after it. Dodo provisioning writes it.
 *
 * 2. OTHERWISE IT IS DERIVED from which identifiers the tenant carries.
 *    This is what makes the fix work WITHOUT A FIRESTORE MIGRATION: every tenant
 *    that exists today was created by the Stripe webhook and carries
 *    `stripeCustomerId`, so all of them derive to 'stripe' — which is also their
 *    current behaviour, unchanged. A migration would be cheap now and is worth
 *    doing, but correctness does not wait on it. See the PR body.
 *
 * 3. NEITHER identifier → `reason: 'none'`. Not a billing-owned tenant (a legacy
 *    or hand-made free tenant). Callers refuse the action; they must never pick a
 *    processor for a tenant that has no subscription anywhere.
 *
 * 4. IDENTIFIERS FROM BOTH PROCESSORS → `reason: 'conflict'`, and `processor` is
 *    null so nothing that charges money will run. This is not a hypothetical
 *    tidiness case: a tenant carrying live subscription ids on both sides is the
 *    exact fingerprint of the double-billing bug above having already happened.
 *    Guessing on one of them would put a third charge on a church that is already
 *    paying twice. It is deliberately unreachable today — the flag has never been
 *    on in production, so no such tenant exists — but it is the state that must
 *    fail loudly if it ever does.
 *
 * ⚠️ `stripeConnectAccountId` IS NOT A SUBSCRIPTION IDENTIFIER and is deliberately
 * absent from the checks below. It is DONATIONS — Stripe Connect destination
 * charges at a 0% platform fee, a different processor relationship entirely that
 * this migration does not touch. A Dodo-billed church that connects Stripe to
 * receive giving is still Dodo-owned for its own subscription, and reading that
 * field here would misroute it (or, worse, mark it 'conflict' and freeze its
 * billing) the moment it started accepting donations.
 */

/** The processors that can own a tenant's subscription. */
export type BillingProcessor = 'stripe' | 'dodo';

/** How ownership was decided. */
export type BillingOwnershipReason =
  /** The stored `billingProcessor` field said so. */
  | 'field'
  /** Inferred from which identifiers are present. */
  | 'derived'
  /** No subscription identifier from any processor. */
  | 'none'
  /** Identifiers from more than one processor. Refuse, never guess. */
  | 'conflict';

export interface BillingOwnership {
  /**
   * Where to send a billing action. **null means DO NOT ACT** — not "default to
   * Stripe". Every caller must treat null as a refusal.
   */
  readonly processor: BillingProcessor | null;
  readonly reason: BillingOwnershipReason;
  /**
   * On a conflict, the processor the stored field claims (null when unset).
   *
   * ⚠️ Only the CANCEL / manage-subscription path may fall back to this, because
   * trapping a church in a subscription it cannot exit is worse than the
   * ambiguity. Nothing that CHARGES may read it.
   */
  readonly declared: BillingProcessor | null;
  readonly hasStripe: boolean;
  readonly hasDodo: boolean;
}

/** The tenant_private field that records ownership explicitly. */
export const BILLING_PROCESSOR_FIELD = 'billingProcessor';

function readDeclared(raw: unknown): BillingProcessor | null {
  return raw === 'stripe' || raw === 'dodo' ? raw : null;
}

/**
 * Resolve ownership from a `tenant_private` document body.
 *
 * Pure and synchronous so it can be unit-tested against every combination of
 * identifiers without touching Firestore.
 */
export function resolveBillingOwnership(priv: Record<string, any> | null | undefined): BillingOwnership {
  const data = priv || {};

  // Subscription identifiers ONLY. See the note on stripeConnectAccountId above.
  const hasStripe = Boolean(data.stripeSubscriptionId || data.stripeCustomerId);
  const hasDodo = Boolean(data.dodoSubscriptionId || data.dodoCustomerId);
  const declared = readDeclared(data[BILLING_PROCESSOR_FIELD]);

  // Identifiers from both sides: refuse regardless of what the field claims. A
  // stored 'dodo' on a tenant that has since grown a Stripe subscription is
  // precisely the double-billed tenant, and the field would otherwise hide it.
  if (hasStripe && hasDodo) {
    return { processor: null, reason: 'conflict', declared, hasStripe, hasDodo };
  }

  if (declared) {
    return { processor: declared, reason: 'field', declared, hasStripe, hasDodo };
  }

  if (hasStripe) return { processor: 'stripe', reason: 'derived', declared: null, hasStripe, hasDodo };
  if (hasDodo) return { processor: 'dodo', reason: 'derived', declared: null, hasStripe, hasDodo };

  return { processor: null, reason: 'none', declared: null, hasStripe, hasDodo };
}

/** Read the tenant's private doc and resolve who owns its subscription. */
export async function getBillingOwnership(tenantId: string): Promise<BillingOwnership> {
  return resolveBillingOwnership(await getTenantPrivate(tenantId));
}

/**
 * True when a Stripe billing action must NOT run for this tenant.
 *
 * 🔴 The single predicate every Stripe write path guards on. It blocks exactly
 * two states — someone else owns the subscription, or ownership is contradictory
 * — and deliberately does NOT block `reason: 'none'`.
 *
 * ⚠️ WHY `none` FALLS THROUGH, stated because it is the one judgement call here.
 * A tenant carrying no subscription identifier at all has nothing to be
 * double-billed against: there is no Dodo subscription for a Stripe charge to
 * duplicate. Blocking it would break the one path that legitimately depends on
 * it — a legacy or hand-made free tenant subscribing for the FIRST time through
 * `/api/stripe/checkout`, which is exactly the case that has no identifiers yet.
 * Every other route guarded by this predicate already refuses `none` a line or
 * two later with its own "no active subscription" message, because it needs a
 * subscription id it does not have. So `none` means "Stripe, the default
 * processor, and nothing to collide with" — the behaviour it has today,
 * unchanged.
 */
export function blocksStripeAction(ownership: BillingOwnership): boolean {
  return ownership.processor === 'dodo' || ownership.reason === 'conflict';
}

/**
 * The refusal returned when an action cannot be performed for this tenant.
 *
 * 🔴 One helper, one wording, every call site. A disabled button is recoverable;
 * a duplicate charge is not — so this is what a caller returns instead of
 * reaching for Stripe when the tenant is not Stripe's.
 *
 * 409 Conflict, deliberately: the request is well-formed and the caller is
 * authorised, but it conflicts with the state of the tenant's billing. It is not
 * a 400 (nothing about the request is malformed to fix) and not a 500 (nothing
 * failed). The `error` string is what the existing clients already surface —
 * every caller of these routes does `alert(data.error || …)` — so the refusal is
 * VISIBLE to the admin rather than a silent no-op.
 */
export function billingActionUnavailable(
  action: string,
  ownership: BillingOwnership,
): NextResponse {
  const error =
    ownership.reason === 'conflict'
      ? `This organization has billing records with more than one payment processor, so ${action} has been blocked to prevent a duplicate charge. Please contact support.`
      : ownership.processor === 'dodo'
        ? `${capitalize(action)} is not available yet for organizations billed through Dodo Payments. Please contact support and we will make the change for you.`
        : `No active subscription was found for this organization, so ${action} is not available.`;

  return NextResponse.json(
    {
      error,
      // Machine-readable so a client can distinguish "blocked" from "failed"
      // without parsing prose. Nothing renders this today; it exists so the
      // refusal is not indistinguishable from a 500 in a log.
      code: 'billing-action-unavailable',
      processor: ownership.processor,
      reason: ownership.reason,
    },
    { status: 409 },
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
