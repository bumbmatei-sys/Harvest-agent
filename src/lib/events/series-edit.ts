import { formatEventDateTime } from './recurrence';
import type { RecurrenceRule } from './recurrence';

export const SERIES_LOCK_MESSAGE = 'This series has registrations. Its start date, repeat frequency and time zone are locked; you can still change the time and other details.';

type Schedule = { startDate: Date | null; timeZone?: string; recurrence?: RecurrenceRule | null };

/** Run identities are civil dates in the series zone, independent of time of day. */
export function changesSeriesIdentity(before: Schedule, after: Schedule): boolean {
  const zone = before.timeZone || 'UTC';
  const day = (date: Date | null, timeZone: string) => date ? formatEventDateTime(date, timeZone).slice(0, 10) : null;
  return (after.timeZone || 'UTC') !== zone
    || before.recurrence?.freq !== after.recurrence?.freq
    || day(before.startDate, zone) !== day(after.startDate, after.timeZone || 'UTC');
}
