/**
 * THE-308 — a month grid for the events screen.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHICH PRIMITIVE DRAWS WHAT. Nothing here is hand-rolled markup; every
 * element below names the primitive that covers it, and the guard asserts both
 * halves — that the import is present AND that the hand-written substitute is
 * absent.
 *
 *   the surrounding panel ................ `card`     (Card/Header/Title/Content)
 *   THE MONTH GRID ITSELF ................ `calendar` (Calendar + CalendarDayButton)
 *   month back / forward ................. `calendar`'s own nav — see below
 *   "Today" .............................. `button`
 *   a day's event row .................... `item`     (Item/ItemContent/ItemTitle…)
 *   the rows as a set .................... `item`     (ItemGroup)
 *   a status pill ........................ `badge`
 *   nothing to show ...................... `empty`
 *   loading .............................. `skeleton`
 *
 * ⚠️ THE GRID IS NOT DRAWN HERE. `calendar` IS react-day-picker, which already
 * emits a real `<table>` with `role="grid"`, column headers, roving focus,
 * arrow-key and PageUp/PageDown navigation, and `aria-selected`. Hand-rolling
 * 28–31 cells would have reimplemented all of that and shipped none of it — the
 * exact failure mode the ~2,000 lines across RetentionHeatmap, ServicePlanPanel,
 * FormAnswersView, AdminSms and SmsSection are made of. The month grid was the
 * one thing this ticket was really about, and the primitive already was one.
 *
 * ── 🔵 The primitive deliberately NOT used, and why ─────────────────────────
 *
 * `popover`, which the card named alongside `calendar`. A Popover anchored to a
 * day is the obvious way to show that day's events, and it is the wrong one on
 * this surface: the anchor is a 44px cell that a thumb covers while pressing
 * it, the panel would overlay the neighbouring days a reader is comparing
 * against, and it evaporates on the next tap — so reading Saturday after Friday
 * costs two taps and a dismissed layer. The day panel below the grid is
 * persistent, is already in the tab order, needs no collision handling at
 * 380px, and re-renders in place as the selection moves. `popover` fits a
 * transient disclosure over a pointer target; this is neither.
 *
 * `table` for the grid, for the same reason it is not hand-rolled: `calendar`
 * already renders one, with the calendar semantics `table` alone would not add.
 *
 * ── 🔴 The 44px floor, and how ONE variable carries the whole surface ───────
 *
 * `calendar` ships `[--cell-size:--spacing(7)]` — 28px. Every tappable thing it
 * draws is sized from that one variable: the day buttons (`min-w-(--cell-size)`,
 * `aspect-square`) AND the month nav arrows (`size-(--cell-size)`). So the
 * floor is set once, on the root, and released above `sm` exactly as Rule 4
 * releases every other control:
 *
 *     [--cell-size:44px] sm:[--cell-size:38px]
 *
 * ⚠️ The premise this ticket was handed — that seven columns cannot each be
 * 44px at 380px — is arithmetically false, and the measured suite says so: 7 ×
 * 44 = 308px of cells inside `calendar`'s own `p-2`, which is 324px in a 380px
 * viewport. It was never the column count that made the cells small; it was the
 * primitive's default. The 38px above `sm` is `DENSITY_PX.control`, asserted
 * against the constant rather than retyped, so the two cannot drift.
 * ═════════════════════════════════════════════════════════════════════════════
 */
'use client';

import React from 'react';
import { CalendarDays, Globe, MapPin } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';

import { CONTROL_DENSITY } from '../layout/form-layout';

import {
  daysWithEvents,
  eventsByDay,
  eventsOn,
  type MonthEvent,
  type MonthRead,
} from './month-view';

/** Status → the `badge` variant that carries it. No colour is named here. */
const STATUS_VARIANT: Record<MonthEvent['status'], React.ComponentProps<typeof Badge>['variant']> = {
  published: 'default',
  draft: 'secondary',
  cancelled: 'destructive',
  completed: 'outline',
};

const timeOf = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const monthLabel = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

const dayLabel = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

export interface EventMonthViewProps {
  read: MonthRead | undefined;
  loading: boolean;
  /** Injected so the grid is deterministic under test. Defaults to now. */
  today?: Date;
  onOpenEvent?: (id: string) => void;
}

