"use client";
/**
 * THE-294 — every read the Engagement tab makes.
 *
 * ─── Three collections, three independent gates ──────────────────────────────
 *
 * `contactActivities`, `tenants/{t}/checkinSessions` and `prayer_requests`. Each
 * is read through `completeRead`, which takes an exact `getCountFromServer`
 * count FIRST and refuses above {@link DASHBOARD_FETCH_LIMIT}, so each comes
 * back as either every matching document or nothing.
 *
 * ⚠️ THEY ARE GATED SEPARATELY AND ON PURPOSE. A ministry whose CRM activity is
 * over the ceiling still gets an exact attendance total and a real prayer-wall
 * trend, because those are different collections with different sizes. Refusing
 * the whole tab on one collection's ceiling would hide two true figures to
 * report one missing one.
 *
 * 🔴 ONE READ OF `contactActivities` SERVES THREE WIDGETS. The trend, the type
 * breakdown and the spread are three questions about the same rows, so the
 * collection is counted once and loaded once — and, more importantly, the three
 * widgets cannot disagree with each other about a ministry's activity total the
 * way two reads taken seconds apart could.
 *
 * ─── 🔴 Scoping: TENANT ONLY. The apex is not a special case ────────────────
 *
 * `useOverviewData` and `useGrowthData` read unscoped on the apex for a super
 * admin. This hook deliberately does NOT, for the reason THE-290 settled for
 * the Giving tab: coherence within one tab.
 *
 *   · `tenants/{t}/checkinSessions` is a SUBCOLLECTION, one per tenant. There
 *     is no apex-level session collection, so there is nothing an unscoped read
 *     could even address.
 *   · `contactActivities` and `prayer_requests` ARE top-level and a super
 *     admin's token would pass their rules unscoped — but summing every
 *     church's check-ins, notes and prayer requests into one figure is a number
 *     this product does not define. Which church logged how many calls is not a
 *     platform question, and a tab where two widgets answered a cross-tenant
 *     question while the third said "no ministry is in scope" would be
 *     incoherent.
 *
 * So on the apex every widget here reports {@link REASON.noTenant} — the same
 * answer the Giving tab already gives there. No new reason string, and no
 * platform-wide engagement figure invented by a hook.
 *
 * ─── 🔴 It is a SEPARATE hook, mounted inside the tab's own panel ────────────
 *
 * `useOverviewData` runs for every admin who opens the dashboard; these three
 * reads are wanted only by someone who opens Engagement. Base UI mounts only
 * the ACTIVE tab panel, so an `EngagementTab` whose panel owns this hook issues
 * its queries when — and only when — the tab is selected. That matters more here
 * than on any earlier tab: `contactActivities` is the largest collection the
 * dashboard touches, and putting it on the landing tab's critical path would
 * charge every visit for a widget most visits never see.
 */
import { useEffect, useState } from 'react';

import {
  DASHBOARD_FETCH_LIMIT,
  ENGAGEMENT_REASON,
  REASON,
  aggregateActivityTypes,
  boundedCheckinSessionsQuery,
  boundedScopedQuery,
  activitySeries as activitySeriesOf,
  checkinSessionsQuery,
  completeRead,
  prayerSeries,
  readableSessions,
  scopedQuery,
  spreadOfEngagement,
  summariseAttendance,
  toActivityRow,
  toPrayerRow,
  toSessionRow,
  type ActivityBreakdown,
  type AttendanceSummary,
  type EngagementSpread,
} from './engagement-data';
import type { Series } from './dashboard-data';

/**
 * What the Engagement tab reads for itself.
 *
 * ⚠️ Each widget gets a value OR a reason, never both and never neither — the
 * two-field shape `useGrowthData` and `useGivingData` both use, for the same
 * reason: a `null` value with a `null` reason is the LOADING state and nothing
 * else, so a widget can never render an empty frame that means "we did not try".
 */
export interface EngagementData {
  readonly loading: boolean;
  /** Weekly CRM activity over the last eight weeks. */
  readonly activitySeries: Series | null;
  readonly activityTypes: ActivityBreakdown | null;
  readonly activityReason: string | null;
  readonly spread: EngagementSpread | null;
  readonly attendance: AttendanceSummary | null;
  readonly attendanceReason: string | null;
  /** Weekly prayer-wall posts over the last FOUR weeks — the retention window. */
  readonly prayer: Series | null;
  readonly prayerReason: string | null;
}

const PENDING: EngagementData = {
  loading: true,
  activitySeries: null, activityTypes: null, activityReason: null, spread: null,
  attendance: null, attendanceReason: null,
  prayer: null, prayerReason: null,
};

