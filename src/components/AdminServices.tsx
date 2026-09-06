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
 * 🔴 THIS IS A RE-PARENTING, NOT A REBUILD. THE DATA DID NOT MOVE.
 *
 * ⚠️ A service still BELONGS TO AN EVENT, and that is a finding rather than a
 * convenience — `service-plan.ts` makes it a contract this ticket has no
 * standing to break:
 *
 *   · `ServicePlan.eventId` is `string | null`, and `isTemplateShape` pins the
 *     invariant `isTemplate === (eventId === null)`. A service with no event
 *     would be indistinguishable from a TEMPLATE by the only rule that tells
 *     them apart.
 *   · A plan carries NO START OF ITS OWN. Every clock time on a run sheet is
 *     `itemClockTimes(items, eventStart)` — the durations are the plan's, the
 *     wall clock is the event's. Giving a service its own date would mean a new
 *     persisted field on a digest-pinned shape.
 *   · `tenants/{t}/servicePlans` is deployed with
 *     `allow write: if hasPermission('manageEvents', tenantId)`, and
 *     `firestore.rules` auto-deploys to production with 46 suites pinning its
 *     digest.
 *
 * So the section READS the events it plans against and adds planning on top.
 * Nothing migrates, no rule changes, and a church that already has plans keeps
 * them. What changes is WHERE a person goes to do the work — which is the whole
 * of the complaint.
 *
 * ⚠️ The known cost, stated rather than hidden: a church must still create an
 * event before it can plan the service. That is the wrong order of operations
 * for a weekly rhythm, and fixing it is shape B — services as their own records
 * with their own dates — which is a migration on shipped data plus a new
 * `firestore.rules` rule. That is a founder's call, not this ticket's.
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
import { CalendarX } from 'lucide-react';

import { useAppStore } from '../store/useAppStore';
import { PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { useEvents } from '../hooks/queries/useEventQueries';
import ServicePlanPanel from './events/ServicePlanPanel';
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

  const { data: events = [], isLoading } = useEvents(tenantId, isAuthReady);

  /**
   * The services this church could plan, newest first.
   *
   * 🔴 DATED EVENTS ONLY, and that is the same rule the rota already applies:
   * a run sheet's every clock time is derived from the event's start, so an
   * undated event has no service to plan. `useEvents` already orders by
   * `startDate desc`; the filter drops the nulls and nothing is re-sorted.
   */
  const services = useMemo(
    () => events
      .filter((e) => e.startDate !== null)
      .map((e) => ({ id: e.id, title: e.title, startsAt: (e.startDate as { toDate(): Date }).toDate() })),
    [events],
  );

  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = useMemo(
    () => services.find((s) => s.id === pickedId) ?? services[0] ?? null,
    [services, pickedId],
  );

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
          <Card className="w-full min-w-0">
            <CardHeader>
              <CardTitle>Which service</CardTitle>
              <CardDescription>
                The run sheet is planned against a dated event, so every time on it is
                that event&apos;s start plus the durations above the row.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-w-0">
              {isLoading ? null : services.length === 0 ? (
                <Empty data-services-empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><CalendarX aria-hidden="true" /></EmptyMedia>
                    <EmptyTitle>No dated services yet</EmptyTitle>
                    <EmptyDescription>
                      A service needs a dated event before it can be planned. Create one on
                      the Events screen and it will appear here.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Select
                  value={picked ? picked.id : undefined}
                  onValueChange={(value: unknown) => setPickedId(String(value))}
                >
                  <SelectTrigger className={`w-[260px] max-w-full ${CONTROL}`} aria-label="Service to plan">
                    {/* 🔴 THE TRIGGER FORMATS ITS OWN VALUE — see THE-326's note
                        in `VolunteerRotaView`. `Select.Value` with no children
                        prints the VALUE, and a value is an id, not a label. The
                        render function is the primitive's documented API for
                        this. `fmtDay` is the same formatter the options use, so
                        the closed control reads back the line that was picked. */}
                    <SelectValue placeholder="Pick a service">
                      {(value: unknown) => {
                        const id = String(value ?? '');
                        const s = services.find((x) => x.id === id);
                        return s ? `${fmtDay(s.startsAt)} · ${s.title}` : 'Pick a service';
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {fmtDay(s.startsAt)} · {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>

          {picked && (
            <ServicePlanPanel
              tenantId={tenantId}
              eventId={picked.id}
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
