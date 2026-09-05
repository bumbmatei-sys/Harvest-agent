"use client";
/**
 * THE-317 — the rota, rendered. NO FIRESTORE, NO REACT-QUERY, NO APP STORE.
 *
 * ⚠️ SPLIT FROM `VolunteerRotaPanel.tsx` FOR THE REASON `ServicePlanRow.tsx` WAS
 * SPLIT FROM `ServicePlanPanel.tsx`: the Chromium layout suite renders the REAL
 * component with `renderToStaticMarkup` instead of a hand-written replica, so
 * the boxes it measures are the boxes a church sees and there is no copy to pin
 * against the original. Every other layout suite in this repo needs that second
 * assertion; #449 established that not needing it is strictly stronger, and this
 * file keeps that property.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY ELEMENT THAT HAS A PRIMITIVE USES IT. HERE IS THE MAP, ELEMENT BY
 *    ELEMENT, AND THE REJECTIONS ARE NAMED WITH A REASON RATHER THAN OMITTED.
 *
 *   the panel container ............. `card`     Card / CardHeader / CardTitle /
 *                                                CardDescription / CardContent
 *   the three views ................. `tabs`     Tabs / TabsList / TabsTrigger /
 *                                                TabsContent
 *   a week's grid of items .......... `table`    Table / TableHeader / TableRow /
 *                                                TableHead / TableBody / TableCell
 *   "who is on" for a date .......... `table`    the same primitive; it is the
 *                                                same question with one column
 *                                                fewer
 *   assigning a person .............. `select`   Select / SelectTrigger /
 *                                                SelectValue / SelectContent /
 *                                                SelectItem
 *   choosing the date ............... `select`   the same
 *   the double-booking warning ...... `badge`    variant="destructive"
 *   "unassigned" .................... `badge`    variant="outline"
 *   a not-served-recently row ....... `item`     Item / ItemMedia / ItemContent /
 *                                                ItemTitle / ItemDescription /
 *                                                ItemGroup
 *   the person on that row .......... `avatar`   Avatar / AvatarFallback
 *   every empty and failed state .... `empty`    Empty / EmptyHeader / EmptyMedia
 *                                                / EmptyTitle / EmptyDescription
 *   the loading state ............... `skeleton` Skeleton
 *
 * 🔴 REJECTED, WITH THE PRIMITIVE NAMED AND WHY — because "it did not fit"
 * without a named primitive is not an answer:
 *
 *   · `tooltip` FOR THE DOUBLE-BOOKING DETAIL. Rejected. A tooltip is a
 *     pointer-and-hover affordance, and this product's primary platform is a
 *     phone where there is no hover; the detail would be unreachable for the
 *     reader most likely to need it. The clash is written out as text under the
 *     row instead — the same information, on every device. (It would also have
 *     cost THE-266's `toEqual([])` an amendment for a surface nobody could
 *     reach, which is a bad trade twice over.)
 *   · `dialog` / `sheet` FOR THE PERSON PICKER. Rejected. `select` IS the picker
 *     and already carries the listbox role, type-ahead and keyboard handling; a
 *     modal over a one-of-many choice would add a dismissal step to the single
 *     most repeated action on this screen. (`dialog` is used by nothing here —
 *     the rota has no destructive action to confirm.)
 *   · `progress` FOR "HOW FULL IS THIS WEEK". Rejected, and no bar is drawn at
 *     all. `progress` paints `bg-primary` on `bg-muted` at 2.30:1 in light,
 *     which THE-290 recorded as known-and-accepted ONLY where every figure the
 *     bar depicts is written beside it — and here the figure ("3 of 7 assigned")
 *     IS the whole content, so a bar would convey nothing by length that the
 *     text does not already say.
 *   · `pagination` FOR A LONG WEEK LIST. Rejected. #422's pattern is to scroll
 *     inside the card, and paginating a rota would hide the very week an admin
 *     is looking for behind a control. It remains adopted by nothing.
 *   · `accordion` / `collapsible` FOR COLLAPSING A WEEK. Rejected. A rota's
 *     value is seeing several weeks AT ONCE — that is the ticket's first line —
 *     and a collapsed week is a week not being compared.
 *   · `checkbox`, `switch`, `input`, `textarea`, `field`, `input-group`,
 *     `button-group`, `toggle`, `popover`, `dropdown-menu`, `separator`,
 *     `chart`, `sonner`. Rejected: this view has no boolean, no free text, no
 *     form field, no menu, no series and raises no toast. It has one control
 *     (assign) and one navigation (the tabs).
 *
 * 🔴 `button` IS USED, and only for the two arrows that move the horizon. It is
 * the primitive, not a hand-rolled `<button className="...">`.
 *
 * ⚠️ IF YOU FIND YOURSELF WRITING `<div className="rounded-lg border bg-card
 * p-4">`, THAT IS `card`. Nothing below does. `the-317-guards.test.ts` asserts
 * this file imports every primitive named above AND that it spells no
 * hand-written substitute for one — a bordered-rounded-padded `div`, a
 * `role="table"`, a bare `<table>`, a hand-made pill.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE SHAPE AT 380px: WEEKS STACK VERTICALLY; EACH WEEK'S TABLE SCROLLS
 *    SIDEWAYS INSIDE ITS OWN SCROLLER. THE PAGE BODY NEVER MOVES.
 *
 * ⚠️ A weeks × items MATRIX — one column per week — was the obvious shape and is
 * not this one. Six columns of a person picker is about 1,000px of unavoidable
 * width, so at 380px it would be a 2.6-screen sideways drag over a grid whose
 * row labels scrolled away with it; and the matrix is a lie besides, because two
 * services do not have the same items, so most cells would be structurally
 * blank.
 *
 * So a week is a SECTION with its own table, stacked down the page: vertical
 * scrolling is what a phone is for. The table itself is genuinely wider than
 * 380px — a time, an item title and a person picker do not fit in 380 — so it
 * sits in `overflow-x-auto`, which is #422's established pattern (scroll inside
 * the card) and #429's assertion that the scroller genuinely overflows so the
 * test is not vacuous. `THE-317.volunteer-rota.layout.test.tsx` measures BOTH
 * halves in real Chromium: `scrollWidth > clientWidth` on the scroller, and
 * `document.documentElement.scrollWidth <= 380` on the page.
 *
 * 🔴 TAP TARGETS, AND THE 44/38 SPLIT. Below `sm` every control here is
 * `min-h-[44px]`; from `sm` up, Rule 4 (`form-layout.ts`) fixes a control at
 * 38px and `DENSITY_PX.control < 44` is asserted there ON PURPOSE — a pointer
 * at a desktop is not a thumb. So each control carries `min-h-[44px] sm:min-h-0`
 * beside `CONTROL_DENSITY.control`, which is the two rules agreeing.
 *
 * 🔴 BOTTOM-NAV CLEARANCE, MADE EXPLICIT. The admin shell's nav is
 * `fixed bottom-0 w-full z-[100]` and the safe-area class it carries COMPILES
 * TO NOTHING — #437 fixed that for the MEMBER shell only and the admin shell
 * still carries the inert class. So the clearance is spelled here, reusing part
 * 1's own `NAV_CLEARANCE` export rather than re-inventing the number. ⚠️ The
 * literal is deliberately not quoted in this prose: THE-295's register
 * enumerates every file spelling it, and THE-300 found that quoting it in a
 * comment puts the component into that register for what is only prose.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 NOTHING IS SENT FROM HERE. No email, no SMS, no notification, no push, no
 * `fetch`. THE-314 shipped SMS and reported a send interface for PART 3 to
 * call; this file does not import it, and the guards sweep for it.
 *
 * 🔴 AND NO MEMBER IS LISTED ALONGSIDE A LOCATION. `RotaEvent` has no place
 * field at all (see `volunteer-rota.ts`), so there is nothing here to render.
 */
