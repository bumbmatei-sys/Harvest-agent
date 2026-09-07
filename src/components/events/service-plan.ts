/**
 * THE-313 — the order of service, part 1 of 3.
 *
 * The founder's ask, and the marketing site's own words for it: "An order of
 * service your team plans together — songs, people, timings — instead of a
 * document somebody emails round on Thursday."
 *
 * This module is the whole of that feature that is NOT React and NOT Firestore:
 * the shape of a plan, the arithmetic that turns durations into clock times,
 * the reorder, and the text a run sheet is shared as. It is a plain module on
 * purpose — every one of these is a question part 2 (volunteer rotas) has to
 * ask WITHOUT rendering anything, and a rule that lives inside a component can
 * only be re-implemented by the ticket that comes after it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 THE ITEM SHAPE IS A CONTRACT WITH PART 2, AND HERE IS HOW IT ATTACHES.
 *
 * Part 2 assigns people to the items defined here, across weeks, with a
 * "hasn't served recently" view and double-booking warnings. Three properties
 * of {@link ServicePlanItem} are what make that possible without changing this
 * shape, and each is a decision rather than an accident:
 *
 *   1. `id` IS STABLE AND INDEPENDENT OF POSITION. It is generated once when
 *      the item is created and never re-derived from an array index. `order`
 *      moves; `id` does not. So a rota row in part 2 keys on `(planId, itemId)`
 *      and survives every reorder this ticket ships — which an index-keyed
 *      assignment would not.
 *
 *   2. `personId` IS ALREADY THE IDENTITY A ROTA ASSIGNS — a `users/{uid}` doc
 *      id, i.e. the Firebase auth uid (see `useServicePlanQueries.ts` for why
 *      that collection and not `contacts`). Part 2's "hasn't served recently"
 *      is a fold over these ids across plans; part 3's invite-and-accept needs
 *      an identity that can sign in and accept. Both are this field, unchanged.
 *
 *   3. THE TIMING IS A PURE FUNCTION, NOT A RENDER. {@link itemClockTimes}
 *      hands back every item's start and end as real `Date`s, so part 2 can
 *      detect a double-booking — the same person on two items whose clock
 *      ranges overlap — by calling it, with no component mounted. That is what
 *      {@link findDoubleBookings} below is: written now, in the ticket that
 *      owns the arithmetic, rather than re-derived in the ticket that needs it.
 *      ⚠️ It takes MANY plans, because within one plan the items are laid end
 *      to end and a clash is impossible by construction — see its own note.
 *
 * ⚠️ Deliberately absent, and named so a later ticket does not read the absence
 * as an oversight: a song library, CCLI numbers, chord charts, rehearsal
 * scheduling and availability blockouts. The marketing site says the product
 * does not have them, they are months of work, and CCLI is a legal reporting
 * obligation rather than a field.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 AN ITEM HAS NO `type`, AND THAT IS THE DECISION, NOT THE DEFAULT.
 *
 * The obvious shape is an enum — song / sermon / notice / prayer — and it is
 * wrong here. A fixed list is a claim about how every church runs a service,
 * and this product's tenants do not agree: a liturgical parish's run sheet says
 * Collect, Creed, Intercessions, Eucharist; a Pentecostal one says Prophetic
 * Ministry and Altar Call; a church plant in a school hall says Set Up and
 * Pack Down. An enum that does not contain a church's own words either forces
 * "Other" onto half its rows — at which point the title carries the meaning and
 * the type carries nothing — or grows until it is free text with extra steps.
 *
 * A type would also have to LOOK like something: an icon or a colour per value,
 * which is a palette decision this ticket is forbidden from making, in a repo
 * with four palettes and a hard "hardcode no colour" rule.
 *
 * And nothing downstream needs it. Part 2 groups by PERSON, not by kind of
 * item; part 3 reminds a person about an item by its title. So the title is
 * free text, `title` is the whole of what an item is called, and if a later
 * ticket finds a real consumer for a type it can add an optional field without
 * migrating a single document.
 */
import type { Timestamp } from 'firebase/firestore';

/**
 * One row of the run sheet.
 *
 * 🔴 EVERY OPTIONAL FIELD IS `| null`, NEVER `undefined`. Firestore rejects an
 * `undefined` value outright, and the repo has already paid for that once —
 * `TicketType.description` carries the same `null (never undefined) so
 * Firestore accepts the write` note in `useEventQueries.ts`.
 */
