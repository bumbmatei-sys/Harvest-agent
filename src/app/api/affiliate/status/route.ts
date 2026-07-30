import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { captureHandledError } from '@/lib/money-path-sentry';
import {
  AFFILIATE_COMMISSION_WINDOW_MONTHS,
  affiliateWindowRemaining,
} from '@/lib/affiliate-commission-window';

export const dynamic = 'force-dynamic';

async function generateUniqueAffiliateCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomBytes(6).toString('base64url').slice(0, 8).toLowerCase();
    const existing = await adminDb.collection('users').where('affiliateCode', '==', code).limit(1).get();
    if (existing.empty) return code;
  }
  throw new Error('Failed to generate unique affiliate code after 10 attempts');
}

export async function GET(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const userDoc = await adminDb.collection('users').doc(userOrErr.uid).get();
    const userData = userDoc.data();

    const stripeConnectAccountId = userData?.affiliateStripeAccountId || null;
    const isAffiliate = !!stripeConnectAccountId;

    let affiliateCode = userData?.affiliateCode || null;

    // Always generate a short code on first load so the referral link is
    // available instantly — Stripe Connect is only required to receive payouts,
    // not to generate a link.
    if (!affiliateCode) {
      try {
        affiliateCode = await generateUniqueAffiliateCode();
        await adminDb.collection('users').doc(userOrErr.uid).update({
          affiliateCode,
          updatedAt: new Date().toISOString(),
        });
      } catch (codeErr) {
        console.error('Failed to generate affiliate code:', codeErr);
        affiliateCode = null;
      }
    }

    // Earnings breakdown from affiliate_commissions. Fetch the referrer's commissions
    // once (single-field query → no composite index) and compute client-side.
    let thisMonthEarnings = 0; // paid + pending this month — matches Lifetime's basis
    let thisMonthPending = 0;  // of that, not yet paid out (Connect wasn't active when earned)
    let recurringEarnings = 0; // recurring commissions in the trailing 30 days (active referrals)
    // The 12-month commission window, per referral. An affiliate who cannot see the
    // clock has no way to tell "my window closed" from "I am being underpaid", so
    // the remaining window is surfaced rather than left implicit. These are read
    // STRAIGHT off the commission rows the webhook stamped at creation time, so what
    // the affiliate sees is the cutoff that was actually applied — not a second
    // calculation here that could drift from the gate.
    const windowByTenant = new Map<string, { windowEndsAt: string | null; latestRowAt: string }>();
    let referralWindows: Array<{
      tenantId: string;
      windowEndsAt: string | null;
      daysRemaining: number | null;
      expired: boolean;
    }> = [];
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const commSnap = await adminDb
        .collection('affiliate_commissions')
        .where('referrerId', '==', userOrErr.uid)
        .get();
      for (const d of commSnap.docs) {
        const c = d.data();
        const commission = c.commission || 0;
        const createdAt = c.createdAt || '';

        // Window bookkeeping runs over EVERY row, before the earnings filters below
        // skip the zero-commission ones. The `type: 'expired'` marker the webhook
        // writes when it withholds a commission is exactly such a row, and it is the
        // most authoritative statement of a closed window there is — dropping it here
        // would hide the clock precisely when the affiliate most needs to see it.
        const rowTenantId: string = c.tenantId || '';
        if (rowTenantId) {
          const prior = windowByTenant.get(rowTenantId);
          // Last writer wins by row age, so a re-derived anchor on a later invoice
          // supersedes an earlier one instead of the map depending on scan order.
          if (!prior || createdAt >= prior.latestRowAt) {
            windowByTenant.set(rowTenantId, {
              windowEndsAt: c.commissionWindowEndsAt || prior?.windowEndsAt || null,
              latestRowAt: createdAt,
            });
          }
        }

        // 'cancelled' rows are zero-commission markers; paid/pending/failed each
        // represent money the affiliate earned (Lifetime counts them the same way),
        // so "This Month" must include pending — a commission written before the
        // referrer connected Stripe is 'pending' yet still earned this month.
        if (c.status === 'cancelled' || commission <= 0) continue;
        if (createdAt >= startOfMonth) {
          thisMonthEarnings += commission;
          if (c.status !== 'paid') thisMonthPending += commission;
        }
        // Recurring income = ACTUAL recurring commissions in the trailing 30 days.
        // A cancelled referral stops generating these, so it drops off on its own —
        // there is no static referral count to decrement (see ISSUE 6).
        if (c.type === 'recurring' && createdAt >= thirtyDaysAgo) {
          recurringEarnings += commission;
        }
      }

      // Soonest-to-close first: the one the affiliate needs to act on.
      referralWindows = [...windowByTenant.entries()]
        .map(([tenantId, v]) => ({ tenantId, ...affiliateWindowRemaining(v.windowEndsAt, now.getTime()) }))
        .sort((a, b) => {
          // A null window (a referral whose rows predate this field) sorts last —
          // it is unknown, not urgent.
          if (a.windowEndsAt === b.windowEndsAt) return a.tenantId < b.tenantId ? -1 : 1;
          if (!a.windowEndsAt) return 1;
          if (!b.windowEndsAt) return -1;
          return a.windowEndsAt < b.windowEndsAt ? -1 : 1;
        });
    } catch (monthErr) {
      // The response is still a 200 — with thisMonthEarnings/recurringEarnings
      // left at ZERO. An affiliate who earned this month is shown $0 and has no
      // way to tell that from genuinely having earned nothing.
      console.warn('Failed to compute affiliate earnings:', monthErr);
      captureHandledError(monthErr, {
        step: 'affiliate-earnings-compute',
        level: 'warning',
        ids: { userId: userOrErr.uid },
      });
    }

    return NextResponse.json({
      isAffiliate,
      userId: userOrErr.uid,
      stripeConnectAccountId,
      affiliateConnectStatus: userData?.affiliateConnectStatus || null,
      affiliateCode,
      totalEarnings: userData?.affiliateEarnings || 0,
      pendingPayouts: userData?.affiliatePendingPayouts || 0,
      referralCount: userData?.affiliateReferralCount || 0,
      thisMonthEarnings,
      thisMonthPending,
      recurringEarnings,
      // ── The 12-month commission window ──────────────────────────────────────
      // `commissionWindowMonths` states the rule; `referralWindows` states where
      // each individual referral stands against it. `windowEndsAt: null` means this
      // referral's rows carry no stamped window (they predate the field) — reported
      // as unknown rather than guessed at, and never as expired.
      commissionWindowMonths: AFFILIATE_COMMISSION_WINDOW_MONTHS,
      referralWindows,
      activeReferralWindows: referralWindows.filter(w => !w.expired).length,
      expiredReferralWindows: referralWindows.filter(w => w.expired).length,
      // The next window to close, for a one-line summary in the UI.
      nextWindowEndsAt: referralWindows.find(w => !w.expired && w.windowEndsAt)?.windowEndsAt || null,
    });
  } catch (error: any) {
    console.error('Affiliate status error:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to fetch affiliate status' },
      { status: 500 }
    );
  }
}