const EventMonthView: React.FC<EventMonthViewProps> = ({
  read,
  loading,
  today,
  onOpenEvent,
}) => {
  const now = React.useMemo(() => today ?? new Date(), [today]);
  const [month, setMonth] = React.useState<Date>(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selected, setSelected] = React.useState<Date | undefined>(now);

  // The conditional lives INSIDE the memo: a `? :` outside it builds a new []
  // on every render, which makes the memo's dependency change every time and
  // re-buckets every event on each keystroke of the month nav.
  const byDay = React.useMemo(
    () => eventsByDay(read?.kind === 'complete' ? read.events : []),
    [read],
  );
  const marked = React.useMemo(() => daysWithEvents(byDay, month), [byDay, month]);
  const dayEvents = React.useMemo(() => eventsOn(byDay, selected), [byDay, selected]);

  /**
   * The day cell. `CalendarDayButton` is already a `Button` laid out
   * `flex-col gap-1` with `[&>span]:text-xs` — it is built to take a second
   * line under the date, which is exactly what a count is.
   */
  const DayButton = React.useCallback(
    (props: React.ComponentProps<typeof CalendarDayButton>) => {
      const count = eventsOn(byDay, props.day.date).length;
      const { children, ...rest } = props;
      return (
        <CalendarDayButton {...rest}>
          {children}
          {count > 0 && (
            <>
              <span aria-hidden="true" data-event-count={count}>
                {count}
              </span>
              <span className="sr-only">
                {count === 1 ? '1 event' : `${count} events`}
              </span>
            </>
          )}
        </CalendarDayButton>
      );
    },
    [byDay],
  );

  if (loading) {
    return (
      <Card data-month-view>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-5 w-40" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-2 sm:px-6">
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  /**
   * 🔴 A read that is not provably complete draws an `empty` that SAYS so.
   *
   * Not an empty grid: a month with no dots and a month nobody could read are
   * the same picture, and one of them is a church being told it has no services
   * on a Sunday it is running one.
   */
  if (!read || read.kind === 'unavailable') {
    return (
      <Card data-month-view>
        <CardContent className="px-2 sm:px-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarDays />
              </EmptyMedia>
              <EmptyTitle>The month view is unavailable</EmptyTitle>
              <EmptyDescription>
                {read?.reason ?? 'The events could not be read.'} The list view is unaffected.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-month-view>
      <CardHeader>
        <CardTitle>{monthLabel(month)}</CardTitle>
        <CardAction>
          {/*
            Month back/forward are `calendar`'s OWN nav — it draws them, sizes
            them from `--cell-size` and wires them to `onMonthChange`. Adding a
            second pair here would be the hand-written substitute. "Today" is
            the one control the primitive does not have.
          */}
          {/*
            ⚠️ NOT `size="sm"`. Measured, that lands the button at 25.38px above
            `lg` — under Rule 4's density and out of step with every other
            control on an admin screen. `CONTROL_DENSITY.control` is the 38px
            Rule 4 settled, taken from the module rather than retyped.
          */}
          <Button
            variant="outline"
            className={`min-h-[44px] sm:min-h-0 ${CONTROL_DENSITY.control}`}
            onClick={() => {
              const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              setMonth(new Date(t.getFullYear(), t.getMonth(), 1));
              setSelected(t);
            }}
          >
            Today
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 px-2 sm:px-6">
        <Calendar
          mode="single"
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={setSelected}
          showOutsideDays={false}
          className="w-full [--cell-size:44px] sm:[--cell-size:38px]"
          modifiers={{ hasEvents: marked }}
          components={{ DayButton }}
        />

        <div className="space-y-2" data-day-panel>
          <h3 className="text-sm font-medium">
            {selected ? dayLabel(selected) : 'No day selected'}
          </h3>

          {dayEvents.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Nothing scheduled</EmptyTitle>
                <EmptyDescription>
                  {selected
                    ? 'This day has no events.'
                    : 'Choose a day to see what is on.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup>
              {dayEvents.map((ev) => (
                /*
                  ⚠️ `render={<button/>}` rather than an Item wrapping a button:
                  the Item IS the tap target, so the 44px floor belongs to the
                  same box that receives the press. Wrapping would split the row
                  into a large box containing a small target — THE-316's
                  "Customize Navigation" defect, which its guard asserts by
                  tagName for exactly this reason.
                */
                <Item
                  key={ev.id}
                  variant="outline"
                  className="min-h-[44px] sm:min-h-0"
                  {...(onOpenEvent
                    ? { render: <button type="button" onClick={() => onOpenEvent(ev.id)} /> }
                    : {})}
                >
                  <ItemMedia variant="icon">
                    {ev.isOnline ? <Globe /> : <MapPin />}
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{ev.title || 'Untitled event'}</ItemTitle>
                    <ItemDescription>
                      {[
                        ev.start ? timeOf(ev.start) : null,
                        ev.isOnline ? 'Online' : ev.location || null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant={STATUS_VARIANT[ev.status]}>{ev.status}</Badge>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}

          {/*
            🔴 Events with no `startDate` belong to no cell. Saying how many is
            the difference between a complete read and one that merely looks it.
          */}
          {read.undated > 0 && (
            <p className="text-sm text-muted-foreground" data-undated={read.undated}>
              {read.undated === 1
                ? '1 event has no date set and is not shown on the grid.'
                : `${read.undated} events have no date set and are not shown on the grid.`}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default EventMonthView;