export interface ServicePlanItem {
  /** Client-generated, stable for the life of the item. See the header. */
  id: string;
  /** What this part of the service is called. Free text; see the header. */
  title: string;
  /** How long it runs, in whole minutes. The only thing clock times derive from. */
  minutes: number;
  /**
   * 🔴 THE SEQUENCE, AND THE REASON THERE IS NO FIRESTORE `orderBy` ANYWHERE
   * IN THIS FEATURE. #405 found 41 files taking an unordered `limit(N)` and
   * calling the arbitrary rows it returns "the recent ones". Ordering a run
   * sheet by a timestamp would be the same mistake wearing a different hat: the
   * order of a service is not the order its rows were typed in, and a plan
   * whose items sorted by `createdAt` would reshuffle itself the moment an
   * admin inserted a forgotten notice in the middle.
   *
   * 0-based and contiguous after every mutation — {@link renumber} is the only
   * thing that writes it, and every reorder goes through it.
   */
  order: number;
  /** A `users/{uid}` doc id, or null for an unassigned item. */
  personId: string | null;
  /**
   * The person's display name AT THE TIME OF ASSIGNMENT.
   *
   * ⚠️ Denormalised deliberately. A run sheet is read on a phone at 9am on a
   * Sunday and printed on Saturday night; resolving 20 names through 20
   * document reads to render one card is the wrong shape, and a shared or
   * copied run sheet has no Firestore at all. `personId` stays the identity —
   * this is only the label, and it is re-written whenever the person changes.
   */
  personName: string | null;
  /** A line of detail: a key, a passage, a reminder. Free text or null. */
  note: string | null;
}

/**
 * A plan, a standalone service, or a template. ONE model, THREE inhabitants.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE-329 REPLACED THE TWO-WAY INVARIANT WITH A THREE-WAY ONE. HERE IS WHY.
 *
 * THE-313 shipped `isTemplate === (eventId === null)` and THE-326 kept it. The
 * founder's complaint is what that costs: "If I have no event created, I cannot
 * create any service, which is stupid." He is right. A Sunday service is the
 * week's rhythm, not something a church advertises, and requiring a public
 * event record before one can be planned is backwards.
 *
 * The field that would carry a standalone service already existed — `eventId`
 * was already `string | null` — and the INVARIANT was the whole of what stood
 * in the way: a plan with no event was, by that rule, a template. So the
 * invariant moved rather than the data.
 *
 * ⚠️ A PLAN NOW HAS TWO NULLABLE ANCHORS, AND THE PAIR IS THE KIND:
 *
 *     eventId ≠ null                  → an EVENT-ANCHORED service  (unchanged)
 *     eventId = null, startAt ≠ null  → a STANDALONE service       (new)
 *     eventId = null, startAt = null  → a TEMPLATE                 (unchanged)
 *
 * {@link planKind} is that table, spelled once. {@link isTemplateShape} keeps
 * its name and its job — it now asks whether the stored flag agrees with the
 * three-way kind instead of the two-way one.
 *
 * 🔴 AND THAT IS WHY NO MIGRATION IS NEEDED, WHICH IS THE POINT OF SHAPING IT
 * THIS WAY. Every document already in a church's database has NO `startAt`
 * field at all, so it reads as `null`:
 *
 *   · an existing template   — `eventId: null`, `startAt` absent → TEMPLATE.
 *   · an existing plan       — `eventId: 'evt-1'`               → EVENT-ANCHORED.
 *
 * Both land in exactly the state they already occupied. The third state is
 * reachable only by a write this ticket adds, so a half-migrated tenant — the
 * failure mode a migration would risk — cannot exist: there is nothing to
 * migrate and no window in which some documents are converted and others are
 * not.
 *
 * ⚠️ THE EVENT LINK IS NOT DELETED, IT IS DEMOTED. A church running a Christmas
 * carol service genuinely wants it both planned AND advertised, so `eventId`
 * still anchors a plan and still wins when it is present. What stopped being
 * true is that it is REQUIRED.
 */
