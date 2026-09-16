"use client";
/**
 * THE-290 — the Giving tab: slice 3 of 6, and the ledger read.
 *
 * ─── THREE widgets, and one of them is a RELOCATION ──────────────────────────
 *
 * 🔴 GIVING OVER TIME IS NOT REBUILT HERE. It is the Overview tab's
 * `givingSeriesCents` — the same complete, count-gated, `readableReceipts`-gated
 * weekly series over `invoices.issuedAt`, weighed by `amountCents` — read once
 * by the one `useOverviewData` instance that sits above the whole tab strip and
 * handed to this tab as a prop.
 *
 * ⚠️ It is therefore not merely EQUAL to the figure Overview plots, it is the
 * SAME OBJECT. There is no second read, no second gate and no arithmetic
 * anywhere between the two tabs, so there is nothing that could make them
 * disagree. That is #429's pattern exactly: it put the member trend on the
 * Growth tab by plotting `memberSeries` a second time under its own heading,
 * and left the Overview tab's own trend untouched. This does the same with
 * giving — 🔴 Overview keeps every widget and every empty state it had, byte for
 * byte, and this slice's no-regression test asserts it against Overview's
 * rendered output.
 *
 * THE UNITS ARE UNCHANGED BY THE MOVE. `givingSeriesCents` is denominated in
 * CENTS, exactly as the Overview tab plots it, and it is passed through here
 * with no transformation of any kind. Dividing it would be the cents/dollars
 * mixing this ticket forbids. The two dollar-denominated widgets below never
 * touch it.
 *
 * THE-362 — AND THAT IS PRECISELY WHY BOTH TABS WERE WRONG. "Passed through
 * untouched" was true, and the field's name said nothing about its unit, so
 * `TrendChart` drew the raw bucket: a $50 gift appeared as 5,000 on BOTH this
 * tab and Overview. The founder: "instead of 50$ donated it shows 5000$."
 * The series is STILL passed through untouched — what changed is that the call
 * site now hands the chart `formatCents` alongside it, so the one conversion
 * happens where the number becomes text, and it happens identically on both
 * tabs because both call sites pass the same helper.
 *
 * ─── The other two, and what they cost ───────────────────────────────────────
 *
 * `CampaignProgress` and `PledgeFulfilment` come from `useGivingData`, which is
 * the only read this tab adds and which is mounted inside this tab's panel by
 * `AdminDashboardHome` — Base UI mounts only the ACTIVE panel, so `campaigns`
 * and `tenants/{t}/pledges` are read when someone selects Giving and never on a
 * visit that only looks at Overview.
 *
 * ─── 🔴 What this tab does NOT contain, and why the list is short ────────────
 *
 * No top givers (#429's territory and already shipped), no donor retention
 * curve, no giving heatmap, and 🔴 NO RECURRING, SUBSCRIPTION OR MONTHLY GIVING
 * WIDGET — see `PledgeFulfilment`'s header for the three independent reasons
 * that one cannot be built honestly from what this app records. Nothing is
 * stubbed in their place: unlike the Growth tab's three `deferred` frames,
 * which name work that is coming, a recurring-giving frame would name work that
 * is not coming because the data does not exist, and a founder reading it would
 * go looking for a setting to switch on.
 */
import React from 'react';

import { formatCents } from '../../lib/donation-history';
import { CampaignProgress } from './CampaignProgress';
import { CHART_VARS } from './GivingMix';
import { PledgeFulfilment } from './PledgeFulfilment';
import { TrendChart } from './TrendChart';
import { GivingDocsLink } from '../admin/GivingDocsLink';
import type { GivingData } from './useGivingData';
import type { OverviewData } from './useOverviewData';

export function GivingTab({ data, giving }: {
  readonly data: OverviewData;
  readonly giving: GivingData;
}) {
  return (
    <div className="space-y-4" data-giving-tab>
      {/* 🔴 THE-368 — THE MONEY FLOW, and THIS is the dashboard's giving
          surface rather than `AdminDashboard.tsx`, which is the shell that
          routes between screens and draws no figure at all. Every widget below
          is a figure — a trend, a campaign bar, a pledge total — so "why is
          this number what it is" is the only question this tab raises, and the
          money flow is the page that answers it.

          ⚠️ AT THE TOP, NOT THE FOOT. The last widget on this tab is the one
          that clears the admin shell's fixed bottom nav, and that clearance is
          measured elsewhere against a real Chromium; appending anything after
          `PledgeFulfilment` would put this link under the nav bar on a phone
          and move the thing that measurement is about. */}
      <GivingDocsLink page="theMoneyFlow" />

      {/*
        ONE SERIES, and it is `data.givingSeriesCents` verbatim — not a copy, not a
        remapped one. `TrendChart` takes an overridable title (THE-283 added it
        for the same reason) so the heading can be this tab's while the chart
        stays the one component both tabs share. `CHART_VARS[0]` is the slot the
        Overview tab already draws giving in, so the colour does not change
        under a reader who moves between the two.
      */}
      <TrendChart
        title="Giving over time"
        description="Every receipt on the ledger over the last eight weeks, by week."
        series={[
          {
            key: 'giving',
            label: 'Received',
            chartVar: CHART_VARS[0],
            series: data.givingSeriesCents,
            format: formatCents,
          },
        ]}
      />

      <CampaignProgress
        breakdown={giving.campaigns}
        reason={giving.loading ? null : giving.campaignReason}
      />

      {/*
        🔴 THE LAST WIDGET ON THE TAB. The admin shell's bottom nav is `fixed
        bottom-0` at `z-[100]` with `pb-safe`, so anything ending underneath it
        is unreadable on a phone. The clearance comes from the shell's own
        `pb-24` on its scroll container — a file this ticket may not open — and
        the layout test measures the real gap in Chromium at 380px rather than
        trusting that class name.
      */}
      <PledgeFulfilment
        summary={giving.pledges}
        reason={giving.loading ? null : giving.pledgeReason}
      />
    </div>
  );
}
