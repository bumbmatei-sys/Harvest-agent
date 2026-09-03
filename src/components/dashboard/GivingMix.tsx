"use client";
/**
 * THE-276 — "Giving mix": what the tenant's receipts are FOR.
 *
 * ─── The dimension is real, and it is the document's own field ───────────────
 *
 * `tenants/{t}/invoices` carries `type: 'donation_receipt' | 'event_ticket' |
 * 'invoice'` — a field the Stripe webhook and the receipt issuer both write, and
 * the one AdminAccounting already filters its own tabs by. So the slices here
 * are a field, not a category invented for a chart. A row whose `type` is not
 * one of the three is grouped under its own raw value rather than folded into
 * one of them; the money is real either way and reassigning it would be the
 * fabrication this ticket forbids.
 *
 * 🔴 Amounts are CENTS on the document. They are divided ONCE, here, at the
 * point of display. AdminAccounting shipped the inverse of this bug and rendered
 * $105,500 as $10,550,000.
 */
import React from 'react';
import { Cell, Pie, PieChart } from 'recharts';
import { PieChart as PieChartIcon } from 'lucide-react';

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../ui/chart';
import { REASON, type ReadableReceipt } from './dashboard-data';
import { WidgetFrame, type WidgetState } from './WidgetFrame';

/** The five series slots the palette declares, in order. No sixth colour exists. */
export const CHART_VARS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

const TYPE_LABELS: Record<string, string> = {
  donation_receipt: 'Donations',
  event_ticket: 'Event tickets',
  invoice: 'Invoices',
};

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);

export interface MixSlice { readonly key: string; readonly label: string; readonly cents: number }

/**
 * Group receipts by their own `type`, largest first. Pure, so a test can pin it.
 *
 * 🔴 Takes {@link ReadableReceipt}, not the raw row: a receipt whose amount or
 * type could not be read never reaches here, because `readableReceipts` has
 * already refused the whole widget. The type is what enforces that — there is
 * no `?? 0` and no `?? 'invoice'` for this function to fall back on.
 */
export function givingMix(rows: readonly ReadableReceipt[]): MixSlice[] {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.type, (totals.get(row.type) ?? 0) + row.amountCents);
  return [...totals.entries()]
    .map(([key, cents]) => ({ key, label: TYPE_LABELS[key] ?? key, cents }))
    .filter((s) => s.cents > 0)
    .sort((a, b) => b.cents - a.cents)
    // ⚠️ Capped at the number of series colours that exist. A sixth slice would
    // have to reuse one, and two slices in one colour is a chart that lies about
    // how many things it is showing.
    .slice(0, CHART_VARS.length);
}

export function GivingMix({ rows, reason }: { rows: readonly ReadableReceipt[] | null; reason: string | null }) {
  const slices = rows ? givingMix(rows) : [];
  const state: WidgetState = rows === null && reason === null
    ? { kind: 'loading' }
    : rows === null
      ? { kind: 'unavailable', reason: reason ?? REASON.readFailed }
      : slices.length === 0
        ? { kind: 'unavailable', reason: REASON.noSource('a gift or a ticket sale yet') }
        : { kind: 'ready' };

  const config: ChartConfig = Object.fromEntries(
    slices.map((s, i) => [s.key, { label: s.label, color: CHART_VARS[i] }]),
  );

  return (
    <WidgetFrame
      title="Giving mix"
      description="Every receipt on the ledger, by what it was for."
      icon={PieChartIcon}
      state={state}
      skeletonClassName="h-48 w-full"
    >
      <div className="space-y-3">
        <ChartContainer config={config} className="aspect-auto h-48 w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="key" />} />
            <Pie data={slices as MixSlice[]} dataKey="cents" nameKey="key" innerRadius={45} outerRadius={75} isAnimationActive={false}>
              {slices.map((s) => (
                <Cell key={s.key} fill={`var(--color-${s.key})`} />
              ))}
            </Pie>
            {/* The swatch↔slice colour mapping is the primitive's job. Rendering
                our own would mean assigning a runtime colour from markup, which
                is the one thing a class cannot express — so the legend below
                carries the totals and no colour at all. */}
            <ChartLegend content={<ChartLegendContent nameKey="key" />} />
          </PieChart>
        </ChartContainer>
        <ul className="space-y-1">
          {slices.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-xs" data-mix-slice={s.key}>
              <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
              <span className="font-medium tabular-nums text-foreground">{money(s.cents)}</span>
            </li>
          ))}
        </ul>
      </div>
    </WidgetFrame>
  );
}
