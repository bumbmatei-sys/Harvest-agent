import { formatCents } from '@/lib/donation-history';
import { toSafeDate, type DateLike } from '@/utils/format-date';
import type { Figure, Series, SeriesPoint } from '../dashboard/dashboard-data';

/**
 * The four Home figures. Swap by editing {@link HOME_KPI_ORDER}.
 * Each one names the collection and the field the number is read from.
 * Counts are exact only when every row in a complete read has a date that
 * can be placed in the selected window. A missing date refuses the figure
 * rather than dropping that row out of the total.
 */
export const HOME_PERIODS = [7, 14, 30] as const;
export type HomePeriod = (typeof HOME_PERIODS)[number];

export type HomeKpiId = 'newMembers' | 'recordedGiving' | 'newContacts' | 'checkinSessions';

export interface HomeKpiSource {
  readonly id: HomeKpiId;
  readonly label: string;
  readonly collection: string;
  readonly field: string;
  readonly unit: 'count' | 'cents';
}

export const HOME_KPI_SOURCES = {
  newMembers: {
    id: 'newMembers',
    label: 'New members',
    collection: 'users',
    field: 'createdAt',
    unit: 'count',
  },
  recordedGiving: {
    id: 'recordedGiving',
    label: 'Recorded giving',
    collection: 'tenants/{tenantId}/invoices',
    field: 'amount',
    unit: 'cents',
  },
  newContacts: {
    id: 'newContacts',
    label: 'New contacts',
    collection: 'contacts',
    field: 'createdAt',
    unit: 'count',
  },
  checkinSessions: {
    id: 'checkinSessions',
    label: 'Check-in sessions',
    collection: 'tenants/{tenantId}/checkinSessions',
    field: 'createdAt',
    unit: 'count',
  },
} as const satisfies Record<HomeKpiId, HomeKpiSource>;

/** The order the four cards render in. This is the swap point. */
export const HOME_KPI_ORDER: readonly HomeKpiId[] = [
  'newMembers',
  'recordedGiving',
  'newContacts',
  'checkinSessions',
];

/** The daily chart follows the same giving read as the Recorded giving card. */
export const HOME_CHART_KPI: HomeKpiId = 'recordedGiving';

const DAY_MS = 86_400_000;

export function windowStart(now: number, days: HomePeriod): number {
  return now - days * DAY_MS;
}

function undatedReason(undated: number): string {
  const noun = undated === 1 ? 'record has' : 'records have';
  return `${undated.toLocaleString('en-US')} ${noun} no readable date, so a total for this period would be short.`;
}

export function countDatedInWindow(
  dates: readonly DateLike[],
  now: number,
  days: HomePeriod,
): Figure {
  const start = windowStart(now, days);
  let undated = 0;
  let value = 0;
  for (const raw of dates) {
    const date = toSafeDate(raw);
    if (!date) {
      undated += 1;
      continue;
    }
    const t = date.getTime();
    if (t >= start && t <= now) value += 1;
  }
  if (undated > 0) return { kind: 'unavailable', reason: undatedReason(undated) };
  return { kind: 'exact', value };
}

export interface DatedCents {
  readonly amountCents: number;
  readonly at: DateLike;
}

export function sumCentsInWindow(
  rows: readonly DatedCents[],
  now: number,
  days: HomePeriod,
): Figure {
  const start = windowStart(now, days);
  let undated = 0;
  let value = 0;
  for (const row of rows) {
    const date = toSafeDate(row.at);
    if (!date) {
      undated += 1;
      continue;
    }
    const t = date.getTime();
    if (t >= start && t <= now) value += row.amountCents;
  }
  if (undated > 0) return { kind: 'unavailable', reason: undatedReason(undated) };
  return { kind: 'exact', value };
}

/** One bucket per UTC day in the window, oldest first. Values are cents. */
export function centsByDay(
  rows: readonly DatedCents[],
  now: number,
  days: HomePeriod,
): Series {
  const summed = sumCentsInWindow(rows, now, days);
  if (summed.kind !== 'exact') return { kind: 'unavailable', reason: summed.reason };
  const start = windowStart(now, days);
  const points: SeriesPoint[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  for (let day = cursor.getTime(); day <= end.getTime(); day += DAY_MS) {
    const label = new Date(day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    let value = 0;
    for (const row of rows) {
      const date = toSafeDate(row.at);
      if (!date) continue;
      const t = date.getTime();
      if (t >= day && t < day + DAY_MS && t >= start && t <= now) value += row.amountCents;
    }
    points.push({ label, value });
  }
  return { kind: 'complete', points };
}

export function formatKpi(source: HomeKpiSource, figure: Figure): string | null {
  if (figure.kind !== 'exact') return null;
  if (source.unit === 'cents') return formatCents(figure.value);
  return figure.value.toLocaleString('en-US');
}
