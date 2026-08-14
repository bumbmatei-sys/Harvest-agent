import DodoPayments from 'dodopayments';
import type { TenantPlan } from '@/types/tenant.types';
import { dodoConfig } from './config';
import { catalogueEntry, resolvePlanFromProductId } from './catalogue';
import type {
  BillingPeriod,
  BillingSubscription,
  BillingSubscriptionStatus,
  CancelSubscriptionOptions,
  CustomerPortalRequest,
  CustomerPortalSession,
  PlanCheckout,
  PlanCheckoutRequest,
  SubscriptionBillingProvider,
} from './provider';

/**
 * The Dodo Payments implementation of `SubscriptionBillingProvider`.
 *
 * Everything Dodo-shaped stops here. Product ids, `product_cart`, `on_hold`,
 * `cancel_at_next_billing_date` — none of those words appear on the far side of
 * this file, which is what makes the seam in `provider.ts` worth having.
 *
 * ⚠️ NOTHING IN THE APP CALLS THIS YET. Signup goes through Stripe until REP-4
 * PR 2 deliberately switches it.
 */

/**
 * Dodo subscription status → Harvest status.
 *
 * Exhaustive over Dodo's documented state machine, and an unknown value maps to
 * `pending` rather than `active`: a state this build has never heard of must not
 * be read as "keep serving them", and must not be read as "cut them off" either.
 */
const DODO_STATUS_TO_BILLING_STATUS: Record<string, BillingSubscriptionStatus> = {
  pending: 'pending',
  active: 'active',
  on_hold: 'grace',
  paused: 'paused',
  cancelled: 'cancelled',
  expired: 'expired',
  failed: 'failed',
};

export function toBillingStatus(dodoStatus: string): BillingSubscriptionStatus {
  return DODO_STATUS_TO_BILLING_STATUS[dodoStatus] ?? 'pending';
}

