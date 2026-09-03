"use client";
/**
 * THE-283 — every read the Growth tab makes that the Overview tab has not
 * already made.
 *
 * ─── Which is exactly one, and the omission is the point ─────────────────────
 *
 * The member growth trend is NOT read here. `useOverviewData` already produces
 * `memberSeries` — a complete, count-gated weekly series over `users.createdAt`
 * — and `AnalyticsDashboard` holds one instance of that hook for the whole tab
 * strip, so the Growth tab is handed the series that was already read rather
 * than issuing a second identical query against a billed database. 🔴 A second
 * read would also be a second chance to disagree: two widgets on two tabs
 * drawing "new members per week" from two reads taken seconds apart can differ,
 * and a reader has no way to know which is stale.
 *
 * So this hook reads the ONE thing the Overview tab has no use for: the `city`
 * and `country` fields on the same member documents.
 *
 * ⚠️ IT IS A SEPARATE HOOK, and not a field added to `useOverviewData`, because
 * that hook runs for every admin who opens the dashboard and this read is only
 * wanted by people who open the Growth tab. Base UI mounts only the ACTIVE tab
 * panel, so a `GrowthTab` that owns its own hook issues its query when — and
 * only when — someone selects the tab. Folding it into the Overview hook would
 * put a whole-collection document read on the critical path of the landing tab
 * for the sake of a widget most visits never see.
 *
 * ─── Scoping, mirrored rather than re-decided ────────────────────────────────
 *
 * Identical to `useOverviewData`: scoped equality for a tenant, an unscoped read
 * for a super admin on the apex, and NEITHER for anyone else — an unscoped list
 * query from a tenant admin is rejected wholesale by rules, and that rejection
 * would render as "this ministry has nobody anywhere", which is the exact class
 * of lie this feature exists to refuse. It becomes {@link REASON.noTenant}.
 */
import { useEffect, useState } from 'react';
import { collection, limit, query } from 'firebase/firestore';

import { db } from '../../firebase';
import { DASHBOARD_FETCH_LIMIT } from './dashboard-data';
import {
  GROWTH_REASON,
  REASON,
  aggregateLocations,
  boundedScopedQuery,
  completeRead,
  scopedQuery,
  toMemberLocation,
  type LocationBreakdown,
} from './growth-data';

/**
 * What the Growth tab reads for itself. `null` on both fields means "still
 * reading"; afterwards exactly one of them is set.
 */
export interface GrowthData {
  readonly loading: boolean;
  readonly locations: LocationBreakdown | null;
  readonly locationReason: string | null;
}

const PENDING: GrowthData = { loading: true, locations: null, locationReason: null };

export function useGrowthData(tenantId: string | null, isSuperAdmin: boolean): GrowthData {
  const [data, setData] = useState<GrowthData>(PENDING);

  useEffect(() => {
    let cancelled = false;
    setData(PENDING);

    (async () => {
      const platformWide = !tenantId && isSuperAdmin;
      const q = tenantId
        ? scopedQuery('users', tenantId)
        : platformWide ? query(collection(db, 'users')) : null;
      const bounded = tenantId
        ? boundedScopedQuery('users', tenantId)
        : platformWide ? query(collection(db, 'users'), limit(DASHBOARD_FETCH_LIMIT)) : null;

      let locations: LocationBreakdown | null = null;
      let locationReason: string | null = REASON.noTenant;

      if (q && bounded) {
        // The count runs first inside `completeRead` and refuses above the
        // ceiling, so what comes back is either EVERY member or nothing. The
        // aggregation below is exact precisely because there is no third case.
        const read = await completeRead(q, bounded, toMemberLocation);
        if (read.kind === 'complete') {
          const breakdown = aggregateLocations(read.rows);
          // 🔴 A complete read of a ministry where nobody has recorded a country
          // is not an empty table, it is a widget with nothing to say. Rendering
          // a table with zero rows would read as "we have no members abroad";
          // the reason says what is actually true.
          if (breakdown.withCountry === 0) {
            locationReason = GROWTH_REASON.noLocationRecorded(breakdown.total);
          } else {
            locations = breakdown;
            locationReason = null;
          }
        } else {
          locationReason = read.reason;
        }
      }

      if (cancelled) return;
      setData({ loading: false, locations, locationReason });
    })();

    return () => { cancelled = true; };
  }, [tenantId, isSuperAdmin]);

  return data;
}
