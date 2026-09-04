"use client";
/**
 * THE-294 — the Engagement tab: slice 4 of 6, and the activity read.
 *
 * ─── FIVE widgets, and none of them is deferred ─────────────────────────────
 *
 * Engagement over time, attendance & check-in, activity type, how widely
 * engagement is spread, and prayer wall activity. Every one of them is BUILT and
 * reads real documents; each renders an explicit reason instead of a figure when
 * its own read cannot be trusted.
 *
 * ⚠️ Unlike the Growth tab there is no `deferred` frame here. Growth has three,
 * and they are honest there: the retention heatmap, stage conversion and the geo
 * map are work that is coming. Nothing on THIS tab is waiting on a component or
 * a dependency — so a deferred frame here would name work nobody intends to do.
 *
 * ─── 🔴 The two widgets the design asked for that are NOT here ──────────────
 *
 * 1. NO "MOST ENGAGED MEMBERS" LEADERBOARD. It is replaced by
 *    `EngagementSpread`, which answers the same question in aggregate; the two
 *    independent reasons are in that file's header and are restated on screen.
 *    Not deferred and not empty — replaced, because a per-person ranking of
 *    this data would be a wrong number with a name attached.
 *
 * 2. NO "CHANNEL SHARE". It is `ActivityTypes`, under the name the data
 *    supports. Again see that file's header: the five values of
 *    `contactActivities.type` describe what a CRM row IS, not how a person
 *    arrived, and nothing in this database records an acquisition channel.
 *
 * ─── 🔴 The ceiling, and what a busy church actually sees ───────────────────
 *
 * `contactActivities` grows without bound and `completeRead` refuses above
 * `DASHBOARD_FETCH_LIMIT` (1,000). So on a busy ministry the trend, the type
 * table and the spread ALL render an explicit empty state that says exactly
 * that, together, in one wording — never a truncated number. Attendance and the
 * prayer wall read different collections and are gated separately, so they still
 * answer. That is the honest failure mode and it is the one this tab ships.
 *
 * ─── Why the prayer wall chart is shorter than the others ───────────────────
 *
 * 🔴 FOUR WEEKS, NOT EIGHT. `prayer_requests` rows carry an `expiresAt` thirty
 * days out and a nightly cron deletes every expired one. Buckets older than the
 * retention window can only ever count zero, so an eight-week chart would draw a
 * collapse that is a deletion policy rather than a fact about the church. The
 * cap lives in `PRAYER_TREND_WEEKS` and the chart says on its face that it is
 * four weeks and why.
 */
import React from 'react';

import { ActivityTypes } from './ActivityTypes';
import { AttendanceCard } from './AttendanceCard';
import { EngagementSpread } from './EngagementSpread';
import { CHART_VARS } from './GivingMix';
import { TrendChart } from './TrendChart';
import { PRAYER_TREND_WEEKS } from './engagement-data';
import type { EngagementData } from './useEngagementData';

export function EngagementTab({ engagement }: { readonly engagement: EngagementData }) {
  /*
    ⚠️ `null` while loading, and the tab's own reason afterwards. `TrendChart`
    reads `series === null` as loading, so passing the reason through as an
    `unavailable` series only once the read has finished is what keeps a
    skeleton from being replaced by a flash of "this could not be read".
  */
  const activity = engagement.loading
    ? null
    : engagement.activitySeries
      ?? ({ kind: 'unavailable', reason: engagement.activityReason ?? '' } as const);

  const prayer = engagement.loading
    ? null
    : engagement.prayer
      ?? ({ kind: 'unavailable', reason: engagement.prayerReason ?? '' } as const);

  return (
    <div className="space-y-4" data-engagement-tab>
      {/*
        One series, not two. Attendance is a total rather than a trend — see
        `AttendanceCard` — and plotting a check-in line beside a CRM-activity
        line would invite a reader to compare two counts that are not the same
        kind of thing.
      */}
      <TrendChart
        title="Engagement over time"
        description="CRM activity over the last eight weeks, by week."
        series={[
          { key: 'activity', label: 'Activity records', chartVar: CHART_VARS[2], series: activity },
        ]}
      />

      <AttendanceCard
        summary={engagement.attendance}
        reason={engagement.loading ? null : engagement.attendanceReason}
      />

      <ActivityTypes
        breakdown={engagement.activityTypes}
        reason={engagement.loading ? null : engagement.activityReason}
      />

      <EngagementSpread
        spread={engagement.spread}
        reason={engagement.loading ? null : engagement.activityReason}
      />

      {/*
        🔴 THE SHORT WINDOW IS ON THE FACE OF THE CHART. A reader who sees four
        bars where every other trend on this dashboard has eight must be told
        why, in the widget, or they will read it as missing data.
      */}
      <TrendChart
        title="Prayer wall activity"
        description={`Requests posted over the last ${PRAYER_TREND_WEEKS} weeks, by week. The wall is cleared automatically thirty days after a request is written, so a longer chart would show that policy rather than this ministry.`}
        series={[
          { key: 'prayer', label: 'Requests posted', chartVar: CHART_VARS[1], series: prayer },
        ]}
      />
    </div>
  );
}