export interface ServicePlan {
  id: string;
  tenantId: string;
  /**
   * The event this plan runs, or null.
   *
   * 🔴 NO LONGER "null means template" — see {@link planKind}. Null now means
   * "not anchored to an event", which a standalone service and a template both
   * are; {@link ServicePlan.startAt} is what tells those two apart.
   */
  eventId: string | null;
  /**
   * 🔴 THE SERVICE'S OWN START — the field THE-329 adds, and the only one.
   *
   * Non-null EXACTLY for a standalone service. An event-anchored plan leaves it
   * null and takes its clock from the event, unchanged, because two copies of
   * one start are two things to keep true and they would disagree the first
   * time somebody moved the service by half an hour. A template leaves it null
   * because a template has no date by definition.
   *
   * ⚠️ A `Timestamp`, never an ISO string and never an epoch number. This
   * feature has ONE date representation — see {@link ServicePlan.createdAt}.
   */
  startAt: Timestamp | null;
  /** What the plan is called. A template's name is the church's own ("Sunday Morning"). */
  name: string;
  /** True exactly when the plan is a template. {@link isTemplateShape} is the invariant. */
  isTemplate: boolean;
  items: ServicePlanItem[];
  /**
   * 🔴 ONE TIMESTAMP REPRESENTATION, AND IT IS `Timestamp`.
   *
   * ⚠️ Mixed timestamp types are a recurring defect in this repo:
   * `invoices.issuedAt` and `contactActivities.createdAt` each hold BOTH ISO
   * strings and Timestamps depending on which writer got there, and Firestore
   * sorts across types by TYPE FIRST — so a collection holding both is not
   * merely untidy, it is unsortable. Every write in this feature goes through
   * `serverTimestamp()` and nothing in it ever calls `toISOString()`,
   * `Date.now()` or `String(date)` into a document. The guards assert that by
   * reading the source.
   *
   * A CLOCK TIME IS NOT STORED AT ALL — see {@link itemClockTimes}. That is the
   * other half of the same decision: a stored clock time would be a second
   * representation of the same fact, and it would be the stale one the moment a
   * duration above it changed.
   */
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/**
 * A cap, so one plan cannot become a document Firestore refuses.
 *
 * The items live in an ARRAY on the plan document rather than in a
 * subcollection — the same shape `Event.ticketTypes` already uses, and for the
 * same reason: the whole run sheet is read, reordered and written as ONE unit,
 * so a subcollection would buy a read per row and an ordering problem, and buy
 * nothing back. 60 rows of this shape is roughly 6KB against Firestore's 1MB
 * document limit; the cap exists to bound the UI, not the storage.
 */
export const MAX_PLAN_ITEMS = 60;

/** What a new row's duration starts at. A five-minute notice is the median row. */
export const DEFAULT_ITEM_MINUTES = 5;

/** The longest a single item may be told it runs. Twelve hours; a guard, not a rule. */
export const MAX_ITEM_MINUTES = 720;

/**
 * A client-side id.
 *
 * ⚠️ The SAME generator `AdminEvents.tsx` already spells for ticket types and
 * discount codes — `uuid` is not a dependency of this repo and this ticket does
 * not add one.
 */
export const genItemId = (): string =>
  Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** A blank row, at the end of the list it is being added to. */
export const emptyItem = (order: number): ServicePlanItem => ({
  id: genItemId(),
  title: '',
  minutes: DEFAULT_ITEM_MINUTES,
  order,
  personId: null,
  personName: null,
  note: null,
});

/** A duration coerced to a whole, in-range number of minutes. */
export const clampMinutes = (v: unknown): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_ITEM_MINUTES);
};

/**
 * `order` rewritten as 0..n-1 in the array's current order.
 *
 * The single writer of the field. Every mutation below ends here, so a plan
 * whose items have duplicate or gapped `order` values cannot be produced by
 * this module — which is what lets {@link orderedItems} be a plain sort.
 */
export const renumber = (items: readonly ServicePlanItem[]): ServicePlanItem[] =>
  items.map((item, i) => (item.order === i ? item : { ...item, order: i }));

