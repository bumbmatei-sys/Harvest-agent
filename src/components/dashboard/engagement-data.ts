/**
 * THE-294 — the Engagement tab's read layer: what this ministry's people did,
 * and what its staff recorded about them.
 *
 * ─── 🔴 ONE COLLECTION CARRIES MOST OF THIS TAB, AND IT HAS A HARD CEILING ───
 *
 * `contactActivities` is the source for three of the four widgets here, and it
 * GROWS WITHOUT BOUND per tenant: every check-in, every form submission, every
 * paid event registration, every donation the webhook confirms and every note,
 * call, email or meeting an admin logs in the CRM appends one row, and nothing
 * in this app ever deletes one. A church running two services a week reaches
 * four figures inside a year.
 *
 * 🔴 {@link DASHBOARD_FETCH_LIMIT} IS 1,000, and `completeRead` REFUSES above
 * it rather than truncating. That is deliberate and it is the whole point of
 * this module: a busy church gets an EXPLICIT empty state on these widgets, not
 * a number computed from whichever thousand rows Firestore happened to serve.
 * An unordered `limit(1000)` is served in `__name__` order over random document
 * ids, so a truncated read is an arbitrary SAMPLE — "412 check-ins" drawn from
 * it would be a wrong number with a confident label. {@link ENGAGEMENT_REASON}
 * says what is actually true instead: there are more records than can be read
 * completely, and here is how many the read would have had to hold.
 *
 * ⚠️ The refusal is all-or-nothing per collection, which is correct: the four
 * widgets on this tab are four questions about ONE set of rows, so a ministry
 * over the ceiling cannot answer any of them completely and none of them
 * pretends to. Attendance and the prayer wall read different collections and
 * are gated separately, so they still answer.
 *
 * ─── 🔴 `createdAt` HOLDS TWO TYPES. THERE IS NO `orderBy` IN THIS FILE ──────
 *
 * Seven call sites write `contactActivities` and they disagree about the type
 * of `createdAt`:
 *
 *   · `serverTimestamp()` — /api/checkin/submit, /api/forms/submit,
 *     /api/event-registration/submit, lib/event-registration-webhook.ts and
 *     AdminCRM.tsx.
 *   · an ISO STRING — lib/donation-webhook.ts and /api/crm/send-email.
 *
 * 🔴 Firestore orders ACROSS TYPES BY TYPE FIRST, so `orderBy('createdAt')`
 * returns every string row before any Timestamp row. That order is stable and
 * it is NOT chronological, so a `limit()` on top of it is a biased sample and a
 * "latest activity" read from it would systematically show donations and
 * outbound emails and never a check-in. The comment at
 * /api/crm/send-email:169 already says DO NOT ADD AN ORDERBY TO THIS
 * COLLECTION; this module obeys it, and a guard test asserts the word appears
 * nowhere in these files.
 *
 * So the read is COMPLETE and every bucket is computed IN MEMORY, over rows
 * whose dates are parsed by `toSafeDate` — which handles a Timestamp and an ISO
 * string identically. With every matching document in hand, the order they
 * arrived in cannot change what the buckets add up to.
 *
 * ⚠️ And no composite index is involved anywhere here. `src/utils/query-helpers`
 * records that this repo avoids them by design, and `firestore.indexes.json`
 * DOES NOT DEPLOY ON MERGE — `deploy-rules.yml` runs `firestore:rules,storage`
 * only and its `paths:` filter does not include the file — so an index added
 * there is inert and the query throws `failed-precondition` in production while
 * every test stays green. Every query this module builds is one equality or a
 * subcollection path.
 *
 * ─── 🔴 Aggregates only. Never a person ─────────────────────────────────────
 *
 * Nothing this module produces carries a member's id, name, email or phone.
 * That is the ceiling THE-283 set for the dashboard read layer and enforced by
 * TYPE rather than by discipline, and this slice keeps it: {@link ActivityRow}
 * reads `contactId` only to GROUP BY it, the grouping key never leaves this
 * file, and no exported type below has a field that could hold an identifier.
 *
 * 🔴 THAT IS WHY THERE IS NO "MOST ENGAGED MEMBERS" LEADERBOARD. See
 * {@link EngagementSpread} for the full reasoning; in short, a per-person
 * ranking here would be wrong twice over — it would break that type-level
 * property, and the number it ranked on is not the number its label claims.
 */
