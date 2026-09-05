/**
 * THE-317 — what a rota across several weeks COSTS to read, and why it is
 * affordable.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE READ COST, STATED PLAINLY: THREE QUERIES, TOTAL, FOR THE WHOLE ROTA —
 *    AND IT DOES NOT GROW WITH THE NUMBER OF WEEKS SHOWN.
 *
 *   1. the plans     `where('isTemplate','==',false)` + `limit(301)`   ≤ 301 docs
 *   2. the events    `useEvents` — already exists, `limit(100)`        ≤ 100 docs
 *   3. the people    `useServicePeople` — already exists, `limit(200)` ≤ 200 docs
 *
 * ⚠️ THE SHAPE THIS REPLACES, AND WHY IT WOULD HAVE BEEN THE WRONG ONE. The
 * obvious read is "for each week, for each event, fetch that event's plan" —
 * part 1's `useServicePlan(tenantId, eventId)`, called once per service. Six
 * weeks of two services is TWELVE queries for one screen, and it grows linearly
 * with the horizon: a church looking at a quarter pays fifty. Worse, twelve
 * react-query subscriptions is twelve independent loading and error states, and
 * a "has not served recently" figure folded over them could be silently missing
 * whichever ones happened to have failed — the exact failure this ticket's
 * exactness rule exists to prevent.
 *
 * So the plans are read ONCE, whole, and joined to the events IN MEMORY.
 * `rotaWeeks()` then slices that one set into as many weeks as the UI asks for,
 * at no read cost at all. Six weeks and sixty weeks are the same three queries.
 *
 * 🔴 WHAT WAS NOT AVAILABLE, AND WHY. A collection-group read over plans would
 * be the natural shape if plans were a subcollection of the event — and it is
 * DENIED OUTRIGHT: `firestore.rules` has ZERO `match /{path=**}/…` rules, so a
 * collection-group query against it is refused, not merely slow. THE-309 proved
 * that for form submissions, and it is exactly why #449 put plans in ONE
 * collection per tenant with an `eventId` FIELD. That decision is what makes
 * this ticket a single query instead of one aggregation per parent event. Part
 * 1 paid for part 2 here, deliberately, and this is the payoff.
 *
 * 🔴 NO COMPOSITE INDEX IS REQUIRED, AND NONE MAY BE. `firestore.indexes.json`
 * DOES NOT DEPLOY — `deploy-rules.yml` runs `firestore:rules,storage` only — so
 * an index added there is inert and the query that needed it throws
 * `failed-precondition` in production. The query below is ONE `where` on ONE
 * field with NO `orderBy`, which Firestore serves from an automatic single-field
 * index. Ordering is `rotaServices()`'s, in memory, per `query-helpers.ts`.
 *
 * ⚠️ AND NO `orderBy` ON A MIXED-TYPE FIELD ANYWHERE. `contactActivities
 * .createdAt` and `invoices.issuedAt` each hold BOTH ISO strings and
 * `Timestamp`s, and Firestore orders across types by TYPE FIRST — so
 * `orderBy('createdAt')` returns every string row before any Timestamp row.
 * Nothing in this feature reads either collection. The one `orderBy` a rota
 * relies on is `useEvents`' `orderBy('startDate','desc')`, and `startDate` is
 * written as a `Timestamp` by the single writer that produces it
 * (`AdminEvents.tsx`); `the-317-guards.test.ts` asserts that no ISO string is
 * ever written to it and that this feature adds no `orderBy` of its own.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE `firestore.rules` RULE THIS NEEDS IS STILL NOT WRITTEN. REPORTED, NOT
 *    DONE — AND IT IS THE SAME RULE #449 ALREADY REPORTED, UNCHANGED.
 *
 * `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE and CI runs no emulator
 * tests, so this ticket does not touch it either. The rule the collection needs
 * goes INSIDE `match /tenants/{tenantId}` beside the existing `events` block:
 *
 *     match /servicePlans/{planId} {
 *       allow read:  if belongsToTenant(tenantId);
 *       allow write: if hasPermission('manageEvents', tenantId);
 *     }
 *
 * ⚠️ THIS TICKET NEEDS NOTHING ADDED TO IT, AND THAT IS WORTH SAYING. The rota's
 * read is an UNFILTERED LIST of the same collection (`where('isTemplate','==',
 * false)`), and neither half of that rule reads `resource.data`, so a list is
 * accepted as written. The write is part 1's own `saveServicePlanItems`, under
 * `manageEvents`, which the admin doing the rota already holds. So the rule
 * above is sufficient for both parts 1 and 2, and part 3 should deploy exactly
 * it. `the-317-guards.test.ts` pins `firestore.rules` byte-for-byte.
 *
 * ⚠️ UNTIL IT DEPLOYS, EVERY READ HERE IS `permission-denied` — and the rota
 * SAYS SO rather than rendering an empty week grid. See `recencyVerdict`.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHERE THE PEOPLE COME FROM: `users`, VIA PART 1'S OWN `useServicePeople`.
 *
 * Not a second query, not a second collection, and not a second opinion: this
 * module RE-EXPORTS part 1's hook rather than spelling `where('tenantId','==',t)`
 * against `users` again. `users` and `contacts` are different collections with
 * different meanings, #449 chose `users`, and a rota that resolved names from
 * `contacts` while part 1 stored `users/{uid}` on the item would show the wrong
 * name for anybody whose CRM row was folded by `mergeContactsWithUsers` — the
 * ambiguity THE-299 found. One collection, one hook, one identity.
 */
