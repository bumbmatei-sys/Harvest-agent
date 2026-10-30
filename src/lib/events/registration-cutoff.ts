import { expandRuns, type RecurrenceRule } from './recurrence';

export const DEFAULT_REGISTRATION_CUTOFF_HOURS = 2;

/** Absence is legacy data; an invalid stored value is an error, never an open gate. */
export function registrationCutoffHours(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_REGISTRATION_CUTOFF_HOURS;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Registration cutoff must be a non-negative number of hours');
  }
  return value;
}

export function runRegistrationOpen(start: Date, hours: unknown, now = new Date()): boolean {
  // Subtract elapsed hours from the resolved instant, including across DST.
  return now.getTime() < start.getTime() - registrationCutoffHours(hours) * 3600000;
}

/** Shared by submit and payment completion. One-off deadlines retain their existing semantics. */
export function registrationClosed(event: {
  recurrence?: RecurrenceRule | null;
  startDate?: { toDate(): Date } | null;
  endDate?: { toDate(): Date } | null;
  registrationDeadline?: { toDate(): Date } | null;
  registrationCutoffHours?: unknown;
  timeZone?: string;
}, runDate: string | null | undefined, now = new Date()): boolean {
  if (!event.recurrence) {
    return !!event.registrationDeadline && now.getTime() > event.registrationDeadline.toDate().getTime();
  }
  if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate) || !event.startDate) return true;
  const date = Date.parse(`${runDate}T00:00:00Z`);
  if (!Number.isFinite(date)) return true;
  const start = event.startDate.toDate();
  const run = expandRuns({ startDate: start, endDate: event.endDate?.toDate() || start,
    timeZone: event.timeZone, recurrence: event.recurrence },
  new Date(date - 2 * 86400000), new Date(date + 2 * 86400000))
    .find(candidate => candidate.runDate === runDate);
  return !run || !runRegistrationOpen(run.start, event.registrationCutoffHours, now);
}