/**
 * 🔴 THE ITEMS IN THEIR OWN ORDER — the whole of how this feature sequences.
 *
 * Reading a plan applies this to whatever Firestore hands back. There is no
 * `orderBy` in the query and there cannot be one: `items` is a field on a
 * single document, so Firestore never sees the rows at all.
 *
 * The tie-break on `id` is not decoration. Two items sharing an `order` can
 * only arrive from a document this module did not write, and an unstable sort
 * over them would make the run sheet reshuffle between renders.
 */
export const orderedItems = (items: readonly ServicePlanItem[]): ServicePlanItem[] =>
  [...items].sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));

/**
 * The list with the item at `from` moved to `to`, renumbered.
 *
 * ⚠️ The splice is `AdminCourseEditor`'s `reordered`, unchanged — the same two
 * lines #413 settled on for the curriculum. Only the renumbering is new, and it
 * is new because a lesson's position IS its array index there, whereas here the
 * position is a persisted field.
 */
export function reorderItems(
  items: readonly ServicePlanItem[],
  from: number,
  to: number,
): ServicePlanItem[] {
  const list = orderedItems(items);
  if (from === to) return list;
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return renumber(next);
}

/**
 * 🔴 THE KEYBOARD REORDER. One position, up or down, from the item's own handle.
 *
 * A reorder that only works by mouse is unusable on this product's primary
 * platform — an admin on a phone has no drag affordance worth the name, and a
 * keyboard user has none at all. So this is not a fallback bolted beside the
 * drag: it is the same {@link reorderItems} the drag commits through, reached
 * by ArrowUp / ArrowDown on the handle button. See `ServicePlanPanel.tsx` for
 * the focus half.
 *
 * Out of range is a NO-OP returning the same order, not a wrap: the first item
 * pressing Up must stay first, or a run sheet reorders itself by accident at
 * the two positions a user is most likely to hold a key down on.
 */
export const moveItem = (
  items: readonly ServicePlanItem[],
  index: number,
  delta: -1 | 1,
): ServicePlanItem[] => {
  const list = orderedItems(items);
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  return reorderItems(list, index, to);
};

/** The whole service, in minutes. */
export const planTotalMinutes = (items: readonly ServicePlanItem[]): number =>
  orderedItems(items).reduce((sum, item) => sum + clampMinutes(item.minutes), 0);

/** One row's place on the clock. Nothing here is ever stored. */
export interface ItemClock {
  item: ServicePlanItem;
  /** Minutes from the service start to this item's start. */
  offsetMinutes: number;
  /** Wall-clock start, or null when the event has no start time yet. */
  startsAt: Date | null;
  /** Wall-clock end. Null for the same reason. */
  endsAt: Date | null;
}

/**
 * 🔴 THE FEATURE. Every item's clock time, derived from the service start plus
 * the durations of the items BEFORE it.
 *
 * ⚠️ This is why the run sheet is worth building at all. A church's current
 * order of service is a document somebody emails round on Thursday, and the
 * thing that document cannot do is recalculate: move the notices from four
 * minutes to seven and every time after them is wrong, silently, on the copy
 * in twenty people's inboxes. Here there is nothing to recalculate BECAUSE
 * nothing downstream is stored — a clock time is a function of the durations
 * above it, computed at read time, so changing one duration moves everything
 * after it and cannot fail to.
 *
 * `start` is the EVENT's `startDate`, which is already a `Timestamp` on the
 * event document. A plan does not carry a start time of its own: a second copy
 * of the event's start is a second thing to keep true, and the two would
 * disagree the first time somebody moved the service by half an hour.
 *
 * A null `start` (an event saved without a date) yields offsets and no clocks,
 * rather than throwing or inventing a start. The panel renders the offsets.
 */
export function itemClockTimes(
  items: readonly ServicePlanItem[],
  start: Date | null,
): ItemClock[] {
  let offset = 0;
  return orderedItems(items).map((item) => {
    const minutes = clampMinutes(item.minutes);
    const startsAt = start ? new Date(start.getTime() + offset * 60_000) : null;
    const endsAt = start ? new Date(start.getTime() + (offset + minutes) * 60_000) : null;
    const clock: ItemClock = { item, offsetMinutes: offset, startsAt, endsAt };
    offset += minutes;
    return clock;
  });
}

/**
 * The clock time a service ENDS at — the start plus every duration.
 * Null when the event has no start, for the same reason as above.
 */
