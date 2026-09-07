'use client';

/**
 * THE-326 — SERVICE PLANNING, AS ITS OWN SECTION.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHY THIS FILE EXISTS, IN THE FOUNDER'S WORDS
 *
 *   "you put church service planning under the events INSTEAD OF CREATING A
 *    DEDICATED SECTION" · "you completely merged events with church planner and
 *    it's a total mess"
 *
 * He is right, and the cause was upstream of the code: THE-313 asked for "an
 * order of service attached to an event" and never asked whether planning was
 * its own job. It is. Planning a Sunday service is a WEEKLY RHYTHM with rotas
 * and volunteers hanging off it; running an event is a one-off with a public
 * page, tickets and registrations. They share a date and nothing else about the
 * work, and merging them buried the run sheet two clicks deep inside an event
 * detail screen with the rota behind a small button next to "Create event".
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE-329 — AND A SERVICE NO LONGER NEEDS AN EVENT. THE KNOWN COST IS PAID.
 *
 *   "If I have no event created, I cannot create any service, which is stupid.
 *    I need to be able to create services from the service tab."
 *
 * THE-326 shipped this section reading the church's EVENTS and planning against
 * them, and named the cost in this very docblock rather than hiding it: "a
 * church must still create an event before it can plan the service. That is the
 * wrong order of operations for a weekly rhythm." It was, and this is where it
 * stops being true. A church creates a service HERE, with a name and a date, and
 * an event is optional decoration.
 *
 * ⚠️ THE INVARIANT MOVED, THE DATA DID NOT. `service-plan.ts` holds the whole of
 * the change and its reasoning; in one line: `ServicePlan` gained `startAt`, and
 * `isTemplate === (eventId === null)` became
 * `isTemplate === (planKind(plan) === 'template')` over a THREE-way kind —
 * event-anchored · standalone · template. Every document already in a church's
 * database has no `startAt`, so it reads as null and lands in exactly the state
 * it already occupied. 🔴 NOTHING MIGRATES, and there is no window in which some
 * documents are converted and others are not.
 *
 * 🔴 NO `firestore.rules` CHANGE IS NEEDED, AND THAT IS A FINDING RATHER THAN A
 * HOPE. The deployed rule is
 *
 *     match /servicePlans/{planId} {
 *       allow read:  if belongsToTenant(tenantId);
 *       allow write: if hasPermission('manageEvents', tenantId);
 *     }
 *
 * and neither half reads `resource.data`. This ticket adds a FIELD to documents
 * in that same collection and adds NO new query shape — the Services list is the
 * rota's existing `where('isTemplate','==',false)` read — so there is nothing
 * for a rule to newly permit. `firestore.rules` is byte-identical and
 * `the-329-guards.test.ts` asserts it.
 *
 * 🔴 AND `manageEvents` IS STILL THE RIGHT PERMISSION, for the reason THE-313
 * gave and this ticket does not weaken: it is the authority to plan what the
 * church does on a Sunday, and it already gates `servicePlans`, `rotaInvitations`
 * and the invite API server-side. A `manageServices` permission would add a row
 * to the roles matrix that NO rule, NO API route and NO other screen knows
 * about, and every one of those places would still be checking `manageEvents` —
 * so the new claim would grant nothing and deny nothing. The name is now a
 * little wide for what it covers; a rename is a roles-matrix migration and is
 * not this ticket's, and is reported rather than done.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE SECTION OWNS ALL THREE PARTS, AND EVENTS OWNS NONE OF THEM.
 *
 *   1. The order of service (the run sheet) — `ServicePlanPanel`, THE-313.
 *   2. The volunteer rota                   — `VolunteerRotaPanel`, THE-317.
 *   3. Invitations and unfilled slots       — `RotaInvitePanel`, THE-324.
 *
 * Events keeps the list, the month view, create/edit/detail and registrations:
 * the public-facing event product, untouched.
 *
 * ⚠️ Parts 2 and 3 are tenant-wide already — they take a `tenantId` and read
 * every plan — so they mount here unchanged. Part 1 is per-service by
 * construction (it takes one `eventId`), so this screen supplies the one thing
 * the event detail screen used to supply implicitly: WHICH service. That is the
 * picker below, and it is the only new behaviour in this file.
 *
 * 🔴 NO NEW PERMISSION. The nav entry carries the SAME gate the Events entry
 * carries — `navAllows(features?.eventRegistration) && (hasFullAccess ||
 * perms.manageEvents)` — because service planning was reachable through Events
 * and through nothing else, so anyone who could reach it yesterday can reach it
 * today and nobody new can. A `managePlanning` permission would add a row to the
 * roles matrix that no rule, no API route and no other screen knows about, and
 * `servicePlans`, `rotaInvitations` and the invite API all check `manageEvents`
 * server-side regardless of what the nav believes.
 */
