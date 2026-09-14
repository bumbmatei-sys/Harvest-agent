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
  /**
   * THE-362 — HOW ONE BUCKET BECOMES A STRING, WHEN IT IS NOT A COUNT.
   *
   * Absent for a count (members, submissions): the tooltip renders those with
   * `toLocaleString`, exactly as it always has. Supplied for MONEY, and for
   * money it is always `formatCents` — the one helper that turns cents into
   * dollars, and the same one `DonationHistory` and `AdminCRM`'s timeline go
   * through.
   *
   * THIS IS THE FIX FOR THE 100×. `givingSeriesCents` is denominated in
   * cents, and before this field existed the chart had no way to know that: a
   * $50 gift arrived as `5000` and `ChartTooltipContent` printed `5,000`,
   * which a founder reads as five thousand dollars. Nothing about the series is
   * converted — the bucket is still cents, the plotted geometry is unchanged,
   * and the division happens once, here, at the moment the number becomes text.
   */
  readonly format?: (value: number) => string;
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

/**
 * ⚠️ `title` and `description` DEFAULT to the Overview tab's wording rather than
 * being required, so THE-276's call site is unchanged and this component keeps
 * exactly one behaviour. THE-283 needs the same chart with one series and a
 * different heading on the Growth tab, and a second chart component written for
 * that would be two places for an axis, a tooltip and an empty state to drift.
 */
export function TrendChart({
  series,
  title = 'Giving & growth',
  description = 'The last eight weeks, by week.',
}: {
  readonly series: readonly TrendSeries[];
  readonly title?: string;
  readonly description?: string;
}) {
  const loading = series.some((s) => s.series === null);
  const complete = series
    .filter((s) => s.series?.kind === 'complete')
    .map((s) => ({
      key: s.key,
      label: s.label,
      chartVar: s.chartVar,
      format: s.format,
      points: (s.series as { points: readonly SeriesPoint[] }).points,
    }));
  const refused = series.filter((s) => s.series?.kind === 'unavailable');

  const state: WidgetState = loading
    ? { kind: 'loading' }
    : complete.length === 0
      ? { kind: 'unavailable', reason: refused[0]?.series?.kind === 'unavailable' ? refused[0].series.reason : REASON.readFailed }
      : { kind: 'ready' };

  const config: ChartConfig = Object.fromEntries(complete.map((s) => [s.key, { label: s.label, color: s.chartVar }]));

  /**
   * Each plotted series, by the `dataKey` recharts hands the tooltip back.
   *
   * THE LABEL AND THE SWATCH COME FROM HERE TOO, not just the formatter.
   * `ChartTooltipContent`'s `formatter` replaces the WHOLE row — indicator,
   * name and value — so a formatter that returned a bare string would silently
   * delete the series name from a two-series chart and leave a reader unable to
   * tell the giving figure from the member one. The row below is the
   * primitive's own default shape, rebuilt with the unit applied.
   */
  const seriesFor = new Map(complete.map((s) => [s.key, s]));

  /**
   * How a Y-AXIS tick is written, when every series on the chart agrees.
   *
   * ONE AXIS SERVES EVERY SERIES, so a per-series formatter cannot be
   * applied to it: the Overview tab plots money and a member COUNT against the
   * same ticks, and there is no string that is honest for both. So the axis
   * takes a formatter only when the complete series UNANIMOUSLY carry the same
   * one — the Giving tab, which plots giving alone, gets dollar ticks; the
   * Overview tab keeps plain numbers on the axis and says the unit in the
   * tooltip, which is per-series and always correct.
   *
   * `undefined`, not an identity function: recharts falls back to its own
   * default tick rendering, which is what the axis did before this ticket.
   */
  const axisFormat =
    complete.length > 0 && complete.every((s) => s.format && s.format === complete[0].format)
      ? complete[0].format
      : undefined;

  return (
    <WidgetFrame
      title={title}
      description={description}
      icon={LineChartIcon}
      state={state}
      skeletonClassName="h-56 w-full"
    >
      <div className="space-y-2">
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <AreaChart data={mergePoints(complete)} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
            <YAxis
              width={axisFormat ? 72 : 40}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              tickFormatter={axisFormat ? (v: number) => axisFormat(Number(v)) : undefined}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => {
                    const key = String(name);
                    const s = seriesFor.get(key);
                    const n = Number(value);
                    /* NO SWATCH. The primitive's own row paints one from an
                       inline `style`, and THE-276 forbids a style attribute in
                       this directory — a runtime colour assigned from markup is
                       the one thing a class cannot express. The series LABEL is
                       what tells a reader which line they are on, and it is
                       here; the swatch was only ever a second copy of that. */
                    return (
                      <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                        <span className="text-muted-foreground">{s?.label ?? key}</span>
                        <span
                          className="font-mono font-medium text-foreground tabular-nums"
                          data-trend-value={key}
                        >
                          {s?.format ? s.format(n) : n.toLocaleString()}
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
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
