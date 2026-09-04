"use client";
/**
 * THE-283 — every read the Growth tab makes that the Overview tab has not
 * already made.
 *
 * ─── Which was exactly one, and is now three ─────────────────────────────────
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
 * So this hook read the ONE thing the Overview tab has no use for: the `city`
 * and `country` fields on the same member documents.
 *
 * ⚠️ AMENDED BY THE-299, which builds the retention heatmap THE-283 deferred.
 * That widget needs a join date and an activity trail, so this hook now makes
 * THREE reads — and, applying the same principle one level down, it still makes
 * only ONE read of `users`.
 *
 *   · `users` — read once, mapped once, by `toMemberRow`, which is
 *     `toMemberLocation` plus the uid, the address and `createdAt`. 🔴 The
 *     countries table is fed by exactly the function that already fed it, so
 *     its figures cannot have moved; and the two widgets on this tab cannot
 *     disagree about how many members this ministry has, because they are
 *     counting the same array.
 *   · `contacts` — the bridge between a member and their activity. See
 *     `retention-data`'s header: `contactActivities.contactId` is a CRM contact
 *     id far more often than it is a uid, so without this read the grid would
 *     be near-zero for a church whose members are demonstrably active.
 *   · `contactActivities` — the activity itself.
 *
 * ⚠️ THE THREE ARE GATED SEPARATELY, the way THE-294 gates the Engagement tab's
 * three collections. A ministry whose CRM activity is over the ceiling still
 * gets its countries table, because those are different collections of
 * different sizes and refusing a true figure to report a missing one helps
 * nobody. The retention grid needs all three, so it refuses if any of them
 * refuses — and it names WHICH.
 *
 * ⚠️ IT IS A SEPARATE HOOK, and not fields added to `useOverviewData`, because
 * that hook runs for every admin who opens the dashboard and these reads are
 * only wanted by people who open the Growth tab. Base UI mounts only the ACTIVE
 * tab panel, so a `GrowthTab` that owns its own hook issues its queries when —
 * and only when — someone selects the tab. That matters more now than it did
 * with one read: `contactActivities` is the largest collection the dashboard
 * touches, and putting it on the landing tab's critical path would charge every
 * visit for a widget most visits never see.
 *
 * ─── Scoping, mirrored rather than re-decided ────────────────────────────────
 *
 * `users` is unchanged: scoped equality for a tenant, an unscoped read for a
 * super admin on the apex, and NEITHER for anyone else — an unscoped list query
 * from a tenant admin is rejected wholesale by rules, and that rejection would
 * render as "this ministry has nobody anywhere", which is the exact class of lie
 * this feature exists to refuse. It becomes {@link REASON.noTenant}.
 *
 * 🔴 RETENTION IS TENANT-SCOPED ONLY, and has no apex branch, exactly as the
 * Giving, Engagement and Content tabs have none. A super admin's token would
 * pass `contacts` and `contactActivities` unscoped — but "how well does every
 * church on the platform retain its members, added together" is not a number
 * this product defines, and a cohort pooled across tenants would answer a
 * question nobody asked with an average nobody could act on. On the apex the
 * heatmap reports {@link REASON.noTenant}: the same answer three other tabs
 * already give there, and no new reason string.
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
  type LocationBreakdown,
} from './growth-data';
import {
  RETENTION_MONTHS,
  RETENTION_REASON,
  buildRetention,
  toActivityStamp,
  toContactRow,
  toMemberRow,
  type ActivityStamp,
  type ContactRow,
  type MemberRow,
  type RetentionGrid,
} from './retention-data';

/**
 * What the Growth tab reads for itself. `null` on a value and `null` on its
 * reason means "still reading"; afterwards exactly one of each pair is set.
 */
export interface GrowthData {
  readonly loading: boolean;
  readonly locations: LocationBreakdown | null;
  readonly locationReason: string | null;
  readonly retention: RetentionGrid | null;
  readonly retentionReason: string | null;
}

