/**
 * Wall-clock schedule times.
 *
 * A `datetime-local` value has no offset. `Date.parse` of that string on the
 * server treats it as UTC, so a ministry west of UTC can schedule "today"
 * and have the instant land on the previous calendar day. The client sends
 * an absolute ISO instant, interpreted in the ministry's IANA timezone.
 */

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((entry) => entry.type === type)?.value ?? '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Milliseconds to add to a UTC instant to get the wall clock in `timeZone`. */
export function zoneOffsetMs(instant: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);
    let hour = part(parts, 'hour');
    if (hour === 24) hour = 0;
    const asUtc = Date.UTC(
      part(parts, 'year'),
      part(parts, 'month') - 1,
      part(parts, 'day'),
      hour,
      part(parts, 'minute'),
      part(parts, 'second'),
    );
    if (Number.isNaN(asUtc)) return null;
    return asUtc - instant.getTime();
  } catch {
    return null;
  }
}

/**
 * `2024-06-01T02:00` in `America/Los_Angeles` becomes the UTC instant of that
 * wall clock. Returns null when the zone or the wall time is not usable.
 */
export function wallTimeInZoneToIso(wall: string, timeZone: string): string | null {
  const match = WALL.exec(wall.trim());
  if (!match || !timeZone.trim()) return null;
  const desired = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
  );
  let utc = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = zoneOffsetMs(new Date(utc), timeZone);
    if (offset === null) return null;
    const next = desired - offset;
    if (next === utc) return new Date(utc).toISOString();
    utc = next;
  }
  const offset = zoneOffsetMs(new Date(utc), timeZone);
  if (offset === null) return null;
  return new Date(desired - offset).toISOString();
}

/** The `datetime-local` value of an absolute instant in a ministry timezone. */
export function isoToWallTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
    let hour = parts.find((entry) => entry.type === 'hour')?.value ?? '00';
    if (hour === '24') hour = '00';
    const year = parts.find((entry) => entry.type === 'year')?.value;
    const month = parts.find((entry) => entry.type === 'month')?.value;
    const day = parts.find((entry) => entry.type === 'day')?.value;
    const minute = parts.find((entry) => entry.type === 'minute')?.value;
    if (!year || !month || !day || !minute) return '';
    return `${year}-${month}-${day}T${hour}:${minute}`;
  } catch {
    return '';
  }
}

export function hasTimeOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim());
}
