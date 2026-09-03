"use client";
/**
 * THE-290 — "Campaign progress": how far each campaign is toward its goal.
 *
 * ─── 🔴 `raised` IS READ. IT IS NEVER RECOMPUTED ─────────────────────────────
 *
 * Every figure in this table comes off the campaign document itself. `raised` is
 * maintained by exactly two writers — the giving webhook's per-payment
 * `FieldValue.increment`, and `/api/campaigns/adjust-raised` for a manual
 * offline gift, each with an audit row — and THE-251 removed a third that was
 * silently resetting it. Summing `invoices` per campaign to "verify" it would
 * create a SECOND source for one number, and the two legitimately differ: an
 * event ticket, a gift given before the campaign existed, an offline
 * adjustment with no receipt, and fee handling all move one and not the other.
 * The widget would then have to pick, and whichever it picked would contradict
 * the Fundraising screen the church actually works in. No receipt is read here.
 *
 * ─── The units, stated where the formatting happens ──────────────────────────
 *
 * 🔴 `goal` and `raised` are DOLLARS on the document — `/api/campaigns/adjust-raised`
 * increments by `amountDollars`. So {@link dollars} formats them AS IS and there
 * is NO DIVISION BY 100 anywhere in this file. That is the inverse of
 * `GivingMix`, which divides once because `invoices.amount` is CENTS. Mixing the
 * two is the trap this tab is most exposed to: the same $250 gift is `25000` on
 * the receipt and `250` on the campaign, and a `/100` here would render a
 * $4,000 campaign as $40.
 *
 * ─── Adopting `ui/table` and `ui/progress` ───────────────────────────────────
 *
 * ⚠️ THE-272 installed both and asserted `table` was imported by nothing;
 * THE-283 recorded `LocationTable` as its one adopter and left the claim closed.
 * This file is the SECOND adopter of `table` and the FIRST of `progress`, and
 * both are RECORDED in that guard rather than removed from it — the assertion
 * now names exactly these files and still fails on a third table adopter or a
 * second unrecorded progress one. Narrowed, never weakened.
 *
 * ⚠️ `progress` paints `bg-primary` on `bg-muted` at 2.30:1 in light. That is
 * KNOWN AND ACCEPTED, recorded in both directions in THE-272's guard, and is
 * not "fixed" here: the bar is a non-text indicator and every figure it depicts
 * is also written out as a number beside it, so nothing is conveyed by the bar
 * alone.
 *
 * ⚠️ At 380px this table is wider than the card. It scrolls INSIDE its own
 * container (`ui/table` wraps every table in `overflow-x-auto`) and the PAGE
 * BODY does not move — THE-422's pattern, measured in Chromium at all five
 * widths by this slice's layout test.
 */
import React from 'react';
import { Target } from 'lucide-react';

import { Progress } from '../ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { WidgetFrame, type WidgetState } from './WidgetFrame';
import { REASON, type CampaignBreakdown } from './giving-data';

/**
 * A dollar figure, formatted once, here.
 *
 * 🔴 The name says the unit. There is no `cents` helper in this file and no
 * `/ 100` — see the header. Whole dollars only: a campaign goal is a round
 * ambition, and cents on it are noise.
 */
const dollars = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(value);

/** A percentage as a reader would say it. Never rendered when it is `null`. */
const percentage = (value: number) => `${Math.round(value)}%`;

/**
 * How many rows are drawn before the list scrolls rather than growing the card
 * without bound.
 *
 * 🔴 NOTHING IS DROPPED. Every campaign is in the DOM and reachable by
 * scrolling; this is a viewport on a complete list, not a `slice()`. A
 * truncated money table would be the sampling defect this feature exists to
 * refuse, one layer up.
 */
const SCROLL_AFTER_ROWS = 8;

const campaignsWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'campaign' : 'campaigns'}`;

export function CampaignProgress({ breakdown, reason }: {
  readonly breakdown: CampaignBreakdown | null;
  readonly reason: string | null;
}) {
  const state: WidgetState = breakdown === null && reason === null
    ? { kind: 'loading' }
    : breakdown === null
      ? { kind: 'unavailable', reason: reason ?? REASON.readFailed }
      : { kind: 'ready' };

  return (
    <WidgetFrame
      title="Campaign progress"
      description="Each campaign against its goal, from the total the giving webhook maintains."
      icon={Target}
      state={state}
      skeletonClassName="h-56 w-full"
    >
      <div className="space-y-3" data-campaign-progress>
        {/*
          `max-h` plus `overflow-y-auto` on the VERTICAL axis only. The
          horizontal scroll belongs to `ui/table`'s own container one level in,
          which is what keeps a 380px overflow off the page body.
        */}
        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right">Raised</TableHead>
                <TableHead className="text-right">Goal</TableHead>
                <TableHead>Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(breakdown?.rows ?? []).map((row) => (
                <TableRow key={row.id} data-campaign-row={row.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {/*
                      🔴 A campaign with no readable title is NAMED AS SUCH, not
                      given an invented label and not hidden. Its money is real
                      and is totalled with the rest; what is missing is the name,
                      and saying so is the same treatment `LocationTable` gives a
                      member who recorded no city.
                    */}
                    {row.title === null
                      ? <span data-campaign-unnamed>No name recorded</span>
                      : row.title}
                    {row.isActive && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground" data-campaign-active={row.id}>
                        Active
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap" data-campaign-raised={row.id}>
                    {dollars(row.raisedDollars)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap text-muted-foreground" data-campaign-goal={row.id}>
                    {/*
                      A goal of zero is a RECORDED value, not a missing one, and
                      it is shown as what it is. What is undefined is the ratio,
                      which is handled in the next cell.
                    */}
                    {dollars(row.goalDollars)}
                  </TableCell>
                  <TableCell className="min-w-32">
                    {/*
                      🔴 NO BAR WHEN THERE IS NO GOAL. A ratio with no
                      denominator is undefined, a 0% bar beside a campaign that
                      raised $4,000 states it raised nothing, and Base UI's
                      indeterminate bar (`value={null}`) reads as "still
                      loading". So the row says what is missing instead.
                    */}
                    {row.percent === null ? (
                      <span className="text-xs text-muted-foreground" data-campaign-no-goal={row.id}>
                        No goal recorded
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <span className="text-xs tabular-nums text-muted-foreground" data-campaign-percent={row.id}>
                          {percentage(row.percent)}
                        </span>
                        <Progress
                          value={row.percent}
                          aria-label={`${row.title ?? 'Unnamed campaign'} progress`}
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/*
          🔴 The parts of the answer that are missing, stated as figures of the
          same standing as the rows — rendered whenever the read succeeded,
          including when they are zero, where they are the reassurance that the
          table above is the whole set rather than most of it.
        */}
        {breakdown && (
          <p className="text-xs text-muted-foreground" data-campaign-coverage>
            {`All ${campaignsWord(breakdown.total)} are listed; ${breakdown.active.toLocaleString()} of them active. `}
            {`Together they have raised ${dollars(breakdown.raisedDollars)} toward ${dollars(breakdown.goalDollars)}. `}
            {breakdown.withoutGoal > 0
              ? `${breakdown.withoutGoal.toLocaleString()} recorded no goal, so no percentage is shown for them. `
              : 'Every one of them recorded a goal. '}
            {breakdown.unnamed > 0
              ? `${breakdown.unnamed.toLocaleString()} carry no name; their totals are still counted above.`
              : ''}
          </p>
        )}

        {breakdown && breakdown.rows.length > SCROLL_AFTER_ROWS && (
          <p className="text-xs text-muted-foreground" data-campaign-scrolls>
            {`All ${campaignsWord(breakdown.rows.length)} are listed; the table scrolls.`}
          </p>
        )}
      </div>
    </WidgetFrame>
  );
}
