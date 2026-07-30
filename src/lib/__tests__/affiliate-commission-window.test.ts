import { describe, it, expect } from 'vitest';
import {
  AFFILIATE_COMMISSION_WINDOW_MONTHS,
  addMonthsUtc,
  affiliateWindowEndIso,
  affiliateWindowEndMs,
  affiliateWindowRemaining,
  evaluateAffiliateCommissionWindow,
  isPeriodWithinWindow,
  resolveAffiliateWindowAnchor,
  resolveInvoicePeriodStart,
} from '../affiliate-commission-window';

/**
 * The 12-month affiliate commission window, at the level of the rule itself.
 *
 * The webhook suite (webhook-affiliate-12-month-window.test.ts) drives the same
 * rule end-to-end through invoice.payment_succeeded against a real in-memory
 * Firestore. This file pins the arithmetic and the fail-safe direction directly, so
 * a boundary regression is localised here instead of only surfacing three layers up.
 */

const SECS = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Signup: Jan 1 2025, midnight UTC. The whole worked example in the module header. */
const SIGNUP_ISO = '2025-01-01T00:00:00.000Z';
const SIGNUP_SECS = SECS(SIGNUP_ISO);
const SIGNUP_MS = Date.parse(SIGNUP_ISO);

const sub = (over: Record<string, unknown> = {}) => ({ id: 'sub_A', start_date: SIGNUP_SECS, ...over });
/** An invoice billing a period that starts `months` after signup. */
const invoiceAtMonth = (months: number, over: Record<string, unknown> = {}) => ({
  id: `in_m${months}`,
  period_start: Math.floor(addMonthsUtc(SIGNUP_MS, months) / 1000),
  ...over,
});

describe('the window is 12 calendar months, in UTC', () => {
  it('is twelve months, not 365 days', () => {
    expect(AFFILIATE_COMMISSION_WINDOW_MONTHS).toBe(12);
  });

  it('lands on the calendar anniversary, not 365 days later', () => {
    // 2024 is a leap year, so anchor + 365 days would be Dec 31 2024, a day early.
    expect(new Date(affiliateWindowEndMs(Date.parse('2024-01-01T00:00:00.000Z'))).toISOString())
      .toBe('2025-01-01T00:00:00.000Z');
  });

  it('preserves the time-of-day of the anchor', () => {
    expect(affiliateWindowEndIso(Date.parse('2025-03-09T14:37:22.500Z')))
      .toBe('2026-03-09T14:37:22.500Z');
  });

  it('rolls a Feb-29 anchor FORWARD to Mar 1 — one extra day, in the affiliate\'s favour', () => {
    // The only case where the arithmetic is inexact. It errs toward paying, which is
    // the same direction as every other fallback in the module.
    expect(affiliateWindowEndIso(Date.parse('2024-02-29T00:00:00.000Z')))
      .toBe('2025-03-01T00:00:00.000Z');
  });

  it('is computed in UTC, so no local timezone can shift the boundary', () => {
    // A 23:30 UTC anchor is the PREVIOUS day in the Americas and the NEXT day in
    // Asia. If any local-time parsing crept in, the day-of-month would move.
    expect(affiliateWindowEndIso(Date.parse('2025-06-30T23:30:00.000Z')))
      .toBe('2026-06-30T23:30:00.000Z');
  });
});