export const planEndsAt = (items: readonly ServicePlanItem[], start: Date | null): Date | null =>
  start ? new Date(start.getTime() + planTotalMinutes(items) * 60_000) : null;

/** One plan on the clock, as part 2 will hand a week's worth of them in. */
export interface ScheduledPlan {
  planId: string;
  items: readonly ServicePlanItem[];
  /** The plan's EVENT start. A plan with none cannot be placed on a clock. */
  start: Date | null;
}

/** Two items the same person is booked for at the same moment, in two plans. */
export interface DoubleBooking {
  personId: string;
  a: { planId: string; item: ServicePlanItem; startsAt: Date; endsAt: Date };
  b: { planId: string; item: ServicePlanItem; startsAt: Date; endsAt: Date };
}

/**
 * 🔴 WRITTEN FOR PART 2, IN THE TICKET THAT OWNS THE ARITHMETIC.
 *
 * Part 2 is "volunteer rotas across weeks, with a hasn't-served-recently view
 * and double-booking warnings". The warning is a question about the CLOCK, and
 * the clock is this module's — so it is written here, once, rather than
 * re-derived by the ticket that needs it. Nothing in part 1's UI calls it.
 *
 * ⚠️ IT TAKES MANY PLANS, NOT ONE, AND THAT IS THE WHOLE POINT. Within a SINGLE
 * plan a double booking is impossible by construction: {@link itemClockTimes}
 * lays items end to end, so the same person on two rows of one run sheet is
 * doing two things IN A ROW, which is normal and must never warn. A real clash
 * is Ben leading worship at the 9am AND reading at the 10:30 that overruns into
 * it — two plans, two events, one person, overlapping clocks. So this folds
 * every plan's clocks together and compares across them.
 *
 * Adjacency is not an overlap: an item ending at 10:15 and another starting at
 * 10:15 is a person walking off one stage and onto the next. Zero-minute items
 * occupy no clock time and therefore clash with nothing.
 *
 * A plan with no start is SKIPPED rather than guessed at — an undated event has
 * no position on a week's clock, so it cannot be shown to conflict with one.
 */
export function findDoubleBookings(plans: readonly ScheduledPlan[]): DoubleBooking[] {
  const placed = plans.flatMap((plan) =>
    plan.start === null
      ? []
      : itemClockTimes(plan.items, plan.start)
          .filter((c) => c.item.personId && c.startsAt && c.endsAt)
          .map((c) => ({
            planId: plan.planId,
            item: c.item,
            startsAt: c.startsAt as Date,
            endsAt: c.endsAt as Date,
          })),
  );

  const out: DoubleBooking[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.item.personId !== b.item.personId) continue;
      // 🔴 Same plan is never a clash — its items are laid end to end.
      if (a.planId === b.planId) continue;
      if (a.startsAt < b.endsAt && b.startsAt < a.endsAt) {
        out.push({ personId: a.item.personId as string, a, b });
      }
    }
  }
  return out;
}

/**
 * 🔴 WHAT A PLAN IS, AS ONE WORD. THE-329's replacement for the two-way rule.
 *
 * ⚠️ THE ORDER OF THE TWO TESTS IS THE DECISION, NOT AN IMPLEMENTATION DETAIL.
 * `eventId` is asked FIRST, so a plan that somehow carried both an event and a
 * start of its own is an EVENT-ANCHORED service and takes the event's clock.
 * That keeps THE-313's rule intact — "a plan carries no start of its own; every
 * clock time is the event's start plus the durations above it" — for every plan
 * that has an event, which is every plan a church has today. A church that
 * attaches a standalone service to an event afterwards gets the event's date
 * from that moment, and there is never a second copy of the start to disagree
 * with the first.
 *
 * ⚠️ DERIVED, NEVER STORED. There is no `kind` field on the document, for the
 * reason `readPlan` already derives `isTemplate` rather than trusting it: a
 * stored discriminator that disagreed with the fields it discriminates is a
 * silent lie, and a stored enum would need a migration to introduce. Two
 * nullable anchors carry the same information and every document already in a
 * church's database answers this function correctly without being touched.
 */
export type ServicePlanKind = 'event' | 'standalone' | 'template';