/** Dodo's metadata values are strings; anything else is dropped rather than coerced. */
function toStringMetadata(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * A Dodo subscription payload, narrowed to the fields this module reads.
 *
 * Declared locally rather than imported from the SDK so that the mapping below
 * is a stated expectation about Dodo's response, checked in one place, instead of
 * an SDK type change silently altering what the app believes.
 */
export interface DodoSubscriptionLike {
  subscription_id: string;
  status: string;
  product_id: string;
  cancel_at_next_billing_date?: boolean | null;
  next_billing_date?: string | null;
  trial_period_days?: number | null;
  /** ISO 8601. When the subscription was created — the trial's own start. */
  created_at?: string | null;
  customer?: { customer_id?: string | null } | null;
  metadata?: unknown;
  /**
   * What the subscription currently holds, as Dodo reports it. Dodo returns this
   * field on EVERY subscription — `[]` when nothing is attached — so it is
   * declared optional here only because this is a stated expectation about a wire
   * payload, not a promise. Its ABSENCE is treated as "could not determine",
   * never as "none": see `readHeldDodoAddons`.
   */
  addons?: Array<{ addon_id?: unknown; quantity?: unknown }> | null;
}

/** Dodo subscription payload → the app's `BillingSubscription`. */
export function toBillingSubscription(sub: DodoSubscriptionLike): BillingSubscription {
  const resolved = resolvePlanFromProductId(sub.product_id);
  return {
    id: sub.subscription_id,
    status: toBillingStatus(sub.status),
    plan: resolved?.plan ?? null,
    period: resolved?.period ?? null,
    cancelAtPeriodEnd: sub.cancel_at_next_billing_date === true,
    currentPeriodEndsAt: sub.next_billing_date ?? null,
    trialDays: sub.trial_period_days ?? 0,
    customerId: sub.customer?.customer_id ?? null,
    metadata: toStringMetadata(sub.metadata),
  };
}

/**
 * The proration mode for every Harvest plan change, chosen once, here.
 *
 * `prorated_immediately`: an upgrade charges only the difference for the days
 * left in the current cycle, and a downgrade turns the unused value into a
 * subscription-scoped CREDIT that Dodo applies to future renewals. The credit
 * direction matters: Harvest issues no refunds, and credit-on-downgrade is the
 * one behaviour consistent with that — nothing here may ever grow a refund.
 *
 * The other modes were considered and rejected:
 *   - `difference_immediately` charges the FULL tier difference regardless of
 *     how far into the cycle the church is — a day-29 upgrade pays a whole
 *     month's difference for one day of service.
 *   - `full_immediately` charges the whole new price with no credit at all.
 *   - `do_not_bill` grants the higher tier free until the next renewal, which
 *     is an abuse hole (upgrade on day 1, downgrade on day 29, repeat).
 *
 * ⚠️ Like the three other immediate modes, this RESETS the billing cycle to the
 * change date. The affiliate commission window is NOT affected: its anchor is
 * the subscription's own creation instant (`created_at`), which a plan change
 * does not move — the subscription is modified in place, same id, same
 * creation timestamp.
 */
export const DODO_PLAN_CHANGE_PRORATION_MODE = 'prorated_immediately' as const;

/**
 * 🔴 ALWAYS SENT EXPLICITLY, on the preview and on the real call.
 *
 * Dodo's dashboard default is `apply_change`, which grants the higher tier even
 * when the payment for it FAILS. The dashboard setting is currently
 * `prevent_change`, but a dashboard setting can be edited without a code
 * review; an explicit parameter cannot. A failed upgrade payment must leave the
 * church exactly where it was.
 */
export const DODO_PLAN_CHANGE_ON_PAYMENT_FAILURE = 'prevent_change' as const;

/** What a plan change would do to the customer's money, before it is real. */
export interface DodoPlanChangePreview {
  /**
   * Charged NOW if the change is confirmed, in the currency's minor units.
   * 0 for a downgrade (nothing is charged; unused value becomes credit).
   */
  readonly amountDueNow: number;
  /**
   * Credit movement in minor units, as Dodo reports it: POSITIVE when credit is
   * added to the subscription (a downgrade), NEGATIVE when existing credit was
   * consumed to offset the charge, 0 when no credit moved.
   */
  readonly creditMovement: number;
  readonly currency: string;
}

let cachedClient: DodoPayments | null = null;

/** The SDK client, built from the validated config on first use. */
function client(): DodoPayments {
  if (!cachedClient) {
    cachedClient = new DodoPayments({
      bearerToken: dodoConfig.apiKey,
      environment: dodoConfig.environment,
    });
  }
  return cachedClient;
}

/** Test seam: replace or reset the SDK client. Not used by production code. */
export function __setDodoClientForTests(stub: DodoPayments | null): void {
  cachedClient = stub;
}

export const dodoBillingProvider: SubscriptionBillingProvider = {
  id: 'dodo',

  async createPlanCheckout(request: PlanCheckoutRequest): Promise<PlanCheckout> {
    const entry = catalogueEntry(request.plan, request.period);

    const session = await (client().checkoutSessions.create as (body: unknown) => Promise<{
      session_id: string;
      checkout_url: string;
    }>)({
      product_cart: [{ product_id: entry.productId, quantity: 1 }],
      customer: { email: request.customer.email, name: request.customer.name },
      return_url: request.returnUrl,
      cancel_url: request.cancelUrl,
      metadata: request.metadata,
      // Omitted entirely when the caller does not override, so the product's own
      // configured trial applies. Sending `undefined` explicitly would be a
      // request to change the trial to nothing on some API shapes.
      ...(request.trialDays === undefined
        ? {}
        : { subscription_data: { trial_period_days: request.trialDays } }),
    });

    return { url: session.checkout_url, reference: session.session_id };
  },

  async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
    const sub = (await client().subscriptions.retrieve(subscriptionId)) as unknown as DodoSubscriptionLike;
    return toBillingSubscription(sub);
  },

  async cancelSubscription(
    subscriptionId: string,
    options: CancelSubscriptionOptions,
  ): Promise<BillingSubscription> {
    if (options.atPeriodEnd) {
      // Keep serving the period they already paid for, then stop renewing.
      await client().subscriptions.update(subscriptionId, {
        cancel_at_next_billing_date: true,
      });
    } else {
      await (client().subscriptions.update as (id: string, body: unknown) => Promise<unknown>)(
        subscriptionId,
        { status: 'cancelled' },
      );
    }
    return this.getSubscription(subscriptionId);
  },

  async createCustomerPortal(request: CustomerPortalRequest): Promise<CustomerPortalSession> {
    // Dodo's hosted portal covers cancel (immediately or at the next billing
    // date), payment-method update, on-hold reactivation, and invoice/receipt
    // download — the same surface the Stripe billing portal gives a Stripe
    // tenant, which is why routing `/api/stripe/portal` here is a real
    // equivalent rather than a placeholder.
    //
    // `send_email` is deliberately not set: the app redirects the admin who is
    // standing in front of it, and mailing a billing link to the customer record
    // would be a second, unrequested delivery of a single-use credential.
    const session = await client().customers.customerPortal.create(request.customerId, {
      return_url: request.returnUrl,
    });
    return { url: session.link };
  },

  resolvePlanFromProductRef(
    productRef: string,
  ): { plan: TenantPlan; period: BillingPeriod } | null {
    // Dodo puts the price on the product, so the app's "product reference" IS a
    // Dodo product id. A Stripe implementation would resolve a price id here.
    return resolvePlanFromProductId(productRef);
  },
};

