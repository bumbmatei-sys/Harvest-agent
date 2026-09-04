/**
 * THE-313 — where a service plan lives, and where its people come from.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 1. WHERE THE PLAN LIVES: `tenants/{tenantId}/servicePlans/{planId}`,
 *       WITH AN `eventId` FIELD — NOT A SUBCOLLECTION OF THE EVENT.
 *
 * The ticket asks the question directly, and the repo has already answered it
 * once at cost. THE-309 proved a subcollection cannot be COUNTED here: a count
 * across every event's plans is a collection-group query, `firestore.rules` has
 * ZERO `match /{path=**}/…` rules, and a collection-group read against rules
 * with no recursive match is DENIED OUTRIGHT — not slow, denied. The only way
 * left is one `getCountFromServer()` per parent event, so a dashboard widget
 * asking "how many services has this church planned" would cost one aggregation
 * per event, for ever, growing with the church.
 *
 * ⚠️ THE CONSEQUENCE OF THE CHOICE MADE HERE, STATED PLAINLY: because plans sit
 * in ONE collection per tenant, that same future count is a SINGLE
 * `getCountFromServer(collection(db, 'tenants', t, 'servicePlans'))` — two
 * reads for a two-thousand-plan church, the same shape `useCRMQueries.ts`
 * already uses for the honest contact total. Nothing about this choice is free,
 * though, and the price is named too: the tenant is no longer in the PATH for
 * the plan's relationship to its event, so "the plans of THIS event" is a
 * `where('eventId', '==', …)` that rules must be written to accept on a LIST.
 * That is a single-field filter, so the read rule below can be tenant-wide
 * (`belongsToTenant`) and never touch `resource.data` — the same reasoning the
 * `adoptedCourses` block already records for why IT is a subcollection.
 *
 * 🔴 2. NO COMPOSITE INDEX IS REQUIRED, AND NONE MAY BE.
 *
 * `firestore.indexes.json` DOES NOT DEPLOY on merge — `deploy-rules.yml` runs
 * `firestore:rules,storage` only and its `paths:` filter excludes the indexes
 * file — so an index added there is inert and the query that needs it throws
 * `failed-precondition` in production. Every query in this module is therefore
 * a SINGLE `where` on ONE field with NO `orderBy`, which Firestore serves from
 * an automatic single-field index:
 *
 *     the plan for an event   where('eventId',   '==', eventId)   + limit
 *     the templates           where('isTemplate','==', true)      + limit
 *
 * ⚠️ And no `orderBy` anywhere, for a second reason on top of the index one:
 * `ServicePlanItem.order` sequences the run sheet, and the items are a FIELD on
 * one document, so Firestore never sees a row to order. #405 found 41 files
 * treating an unordered `limit(N)` as "the recent ones"; the ordering here is
 * done in memory by `orderedItems`, which is the pattern `query-helpers.ts`
 * exists to make normal.
 *
 * 🔴 3. THE `firestore.rules` RULE THIS NEEDS IS NOT WRITTEN. STOP CONDITION 2.
 *
 * `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE and CI runs no emulator
 * tests, so this ticket does not touch it. The rule the collection needs, for
 * the ticket that deploys it, goes INSIDE `match /tenants/{tenantId}` beside
 * the existing `events` block and reads exactly:
 *
 *     match /servicePlans/{planId} {
 *       allow read:  if belongsToTenant(tenantId);
 *       allow write: if hasPermission('manageEvents', tenantId);
 *     }
 *
 * The write half is `events`' own permission verbatim — planning a service is
 * the same authority as running the event it belongs to, and inventing a
 * `manageServices` permission would add a claim to the roles screen this ticket
 * does not own. The read half is NARROWER than `events`' (`isAuthenticated()`):
 * a run sheet names volunteers, so it is tenant-member material rather than
 * any-signed-in-user material, and `belongsToTenant` is the helper that already
 * says so for `forms`. Neither half reads `resource.data`, so an unfiltered
 * LIST of the collection is accepted and the `where('eventId', …)` above needs
 * nothing further.
 *
 * ⚠️ UNTIL THAT RULE DEPLOYS, EVERY READ AND WRITE HERE IS `permission-denied`
 * — default deny. That is not a silent failure: react-query surfaces the
 * rejection and the panel renders it, the same way `useCRMQueries` deliberately
 * stopped swallowing a failed members read (#236's silent-truncation class).
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 4. WHERE THE PEOPLE COME FROM: `users`, SCOPED `where('tenantId','==',t)`.
 *
 * Three collections could have answered "one person per item" — `users`,
 * `contacts`, and the admin roster on `tenant_private`. It is `users`, and the
 * reasons are in that order of weight:
 *
 *   · A `users` DOC ID IS THE FIREBASE AUTH UID. It is stable for the life of
 *     the account, and there is exactly one writer of the identity. That is the
 *     property a rota assignment needs and the one part 3 cannot do without.
 *
 *   · `contacts` IDS ARE NOT A STABLE PERSON IDENTITY IN THIS REPO, and THE-299
 *     is the evidence: `contactActivities.contactId` points at BOTH collections
 *     depending on which writer got there. That ambiguity is not a bug someone
 *     forgot to fix — it is structural, because `mergeContactsWithUsers` folds
 *     an app member into an EXISTING contact's id, so the same human's id
 *     depends on whether a CRM row happened to exist first. A field that
 *     sometimes means one collection and sometimes another is the exact defect
 *     this feature must not add a third instance of.
 *
 *   · PARTS 2 AND 3 NEED SOMEBODY WHO CAN ACCEPT. Part 3 is invite-and-accept
 *     and reminders. A CRM contact may be a first-time visitor who filled in a
 *     card and has no account; there is no inbox in this product to send them
 *     an invitation to and nothing for them to accept it with. An identity you
 *     cannot invite is the wrong identity for a rota.
 *
 * The admin roster was the third candidate and is wrong for the opposite
 * reason: it is the handful of people who ADMINISTER the church, and a run
 * sheet rosters the whole congregation — the teenager on the sound desk is not
 * an admin and must still be assignable.
 *
 * ⚠️ THE QUERY IS `useTenantAdmins`' QUERY WITHOUT ITS ROLE FILTER —
 * `where('tenantId','==',tenantId)` with a `limit`, one field, no `orderBy`,
 * automatic index. Sorting is `sortByString` in memory, per `query-helpers.ts`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { sortByString } from '../../utils/query-helpers';
import {
  MAX_PLAN_ITEMS,
  clampMinutes,
  orderedItems,
  renumber,
  type ServicePlan,
  type ServicePlanItem,
} from '../../components/events/service-plan';

/** The collection, spelled once. Both queries and every write go through it. */
export const servicePlansRef = (tenantId: string) =>
  collection(db, 'tenants', tenantId, 'servicePlans');