export const planKind = (
  plan: Pick<ServicePlan, 'eventId' | 'startAt'>,
): ServicePlanKind => {
  if (plan.eventId !== null) return 'event';
  return plan.startAt !== null ? 'standalone' : 'template';
};

/** True for the two kinds a church can actually put people on a rota for. */
export const isScheduledService = (plan: Pick<ServicePlan, 'eventId' | 'startAt'>): boolean =>
  planKind(plan) !== 'template';

/**
 * The invariant that keeps ONE model from becoming three: template ⇔ no anchor.
 *
 * 🔴 WHAT IT USED TO SAY, AND WHAT IT SAYS NOW. THE-313 wrote
 * `isTemplate === (eventId === null)`, and THE-326 recorded that as the reason a
 * service could not exist without an event. It now reads
 * `isTemplate === (planKind(plan) === 'template')` — the same job against a
 * three-way kind, so a standalone service (`eventId: null`, `startAt` set) is no
 * longer indistinguishable from a template.
 *
 * ⚠️ It is still the ONE rule that tells a template apart, and it still fails
 * loudly for a document whose stored flag disagrees with its anchors. What
 * changed is which documents it calls templates, and no document that exists
 * today changes side: a template has neither anchor and still answers `true`.
 */
export const isTemplateShape = (
  plan: Pick<ServicePlan, 'eventId' | 'isTemplate' | 'startAt'>,
): boolean => plan.isTemplate === (planKind(plan) === 'template');

/**
 * 🔴 A TEMPLATE'S ITEMS, MADE INTO A PLAN'S — WITHOUT THE PEOPLE OR THE DATE.
 *
 * "A template is the item list without the people or the date" is the ticket's
 * own definition, and this is the function that makes it true rather than a
 * convention someone has to remember. Every item gets:
 *
 *   · a FRESH `id`. The plan's items are not the template's items — they are
 *     new rows that happen to start with the same titles. Sharing an id would
 *     make part 2's `(planId, itemId)` assignment ambiguous the moment a second
 *     plan was started from the same template.
 *   · `personId: null` and `personName: null`, unconditionally. A template that
 *     carried a person would roster the same volunteer every week for ever, by
 *     default, invisibly.
 *
 * The DATE is absent by construction: an item has no date field at all, and a
 * plan's clock comes from its event. There is nothing to strip.
 */
export function itemsFromTemplate(items: readonly ServicePlanItem[]): ServicePlanItem[] {
  return renumber(
    orderedItems(items).map((item) => ({
      id: genItemId(),
      title: item.title,
      minutes: clampMinutes(item.minutes),
      order: item.order,
      personId: null,
      personName: null,
      note: item.note ?? null,
    })),
  );
}

/**
 * 🔴 THE ANCHOR A SERVICE HANGS ON — an event, or a date of its own.
 *
 * ⚠️ A DISCRIMINATED UNION RATHER THAN TWO NULLABLE ARGUMENTS, so "a service
 * with neither" and "a service with both" are not expressible at the call site
 * at all. The two-anchor shape on the document is what the STORAGE needs
 * (nothing migrates, and Firestore has no unions); this is what a CALLER needs,
 * and the two are bridged in exactly one place — {@link servicePlanFields}.
 */
export type ServiceAnchor =
  | { kind: 'event'; eventId: string }
  | { kind: 'standalone'; startAt: Timestamp };

/**
 * The fields any non-template plan is created with, whatever it is anchored to.
 *
 * The ONE bridge between {@link ServiceAnchor} and the two nullable fields the
 * document carries, so no other caller ever spells `eventId: null, startAt: x`
 * by hand and gets the pair wrong.
 */
export function servicePlanFields(
  tenantId: string,
  name: string,
  items: readonly ServicePlanItem[],
  anchor: ServiceAnchor,
): Omit<ServicePlan, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    tenantId,
    eventId: anchor.kind === 'event' ? anchor.eventId : null,
    startAt: anchor.kind === 'standalone' ? anchor.startAt : null,
    name,
    isTemplate: false,
    items: renumber(orderedItems(items)),
  };
}

/**
 * The fields a plan started from `template` is created with.
 *
 * ⚠️ THE SIGNATURE IS UNCHANGED — an event id, positionally, exactly as THE-313
 * wrote it — because an event-anchored plan started from a template is what it
 * always was and THE-313's own suite calls this by that shape. A standalone
 * service reaches the same place through {@link servicePlanFields} with a
 * standalone anchor, which is the union's whole point.
 */
