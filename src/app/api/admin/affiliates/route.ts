import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/affiliates
 *
 * SUPER-ADMIN ONLY. One row per affiliate: revenue they brought in, plans sold,
 * what they earned, what is still owed, what Harvest kept, their payout-status
 * breakdown and their Stripe Connect state. This is the only surface that
 * answers "is the affiliate programme actually working" — /api/affiliate/status
 * shows an affiliate their OWN numbers and nothing else.
 *
 * THE GATE IS requireSuperAdmin, NOT requireAdmin. requireAdmin passes for
 * `isAdmin || isSuperAdmin`, i.e. every church admin, and this response spans
 * every affiliate's earnings and Connect account id. Cross-tenant, cross-user
 * money data has exactly one correct gate.
 *
 * READ-ONLY. No commission is edited, no payout is triggered, no counter moves.
 * Payouts stay owned by the webhook, the account.updated sweep and the retry
 * cron (lib/affiliate-payout.ts).
 *
 * Each affiliate also carries a `windows` block — the same sales fold restricted
 * to today / the last 7 days / the last 30 days / all time — so the view can
 * answer "who sold the most (or the least) this week" by ranking on a period
 * rather than on lifetime totals. All four are folded in ONE pass over the same
 * scan, so switching period costs no request and the four can never disagree
 * about when "now" was. See the WindowTotals comment for what deliberately
 * cannot be windowed.
 *
 * ── Three things that make these numbers lie if you get them wrong ──────────
 *
 * 1. THE STORED `commission` FIELD IS THE TRUTH. Never recompute it as 15% of
 *    `amount`. A legacy row exists at 20% (commission 9580 on amount 47900), and
 *    recomputing would silently restate it as 7185 — history rewritten to match
 *    today's rate. Every figure below reads `commission` as written, and
 *    `commissionRates` surfaces the distinct rates actually present so an
 *    off-rate row is VISIBLE rather than averaged away.
 *
 * 2. `affiliateReferralCount` COUNTS CONVERTED REFERRALS ONLY. A live trial does
 *    not increment it — the webhook skips the $0 initial event entirely and only
 *    banks a referral when real money lands. It is returned as
 *    `convertedReferrals`, never as "signups", because the affiliate's own
 *    dashboard shows this same number and the two must not disagree.
 *
 * 3. `pending` DOES NOT MEAN "ABOUT TO BE PAID". The sweep pays a pending
 *    commission only once the referrer's Connect account is payout-ready; a
 *    referrer who never finished onboarding has rows that will sit pending
 *    FOREVER, because every sweep skips them. So each affiliate carries a
 *    `pendingReason` — no Connect account at all / onboarding incomplete /
 *    genuinely queued behind the sweep — and the UI must show it next to the
 *    figure.
 *
 * ── Scale ──────────────────────────────────────────────────────────────────
 * This reads the whole `affiliate_commissions` collection and groups in memory.
 * That is an unbounded collection scan. It is trivial today (a handful of rows)
 * and deliberately not optimised, but the shape is kept precomputable: every
 * figure below is a pure fold over commission rows keyed by `referrerId`, so the
 * day it stops being cheap the same numbers can be maintained incrementally on
 * an `affiliate_rollups/{referrerId}` doc written by the same webhook that
 * writes the row — with this route as the backfill/reconciliation reader. No
 * figure here depends on cross-affiliate state, which is what keeps that door
 * open.
 */

/** Affiliates with a link but no sales still matter to the question "does the
 * programme work", so the roster is the UNION of (a) everyone who has a
 * referral code and (b) everyone who has a commission row. Bounded so a route
 * with no pagination can't degrade without saying so. */
const AFFILIATE_LIMIT = 500;
/** Most recent commission rows echoed per affiliate for the detail view.
 * Aggregates are always computed over ALL rows, never over this slice. */
const ROWS_PER_AFFILIATE = 50;

type PendingReason = 'no_connect_account' | 'connect_incomplete' | 'awaiting_sweep' | null;