import { collection, limit, query } from 'firebase/firestore';

import { db } from '../../firebase';
import { toSafeDate, type DateLike } from '../../utils/format-date';
import {
  DASHBOARD_FETCH_LIMIT,
  REASON,
  boundedScopedQuery,
  bucketWeekly,
  completeRead,
  scopedQuery,
  type Series,
} from './dashboard-data';

export { boundedScopedQuery, completeRead, scopedQuery };

/* ── Queries. Every one of them index-free ────────────────────────────────── */

/**
 * A tenant's check-in sessions. A SUBCOLLECTION, so it needs no `where` at all
 * and there is no apex-level counterpart to read — see `useEngagementData` for
 * why that makes the whole tab tenant-scoped.
 */
export const checkinSessionsQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'checkinSessions'));

export const boundedCheckinSessionsQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'checkinSessions'), limit(DASHBOARD_FETCH_LIMIT));

/* ── The rows, read from the documents this app actually writes ───────────── */

/**
 * The five activity types this app writes, as a CLOSED literal set.
 *
 * ⚠️ It is closed because `ContactActivity['type']` in `useCRMQueries` is a
 * union of exactly these five, and AdminCRM's own type picker offers exactly
 * these five. A row carrying anything else is a document this app did not
 * write, and it is COUNTED SEPARATELY rather than filed under a heading it does
 * not belong to — see {@link ActivityBreakdown.unrecognised}.
 */
export const ACTIVITY_TYPES = Object.freeze(['note', 'donation', 'email', 'call', 'meeting'] as const);

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** The words on screen. Sentence case, and none of them says "channel". */
export const ACTIVITY_TYPE_LABELS: Readonly<Record<ActivityType, string>> = Object.freeze({
  note: 'Notes',
  donation: 'Donations',
  email: 'Emails',
  call: 'Calls',
  meeting: 'Meetings',
});

/**
 * The `createdBy` values written by the app's OWN paths, as a closed set.
 *
 * 🔴 THIS IS A CLAIM ABOUT WHO WROTE THE ROW, NOT ABOUT WHO ACTED, and the
 * distinction is why the label on screen says "recorded automatically" rather
 * than "member-initiated". Each of these four is a server path that fires
 * because a person did something — checked in at a door, submitted a form,
 * registered for an event, completed a donation — so a row bearing one really
 * is a trace of that person's action. Every other value is a Firebase uid: an
 * admin typed the row into the CRM, or sent an email from it. Such a row may
 * still DESCRIBE something the member did (an admin logging a cash gift), so
 * calling the remainder "staff activity" would overclaim in the other
 * direction. It is called "logged by an admin", which is exactly what is known.
 *
 *   · `checkin`            — /api/checkin/submit
 *   · `form`               — /api/forms/submit
 *   · `event-registration` — /api/event-registration/submit and its webhook
 *   · `system`             — lib/donation-webhook.ts
 */
export const APP_RECORDED_WRITERS = Object.freeze(
  ['checkin', 'form', 'event-registration', 'system'] as const,
);

/**
 * One activity row, reduced to the four fields this tab aggregates over.
 *
 * 🔴 `description` IS NOT READ. It is free text an admin typed about a named
 * person — "Called about the funeral", "Prayed with her after service" — and it
 * has no aggregate meaning whatsoever. Not reading it means it cannot reach a
 * dashboard by accident, in the same way `toMemberLocation` does not read a
 * name and `toPledgeRow` does not read a donor.
 *
 * ⚠️ `contactId` IS read, and only to group by. It is a document id, never
 * rendered, and no exported aggregate below carries it.
 *
 * 🔴 `type` and `createdBy` are NULLABLE and neither has a default. `''` and
 * `'note'` are values that look like answers; `null` has no such reading and
 * cannot be summed into a row by accident. Same refusal `toInvoiceRow` makes on
 * the money path.
 */
