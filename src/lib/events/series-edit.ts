import { expandRuns, formatEventDateTime } from './recurrence';
import type { RecurrenceRule } from './recurrence';

export const SERIES_LOCK_MESSAGE = 'This series has registrations. Its start date, repeat frequency and time zone are locked; you can still change the time and other details.';
export const ONE_OFF_LOCK_MESSAGE = 'This event has registrations, so it cannot be turned into a repeating series. Create a new repeating event instead.';
export const droppedRunsMessage = (runDates: string[]) =>
  `This change would remove dates people have registered for (${runDates.join(', ')}). Use Cancel this date first so registrants are notified.`;

type Schedule = { startDate: Date | null; timeZone?: string; recurrence?: RecurrenceRule | null };

/** Run identities are civil dates in the series zone, independent of time of day. */
export function changesSeriesIdentity(before: Schedule, after: Schedule): boolean {
  const zone = before.timeZone || 'UTC';
  const day = (date: Date | null, timeZone: string) => date ? formatEventDateTime(date, timeZone).slice(0, 10) : null;
  return (after.timeZone || 'UTC') !== zone
    || before.recurrence?.freq !== after.recurrence?.freq
    || day(before.startDate, zone) !== day(after.startDate, after.timeZone || 'UTC');
}

type Series = { startDate: Date; endDate: Date; timeZone?: string; recurrence: RecurrenceRule };

/** Whether the rule produces this run, ignoring individually cancelled runs. */
function producesRun(series: Series, runDate: string): boolean {
  const day = Date.parse(`${runDate}T00:00:00Z`);
  if (!Number.isFinite(day)) return false;
  return expandRuns({ ...series, recurrence: { ...series.recurrence, cancelledRuns: [] } },
    new Date(day - 2 * 86400000), new Date(day + 2 * 86400000)).some(run => run.runDate === runDate);
}

/**
 * Registered runs that a new end date or occurrence count would silently drop.
 * Only Cancel this date may remove a registered run, because only it notifies.
 */
export function droppedRegisteredRuns(before: Series, after: Series, registeredRunDates: Iterable<string>): string[] {
  return [...new Set(registeredRunDates)]
    .filter(runDate => producesRun(before, runDate) && !producesRun(after, runDate))
    .sort();
}
