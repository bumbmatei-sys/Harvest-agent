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

/**
 * How long a FAILED RENEWAL buys before entitlements stop. REP-4's decision.
 *
 * ─── Why Harvest owns this timer at all ──────────────────────────────────────
 *
 * 🔴 Dodo emits `subscription.on_hold` after a failed renewal, runs its own
 * retries and dunning, and then NEVER CANCELS. At the end of its recovery window
 * the retries simply stop and the subscription sits in `on_hold` indefinitely —
 * no `cancelled`, no `expired`, no terminal event of any kind. Nothing else will
 * ever end that state, so a church whose card failed would keep full
 * entitlements forever, donate page included, at a 0% platform fee.
 *
 * ─── ⚠️ THE ASSUMPTION THIS NUMBER RESTS ON, stated here so the next reader does
 *     not have to find it in a roadmap ──────────────────────────────────────────
 *
 * Dodo's recovery window is configured in Dodo's own dashboard, NOT here, and
 * this constant assumes it is set to LESS THAN 21 days (THE-90). That ordering is
 * the whole design:
 *
 *   Dodo's retries stop  ──────►  Harvest archives
 *        (< 21 days)                 (day 21)
 *
 * Harvest's timer is deliberately the OUTER bound. While Dodo is still retrying,
 * the church is inside grace and keeps everything — so the two systems are not
 * both counting down against each other; one runs out, then the other fires.
 *
 * 🔴 If Dodo's window were ever set LONGER than 21 days, Harvest would archive a
 * church that Dodo was still actively trying to charge — and a retry succeeding
 * afterwards would arrive as `subscription.active` and reactivate them, so the
 * failure is a temporary wrongful shutoff rather than a permanent one. That is
 * the reason this is an assumption worth writing down rather than reconciling at
 * runtime: there is no API that reports the window, and guessing it from observed
 * retry traffic would be a timer driven by the thing it is supposed to bound.
 */
export const DODO_GRACE_PERIOD_DAYS = 21;

/** The same window in milliseconds — what the resolver actually compares. */
export const DODO_GRACE_PERIOD_MS = DODO_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

/**
 * Where a tenant sits relative to its grace window.
 *
 * ⚠️ NOT a `TenantStatus` and deliberately not added to that union. `status` has
 * exactly one gating value (`archived`) and this keeps it that way: grace is
 * derived from a timestamp at read time, never recorded as a state. A second
 * recorded state that gated things would be a second source of entitlement truth,
 * which is the one thing `tenant-lifecycle` exists to prevent.
 */
export type TenantGraceState =
  /** No hold recorded — the overwhelmingly common case. */
  | 'none'
  /** A hold is recorded and the window has NOT run out. Full entitlements. */
  | 'in-grace'
  /** The window has run out. The tenant is treated as archived. */
  | 'expired';

/** What the grace resolver needs. `now` is injected — see the note below. */
export interface TenantGraceInput {
  /** `tenants/{id}.status`, straight off the document. */
  readonly status?: unknown;
  /** `tenant_private/{id}.dodoOnHoldAt` — an ISO string, or absent. */
  readonly onHoldAt?: unknown;
  /** Milliseconds since the epoch. 🔴 Injected, never read inside. */
  readonly now: number;
}

/**
 * Where this tenant sits in its grace window.
 *
 * 🔴 PURE, and `now` is a parameter rather than a `Date.now()` call inside. That
 * is not a testing convenience bolted on afterwards — it is what lets both sides
 * of a 21-day boundary be exercised with two plain integers instead of fake
 * timers, and it is why the giving gate and the convergence path can be shown to
 * agree by construction rather than by both being mocked the same way.
 *
 * ⚠️ A missing, empty or UNPARSEABLE `onHoldAt` is 'none' — no gate. Same
 * fail-OPEN reasoning as an unknown `status` above: the failure mode of allowing
 * is revenue, and the failure mode of refusing is a paying church's donate page
 * going dark because a timestamp did not parse. Those are not comparable.
 */
export function resolveTenantGraceState({ onHoldAt, now }: TenantGraceInput): TenantGraceState {
  if (typeof onHoldAt !== 'string' || onHoldAt === '') return 'none';

  const heldAt = Date.parse(onHoldAt);
  if (Number.isNaN(heldAt)) return 'none';

  // `>=` so the window is CLOSED at exactly 21 days: day 21 is expired, not the
  // last day of grace. Stated because "21 days" alone does not say which side of
  // the boundary the moment itself falls on, and the tests pin both.
  return now - heldAt >= DODO_GRACE_PERIOD_MS ? 'expired' : 'in-grace';
}

/**
 * The lifecycle state to ENFORCE, which is not always the one recorded.
 *
 * 🔴 THE ONE FUNCTION THE GIVING GATE ADDS. A tenant whose grace window has run
 * out is still recorded `active` — Dodo sent no terminal event, so nothing has
 * written a new status yet — and this is what makes it behave as archived
 * anyway. Feed the result to `tenantAllows` and every capability answer follows
 * from the existing table; no capability list is duplicated, and `export`,
 * `login` and `adminRead` stay unconditional because they are unconditional
 * THERE.
 *
 * ⚠️ Returns the recorded status untouched in every other case, so a tenant with
 * no hold — every Stripe-owned tenant, and every Dodo tenant in good standing —
 * takes exactly the path it takes today.
 */
export function resolveEffectiveTenantStatus({ status, onHoldAt, now }: TenantGraceInput): unknown {
  return resolveTenantGraceState({ onHoldAt, now }) === 'expired' ? TENANT_STATUS_ARCHIVED : status;
}

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