// ─── Plan change (THE-89) ────────────────────────────────────────────────────
//
// Standalone functions rather than new `SubscriptionBillingProvider` methods,
// deliberately: THE-126 (the full processor-neutral seam) is its own issue, and
// widening the interface here would force every implementation — including the
// seam test's Ledger stub — to grow a plan-change story before that design is
// had. The one caller is `/api/dodo/change-plan`, which is a Dodo route and may
// import the Dodo module directly, same as `/api/dodo/checkout` does.

// ─── Add-ons across a plan change (THE-132) ─────────────────────────────────
//
// 🔴 A DODO ADD-ON IS ATTACHED TO SPECIFIC PRODUCTS. "Contacts +500" exists on
// Small Team and Ministry and NOT on Individual, so "carry everything across"
// would send an `addon_id` the target product does not offer — a failed plan
// change on the money path, or worse, an accepted one whose price nobody
// predicted.
//
// The decided rule: on a downgrade, an add-on the lower tier does not offer is
// REMOVED, and the church is told BEFORE it confirms. Grandfathering was
// considered and rejected: it would move tier availability out of Dodo, where
// it is structural, and into Harvest application code, where one buggy gate
// would sell $59 Unlimited Contacts on a $49 Individual plan.
//
// So availability is never inferred and never hardcoded — it is read from the
// TARGET PRODUCT'S OWN `addons` array, every time.

/** One add-on on a subscription: which add-on, and how many. Dodo's own shape. */
export interface DodoAddonSelection {
  readonly addon_id: string;
  readonly quantity: number;
}

/** An add-on in words, for a human deciding. No id ever reaches a church. */
export interface DodoNamedAddon {
  readonly name: string;
  readonly quantity: number;
}

/** What a plan change does to the add-ons a subscription already holds. */
export interface DodoAddonCarryOver {
  /** Offered by the target product, so they survive the change unchanged. */
  readonly carried: readonly DodoAddonSelection[];
  /** NOT offered by the target product, so the change removes them. */
  readonly removed: readonly DodoAddonSelection[];
}

/**
 * 🔴 What a subscription holds could not be determined.
 *
 * A distinct error type because "no add-ons" and "could not read the add-ons"
 * must never converge: sending `[]` for the second silently deletes something a
 * church pays for. Every path that catches this REFUSES the plan change.
 */
export class DodoAddonsUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DodoAddonsUnreadableError';
  }
}

/** One subscription read, so the trial check and the add-on read can share it. */
export async function retrieveDodoSubscription(
  subscriptionId: string,
): Promise<DodoSubscriptionLike> {
  return (await client().subscriptions.retrieve(subscriptionId)) as unknown as DodoSubscriptionLike;
}

/**
 * The add-ons a subscription currently holds.
 *
 * Throws rather than returning `[]` for anything it cannot vouch for — a
 * missing `addons` field, an entry without an id, a quantity that is not a
 * number. Dodo returns `addons: []` on every subscription, so the absence of
 * the field is a payload this build does not understand, not an empty cart.
 */
export function readHeldDodoAddons(sub: DodoSubscriptionLike): DodoAddonSelection[] {
  const raw = sub.addons;
  if (!Array.isArray(raw)) {
    throw new DodoAddonsUnreadableError(
      `[dodo] subscription ${sub.subscription_id} did not report its add-ons`,
    );
  }
  return raw.map((entry) => {
    const addonId = entry?.addon_id;
    const quantity = entry?.quantity;
    if (typeof addonId !== 'string' || addonId === '') {
      throw new DodoAddonsUnreadableError(
        `[dodo] subscription ${sub.subscription_id} holds an add-on with no id`,
      );
    }
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
      throw new DodoAddonsUnreadableError(
        `[dodo] subscription ${sub.subscription_id} holds add-on ${addonId} with no usable quantity`,
      );
    }
    return { addon_id: addonId, quantity };
  });
}

