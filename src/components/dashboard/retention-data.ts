/**
 * THE-299 — the Growth tab's retention cohorts: the read layer.
 *
 * ─── What a cell actually claims ─────────────────────────────────────────────
 *
 * A row is a JOIN MONTH. A column is the number of whole months since that
 * month. A cell is the share of that month's joiners who have at least one
 * recorded CRM activity dated inside the corresponding month.
 *
 * 🔴 "ACTIVE" HERE MEANS "RECORDED AN ACTIVITY", AND NOTHING WIDER. This app
 * has no session log, no last-seen stamp and no page-view attribution, so
 * "still using Harvest" is not a thing any read can answer. What it does have
 * is `contactActivities` — a row per check-in, form submission, event
 * registration, gift, sent email and logged note — and that is the only
 * evidence of a member doing something that this database holds. The widget's
 * own description says so in those words, because a founder who reads a 40%
 * period-0 cell as "60% of my March joiners vanished in March" has been misled
 * by a label, not by the arithmetic.
 *
 * ⚠️ THIS CORRECTS THE-283. `GROWTH_REASON.retentionDeferred` said a cohort
 * heatmap was deferred because "no heatmap component exists anywhere in this
 * app". That was true of the app and false of the world — see
 * {@link ../RetentionHeatmap} for the registry item this slice installed — and
 * it never said anything about the DATA, which THE-285 then established was
 * present. Both halves are resolved here, so the reason string is deleted
 * rather than left standing beside a built widget.
 *
 * ─── 🔴 The join, and why it needs three collections ─────────────────────────
 *
 * The join date is `users.createdAt`. The activity is `contactActivities`.
 * Those two do not touch, and this is the part the ticket's premise did not
 * carry: **`contactActivities.contactId` is not a member id.** It is the id of
 * whatever CRM row the activity was filed against, and there are two kinds:
 *
 *   · a `contacts` DOCUMENT — what /api/checkin/submit, /api/forms/submit,
 *     /api/event-registration/submit, lib/donation-webhook.ts and
 *     lib/event-registration-webhook.ts all write, having matched a visitor to
 *     a contact BY EMAIL; and
 *   · a `users` DOCUMENT ID — because `useCRMQueries.userDocToMemberContact`
 *     synthesises every member into a Contact whose `id` IS the member's uid,
 *     so an activity an admin logs against a member in AdminCRM carries the uid.
 *
 * 🔴 So an attribution that only matched uids would miss every check-in, every
 * form and every gift — which is most of the collection — and would draw a
 * retention grid of near-zeroes for a church whose members are demonstrably
 * active. That is not an incomplete number, it is a WRONG one, which is the
 * single thing this dashboard exists to refuse. The `contacts` collection is
 * therefore read as well, and it is read COMPLETELY, for exactly the same
 * reason the other two are.
 *
 * ⚠️ THE LINK RULE IS THE APP'S OWN, NOT ONE INVENTED HERE. `lib/member-erasure`
 * decides which contacts belong to a member with precisely two queries —
 * `contacts where userId == uid` and `contacts where email == email` — and an
 * erasure sweep is the highest-stakes place in this product to be wrong about
 * that question. {@link linkContacts} is those two rules, applied in that
 * order, in memory.
 *
 * 🔴 AN AMBIGUOUS EMAIL LINKS TO NOBODY. If two member documents in one tenant
 * carry the same address, that address is dropped from the index rather than
 * resolved to whichever was read first: guessing would file one member's
 * activity under another's cohort, and a wrong attribution is worse than a
 * counted one. Those rows land in `activitiesUnresolved` and are on screen.
 *
 * ─── 🔴 Every row is accounted for, in exactly one place ─────────────────────
 *
 * The discipline `aggregateLocations` and `bucketWeekly` already apply. Two
 * closed accountings, both asserted over generated inputs:
 *
 *   membersInWindow + membersBeforeWindow + membersAfterWindow
 *     + membersUndated === membersTotal
 *
 *   activitiesAttributed + activitiesNotAMember + activitiesUnresolved
 *     + activitiesUndated === activitiesRead
 *
 * A member outside the twelve-month window is COUNTED and placed nowhere, and
 * the count is rendered beside the grid. An activity belonging to a contact who
 * is not a member (a donor, a visitor, a prospect) is COUNTED and placed
 * nowhere, and so is one whose contact row this tenant does not hold. None of
 * them is silently dropped, because a member missing from a grid without being
 * counted anywhere is the shortfall this whole feature exists to refuse.
 *
 * ─── 🔴 No orderBy. Complete reads, bucketed in memory ───────────────────────
 *
 * `contactActivities.createdAt` HOLDS BOTH TIMESTAMPS AND ISO STRINGS — five
 * writers use `serverTimestamp()`, while `lib/donation-webhook.ts` and
 * /api/crm/send-email write `new Date().toISOString()`. Firestore orders ACROSS
 * TYPES BY TYPE FIRST, so `orderBy('createdAt')` returns every string row
 * before any Timestamp row: stable, and not chronological. And `users` has no
 * `(tenantId, createdAt)` composite index, which this repo avoids by design
 * (`utils/query-helpers`) and could not deploy anyway — `deploy-rules.yml` runs
 * `firestore:rules,storage` only, so an entry in `firestore.indexes.json` is
 * inert.
 *
 * Neither matters, because nothing here is ordered. All three reads go through
 * {@link completeRead}, which takes an exact server-side count FIRST and
 * refuses above the ceiling, so what arrives is either every matching document
 * or nothing — and with every document in hand, the order they arrived in
 * cannot change what the buckets add up to. `toSafeDate` reads both shapes.
 *
 * ─── 🔴 Aggregates only. Never a person ─────────────────────────────────────
 *
 * {@link RetentionGrid} and {@link CohortRow} have NO field that could hold an
 * identifier: a cohort is a month label and a count, and there is no expander,
 * no row per member and no list behind a cell. The privacy property is enforced
 * by the TYPE, exactly as THE-283 enforced it for {@link CountryRow}.
 *
 * ⚠️ The uid and the email DO exist between the read and the aggregation — a
 * join cannot be performed without them — and they exist only there.
 * {@link buildRetention} takes them as arguments and cannot return them, so no
 * identifier crosses this module's boundary even if the widget above it tried.
 */
