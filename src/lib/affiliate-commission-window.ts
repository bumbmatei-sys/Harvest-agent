/**
 * The 12-month affiliate commission window.
 *
 * Founder decision: an affiliate earns 30% of what each referred church pays for
 * the FIRST 12 MONTHS FROM THAT CHURCH'S SIGNUP — not forever. Before this module
 * the affiliate code had no time dimension at all: `affiliate-payout.ts` and both
 * commission paths in the Stripe webhook contained no date, month or duration
 * logic, so a referral paid out for as long as Stripe kept charging it.
 *
 * ── Why this lives in ONE module ────────────────────────────────────────────────
 * Three call sites touch commissions (the initial commission via two callers, and
 * the recurring commission), and the retention / super-admin / minimum-plan bugs
 * in this codebase all came from the same shape: a rule hand-copied into several
 * places and then edited in one of them. The window rule is therefore expressed
 * exactly once, here, and imported. Nothing recomputes it inline.
 *
 * ── What is gated, and what deliberately is not ─────────────────────────────────
 *  - GATED: the RECURRING commission (invoice.payment_succeeded). It is the only
 *    path where real time has elapsed since signup, so it is the only path the cap
 *    can ever bite on.
 *  - NOT GATED: the INITIAL commission. It is created by the checkout that starts
 *    the subscription, so its period IS the anchor instant — the window cannot have
 *    elapsed yet. Gating it would add a way to break the highest-value payout in
 *    the system in exchange for guarding a case that cannot occur.
 *  - NOT GATED: the payout paths (`sweepPendingAffiliateCommissions`, the hourly
 *    `retry-transfers` cron). Those move money for commission rows that ALREADY
 *    exist, and a row only exists because this window allowed it at creation time.
 *    Re-checking there would silently withhold a legitimately-earned month-11
 *    commission that happens to be swept in month 14 — which is precisely the
 *    failure mode this module is written to avoid.
 *
 * ── Two invariants this module must not break ───────────────────────────────────
 *  1. It gates WHETHER a commission row is created. It never touches, scales or
 *     recomputes a stored `commission` amount. A legacy 20% row still pays 20%.
 *  2. It never touches `affiliateReferralCount`. That counter reflects converted
 *     referrals, is bumped only by the initial commission, and the clock running
 *     out does not un-convert a referral.
 */

/** The window length. Twelve CALENDAR months, not 365 days. */
export const AFFILIATE_COMMISSION_WINDOW_MONTHS = 12;

/** Where an anchor came from. `none` means we could not resolve one at all. */
export type AffiliateWindowAnchorSource = 'subscription.start_date' | 'subscription.created' | 'none';

/** Where a billed-period start came from. `none` means we could not resolve one. */
export type AffiliateWindowPeriodSource = 'invoice.lines.period.start' | 'invoice.period_start' | 'none';

export type AffiliateWindowReason =
  /** Compared, and the billed period starts inside the window. Pay. */
  | 'within-window'
  /** Compared, and the billed period starts at or after the cutoff. Do not pay. */
  | 'window-elapsed'
  /** No usable signup anchor. FAIL-SAFE: pay, and log loudly. */
  | 'anchor-unresolved'
  /** No usable invoice period. FAIL-SAFE: pay, and log loudly. */
  | 'period-unresolved';

export interface AffiliateWindowDecision {
  /** Whether a commission may be created for this invoice. */
  within: boolean;
  reason: AffiliateWindowReason;
  /**
   * True when `within` was granted by the fail-safe rather than by an actual
   * comparison. Callers MUST log this loudly — it means we paid without being able
   * to prove the referral is still inside its window.
   */
  failSafe: boolean;
  anchorMs: number | null;
  anchorSource: AffiliateWindowAnchorSource;
  /** The resolved signup instant, ISO-8601 UTC. */
  anchorAt: string | null;
  windowEndsAtMs: number | null;
  /** The cutoff instant, ISO-8601 UTC. EXCLUSIVE — see `isPeriodWithinWindow`. */
  windowEndsAt: string | null;
  periodStartMs: number | null;
  periodStartSource: AffiliateWindowPeriodSource;
  /** The start of the service period this invoice bills, ISO-8601 UTC. */
  periodStartAt: string | null;
}

/**
 * The subset of a Stripe Subscription this module reads. Declared structurally so
 * a real `Stripe.Subscription` satisfies it, the unit tests need no Stripe
 * fixtures, and an API-version field reshuffle degrades to `anchor-unresolved`
 * (which pays) rather than throwing on the money path.
 */
export interface AffiliateWindowSubscriptionLike {
  id?: string;
  /** Stripe: when the subscription was FIRST created. Unix seconds. */
  start_date?: unknown;
  created?: unknown;
}

/** The subset of a Stripe Invoice this module reads. See the note above. */
export interface AffiliateWindowInvoiceLike {
  id?: string;
  /** Unix seconds. */
  period_start?: unknown;
  lines?: { data?: ReadonlyArray<{ period?: { start?: unknown } | null } | null> | null } | null;
}

