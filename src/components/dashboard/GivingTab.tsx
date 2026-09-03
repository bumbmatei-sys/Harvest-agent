"use client";
/**
 * THE-287 — the Giving tab, slice one: the top givers leaderboard.
 *
 * ⚠️ ONE WIDGET, deliberately, and the tab is not padded out to look fuller.
 * Giving-over-time, campaign progress and recurring-gift health are later
 * tickets; a placeholder card for each would imply they are part of this slice.
 * The tab strip has said "not built yet" about a whole tab since THE-276 for
 * the same reason — a reader who sees one widget sees one widget's worth of
 * truth.
 *
 * 🔴 It shares the funnel's read. `contacts` is counted once and loaded once in
 * `useOverviewData`; the leaderboard and the Growth tab's giving tiers are two
 * renderings of the same complete set, so opening both tabs costs nothing extra
 * and the two can never disagree about who has given what.
 */
import React from 'react';

import { TopGivers } from './TopGivers';
import type { OverviewData } from './useOverviewData';

export function GivingTab({ data }: { readonly data: OverviewData }) {
  return (
    <div className="space-y-4" data-giving-tab>
      <TopGivers givers={data.roster.givers} reason={data.roster.giversReason} />
    </div>
  );
}
