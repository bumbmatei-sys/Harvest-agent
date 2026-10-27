/**
 * Recurring events are a SERIES with RUNS (Eden's model, not iCal RRULE).
 * `expandRuns` is the ONE pure function that turns a `RecurrenceRule` into
 * concrete run instants — nothing else in the app may re-derive a schedule.
 *
 * Every date here is handled in the event's own IANA time zone so that a
 * 7pm event stays 7pm local on both sides of a DST change, rather than
 * drifting by the zone's offset delta the way naive UTC-millisecond
 * arithmetic would.
 */

export interface RecurrenceRule {
  freq: 'weekly' | 'every_2_weeks' | 'monthly';
  /** YYYY-MM-DD, inclusive. */
  until?: string;
  /** 1–104 occurrences, counted from the first run. */
  count?: number;
  /** YYYY-MM-DD dates of runs an admin cancelled individually. */
  cancelledRuns?: string[];
}

export interface RecurrenceInput {
  /** The first run's start instant. */
  startDate: Date;
  /** The first run's end instant; every later run keeps the same duration. */
  endDate: Date;
  /** IANA zone, e.g. "Europe/Berlin". Defaults to UTC. */
  timeZone?: string | null;
  recurrence?: RecurrenceRule | null;
}

export interface EventRun {
  /** YYYY-MM-DD in the event's time zone — the stable key for this run. */
  runDate: string;
  start: Date;
  end: Date;
}

interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number;
}

// Hard safety bounds so a malformed rule (e.g. no `until`/`count`, huge `to`
// window) can never spin forever.
const MAX_OCCURRENCES = 1000;
const MAX_MONTH_SEARCH = 1200; // 100 years of months

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function civilDateString(c: CivilDate): string {
  return `${c.year}-${pad2(c.month)}-${pad2(c.day)}`;
}

function parseCivilDateString(s: string): CivilDate {
  const [y, m, d] = s.split('-').map(Number);
  return { year: y, month: m, day: d };
}

function compareCivil(a: CivilDate, b: CivilDate): number {
  return Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
}

function daysInMonth(year: number, month: number): number {
  // month is 1-12; day 0 of the *next* month is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(c: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The monthly occurrence `monthOffset` months after `base`, or null if that month has no such day-of-month (never clamped — Eden doesn't fake a rule). */
function monthlyCandidate(base: CivilDate, monthOffset: number): CivilDate | null {
  let m = base.month + monthOffset;
  let y = base.year;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  if (base.day > daysInMonth(y, m)) return null;
  return { year: y, month: m, day: base.day };
}

interface ZonedParts extends CivilDate {
  hour: number;
  minute: number;
  second: number;
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** UTC offset (ms) of `timeZone` at `utcInstant`, i.e. (wall-clock read in `timeZone`) − utcInstant. */
function tzOffsetMs(utcInstant: number, timeZone: string): number {
  const p = getZonedParts(new Date(utcInstant), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcInstant;
}

/**
 * The UTC instant that reads as `year-month-day hour:minute:second` when
 * viewed in `timeZone`. Two passes: the first guess treats the wall clock as
 * UTC, the second corrects for that guess's own zone offset — enough to be
 * exact across every real-world DST transition.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMs(guess, timeZone);
    guess = Date.UTC(year, month - 1, day, hour, minute, second) - offset;
  }
  return new Date(guess);
}

/**
 * Expand a (possibly recurring) event into concrete runs overlapping
 * `[from, to]`. Non-recurring events (`recurrence` absent/null) always
 * produce at most one run, so every existing single-run event keeps working
 * unmodified.
 */
export function expandRuns(event: RecurrenceInput, from: Date, to: Date): EventRun[] {
  const timeZone = event.timeZone || 'UTC';
  const durationMs = event.endDate.getTime() - event.startDate.getTime();
  const startParts = getZonedParts(event.startDate, timeZone);
  const base: CivilDate = { year: startParts.year, month: startParts.month, day: startParts.day };
  const tod = { hour: startParts.hour, minute: startParts.minute, second: startParts.second };

  const rule = event.recurrence || null;
  const cancelled = new Set(rule?.cancelledRuns || []);
  const untilCivil = rule?.until ? parseCivilDateString(rule.until) : null;

  const runs: EventRun[] = [];
  let occurrenceIndex = 0;
  let monthCursor = 0; // only advances for freq === 'monthly'

  while (occurrenceIndex < MAX_OCCURRENCES) {
    let civil: CivilDate | null;

    if (!rule) {
      civil = occurrenceIndex === 0 ? base : null;
    } else if (rule.freq === 'weekly') {
      civil = addDays(base, 7 * occurrenceIndex);
    } else if (rule.freq === 'every_2_weeks') {
      civil = addDays(base, 14 * occurrenceIndex);
    } else {
      civil = null;
      while (monthCursor < MAX_MONTH_SEARCH) {
        const candidate = monthlyCandidate(base, monthCursor);
        monthCursor += 1;
        if (candidate) {
          civil = candidate;
          break;
        }
      }
    }

    if (!civil) break; // single-event exhausted, or monthly search ran out

    if (untilCivil && compareCivil(civil, untilCivil) > 0) break;
    if (rule?.count != null && occurrenceIndex >= rule.count) break;

    const runDate = civilDateString(civil);
    const start = zonedTimeToUtc(civil.year, civil.month, civil.day, tod.hour, tod.minute, tod.second, timeZone);
    const end = new Date(start.getTime() + durationMs);

    // Civil dates are strictly increasing with `occurrenceIndex`, so once a
    // run starts after the window there is nothing later worth generating.
    if (start.getTime() > to.getTime()) break;

    if (!cancelled.has(runDate) && end.getTime() >= from.getTime()) {
      runs.push({ runDate, start, end });
    }

    occurrenceIndex += 1;
  }

  return runs;
}

/**
 * Whether a registration's stored `runDate` belongs to `targetRunDate`.
 * A non-recurring event's registrations (and every registration written
 * before recurrence existed) carry no `runDate` at all; those match the
 * single implicit run (`targetRunDate` null/undefined).
 */
export function registrationMatchesRun(
  registrationRunDate: string | null | undefined,
  targetRunDate: string | null | undefined,
): boolean {
  if (!targetRunDate) return !registrationRunDate;
  return registrationRunDate === targetRunDate;
}