import React, { useMemo, useState } from 'react';
import { CalendarX, TriangleAlert } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';

import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { useEvents } from '../hooks/queries/useEventQueries';
import { useRotaPlans } from '../hooks/queries/useVolunteerRotaQueries';
import {
  createServicePlan,
  useInvalidateServicePlans,
  useServicePlanTemplates,
} from '../hooks/queries/useServicePlanQueries';
import { emptyItem, itemsFromTemplate, servicePlanFields } from './events/service-plan';
import { notifyError } from '../utils/notify';
import ServicePlanPanel from './events/ServicePlanPanel';
import ServiceCreateForm, { type NewServiceDraft } from './events/ServiceCreateForm';
import VolunteerRotaPanel from './events/VolunteerRotaPanel';
import RotaInvitePanel from './events/RotaInvitePanel';
import { fmtDay } from './events/volunteer-rota';
import { AdminPageHeader } from './admin/AdminUI';
import { FORM_CONTAINER, CONTROL_DENSITY } from './layout/form-layout';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * A control below `sm`, and Rule 4's control from `sm` up.
 *
 * ⚠️ Copied in SPELLING from `VolunteerRotaView`'s `CONTROL` and for its
 * reason, not by preference: `select` sets its height with
 * `data-[size=default]:h-9`, an ATTRIBUTE selector that outranks Rule 4's own
 * class, so the height has to be answered at the same specificity with `sm:` in
 * front. `min-h-[44px]` carries the phone floor and beats a leaked `h-` outright
 * because `min-height` is a different property.
 */
const CONTROL =
  `min-h-[44px] sm:min-h-0 ${CONTROL_DENSITY.control} sm:data-[size=default]:h-[38px]`;

/**
 * 🔴 THE TABS ARE THE THREE PARTS, NAMED AS A CHURCH NAMES THEM.
 *
 * ⚠️ `w-full` on the list and NO `min-w-` on the triggers — the same pairing
 * THE-326 measured and fixed on the rota's own tabs in `VolunteerRotaView`. A
 * `min-w-` here would override the flex `min-width: auto` content floor and let
 * "Invitations" be painted over its neighbour at 380px, which is precisely the
 * defect this ticket exists to fix. The floor is carried by `min-h-[44px]` on
 * the height and by the CONTENT on the width — measured, not assumed.
 */
const TAB = 'min-h-[44px] sm:min-h-0';

