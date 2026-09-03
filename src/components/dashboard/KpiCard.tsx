"use client";
/**
 * THE-276 — one KPI card: an exact count, and a sparkline only when the trend
 * behind it is complete.
 *
 * ─── Two trust decisions, not one ────────────────────────────────────────────
 *
 * A card shows a number and a shape, and they come from DIFFERENT reads with
 * different guarantees. The number is a `getCountFromServer()` aggregation —
 * exact, unclamped, correct at any size. The sparkline needs dates, which means
 * documents, which means it is only safe below the fetch ceiling.
 *
 * So the two are gated SEPARATELY, and a card with a trustworthy count and an
 * untrustworthy trend shows the count and no trend. Suppressing the count
 * because the trend could not be read would hide something true; drawing the
 * trend anyway is the thing this ticket exists to prevent. The card says which
 * it did — see `trendNote`.
 */
import React from 'react';
import { Area, AreaChart } from 'recharts';
import { TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';

import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ChartContainer, type ChartConfig } from '../ui/chart';
import { Skeleton } from '../ui/skeleton';
import { Spinner } from '../ui/spinner';
import { deltaOf, type Figure, type Series } from './dashboard-data';

export interface KpiCardProps {
  readonly label: string;
  readonly icon: LucideIcon;
  /** The count. Exact, or the reason there isn't one. */
  readonly figure: Figure | null;
  /** The trend. Complete, or the reason there isn't one. */
  readonly series: Series | null;
  /** Which `--chart-N` this card's sparkline draws in. */
  readonly chartVar: string;
  /** Renders the figure — a plain count by default, money where it is money. */
  readonly format?: (value: number) => string;
}

/**
 * ⚠️ The series colour arrives as a `var(--chart-N)` STRING, never as a hex.
 * shadcn's ChartContainer turns `config[key].color` into a `--color-<key>`
 * custom property scoped to this chart, so what recharts finally receives is
 * `var(--color-value)` → `var(--chart-N)` → whichever palette is stamped on
 * <html>. A literal here would be the same colour in all four palettes.
 */
const sparklineConfig = (chartVar: string): ChartConfig => ({ value: { label: 'Value', color: chartVar } });

const DEFAULT_FORMAT = (value: number) => value.toLocaleString();

export function KpiCard({ label, icon: Icon, figure, series, chartVar, format = DEFAULT_FORMAT }: KpiCardProps) {
  const loading = figure === null;
  const points = series?.kind === 'complete' ? series.points : null;
  const delta = points ? deltaOf(points) : null;

  return (
    <Card data-kpi={label} data-state={loading ? 'loading' : figure.kind}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon aria-hidden className="size-4" />
          <span>{label}</span>
          {loading && <Spinner className="ml-auto" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : figure.kind === 'exact' ? (
          <p className="text-2xl font-semibold tabular-nums text-foreground" data-kpi-value>
            {format(figure.value)}
          </p>
        ) : (
          // 🔴 No number, and no zero standing in for one.
          <p className="text-sm text-muted-foreground" data-kpi-unavailable>
            {figure.reason}
          </p>
        )}

        {points && points.some((p) => p.value !== 0) && (
          <ChartContainer config={sparklineConfig(chartVar)} className="aspect-auto h-10 w-full" data-kpi-sparkline>
            <AreaChart data={points as { label: string; value: number }[]} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
              <Area
                dataKey="value"
                type="monotone"
                stroke="var(--color-value)"
                fill="var(--color-value)"
                fillOpacity={0.15}
                strokeWidth={2}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ChartContainer>
        )}

        {delta !== null && (
          <Badge variant="secondary" data-kpi-delta>
            {delta >= 0 ? <TrendingUp aria-hidden /> : <TrendingDown aria-hidden />}
            {`${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}% vs last week`}
          </Badge>
        )}

        {series?.kind === 'unavailable' && figure?.kind === 'exact' && (
          // The count above is real; only its shape over time is missing. Saying
          // so is the difference between a quiet omission and a silent zero.
          <p className="text-xs text-muted-foreground" data-kpi-trend-note>
            {series.reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