import { toSafeDate, type DateLike } from '../../utils/format-date';
import { toMemberLocation, type MemberLocation } from './growth-data';

/**
 * How many join months the grid covers, and therefore how many periods its
 * oldest cohort can have.
 *
 * Twelve, because a cohort question is a year-shaped question and a month is
 * the unit both halves of the join are recorded in. It also bounds the widest
 * the grid can ever get, which is what makes its 380px behaviour a fixed
 * property rather than one that grows with the tenant's age.
 */
export const RETENTION_MONTHS = 12;

/* ── The rows, read from the documents this app actually writes ───────────── */

/** A trimmed non-empty string, or `null`. Whitespace is not an identifier. */
const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * An address, lower-cased for MATCHING only.
 *
 * ⚠️ Nothing is ever displayed from this, so there is no "re-titled into a form
 * nobody typed" problem of the kind `aggregateLocations` has to avoid. The
 * lower-casing exists because `member-erasure` compares addresses that were
 * written by five different paths, and email addresses are not case-sensitive
 * in the half that matters.
 */
const emailKey = (v: unknown): string | null => text(v)?.toLocaleLowerCase() ?? null;

/**
 * One member: their join date, and the two fields needed to find their activity.
 *
 * ⚠️ It EXTENDS {@link MemberLocation} and is built by calling
 * {@link toMemberLocation}, so the Growth tab's countries table is fed by
 * exactly the function that already fed it — the location figures cannot move
 * because nothing about how they are read has changed. That is also why this
 * slice adds no second read of `users`: one read, one mapper, two widgets, and
 * no way for them to disagree about how many members this ministry has.
 */
export interface MemberRow extends MemberLocation {
  readonly uid: string;
  readonly email: string | null;
  readonly joinedAt: Date | null;
}

/** The CRM contact rows, read for their two member links and nothing else. */
export interface ContactRow {
  readonly contactId: string;
  readonly userId: string | null;
  readonly email: string | null;
}