const AdminServices: React.FC = () => {
  // Same resolution as `AdminEvents`: the store's tenant, falling back to the
  // platform tenant for a super admin while the store settles on a refresh.
  const { currentTenantId, isAuthReady, isSuperAdmin } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);

  const eventsQuery = useEvents(tenantId, isAuthReady);
  /**
   * 🔴 THE STANDALONE SERVICES COME FROM THE ROTA'S OWN READ, AND THIS TICKET
   * ADDS NO FIRESTORE QUERY AT ALL.
   *
   * ⚠️ That is a deliberate answer to "how does a standalone service order
   * without truncating the soonest away", and it is worth reading in full.
   *
   * The obvious shape — `where('startAt','>=',now) + orderBy('startAt')` — is
   * legal (a range and a sort on the SAME field is an automatic single-field
   * index, so no composite index and nothing inert in `firestore.indexes.json`).
   * It was NOT taken, for two reasons. First, `the-313-guards.test.ts` asserts
   * that the plan query module imports no `orderBy` at all and that every query
   * it makes is one `where` with no server-side sort; relocating a query to
   * dodge that grep would be exactly the kind of guard-dodging this repo has
   * been burned by. Second, and more importantly, the read ALREADY EXISTS:
   * `useRotaPlans` fetches every non-template plan with `limit(N + 1)` and
   * reports `truncated`, and a standalone service writes `isTemplate: false`, so
   * it is already in that result. react-query dedupes it with the rota tab's
   * own call, so the Services screen costs nothing new.
   *
   * 🔴 AND THE TRUNCATION IS PROVED, NOT ASSUMED — THE-324's trap, head on. The
   * read is `limit(ROTA_PLAN_LIMIT + 1)`: if it comes back short, the list is
   * PROVABLY COMPLETE and the in-memory sort below is exact, so no service can
   * be dropped and the soonest cannot be truncated away. If it comes back full,
   * `truncated` is true and the screen SAYS SO rather than presenting a short
   * list as the whole diary — see `truncationNotice`. An unordered `limit(N)`
   * whose arbitrary rows are called "the recent ones" is #405's defect and is
   * not what this is.
   */
  const plansQuery = useRotaPlans(tenantId);
  const templatesQuery = useServicePlanTemplates(tenantId);
  const invalidate = useInvalidateServicePlans();
  const events = eventsQuery.data ?? [];
  const isLoading = eventsQuery.isLoading || plansQuery.isLoading;

  /**
   * 🔴 A FAILED READ IS A FAILURE, NEVER "nothing scheduled".
   *
   * ⚠️ The Silent-Failure Rule: "A default value that hides an error is a bug…
   * each converts a loud failure into a quiet lie." Both reads default to `[]`
   * for the LOADING case, so an empty list here is ambiguous on its own — this
   * is the field that disambiguates it, and the render branches on it BEFORE it
   * branches on emptiness.
   */
  const readFailed = eventsQuery.isError || plansQuery.isError;
  const truncated = plansQuery.data?.truncated ?? false;

  /** Dated events, which are the events a service can be anchored to. */
  const datedEvents = useMemo(
    () => events
      .filter((e) => e.startDate !== null)
      .map((e) => ({ id: e.id, title: e.title, startsAt: (e.startDate as { toDate(): Date }).toDate() })),
    [events],
  );

  /**
   * Every service this church can plan — event-anchored AND standalone —
   * soonest-relevant first.
   *
   * ⚠️ ONE LIST, TWO KINDS, AND THE KIND IS CARRIED RATHER THAN INFERRED. A row
   * knows whether it is anchored to an event, because that is what decides which
   * read `ServicePlanPanel` makes and it must not be re-derived from a null.
   */
  const services = useMemo(() => {
    const plans = plansQuery.data?.plans ?? [];
    const fromEvents = datedEvents.map((e) => ({
      key: `event:${e.id}`,
      eventId: e.id as string | null,
      planId: null as string | null,
      title: e.title,
      startsAt: e.startsAt,
    }));
    const standalone = plans
      .filter((p) => p.eventId === null && p.startAt !== null)
      .map((p) => ({
        key: `plan:${p.id}`,
        eventId: null as string | null,
        planId: p.id as string | null,
        title: p.name,
        startsAt: (p.startAt as { toDate(): Date }).toDate(),
      }));
    // Newest first — the ordering THE-326 shipped, applied to both kinds at
    // once, in memory over a read proved complete above.
    return [...fromEvents, ...standalone]
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  }, [datedEvents, plansQuery.data]);

  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const picked = useMemo(
    () => services.find((s) => s.key === pickedKey) ?? services[0] ?? null,
    [services, pickedKey],
  );

  const [busy, setBusy] = useState(false);

  /**
   * 🔴 THE WHOLE TICKET, IN ONE WRITE. A name, a date, and no event required.
   *
   * ⚠️ The date is converted HERE and exactly once, `Timestamp.fromDate(new
   * Date(local))` — the same conversion `AdminEvents.tsx` makes for an event's
   * start, and the only date-to-document path this feature has. Nothing writes
   * an ISO string or an epoch number; `service-plan.ts` records why.
   */
  const create = async (draft: NewServiceDraft) => {
    if (!tenantId) { notifyError('Unable to determine your tenant. Please refresh.', null); return; }
    const start = new Date(draft.startsAtLocal);
    if (Number.isNaN(start.getTime())) {
      notifyError('That date could not be read. Please pick it again.', null);
      return;
    }
    setBusy(true);
    try {
      const template = (templatesQuery.data ?? []).find((t) => t.id === draft.templateId);
      // 🔴 A template's items, with the people and the ids stripped — the same
      // total function part 1 uses, so a service started from a template here is
      // the same document a service started from one there is.
      const items = template ? itemsFromTemplate(template.items) : [emptyItem(0)];
      const fields = servicePlanFields(
        tenantId,
        draft.name,
        items,
        draft.eventId
          ? { kind: 'event', eventId: draft.eventId }
          : { kind: 'standalone', startAt: Timestamp.fromDate(start) },
      );
      const planId = await createServicePlan(tenantId, fields);
      await invalidate(tenantId, draft.eventId, planId);
      setPickedKey(draft.eventId ? `event:${draft.eventId}` : `plan:${planId}`);
    } catch (e) { notifyError('Failed to create the service', e); }
    finally { setBusy(false); }
  };

  return (
    <div className={`w-full ${FORM_CONTAINER} space-y-6`} data-admin-services>
      <AdminPageHeader
        eyebrow="Ministry"
        title="Service planning"
      />

      <Tabs defaultValue="plan">
        <TabsList className="w-full min-h-[51px] sm:min-h-0">
          <TabsTrigger value="plan" className={TAB}>Order of service</TabsTrigger>
          <TabsTrigger value="rota" className={TAB}>Volunteer rota</TabsTrigger>
          <TabsTrigger value="invites" className={TAB}>Invitations</TabsTrigger>
        </TabsList>

        {/* ── Part 1 · the run sheet, for one service ─────────────────────── */}
        <TabsContent value="plan" className="min-w-0 space-y-5" data-services-plan>
          {/* ── 🔴 THE-329 · a church creates a service HERE, with no event ── */}
          <ServiceCreateForm
            events={datedEvents}
            templates={(templatesQuery.data ?? []).map((t) => ({ id: t.id, name: t.name }))}
            formatDay={fmtDay}
            busy={busy}
            onCreate={create}
          />

          <Card className="w-full min-w-0">
            <CardHeader>
              <CardTitle>Which service</CardTitle>
              <CardDescription>
                Every time on the run sheet is the service&apos;s start plus the durations
                above the row. A service attached to an event takes the event&apos;s date.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-w-0 space-y-4">
              {/* 🔴 A FAILED READ SHOWS A FAILURE, NEVER "nothing scheduled".
                  Branched BEFORE emptiness, because both states render an empty
                  list and only this one is a bug the church needs to know about. */}
              {readFailed ? (
                <Empty data-services-failed>
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><TriangleAlert aria-hidden="true" /></EmptyMedia>
                    <EmptyTitle>Services could not be loaded</EmptyTitle>
                    <EmptyDescription>
                      The church&apos;s services could not be read, so this list is not a
                      statement about what is scheduled. Refresh, and if it keeps happening
                      the account may not have permission to read service plans.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : isLoading ? null : services.length === 0 ? (
                <Empty data-services-empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><CalendarX aria-hidden="true" /></EmptyMedia>
                    <EmptyTitle>No services yet</EmptyTitle>
                    {/* 🔴 THE COPY THE TICKET NAMES. It no longer sends anybody
                        to the Events screen, because nothing over there is
                        needed any more — the form above this card is the whole
                        of what a church has to do. */}
                    <EmptyDescription>
                      Create one above with a name and a date, and it will appear here
                      ready to plan.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <>
                  <Select
                    value={picked ? picked.key : undefined}
                    onValueChange={(value: unknown) => setPickedKey(String(value))}
                  >
                    <SelectTrigger className={`w-[260px] max-w-full ${CONTROL}`} aria-label="Service to plan">
                      {/* 🔴 THE TRIGGER FORMATS ITS OWN VALUE — see THE-326's note
                          in `VolunteerRotaView`. `Select.Value` with no children
                          prints the VALUE, and a value is a key, not a label. The
                          render function is the primitive's documented API for
                          this. `fmtDay` is the same formatter the options use, so
                          the closed control reads back the line that was picked. */}
                      <SelectValue placeholder="Pick a service">
                        {(value: unknown) => {
                          const key = String(value ?? '');
                          const s = services.find((x) => x.key === key);
                          return s ? `${fmtDay(s.startsAt)} · ${s.title}` : 'Pick a service';
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {services.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {fmtDay(s.startsAt)} · {s.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* 🔴 A LIST THAT CANNOT BE PROVED COMPLETE SAYS SO. See the
                      note on `plansQuery` — this is the other half of it. */}
                  {truncated && (
                    <CardDescription data-services-truncated>
                      This church has more services than one read returns, so the list above
                      is not all of them.
                    </CardDescription>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {picked && (
            <ServicePlanPanel
              tenantId={tenantId}
              eventId={picked.eventId}
              planId={picked.planId}
              eventTitle={picked.title}
              startsAt={picked.startsAt}
            />
          )}
        </TabsContent>

        {/* ── Part 2 · the rota across weeks ──────────────────────────────── */}
        <TabsContent value="rota" className="min-w-0 space-y-5" data-services-rota>
          <VolunteerRotaPanel tenantId={tenantId} />
        </TabsContent>

        {/* ── Part 3 · invitations and unfilled slots ─────────────────────── */}
        <TabsContent value="invites" className="min-w-0 space-y-5" data-services-invites>
          <RotaInvitePanel tenantId={tenantId} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminServices;
