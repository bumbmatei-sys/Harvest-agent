/**
 * Eden's event schedule: a Date, a Time, and How long, in place of two
 * date-and-time fields. The form keeps its two wall-clock strings
 * ("YYYY-MM-DDTHH:mm", optionally ":ss") as the source of truth, so saving,
 * time zones and DST handling are unchanged; these helpers only translate
 * between those strings and the three controls. A string is rewritten only
 * when the admin changes one of the controls, so an untouched legacy event
 * keeps its exact seconds.
 */

/** The How long choices, in minutes. 'none' is an event with no end time; 'custom' shows an end field. */
export const EVENT_DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480] as const;
export type DurationChoice = `${(typeof EVENT_DURATIONS)[number]}` | 'none' | 'custom';

export function durationLabel(choice: DurationChoice): string {
  if (choice === 'none') return 'No end time';
  if (choice === 'custom') return 'Custom';
  const minutes = Number(choice);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** A wall-clock string as a UTC instant, for arithmetic only (never as a real time). */
function wallMs(value: string): number | null {
  const m = WALL.exec(value);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
}

function wallString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

/** Which How long choice a start and end describe. */
export function durationChoiceOf(start: string, end: string): DurationChoice {
  if (!end) return 'none';
  const a = wallMs(start);
  const b = wallMs(end);
  if (a === null || b === null) return 'custom';
  const minutes = (b - a) / 60_000;
  return (EVENT_DURATIONS as readonly number[]).includes(minutes) ? `${minutes}` as DurationChoice : 'custom';
}

/** The end for a start and a duration, on the same wall clock. */
export function endFor(start: string, minutes: number): string {
  const a = wallMs(start);
  return a === null ? '' : wallString(a + minutes * 60_000);
}

/** Replace the day of a start, keeping its time (and seconds). */
export function withDate(start: string, day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return start;
  return start ? `${day}${start.slice(10)}` : `${day}T18:00`;
}

/** Replace the time of a start, keeping its day. */
export function withTime(start: string, time: string, fallbackDay: string): string {
  if (!/^\d{2}:\d{2}$/.test(time)) return start;
  return `${start ? start.slice(0, 10) : fallbackDay}T${time}`;
}

/** The time choices, every 15 minutes; the start's own time is added when it is off the grid. */
export function timeSlots(start: string): string[] {
  const slots: string[] = [];
  for (let m = 0; m < 24 * 60; m += 15) slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  const own = start.slice(11, 16);
  if (/^\d{2}:\d{2}$/.test(own) && !slots.includes(own)) slots.push(own);
  return slots.sort();
}

/** "18:30" → "6:30 PM". */
export function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