/**
 * One activity: who it was filed against, and when.
 *
 * 🔴 It carries NO `description`. Those strings are free text an admin typed —
 * "Called about the funeral", "Left the youth group" — and nothing here needs
 * to read one to count it. Not reading them is what keeps this module unable to
 * leak one.
 */
export interface ActivityStamp {
  readonly contactId: string | null;
  readonly at: Date | null;
}

export const toMemberRow = (data: Record<string, unknown>, id: string): MemberRow => ({
  ...toMemberLocation(data),
  uid: id,
  email: emailKey(data.email),
  joinedAt: toSafeDate(data.createdAt as DateLike),
});

export const toContactRow = (data: Record<string, unknown>, id: string): ContactRow => ({
  contactId: id,
  userId: text(data.userId),
  email: emailKey(data.email),
});

export const toActivityStamp = (data: Record<string, unknown>): ActivityStamp => ({
  contactId: text(data.contactId),
  at: toSafeDate(data.createdAt as DateLike),
});

/* ── The aggregate ────────────────────────────────────────────────────────── */

/**
 * One join month.
 *
 * 🔴 `label` is a DATE RANGE and can be nothing else — it is derived from a
 * month index by {@link monthLabel} and never read from a document — so the
 * heatmap's row headings cannot become names however its props are wired.
 *
 * `active` and `retained` are the same fact twice: a count and the share it is
 * of `members`. Both are carried because the widget renders the share and the
 * accessible table renders the count, and deriving one from the other at the
 * point of display is how two numbers on one screen start to disagree.
 *
 * ⚠️ `null` at a period means NOT YET OBSERVED — that month has not finished —
 * and it is not `0`. A zero would say "nobody was active", which is a claim
 * about a month that has not happened.
 */
export interface CohortRow {
  /** Sortable month key, `YYYY-MM`. Never displayed. */
  readonly key: string;
  /** What a reader sees, e.g. `Mar 2026`. A month, never a person. */
  readonly label: string;
  /** How many members joined in this month. A count. */
  readonly members: number;
  readonly active: readonly (number | null)[];
  readonly retained: readonly (number | null)[];
}

/**
 * The whole answer, including every part of it that is missing.
 *
 * 🔴 The two invariants in this module's header are properties of this object,
 * asserted over generated inputs. They are what makes it safe to render: a
 * reader can add the grid up and land on the member count the Overview tab
 * shows, and the difference is on screen rather than lost.
 */
export interface RetentionGrid {
  /** Columns. Always {@link RETENTION_MONTHS}; later ones are `null` per row. */
  readonly periods: number;
  readonly rows: readonly CohortRow[];
  /** Pooled share per period — `sum(active) / sum(members)`, not a mean of means. */
  readonly overall: readonly (number | null)[];

  readonly membersTotal: number;
  readonly membersInWindow: number;
  /** Joined before the window opened. Counted, placed nowhere. */
  readonly membersBeforeWindow: number;
  /** Joined during the month now in progress, which has not finished. */
  readonly membersAfterWindow: number;
  /** `createdAt` could not be read at all. */
  readonly membersUndated: number;

  readonly activitiesRead: number;
  readonly activitiesAttributed: number;
  /** Filed against a contact this tenant holds who is not a member. */
  readonly activitiesNotAMember: number;
  /** No contactId, an unknown one, or an ambiguous email. */
  readonly activitiesUnresolved: number;
  readonly activitiesUndated: number;
}

/** Months since epoch-year zero. Local, matching `weekBuckets`' local labels. */
const monthIndex = (d: Date): number => d.getFullYear() * 12 + d.getMonth();

const monthDate = (index: number): Date => new Date(Math.floor(index / 12), index % 12, 1);

/** `Mar 2026`. A month, and there is no branch that could produce anything else. */
const monthLabel = (index: number): string =>
  monthDate(index).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

const monthKey = (index: number): string =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

/** Sentinel for an address more than one member in this tenant carries. */
const AMBIGUOUS = Symbol('ambiguous email');

/**
 * Map every CRM contact this tenant holds to the member it belongs to, by the
 * two rules `lib/member-erasure` already uses, in that order.
 *
 * Exported so the invariant tests can drive it directly. Returns only the
 * contacts that DID link; a caller distinguishes "not a member" from "not a
 * contact we hold" by asking whether the id was in `contacts` at all.
 */
