"use client";
/**
 * THE-294 — "How widely engagement is spread": whether the ministry's activity
 * touches many people or a few.
 *
 * ─── 🔴 THIS IS WHERE "MOST ENGAGED MEMBERS" WOULD HAVE GONE ────────────────
 *
 * The design asks for a leaderboard of members ranked by activity count. It is
 * NOT built, it is NOT deferred, and it is not left empty. It is REPLACED, for
 * two independent reasons — either one alone would be enough:
 *
 * 1. 🔴 THE NUMBER IS NOT WHAT THE LABEL WOULD CLAIM. A raw
 *    `contactActivities` count per person mixes what the PERSON did — checked
 *    in, submitted a form, registered for an event, gave — with what STAFF did
 *    about them: a note typed, an email sent, a call logged. Those are the same
 *    five `type` values in the same collection with nothing but `createdBy` to
 *    tell them apart. So a pastor who writes five careful notes about one
 *    grieving family member puts that member at the top of a chart headed "most
 *    engaged", and the chart is reporting the pastor's week as the member's
 *    devotion. That is a wrong number wearing a confident label — the defect
 *    this whole feature exists to refuse — with a real person's name attached
 *    to it.
 *
 * 2. 🔴 IT WOULD BREAK THE READ LAYER'S NO-IDENTIFIER PROPERTY. THE-283 made
 *    "aggregates only, never a person" a property of the TYPES in this
 *    directory rather than of whoever writes the next widget: `CountryRow`,
 *    `CityCount` and `PledgeSummary` have no field that could hold an id, name,
 *    email or phone, and both headers say so in as many words. Nothing rendered
 *    anywhere under `components/dashboard/` names an individual today. A
 *    leaderboard would be the first identifier to cross that line, and it would
 *    cross it in the one place the codebase has written down that it does not.
 *    `AdminCRM` and `AdminSignups` are where per-person lists legitimately
 *    live, each behind its own permission, and each is a tool an admin works in
 *    rather than a summary they glance at.
 *
 * ⚠️ THE QUESTION A LEADERBOARD IS FOR IS STILL ANSWERED — better, in fact.
 * What a founder actually reads a top ten for is "is engagement broad, or is a
 * handful of people carrying this", and a top ten cannot answer it: ten names
 * look identical whether they are ten people out of twelve or ten out of two
 * thousand. A distribution answers it directly and names nobody.
 *
 * 🔴 AND IT COUNTS APP-RECORDED ROWS ONLY. Check-in, forms, event registration
 * and confirmed donations — the four server paths that write a row because a
 * person did something. Rows an admin typed are excluded, which is what makes
 * this widget about the congregation rather than about the office. The excluded
 * count is reported by the Activity type widget beside it, so nothing is hidden.
 *
 * ⚠️ NO `ui/progress` BAR. Each band is a count next to a label; a bar would
 * convey the proportion by length alone, and `progress` paints `bg-primary` on
 * `bg-muted` at 2.30:1 in light — known and accepted where a figure is written
 * beside it, and not worth adopting where the figure IS the widget.
 */
import React from 'react';
import { Users } from 'lucide-react';

import { WidgetFrame, type WidgetState } from './WidgetFrame';
import { REASON, type EngagementSpread as Spread } from './engagement-data';

const count = (n: number) => n.toLocaleString();

const people = (n: number) => `${count(n)} ${n === 1 ? 'person' : 'people'}`;

export function EngagementSpread({ spread, reason }: {
  readonly spread: Spread | null;
  readonly reason: string | null;
}) {
  const state: WidgetState = spread === null && reason === null
    ? { kind: 'loading' }
    : spread === null
      ? { kind: 'unavailable', reason: reason ?? REASON.readFailed }
      : { kind: 'ready' };

  return (
    <WidgetFrame
      title="How widely engagement is spread"
      description="People with automatically recorded activity, grouped by how much they have. Counts only."
      icon={Users}
      state={state}
      skeletonClassName="h-40 w-full"
    >
      <div className="space-y-3" data-engagement-spread>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(spread?.bands ?? []).map((band) => (
            <div key={band.label} className="min-w-0" data-spread-band={band.label}>
              <p className="text-xs text-muted-foreground">{band.label}</p>
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {count(band.contacts)}
              </p>
            </div>
          ))}
        </div>

        {/*
          🔴 The closed accounting again: the bands sum to `contacts`, and
          `withoutContact` is stated separately rather than folded into a band —
          an activity that belongs to nobody this read can name is a real row,
          and inventing a person for it would put someone in the distribution
          who is not there.
        */}
        {spread && (
          <p className="text-xs text-muted-foreground" data-spread-total>
            {`${people(spread.contacts)} carry at least one automatically recorded activity, ${count(spread.activities)} in total. The busiest single person has ${count(spread.busiest)}.`}
            {spread.withoutContact > 0
              ? ` ${count(spread.withoutContact)} of those records are not attached to anyone and are counted here but placed in no band.`
              : ''}
          </p>
        )}

        {/*
          ⚠️ WHY THERE IS NO LEADERBOARD, ON SCREEN. A reader who expected the
          design's "most engaged members" should learn that it was declined and
          why, rather than assume it was forgotten — and the reason is a fact
          about the data they can check.
        */}
        <p className="text-xs text-muted-foreground" data-no-leaderboard-note>
          There is no ranking of individuals here. Activity records mix what a
          person did with what an admin recorded about them, so a name at the top
          of such a list would often be measuring staff attention rather than
          engagement. Individual timelines live in the CRM, where they belong.
        </p>
      </div>
    </WidgetFrame>
  );
}
