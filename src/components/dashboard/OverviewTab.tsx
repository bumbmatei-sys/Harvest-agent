"use client";
/**
 * THE-276 — the Overview tab: the one tab this slice ships.
 *
 * Seven KPI cards, a live-now strip, the giving & growth trend, the insight
 * feed, the funnel and the giving mix. Every figure on it comes from
 * {@link useOverviewData}, which is the only place a read happens.
 *
 * 🔴 NOT IN THIS SLICE, and deliberately absent rather than stubbed: the geo map
 * ("Where your people are", which needs react-simple-maps and a ~100KB TopoJSON
 * — a dependency decision, not a layout one), the retention cohort heatmap, and
 * every leaderboard and table. Adding an empty placeholder card for each would
 * imply they are coming in this tab; they are separate tickets.
 */
import React from 'react';
import {
  BookOpen, Building2, FileText, HandCoins, MessageCircle, Newspaper, Users, UserSquare,
} from 'lucide-react';

import { REASON, type Series } from './dashboard-data';
import { FunnelChart } from './FunnelChart';
import { GivingMix, CHART_VARS } from './GivingMix';
import { InsightFeed } from './InsightFeed';
import { KpiCard } from './KpiCard';
import { LiveNowStrip } from './LiveNowStrip';
import { TrendChart } from './TrendChart';
import type { OverviewData } from './useOverviewData';

/**
 * ⚠️ Five series colours exist, and there are seven cards. The sixth and
 * seventh reuse `--chart-1` and `--chart-2` rather than a sixth token being
 * minted for them — these are seven INDEPENDENT sparklines, never plotted
 * against each other, so a repeated hue encodes no false relationship. A shared
 * chart (the trend, the mix) never repeats one; see GivingMix's cap.
 */
const KPI_VAR = [...CHART_VARS, CHART_VARS[0], CHART_VARS[1]] as const;

export function OverviewTab({ data, unreadCount, showInbox }: {
  readonly data: OverviewData;
  readonly unreadCount: number;
  readonly showInbox: boolean;
}) {
  const { seventh } = data;

  const cards = [
    { label: 'Members', icon: Users, figure: data.members, series: data.memberSeries },
    { label: 'Contacts', icon: UserSquare, figure: data.contacts, series: null },
    { label: 'Published courses', icon: BookOpen, figure: data.courses, series: null },
    { label: 'Community posts', icon: MessageCircle, figure: data.posts, series: null },
    { label: 'Articles', icon: Newspaper, figure: data.articles, series: null },
    { label: 'Form submissions', icon: FileText, figure: data.submissions, series: data.submissionSeries },
    {
      label: seventh.label,
      icon: seventh.label === 'Ministries' ? Building2 : HandCoins,
      figure: seventh.figure,
      series: null as Series | null,
    },
  ];

  return (
    <div className="space-y-4">
      <LiveNowStrip liveNow={data.liveNow} unreadCount={unreadCount} showInbox={showInbox} />

      {/* One column on a phone, two on a tablet, four from `lg` — the same
          cliff the admin shell itself becomes desktop at. No width is set here:
          the cards take the measure of whatever the shell gives them. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-kpi-grid>
        {cards.map((card, i) => (
          <KpiCard
            key={card.label}
            label={card.label}
            icon={card.icon}
            figure={card.figure}
            series={card.series}
            chartVar={KPI_VAR[i]}
          />
        ))}
      </div>

      <TrendChart
        series={[
          { key: 'members', label: 'New members', chartVar: CHART_VARS[1], series: data.memberSeries },
          { key: 'giving', label: 'Received', chartVar: CHART_VARS[0], series: data.givingSeries },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <InsightFeed
          loading={data.loading}
          inputs={{
            memberSeries: data.memberSeries,
            givingSeries: data.givingSeries,
            contacts: data.contacts,
            submissionsSeries: data.submissionSeries,
          }}
        />
        <GivingMix rows={data.invoiceRows} reason={data.loading ? null : data.invoiceReason} />
      </div>

      {/* 🔴 The devotion funnel. `devotion` is not a concept this product
          records — no collection, no field, no event — so there are no stages to
          read and the widget says so. See FunnelChart's header for the funnel
          that DOES exist and why it is not silently mounted here instead. */}
      <FunnelChart
        title="Devotion funnel"
        description="Stages of devotional engagement."
        stages={null}
        reason={data.loading ? null : REASON.noSource('devotional reading, streaks or plan progress')}
        chartVar={CHART_VARS[2]}
      />
    </div>
  );
}
