"use client";
/**
 * THE-287 — the Growth tab: one complete read of `users`, one of `contacts`.
 *
 * ─── 🔴 The member trend is RELOCATED, not rebuilt ───────────────────────────
 *
 * `series` below is the SAME `Series` object `OverviewTab` is handed — the same
 * `completeRead` of `users`, bucketed by the same `bucketWeekly` call against
 * the same frozen `readAt`, in `useOverviewData`. Nothing here recomputes it,
 * re-reads it, re-buckets it or rounds it, so "the figures are identical to
 * Overview's" is true by object identity rather than by two computations
 * agreeing. A second read would have been a second answer to the same question,
 * and the two would drift the first time either was touched.
 *
 * ⚠️ Overview keeps its own widgets untouched. Its "Giving & growth" chart
 * still plots members alongside receipts; this is the member trend on its own,
 * on the tab whose subject it is, drawn by the same `TrendChart`.
 *
 * ─── 🔴 The funnel here is a GIVING-TIER funnel and is labelled as one ───────
 *
 * `devotion` is not a concept this product records: no collection, no field, no
 * event, and the only matches for the word in `src/` are marketing copy.
 * THE-276 documented that in `FunnelChart.tsx`'s header and deliberately mounted
 * nothing under that label — the Overview tab still carries the honest empty
 * state saying so, and this ticket does not touch it.
 *
 * What this mounts is `resolvePipelineStage(contact.totalDonated)`: Member →
 * Giving → Champion, the app's own single definition of a pipeline stage. The
 * title says "Giving tiers" and the description says what the bands are, because
 * calling giving tiers a devotion, discipleship or journey funnel would assert
 * something nobody measured.
 */
import React from 'react';

import { CHART_VARS } from './GivingMix';
import { CountriesTable } from './CountriesTable';
import { FunnelChart } from './FunnelChart';
import { TrendChart } from './TrendChart';
import type { OverviewData } from './useOverviewData';

export function GrowthTab({ data }: { readonly data: OverviewData }) {
  const { roster } = data;

  return (
    <div className="space-y-4" data-growth-tab>
      <TrendChart
        series={[
          { key: 'members', label: 'New members', chartVar: CHART_VARS[1], series: data.memberSeries },
        ]}
      />

      <CountriesTable tally={roster.countries} reason={roster.countriesReason} />

      {/*
        🔴 Ordered widest-first because that is what `FunnelChart` draws, and
        the three bands PARTITION the contact list rather than following one —
        every contact is in exactly one and they sum to the whole. The
        description says "bands", not "conversion", so nobody reads drop-off
        into a set of tier sizes.
      */}
      <FunnelChart
        title="Giving tiers"
        description="Every contact by what they have given: Member (nothing recorded), Giving, and Champion at $10,000 or more."
        stages={roster.funnel ?? null}
        reason={roster.funnelReason}
        chartVar={CHART_VARS[2]}
      />
    </div>
  );
}