/**
 * Read the Engagement tab.
 *
 * `now` is a parameter so a test can pin the week boundaries instead of racing
 * the clock; production never passes it.
 *
 * 🔴 IT IS CAPTURED ONCE PER MOUNT, exactly as `useOverviewData` and
 * `useGivingData` capture their own. `Date.now()` as a default argument produces
 * a new value on every render, so leaving it in the dependency array makes the
 * effect re-run on the state update it just caused — an unbounded loop
 * re-issuing every read on this tab against a billed database. Freezing it in
 * state closes that loop, and it is also the behaviour the widgets want: the
 * week boundaries a reader is looking at should not shift underneath them.
 */
export function useEngagementData(tenantId: string | null, now: number = Date.now()): EngagementData {
  const [data, setData] = useState<EngagementData>(PENDING);
  const [readAt] = useState(() => now);

  useEffect(() => {
    let cancelled = false;
    setData(PENDING);

    (async () => {
      if (!tenantId) {
        if (!cancelled) {
          setData({
            ...PENDING,
            loading: false,
            activityReason: REASON.noTenant,
            attendanceReason: REASON.noTenant,
            prayerReason: REASON.noTenant,
          });
        }
        return;
      }

      /* ── One read of contactActivities, three widgets ────────────────────── */

      let activitySeries: Series | null = null;
      let activityTypes: ActivityBreakdown | null = null;
      let spread: EngagementSpread | null = null;
      let activityReason: string | null = null;

      const activities = await completeRead(
        scopedQuery('contactActivities', tenantId),
        boundedScopedQuery('contactActivities', tenantId),
        toActivityRow,
      );
      if (activities.kind === 'complete') {
        if (activities.rows.length === 0) {
          // 🔴 A complete read of a ministry with no activity is not an empty
          // chart, it is a widget with nothing to say. Drawing eight zero bars
          // would read as "engagement collapsed"; the reason says what is true.
          activityReason = ENGAGEMENT_REASON.noActivity;
        } else {
          activitySeries = activitySeriesOf(activities.rows, readAt);
          activityTypes = aggregateActivityTypes(activities.rows);
          spread = spreadOfEngagement(activities.rows);
        }
      } else {
        // 🔴 THE CEILING, NAMED FOR THIS COLLECTION. `completeRead` reports the
        // generic "a complete trend cannot be read"; what is true here is that
        // every figure on these three widgets is refused together, and the
        // wording says so rather than leaving a reader to infer it three times.
        activityReason =
          activities.reason === REASON.tooManyToChart
            ? ENGAGEMENT_REASON.activityCeiling(DASHBOARD_FETCH_LIMIT)
            : activities.reason;
      }

      /* ── Attendance ──────────────────────────────────────────────────────── */

      let attendance: AttendanceSummary | null = null;
      let attendanceReason: string | null = null;

      const sessions = await completeRead(
        checkinSessionsQuery(tenantId),
        boundedCheckinSessionsQuery(tenantId),
        toSessionRow,
      );
      if (sessions.kind === 'complete') {
        if (sessions.rows.length === 0) {
          attendanceReason = ENGAGEMENT_REASON.noSessions;
        } else {
          // Two gates, in order: the set must be COMPLETE, and then every
          // session in it must carry a readable count. A total that silently
          // omits either is wrong by exactly what it omitted.
          const countable = readableSessions(sessions.rows);
          if (countable.kind === 'complete') attendance = summariseAttendance(countable.rows);
          else attendanceReason = countable.reason;
        }
      } else {
        attendanceReason =
          sessions.reason === REASON.tooManyToChart
            ? ENGAGEMENT_REASON.tooManySessions(DASHBOARD_FETCH_LIMIT)
            : sessions.reason;
      }

      /* ── The prayer wall, over four weeks and no more ────────────────────── */

      let prayer: Series | null = null;
      let prayerReason: string | null = null;

      const prayers = await completeRead(
        scopedQuery('prayer_requests', tenantId),
        boundedScopedQuery('prayer_requests', tenantId),
        toPrayerRow,
      );
      if (prayers.kind === 'complete') {
        if (prayers.rows.length === 0) prayerReason = ENGAGEMENT_REASON.noPrayer;
        else prayer = prayerSeries(prayers.rows, readAt);
      } else {
        prayerReason =
          prayers.reason === REASON.tooManyToChart
            ? ENGAGEMENT_REASON.tooManyPrayer(DASHBOARD_FETCH_LIMIT)
            : prayers.reason;
      }

      if (cancelled) return;
      setData({
        loading: false,
        activitySeries, activityTypes, activityReason, spread,
        attendance, attendanceReason,
        prayer, prayerReason,
      });
    })();

    return () => { cancelled = true; };
  }, [tenantId, readAt]);

  return data;
}