export interface ActivityRow {
  readonly contactId: string | null;
  readonly type: string | null;
  readonly createdAt: DateLike;
  readonly createdBy: string | null;
}

/** A trimmed non-empty string, or `null`. A whitespace-only field is not a value. */
const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asDate = (v: unknown): DateLike => (v ?? null) as DateLike;

export const toActivityRow = (data: Record<string, unknown>): ActivityRow => ({
  contactId: text(data.contactId),
  type: text(data.type),
  createdAt: asDate(data.createdAt),
  createdBy: text(data.createdBy),
});

/* ── Activity by TYPE. 🔴 Not "channel share" ─────────────────────────────── */

/**
 * One activity type, how many rows carry it, and where those rows came from.
 *
 * 🔴 THE THREE COUNTS ARE A CLOSED ACCOUNTING: `appRecorded + adminLogged ===
 * activities`, per row. That split is what makes the table readable rather than
 * merely true — "Donations 40, all recorded automatically" and "Notes 120, all
 * logged by an admin" are the same column of numbers saying two completely
 * different things about a ministry, and a bare total hides which one it is.
 *
 * ⚠️ There is NO share or percentage column, deliberately. See
 * {@link ActivityBreakdown} for why the word "share" is not used here at all.
 */
export interface ActivityTypeRow {
  readonly type: string;
  readonly label: string;
  readonly activities: number;
  readonly appRecorded: number;
  readonly adminLogged: number;
}

/**
 * Every activity row, filed by type, with nothing lost between the total and
 * the rows.
 *
 * 🔴 `sum(rows[].activities) + unrecognised === total` is an INVARIANT, and
 * `appRecorded + adminLogged === total` is a second one. Both are asserted over
 * generated inputs. A row missing from the table without being counted anywhere
 * is the silent shortfall this whole feature exists to refuse.
 */
export interface ActivityBreakdown {
  /**
   * Rows in the complete read.
   *
   * 🔴 THE WIDGET BUILT ON THIS IS CALLED "ACTIVITY TYPE", NOT "CHANNEL SHARE".
   * The design package names it channel share, and that name asserts something
   * this data does not describe: `note`, `donation`, `email`, `call` and
   * `meeting` are the five values of `ContactActivity['type']`, which record
   * what a CRM ROW IS — not which marketing channel a person arrived through.
   * Nothing in this database records an acquisition channel at all: there is no
   * `source` or `utm` field on a contact, and PostHog records route PATTERNS
   * rather than campaigns. A pie headed "channel share" over these five would
   * tell a founder that 40% of their people came from email when what the
   * number means is that 40% of the rows their staff typed were emails their
   * staff sent. THE-285 established this and this slice does not undo it — a
   * guard test sweeps this file's source AND the rendered output for the word.
   */
  readonly total: number;
  /** One row per recognised type PRESENT in the data, most frequent first. */
  readonly rows: readonly ActivityTypeRow[];
  /** Rows whose `type` is absent or outside the closed set. Never re-filed. */
  readonly unrecognised: number;
  /** Rows written by one of the app's own paths — see {@link APP_RECORDED_WRITERS}. */
  readonly appRecorded: number;
  /** Rows written by an admin working in the CRM. */
  readonly adminLogged: number;
}

const isAppRecorded = (row: ActivityRow): boolean =>
  row.createdBy !== null && (APP_RECORDED_WRITERS as readonly string[]).includes(row.createdBy);

/**
 * Group a COMPLETE set of activity rows by type.
 *
 * ⚠️ Sorted here, in plain JavaScript, over an array already entirely in
 * memory: descending by count with an alphabetical tiebreak, so the same data
 * always renders in the same order. `@tanstack/react-table` sells INTERACTIVE
 * column sorting — a header a reader can click — which a static ordering does
 * not need. It is not installed and it is not added.
 */
