import { expandRuns, formatEventDateTime, type RecurrenceInput, type EventRun } from './recurrence';

export const eventDayKey = (instant: Date, timeZone: string): string =>
  formatEventDateTime(instant, timeZone).slice(0, 10);

/** Keep only the last past run, three next runs and the selected day's run. */
export function listEventRuns(event: RecurrenceInput, now: Date, selectedDay?: Date): EventRun[] {
  const future = expandRuns(event, now, new Date(now.getTime() + 100 * 366 * 86400000), { maxCount: 3 });
  const past = expandRuns(event, event.startDate, new Date(now.getTime() - 1), { maxCount: 1, latest: true })
    .filter(run => run.end < now);
  const selected = selectedDay ? expandRuns(event,
    new Date(Date.UTC(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate()) - 86400000),
    new Date(Date.UTC(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate()) + 2 * 86400000),
    { maxCount: 4 }) : [];
  return [...new Map([...past, ...future, ...selected].map(run => [run.runDate, run])).values()]
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
