"use client";
/**
 * THE-283 — the Growth tab: slice 2 of 6.
 *
 * ─── 🔴 TWO widgets, not five, and the tab says which three are missing ──────
 *
 * The design wants five here: the member growth trend, the countries & cities
 * table, a retention cohort heatmap, stage conversion, and a geo map. This slice
 * BUILDS TWO and DEFERS THREE, each with its own reason on screen.
 *
 * That is not a shortfall dressed up. Two of the three cannot be built honestly
 * from what this app records, and the third is a dependency decision:
 *
 *   · The retention heatmap has no component to build it from anywhere in this
 *     repo, and a cohort grid with computed cell shading is a real piece of
 *     work rather than a variant of something already here.
 *   · Stage conversion is blocked twice over — recharts ships no funnel series
 *     type, AND `devotion` is not a concept this product records. There is no
 *     collection, no field and no event; the only matches for the word in
 *     `src/` are marketing copy. 🔴 A funnel-shaped set of numbers does exist
 *     nearby (the CRM's giving pipeline, Member → Giving → Champion) and THE-276
 *     deliberately declined to mount it under a "devotion" label because that
 *     asserts something nobody measured. THIS SLICE DOES NOT UNDO THAT. No
 *     `FunnelChart` is mounted on this tab at all.
 *   · The geo map needs `react-simple-maps` and a ~100KB world topology, and it
 *     answers the same question as the countries table beside it. Table first
 *     was the decision; the map is the upgrade, not the starting point.
 *
 * ⚠️ Each renders an `empty` state naming its reason rather than a blank space,
 * for the reason the tab shell itself renders placeholders: a reader who opens
 * Growth should learn that these exist and are not built, which is true, rather
 * than be shown a tab that quietly has two widgets and looks finished.
 *
 * 🔴 THE DEFERRED THREE ARE `deferred`, NOT `unavailable`. See `WidgetFrame`'s
 * note — one says a read failed, the other says nobody built it, and a founder
 * reading "we could not read your retention data" would go looking for a
 * problem that does not exist.
 *
 * ─── Where the two real widgets get their numbers ────────────────────────────
 *
 * The trend REUSES the Overview tab's `memberSeries` — the same complete,
 * count-gated weekly series over `users.createdAt`, read once by the one
 * `useOverviewData` instance that serves the whole tab strip. Nothing is read
 * twice and the two tabs cannot disagree.
 *
 * The table comes from `useGrowthData`, which is the only read this tab adds.
 * Its coverage caveat is rendered as a figure inside the widget, not hidden —
 * see `LocationTable`.
 */
import React from 'react';
import { Grid3x3, Globe2, Filter } from 'lucide-react';

import { CHART_VARS } from './GivingMix';
import { LocationTable } from './LocationTable';
import { TrendChart } from './TrendChart';
import { WidgetFrame } from './WidgetFrame';
import { GROWTH_REASON } from './growth-data';
import type { GrowthData } from './useGrowthData';
import type { OverviewData } from './useOverviewData';

/**
 * The three widgets this slice does not build.
 *
 * ⚠️ A closed literal table, in the design's order, so the tab cannot grow a
 * fourth deferral by accident and a test can assert all three by iterating it.
 */
export const DEFERRED_GROWTH_WIDGETS = Object.freeze([
  {
    id: 'retention',
    title: 'Retention cohorts',
    description: 'How long the people who joined each month stay.',
    icon: Grid3x3,
    reason: GROWTH_REASON.retentionDeferred,
  },
  {
    id: 'conversion',
    title: 'Stage conversion',
    description: 'How people move from one stage to the next.',
    icon: Filter,
    reason: GROWTH_REASON.conversionDeferred,
  },
  {
    id: 'geo',
    title: 'Where your people are',
    description: 'The countries table above, drawn on a map.',
    icon: Globe2,
    reason: GROWTH_REASON.geoDeferred,
  },
] as const);

export function GrowthTab({ data, growth }: {
  readonly data: OverviewData;
  readonly growth: GrowthData;
}) {
  return (
    <div className="space-y-4" data-growth-tab>
      {/*
        One series, not two. The Overview tab plots members against giving
        because the question there is "how is the ministry doing"; the question
        here is only about people, and a money line on a growth tab would invite
        a causal reading nobody has evidence for.
      */}
      <TrendChart
        title="Member growth"
        description="New members over the last eight weeks, by week."
        series={[
          { key: 'members', label: 'New members', chartVar: CHART_VARS[1], series: data.memberSeries },
        ]}
      />

      <LocationTable
        breakdown={growth.locations}
        reason={growth.loading ? null : growth.locationReason}
      />

      {/*
        🔴 Deferred, not broken, and never a zero. Turning one of these into a
        `0` — "0 cohorts", "0 stages" — would state that this ministry has none
        of the thing, which is a claim about their data made by a widget that
        read none of it.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-deferred-grid>
        {DEFERRED_GROWTH_WIDGETS.map((widget) => (
          <WidgetFrame
            key={widget.id}
            title={widget.title}
            description={widget.description}
            icon={widget.icon}
            state={{ kind: 'deferred', reason: widget.reason }}
            className="min-w-0"
          >
            {null}
          </WidgetFrame>
        ))}
      </div>
    </div>
  );
}
