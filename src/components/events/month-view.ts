/**
 * THE-308 — the month view's data half.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHY THIS READ IS NOT `useEvents`
 *
 * `useEvents` is `orderBy('startDate','desc') + limit(100)`. That is the right
 * read for the LIST — "what is next" is a question about order, and the list
 * shows the top of that order — and THE-317 pins both halves of it, so nothing
 * here touches it.
 *
 * It is the wrong read for a GRID. A month view asks "what falls in September",
 * and an ordered, truncated read answers "the hundred most recent events" —
 * which contains September only by luck. On a tenant with more than a hundred
 * events, paging back to an earlier month would draw an empty grid over a month
 * that has services in it, and nothing on screen would say so.
 *
 * ⚠️ THE OBVIOUS FIX IS THE ONE THIS REPO CANNOT TAKE. `where('startDate','>=',
 * monthStart) + where('startDate','<',nextMonth)` is exact and needs no
 * composite index — one field, range and order together. But it is a RANGE, and
 * a range is only as sound as the field's type discipline; and more decisively,
 * `firestore.indexes.json` DOES NOT DEPLOY on merge (`deploy-rules.yml` runs
 * `firestore:rules,storage`, and its `paths:` filter does not name the indexes
 * file), so any read here that ever needs an index is a read that throws
 * `failed-precondition` in production and passes every test locally.
 *
 * 🔴 SO THE READ IS COUNT-GATED AND COMPLETE, which is the shape THE-309 built
 * {@link completeRead} for and the shape this ticket asked for in as many
 * words: count first; under the ceiling, load EVERYTHING, so ordering cannot
 * change what appears; otherwise show `empty`.
 *
 * The query carries NO `where` and NO `orderBy`:
 *   · no `where`, because `tenants/{id}/events` is a subcollection — the PATH
 *     is the scope, exactly as `invoicesQuery` and `formsQuery` already are;
 *   · no `orderBy`, because holding every document makes ordering a question
 *     for the client, and it is ordering that would demand the index.
 *
 * So this needs no index that does not already exist, on a database nobody has
 * migrated — and `limit()` here is a CEILING that the count has already proved
 * we are under, never a truncation. That distinction is the whole point: #405
 * found 41 files taking `limit(N)` with no `orderBy`, which returns N documents
 * ordered by `__name__` — random ids — and looks correct after a client-side
 * sort. The count gate is what makes this one not that.
 * ═════════════════════════════════════════════════════════════════════════════
 */
import { collection, limit, query } from 'firebase/firestore';

import { db } from '../../firebase';
import {
  completeRead,
  DASHBOARD_FETCH_LIMIT,
  type CompleteRows,
} from '../dashboard/dashboard-data';

/**
 * The ceiling, named for this collection.
 *
 * It is {@link DASHBOARD_FETCH_LIMIT} because {@link completeRead} gates on that
 * number: a bounded query with a different limit would either truncate under a
 * gate that passed, or refuse documents the gate allowed. Naming it separately
 * says which collection it bounds without letting the two drift.
 */
export const EVENTS_MONTH_CEILING = DASHBOARD_FETCH_LIMIT;

/** Every event in the tenant. No `where`, no `orderBy` — see the header. */
export const eventsQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'events'));

export const boundedEventsQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'events'), limit(EVENTS_MONTH_CEILING));

export type EventStatus = 'draft' | 'published' | 'cancelled' | 'completed';

/** One event, reduced to what a grid cell and its day panel draw. */
export interface MonthEvent {
  readonly id: string;
  readonly title: string;
  /** Null for an event saved without a start — see {@link eventStart}. */
  readonly start: Date | null;
  readonly status: EventStatus;
  readonly location: string;
  readonly isOnline: boolean;
  readonly registrationEnabled: boolean;
}

