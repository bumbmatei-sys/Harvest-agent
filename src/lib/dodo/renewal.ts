import type { BillingSubscription } from './provider';

/**
 * The renewal facts a billing SCREEN needs, and nothing else.
 *
 * ─── Why this module exists at all ───────────────────────────────────────────
 *
 * `/api/billing/invoices` has to tell a Dodo-billed church when its next charge
 * lands, and the only authority on that is Dodo. That makes the route the FOURTH
 * file outside the Dodo module to import it (see the named-exception list in
 * `dodo-billing-flag.test.ts`), so this file exists to keep that exception the
 * same shape as the three before it: ONE function wide, READ-ONLY, and incapable
 * of charging anyone.
 *
 * The route imports `getDodoRenewalSummary` and nothing else. It cannot reach
 * `createPlanCheckout`, `cancelSubscription`, `changePlan` or the catalogue,
 * because this module never re-exports them and the exception test pins that the
 * route's Dodo import list has exactly one entry.
 *
 * ⚠️ This is NOT the processor-neutral seam. `SubscriptionBillingProvider` and
 * `BillingSubscription` are processor-neutral types that still live inside
 * `src/lib/dodo/`, which is precisely why every consumer must reach into the Dodo
 * folder to use them. Moving them out and resolving a provider by processor is
 * THE-126, and it has to migrate the three existing exceptions to be coherent —
 * a money-path refactor that does not belong bundled with a user-visible fix.
 *
 * ─── 🔴 NO AMOUNT IS RETURNED, DELIBERATELY ──────────────────────────────────
 *
 * A Dodo subscription carries `recurring_pre_tax_amount` (e.g. 4900) alongside
 * `currency: 'USD'` — the CATALOGUE price, in the currency the product is priced
 * in. It is not a statement about what the card will be charged. Verified against
 * the live API on 2026-08-13: subscription `sub_0NlJmaY2DwicNk2rfHLOM` reports
 * 4900/USD, while its own payment `pay_0NlJmaXkpnZJSAF5GzfWi` settled in RON —
 * Dodo applies adaptive currency at charge time, and the subscription object
 * carries no field that says which currency that will be.
 *
 * So Harvest cannot know the charge currency from a subscription read, and
 * rendering "$49.00" to a treasurer whose statement will read RON is a false
 * statement about money — the same family as a statement PDF that says
 * `Total paid $0.00`. The date is worth shipping on its own; a wrong amount is
 * worse than no amount. `BillingSubscription` has no amount field, and this
 * module deliberately does not add one.
 */
export interface DodoRenewalSummary {
  /** ISO 8601 instant of the next renewal attempt, or null when Dodo has none. */
  readonly nextBillingDate: string | null;
  /** True when the subscription ends at that date instead of renewing. */
  readonly cancelAtPeriodEnd: boolean;
}

/**
 * Read a Dodo subscription's renewal schedule. READ-ONLY.
 *
 * The single Dodo call is `getSubscription`, which is a GET; nothing here
 * creates, modifies or cancels anything, and the caller has no way to make it.
 *
 * The provider is imported LAZILY, inside the call, and that is load-bearing
 * rather than stylistic: `./config` throws at IMPORT time when a Dodo variable
 * is missing, and `/api/billing/invoices` also serves every Stripe tenant. A
 * static import would make a missing `DODO_PAYMENTS_*` variable break the
 * billing screen for churches that have nothing to do with Dodo.
 *
 * Errors are NOT caught here. The caller decides what a Dodo outage should look
 * like on its own screen, and for the billing route that is "degrade to the plan
 * and status the tenant doc already knows" — swallowing the failure here would
 * take that choice away and make an outage indistinguishable from a subscription
 * that genuinely has no renewal date.
 */
export async function getDodoRenewalSummary(subscriptionId: string): Promise<DodoRenewalSummary> {
  const { dodoBillingProvider } = await import('./dodo-provider');
  const sub: BillingSubscription = await dodoBillingProvider.getSubscription(subscriptionId);
  return {
    nextBillingDate: sub.currentPeriodEndsAt,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  };
}
