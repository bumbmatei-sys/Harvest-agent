import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { setCustomClaims } from '@/lib/set-custom-claims';
import { tenantPrivateRef, TENANT_PRIVATE_COLLECTION } from '@/lib/tenant-private';
import { NON_TENANT_SUBDOMAINS } from '@/utils/non-tenant-subdomains';
import type { TenantPlan } from '@/types/tenant.types';
import { resolvePlanFromProductId } from './catalogue';
import type { BillingPeriod } from './provider';
import type { DodoWebhookEvent } from './events';

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
 * The `subscription.active` handler.
 *
 * `subscription.active` — not `payment.succeeded` — is the provisioning trigger:
 * Dodo has no `checkout.session.completed`, and `subscription.active` is the one
 * event that means "the mandate exists and recurring charges are scheduled",
 * which is precisely the state the Stripe handler's `checkout.session.completed`
 * represented. On a 14-day card-up-front trial there is no successful payment to
 * wait for, so provisioning on a payment event would strand every trial signup.
 */
export async function handleDodoSubscriptionActive(
  event: DodoWebhookEvent,
): Promise<DodoProvisioningOutcome> {
  const payload = (event.data || {}) as unknown as DodoSubscriptionPayload;
  return provisionTenantFromDodoSubscription(payload);
}