export function aggregateActivityTypes(rows: readonly ActivityRow[]): ActivityBreakdown {
  const counts = new Map<string, { activities: number; appRecorded: number }>();
  let unrecognised = 0;
  let appRecorded = 0;

  for (const row of rows) {
    const fromApp = isAppRecorded(row);
    if (fromApp) appRecorded++;
    if (row.type === null || !(ACTIVITY_TYPES as readonly string[]).includes(row.type)) {
      unrecognised++;
      continue;
    }
    const entry = counts.get(row.type) ?? { activities: 0, appRecorded: 0 };
    entry.activities++;
    if (fromApp) entry.appRecorded++;
    counts.set(row.type, entry);
  }

  return {
    total: rows.length,
    unrecognised,
    appRecorded,
    adminLogged: rows.length - appRecorded,
    rows: [...counts.entries()]
      .map(([type, entry]) => ({
        type,
        label: ACTIVITY_TYPE_LABELS[type as ActivityType],
        activities: entry.activities,
        appRecorded: entry.appRecorded,
        adminLogged: entry.activities - entry.appRecorded,
      }))
      .sort((a, b) => b.activities - a.activities || a.label.localeCompare(b.label)),
  };
}

/* ── How widely engagement is spread. 🔴 Not a leaderboard ────────────────── */

/** One band of the distribution: a range of activity counts, and how many people fall in it. */
export interface SpreadBand {
  readonly label: string;
  readonly contacts: number;
}

/**
 * How this ministry's automatically-recorded activity is DISTRIBUTED across the
 * people it touched — not who those people are.
 *
 * ─── 🔴 WHY THIS IS NOT "MOST ENGAGED MEMBERS" ──────────────────────────────
 *
 * The design asks for a leaderboard of members by activity count. It is not
 * built, and it is REPLACED rather than deferred, for two independent reasons:
 *
 *   1. 🔴 THE NUMBER IS NOT WHAT THE LABEL CLAIMS. A raw `contactActivities`
 *      count per person mixes what the PERSON did (checked in, registered,
 *      gave) with what STAFF did about them (a note typed, an email sent, a
 *      call logged). A pastor who writes five careful notes about one grieving
 *      family member puts that member at the top of a chart headed "most
 *      engaged", which is a claim about them made from a record of somebody
 *      else's work. Ranking on it would be a wrong number wearing a name — the
 *      exact defect this whole feature exists to refuse, with a person attached.
 *
 *   2. 🔴 IT WOULD BREAK THE READ LAYER'S NO-IDENTIFIER PROPERTY. THE-283 made
 *      "aggregates only, never a person" a property of the TYPES in this
 *      directory rather than of whoever writes the next widget: `CountryRow`,
 *      `CityCount` and `PledgeSummary` have no field that could hold an id, and
 *      `AdminSignups` and `AdminCRM` are where a per-person list legitimately
 *      lives, behind their own permissions. A named leaderboard would be the
 *      first identifier ever to cross that line, and it would have to cross it
 *      in the module whose header says it does not.
 *
 * ⚠️ THE QUESTION A LEADERBOARD IS FOR IS STILL ANSWERED. "Is engagement broad
 * or is a handful of people carrying it" is what a founder actually reads a top
 * ten for, and a distribution answers it BETTER — a top ten looks identical
 * whether it is ten people out of twelve or ten out of two thousand.
 *
 * 🔴 IT COUNTS APP-RECORDED ROWS ONLY, which is what makes it about the people
 * rather than about the staff. See {@link APP_RECORDED_WRITERS}.
 */
export interface EngagementSpread {
  /** App-recorded activity rows counted. Admin-logged rows are excluded. */
  readonly activities: number;
  /** People carrying at least one of them. */
  readonly contacts: number;
  /** The bands, fewest-activities first. Every counted person is in exactly one. */
  readonly bands: readonly SpreadBand[];
  /** The largest number of activities on any one person. A count, never a name. */
  readonly busiest: number;
  /** App-recorded rows carrying no `contactId` at all. Counted, never grouped. */
  readonly withoutContact: number;
}