interface StatusBucket {
  count: number;
  /** Sum of the stored `commission` field for rows in this bucket. */
  commission: number;
}

function emptyBucket(): StatusBucket {
  return { count: 0, commission: 0 };
}

// ── Time windows ─────────────────────────────────────────────────────────────
// "Who sold the most in the last 7 days" needs the sales figures re-folded over
// a date range, so all four windows are computed in the SAME pass and returned
// together. The client switches between them without a refetch, which also
// means the four windows can never disagree about when "now" was.
//
// Boundaries are UTC CALENDAR DAY starts, not rolling 24h offsets: `today` is
// since 00:00 UTC today, `d7` is that day plus the previous 6, `d30` that day
// plus the previous 29. Whole days nest cleanly (today ⊆ d7 ⊆ d30 ⊆ all) and
// the answer doesn't shift under you between two requests in the same day.
// Commission `createdAt` is written as an ISO-8601 UTC string, so a plain
// string comparison against an ISO cutoff is the correct ordering — no parsing.
export type WindowKey = 'today' | 'd7' | 'd30' | 'all';
const WINDOW_KEYS: WindowKey[] = ['today', 'd7', 'd30', 'all'];

/** Start-of-day UTC, `daysAgo` days back, as an ISO string. */
function utcDayStart(now: Date, daysAgo: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

function windowCutoffs(now: Date): Record<WindowKey, string | null> {
  return {
    today: utcDayStart(now, 0),
    d7: utcDayStart(now, 6),
    d30: utcDayStart(now, 29),
    all: null, // no lower bound
  };
}

/** The per-window sales fold. Every figure here is derived from commission
 * ROWS, so it can be restricted to a date range. The user-doc counters
 * (affiliateEarnings / affiliatePendingPayouts / affiliateReferralCount) are
 * lifetime running totals with no history behind them — they CANNOT be
 * windowed, are never placed in here, and stay labelled lifetime in the UI. */
interface WindowTotals {
  revenueBrought: number;
  commission: number;
  harvestKept: number;
  plansSold: number;
  recurringPayments: number;
  /** Commission rows that fell in this window, whatever their status. */
  rows: number;
}

function emptyWindow(): WindowTotals {
  return { revenueBrought: 0, commission: 0, harvestKept: 0, plansSold: 0, recurringPayments: 0, rows: 0 };
}

export async function GET(request: NextRequest) {
  const userOrErr = await requireSuperAdmin(request);
  if (userOrErr instanceof Response) return userOrErr;

  try {
    // Whole-collection scan (see the Scale note above). `orderBy('affiliateCode')`
    // on users returns only docs that HAVE the field — i.e. everyone who has ever
    // been issued a referral link — and is served by the automatic single-field
    // index, so neither query needs a composite index.
    const [commissionSnap, codedUserSnap] = await Promise.all([
      adminDb.collection('affiliate_commissions').get(),
      adminDb.collection('users').orderBy('affiliateCode').limit(AFFILIATE_LIMIT).get(),
    ]);

    const cutoffs = windowCutoffs(new Date());

    interface Acc {
      windows: Record<WindowKey, WindowTotals>;
      /** Rows carrying no `createdAt`. They count toward `all` but cannot be
       * placed in any dated window — reported rather than silently dropped, so
       * a windowed total that is smaller than expected has a visible reason. */
      undatedRows: number;
      byStatus: Record<string, StatusBucket>;
      rates: Map<string, number>;
      transfers: { commissionId: string; commission: number; stripeTransferId: string | null; paidAt: string | null }[];
      rows: {
        id: string; tenantId: string | null; plan: string | null; type: string | null;
        status: string | null; amount: number; commission: number; createdAt: string | null;
      }[];
    }

    const byReferrer = new Map<string, Acc>();
    const accFor = (id: string): Acc => {
      let a = byReferrer.get(id);
      if (!a) {
        a = {
          windows: { today: emptyWindow(), d7: emptyWindow(), d30: emptyWindow(), all: emptyWindow() },
          undatedRows: 0,
          byStatus: {}, rates: new Map(), transfers: [], rows: [],
        };
        byReferrer.set(id, a);
      }
      return a;
    };

    for (const doc of commissionSnap.docs) {
      const c = doc.data() || {};
      const referrerId: string | undefined = c.referrerId;
      if (!referrerId) continue;
      const acc = accFor(referrerId);

      const amount = Number(c.amount) || 0;
      // READ, never recompute. See trap 1 above.
      const commission = Number(c.commission) || 0;
      const status: string = c.status || 'unknown';
      const createdAt: string | null = c.createdAt || null;
      if (!createdAt) acc.undatedRows += 1;

      // Fold this row into every window it falls inside. `all` always takes it;
      // a dated window takes it only when the row is at or after that cutoff.
      for (const key of WINDOW_KEYS) {
        const cutoff = cutoffs[key];
        if (cutoff !== null && !(createdAt && createdAt >= cutoff)) continue;
        const w = acc.windows[key];
        w.revenueBrought += amount;
        w.commission += commission;
        // What Harvest kept out of the money the affiliate brought in. Uses the
        // STORED commission, so the 20% legacy row correctly leaves less behind
        // than a 15% row on the same amount.
        w.harvestKept += amount - commission;
        if (c.type === 'initial') w.plansSold += 1;
        if (c.type === 'recurring') w.recurringPayments += 1;
        w.rows += 1;
      }

      const bucket = (acc.byStatus[status] ||= emptyBucket());
      bucket.count += 1;
      bucket.commission += commission;

      // Distinct effective rates actually present in the data. A single 0.2
      // entry alongside 0.15 is the legacy row making itself visible.
      if (amount > 0 && commission > 0) {
        const rate = Math.round((commission / amount) * 10_000) / 10_000;
        acc.rates.set(String(rate), (acc.rates.get(String(rate)) || 0) + 1);
      }

      // A real Stripe transfer left a `stripeTransferId` on the row when it was
      // flipped to `paid`. This list IS the money that actually moved.
      if (status === 'paid' && commission > 0) {
        acc.transfers.push({
          commissionId: doc.id,
          commission,
          stripeTransferId: c.stripeTransferId || null,
          paidAt: c.paidAt || null,
        });
      }

      acc.rows.push({
        id: doc.id,
        tenantId: c.tenantId || null,
        plan: c.plan || null,
        type: c.type || null,
        status: c.status || null,
        amount,
        commission,
        createdAt: c.createdAt || null,
      });
    }

    // Roster = users holding a referral code ∪ referrers that have commission rows.
    const userData = new Map<string, FirebaseFirestore.DocumentData>();
    for (const d of codedUserSnap.docs) userData.set(d.id, d.data() || {});

    const missing = [...byReferrer.keys()].filter((id) => !userData.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const refs = missing.slice(i, i + 100).map((id) => adminDb.collection('users').doc(id));
      const snaps = await adminDb.getAll(...refs);
      for (const s of snaps) if (s.exists) userData.set(s.id, s.data() || {});
    }

    const affiliateIds = new Set<string>([...userData.keys(), ...byReferrer.keys()]);

    const affiliates = [...affiliateIds].map((uid) => {
      const u = userData.get(uid) || {};
      const acc = byReferrer.get(uid);

      const connectAccountId: string | null = u.affiliateStripeAccountId || null;
      const connectStatus: string | null = u.affiliateConnectStatus || null;
      const payoutReady = !!connectAccountId && connectStatus === 'active';

      const byStatus = acc?.byStatus || {};
      const pendingCount = byStatus.pending?.count || 0;

      // WHY it's pending, not just that it is. Two rows sat pending for weeks
      // because their referrers never finished Connect onboarding — the sweep
      // skips those forever, so "pending" there means "stuck", not "queued".
      const pendingReason: PendingReason = pendingCount === 0
        ? null
        : !connectAccountId
          ? 'no_connect_account'
          : !payoutReady
            ? 'connect_incomplete'
            : 'awaiting_sweep';

      const rows = (acc?.rows || [])
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, ROWS_PER_AFFILIATE);

      const all = acc?.windows.all || emptyWindow();

      return {
        userId: uid,
        email: u.email || null,
        name: u.displayName || u.name || null,
        affiliateCode: u.affiliateCode || null,

        // ── The table (lifetime) ───────────────────────────────────────────
        /** Gross customer money these referrals generated (sum of `amount`). */
        revenueBrought: all.revenueBrought,
        /** Count of `type: 'initial'` rows — a plan sold. Renewals are separate. */
        plansSold: all.plansSold,
        /** Renewal commissions on top of those sales. */
        recurringPayments: all.recurringPayments,
        /** Lifetime earnings as the counter holds them (what the affiliate sees). */
        earned: u.affiliateEarnings || 0,
        /** Banked but not yet transferred out. */
        owedUnpaid: u.affiliatePendingPayouts || 0,
        /** revenueBrought − commissions, from STORED commission values. */
        harvestKept: all.harvestKept,
        /** Sum of stored `commission` across their rows — cross-checks `earned`. */
        commissionFromRows: all.commission,

        /** The SAME sales fold restricted to today / the last 7 days / the last
         * 30 days / all time, so the view can rank by who sold most (or least)
         * in a period without a second request. `windows.all` is identical to
         * the lifetime fields above, by construction.
         *
         * Only ROW-DERIVED figures appear here. `earned`, `owedUnpaid` and
         * `convertedReferrals` are running counters on the user doc with no
         * history behind them — there is no honest way to window them, so they
         * are deliberately absent and stay labelled lifetime in the UI. */
        windows: acc?.windows || { today: emptyWindow(), d7: emptyWindow(), d30: emptyWindow(), all: emptyWindow() },
        /** Rows with no `createdAt`: counted in `all`, absent from every dated
         * window. Surfaced so a short windowed total has a visible cause. */
        undatedRows: acc?.undatedRows || 0,

        payoutStatus: {
          paid: byStatus.paid || emptyBucket(),
          pending: byStatus.pending || emptyBucket(),
          cancelled: byStatus.cancelled || emptyBucket(),
          failed: byStatus.failed || emptyBucket(),
        },
        pendingReason,

        connect: {
          accountId: connectAccountId,
          status: connectStatus,
          payoutReady,
        },

        /** CONVERTED referrals only — a live trial is not counted here (trap 2). */
        convertedReferrals: u.affiliateReferralCount || 0,

        /** Distinct effective commission rates present in their rows, so an
         * off-rate legacy row shows up instead of being averaged away. */
        commissionRates: [...(acc?.rates || new Map()).entries()]
          .map(([rate, count]) => ({ rate: Number(rate), count }))
          .sort((a, b) => a.rate - b.rate),

        /** Commissions that actually moved money (status `paid`). */
        transfers: acc?.transfers || [],

        recentCommissions: rows,
      };
    }).sort((a, b) => b.revenueBrought - a.revenueBrought || b.earned - a.earned);

    return NextResponse.json({
      affiliates,
      /** True when the affiliate roster hit AFFILIATE_LIMIT — the list is a
       * prefix, not the whole programme. Surface it; don't let a truncated list
       * read as a complete one. */
      truncated: codedUserSnap.size >= AFFILIATE_LIMIT,
      commissionRowsScanned: commissionSnap.size,
      /** The exact lower bound of each window (`all` is unbounded), so the view
       * can state the period it is actually showing instead of implying one. */
      windowCutoffs: cutoffs,
    });
  } catch (e) {
    console.error('admin affiliates error:', e);
    return NextResponse.json({ error: 'Failed to load affiliate overview.' }, { status: 500 });
  }
}