export function linkContacts(
  members: readonly MemberRow[],
  contacts: readonly ContactRow[],
): Map<string, string> {
  const byUid = new Set(members.map((m) => m.uid));
  const byEmail = new Map<string, string | typeof AMBIGUOUS>();
  for (const member of members) {
    if (member.email === null) continue;
    byEmail.set(member.email, byEmail.has(member.email) ? AMBIGUOUS : member.uid);
  }

  const linked = new Map<string, string>();
  for (const contact of contacts) {
    // Rule 1: an explicit member link, but only to a member of THIS read. A
    // `userId` naming somebody outside it is not evidence about anyone here.
    if (contact.userId !== null && byUid.has(contact.userId)) {
      linked.set(contact.contactId, contact.userId);
      continue;
    }
    // Rule 2: the address. An ambiguous one links to nobody — see the header.
    if (contact.email === null) continue;
    const byAddress = byEmail.get(contact.email);
    if (typeof byAddress === 'string') linked.set(contact.contactId, byAddress);
  }
  return linked;
}

/**
 * Build the grid from three COMPLETE reads.
 *
 * `now` is a parameter so a test pins the month boundaries instead of racing
 * the clock, exactly as `bucketWeekly` takes one.
 *
 * 🔴 THE WINDOW ENDS AT THE LAST COMPLETE MONTH. The month in progress is
 * excluded from both the rows and the periods: a cohort's period-0 cell is the
 * share active during their whole join month, and computing one from a month
 * that is four days old would draw a collapse that is a calendar rather than a
 * fact about the church. Members who joined in it are counted in
 * `membersAfterWindow` and named on screen.
 */
export function buildRetention(
  members: readonly MemberRow[],
  contacts: readonly ContactRow[],
  activities: readonly ActivityStamp[],
  now: number,
): RetentionGrid {
  const lastComplete = monthIndex(new Date(now)) - 1;
  const firstCohort = lastComplete - (RETENTION_MONTHS - 1);

  /* ── Members into cohorts, with nothing lost ───────────────────────────── */

  const cohortOf = new Map<string, number>();
  const size = new Map<number, number>();
  let membersInWindow = 0;
  let membersBeforeWindow = 0;
  let membersAfterWindow = 0;
  let membersUndated = 0;

  for (const member of members) {
    if (member.joinedAt === null) { membersUndated++; continue; }
    const joined = monthIndex(member.joinedAt);
    if (joined < firstCohort) { membersBeforeWindow++; continue; }
    if (joined > lastComplete) { membersAfterWindow++; continue; }
    membersInWindow++;
    cohortOf.set(member.uid, joined);
    size.set(joined, (size.get(joined) ?? 0) + 1);
  }

  /* ── Activities onto members, with nothing lost ────────────────────────── */

  const linked = linkContacts(members, contacts);
  const heldContacts = new Set(contacts.map((c) => c.contactId));
  const memberUids = new Set(members.map((m) => m.uid));

  /** uid → the set of month indices that member did something in. */
  const activeMonths = new Map<string, Set<number>>();
  let activitiesAttributed = 0;
  let activitiesNotAMember = 0;
  let activitiesUnresolved = 0;
  let activitiesUndated = 0;

  for (const activity of activities) {
    if (activity.at === null) { activitiesUndated++; continue; }
    if (activity.contactId === null) { activitiesUnresolved++; continue; }

    // The uid case first: AdminCRM files an activity against a synthetic member
    // Contact whose id IS the uid, so this id may already name a member.
    const uid = memberUids.has(activity.contactId)
      ? activity.contactId
      : linked.get(activity.contactId) ?? null;

    if (uid === null) {
      // A contact we hold who is not a member is a DIFFERENT fact from an id
      // this tenant has no row for, and both are on screen under their own name.
      if (heldContacts.has(activity.contactId)) activitiesNotAMember++;
      else activitiesUnresolved++;
      continue;
    }

    activitiesAttributed++;
    let months = activeMonths.get(uid);
    if (!months) { months = new Set(); activeMonths.set(uid, months); }
    months.add(monthIndex(activity.at));
  }

  /* ── The grid ──────────────────────────────────────────────────────────── */

  /** uid lists per cohort, built once so the cells below are a lookup. */
  const membersByCohort = new Map<number, string[]>();
  for (const [uid, cohort] of cohortOf) {
    const bucket = membersByCohort.get(cohort);
    if (bucket) bucket.push(uid);
    else membersByCohort.set(cohort, [uid]);
  }

  const pooledActive = new Array<number>(RETENTION_MONTHS).fill(0);
  const pooledSize = new Array<number>(RETENTION_MONTHS).fill(0);

  const rows: CohortRow[] = [];
  for (let cohort = firstCohort; cohort <= lastComplete; cohort++) {
    const uids = membersByCohort.get(cohort) ?? [];
    const observed = lastComplete - cohort + 1;
    const active: (number | null)[] = [];
    const retained: (number | null)[] = [];

    for (let period = 0; period < RETENTION_MONTHS; period++) {
      // 🔴 Beyond `observed` the month has not finished. `null`, never `0`.
      if (period >= observed) { active.push(null); retained.push(null); continue; }
      const count = uids.reduce(
        (sum, uid) => sum + (activeMonths.get(uid)?.has(cohort + period) ? 1 : 0),
        0,
      );
      active.push(count);
      // 🔴 A cohort nobody joined has no share. `0/0` is not `0%`, it is a
      // question with no subject, and `null` is what the grid draws as blank.
      retained.push(uids.length === 0 ? null : (count / uids.length) * 100);
      pooledActive[period] += count;
      pooledSize[period] += uids.length;
    }

    rows.push({
      key: monthKey(cohort),
      label: monthLabel(cohort),
      members: uids.length,
      active,
      retained,
    });
  }

  return {
    periods: RETENTION_MONTHS,
    rows,
    // Pooled, NOT a mean of the column's percentages: cohorts differ in size by
    // a lot, and averaging their rates would let a three-member month weigh as
    // much as a three-hundred-member one.
    overall: pooledSize.map((n, period) => (n === 0 ? null : (pooledActive[period] / n) * 100)),

    membersTotal: members.length,
    membersInWindow,
    membersBeforeWindow,
    membersAfterWindow,
    membersUndated,

    activitiesRead: activities.length,
    activitiesAttributed,
    activitiesNotAMember,
    activitiesUnresolved,
    activitiesUndated,
  };
}