import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, TriangleAlert, UserRound, CalendarX } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { CONTROL_DENSITY } from '../layout/form-layout';
import { NAV_CLEARANCE } from './ServicePlanRow';
import { fmtClock, itemClockTimes, type ServicePlanItem } from './service-plan';
import {
  fmtDay,
  fmtSince,
  fmtWeek,
  notServedRecently,
  overlapWarnings,
  rotaWeeks,
  warnedItemKeys,
  whoIsOn,
  type RotaReadState,
  type RotaService,
} from './volunteer-rota';

/**
 * A control below `sm`, and Rule 4's control from `sm` up.
 *
 * 🔴 `sm:data-[size=default]:h-[38px]` IS NOT A SECOND OPINION ABOUT THE NUMBER
 *    — IT IS HOW RULE 4 REACHES A PRIMITIVE THAT OUTRANKS A PLAIN UTILITY.
 *
 * ⚠️ MEASURED, NOT ASSUMED, AND THE FIRST TWO ATTEMPTS WERE WRONG. `select`'s
 * trigger sets its own height as `data-[size=default]:h-8` — an ATTRIBUTE
 * SELECTOR, so it outranks `CONTROL_DENSITY.control`'s plain `sm:h-[38px]`
 * however Tailwind orders the two, and the Chromium suite caught the picker
 * sitting at 32px on every width from 768 up with Rule 4 silently losing.
 *
 * 🔴 `sm:min-h-[38px]` WAS THE OBVIOUS FIX AND IT IS A TRAP. Measured, it
 * applied BELOW `sm` as well and dragged the phone control down to 39px — the
 * 44px floor lost to it. `sm:min-h-0`, which this file also spells, does NOT
 * behave that way, so this is not a rule about `sm:` in general and cannot be
 * reasoned about from the class name. The measurement is the only thing that
 * knows, which is what this suite is for.
 *
 * So the height is spelled at the primitive's OWN specificity instead: same
 * attribute selector, `sm:` in front. It wins on cascade order rather than on
 * a specificity fight, and it cannot reach a phone because `sm:` really is a
 * media query here — the same suite measures 44px at 380px to prove it.
 */
