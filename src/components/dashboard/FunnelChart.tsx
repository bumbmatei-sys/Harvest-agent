"use client";
/**
 * THE-276 — the funnel, drawn as a horizontal bar.
 *
 * ─── 🔴 Recharts has no funnel, and the alternative I was given is not real ──
 *
 * Recharts ships no `Funnel` series type; there is nothing to import. The
 * ticket's own note that shoogle.dev has a Funnel Chart component was checked
 * and withdrawn — that registry returns `totalResults: 0`. So a funnel here is
 * a horizontal bar chart with one row per stage, `layout="vertical"`, which is
 * what a funnel is once you stop drawing the trapezoid: an ordered set of
 * magnitudes with a shared baseline. No registry and no dependency was added
 * for this slice.
 *
 * ─── ⚠️ What this widget is mounted with on the Overview tab, and why ────────
 *
 * The Overview tab asks it for the DEVOTION funnel, and there is no devotion
 * data in this product. `devotion` appears nowhere in the schema — the only
 * matches anywhere in src/ are marketing copy in AuthPage, Onboarding and
 * CanvasList, and a blog prompt. There is no collection, no field and no event
 * recording a devotional read, start or streak, so there are no stages to
 * count. It therefore renders its empty state, with that as the reason.
 *
 * 🔴 A funnel-shaped set of numbers DOES exist nearby — the CRM's giving
 * pipeline, `resolvePipelineStage(contact.totalDonated)` over Member → Giving →
 * Champion — and it is deliberately NOT wired in here. It would fill the space
 * and it would be the wrong widget: labelling giving tiers "devotion" asserts
 * something nobody measured. It is named in the PR description as the thing to
 * mount if a giving funnel is what was wanted; that is a decision, not a
 * default, and the component below takes stages from its caller precisely so
 * making it is a one-line change.
 */
import React from 'react';
import { Bar, BarChart, LabelList, XAxis, YAxis } from 'recharts';
import { Filter } from 'lucide-react';

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../ui/chart';
import { REASON } from './dashboard-data';
import { WidgetFrame, type WidgetState } from './WidgetFrame';

export interface FunnelStage { readonly key: string; readonly label: string; readonly value: number }

export interface FunnelChartProps {
  readonly title: string;
  readonly description: string;
  /** Ordered widest-first. `null` with a reason is the refused case. */
  readonly stages: readonly FunnelStage[] | null;
  readonly reason: string | null;
  readonly chartVar: string;
}

export function FunnelChart({ title, description, stages, reason, chartVar }: FunnelChartProps) {
  const state: WidgetState = stages === null && reason === null
    ? { kind: 'loading' }
    : stages === null
      ? { kind: 'unavailable', reason: reason ?? REASON.readFailed }
      : stages.length === 0
        ? { kind: 'unavailable', reason: REASON.noSource('these stages') }
        : { kind: 'ready' };

  const config: ChartConfig = { value: { label: 'People', color: chartVar } };

  return (
    <WidgetFrame title={title} description={description} icon={Filter} state={state} skeletonClassName="h-48 w-full">
      <ChartContainer config={config} className="aspect-auto h-48 w-full">
        <BarChart
          data={(stages ?? []) as FunnelStage[]}
          layout="vertical"
          margin={{ top: 4, right: 32, bottom: 4, left: 8 }}
        >
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={92} tickLine={false} axisLine={false} tickMargin={4} />
          <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={4} isAnimationActive={false}>
            <LabelList dataKey="value" position="right" className="fill-foreground text-xs" />
          </Bar>
        </BarChart>
      </ChartContainer>
    </WidgetFrame>
  );
}
