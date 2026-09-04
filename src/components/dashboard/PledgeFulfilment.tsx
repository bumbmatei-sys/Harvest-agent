"use client";
/**
 * THE-290 — "Pledge fulfilment": how much of what was promised has arrived.
 *
 * ─── 🔴 WHY THIS IS NOT "RECURRING GIVING" ───────────────────────────────────
 *
 * The design asked for a recurring-gift health widget. IT CANNOT BE BUILT
 * HONESTLY, and this replaces it rather than approximating it. THE-285
 * established and this slice re-verified, in the code that writes the
 * documents, that NOTHING AT THE TENANT LEVEL MARKS A GIFT RECURRING:
 *
 *   · `STRIPE_CONNECT_ENABLED` is `false` — Stripe closed the platform account
 *     as `rejected.fraud` and `/api/stripe/donate` answers 503 — so there is no
 *     tenant card-giving path in this build at all, and therefore no tenant
 *     subscription anywhere to read. 🔴 No Connect surface is restored here.
 *   · `invoices.type` is one of `donation_receipt | event_ticket | invoice`, and
 *     not one of the three says anything about cadence: a monthly partnership
 *     renewal and a one-off gift both land as `donation_receipt`.
 *   · ⚠️ `users.donationSubscriptionId` is THE PLATFORM PARTNERSHIP — somebody
 *     giving to Harvest itself, cancelled via `/api/stripe/cancel-partnership`
 *     and surfaced on `Profile`. It is not a church's donor. A tenant widget
 *     built on it would report Harvest's own revenue on a church's dashboard.
 *
 * What `tenants/{t}/pledges` carries is `pledgeAmount`, `paidAmount`, `status`
 * and `dueDate`. 🔴 THAT IS A COMMITMENT, NOT A RECURRENCE — a promise of one
 * total by one date, with no schedule and no cadence anywhere in the document —
 * so it is labelled as pledges and never as recurring, subscription or monthly
 * giving. Using the recurring label for it would assert a schedule nobody
 * recorded, which is the same class of claim as a `0` standing in for a read
 * that failed. A guard test sweeps this file's source AND its rendered output
 * for all three words.
 *
 * ─── 🔴 Aggregates only. Never a donor ───────────────────────────────────────
 *
 * A pledge document carries `donorName`, `donorEmail`, `donorPhone` and
 * `notes`. `toPledgeRow` reads NONE of them, so no identifier reaches this
 * component even in memory and {@link PledgeSummary} has no field that could
 * hold one — the privacy property is enforced by the TYPE, not by the restraint
 * of whoever edits this next. That matters more here than on the Growth tab: a
 * dashboard listing who has not yet paid their pledge is a debtors' list, and
 * "how much of what was promised has arrived" is completely answered by totals.
 * `AdminFundraising` is where the per-donor list legitimately lives, behind
 * `manageFundraising`.
 *
 * ─── Units ───────────────────────────────────────────────────────────────────
 *
 * 🔴 `pledgeAmount` and `paidAmount` are DOLLARS — `/api/pledge/submit` writes
 * the figure through and `AdminFundraising`'s `Pledge` says so on the field. So
 * {@link dollars} formats them as is and there is NO `/ 100` in this file. The
 * cents-denominated figure on this tab is the relocated giving series, which
 * this component never sees.
 */
import React from 'react';
import { HandCoins } from 'lucide-react';

import { Progress } from '../ui/progress';
import { WidgetFrame, type WidgetState } from './WidgetFrame';
import { REASON, type PledgeSummary } from './giving-data';

/** A dollar figure. 🔴 The name says the unit; there is no `/ 100` here. */
const dollars = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(value);

const pledgesWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'pledge' : 'pledges'}`;

/**
 * A status as a reader would see it. Capitalised for display only — 🔴 the
 * document's own value is preserved as the grouping key upstream, so a status
 * this app does not define is shown as itself rather than folded into one of
 * the three it does.
 */
const statusLabel = (status: string) => status.charAt(0).toLocaleUpperCase() + status.slice(1);

export function PledgeFulfilment({ summary, reason }: {
  readonly summary: PledgeSummary | null;
  readonly reason: string | null;
}) {
  const state: WidgetState = summary === null && reason === null
    ? { kind: 'loading' }
    : summary === null
      ? { kind: 'unavailable', reason: reason ?? REASON.readFailed }
      : { kind: 'ready' };

  return (
    <WidgetFrame
      title="Pledge fulfilment"
      description="Commitments made to this ministry's pledge campaigns, and how much of each has been paid."
      icon={HandCoins}
      state={state}
      skeletonClassName="h-40 w-full"
    >
      {/*
        `pb-2` is the last widget's own breathing room. 🔴 The clearance over the
        bottom nav — `fixed bottom-0` at `z-[100]` with `pb-safe` — is the admin
        shell's `pb-24` on the scroll container, which this ticket may not open;
        the layout test measures the real distance in Chromium at 380px rather
        than trusting either number.
      */}
      <div className="space-y-4 pb-2" data-pledge-fulfilment>
        {summary && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Figure label="Pledged" value={dollars(summary.pledgedDollars)} slot="pledged" />
              <Figure label="Paid" value={dollars(summary.paidDollars)} slot="paid" />
              <Figure
                label="Fulfilled"
                /*
                 * 🔴 `null` when nothing was pledged, and it is NOT rendered as
                 * 0%. A ratio with no denominator is undefined, and "0%
                 * fulfilled" over $0 of pledges states a failure that did not
                 * happen.
                 */
                value={summary.percent === null ? 'No pledged total to measure against' : `${Math.round(summary.percent)}%`}
                slot="percent"
              />
            </div>

            {summary.percent !== null && (
              <Progress value={summary.percent} aria-label="Share of pledged amounts paid" />
            )}

            {/*
              Every pledge in exactly one status row. 🔴 `sum(byStatus[].pledges)
              === pledges` is an invariant of the summary, so a reader can add
              these up and land on the total above.
            */}
            <ul className="space-y-1">
              {summary.byStatus.map((row) => (
                <li key={row.status} className="flex items-center gap-2 text-xs" data-pledge-status={row.status}>
                  <span className="flex-1 truncate text-muted-foreground">
                    {`${statusLabel(row.status)} · ${pledgesWord(row.pledges)}`}
                  </span>
                  <span className="font-medium tabular-nums text-foreground">
                    {`${dollars(row.paidDollars)} of ${dollars(row.pledgedDollars)}`}
                  </span>
                </li>
              ))}
            </ul>

            {/*
              🔴 The date partition, stated whole. `overdue + notOverdue +
              undated === pledges` is the second invariant: a pledge whose due
              date cannot be read is counted HERE and never counted as overdue,
              because calling it overdue would invent a deadline nobody
              recorded. A fulfilled pledge is never overdue whatever its date.
            */}
            <p className="text-xs text-muted-foreground" data-pledge-dates>
              {`${summary.overdue.toLocaleString()} of ${pledgesWord(summary.pledges)} are unfulfilled past their due date. `}
              {summary.undated > 0
                ? `${summary.undated.toLocaleString()} carry no due date and are counted here rather than as overdue.`
                : 'Every unfulfilled pledge carries a due date.'}
            </p>
          </>
        )}
      </div>
    </WidgetFrame>
  );
}

/** One labelled figure. A number never floats free of what it measures. */
function Figure({ label, value, slot }: { label: string; value: string; slot: string }) {
  return (
    <div className="space-y-1" data-pledge-figure={slot}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