/**
 * The bands, as a closed literal table.
 *
 * ⚠️ Open-ended at the TOP only. Every person with at least one app-recorded
 * activity lands in exactly one band, so `sum(bands[].contacts) === contacts`
 * is an invariant rather than a hope.
 */
const BANDS: readonly { readonly label: string; readonly min: number; readonly max: number }[] =
  Object.freeze([
    { label: '1 activity', min: 1, max: 1 },
    { label: '2 to 5', min: 2, max: 5 },
    { label: '6 to 10', min: 6, max: 10 },
    { label: '11 or more', min: 11, max: Number.POSITIVE_INFINITY },
  ]);

export function spreadOfEngagement(rows: readonly ActivityRow[]): EngagementSpread {
  /** contactId → how many app-recorded rows it carries. The key never leaves here. */
  const perContact = new Map<string, number>();
  let activities = 0;
  let withoutContact = 0;

  for (const row of rows) {
    if (!isAppRecorded(row)) continue;
    activities++;
    if (row.contactId === null) {
      // 🔴 Counted, never grouped and never dropped. A row with no contact is a
      // real activity that belongs to nobody this read can name, and inventing
      // a bucket for it would put a person in the distribution who is not there.
      withoutContact++;
      continue;
    }
    perContact.set(row.contactId, (perContact.get(row.contactId) ?? 0) + 1);
  }

  const tallies = [...perContact.values()];
  return {
    activities,
    withoutContact,
    contacts: tallies.length,
    busiest: tallies.reduce((max, n) => (n > max ? n : max), 0),
    bands: BANDS.map((band) => ({
      label: band.label,
      contacts: tallies.filter((n) => n >= band.min && n <= band.max).length,
    })),
  };
}

/* ── Attendance ───────────────────────────────────────────────────────────── */

/**
 * One check-in session, reduced to the field this widget sums.
 *
 * 🔴 `attendeeCount` IS NULLABLE and has no default, for `toInvoiceRow`'s
 * reason: a session whose counter cannot be read is not a session with nobody
 * at it, and a `0` standing in for it makes the tab's total quietly short by a
 * whole service. {@link readableSessions} refuses and says how many instead.
 *
 * ⚠️ `Number.isFinite`, not `typeof === 'number'`. `NaN` and `Infinity` are both
 * `typeof 'number'` and either one poisons a sum into an unusable value — the
 * tightening THE-290 made one field over, applied here rather than rediscovered.
 */
export interface SessionRow {
  readonly attendeeCount: number | null;
}

export const toSessionRow = (data: Record<string, unknown>): SessionRow => ({
  attendeeCount:
    typeof data.attendeeCount === 'number' && Number.isFinite(data.attendeeCount)
      ? data.attendeeCount
      : null,
});

/** A session this app can actually count. */
export interface ReadableSession {
  readonly attendeeCount: number;
}

/**
 * Narrow a complete set of sessions to the ones that can be summed, or refuse.
 *
 * 🔴 STRICT, like `readableReceipts` and unlike `bucketWeekly`'s treatment of an
 * undatable row. A session missing from a bar of a chart is a gap a reader can
 * see; a session missing from a TOTAL makes that total wrong by exactly one
 * service's attendance with nothing on screen to say so. `AdminCheckin` writes
 * `attendeeCount: 0` at creation on every path, so a session without a readable
 * one is a document this app did not write and is worth a founder's attention.
 */
export function readableSessions(
  rows: readonly SessionRow[],
): { kind: 'complete'; rows: ReadableSession[] } | { kind: 'unavailable'; reason: string } {
  const bad = rows.filter((r) => r.attendeeCount === null).length;
  if (bad > 0) {
    return { kind: 'unavailable', reason: ENGAGEMENT_REASON.unreadableSessions(bad, rows.length) };
  }
  return { kind: 'complete', rows: rows as ReadableSession[] };
}

