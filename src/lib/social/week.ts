/**
 * Eden's Publish → Calendar (docs/prd/screenshots/14-social-scheduler, 013/014):
 * a week of seven day columns from a start day, hours down the side, and each
 * scheduled post in its hour, all in the ministry's zone.
 */
import { calendarDayKey } from './calendar';

export interface WeekPost { readonly id: string; readonly status: string; readonly scheduledFor: string | null }

const noon = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

export function shiftDay(key: string, days: number): string {
  const next = noon(key);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Seven day keys from the start. */
export function weekDays(startKey: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDay(startKey, i));
}

/** "Week of October 21". */
export function weekTitle(startKey: string): string {
  return `Week of ${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(noon(startKey))}`;
}

/** "Wed" and "21" for a column header. */
export function dayHeader(key: string): { weekday: string; day: string } {
  const at = noon(key);
  return {
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(at),
    day: String(at.getUTCDate()),
  };
}

function hourIn(iso: string, timeZone: string): number | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const hour = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(at);
  const n = Number(hour);
  return Number.isFinite(n) ? n % 24 : null;
}

export interface WeekSlot<T> { readonly day: string; readonly hour: number; readonly posts: T[] }

/**
 * Scheduled and sent posts in the week, by day and hour, soonest first. Drafts
 * have no place on the grid.
 */
export function weekSlots<T extends WeekPost>(posts: readonly T[], days: readonly string[], timeZone: string): Map<string, T[]> {
  const inWeek = new Set(days);
  const slots = new Map<string, T[]>();
  const placed = posts
    .filter(p => p.status !== 'draft' && p.scheduledFor)
    .sort((a, b) => Date.parse(a.scheduledFor!) - Date.parse(b.scheduledFor!));
  for (const post of placed) {
    const day = calendarDayKey(post.scheduledFor, timeZone);
    const hour = hourIn(post.scheduledFor!, timeZone);
    if (!day || hour === null || !inWeek.has(day)) continue;
    const key = `${day}@${hour}`;
    slots.set(key, [...(slots.get(key) ?? []), post]);
  }
  return slots;
}

/** The hours to draw: 8 AM to 8 PM, widened to fit any post outside them. */
export function weekHours(slots: Map<string, unknown[]>): number[] {
  let first = 8;
  let last = 20;
  for (const key of slots.keys()) {
    const hour = Number(key.split('@')[1]);
    first = Math.min(first, hour);
    last = Math.max(last, hour);
  }
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/** "8 AM", "12 PM". */
export function hourLabel(hour: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;
}
