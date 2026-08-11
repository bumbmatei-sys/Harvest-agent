import type { TenantStatus } from '@/types/tenant.types';

/**
 * What a tenant may still do, derived from its lifecycle state.
 *
 * ─── One field, and it is `tenants/{id}.status` ───────────────────────────────
 *
 * 🔴 REP-4's recorded decision needs a place to live, and there are only two
 * candidates on the tenant doc. `plan` is the TIER — which product the church
 * bought — and `status` is the LIFECYCLE — where they are in their relationship
 * with billing. This module reads `status`, exclusively, and no new field is
 * introduced for it to consult.
 *
 * ⚠️ STATED PLAINLY, because it is the finding this PR turns up: the app reads
 * TIER entitlement from `tenants/{id}.plan` (`getPlanFeatures` / `getPlanLimits`
 * / `usePlanGate`, every one of them keyed on the plan) and reads NO entitlement
 * from `status` at all. `status` is written on the money path today — the Stripe
 * webhook sets 'cancelled' on `customer.subscription.deleted`, 'past_due' and
 * 'suspended' on a failed payment — and then nothing anywhere gates on it. It is
 * a recorded state with no enforcement behind it.
 *
 * So this module is the enforcement, and `status` is where lifecycle entitlement
 * is read from. `plan` keeps its one job (which tier) and this keeps its one job
 * (whether the lifecycle still permits the action). Two fields, two questions,
 * neither a second answer to the other's question.
 *
 * ─── Downgrade, never lock out ───────────────────────────────────────────────
 *
 * The capability split below is not a policy this module invented; it is REP-4's
 * decision transcribed, and each half of it is load-bearing:
 *
 *   NEVER GATED — login, admin read, and EVERY export. A church has a legal need
 *   for its own giving records, and withholding a donor CSV or a year-end
 *   statement behind a paywall is indefensible. `export` is structurally
 *   unconditional here (see `NEVER_GATED`) rather than "true in every state we
 *   listed", so gating it requires deleting it from that list — a visible edit
 *   that a test fails on, not a state someone forgot to enumerate.
 *
 *   STOPPED WHEN ARCHIVED — giving first, then publishing and sending. Giving is
 *   first because at a 0% platform fee a live donate page is the most valuable
 *   surface in the product, and leaving it up means giving the product away
 *   indefinitely.
 *
 * ─── Why an unknown state is ALLOWED, not refused ────────────────────────────
 *
 * ⚠️ This is the one place the usual "fail closed" instinct is wrong, and it is
 * deliberate. Failing closed on an unrecognised or missing `status` would strip
 * giving from every tenant whose doc predates this field or carries a value this
 * build does not know — churches that are paying, in good standing, and did
 * nothing. The failure mode of allowing is revenue: an archived church that
 * somehow reaches an ungated state keeps a surface it should not have. The
 * failure mode of refusing is a live church's donate page going dark on a deploy.
 * Those are not comparable, and only one of them is reversible in a hurry.
 *
 * Concretely, only `archived` gates anything. 'active', 'pending', 'suspended',
 * 'past_due', 'cancelled', and anything unrecognised all behave exactly as they
 * do today — which is what keeps every Stripe-owned tenant untouched by this PR.
 */

/**
 * The terminal lifecycle state a Dodo subscription's end lands a tenant in.
 *
 * ARCHIVED, not deleted and not disabled. The subdomain, the data, the members,
 * and the `plan` field all survive untouched, because reactivation has to be
 * total — that is the entire payoff for not deleting, and it is what makes an
 * archived church a warm lead rather than a lost one.
 */
export const TENANT_STATUS_ARCHIVED = 'archived';

/** The lifecycle state a tenant returns to when its subscription comes back. */
export const TENANT_STATUS_ACTIVE = 'active';

/** The things a lifecycle state can permit or refuse. */
export type TenantCapability =
  /** Sign in. Never refused. */
  | 'login'
  /** Read the admin area and the church's own data. Never refused. */
  | 'adminRead'
  /** Download giving records, donor lists, statements. 🔴 NEVER refused. */
  | 'export'
  /** Accept an online donation. First to stop, first to return. */
  | 'giving'
  /** Publish a post, a course, an event. */
  | 'publishing'
  /** Send a newsletter or a broadcast. */
  | 'sending';

/**
 * Capabilities no lifecycle state may take away.
 *
 * 🔴 `export` is on this list and must stay on it. Removing it is what test 3
 * ("every export still works for a cancelled tenant") exists to catch.
 */
export const NEVER_GATED: readonly TenantCapability[] = ['login', 'adminRead', 'export'];

/** Capabilities the archived state stops. Ordered as REP-4 orders them. */
export const GATED_WHEN_ARCHIVED: readonly TenantCapability[] = ['giving', 'publishing', 'sending'];

/** Every capability, for exhaustive iteration in tests and UI. */
export const TENANT_CAPABILITIES: readonly TenantCapability[] = [...NEVER_GATED, ...GATED_WHEN_ARCHIVED];

/**
 * True when `status` is the terminal archived state.
 *
 * Takes `unknown` on purpose: every caller is reading a Firestore field, and a
 * signature that promised `TenantStatus` would be a claim about untrusted data
 * rather than a check on it.
 */
export function isArchivedTenantStatus(status: unknown): boolean {
  return status === TENANT_STATUS_ARCHIVED;
}

/**
 * May a tenant in this lifecycle state do this?
 *
 * The single predicate. The server-side giving gate on `/api/stripe/donate` and
 * every client-side gate ask this same question of this same field, so there is
 * no second place a cancelled tenant can still be permitted something.
 */
export function tenantAllows(status: unknown, capability: TenantCapability): boolean {
  if (NEVER_GATED.includes(capability)) return true;
  return !isArchivedTenantStatus(status);
}

/** The whole capability set for a state — what a UI wants in one read. */
export function tenantCapabilities(status: unknown): Readonly<Record<TenantCapability, boolean>> {
  const out = {} as Record<TenantCapability, boolean>;
  for (const capability of TENANT_CAPABILITIES) out[capability] = tenantAllows(status, capability);
  return Object.freeze(out);
}

/**
 * What a donor is told when a church's giving is stopped.
 *
 * Says nothing about billing. The person reading it is a donor who came to give
 * money to their church, not the admin who cancelled — telling them "this
 * ministry's subscription lapsed" would air a customer's billing status to the
 * public, which is a different and worse problem than a disabled button.
 */
export const GIVING_UNAVAILABLE_MESSAGE =
  'This ministry is not accepting online giving at the moment.';

/** What an admin of an archived tenant is told at a stopped surface. */
export const ARCHIVED_ACTION_MESSAGE =
  'Your subscription has ended, so publishing and sending are paused. Your data, your members ' +
  'and every export are still here — reactivate to turn everything back on.';

/**
 * Re-exported so a caller can annotate a `TenantStatus` value without importing
 * two modules. The type itself stays in tenant.types.ts with the Tenant doc.
 */
export type { TenantStatus };
