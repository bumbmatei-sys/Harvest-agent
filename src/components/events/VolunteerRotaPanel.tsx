"use client";
/**
 * THE-317 — the rota's data layer, and nothing else.
 *
 * ⚠️ EVERY LINE OF MARKUP LIVES IN `VolunteerRotaView.tsx`. This file exists to
 * hold the three reads, turn them into the two plain values the view takes
 * (`services` and `read`), and route one assignment into part 1's own write. The
 * split is `ServicePlanPanel` / `ServicePlanRow`'s, for its reason: a view with
 * no Firestore in it can be rendered by `renderToStaticMarkup` in the Chromium
 * layout suite, so that suite measures the shipped component rather than a
 * replica it then has to pin.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE WRITE IS PART 1'S, VERBATIM. `saveServicePlanItems(tenantId, planId,
 * name, items)` — the same function `ServicePlanPanel` calls, re-exported by the
 * rota's query module rather than reimplemented. So:
 *
 *   · #449's ITEM SHAPE CANNOT CHANGE, because this file never constructs one.
 *     `assignPerson()` maps over the items part 1 read and replaces two fields
 *     on one of them; `writableItems` inside part 1's write is what decides what
 *     reaches Firestore, unchanged.
 *   · ONLY ONE TIMESTAMP REPRESENTATION IS EVER WRITTEN, because part 1's
 *     `stamped()` is the only thing here that writes one and it is
 *     `serverTimestamp()`. Nothing in this feature calls `toISOString()`,
 *     `Date.now()` or `String(date)` into a document.
 *
 * 🔴 AND NOTHING IS SENT. Assigning somebody writes a document and invalidates a
 * query. It does not email, text, notify or push. THE-314 shipped SMS and
 * reported a send interface for PART 3 — invite, accept, remind — to call; this
 * file does not import it and `the-317-guards.test.ts` sweeps every file in this
 * feature for any send at all.
 *
 * ⚠️ THE FAILED READ IS NOT SWALLOWED. `read.failed` is handed to the view,
 * which renders an `empty` naming the reason. An error caught into `[]` here
 * would render an empty rota — indistinguishable from a church with nothing
 * planned, which is the `Form submissions 0` class this ticket names.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { notifyError } from '../../utils/notify';
import { useEvents } from '../../hooks/queries/useEventQueries';
import {
  EVENTS_READ_LIMIT,
  rotaKeys,
  saveServicePlanItems,
  useRotaPlans,
  useServicePeople,
} from '../../hooks/queries/useVolunteerRotaQueries';
import VolunteerRotaView, { type RotaPerson } from './VolunteerRotaView';
import {
  assignPerson,
  rotaEvent,
  rotaServices,
  type RotaReadState,
} from './volunteer-rota';

export interface VolunteerRotaPanelProps {
  tenantId: string | null;
  /** Injected in tests so every clock is deterministic; the app passes nothing. */
  now?: Date;
}

const VolunteerRotaPanel: React.FC<VolunteerRotaPanelProps> = ({ tenantId, now }) => {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const eventsQuery = useEvents(tenantId);
  const plansQuery = useRotaPlans(tenantId);
  const peopleQuery = useServicePeople(tenantId);

  const events = useMemo(() => (eventsQuery.data ?? []).map(rotaEvent), [eventsQuery.data]);
  const plans = plansQuery.data?.plans ?? [];

  const services = useMemo(
    () => rotaServices(events, plans.map((p) => ({ id: p.id, eventId: p.eventId, name: p.name, items: p.items }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, plansQuery.data],
  );

  /**
   * 🔴 WHAT THE READS ACTUALLY PROVED. This object is the whole input to
   * `recencyVerdict`, and every field is a fact rather than an assumption.
   *
   * ⚠️ `eventsTruncated` compares against `EVENTS_READ_LIMIT`, which is spelled
   * in the query module and pinned by the guards against `useEventQueries.ts`'s
   * own `limit(100)`. If those two ever disagreed this figure would be wrong in
   * one direction or the other, so neither is allowed to move alone.
   */
  const read: RotaReadState = useMemo(() => {
    const dated = events.filter((e) => e.startsAt !== null).map((e) => (e.startsAt as Date).getTime());
    return {
      failed: eventsQuery.isError || plansQuery.isError || peopleQuery.isError,
      plansTruncated: plansQuery.data?.truncated ?? false,
      eventsTruncated: (eventsQuery.data?.length ?? 0) >= EVENTS_READ_LIMIT,
      oldestEventStart: dated.length ? new Date(Math.min(...dated)) : null,
    };
  }, [events, eventsQuery.isError, eventsQuery.data, plansQuery.isError, plansQuery.data, peopleQuery.isError]);

  const people: RotaPerson[] = peopleQuery.data ?? [];

  const onAssign = useCallback(
    async (planId: string, itemId: string, person: RotaPerson | null) => {
      if (!tenantId) return;
      const plan = plansQuery.data?.plans.find((p) => p.id === planId);
      if (!plan) return;
      setSaving(true);
      try {
        // 🔴 Part 1's write, with part 1's items. Nothing new is persisted.
        await saveServicePlanItems(tenantId, planId, plan.name, assignPerson(plan.items, itemId, person));
        await queryClient.invalidateQueries({ queryKey: rotaKeys.plans(tenantId) });
        // Part 1's own key too, so a run sheet open on the event agrees.
        await queryClient.invalidateQueries({ queryKey: ['servicePlan', tenantId, plan.eventId] });
      } catch (error) {
        notifyError('Saving that assignment', error);
      } finally {
        setSaving(false);
      }
    },
    [tenantId, plansQuery.data, queryClient],
  );

  return (
    <VolunteerRotaView
      services={services}
      people={people}
      read={read}
      loading={eventsQuery.isLoading || plansQuery.isLoading || peopleQuery.isLoading}
      now={now ?? new Date()}
      onAssign={onAssign}
      saving={saving}
    />
  );
};

export default VolunteerRotaPanel;
