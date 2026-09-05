/**
 * THE-317 — volunteer rotas, part 2 of 3.
 *
 * The same assignment #449 already ships — ONE person on ONE item of ONE plan —
 * seen across DATES instead of down a single run sheet. Nothing here is a new
 * kind of record: a rota row IS `ServicePlanItem.personId`, read for several
 * events at once. That is the whole of the contract part 1 wrote down, and this
 * module is the arithmetic side of honouring it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHAT PART 1 PROMISED, AND WHETHER IT HELD. IT HELD, ON ALL THREE COUNTS.
 *
 * `service-plan.ts`'s header states three properties as "the contract with part
 * 2". Each was checked against the shipped code before a line of this was
 * written, and each is true:
 *
 *   1. `id` IS STABLE AND INDEPENDENT OF POSITION — `genItemId()` is called once
 *      in `emptyItem()` and once per row in `itemsFromTemplate()`, and `renumber`
 *      is the only writer of `order`. So `(planId, itemId)` survives a reorder
 *      and this module keys on it. ✅ Used, unchanged.
 *   2. `personId` IS ALREADY THE IDENTITY A ROTA ASSIGNS — a `users/{uid}` doc
 *      id. ✅ Used, unchanged, and this ticket resolves people from the SAME
 *      `useServicePeople` query for the same reason (see the queries module).
 *   3. THE TIMING IS A PURE FUNCTION, and {@link findDoubleBookings} was written
 *      THERE, taking many plans, "in the ticket that owns the arithmetic". ✅
 *      This module CALLS it. It does not re-derive an overlap rule, which is the
 *      one thing that would have made part 1's foresight worthless.
 *
 * 🔴 SO NOTHING IN `service-plan.ts` OR ITS PERSISTED SHAPE MOVES. No field is
 * added to `ServicePlanItem`, no document written by part 1 is rewritten into a
 * new form, and the only write this feature makes is part 1's own
 * `saveServicePlanItems`. `the-317-guards.test.ts` pins that by digest.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 "WHO HAS NOT SERVED RECENTLY" COMES FROM THE ROTA'S OWN ASSIGNMENTS,
 *    NOT FROM `contactActivities`. THE TICKET'S READ WAS RIGHT.
 *
 * The obvious source is wrong on three counts, each already established at cost
 * in this repo, and any ONE of them is disqualifying:
 *
 *   · IT HAS A CEILING. THE-285 established that `contactActivities` grows
 *     without bound and the read refuses past 1,000 rows; #438 had to handle
 *     that for the dashboard. A ceiling on the source of a "has not served"
 *     figure means the figure is a floor pretending to be a fact — the person
 *     whose row fell off the end reads as never having served.
 *
 *   · ITS `contactId` IS NOT ONE THING. THE-299 found it holds a CRM `contacts`
 *     doc id in five writers (all matching by email) and a `users` doc id in
 *     `AdminCRM`. A rota's identity is a `users/{uid}` — part 1 says so — so a
 *     uid-only join drew near-zero for an active church. THE-299 solved its own
 *     problem by linking through `member-erasure`'s userId-then-email rule with
 *     an ambiguous address linking to nobody. That is a correct solution to a
 *     problem this feature does not have to have.
 *
 *   · ITS `createdAt` HOLDS BOTH ISO STRINGS AND `Timestamp`s, and Firestore
 *     orders across types by TYPE FIRST — so `orderBy('createdAt')` returns
 *     every string row before any Timestamp row. Stable, and not chronological.
 *     "Recently" is a question about order in time.
 *
 * ⚠️ AND IT WOULD BE THE WRONG ANSWER EVEN IF ALL THREE WERE FIXED. A CRM
 * activity is a record of contact — a call, an email, a note. Serving on a
 * Sunday is not one, and no writer puts one there. `contactActivities` does not
 * know who led worship; the rota does, exactly, because the rota is what
 * assigned them.
 *
 * 🔴 THE ROTA'S OWN DATA IS SMALLER, EXACT, AND UNAMBIGUOUS: one document per
 * plan, a `users/{uid}` on each item, and a DATE that is the event's own
 * `startDate` — a `Timestamp` with one writer. There is no ceiling worth the
 * name (see `ROTA_PLAN_LIMIT`), no id ambiguity, and no mixed type.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 AND IT STILL ONLY SHIPS A FIGURE WHEN THE READ IS PROVABLY COMPLETE.
 *
 * A smaller, exact source is not the same as a complete read of it, and the
 * class of bug that shipped as `Form submissions 0` is precisely the difference.
 * So {@link recencyVerdict} is a separate, explicit judgement made BEFORE any
 * name is listed, and {@link notServedRecently} returns NO PEOPLE unless it
 * passes. The UI renders an `empty` in that case — never a zero, never a list.
 * See the verdict's own note for the three ways a read fails to be provable.
 */
