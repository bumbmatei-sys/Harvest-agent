import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { setCustomClaims } from '@/lib/set-custom-claims';
import { tenantPrivateRef, TENANT_PRIVATE_COLLECTION } from '@/lib/tenant-private';
import { NON_TENANT_SUBDOMAINS } from '@/utils/non-tenant-subdomains';
import { readTenantAddons } from '@/utils/plan-features';
import type { TenantAddons, TenantPlan } from '@/types/tenant.types';
import { resolvePlanFromProductId } from './catalogue';
import {
  readDodoAddonEntitlements,
  reportUnrecognisedDodoAddons,
  sameTenantAddons,
} from './addons';
import type { BillingPeriod } from './provider';
import type { DodoWebhookEvent } from './events';
import { reactivateTenantForDodoSubscription } from './lifecycle';

/**
 * Build-on-payment, on Dodo: turn a paid Dodo subscription into a tenant.
 *
 * 🔴 THIS IS THE MONEY PATH. It is the ONLY way a church becomes a customer once
 * `DODO_BILLING_ENABLED` is true, and it is a field-for-field reproduction of the
 * `checkout.session.completed` new-tenant block in
 * `src/app/api/stripe/webhook/route.ts` — not an approximation. Every field that
 * handler writes is written here, on the same two documents, with the same
 * values and the same ordering. A field missed here is a tenant that LOOKS
 * provisioned and is subtly broken, and nobody finds out until a customer hits
 * it. `dodo-provisioning.test.ts` asserts the two field sets agree, key by key,
 * rather than asserting "a tenant exists".
 *
 * ─── The three things that are genuinely different ───────────────────────────
 *
 *  1. THE PLAN COMES FROM THE PRODUCT, NOT FROM METADATA. Dodo puts the price on
 *     the product, so `product_id` IS the plan-and-period. An id this build does
 *     not sell is a hard failure (see `DodoProvisioningError`) — never a default.
 *     Defaulting an unrecognised product to `plus` would hand a Ministry customer
 *     the cheapest tier and bill them for it, silently.
 *  2. THE DODO IDENTIFIERS GO ALONGSIDE the Stripe ones on `tenant_private`, in
 *     their own `dodo*` keys. Nothing here writes a `stripe*` key: existing test
 *     tenants still carry them and the Stripe path is the rollback.
 *  3. THE AFFILIATE COMMISSION IS NOT CREATED HERE. Signup is a 14-day
 *     card-up-front trial, so the amount charged at checkout is $0 — and the
 *     Stripe path's own `processInitialAffiliateCommission` returns immediately
 *     on a $0 total for exactly that reason, deferring to the first real invoice.
 *     Reproducing "does nothing" would be a way to get it wrong. What this module
 *     MUST do, and does, is carry `referrerId` onto the tenant's records so the
 *     recurring path can pay when a real charge lands; see below.
 */

/** The tenant fields the app itself gates on. Public, world-readable doc. */
export const TENANT_STATUS_ACTIVE = 'active';

/**
 * A provisioning attempt that must NOT be swallowed.
 *
 * Thrown rather than logged because the caller turns a throw into a non-2xx, and
 * a non-2xx is what makes Dodo redeliver. A church that paid and has no account
 * is the worst outcome in this system; failing loudly is how the event comes
 * back rather than disappearing.
 */
export class DodoProvisioningError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'DodoProvisioningError';
    this.reason = reason;
  }
}

/**
 * A Dodo subscription payload, narrowed to what provisioning reads.
 *
 * Declared locally for the same reason `dodo-provider.ts` declares its own: the
 * mapping is a stated expectation about Dodo's webhook body, checked in one
 * place, rather than an SDK type change quietly altering what the app believes.
 */
export interface DodoSubscriptionPayload {
  subscription_id?: unknown;
  product_id?: unknown;
  status?: unknown;
  /** ISO 8601. Dodo's equivalent of Stripe's `subscription.start_date`. */
  created_at?: unknown;
  customer?: { customer_id?: unknown; email?: unknown; name?: unknown } | null;
  metadata?: unknown;
  /**
   * What the subscription holds. Nothing sells an add-on at signup today, so in
   * practice this is `[]` — but it is read rather than assumed, because a
   * subscription created in Dodo's dashboard WITH add-ons also arrives here and
   * assuming empty would silently under-serve it.
   */
  addons?: unknown;
}