/**
 * A `startDate` as a `Date`, or null.
 *
 * 🔴 TIMESTAMP-LIKE ONLY, DELIBERATELY. This repo has twice shipped a field
 * holding BOTH ISO strings and `Timestamp`s — `invoices.issuedAt` and
 * `contactActivities.createdAt` — where Firestore's cross-type ordering (by
 * TYPE first) makes `orderBy` stable but not chronological.
 *
 * `events.startDate` is NOT one of those: it has a single writer, AdminEvents'
 * `toTimestamp`, which is `Timestamp.fromDate(...)` or `null` and nothing else.
 * THE-317 pinned that, and this ticket's own guard re-asserts it against every
 * write path rather than inheriting the claim.
 *
 * ⚠️ So a string arriving here would mean that invariant had broken. Parsing it
 * would place the event on a day derived from a value the schema says cannot
 * exist, and the grid would look right. Returning null instead files it under
 * {@link MonthRead.undated}, which the UI STATES rather than swallows — a
 * wrong day is a worse failure than a named absence.
 */
export const eventStart = (v: unknown): Date | null => {
  if (v == null || typeof v !== 'object') return null;
  const ts = v as { toDate?: () => Date; seconds?: number };
  if (typeof ts.toDate === 'function') {
    const d = ts.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return null;
};

const STATUSES: readonly EventStatus[] = ['draft', 'published', 'cancelled', 'completed'];

export const toMonthEvent = (data: Record<string, unknown>, id: string): MonthEvent => ({
  id,
  title: typeof data.title === 'string' ? data.title : '',
  start: eventStart(data.startDate),
  status: STATUSES.includes(data.status as EventStatus) ? (data.status as EventStatus) : 'draft',
  location: typeof data.location === 'string' ? data.location : '',
  isOnline: data.isOnline === true,
  registrationEnabled: data.registrationEnabled === true,
});

/**
 * The read's result, with its guarantee attached.
 *
 * `complete` means every event in the tenant is in `events` — not "the first
 * page of them". `unavailable` carries the reason, and the UI draws an `empty`
 * that says it rather than an empty grid that implies a quiet month.
 */
export type MonthRead =
  | {
      readonly kind: 'complete';
      readonly events: readonly MonthEvent[];
      /** Events with no `startDate`. They belong to no day, so they are SAID. */
      readonly undated: number;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

export const readMonthEvents = async (tenantId: string): Promise<MonthRead> => {
  const rows: CompleteRows<MonthEvent> = await completeRead(
    eventsQuery(tenantId),
    boundedEventsQuery(tenantId),
    toMonthEvent,
  );
  if (rows.kind !== 'complete') return { kind: 'unavailable', reason: rows.reason };
  return {
    kind: 'complete',
    events: rows.rows,
    undated: rows.rows.filter((e) => e.start === null).length,
  };
};

/* ── The grid model ───────────────────────────────────────────────────────── */

/** A day key in the LOCAL zone. `toISOString` would bucket by UTC. */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Events by local day, each day's list in time order.
 *
 * ⚠️ The sort is CLIENT-side and total: every event is held, so this orders the
 * whole set rather than re-ordering a page of it. That is the difference the
 * header describes — sorting a truncated read is what makes a wrong answer look
 * right, and there is no truncation here to sort.
 */
export const eventsByDay = (events: readonly MonthEvent[]): Map<string, MonthEvent[]> => {
  const byDay = new Map<string, MonthEvent[]>();
  for (const ev of events) {
    if (!ev.start) continue;
    const key = dayKey(ev.start);
    const list = byDay.get(key);
    if (list) list.push(ev);
    else byDay.set(key, [ev]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.start!.getTime() - b.start!.getTime()) || a.title.localeCompare(b.title));
  }
  return byDay;
};

/** The days in `month` that carry at least one event — the grid's modifier. */
export const daysWithEvents = (
  byDay: Map<string, MonthEvent[]>,
  month: Date,
): Date[] => {
  const out: Date[] = [];
  for (const [key, list] of byDay) {
    if (list.length === 0) continue;
    const [y, m, d] = key.split('-').map(Number);
    if (y === month.getFullYear() && m === month.getMonth() + 1) out.push(new Date(y, m - 1, d));
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
};

export const eventsOn = (byDay: Map<string, MonthEvent[]>, day: Date | undefined): MonthEvent[] =>
  day ? (byDay.get(dayKey(day)) ?? []) : [];