const CONTROL =
  `min-h-[44px] sm:min-h-0 ${CONTROL_DENSITY.control} sm:data-[size=default]:h-[38px]`;

/**
 * 🔴 AN ICON-ONLY CONTROL: A 44px SQUARE, AT EVERY WIDTH, AND THAT IS MEASURED
 *    RATHER THAN CHOSEN.
 *
 * ⚠️ IT DELIBERATELY DOES NOT SPELL `CONTROL_DENSITY.control`, AND HERE IS THE
 * EVIDENCE. Four `sm:`-gated heights were tried on this control and every one
 * of them was MEASURED IN CHROMIUM taking effect at 380px, dragging it under
 * the thumb floor:
 *
 *     min-h-[44px] … sm:min-h-0  + CONTROL_DENSITY.control  →  39.05px at 380
 *     h-[44px] w-[44px]          + sm:h-[38px] sm:w-[38px]  →  39.03px at 380
 *     h-[44px] w-[44px]          + sm:h-8 sm:w-8            →  34.09px at 380
 *     h-[44px] w-[44px]          + sm:data-[slot=button]:…  →  39.05px at 380
 *     h-[44px] w-[44px]          alone                      →  44px, every width
 *
 * 🔴 THE REPO'S USUAL PAIRING MASKS THIS, WHICH IS WHY IT HAS NOT BITTEN BEFORE.
 * `min-h-[44px] sm:min-h-0 ${'${CONTROL_DENSITY.control}'}` holds its 44px on the person
 * picker and on the tab triggers — because `min-height` beats `height` outright,
 * being a different property, so a leaked `sm:h-[38px]` loses to it. This
 * control is the case where nothing masks it: `button` sets its own size with
 * `size-8`, so the height has to be spelled, and the moment it is spelled with
 * an `sm:` prefix the phone loses its floor.
 *
 * ⚠️ SO THE FLOOR WINS, AND THE COST IS NAMED: above `sm` these two stay 44px
 * rather than taking Rule 4's 38. Rule 4 governs FORM CONTROLS inside a form
 * measure — `form-layout.ts` says so, and `DESKTOP_CONTROL_MAX_PX` is about the
 * founder's complaint that a form's controls were too tall. These are neither:
 * they are two navigation arrows that move the rota's horizon, and 44px is 4px
 * over a cap that was never written about them. A control a thumb cannot hit is
 * the worse failure, and it is the one this ticket names.
 */
const TAP_BUTTON = 'h-[44px] w-[44px]';

/** The person an item may be assigned to. Same identity as part 1's: `users/{uid}`. */
export interface RotaPerson {
  id: string;
  name: string;
}

export interface VolunteerRotaViewProps {
  services: RotaService[];
  people: RotaPerson[];
  read: RotaReadState;
  loading: boolean;
  /** "Now", injected so every clock in the tests is deterministic. */
  now: Date;
  /**
   * 🔴 THE ONLY WRITE PATH OUT OF THIS VIEW. The panel routes it into part 1's
   * `saveServicePlanItems`; nothing here touches Firestore.
   */
  onAssign: (planId: string, itemId: string, person: RotaPerson | null) => void;
  /** True while a write is in flight — the control is disabled, never hidden. */
  saving?: boolean;
}