/**
 * Stripe timestamps are Unix SECONDS. Accept a finite positive number (or a
 * numeric string, since metadata round-trips can stringify), and reject
 * everything else — `null`, `undefined`, `NaN`, `Infinity`, `0`, negatives,
 * non-numeric strings, objects.
 *
 * `0` is rejected on purpose. It is a technically-valid epoch instant that Stripe
 * never returns for a real subscription or invoice, so in practice it means
 * "unset" — and treating it as a genuine 1970 anchor would make every referral
 * look 55 years expired. That is the exact silent-underpay bug this module exists
 * to prevent, so `0` degrades to "unresolved", which pays.
 */
function unixSecondsToMs(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000);
}

function toIso(ms: number | null): string | null {
  if (ms === null) return null;
  const iso = new Date(ms).toISOString();
  return iso;
}

/**
 * Add calendar months to an epoch instant, in UTC.
 *
 * Everything in this module is an absolute UTC instant derived from a Stripe Unix
 * timestamp, and comparisons are numeric epoch milliseconds. No local-time string
 * is ever parsed, so there is no timezone by which a commission could silently
 * shift across the boundary — the failure mode the brief calls out first.
 *
 * Day-of-month overflow rolls FORWARD, which is the only case where the arithmetic
 * is not exact: a Feb-29 signup lands on Mar 1 of the following year rather than
 * Feb 28. That is one extra day of window, i.e. it errs toward paying the
 * affiliate — the same direction as every other fallback here.
 */