import { useQuery } from '@tanstack/react-query';
import { getDocs, limit, query, where } from 'firebase/firestore';

import { readPlan, servicePlansRef } from './useServicePlanQueries';
import type { ServicePlan } from '../../components/events/service-plan';

export {
  saveServicePlanItems,
  useServicePeople,
  type ServicePerson,
} from './useServicePlanQueries';

/**
 * The ceiling on the plan read, and the honest thing to say about it.
 *
 * ⚠️ IT IS A REAL CEILING AND THE CODE TREATS IT AS ONE. 300 non-template plans
 * is roughly six years of weekly services, so no church reaches it soon — but
 * "soon" is not "never", and a ceiling nobody checks is how a figure becomes
 * quietly wrong at exactly the churches that have used the product longest.
 *
 * 🔴 SO THE READ ASKS FOR ONE MORE THAN IT KEEPS. `limit(301)` returning 301
 * rows PROVES there are more than 300; returning 300 or fewer proves there are
 * not. That is the difference between knowing the read was complete and
 * assuming it — and `recencyVerdict` refuses to show a figure when it was not.
 */
export const ROTA_PLAN_LIMIT = 300;

/**
 * 🔴 `useEvents`' OWN CEILING, SPELLED HERE SO IT CANNOT DRIFT.
 *
 * `useEvents` takes `limit(100)`, and this feature's completeness proof depends
 * on knowing that number: an event read returning exactly 100 rows MIGHT be
 * truncated, and one returning 99 certainly is not. If somebody raised that
 * limit and this constant stayed at 100, the rota would start calling a
 * complete read truncated — pessimistic, and merely annoying. If somebody
 * LOWERED it, the rota would call a truncated read complete, and ship a wrong
 * list of names. `the-317-guards.test.ts` reads `useEventQueries.ts` and asserts
 * the two agree, so neither can move alone.
 */
export const EVENTS_READ_LIMIT = 100;

/** The one key this feature owns. Part 1's keys are its own and are untouched. */
export const rotaKeys = {
  plans: (tenantId: string | null) => ['rotaPlans', tenantId] as const,
};

/** What one plan read came back as, INCLUDING whether it was complete. */
export interface RotaPlansRead {
  plans: ServicePlan[];
  /** 🔴 True when the collection holds more plans than the read returned. */
  truncated: boolean;
}

/**
 * Every plan that is not a template, in one query.
 *
 * ⚠️ `where('isTemplate','==',false)` rather than reading everything and
 * filtering: a template has no event and so no date, so it can never appear on
 * a rota, and excluding it server-side means a church's template library does
 * not eat into the ceiling above. `isTemplate` IS written by
 * `createServicePlan` (part 1 writes it precisely so its own templates query can
 * filter server-side), and `readPlan` still derives the value it returns from
 * `eventId` — so a document whose stored flag disagreed with its `eventId` is
 * excluded from the rota rather than shown wrongly on it.
 *
 * 🔴 NOT SWALLOWED ON FAILURE. A rejected read that returned `[]` would render
 * an empty rota, which is indistinguishable from a church that has planned
 * nothing — `useCRMQueries`' #236 silent-truncation class, and the one this
 * ticket names as `Form submissions 0`. The rejection propagates and the panel
 * renders it.
 */
export const useRotaPlans = (tenantId: string | null | undefined) =>
  useQuery({
    queryKey: rotaKeys.plans(tenantId ?? null),
    queryFn: async (): Promise<RotaPlansRead> => {
      if (!tenantId) return { plans: [], truncated: false };
      const snap = await getDocs(
        query(
          servicePlansRef(tenantId),
          where('isTemplate', '==', false),
          limit(ROTA_PLAN_LIMIT + 1),
        ),
      );
      const docs = snap.docs;
      return {
        truncated: docs.length > ROTA_PLAN_LIMIT,
        plans: docs.slice(0, ROTA_PLAN_LIMIT).map((d) => readPlan(d.id, d.data())),
      };
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
  });