import {
  findDoubleBookings,
  itemClockTimes,
  orderedItems,
  type DoubleBooking,
  type ScheduledPlan,
  type ServicePlanItem,
} from './service-plan';

/**
 * 🔴 AN EVENT, AS A ROTA IS ALLOWED TO KNOW IT: A DATE AND A TITLE.
 *
 * ⚠️ THERE IS NO `location`, NO `isOnline` AND NO `onlineLink` FIELD HERE, AND
 * THAT IS A PROPERTY OF THE TYPE RATHER THAN A HABIT OF THE COMPONENT.
 * THE-283 made "never a person plus a place" a property of the dashboard's
 * types for exactly this reason: a rule a renderer has to remember is a rule
 * that is one careless JSX expression from being broken, whereas a field that
 * does not exist cannot be rendered by anybody.
 *
 * A rota names people by necessity — that is the feature. What it must not
 * become is a directory, and the line between the two is the place. `Event`
 * carries `location`; nothing may narrow an `Event` into this type except
 * {@link rotaEvent}, which drops it.
 */
export interface RotaEvent {
  id: string;
  title: string;
  /** The event's own `startDate`, as a `Date`. Null for an event saved without one. */
  startsAt: Date | null;
}

/** One service on the rota: an event, and the plan (if any) that runs it. */
export interface RotaService {
  eventId: string;
  eventTitle: string;
  startsAt: Date | null;
  /** Null when the event has no order of service yet — a real and common state. */
  planId: string | null;
  planName: string;
  items: ServicePlanItem[];
}

/** A week of the rota. `services` is every dated service inside it, in time order. */
export interface RotaWeek {
  /** Local midnight on the week's first day. Also the React key — one per week. */
  weekStart: Date;
  /** Local midnight on the day AFTER the week's last. Half-open: [start, end). */
  weekEnd: Date;
  services: RotaService[];
}

/**
 * How far back "recently" reaches, in days. 56 = eight weeks.
 *
 * ⚠️ A NUMBER WITH A REASON, not a round one. A church rosters most volunteer
 * teams on a four-to-six week cycle, so a window shorter than one full cycle
 * would list everybody who is simply between turns — which is noise, and noise
 * is how a warning surface gets ignored. Eight weeks is comfortably longer than
 * the longest common cycle, so a name on this list has genuinely been skipped
 * rather than merely not being due.
 */
export const RECENT_WINDOW_DAYS = 56;

/** How many weeks forward the rota grid shows. Six services is a planning horizon. */
export const ROTA_WEEKS = 6;

/** Local midnight on `d`'s own day. */
export const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Local midnight on the SUNDAY on or before `d`.
 *
 * ⚠️ SUNDAY-START, and that is a decision about this product rather than a
 * locale default. A church's week is named by its service: "the week of Sunday
 * the 6th" means the Sunday first and the planning that follows it. A
 * Monday-start week would put the Sunday service at the far end of the row it
 * names, which is the wrong way round for the one reader this grid has.
 *
 * ⚠️ Built from `getFullYear/Month/Date` rather than by subtracting
 * milliseconds: a DST boundary inside the week makes the day 23 or 25 hours
 * long, and arithmetic on epoch milliseconds silently lands on the wrong day
 * twice a year. The `Date` constructor normalises an out-of-range day-of-month.
 */