export function planFromTemplate(
  template: Pick<ServicePlan, 'name' | 'items'>,
  eventId: string,
  tenantId: string,
): Omit<ServicePlan, 'id' | 'createdAt' | 'updatedAt'> {
  return servicePlanFields(
    tenantId,
    template.name,
    itemsFromTemplate(template.items),
    { kind: 'event', eventId },
  );
}

/** The fields a template saved FROM a plan is created with. People stripped, both ways. */
export function templateFromPlan(
  plan: Pick<ServicePlan, 'items'>,
  name: string,
  tenantId: string,
): Omit<ServicePlan, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    tenantId,
    eventId: null,
    // 🔴 NEITHER ANCHOR. That is what makes it a template under `planKind`, and
    // it is the same document THE-313 wrote — a template gains no field here.
    startAt: null,
    name: name.trim(),
    isTemplate: true,
    items: itemsFromTemplate(plan.items),
  };
}

/**
 * A wall-clock label. 24-hour, zero-padded, locale-independent.
 *
 * ⚠️ NOT `toLocaleTimeString`. A run sheet is compared against a printed copy
 * and read aloud on a stage; two admins on two locales must see the same
 * string, and `en-US` would render "9:00 AM" where the church's own printed
 * sheet says "09:00". `AdminEvents.tsx` uses `toLocaleDateString` for a DATE,
 * where the ambiguity is between formats a reader can tell apart; a time is
 * not that.
 */
export const fmtClock = (d: Date | null): string =>
  d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '--:--';

/** A duration label: "45 min", "1h 05". */
export const fmtDuration = (minutes: number): string => {
  const m = clampMinutes(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`;
};

/**
 * 🔴 THE RUN SHEET AS PLAIN TEXT — the whole of the share payload.
 *
 * ⚠️ IT CONTAINS NO URL, AND THAT IS THE POINT.
 *
 * The ticket forbids reusing `giving-share.ts`'s URL builder or loosening its
 * host validation, and the cleanest way to honour that is for this payload to
 * have nothing for either to be asked about: a run sheet is the sheet, not a
 * link to it. `givingShareUrls()` over this payload would return an empty list
 * because there is nothing in it to return. Nothing here imports
 * `giving-share.ts`, `giving-providers.ts` or `HARVEST_APEX`, and the guards
 * assert that by reading the source.
 *
 * The MECHANISM this text is handed to is the one `GivingShareSheet.tsx`
 * already established and this feature reuses in shape rather than in code:
 * `navigator.share` when the browser has it (feature-detected in an effect,
 * never during render), and a clipboard copy that is always rendered and never
 * conditional. A print stylesheet was the alternative and was not taken — it
 * would be new global CSS applying to every screen in the app, and the audience
 * for a run sheet is a phone held at the side of a stage on a Sunday morning,
 * which is the surface `navigator.share` is for. A church that wants paper
 * pastes this into anything that prints.
 */
export function buildRunSheetText(
  planName: string,
  items: readonly ServicePlanItem[],
  start: Date | null,
): string {
  const clocks = itemClockTimes(items, start);
  const lines: string[] = [planName.trim() || 'Order of service'];

  if (start) {
    lines.push(`Starts ${fmtClock(start)} · ${fmtDuration(planTotalMinutes(items))} total`);
  } else {
    lines.push(`${fmtDuration(planTotalMinutes(items))} total`);
  }
  lines.push('');

  if (clocks.length === 0) {
    lines.push('No items yet.');
    return lines.join('\n');
  }

  for (const { item, startsAt, offsetMinutes } of clocks) {
    const when = startsAt ? fmtClock(startsAt) : `+${offsetMinutes} min`;
    const parts = [`${when}  ${item.title.trim() || 'Untitled item'}`, `(${fmtDuration(item.minutes)})`];
    if (item.personName) parts.push(`- ${item.personName}`);
    lines.push(parts.join(' '));
    if (item.note) lines.push(`      ${item.note}`);
  }

  const ends = planEndsAt(items, start);
  if (ends) lines.push('', `Ends ${fmtClock(ends)}`);
  return lines.join('\n');
}