/* ── The reasons this widget has nothing to draw ──────────────────────────── */

/**
 * Written once, here, for the reason {@link REASON} is written once: a widget
 * that invents its own wording can invent a reassuring one.
 *
 * 🔴 THE THREE CEILINGS ARE NAMED SEPARATELY AND SAY WHICH COLLECTION BOUND.
 * `completeRead` reports the generic "a complete trend cannot be read"; what is
 * true here is that a specific collection is larger than one pass, that the
 * grid is therefore refused ENTIRELY, and which one it was. #438 established
 * the shape for `contactActivities` and this follows it for all three — a
 * stated refusal, never a grid drawn over whatever the first thousand rows
 * happened to be.
 */
export const RETENTION_REASON = {
  activityCeiling: (limit: number) =>
    `This ministry has recorded more than ${limit.toLocaleString()} CRM activities, which is more than can be read in one pass — so no cohort's retention would be complete. Every check-in, form, registration, gift and logged note adds one, and none is ever deleted.`,

  contactCeiling: (limit: number) =>
    `This ministry has more than ${limit.toLocaleString()} CRM contacts, and each member's activity is found through their contact record — so a grid read from a partial contact list would understate every cohort.`,

  memberCeiling: (limit: number) =>
    `This ministry has more than ${limit.toLocaleString()} members, which is more than can be read in one pass, so no cohort could be sized exactly.`,

  /** Read completed, and nobody joined inside the window. */
  noCohorts: (months: number) =>
    `Nobody has joined this ministry in the last ${months} months, so there is no cohort to follow. The grid appears with the first month that has members in it.`,

  /** Read completed, and the collection is genuinely empty. */
  noActivity:
    'This ministry has recorded no CRM activity at all, so there is nothing to measure a cohort against. Check-ins, form submissions, event registrations, gifts and logged notes each add a row.',
} as const;