const PENDING: GrowthData = {
  loading: true,
  locations: null,
  locationReason: null,
  retention: null,
  retentionReason: null,
};

/**
 * `now` is a parameter so a test can pin the month boundaries instead of racing
 * the clock; production never passes it.
 *
 * 🔴 IT IS CAPTURED ONCE PER MOUNT, exactly as `useOverviewData`,
 * `useGivingData` and `useEngagementData` capture their own. `Date.now()` as a
 * default argument produces a new value on every render, so leaving it in the
 * dependency array makes the effect re-run on the state update it just caused —
 * an unbounded loop re-issuing three reads against a billed database. Freezing
 * it in state closes that loop, and it is also the behaviour the widget wants:
 * the month boundaries a reader is looking at should not shift underneath them.
 */
export function useGrowthData(
  tenantId: string | null,
  isSuperAdmin: boolean,
  now: number = Date.now(),
): GrowthData {
  const [data, setData] = useState<GrowthData>(PENDING);
  const [readAt] = useState(() => now);

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
      let retention: RetentionGrid | null = null;
      // The apex answer, and the answer for anyone with no tenant in scope.
      let retentionReason: string | null = REASON.noTenant;
      let members: readonly MemberRow[] | null = null;

      if (q && bounded) {
        // The count runs first inside `completeRead` and refuses above the
        // ceiling, so what comes back is either EVERY member or nothing. The
        // aggregation below is exact precisely because there is no third case.
        const read = await completeRead(q, bounded, toMemberRow);
        if (read.kind === 'complete') {
          members = read.rows;
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

      /* ── Retention: tenant only, and all three reads or none ───────────── */

      if (tenantId) {
        if (members === null) {
          // The `users` read above already failed or hit its ceiling. Say which,
          // rather than repeating the generic wording a third time.
          retentionReason = locationReason === REASON.tooManyToChart
            ? RETENTION_REASON.memberCeiling(DASHBOARD_FETCH_LIMIT)
            : REASON.readFailed;
        } else {
          const [contacts, activities] = await Promise.all([
            completeRead<ContactRow>(
              scopedQuery('contacts', tenantId),
              boundedScopedQuery('contacts', tenantId),
              toContactRow,
            ),
            completeRead<ActivityStamp>(
              scopedQuery('contactActivities', tenantId),
              boundedScopedQuery('contactActivities', tenantId),
              toActivityStamp,
            ),
          ]);

          if (contacts.kind !== 'complete') {
            // 🔴 THE CEILING, NAMED FOR THIS COLLECTION AND NEVER TRUNCATED.
            // The alternative is a grid drawn over whichever thousand contacts
            // came back, which understates every cohort by an unknown amount
            // and looks exactly like a complete one.
            retentionReason = contacts.reason === REASON.tooManyToChart
              ? RETENTION_REASON.contactCeiling(DASHBOARD_FETCH_LIMIT)
              : contacts.reason;
          } else if (activities.kind !== 'complete') {
            retentionReason = activities.reason === REASON.tooManyToChart
              ? RETENTION_REASON.activityCeiling(DASHBOARD_FETCH_LIMIT)
              : activities.reason;
          } else if (activities.rows.length === 0) {
            retentionReason = RETENTION_REASON.noActivity;
          } else {
            const grid = buildRetention(members, contacts.rows, activities.rows, readAt);
            // 🔴 A complete read of a ministry nobody joined this year is not a
            // grid of zeroes. Twelve rows of `0%` would read as a collapse; the
            // reason says what is true.
            if (grid.membersInWindow === 0) {
              retentionReason = RETENTION_REASON.noCohorts(RETENTION_MONTHS);
            } else {
              retention = grid;
              retentionReason = null;
            }
          }
        }
      }

      if (cancelled) return;
      setData({ loading: false, locations, locationReason, retention, retentionReason });
    })();

    return () => { cancelled = true; };
  }, [tenantId, isSuperAdmin, readAt]);

  return data;
}