/**
 * A ceiling on a single read, the same shape every other list in this repo
 * carries. It is NOT an ordering: see the header on why there is no `orderBy`.
 */
export const PLAN_FETCH_LIMIT = 100;

/** How many people the person picker loads. `useTenantAdmins` uses 200 for the same query. */
export const PEOPLE_FETCH_LIMIT = 200;

/** A person an item can be assigned to. The id is a `users/{uid}` doc id. */
export interface ServicePerson {
  id: string;
  name: string;
}

/** A raw document coerced into a plan, with its items ordered in memory. */
export function readPlan(id: string, data: Record<string, unknown>): ServicePlan {
  const raw = Array.isArray(data.items) ? (data.items as unknown[]) : [];
  const items: ServicePlanItem[] = renumber(
    orderedItems(
      raw
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r, i) => ({
          id: typeof r.id === 'string' && r.id ? r.id : `row-${i}`,
          title: typeof r.title === 'string' ? r.title : '',
          minutes: clampMinutes(r.minutes),
          order: typeof r.order === 'number' ? r.order : i,
          personId: typeof r.personId === 'string' && r.personId ? r.personId : null,
          personName: typeof r.personName === 'string' && r.personName ? r.personName : null,
          note: typeof r.note === 'string' && r.note ? r.note : null,
        }))
        .slice(0, MAX_PLAN_ITEMS),
    ),
  );
  const eventId = typeof data.eventId === 'string' && data.eventId ? data.eventId : null;
  return {
    id,
    tenantId: typeof data.tenantId === 'string' ? data.tenantId : '',
    eventId,
    name: typeof data.name === 'string' ? data.name : '',
    // 🔴 Derived from `eventId`, never trusted from the document: the ONE-model
    // invariant (`isTemplateShape`) is what keeps a template from being a second
    // data model, and a stored boolean that disagreed with the field would break
    // it silently. The field is still WRITTEN, so the templates query can filter
    // on it server-side without a composite index.
    isTemplate: eventId === null,
    items,
    createdAt: (data.createdAt as ServicePlan['createdAt']) ?? null,
    updatedAt: (data.updatedAt as ServicePlan['updatedAt']) ?? null,
  };
}

/**
 * The plan for one event, or null.
 *
 * One plan per event is the shape part 1 ships; the query takes the first by
 * `order`-free arbitrary choice only when a church has somehow produced two,
 * and the panel never creates a second.
 */
export const useServicePlan = (
  tenantId: string | null | undefined,
  eventId: string | null | undefined,
) =>
  useQuery({
    queryKey: ['servicePlan', tenantId, eventId],
    queryFn: async (): Promise<ServicePlan | null> => {
      if (!tenantId || !eventId) return null;
      // ⚠️ ONE `where`, no `orderBy` — automatic single-field index. See header.
      const snap = await getDocs(
        query(servicePlansRef(tenantId), where('eventId', '==', eventId), limit(2)),
      );
      const first = snap.docs[0];
      return first ? readPlan(first.id, first.data()) : null;
    },
    enabled: !!tenantId && !!eventId,
    staleTime: 1000 * 60 * 5,
  });