describe('the anchor is the subscription — there is no referral record to read', () => {
  it('prefers subscription.start_date (Stripe\'s "first created")', () => {
    expect(resolveAffiliateWindowAnchor({ start_date: SIGNUP_SECS, created: SECS('2025-06-01T00:00:00Z') }))
      .toEqual({ anchorMs: SIGNUP_MS, source: 'subscription.start_date' });
  });

  it('falls back to subscription.created when start_date is absent', () => {
    expect(resolveAffiliateWindowAnchor({ created: SIGNUP_SECS }))
      .toEqual({ anchorMs: SIGNUP_MS, source: 'subscription.created' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['zero (Stripe never returns it — means unset, NOT a 1970 anchor)', 0],
    ['negative', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a non-numeric string', 'yesterday'],
    ['an object', { seconds: SIGNUP_SECS }],
  ])('treats %s as no anchor rather than as an expired one', (_label, value) => {
    expect(resolveAffiliateWindowAnchor({ start_date: value, created: value }))
      .toEqual({ anchorMs: null, source: 'none' });
  });

  it('accepts a numeric STRING, since metadata round-trips stringify', () => {
    expect(resolveAffiliateWindowAnchor({ start_date: String(SIGNUP_SECS) }))
      .toEqual({ anchorMs: SIGNUP_MS, source: 'subscription.start_date' });
  });

  it('reads Unix SECONDS, not milliseconds', () => {
    const { anchorMs } = resolveAffiliateWindowAnchor({ start_date: SIGNUP_SECS });
    expect(anchorMs).toBe(SIGNUP_MS);
    expect(new Date(anchorMs!).toISOString()).toBe(SIGNUP_ISO);
  });
});

describe('the period comes from the invoice, and line periods win', () => {
  it('prefers a line period over the invoice-level period_start', () => {
    expect(resolveInvoicePeriodStart({
      period_start: SECS('2025-09-01T00:00:00Z'),
      lines: { data: [{ period: { start: SECS('2025-03-01T00:00:00Z') } }] },
    })).toEqual({
      periodStartMs: Date.parse('2025-03-01T00:00:00Z'),
      source: 'invoice.lines.period.start',
    });
  });

  it('takes the EARLIEST line period when a proration sits beside the new cycle', () => {
    expect(resolveInvoicePeriodStart({
      lines: {
        data: [
          { period: { start: SECS('2025-12-01T00:00:00Z') } },
          { period: { start: SECS('2025-11-15T00:00:00Z') } }, // proration credit
        ],
      },
    }).periodStartMs).toBe(Date.parse('2025-11-15T00:00:00Z'));
  });

  it('falls back to invoice.period_start', () => {
    expect(resolveInvoicePeriodStart({ period_start: SIGNUP_SECS }))
      .toEqual({ periodStartMs: SIGNUP_MS, source: 'invoice.period_start' });
  });

  it('ignores lines that carry no usable period', () => {
    expect(resolveInvoicePeriodStart({
      period_start: SIGNUP_SECS,
      lines: { data: [null, { period: null }, { period: { start: 0 } }] },
    })).toEqual({ periodStartMs: SIGNUP_MS, source: 'invoice.period_start' });
  });

  it('reports no period when the invoice carries none', () => {
    expect(resolveInvoicePeriodStart({})).toEqual({ periodStartMs: null, source: 'none' });
    expect(resolveInvoicePeriodStart(null)).toEqual({ periodStartMs: null, source: 'none' });
  });
});

// ── THE BOUNDARY ─────────────────────────────────────────────────────────────────
// Documented choice: a period earns a commission when it starts STRICTLY BEFORE the
// 12-month anniversary. The twelfth month of service is INCLUSIVE; the anniversary
// instant itself is EXCLUSIVE. Changing the window by one month must break these.

describe('the boundary: month 12 inclusive, the anniversary instant exclusive', () => {
  it('month 1 (period starts at the anchor) is inside', () => {
    expect(evaluateAffiliateCommissionWindow({ subscription: sub(), invoice: invoiceAtMonth(0) }))
      .toMatchObject({ within: true, reason: 'within-window', failSafe: false });
  });

  it('month 11 (anchor + 10 months) is inside', () => {
    expect(evaluateAffiliateCommissionWindow({ subscription: sub(), invoice: invoiceAtMonth(10) }))
      .toMatchObject({ within: true, reason: 'within-window' });
  });

  it('month 12 (anchor + 11 months) is inside — the LAST commissioned month', () => {
    expect(evaluateAffiliateCommissionWindow({ subscription: sub(), invoice: invoiceAtMonth(11) }))
      .toMatchObject({ within: true, reason: 'within-window' });
  });

  it('month 13 (anchor + 12 months, exactly the anniversary) is OUTSIDE', () => {
    const d = evaluateAffiliateCommissionWindow({ subscription: sub(), invoice: invoiceAtMonth(12) });
    expect(d).toMatchObject({ within: false, reason: 'window-elapsed', failSafe: false });
    // The cutoff and the period coincide exactly — this is the off-by-one edge.
    expect(d.periodStartAt).toBe('2026-01-01T00:00:00.000Z');
    expect(d.windowEndsAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('one millisecond before the anniversary is inside; the anniversary itself is not', () => {
    const end = affiliateWindowEndMs(SIGNUP_MS);
    expect(isPeriodWithinWindow(end - 1, end)).toBe(true);
    expect(isPeriodWithinWindow(end, end)).toBe(false);
    expect(isPeriodWithinWindow(end + 1, end)).toBe(false);
  });

  it('exposes the anchor and cutoff it decided from', () => {
    expect(evaluateAffiliateCommissionWindow({ subscription: sub(), invoice: invoiceAtMonth(0) }))
      .toMatchObject({
        anchorAt: SIGNUP_ISO,
        anchorSource: 'subscription.start_date',
        windowEndsAt: '2026-01-01T00:00:00.000Z',
        periodStartSource: 'invoice.period_start',
      });
  });
});

describe('twelve commissions on either signup shape — the anchor/boundary cross-check', () => {
  it('pays exactly 11 renewals after a paid signup (1 initial + 11 = 12)', () => {
    // Monthly renewals at anchor + 1..N months; the initial commission covers month 1.
    const paid = Array.from({ length: 24 }, (_, i) => i + 1)
      .filter(m => evaluateAffiliateCommissionWindow({ subscription: sub(), invoice: invoiceAtMonth(m) }).within);
    expect(paid).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('pays exactly 12 renewals after a 7-day trial (the $0 initial is skipped)', () => {
    // Trial starts at signup, so start_date is the anchor; billing runs 7 days later.
    const trialOffsetMs = 7 * 24 * 60 * 60 * 1000;
    const paid = Array.from({ length: 24 }, (_, i) => i)
      .filter(m => evaluateAffiliateCommissionWindow({
        subscription: sub(),
        invoice: { id: `in_t${m}`, period_start: Math.floor((addMonthsUtc(SIGNUP_MS + trialOffsetMs, m)) / 1000) },
      }).within);
    expect(paid).toHaveLength(12);
  });
});

// ── THE FAIL-SAFE ────────────────────────────────────────────────────────────────
// Documented direction: unresolvable ⇒ PAY, loudly. A commission that should exist
// and is silently skipped is the expensive failure. Inverting this must break these.

describe('fail-safe: an unresolvable window PAYS rather than withholds', () => {
  it('a MISSING anchor pays, and is flagged as a fail-safe rather than a comparison', () => {
    const d = evaluateAffiliateCommissionWindow({
      subscription: { id: 'sub_A' }, // no start_date, no created
      invoice: invoiceAtMonth(60),   // five years in — would be far outside any window
    });
    expect(d.within).toBe(true);
    expect(d.reason).toBe('anchor-unresolved');
    expect(d.failSafe).toBe(true);
    expect(d.anchorAt).toBeNull();
    expect(d.windowEndsAt).toBeNull();
  });

  it('an UNPARSEABLE anchor pays too — it is not read as a 1970 expiry', () => {
    for (const bad of [0, -1, NaN, 'never', null, {}]) {
      const d = evaluateAffiliateCommissionWindow({
        subscription: { start_date: bad, created: bad },
        invoice: invoiceAtMonth(60),
      });
      expect(d.within, `start_date=${JSON.stringify(bad)}`).toBe(true);
      expect(d.failSafe).toBe(true);
      expect(d.reason).toBe('anchor-unresolved');
    }
  });

  it('a missing subscription entirely pays', () => {
    expect(evaluateAffiliateCommissionWindow({ subscription: null, invoice: invoiceAtMonth(60) }))
      .toMatchObject({ within: true, failSafe: true, reason: 'anchor-unresolved' });
  });

  it('an unresolvable invoice PERIOD pays, even with a long-expired anchor', () => {
    const d = evaluateAffiliateCommissionWindow({ subscription: sub(), invoice: { id: 'in_x' } });
    expect(d).toMatchObject({ within: true, failSafe: true, reason: 'period-unresolved' });
    // The anchor still resolved, so it is reported — the gap is the period alone.
    expect(d.anchorAt).toBe(SIGNUP_ISO);
    expect(d.periodStartAt).toBeNull();
  });

  it('a REAL in-window decision is NOT marked failSafe — the flag means "we could not prove it"', () => {
    expect(evaluateAffiliateCommissionWindow({ subscription: sub(), invoice: invoiceAtMonth(3) }).failSafe)
      .toBe(false);
  });

  it('withholds ONLY when both sides resolved and the period is past the cutoff', () => {
    expect(evaluateAffiliateCommissionWindow({ subscription: sub(), invoice: invoiceAtMonth(13) }))
      .toMatchObject({ within: false, failSafe: false, reason: 'window-elapsed' });
  });
});

describe('the delivery time is irrelevant — only the invoice period governs', () => {
  it('an old anchor with a month-11 period is inside no matter when it is evaluated', () => {
    // Signup five years ago; this month-11 invoice is being processed *now*, years
    // late. The period is what decides, so it still pays.
    const longAgo = Math.floor(Date.parse('2020-01-01T00:00:00Z') / 1000);
    expect(evaluateAffiliateCommissionWindow({
      subscription: { start_date: longAgo },
      invoice: { period_start: Math.floor(addMonthsUtc(longAgo * 1000, 10) / 1000) },
    })).toMatchObject({ within: true, reason: 'within-window' });
  });
});

describe('affiliateWindowRemaining (display only, never gates a payout)', () => {
  const now = Date.parse('2025-07-01T00:00:00Z');

  it('reports days left, rounded up', () => {
    expect(affiliateWindowRemaining('2025-07-11T12:00:00Z', now))
      .toEqual({ windowEndsAt: '2025-07-11T12:00:00Z', expired: false, daysRemaining: 11 });
  });

  it('reports an elapsed window as expired with zero days, never a negative', () => {
    expect(affiliateWindowRemaining('2025-06-01T00:00:00Z', now))
      .toEqual({ windowEndsAt: '2025-06-01T00:00:00Z', expired: true, daysRemaining: 0 });
  });

  it('treats the cutoff instant itself as expired, matching the exclusive boundary', () => {
    expect(affiliateWindowRemaining('2025-07-01T00:00:00Z', now).expired).toBe(true);
  });

  it('reports an absent or unparseable window as UNKNOWN, not expired', () => {
    for (const bad of [null, undefined, '', 'soon']) {
      expect(affiliateWindowRemaining(bad, now))
        .toEqual({ windowEndsAt: null, expired: false, daysRemaining: null });
    }
  });
});