export function addMonthsUtc(epochMs: number, months: number): number {
  const d = new Date(epochMs);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + months,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

/** The instant an anchor's 12-month window closes. Exclusive. */
export function affiliateWindowEndMs(anchorMs: number): number {
  return addMonthsUtc(anchorMs, AFFILIATE_COMMISSION_WINDOW_MONTHS);
}

/** The instant an anchor's window closes, ISO-8601 UTC — for stamping onto rows. */
export function affiliateWindowEndIso(anchorMs: number): string {
  return new Date(affiliateWindowEndMs(anchorMs)).toISOString();
}

/**
 * Resolve the SIGNUP anchor for a referral.
 *
 * ── Why the subscription, and not a referral record ─────────────────────────────
 * There is no `referrals` collection in this codebase. The only thing that links a
 * referrer to a referred church is `referrerId` in the Stripe SUBSCRIPTION
 * metadata, stamped at checkout and carefully preserved by every later metadata
 * write. The subscription IS the referral record, so its own creation timestamp is
 * the referral's signup instant — no second date to drift, and nothing to backfill.
 *
 * `tenants.createdAt` was rejected outright: an existing church that has been on
 * Harvest for three years and then upgrades through an affiliate link would be born
 * already expired.
 *
 * ── start_date, i.e. TRIAL start, not conversion ────────────────────────────────
 * `start_date` is Stripe's "when this subscription was first created", which for a
 * 7-day card-up-front trial is the trial start — a week before the first paid
 * invoice. Signup is deliberately what the founder decision says: when the church
 * signed up. It also happens to make the two signup shapes agree at exactly twelve
 * commissions each (see the boundary note on `isPeriodWithinWindow`).
 *
 * `created` is the fallback because it equals `start_date` for every normally
 * created subscription and differs only when a subscription was backdated.
 */
export function resolveAffiliateWindowAnchor(
  subscription: AffiliateWindowSubscriptionLike | null | undefined,
): { anchorMs: number | null; source: AffiliateWindowAnchorSource } {
  const startDate = unixSecondsToMs(subscription?.start_date);
  if (startDate !== null) return { anchorMs: startDate, source: 'subscription.start_date' };
  const created = unixSecondsToMs(subscription?.created);
  if (created !== null) return { anchorMs: created, source: 'subscription.created' };
  return { anchorMs: null, source: 'none' };
}

/**
 * Resolve the start of the service period an invoice bills.
 *
 * The cap is a cutoff on the INVOICE PERIOD, never on when the webhook happens to
 * fire. A month-11 invoice that is dunned, retried, or redelivered in month 14 is
 * still a month-11 invoice and still pays; nothing here reads a delivery time or a
 * wall clock.
 *
 * Line periods win over the invoice-level `period_start` because they describe the
 * subscription line actually being billed. Where several lines carry periods (a
 * proration credit alongside the new cycle) the EARLIEST is used: it is the
 * earliest service being paid for on this invoice, and it errs toward paying.
 */
export function resolveInvoicePeriodStart(
  invoice: AffiliateWindowInvoiceLike | null | undefined,
): { periodStartMs: number | null; source: AffiliateWindowPeriodSource } {
  const lines = Array.isArray(invoice?.lines?.data) ? invoice!.lines!.data! : [];
  let earliest: number | null = null;
  for (const line of lines) {
    const start = unixSecondsToMs(line?.period?.start);
    if (start !== null && (earliest === null || start < earliest)) earliest = start;
  }
  if (earliest !== null) return { periodStartMs: earliest, source: 'invoice.lines.period.start' };

  const periodStart = unixSecondsToMs(invoice?.period_start);
  if (periodStart !== null) return { periodStartMs: periodStart, source: 'invoice.period_start' };

  return { periodStartMs: null, source: 'none' };
}

/**
 * THE BOUNDARY, in one line: a billed period earns a commission when it STARTS
 * STRICTLY BEFORE the 12-month anniversary of signup.
 *
 * So the anniversary instant itself is EXCLUSIVE, and the twelfth month of service
 * is INCLUSIVE. Worked through, with a Jan 1 2025 signup on a monthly plan:
 *
 *   month 1  → period starts Jan 1 2025 (anchor + 0mo)   → paid
 *   month 11 → period starts Nov 1 2025 (anchor + 10mo)  → paid
 *   month 12 → period starts Dec 1 2025 (anchor + 11mo)  → paid  ← last one
 *   month 13 → period starts Jan 1 2026 (anchor + 12mo)  → NOT paid, exactly at the cutoff
 *
 * That yields twelve commissions on either signup shape, which is the check that
 * the anchor choice and the boundary choice agree:
 *   - card charged at signup: 1 initial + 11 renewals = 12
 *   - 7-day trial ($0 initial is skipped): 12 renewals   = 12
 */
export function isPeriodWithinWindow(periodStartMs: number, windowEndsAtMs: number): boolean {
  return periodStartMs < windowEndsAtMs;
}

/**
 * Decide whether an invoice may earn a recurring affiliate commission.
 *
 * ── THE FAIL-SAFE DIRECTION: unresolvable ⇒ PAY ────────────────────────────────
 * A commission that should not exist is cheap and visible — it is one extra row a
 * human can find and reverse. A commission that SHOULD exist and is silently
 * skipped is the expensive failure: an affiliate quietly stops being paid in month
 * six and nobody learns why. So a missing or unparseable anchor is NEVER treated as
 * expired. It returns `within: true` with `failSafe: true`, and the caller is
 * expected to log loudly and report to Sentry so the gap is fixed rather than
 * absorbed. The same applies to an unresolvable invoice period.
 *
 * Only an anchor AND a period that both parse, with the period at or after the
 * cutoff, ever withholds a commission.
 */
export function evaluateAffiliateCommissionWindow(input: {
  subscription: AffiliateWindowSubscriptionLike | null | undefined;
  invoice: AffiliateWindowInvoiceLike | null | undefined;
}): AffiliateWindowDecision {
  const { anchorMs, source: anchorSource } = resolveAffiliateWindowAnchor(input.subscription);
  const { periodStartMs, source: periodStartSource } = resolveInvoicePeriodStart(input.invoice);

  const windowEndsAtMs = anchorMs === null ? null : affiliateWindowEndMs(anchorMs);

  const base = {
    anchorMs,
    anchorSource,
    anchorAt: toIso(anchorMs),
    windowEndsAtMs,
    windowEndsAt: toIso(windowEndsAtMs),
    periodStartMs,
    periodStartSource,
    periodStartAt: toIso(periodStartMs),
  };

  // Fail-safe #1: no signup anchor. Pay; do not guess that it expired.
  if (anchorMs === null || windowEndsAtMs === null) {
    return { ...base, within: true, failSafe: true, reason: 'anchor-unresolved' };
  }

  // Fail-safe #2: an anchor but no billed period to compare it against. Pay.
  if (periodStartMs === null) {
    return { ...base, within: true, failSafe: true, reason: 'period-unresolved' };
  }

  const within = isPeriodWithinWindow(periodStartMs, windowEndsAtMs);
  return {
    ...base,
    within,
    failSafe: false,
    reason: within ? 'within-window' : 'window-elapsed',
  };
}

/**
 * How much window a referral has left, for the affiliate-facing status payload.
 *
 * Read-only and display-only: this never gates a payout. `windowEndsAt` is the
 * value stamped on the referral's commission rows at creation time, so what the
 * affiliate sees is the same cutoff the gate actually applied — not a second
 * calculation that could disagree with it.
 */
export function affiliateWindowRemaining(
  windowEndsAt: string | null | undefined,
  nowMs: number,
): { windowEndsAt: string | null; expired: boolean; daysRemaining: number | null } {
  if (!windowEndsAt) return { windowEndsAt: null, expired: false, daysRemaining: null };
  const endMs = Date.parse(windowEndsAt);
  if (!Number.isFinite(endMs)) return { windowEndsAt: null, expired: false, daysRemaining: null };
  const msLeft = endMs - nowMs;
  return {
    windowEndsAt,
    expired: msLeft <= 0,
    daysRemaining: msLeft <= 0 ? 0 : Math.ceil(msLeft / (24 * 60 * 60 * 1000)),
  };
}