/**
 * Which add-ons a product offers, read from the product itself.
 *
 * 🔴 Computed here rather than assumed: Dodo may filter an unattached add-on,
 * or may reject the whole call — it is not documented which, and a plan change
 * is not the place to find out. An id this returns is an id the target product
 * lists; anything else is never sent.
 */
export async function retrieveDodoProductAddonIds(productId: string): Promise<Set<string>> {
  const product = (await client().products.retrieve(productId)) as unknown as {
    addons?: unknown;
  };
  const raw = product?.addons;
  if (!Array.isArray(raw)) {
    throw new DodoAddonsUnreadableError(`[dodo] product ${productId} did not report its add-ons`);
  }
  const offered = new Set<string>();
  for (const addonId of raw) {
    if (typeof addonId !== 'string' || addonId === '') {
      throw new DodoAddonsUnreadableError(
        `[dodo] product ${productId} listed an add-on with no id`,
      );
    }
    offered.add(addonId);
  }
  return offered;
}

/**
 * THE ONE PLACE the carried set is computed — called once per request, by both
 * the preview and the confirm, so the two can never disagree about what runs.
 *
 * The product read is skipped when the subscription holds nothing, because the
 * answer is then `{ carried: [], removed: [] }` for every possible product and
 * a church with no add-ons should not pay a round trip to learn it.
 */
export async function planDodoAddonCarryOver(
  subscription: DodoSubscriptionLike,
  plan: TenantPlan,
  period: BillingPeriod,
): Promise<DodoAddonCarryOver> {
  const held = readHeldDodoAddons(subscription);
  if (held.length === 0) return { carried: [], removed: [] };

  const offered = await retrieveDodoProductAddonIds(catalogueEntry(plan, period).productId);
  const carried: DodoAddonSelection[] = [];
  const removed: DodoAddonSelection[] = [];
  for (const addon of held) {
    (offered.has(addon.addon_id) ? carried : removed).push(addon);
  }
  return { carried, removed };
}

/**
 * Add-ons in words, for the preview a church reads.
 *
 * `adn_0NlKtwD3VfBLgx2LTw69O` is not something anyone can act on, and a name is
 * not on the subscription payload — it is on the add-on. A name that cannot be
 * read throws: showing the id instead would technically answer the question and
 * practically answer nothing, and the preview charges nothing, so refusing it is
 * the recoverable direction.
 */
export async function describeDodoAddons(
  selections: readonly DodoAddonSelection[],
): Promise<DodoNamedAddon[]> {
  return Promise.all(
    selections.map(async (selection) => {
      const addon = (await client().addons.retrieve(selection.addon_id)) as unknown as {
        name?: unknown;
      };
      const name = typeof addon?.name === 'string' ? addon.name.trim() : '';
      if (name === '') {
        throw new DodoAddonsUnreadableError(
          `[dodo] add-on ${selection.addon_id} has no name to show`,
        );
      }
      return { name, quantity: selection.quantity };
    }),
  );
}

/**
 * The `addons` field for a change-plan call, ALWAYS present.
 *
 * Dodo documents `addons: []` as "removes any existing add-ons" and says
 * nothing at all about omitting the field — and it documents omit-vs-empty
 * explicitly for `discount_codes` on the very same endpoint, so the silence
 * about `addons` is a gap, not an implied "preserve". Omission is unspecified;
 * this build is never unspecified about a subscription's contents.
 */
function addonsPayload(addons: readonly DodoAddonSelection[]): Array<DodoAddonSelection> {
  return addons.map((addon) => ({ addon_id: addon.addon_id, quantity: addon.quantity }));
}

/**
 * What confirming a plan change would charge, before anything is charged.
 *
 * A church committing to a proration it cannot see is the statement-PDF bug in
 * a different shape, so the route shows this to the owner before it will accept
 * a confirm.
 *
 * `addons` is a REQUIRED parameter, not an optional one: add-ons are part of
 * Dodo's proration calculation, so a caller that forgot them would quote an
 * amount that is not the amount charged. The compiler refuses that here.
 */