/** The metadata this app stamps on a signup checkout, after validation. */
export interface DodoSignupMetadata {
  readonly userId: string;
  readonly ministryName: string;
  readonly newTenant: boolean;
  readonly referrerId?: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Dodo metadata values are strings; anything else is dropped, never coerced. */
export function readDodoMetadata(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * The signup metadata carried through Dodo, or null when this subscription is
 * not a new-ministry signup.
 *
 * `newTenant === 'true'` is the same discriminator the Stripe handler uses. A
 * subscription without it (a plan change made directly in the Dodo dashboard,
 * say) is not a signup and provisioning must not invent a tenant for it.
 */
export function readSignupMetadata(raw: unknown): DodoSignupMetadata | null {
  const meta = readDodoMetadata(raw);
  if (meta.newTenant !== 'true') return null;
  if (!meta.userId) return null;
  return {
    userId: meta.userId,
    ministryName: meta.ministryName || '',
    newTenant: true,
    ...(meta.referrerId ? { referrerId: meta.referrerId } : {}),
  };
}

/**
 * Turn a ministry name into a unique, free tenant subdomain.
 *
 * A deliberate character-for-character copy of `generateUniqueSubdomain` in the
 * Stripe webhook: the id it produces IS the church's public address, and two
 * processors that name churches differently would be visible to customers. The
 * shared reserved-label set comes from `NON_TENANT_SUBDOMAINS`, so a new
 * non-tenant subdomain is automatically unassignable on both paths.
 */
export async function generateUniqueSubdomain(ministryName: string): Promise<string> {
  const RESERVED = new Set([...NON_TENANT_SUBDOMAINS, 'api', 'harvest', 'nations', 'platform']);
  const base = (ministryName || 'ministry')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'ministry';

  let candidate = base;
  for (let i = 0; i < 10; i++) {
    const exists = (await adminDb.collection('tenants').doc(candidate).get()).exists;
    if (!RESERVED.has(candidate) && !exists) return candidate;
    const suffix = Math.random().toString(36).slice(2, 6);
    candidate = `${base}-${suffix}`.slice(0, 40);
  }
  return candidate;
}

/** What `provisionTenantFromDodoSubscription` decided. */
export type DodoProvisioningOutcome =
  | { readonly outcome: 'created'; readonly tenantId: string; readonly plan: TenantPlan; readonly period: BillingPeriod }
  /** Not a new-ministry signup. Correct and complete: do nothing. */
  | { readonly outcome: 'not-a-signup' }
  /** This subscription, or this user, already has a tenant. */
  | { readonly outcome: 'already-provisioned'; readonly tenantId: string };

/**
 * Resolve the plan a Dodo product sells, or fail loudly.
 *
 * ⚠️ NO DEFAULT, EVER. `resolvePlanFromProductId` returns null for an add-on
 * product, a live-mode id, or anything created by hand in the dashboard. Reading
 * null as `plus` is the failure this function exists to make impossible: the
 * customer is charged the Ministry price by Dodo and served the Individual tier
 * by Harvest, and nothing anywhere reports a problem.
 */
export function requirePlanForProduct(productId: string): { plan: TenantPlan; period: BillingPeriod } {
  const resolved = productId ? resolvePlanFromProductId(productId) : null;
  if (!resolved) {
    throw new DodoProvisioningError(
      'unknown-product',
      `[dodo] Refusing to provision: product "${productId}" is not in this build's catalogue. ` +
        'It is NOT defaulted to a plan — an unrecognised product means the running build and ' +
        'the Dodo account disagree about what was sold, and guessing the cheapest tier would ' +
        'silently under-serve a paying customer. Add the product to src/lib/dodo/catalogue.ts.',
    );
  }
  return resolved;
}

/**
 * The paying owner's email — from Firebase Auth, falling back to the Dodo
 * customer on the subscription.
 *
 * This value IS the admin roster. An empty roster is THE-64: every admin of that
 * tenant is locked out of the admin area, because `inTenantAdminEmails` in
 * firestore.rules and `/api/tenants/roster-status` both read exactly this list.
 * Both sources failing is therefore reported, not swallowed — the same two-stage
 * lookup, and the same Sentry levels, as the Stripe handler.
 */
async function resolveOwnerEmail(
  userId: string,
  sub: DodoSubscriptionPayload,
  ids: Record<string, string | undefined>,
): Promise<string> {
  let userEmail = '';
  try {
    const u = await adminAuth.getUser(userId);
    userEmail = u.email || '';
  } catch (userErr) {
    console.error('[dodo] new-tenant: failed to load paying user:', userErr);
    captureMoneyPathError(userErr, { step: 'dodo-new-tenant-load-paying-user', level: 'warning', ids });
  }
  if (!userEmail) {
    const customerEmail = str(sub.customer?.email);
    if (customerEmail) {
      userEmail = customerEmail;
    } else {
      // Both sources gone: the tenant is created with an EMPTY roster and its
      // own paying owner cannot reach the admin area. Error, not warning.
      captureMoneyPathError(
        new Error('[dodo] new tenant has no owner email from Auth or the Dodo customer'),
        { step: 'dodo-new-tenant-owner-email-missing', level: 'error', ids },
      );
    }
  }
  return userEmail;
}

/**
 * Has this subscription already built a tenant?
 *
 * A second guard behind the webhook-id reservation, covering the case that
 * reservation cannot: a redelivery that arrives after a previous attempt failed
 * PART-WAY and released its reservation. Keyed on the subscription id, which is
 * the one value a redelivery is guaranteed to repeat.
 */
async function findTenantForSubscription(subscriptionId: string): Promise<string | null> {
  const snap = await adminDb
    .collection(TENANT_PRIVATE_COLLECTION)
    .where('dodoSubscriptionId', '==', subscriptionId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * Create the tenant for a paid Dodo signup.
 *
 * @throws {DodoProvisioningError} for an unknown product or a payload missing
 *   the identifiers provisioning cannot proceed without. The caller must turn a
 *   throw into a non-2xx so Dodo redelivers.
 */
export async function provisionTenantFromDodoSubscription(
  sub: DodoSubscriptionPayload,
): Promise<DodoProvisioningOutcome> {
  const subscriptionId = str(sub.subscription_id);
  const productId = str(sub.product_id);

  const meta = readSignupMetadata(sub.metadata);
  if (!meta) return { outcome: 'not-a-signup' };

  if (!subscriptionId) {
    throw new DodoProvisioningError(
      'missing-subscription-id',
      '[dodo] Refusing to provision: the subscription payload carries no subscription_id, ' +
        'so the tenant could not be linked to what the customer is paying for.',
    );
  }

  // Fail on an unknown product BEFORE writing anything.
  const { plan, period } = requirePlanForProduct(productId);

  // ── Idempotency guard 1: this subscription already built a tenant. ─────────
  const existingForSub = await findTenantForSubscription(subscriptionId);
  if (existingForSub) {
    console.log(`⏭️ [dodo] Subscription ${subscriptionId} already provisioned tenant ${existingForSub}`);
    return { outcome: 'already-provisioned', tenantId: existingForSub };
  }

  // ── Idempotency guard 2: this user already has a tenant. ───────────────────
  // The same guard the Stripe path carries, for the same reason: a DISTINCT
  // second paid session for the same user must not build a second church and
  // detach them from the first.
  const existingUserSnap = await adminDb.collection('users').doc(meta.userId).get();
  const existingTenantId = existingUserSnap.exists ? existingUserSnap.data()?.tenantId : null;
  if (existingTenantId) {
    console.log(`⏭️ [dodo] User ${meta.userId} already has tenant ${existingTenantId}; skipping new-tenant build`);
    return { outcome: 'already-provisioned', tenantId: existingTenantId };
  }

  const newTenantId = await generateUniqueSubdomain(meta.ministryName);
  const ids = { subscriptionId, userId: meta.userId, newTenantId, productId };
  const userEmail = await resolveOwnerEmail(meta.userId, sub, ids);

  // ── The add-on set, written even when it is empty (REP-5a). ───────────────
  //
  // Nothing sells an add-on at signup yet, so this is `NO_ADDONS` in practice.
  // It is still written: an ABSENT field and an EMPTY one read the same to a cap
  // check but not to a person debugging one, and a tenant created today with no
  // `addons` key is indistinguishable from a tenant whose add-on write failed.
  // A new tenant has no prior value to lose, so an unreadable payload writes the
  // empty set here rather than nothing — the opposite of the rule on an EXISTING
  // tenant, where absent must never overwrite.
  const entitlements = readDodoAddonEntitlements(sub);
  const addons: TenantAddons = entitlements ? entitlements.addons : readTenantAddons(null);
  if (entitlements) {
    reportUnrecognisedDodoAddons(entitlements.unrecognised, {
      step: 'dodo-provisioning-unrecognised-addon',
      subscriptionId,
      tenantId: newTenantId,
    });
  }

  const now = new Date().toISOString();

  // The world-readable tenant doc carries only the pre-auth/public fields; the
  // admin roster + billing identifiers live exclusively on the server-only
  // tenant_private doc. ONE batch: both land, or neither does. A tenant doc
  // without its private doc is a church whose every admin is locked out.
  const batch = adminDb.batch();
  batch.set(adminDb.collection('tenants').doc(newTenantId), {
    name: meta.ministryName || 'My Ministry',
    subdomain: newTenantId,
    plan,
    // MEANINGS ONLY — never a Dodo add-on id on this world-readable doc.
    addons,
    status: TENANT_STATUS_ACTIVE,
    config: {},
    ownerId: meta.userId,
    createdBy: meta.userId,
    setupCompleted: false, // gates the first-run "Finish setup" screen
    createdAt: now,
    updatedAt: now,
  });
  batch.set(tenantPrivateRef(newTenantId), {
    adminEmails: userEmail ? [userEmail] : [],
    // Dodo identifiers only. No `stripe*` key is written on this path — see the
    // module note; the Stripe fields belong to the rollback, not to this tenant.
    dodoCustomerId: str(sub.customer?.customer_id) || null,
    dodoSubscriptionId: subscriptionId,
    dodoProductId: productId,
    // 🔴 Who owns this subscription, stated rather than inferred. Every billing
    // write path routes on it (`@/lib/billing-processor`), and it is what stops a
    // later plan change from opening a SECOND subscription on Stripe and billing
    // this church twice. Written in the same batch as the identifiers it
    // describes, so the two can never disagree.
    billingProcessor: 'dodo',
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();

  // Assign the paying user as admin and mint their claim. Same field set, same
  // order, as the Stripe handler — `signupInProgress: false` is what releases
  // OnboardingGate from its "Setting up your account…" poll.
  await adminDb.collection('users').doc(meta.userId).update({
    tenantId: newTenantId,
    role: 'admin',
    plan,
    onboardingCompleted: true,
    signupInProgress: false,
    updatedAt: now,
  });
  await setCustomClaims(meta.userId);

  console.log(
    `✅ [dodo] Created tenant ${newTenantId} for new ministry "${meta.ministryName}" ` +
      `(admin ${meta.userId}, plan ${plan}/${period}, subscription ${subscriptionId})`,
  );

  return { outcome: 'created', tenantId: newTenantId, plan, period };
}

/**
 * Bring an EXISTING tenant's stored add-on set in line with the subscription.
 *
 * Defensive, and deliberately narrower than the creation path above: an
 * unreadable `addons` field writes NOTHING here, because this tenant already has
 * a set and "the payload did not say" must never overwrite "the church owns
 * three campuses". Idempotent by comparison — an identical set is not rewritten,
 * so a redelivery of `subscription.active` cannot touch `updatedAt` either.
 *
 * `subscription.plan_changed` remains the primary writer (see `./plan-change`);
 * this exists so a reactivation or a dashboard-created subscription that already
 * carries add-ons is not left with a stale set until the next plan change.
 */
async function syncAddonsForExistingTenant(
  tenantId: string,
  sub: DodoSubscriptionPayload,
): Promise<void> {
  const entitlements = readDodoAddonEntitlements(sub);
  if (!entitlements) return;

  const subscriptionId = str(sub.subscription_id);
  reportUnrecognisedDodoAddons(entitlements.unrecognised, {
    step: 'dodo-subscription-active-unrecognised-addon',
    subscriptionId,
    tenantId,
  });

  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  const snap = await tenantRef.get();
  if (!snap.exists) return;
  if (sameTenantAddons(readTenantAddons(snap.data()?.addons), entitlements.addons)) return;

  await tenantRef.update({ addons: entitlements.addons, updatedAt: new Date().toISOString() });
  console.log(`✅ [dodo] Synced add-on set for tenant ${tenantId} from subscription ${subscriptionId}`);
}

/**
 * The `subscription.active` handler.
 *
 * `subscription.active` — not `payment.succeeded` — is the provisioning trigger:
 * Dodo has no `checkout.session.completed`, and `subscription.active` is the one
 * event that means "the mandate exists and recurring charges are scheduled",
 * which is precisely the state the Stripe handler's `checkout.session.completed`
 * represented. On a 14-day card-up-front trial there is no successful payment to
 * wait for, so provisioning on a payment event would strand every trial signup.
 *
 * ─── It is also the REACTIVATION trigger ─────────────────────────────────────
 *
 * 🔴 `subscription.active` on a tenant that already exists used to be a pure
 * no-op ('already-provisioned'), which was right while nothing ever archived a
 * tenant. Now that `subscription.cancelled` / `subscription.expired` archive one
 * (`./lifecycle`), the same event is how an archived church comes back — a new
 * subscription for a tenant that already exists IS a reactivation, and leaving
 * it a no-op would mean a church could pay again and stay switched off.
 *
 * ⚠️ Reactivation is TOTAL: same subdomain, same data, same members. It is total
 * because archiving took nothing away — see the note in `./lifecycle`. The
 * restore writes only when the tenant is actually archived, so the ordinary
 * case (a fresh signup, or a redelivery of one) is unchanged and writes nothing.
 *
 * ─── It also keeps the add-on set current (REP-5a) ───────────────────────────
 *
 * Defensively, per the brief: nothing sells an add-on at signup yet, so a fresh
 * signup writes the empty set. An ALREADY-PROVISIONED tenant is synced only from
 * a payload that actually reports its add-ons — see `syncAddonsForExistingTenant`.
 */
export async function handleDodoSubscriptionActive(
  event: DodoWebhookEvent,
): Promise<DodoProvisioningOutcome> {
  const payload = (event.data || {}) as unknown as DodoSubscriptionPayload;
  const result = await provisionTenantFromDodoSubscription(payload);

  if (result.outcome === 'already-provisioned') {
    // Failure to restore must NOT turn a successful provisioning outcome into a
    // retryable error: the tenant exists and is correct either way, and
    // `subscription.active` is DURABLE — a throw here would make Dodo redeliver
    // an event that has nothing left to do. Reported, then swallowed.
    try {
      await reactivateTenantForDodoSubscription(result.tenantId);
    } catch (err) {
      console.error(`[dodo] Could not reactivate tenant ${result.tenantId}:`, err);
      captureMoneyPathError(err, {
        step: 'dodo-reactivate-tenant',
        level: 'error',
        tenantId: result.tenantId,
        ids: { subscriptionId: str(payload.subscription_id) },
      });
    }

    // Same swallow, same reason: the tenant exists and its TIER is right either
    // way, and a durable event must not be redelivered forever over an add-on
    // sync. The `plan_changed` handler is the primary writer and will correct it.
    try {
      await syncAddonsForExistingTenant(result.tenantId, payload);
    } catch (err) {
      console.error(`[dodo] Could not sync add-ons for tenant ${result.tenantId}:`, err);
      captureMoneyPathError(err, {
        step: 'dodo-subscription-active-addon-sync',
        level: 'error',
        tenantId: result.tenantId,
        ids: { subscriptionId: str(payload.subscription_id) },
      });
    }
  }

  return result;
}
