"use client";
/**
 * THE-290 — every read the Giving tab makes that the Overview tab has not
 * already made.
 *
 * ─── Which is TWO, and the omission is again the point ───────────────────────
 *
 * 🔴 THE RECEIPT LEDGER IS NOT READ HERE. Giving-over-time is RELOCATED, not
 * rebuilt: `useOverviewData` already produces `givingSeries` — a complete,
 * count-gated, `readableReceipts`-gated weekly series over `invoices.issuedAt`,
 * weighed by `amountCents` — and `AdminDashboardHome` holds ONE instance of that
 * hook above the whole tab strip. The Giving tab is handed that series.
 *
 * ⚠️ That is #429's pattern applied unchanged. #429 did not move the member
 * trend off the Overview tab in order to put it on Growth; it plotted the SAME
 * `memberSeries` in a second widget with its own heading, so the two tabs read
 * one number from one read and cannot disagree. This tab does the same with
 * giving. The consequence is the property the ticket asks for directly: the
 * figures on Giving are not merely equal to Overview's, they are the SAME
 * OBJECT, so there is no arithmetic anywhere that could make them differ.
 *
 * So this hook reads the two things the Overview tab has no use for:
 *
 *   · `campaigns` scoped to the tenant — `title`, `goal`, `raised`, `isActive`.
 *   · `tenants/{t}/pledges` — `pledgeAmount`, `paidAmount`, `status`, `dueDate`.
 *
 * ⚠️ IT IS A SEPARATE HOOK, not two fields added to `useOverviewData`, for
 * THE-283's reason: that hook runs for every admin who opens the dashboard, and
 * these two reads are wanted only by someone who opens the Giving tab. Base UI
 * mounts only the ACTIVE tab panel, so a `GivingTab` that owns its own hook
 * issues these queries when — and only when — the tab is selected.
 *
 * ─── 🔴 Scoping: TENANT ONLY, and the apex is not a special case ─────────────
 *
 * `useOverviewData` reads unscoped on the apex for a super admin, and this hook
 * deliberately does NOT. THE-276 settled it for the giving widgets and the same
 * reasoning covers both of these:
 *
 *   · `tenants/{t}/pledges` is a subcollection, one ledger per tenant. There is
 *     no apex-level pledge collection to read, so there is nothing an unscoped
 *     read could even address.
 *   · `campaigns` IS top-level and a super admin's token would pass its rules
 *     unscoped — and summing every church's campaigns into one progress figure
 *     is a number this product does not define. Which church is at 40% of
 *     which goal is not a platform question, and a Giving tab where one of
 *     three widgets answered a cross-tenant question while the other two said
 *     "no ministry is in scope" would be incoherent.
 *
 * So on the apex all three widgets report {@link REASON.noTenant}, which is the
 * same answer the Overview tab's giving widgets already give there. No new
 * reason string, and no platform-wide giving figure invented by a hook.
 *
 * ─── Both reads are COMPLETE or they are refused ─────────────────────────────
 *
 * `completeRead` takes the count from `getCountFromServer` FIRST and refuses
 * above `DASHBOARD_FETCH_LIMIT`, so what comes back is either every matching
 * document or nothing. That is what makes the aggregates exact: there is no
 * third case for them to be approximately right about. Then the money gate runs
 * — `readableCampaigns` / `readablePledges` — and a single unreadable amount
 * refuses the widget with a count rather than shrinking its total.
 */
import { useEffect, useState } from 'react';

import {
  GIVING_REASON,
  REASON,
  aggregateCampaigns,
  boundedPledgesQuery,
  boundedScopedQuery,
  completeRead,
  pledgesQuery,
  readableCampaigns,
  readablePledges,
  scopedQuery,
  summarisePledges,
  toCampaignRow,
  toPledgeRow,
  type CampaignBreakdown,
  type PledgeSummary,
} from './giving-data';

/**
 * What the Giving tab reads for itself.
 *
 * ⚠️ Each widget gets a value OR a reason, never both and never neither — the
 * same two-field shape `useGrowthData` uses, for the same reason: a `null` value
 * with a `null` reason is the LOADING state and nothing else, so a widget can
 * never render an empty frame that means "we did not try".
 */
export interface GivingData {
  readonly loading: boolean;
  readonly campaigns: CampaignBreakdown | null;
  readonly campaignReason: string | null;
  readonly pledges: PledgeSummary | null;
  readonly pledgeReason: string | null;
}

const PENDING: GivingData = {
  loading: true,
  campaigns: null, campaignReason: null,
  pledges: null, pledgeReason: null,
};

/**
 * Read the Giving tab.
 *
 * `now` is a parameter so a test can pin what "overdue" is measured against;
 * production never passes it.
 *
 * 🔴 IT IS CAPTURED ONCE PER MOUNT, exactly as `useOverviewData` captures its
 * own. `Date.now()` as a default argument produces a new value on every render,
 * so leaving it in the dependency array makes the effect re-run on the state
 * update it just caused — an unbounded loop re-issuing every read on this tab
 * against a billed database. Freezing it in state closes that loop, and it is
 * also the behaviour the widget wants: which pledges are overdue should not
 * shift underneath a reader mid-session.
 */
export function useGivingData(
  tenantId: string | null,
  now: number = Date.now(),
): GivingData {
  const [data, setData] = useState<GivingData>(PENDING);
  const [readAt] = useState(() => now);

  useEffect(() => {
    let cancelled = false;
    setData(PENDING);

    (async () => {
      let campaigns: CampaignBreakdown | null = null;
      let campaignReason: string | null = REASON.noTenant;
      let pledges: PledgeSummary | null = null;
      let pledgeReason: string | null = REASON.noTenant;

      if (tenantId) {
        // ── Campaigns ──────────────────────────────────────────────────────
        // 🔴 `raised` is read off each document and summed. It is NEVER
        // recomputed from `invoices`, which are not read on this path at all.
        const campaignRead = await completeRead(
          scopedQuery('campaigns', tenantId),
          boundedScopedQuery('campaigns', tenantId),
          toCampaignRow,
        );
        const campaignMoney =
          campaignRead.kind === 'complete' ? readableCampaigns(campaignRead.rows) : campaignRead;
        if (campaignMoney.kind === 'complete') {
          // 🔴 A complete read of a ministry that has run no campaigns is not an
          // empty table — it is a widget with nothing to say. Zero rows would
          // read as "your campaigns raised nothing"; the reason says what is
          // actually true.
          if (campaignMoney.rows.length === 0) {
            campaignReason = GIVING_REASON.noCampaigns;
          } else {
            campaigns = aggregateCampaigns(campaignMoney.rows);
            campaignReason = null;
          }
        } else {
          campaignReason = campaignMoney.reason;
        }

        // ── Pledges ────────────────────────────────────────────────────────
        const pledgeRead = await completeRead(
          pledgesQuery(tenantId),
          boundedPledgesQuery(tenantId),
          toPledgeRow,
        );
        const pledgeMoney =
          pledgeRead.kind === 'complete' ? readablePledges(pledgeRead.rows) : pledgeRead;
        if (pledgeMoney.kind === 'complete') {
          if (pledgeMoney.rows.length === 0) {
            pledgeReason = GIVING_REASON.noPledges;
          } else {
            pledges = summarisePledges(pledgeMoney.rows, readAt);
            pledgeReason = null;
          }
        } else {
          pledgeReason = pledgeMoney.reason;
        }
      }

      if (cancelled) return;
      setData({ loading: false, campaigns, campaignReason, pledges, pledgeReason });
    })();

    return () => { cancelled = true; };
  }, [tenantId, readAt]);

  return data;
}
