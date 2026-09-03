"use client";
/**
 * THE-276 — "Giving & growth", the Overview tab's one full-width trend.
 *
 * Two series over the same eight weekly buckets: money received, and members
 * gained. They are read independently and gated independently — a ministry
 * whose contacts sit under the fetch ceiling and whose receipts do not gets the
 * growth line and an explicit note about the missing one, rather than an empty
 * chart or, worse, a giving line drawn from a partial ledger.
 */
import React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { LineChart as LineChartIcon } from 'lucide-react';

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../ui/chart';
import { REASON, type Series, type SeriesPoint } from './dashboard-data';
import { WidgetFrame, type WidgetState } from './WidgetFrame';

export interface TrendSeries {
  readonly key: string;
  readonly label: string;
  /** A `var(--chart-N)` reference. Never a literal — see KpiCard's note. */
  readonly chartVar: string;
  readonly series: Series | null;
}

/** One row per bucket, with a column per COMPLETE series. Nothing else joins. */
function mergePoints(complete: { key: string; points: readonly SeriesPoint[] }[]): Record<string, string | number>[] {
  const labels = complete[0]?.points.map((p) => p.label) ?? [];
  return labels.map((label, i) => {
    const row: Record<string, string | number> = { label };
    for (const s of complete) row[s.key] = s.points[i]?.value ?? 0;
    return row;
  });
}

export function TrendChart({ series }: { series: readonly TrendSeries[] }) {
  const loading = series.some((s) => s.series === null);
  const complete = series
    .filter((s) => s.series?.kind === 'complete')
    .map((s) => ({ key: s.key, label: s.label, chartVar: s.chartVar, points: (s.series as { points: readonly SeriesPoint[] }).points }));
  const refused = series.filter((s) => s.series?.kind === 'unavailable');

  const state: WidgetState = loading
    ? { kind: 'loading' }
    : complete.length === 0
      ? { kind: 'unavailable', reason: refused[0]?.series?.kind === 'unavailable' ? refused[0].series.reason : REASON.readFailed }
      : { kind: 'ready' };

  const config: ChartConfig = Object.fromEntries(complete.map((s) => [s.key, { label: s.label, color: s.chartVar }]));

  return (
    <WidgetFrame
      title="Giving & growth"
      description="The last eight weeks, by week."
      icon={LineChartIcon}
      state={state}
      skeletonClassName="h-56 w-full"
    >
      <div className="space-y-2">
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <AreaChart data={mergePoints(complete)} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
            <YAxis width={40} tickLine={false} axisLine={false} tickMargin={4} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {complete.map((s) => (
              <Area
                key={s.key}
                dataKey={s.key}
                type="monotone"
                stroke={`var(--color-${s.key})`}
                fill={`var(--color-${s.key})`}
                fillOpacity={0.15}
                strokeWidth={2}
                isAnimationActive={false}
                dot={false}
              />
            ))}
          </AreaChart>
        </ChartContainer>
        {refused.map((s) => (
          <p key={s.key} className="text-xs text-muted-foreground" data-series-unavailable={s.key}>
            {`${s.label}: ${s.series?.kind === 'unavailable' ? s.series.reason : REASON.readFailed}`}
          </p>
        ))}
      </div>
    </WidgetFrame>
  );
}