export async function previewDodoPlanChange(
  subscriptionId: string,
  plan: TenantPlan,
  period: BillingPeriod,
  addons: readonly DodoAddonSelection[],
): Promise<DodoPlanChangePreview> {
  const entry = catalogueEntry(plan, period);
  const preview = await client().subscriptions.previewChangePlan(subscriptionId, {
    product_id: entry.productId,
    // `quantity` is the count of the BASE PRODUCT — one subscription, one plan.
    // It is not, and never becomes, an add-on quantity: those travel per add-on
    // in `addons` below.
    quantity: 1,
    proration_billing_mode: DODO_PLAN_CHANGE_PRORATION_MODE,
    // Sent on the preview too, so what is previewed is exactly what will run.
    on_payment_failure: DODO_PLAN_CHANGE_ON_PAYMENT_FAILURE,
    addons: addonsPayload(addons),
  });
  const summary = preview?.immediate_charge?.summary;
  return {
    amountDueNow: typeof summary?.total_amount === 'number' ? summary.total_amount : 0,
    creditMovement: typeof summary?.customer_credits === 'number' ? summary.customer_credits : 0,
    currency: typeof summary?.currency === 'string' ? summary.currency : 'USD',
  };
}

/**
 * Move a subscription to a new plan. Charges (or credits) per the proration
 * mode above; the tenant's own `plan` field is NOT written here — that is the
 * `subscription.plan_changed` webhook's job (see `./plan-change`), the single
 * writer, because a plan change can also originate outside this app entirely
 * (Dodo's dashboard, or its customer portal once the products join a
 * collection) and only the webhook sees those.
 *
 * 🔴 `addons` is the SAME LIST THE PREVIEW WAS COMPUTED FROM — the route
 * resolves the carry-over once and hands it to both calls. Add-ons are inside
 * Dodo's proration calculation, so a set that diverges between the two makes
 * the quoted amount and the charged amount different numbers.
 */
export async function executeDodoPlanChange(
  subscriptionId: string,
  plan: TenantPlan,
  period: BillingPeriod,
  addons: readonly DodoAddonSelection[],
): Promise<void> {
  const entry = catalogueEntry(plan, period);
  await client().subscriptions.changePlan(subscriptionId, {
    product_id: entry.productId,
    // The base product's count, not an add-on's. See `previewDodoPlanChange`.
    quantity: 1,
    proration_billing_mode: DODO_PLAN_CHANGE_PRORATION_MODE,
    // 🔴 Explicit, always. See the constant's note: the dashboard default is
    // `apply_change`, which grants the tier even when the payment fails.
    on_payment_failure: DODO_PLAN_CHANGE_ON_PAYMENT_FAILURE,
    addons: addonsPayload(addons),
  });
}

/**
 * Is this subscription still inside its free trial?
 *
 * 🔴 Dodo has no trial status: EVERY proration mode ends a trial (the three
 * immediate modes charge right away; even `do_not_bill` ends it), so a plan
 * change during the 14-day card-up-front trial would silently charge a church
 * days 4–14 it was promised for free. The route refuses the change instead,
 * and this is the check it refuses on.
 *
 * Two detections, EITHER of which counts as in-trial, because each covers the
 * other's blind spot:
 *
 *  1. Date arithmetic — `created_at + trial_period_days` is still ahead of now.
 *     Covers the moments right after signup when Dodo's payment list may not
 *     yet show the $0 mandate payment.
 *  2. Dodo's own documented workaround for free trials — exactly one payment,
 *     for exactly $0. Covers a trial that was EXTENDED in the dashboard past
 *     its original arithmetic end (no real charge has landed yet).
 *
 * The union errs toward refusing, which is the recoverable direction: a
 * refused change can be retried after the trial; an early charge cannot be
 * unmade (Harvest issues no refunds).
 *
 * `subscription` may be passed in when the caller has already retrieved it —
 * the change-plan route needs the same payload to read the add-ons, and one
 * read answering both questions keeps the confirm path from growing a call.
 * Omitted, it retrieves the subscription itself, exactly as before.
 */
export async function isDodoSubscriptionInTrial(
  subscriptionId: string,
  subscription?: DodoSubscriptionLike,
): Promise<boolean> {
  const sub = subscription ?? (await retrieveDodoSubscription(subscriptionId));

  const trialDays = sub.trial_period_days ?? 0;
  if (trialDays > 0 && typeof sub.created_at === 'string') {
    const createdMs = Date.parse(sub.created_at);
    if (Number.isFinite(createdMs) && Date.now() < createdMs + trialDays * 24 * 60 * 60 * 1000) {
      return true;
    }
  }

  const payments = await client().payments.list({ subscription_id: subscriptionId });
  const items: Array<{ total_amount?: number }> = (payments as unknown as { items?: Array<{ total_amount?: number }> })?.items ?? [];
  return items.length === 1 && items[0]?.total_amount === 0;
}