/**
 * What the attendance widget renders.
 *
 * 🔴 `checkIns` IS A SUM OF `attendeeCount`, AND THAT FIELD CAN DRIFT SHORT.
 * `/api/checkin/submit` writes the attendee row and increments the counter as
 * TWO SEQUENTIAL AWAITS with no transaction:
 *
 *     await sessionRef.collection('attendees').add({ ... });
 *     await sessionRef.set({ attendeeCount: FieldValue.increment(1) }, { merge: true });
 *
 * A failure between them leaves a person recorded in `attendees` and never
 * counted, permanently: there is no reconciliation job, no decrement path and
 * nothing that ever recomputes the field. `src/lib/checkin-session-delete.ts`
 * already carries the same warning at its own read.
 *
 * ⚠️ SO THE DRIFT IS ONE-DIRECTIONAL AND BOUNDED. It can only ever be SHORT,
 * never over, and only by as many check-ins as the increment failed on — which
 * is bounded by the write-failure rate of a single Firestore `set`, so it is
 * small. It is named here, in the module that sums the field, and stated on
 * screen by the widget, because a number that can only be short is still a
 * number a founder should be told is a floor rather than an exact count.
 *
 * 🔴 IT IS NOT "FIXED" HERE. Counting `attendees` subcollection documents
 * instead would be exact, and it is one `getCountFromServer` PER SESSION —
 * unbounded fan-out from a dashboard read — while making the counter correct is
 * a transaction in a route this ticket does not own. Reporting the floor is the
 * honest option available to a read layer; the repair is its own ticket.
 */
export interface AttendanceSummary {
  readonly sessions: number;
  /** Summed `attendeeCount`. A FLOOR, for the reason above. */
  readonly checkIns: number;
  /** The best-attended session's count. Also a floor. */
  readonly busiest: number;
  /** Sessions recorded with nobody checked in. Counted, not hidden. */
  readonly empty: number;
}

export function summariseAttendance(rows: readonly ReadableSession[]): AttendanceSummary {
  let checkIns = 0;
  let busiest = 0;
  let empty = 0;
  for (const row of rows) {
    checkIns += row.attendeeCount;
    if (row.attendeeCount > busiest) busiest = row.attendeeCount;
    if (row.attendeeCount === 0) empty++;
  }
  return { sessions: rows.length, checkIns, busiest, empty };
}

/**
 * A weekly series over a COMPLETE set of activity rows, eight buckets wide.
 *
 * 🔴 BUCKETED IN MEMORY, over an unordered read. That is not an optimisation,
 * it is the only correct way to do it here: see the module header for why
 * `orderBy('createdAt')` on this collection returns every ISO-string row ahead
 * of every Timestamp row. `toSafeDate` inside `bucketWeekly` parses both shapes
 * identically, so a row's type decides nothing about which week it lands in.
 *
 * ⚠️ A row whose `createdAt` cannot be parsed is counted in NO bucket and the
 * series stays complete — `bucketWeekly`'s documented behaviour, and the right
 * one: completeness is a claim about the READ, not about the data quality of
 * every field in it, and putting an undatable row in the newest week would
 * invent a date nobody recorded.
 */
export function activitySeries(rows: readonly ActivityRow[], now: number): Series {
  return {
    kind: 'complete',
    points: bucketWeekly(rows, now, (r) => r.createdAt).points,
  };
}

/* ── The prayer wall, and the window it may be charted over ───────────────── */

/**
 * 🔴 FOUR WEEKS, AND NOT ONE MORE. `prayer_requests` documents carry an
 * `expiresAt` thirty days after they are written (`PrayerWall.tsx`) and
 * `/api/prayer-requests/cleanup` deletes every expired row nightly at 04:00 UTC
 * (`vercel.json`).
 *
 * ⚠️ So bucket five of an eight-week chart is not "a quiet week", it is the
 * retention policy: rows older than the window have been DELETED and can only
 * ever count zero. An eight-week prayer-wall trend would draw a collapse that is
 * a property of a cron job rather than a fact about the church, and a founder
 * reading it would conclude their people stopped praying. Four weeks is inside
 * the window at every point, so every bucket it draws is a real count.
 *
 * ⚠️ Deliberately four and not "just under thirty days": the cleanup sweep is
 * capped at `limit(200)` per night, so on a busy wall deletion LAGS and rows
 * between four weeks and thirty days may or may not still exist. A window that
 * depends on how far behind a cron job is would be stable only by luck.
 */