/** Every template the church has saved. Same query shape, other field. */
export const useServicePlanTemplates = (tenantId: string | null | undefined) =>
  useQuery({
    queryKey: ['servicePlanTemplates', tenantId],
    queryFn: async (): Promise<ServicePlan[]> => {
      if (!tenantId) return [];
      const snap = await getDocs(
        query(servicePlansRef(tenantId), where('isTemplate', '==', true), limit(PLAN_FETCH_LIMIT)),
      );
      return sortByString(
        snap.docs.map((d) => readPlan(d.id, d.data())),
        'name',
        'asc',
      );
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
  });

/**
 * The church's people, from `users`. See section 4 of the header for why.
 *
 * ⚠️ NOT swallowed on failure, for `useCRMQueries`' reason: a rejected read that
 * returned `[]` would render an empty person picker, which is indistinguishable
 * from a church with no members and hides the real problem behind a plausible
 * one.
 */
export const useServicePeople = (tenantId: string | null | undefined) =>
  useQuery({
    queryKey: ['servicePeople', tenantId],
    queryFn: async (): Promise<ServicePerson[]> => {
      if (!tenantId) return [];
      const snap = await getDocs(
        query(collection(db, 'users'), where('tenantId', '==', tenantId), limit(PEOPLE_FETCH_LIMIT)),
      );
      const people = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const first = typeof data.firstName === 'string' ? data.firstName.trim() : '';
        const last = typeof data.lastName === 'string' ? data.lastName.trim() : '';
        const display = typeof data.displayName === 'string' ? data.displayName.trim() : '';
        const email = typeof data.email === 'string' ? data.email.trim() : '';
        const name = [first, last].filter(Boolean).join(' ') || display || email || 'Unnamed member';
        return { id: d.id, name };
      });
      return sortByString(people, 'name', 'asc');
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
  });

/**
 * The fields every write sends, and the ONLY place a timestamp is produced.
 *
 * 🔴 `serverTimestamp()` AND NOTHING ELSE. `invoices.issuedAt` and
 * `contactActivities.createdAt` each hold BOTH ISO strings and Timestamps in
 * this database, and Firestore sorts across types by TYPE first, so a
 * collection carrying both is unsortable. Nothing in this feature calls
 * `toISOString()`, `Date.now()` or `new Date().toString()` into a document —
 * the guards assert it by reading the source of every file this ticket adds.
 */
const stamped = <T extends Record<string, unknown>>(fields: T) => ({
  ...fields,
  updatedAt: serverTimestamp(),
});

/** Item fields as Firestore stores them — `null`, never `undefined`. */
const writableItems = (items: readonly ServicePlanItem[]) =>
  orderedItems(items)
    .slice(0, MAX_PLAN_ITEMS)
    .map((item, i) => ({
      id: item.id,
      title: item.title.trim(),
      minutes: clampMinutes(item.minutes),
      order: i,
      personId: item.personId ?? null,
      personName: item.personName ?? null,
      note: item.note?.trim() || null,
    }));

/**
 * Create a plan or a template. `eventId: null` is what makes it a template —
 * ONE model, see `service-plan.ts`.
 */
export async function createServicePlan(
  tenantId: string,
  fields: Omit<ServicePlan, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const ref = await addDoc(servicePlansRef(tenantId), {
    tenantId,
    eventId: fields.eventId,
    name: fields.name.trim(),
    isTemplate: fields.eventId === null,
    items: writableItems(fields.items),
    createdAt: serverTimestamp(),
    ...stamped({}),
  });
  return ref.id;
}

/** Replace a plan's name and items. The only write the editor makes. */
export async function saveServicePlanItems(
  tenantId: string,
  planId: string,
  name: string,
  items: readonly ServicePlanItem[],
): Promise<void> {
  await updateDoc(
    doc(db, 'tenants', tenantId, 'servicePlans', planId),
    stamped({ name: name.trim(), items: writableItems(items) }),
  );
}

/** Remove a plan or a template. */
export async function deleteServicePlan(tenantId: string, planId: string): Promise<void> {
  await deleteDoc(doc(db, 'tenants', tenantId, 'servicePlans', planId));
}

/** The two query keys this feature invalidates, spelled once so callers agree. */
export const servicePlanKeys = {
  plan: (tenantId: string | null, eventId: string | null) =>
    ['servicePlan', tenantId, eventId] as const,
  templates: (tenantId: string | null) => ['servicePlanTemplates', tenantId] as const,
};

/** Invalidate both, after any write. */
export const useInvalidateServicePlans = () => {
  const queryClient = useQueryClient();
  return async (tenantId: string | null, eventId: string | null) => {
    await queryClient.invalidateQueries({ queryKey: servicePlanKeys.plan(tenantId, eventId) });
    await queryClient.invalidateQueries({ queryKey: servicePlanKeys.templates(tenantId) });
  };
};
