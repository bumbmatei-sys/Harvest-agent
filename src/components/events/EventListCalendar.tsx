/**
 * The events LIST's own mini calendar — the left-panel glance at a month
 * that `EventMonthView`'s own (bigger) grid does not fit beside a list of
 * rows. Same `calendar` primitive, same `daysWithEvents` marking read from
 * `month-view.ts`, loaded the same way `EventMonthView` is: lazily, from
 * `AdminEvents.tsx`, for the identical reason THE-308 lazy-mounts the month
 * grid — `calendar` IS `react-day-picker`, and a static import of it here
 * would put the package back in the chunk the LIST, this screen's default
 * tab, loads on every visit. A SEPARATE component, rather than an inline
 * `<Calendar>` in `AdminEvents.tsx`, is what keeps that import behind this
 * file's own `React.lazy()` boundary instead of the list's.
 *
 * It marks days with a dot rather than `EventMonthView`'s event count: this
 * calendar is a glance and a filter, not a day's own agenda — the count
 * belongs to the row list the day click already filters.
 */
'use client';

import { expandRuns } from '@/lib/events/recurrence';
import { eventDayKey } from '@/lib/events/list-runs';
import React from 'react';

import { Calendar, CalendarDayButton } from '@/components/ui/calendar';

import { daysWithEvents, eventsOn, type MonthRead } from './month-view';

export interface EventListCalendarProps {
  read: MonthRead | undefined;
  /** The day the list is currently filtered to, or none. */
  selected?: Date;
  /** Selecting the already-selected day clears the filter — handled by the caller. */
  onSelect: (day: Date | undefined) => void;
}

/** Expand only the visible month, keyed by each event's own civil run day. */
export function runsByMonthDay(events: readonly import('./month-view').MonthEvent[], month: Date) {
  const byDay = new Map<string, import('./month-view').MonthEvent[]>();
  const from = new Date(Date.UTC(month.getFullYear(), month.getMonth(), 1) - 86400000);
  const to = new Date(Date.UTC(month.getFullYear(), month.getMonth() + 1, 1) + 86400000);
  for (const event of events) {
    if (!event.start) continue;
    const timeZone = event.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const runs = expandRuns({ startDate: event.start, endDate: event.end || event.start, timeZone, recurrence: event.recurrence }, from, to);
    for (const run of runs) {
      const key = eventDayKey(run.start, timeZone);
      const rows = byDay.get(key) || [];
      rows.push(event);
      byDay.set(key, rows);
    }
  }
  return byDay;
}

const EventListCalendar: React.FC<EventListCalendarProps> = ({ read, selected, onSelect }) => {
  const [month, setMonth] = React.useState<Date>(() => new Date());

  const byDay = React.useMemo(
    () => runsByMonthDay(read?.kind === 'complete' ? read.events : [], month),
    [read, month],
  );
  const marked = React.useMemo(() => daysWithEvents(byDay, month), [byDay, month]);

  const DayButton = React.useCallback(
    (props: React.ComponentProps<typeof CalendarDayButton>) => {
      const hasEvents = eventsOn(byDay, props.day.date).length > 0;
      const { children, ...rest } = props;
      return (
        <CalendarDayButton {...rest}>
          {children}
          {hasEvents && (
            <span
              aria-hidden="true"
              className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-gold"
            />
          )}
        </CalendarDayButton>
      );
    },
    [byDay],
  );

  return (
    <Calendar
      mode="single"
      month={month}
      onMonthChange={setMonth}
      selected={selected}
      onSelect={onSelect}
      showOutsideDays={false}
      className="w-full p-0 [--cell-size:32px]"
      modifiers={{ hasEvents: marked }}
      components={{ DayButton }}
    />
  );
};

export default EventListCalendar;