export const startOfWeek = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());

/** `days` after local midnight on `d`. DST-safe, for {@link startOfWeek}'s reason. */
export const addDays = (d: Date, days: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/** Two `Date`s on the same local calendar day. */
export const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * 🔴 THE NARROWING THAT DROPS THE PLACE. The only way to make a {@link RotaEvent}.
 *
 * It takes the four fields it needs by name rather than spreading, so a field
 * added to `Event` later — another address, a room, a campus — cannot arrive
 * here by accident. `the-317-guards.test.ts` asserts this module never mentions
 * `location`, `isOnline`, `onlineLink`, `city` or `country` at all.
 */
export const rotaEvent = (
  event: { id: string; title: string; startDate: { toDate: () => Date } | null },
): RotaEvent => ({
  id: event.id,
  title: event.title,
  startsAt: event.startDate ? event.startDate.toDate() : null,
});

/**
 * Events joined to their plans, newest LAST, undated events dropped.
 *
 * ⚠️ The join is in memory over two reads, not one query per event. See the
 * queries module for why that is the only affordable shape — and what it costs.
 */
export function rotaServices(
  events: readonly RotaEvent[],
  plans: readonly { id: string; eventId: string | null; name: string; items: ServicePlanItem[] }[],
): RotaService[] {
  const byEvent = new Map<string, (typeof plans)[number]>();
  for (const plan of plans) {
    // ⚠️ FIRST WINS, deterministically. Part 1 ships one plan per event and its
    // panel never creates a second; a church that has somehow produced two would
    // otherwise see the rota flip between them as Firestore's arbitrary order
    // changed. `useServicePlan` resolves the same collision the same way.
    if (plan.eventId && !byEvent.has(plan.eventId)) byEvent.set(plan.eventId, plan);
  }
  return events
    .filter((e): e is RotaEvent & { startsAt: Date } => e.startsAt !== null)
    .map((e) => {
      const plan = byEvent.get(e.id) ?? null;
      return {
        eventId: e.id,
        eventTitle: e.title,
        startsAt: e.startsAt,
        planId: plan?.id ?? null,
        planName: plan?.name ?? '',
        items: plan ? orderedItems(plan.items) : [],
      };
    })
    .sort((a, b) => (a.startsAt as Date).getTime() - (b.startsAt as Date).getTime());
}

/**
 * 🔴 THE GRID. `weeks` weeks starting the Sunday on or before `from`, each
 * carrying the services that fall inside it.
 *
 * ⚠️ EVERY WEEK IS RETURNED, INCLUDING EMPTY ONES. A rota that silently omitted
 * a week with no service would read as a continuous run of Sundays with one
 * quietly missing — which is the exact thing an admin opens this screen to
 * notice. An empty week is a fact about the church's diary and is shown as one.
 */
export function rotaWeeks(
  services: readonly RotaService[],
  from: Date,
  weeks: number = ROTA_WEEKS,
): RotaWeek[] {
  const first = startOfWeek(from);
  return Array.from({ length: Math.max(0, weeks) }, (_, i) => {
    const weekStart = addDays(first, i * 7);
    const weekEnd = addDays(weekStart, 7);
    return {
      weekStart,
      weekEnd,
      services: services.filter(
        (s) => s.startsAt !== null && s.startsAt >= weekStart && s.startsAt < weekEnd,
      ),
    };
  });
}

/** One line of "who is on": an item, its clock time, and whoever holds it. */
export interface OnDutyRow {
  eventId: string;
  eventTitle: string;
  planId: string | null;
  item: ServicePlanItem;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * 🔴 "WHO IS ON NEXT SUNDAY" — the real assignments for one calendar day.
 *
 * ⚠️ IT READS THE ASSIGNMENTS, IT DOES NOT SUMMARISE THEM. Every item of every
 * service on that day comes back, unassigned rows included, because "nobody is
 * on the sound desk" is the answer this question is most often asked to get.
 * Filtering to the assigned rows here would turn a gap into an absence.
 *
 * Clock times come from part 1's {@link itemClockTimes}, so a row's time is the
 * event start plus the durations above it — the same number the run sheet
 * shows, derived the same way, never stored.
 */
export function whoIsOn(services: readonly RotaService[], day: Date): OnDutyRow[] {
  return services
    .filter((s) => s.startsAt !== null && isSameDay(s.startsAt, day))
    .flatMap((s) =>
      itemClockTimes(s.items, s.startsAt).map((clock) => ({
        eventId: s.eventId,
        eventTitle: s.eventTitle,
        planId: s.planId,
        item: clock.item,
        startsAt: clock.startsAt,
        endsAt: clock.endsAt,
      })),
    );
}

/**
 * 🔴 THE DOUBLE-BOOKING WARNING, DELEGATED TO PART 1'S ARITHMETIC.
 *
 * ⚠️ This function contains NO overlap rule. `findDoubleBookings` owns it — it
 * was written in `service-plan.ts` for this ticket, by name — and all this does
 * is put the rota's services into the {@link ScheduledPlan} shape it takes. A
 * second overlap rule written here would be the failure part 1 pre-empted.
 *
 * 🔴 IT IS A WARNING AND NEVER A BLOCK, and that is a product decision with a
 * reason: a church may genuinely want the same person doing two things back to
 * back, or in two rooms at an overlapping moment, and a system that refused
 * would be telling a church how to run its Sunday. Nothing in this module or in
 * the UI refuses an assignment; {@link overlapWarnings} is only ever read to
 * decide what to SAY. The tests assert both halves.
 *
 * ⚠️ AND THE OVERLAP IS DECIDED BY THE RUN SHEET'S TIMINGS. `findDoubleBookings`
 * calls `itemClockTimes`, so a clash is two derived clock ranges intersecting —
 * not two rows on the same date. Move a duration above an item and the item's
 * clock moves, and so does whether it clashes.
 */
export function overlapWarnings(services: readonly RotaService[]): DoubleBooking[] {
  const scheduled: ScheduledPlan[] = services
    .filter((s) => s.planId !== null)
    .map((s) => ({ planId: s.planId as string, items: s.items, start: s.startsAt }));
  return findDoubleBookings(scheduled);
}

/** Every `(planId, itemId)` involved in a clash — what a row needs to know. */
export function warnedItemKeys(warnings: readonly DoubleBooking[]): Set<string> {
  const keys = new Set<string>();
  for (const w of warnings) {
    keys.add(`${w.a.planId}:${w.a.item.id}`);
    keys.add(`${w.b.planId}:${w.b.item.id}`);
  }
  return keys;
}

/**
 * What the two reads behind a rota actually returned, as facts rather than as
 * data. {@link recencyVerdict} is a pure function of this.
 */
export interface RotaReadState {
  /** Either read rejected. `permission-denied` until the rule below deploys. */
  failed: boolean;
  /** The plan read came back at its ceiling, so there may be plans it did not return. */
  plansTruncated: boolean;
  /** The event read came back at ITS ceiling (`useEvents`' `limit(100)`). */
  eventsTruncated: boolean;
  /**
   * The earliest `startsAt` among the events actually read, or null if none had
   * one. ⚠️ This is what makes a truncated event read RECOVERABLE: `useEvents`
   * orders `startDate` DESC, so a truncated read is the hundred most recent
   * events — and if the oldest of those is still older than the window, every
   * event inside the window was returned and nothing is missing from the answer.
   */
  oldestEventStart: Date | null;
}

/** Whether a "has not served recently" figure may be shown at all, and why not. */
export interface RecencyVerdict {
  /** 🔴 A figure ships only when this is true. */
  complete: boolean;
  /** Null when complete; otherwise the reason, in the words the `empty` shows. */
  reason: string | null;
}

/**
 * 🔴 THE JUDGEMENT THAT DECIDES WHETHER A FIGURE MAY SHIP. EXACT, OR NOTHING.
 *
 * ⚠️ "Nobody has served recently" when in fact the read failed is the class of
 * bug that shipped as `Form submissions 0`, and it is worse than showing
 * nothing because it is INDISTINGUISHABLE FROM AN ANSWER. A church would look
 * at an empty list and conclude its rota was fine.
 *
 * Three ways a read fails to be provable, and each returns a reason the UI
 * prints verbatim rather than a bare `false`:
 *
 *   1. THE READ REJECTED. Until the `servicePlans` rule deploys (see the queries
 *      module — it is reported, not written) every read here is
 *      `permission-denied`. This is the common case at ship time, not an edge.
 *   2. THE PLAN READ HIT ITS CEILING. A plan not returned is a service whose
 *      assignments are unknown, so somebody it names could be wrongly listed.
 *   3. THE EVENT READ HIT ITS CEILING **AND DID NOT REACH BACK PAST THE WINDOW**.
 *      A plan's DATE comes from its event, so an event not returned is a plan
 *      that cannot be placed in time. ⚠️ The second half is what stops this
 *      being needlessly pessimistic: if the oldest event returned is already
 *      older than the window start, every event inside the window is in hand and
 *      the answer is exact regardless of how many older ones were dropped. That
 *      is a PROOF of completeness over a truncated read, which is the second
 *      thing this ticket's rule allows.
 */
export function recencyVerdict(read: RotaReadState, windowStart: Date): RecencyVerdict {
  if (read.failed) {
    return {
      complete: false,
      reason: 'The rota could not be read, so who has served cannot be worked out.',
    };
  }
  if (read.plansTruncated) {
    return {
      complete: false,
      reason: 'There are more service plans than one read returns, so this would be a guess.',
    };
  }
  if (read.eventsTruncated && (read.oldestEventStart === null || read.oldestEventStart > windowStart)) {
    return {
      complete: false,
      reason: 'The event read does not reach back far enough to cover the whole period.',
    };
  }
  return { complete: true, reason: null };
}

/** A person, and when the rota last had them on — and next has them on. */
export interface ServedRecord {
  id: string;
  name: string;
  /** The latest PAST service they hold an item on, or null for never. */
  lastServedAt: Date | null;
  /** The next FUTURE service they hold an item on, or null. */
  nextScheduledAt: Date | null;
}

/**
 * 🔴 WHO HAS NOT SERVED RECENTLY — OR NOTHING AT ALL.
 *
 * `people` is the church's `users` (part 1's collection, see the queries
 * module), so somebody who has NEVER served appears with `lastServedAt: null` —
 * which is the person this view exists to surface and the one a fold over
 * assignments alone can never produce.
 *
 * ⚠️ ONLY PAST SERVICES COUNT AS HAVING SERVED. An assignment next Sunday is
 * not service rendered, so it does not clear somebody off this list — but it IS
 * reported as `nextScheduledAt`, because "not served since June, but on this
 * Sunday" and "not served since June, and not booked" are different situations
 * and an admin acts differently on each.
 *
 * 🔴 WHEN THE VERDICT IS INCOMPLETE, `people` IS EMPTY AND THE CALLER MUST
 * RENDER THE REASON. It does not fall back to a partial list: a partial list
 * here is a list of names accused of not turning up, some of whom did.
 */
export interface NotServedRecently {
  verdict: RecencyVerdict;
  /** The window's start — what "recently" meant. Shown so the figure is legible. */
  windowStart: Date;
  /** 🔴 EMPTY unless `verdict.complete`. Never a partial answer. */
  people: ServedRecord[];
  /** 🔴 The source, named in the type so the UI cannot describe it wrongly. */
  source: 'servicePlans';
}

export function notServedRecently(
  people: readonly { id: string; name: string }[],
  services: readonly RotaService[],
  read: RotaReadState,
  now: Date,
  windowDays: number = RECENT_WINDOW_DAYS,
): NotServedRecently {
  const windowStart = addDays(startOfDay(now), -windowDays);
  const verdict = recencyVerdict(read, windowStart);
  const base = { verdict, windowStart, source: 'servicePlans' as const };
  if (!verdict.complete) return { ...base, people: [] };

  const last = new Map<string, Date>();
  const next = new Map<string, Date>();
  for (const service of services) {
    const at = service.startsAt;
    if (at === null) continue;
    const past = at <= now;
    for (const item of service.items) {
      const id = item.personId;
      if (!id) continue;
      const bucket = past ? last : next;
      const held = bucket.get(id);
      // Past wants the LATEST; future wants the EARLIEST.
      if (!held || (past ? at > held : at < held)) bucket.set(id, at);
    }
  }

  return {
    ...base,
    people: people
      .map((p) => ({
        id: p.id,
        name: p.name,
        lastServedAt: last.get(p.id) ?? null,
        nextScheduledAt: next.get(p.id) ?? null,
      }))
      .filter((r) => r.lastServedAt === null || r.lastServedAt < windowStart)
      // Longest-unserved first, and never-served first of all: the top of the
      // list is where an admin looks, so it holds the people most overlooked.
      .sort((a, b) => {
        if (a.lastServedAt === null && b.lastServedAt === null) return a.name.localeCompare(b.name);
        if (a.lastServedAt === null) return -1;
        if (b.lastServedAt === null) return 1;
        return a.lastServedAt.getTime() - b.lastServedAt.getTime();
      }),
  };
}

/**
 * The items of `plan` with ONE item's person replaced — the whole of what an
 * assignment changes.
 *
 * 🔴 IT RETURNS PART 1'S ITEM SHAPE, FIELD FOR FIELD. No field is added, none is
 * dropped, and the write it feeds is part 1's own `saveServicePlanItems`. That
 * is what makes "the rota does not change #449's persisted data" true by
 * construction rather than by care.
 *
 * ⚠️ `personName` is denormalised BY PART 1 and is re-written here for part 1's
 * stated reason — a shared run sheet has no Firestore to resolve a name
 * through. Clearing an assignment nulls BOTH, so a stale label can never
 * outlive the id it labelled.
 */
export function assignPerson(
  items: readonly ServicePlanItem[],
  itemId: string,
  person: { id: string; name: string } | null,
): ServicePlanItem[] {
  return orderedItems(items).map((item) =>
    item.id === itemId
      ? { ...item, personId: person?.id ?? null, personName: person?.name ?? null }
      : item,
  );
}

/** A date label: "Sun 6 Sep". Locale-independent, for `fmtClock`'s reason. */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export const fmtDay = (d: Date | null): string =>
  d ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` : 'No date';

/** A week's own label — "Week of Sun 6 Sep". */
export const fmtWeek = (weekStart: Date): string => `Week of ${fmtDay(weekStart)}`;

/** How long ago, in whole days, as words. Null reads as never. */
export const fmtSince = (last: Date | null, now: Date): string => {
  if (last === null) return 'Has never served';
  const days = Math.max(0, Math.round((startOfDay(now).getTime() - startOfDay(last).getTime()) / 86_400_000));
  if (days === 0) return 'Served today';
  if (days === 1) return 'Served yesterday';
  if (days < 14) return `Served ${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `Served ${weeks} weeks ago`;
  return `Last served ${fmtDay(last)}`;
};