/** `select` cannot carry an empty string as a value, so "nobody" gets a name. */
const UNASSIGNED = '__unassigned__';

/** Initials for `avatar`'s fallback. At most two, upper case. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

/**
 * The person picker for one item.
 *
 * ⚠️ IT IS ALWAYS ENABLED WHEN A PLAN EXISTS, INCLUDING ON A ROW THAT IS ALREADY
 * WARNED. Warning is not blocking — see `overlapWarnings` — so a clash must
 * remain assignable, and re-assigning is how an admin RESOLVES one.
 */
function PersonPicker({
  planId, item, people, onAssign, saving,
}: {
  planId: string;
  item: ServicePlanItem;
  people: RotaPerson[];
  onAssign: VolunteerRotaViewProps['onAssign'];
  saving?: boolean;
}) {
  return (
    <Select
      value={item.personId ?? UNASSIGNED}
      onValueChange={(value: unknown) => {
        const id = String(value);
        onAssign(planId, item.id, id === UNASSIGNED ? null : people.find((p) => p.id === id) ?? null);
      }}
      disabled={saving}
    >
      <SelectTrigger
        className={`w-[168px] ${CONTROL}`}
        aria-label={`Assign ${item.title.trim() || 'this item'}`}
      >
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        {people.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One service's items, as a table. The scroller is the caller's. */
function ServiceTable({
  service, people, warned, onAssign, saving,
}: {
  service: RotaService;
  people: RotaPerson[];
  warned: Set<string>;
  onAssign: VolunteerRotaViewProps['onAssign'];
  saving?: boolean;
}) {
  const clocks = itemClockTimes(service.items, service.startsAt);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[72px]">Time</TableHead>
          <TableHead className="min-w-[160px]">Item</TableHead>
          <TableHead className="w-[184px]">Assigned to</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clocks.map(({ item, startsAt }) => {
          const isWarned = service.planId !== null && warned.has(`${service.planId}:${item.id}`);
          return (
            <TableRow key={item.id} data-rota-row={item.id}>
              <TableCell className="tabular-nums align-top">{fmtClock(startsAt)}</TableCell>
              <TableCell className="align-top">
                <span className="block">{item.title.trim() || 'Untitled item'}</span>
                {isWarned && (
                  <span className="mt-1 flex items-center gap-1 text-xs text-destructive" data-rota-clash={item.id}>
                    <TriangleAlert size={12} aria-hidden="true" />
                    Also on another service at this time
                  </span>
                )}
              </TableCell>
              <TableCell className="align-top">
                {service.planId === null ? (
                  <Badge variant="outline">No order of service</Badge>
                ) : (
                  <PersonPicker
                    planId={service.planId}
                    item={item}
                    people={people}
                    onAssign={onAssign}
                    saving={saving}
                  />
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * 🔴 THE SCROLLER. #422's pattern: the overflow lives INSIDE the card, so the
 * PAGE never scrolls sideways. `min-w-0` on the ancestors is what lets a flex or
 * grid child actually shrink to its container instead of forcing it wider —
 * without it the overflow escapes upward and the body moves, which is precisely
 * what test 13 measures.
 */
const Scroller: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="w-full min-w-0 overflow-x-auto" data-rota-scroller>
    <div className="min-w-[420px]">{children}</div>
  </div>
);

/** Loading. `skeleton`, not a spinner and not a bare "Loading…". */
const RotaSkeleton: React.FC = () => (
  <div className="space-y-3" data-rota-loading>
    {[0, 1, 2].map((i) => (
      <Skeleton key={i} className="h-[72px] w-full" />
    ))}
  </div>
);

/** Every empty and every failed read in this view goes through here. */
const RotaEmpty: React.FC<{ title: string; description: string; icon?: React.ReactNode }> = ({
  title, description, icon,
}) => (
  <Empty data-rota-empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">{icon ?? <CalendarX aria-hidden="true" />}</EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const VolunteerRotaView: React.FC<VolunteerRotaViewProps> = ({
  services, people, read, loading, now, onAssign, saving,
}) => {
  const [offsetWeeks, setOffsetWeeks] = useState(0);

  const from = useMemo(() => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetWeeks * 7);
    return d;
  }, [now, offsetWeeks]);

  const weeks = useMemo(() => rotaWeeks(services, from), [services, from]);
  const warnings = useMemo(() => overlapWarnings(services), [services]);
  const warned = useMemo(() => warnedItemKeys(warnings), [warnings]);
  const recency = useMemo(() => notServedRecently(people, services, read, now), [people, services, read, now]);

  /** Every date that has a service, for the "who is on" picker. */
  const serviceDays = useMemo(() => {
    const seen = new Map<string, Date>();
    for (const s of services) {
      if (!s.startsAt) continue;
      const key = `${s.startsAt.getFullYear()}-${s.startsAt.getMonth()}-${s.startsAt.getDate()}`;
      if (!seen.has(key)) seen.set(key, s.startsAt);
    }
    return [...seen.values()].sort((a, b) => a.getTime() - b.getTime());
  }, [services]);

  /** The next service day on or after today, or the last one if none is ahead. */
  const defaultDay = useMemo(() => {
    const ahead = serviceDays.find((d) => d >= new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    return ahead ?? serviceDays[serviceDays.length - 1] ?? null;
  }, [serviceDays, now]);

  const [dayKey, setDayKey] = useState<string | null>(null);
  const selectedDay = useMemo(() => {
    if (dayKey === null) return defaultDay;
    return serviceDays.find((d) => String(d.getTime()) === dayKey) ?? defaultDay;
  }, [dayKey, defaultDay, serviceDays]);

  const onDuty = useMemo(
    () => (selectedDay ? whoIsOn(services, selectedDay) : []),
    [services, selectedDay],
  );

  return (
    <Card className={`w-full min-w-0 ${NAV_CLEARANCE}`} data-rota-card>
      <CardHeader>
        <CardTitle>Volunteer rota</CardTitle>
        <CardDescription>
          Who is on across the coming weeks. Assignments are the order of service&apos;s own —
          changing one here changes it on the run sheet.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        <Tabs defaultValue="rota">
          {/* 🔴 THE 44px FLOOR ON THE TABS, AND WHY IT IS ON THE LIST.
              ⚠️ `tabs` sets the LIST's height as
              `group-data-[orientation=horizontal]/tabs:h-8` and gives each
              trigger `h-[calc(100%-1px)]`, so a trigger cannot be made taller
              than the list that holds it — the Chromium suite measured them at
              25px. Raising the LIST's minimum raises every trigger with it.
              51 rather than 44 because the trigger gets the list's CONTENT box:
              the list spends `p-[3px]` top and bottom and the trigger's calc
              takes one more pixel, so 51 − 6 − 1 lands a trigger on exactly 44.
              The triggers carry the floor on both axes too, so a change to the
              primitive's padding cannot silently drop them under it.
              `sm:min-h-0` releases all of it, per the 44/38 split. */}
          <TabsList className="min-h-[51px] sm:min-h-0">
            <TabsTrigger value="rota" className="min-h-[44px] min-w-[44px] sm:min-h-0">Rota</TabsTrigger>
            <TabsTrigger value="who" className="min-h-[44px] min-w-[44px] sm:min-h-0">Who is on</TabsTrigger>
            <TabsTrigger value="recent" className="min-h-[44px] min-w-[44px] sm:min-h-0">Not served recently</TabsTrigger>
          </TabsList>

          {/* ── The rota across weeks ─────────────────────────────────────── */}
          <TabsContent value="rota" className="min-w-0 space-y-5">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className={TAP_BUTTON}
                onClick={() => setOffsetWeeks((w) => w - 1)}
                aria-label="Show earlier weeks"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className={TAP_BUTTON}
                onClick={() => setOffsetWeeks((w) => w + 1)}
                aria-label="Show later weeks"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
              {warnings.length > 0 && (
                <Badge variant="destructive" data-rota-warning-count>
                  {warnings.length} double booking{warnings.length === 1 ? '' : 's'}
                </Badge>
              )}
            </div>

            {loading ? (
              <RotaSkeleton />
            ) : read.failed ? (
              <RotaEmpty
                title="The rota could not be read"
                description="Nothing is shown rather than an empty rota, because an empty rota would look like a church with nothing planned."
              />
            ) : (
              weeks.map((week) => (
                <section key={week.weekStart.getTime()} className="min-w-0 space-y-2" data-rota-week>
                  <h4 className="text-sm font-semibold text-strong">{fmtWeek(week.weekStart)}</h4>
                  {week.services.length === 0 ? (
                    <RotaEmpty
                      title="No service this week"
                      description="Nothing is in the diary for these seven days."
                    />
                  ) : (
                    week.services.map((service) => (
                      <div key={service.eventId} className="min-w-0 space-y-1">
                        <p className="text-xs text-muted">
                          {fmtDay(service.startsAt)} · {service.eventTitle}
                        </p>
                        {service.items.length === 0 ? (
                          <RotaEmpty
                            title="No order of service yet"
                            description="Plan the order of service on the event to put people on it."
                          />
                        ) : (
                          <Scroller>
                            <ServiceTable
                              service={service}
                              people={people}
                              warned={warned}
                              onAssign={onAssign}
                              saving={saving}
                            />
                          </Scroller>
                        )}
                      </div>
                    ))
                  )}
                </section>
              ))
            )}
          </TabsContent>

          {/* ── Who is on, for one date ───────────────────────────────────── */}
          <TabsContent value="who" className="min-w-0 space-y-3">
            {loading ? (
              <RotaSkeleton />
            ) : read.failed || serviceDays.length === 0 ? (
              <RotaEmpty
                title={read.failed ? 'The rota could not be read' : 'No dated services'}
                description={
                  read.failed
                    ? 'Nothing is shown rather than an empty list, because an empty list would read as nobody being on.'
                    : 'A service needs a date before anybody can be on it.'
                }
              />
            ) : (
              <>
                <Select
                  value={selectedDay ? String(selectedDay.getTime()) : UNASSIGNED}
                  onValueChange={(value: unknown) => setDayKey(String(value))}
                >
                  <SelectTrigger className={`w-[184px] ${CONTROL}`} aria-label="Service date">
                    <SelectValue placeholder="Pick a date" />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceDays.map((d) => (
                      <SelectItem key={d.getTime()} value={String(d.getTime())}>{fmtDay(d)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {onDuty.length === 0 ? (
                  <RotaEmpty
                    title="Nothing on this date"
                    description="This service has no order of service yet, so there is nothing to be on."
                  />
                ) : (
                  <Scroller>
                    <Table data-rota-who>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[72px]">Time</TableHead>
                          <TableHead className="min-w-[160px]">Item</TableHead>
                          <TableHead className="w-[184px]">Who</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {onDuty.map((row) => (
                          <TableRow key={`${row.planId ?? row.eventId}:${row.item.id}`}>
                            <TableCell className="tabular-nums">{fmtClock(row.startsAt)}</TableCell>
                            <TableCell>{row.item.title.trim() || 'Untitled item'}</TableCell>
                            <TableCell>
                              {row.item.personName ? (
                                <span>{row.item.personName}</span>
                              ) : (
                                <Badge variant="outline">Unassigned</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Scroller>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Who has not served recently ───────────────────────────────── */}
          <TabsContent value="recent" className="min-w-0 space-y-3">
            {loading ? (
              <RotaSkeleton />
            ) : !recency.verdict.complete ? (
              /* 🔴 THE WHOLE POINT. A read that is not provably complete shows
                 an `empty` NAMING THE REASON — never a zero, and never a list
                 that would read as "nobody has been overlooked". */
              <RotaEmpty
                title="This cannot be worked out exactly"
                description={recency.verdict.reason ?? 'The read was not complete.'}
              />
            ) : recency.people.length === 0 ? (
              <RotaEmpty
                title="Everybody has served recently"
                description={`Every member has been on since ${fmtDay(recency.windowStart)}.`}
                icon={<UserRound aria-hidden="true" />}
              />
            ) : (
              <ItemGroup data-rota-recency>
                {recency.people.map((person) => (
                  <Item key={person.id} variant="outline" data-rota-person={person.id}>
                    <ItemMedia>
                      <Avatar>
                        <AvatarFallback>{initials(person.name)}</AvatarFallback>
                      </Avatar>
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{person.name}</ItemTitle>
                      <ItemDescription>
                        {fmtSince(person.lastServedAt, now)}
                        {person.nextScheduledAt ? ` · next on ${fmtDay(person.nextScheduledAt)}` : ''}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default VolunteerRotaView;