export const PRAYER_TREND_WEEKS = 4;

/** One prayer request, reduced to its date. No author, no text, no id. */
export interface PrayerRow {
  readonly createdAt: DateLike;
}

/**
 * 🔴 Reads ONLY `createdAt`. A prayer request carries `authorId`, `authorName`,
 * the request TEXT itself and a `prayedBy` array of uids — the most sensitive
 * documents in this database, which is precisely why they are cron-deleted at
 * all. None of it is read, so none of it can reach a dashboard: the widget
 * counts rows per week and nothing else.
 */
export const toPrayerRow = (data: Record<string, unknown>): PrayerRow => ({
  createdAt: asDate(data.createdAt),
});

/**
 * A weekly series over prayer-wall rows, capped at the retention window.
 *
 * ⚠️ Bucketed IN MEMORY over a complete read, like everything else here.
 * `prayer_requests.createdAt` is an ISO string on every row PrayerWall writes,
 * so it is single-typed today — but the read is still unordered, because the
 * collection is one `addDoc` away from a second writer with a different type
 * and `contactActivities` is what that looks like when it happens.
 */
export function prayerSeries(rows: readonly PrayerRow[], now: number): Series {
  return {
    kind: 'complete',
    points: bucketWeekly(rows, now, (r) => r.createdAt, () => 1, PRAYER_TREND_WEEKS).points,
  };
}

/* ── The reasons an Engagement widget has nothing to show ─────────────────── */

/**
 * Written once, here, for the reason {@link REASON} is: a widget that invents
 * its own wording can invent a reassuring one.
 */
export const ENGAGEMENT_REASON = {
  /**
   * 🔴 THE CEILING, STATED RATHER THAN TRUNCATED. This replaces
   * `REASON.tooManyToChart` for `contactActivities` specifically, because the
   * generic wording says a TREND cannot be read and what is actually true here
   * is that NOTHING on this collection can be — the count, the type breakdown
   * and the distribution are all refused together, and a reader deserves to
   * know why rather than to see three widgets fail in three different words.
   */
  activityCeiling: (limit: number) =>
    `This ministry has recorded more than ${limit.toLocaleString()} CRM activities, which is more than can be read in one pass — so none of these figures would be complete. Every check-in, form, registration, donation and logged note adds one, and none is ever deleted.`,

  /** Read completed, and there is genuinely nothing in it. */
  noActivity:
    'No CRM activity has been recorded for this ministry yet. Check-ins, form submissions, event registrations, donations and notes logged in the CRM all appear here.',

  /** Read completed, and no check-in session has ever been created. */
  noSessions:
    'No check-in session has been created for this ministry yet. Sessions are created on the Check-In screen, and each one counts the people who scan its code.',

  /** A session document carries no readable attendee count, so no total is honest. */
  unreadableSessions: (bad: number, total: number) =>
    `${bad.toLocaleString()} of ${total.toLocaleString()} check-in sessions carry no readable attendee count, so no attendance total here would be complete.`,

  /** More sessions than may be loaded at once. */
  tooManySessions: (limit: number) =>
    `This ministry has more than ${limit.toLocaleString()} check-in sessions, which is more than can be read in one pass, so no attendance total here would be complete.`,

  /** Read completed, and the wall is empty. */
  noPrayer:
    'Nothing has been posted to the prayer wall in the last thirty days. Requests are removed automatically thirty days after they are written, so this only ever shows the recent wall.',

  /** More prayer rows than may be loaded at once. */
  tooManyPrayer: (limit: number) =>
    `More than ${limit.toLocaleString()} prayer requests are on the wall, which is more than can be read in one pass, so no complete count of the last four weeks can be drawn.`,
} as const;

/** Re-exported so an Engagement widget needs one import for every reason string. */
export { REASON, DASHBOARD_FETCH_LIMIT };
