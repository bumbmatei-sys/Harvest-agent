"use client";
/**
 * THE-324 — the admin side's data layer, and nothing else.
 *
 * ⚠️ EVERY LINE OF MARKUP LIVES IN `RotaInviteView.tsx`, for the reason part 1
 * and part 2 both split their views out: a view with no network in it can be
 * rendered by `renderToStaticMarkup` in the Chromium layout suite, so that suite
 * measures the SHIPPED component rather than a replica it has to pin.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 IT READS PARTS 1 AND 2'S DATA AND WRITES NONE OF IT.
 *
 * The services come from part 2's own `rotaServices(rotaEvent(...), plans)` over
 * part 2's own `useEvents` / `useRotaPlans` — not a second query and not a
 * second join. The invitations come from this feature's own route. 🔴 Nothing
 * here calls `saveServicePlanItems`, so no plan document is touched by this
 * panel at all: an invitation is a separate record, and parts 1 and 2 work
 * unchanged with every invitation deleted.
 *
 * 🔴 AND `findDoubleBookings()` IS NOT CALLED, WRAPPED OR RE-DERIVED. Part 1
 * wrote it and part 2 calls it; this ticket has no overlap question to ask.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE COMPLETENESS PROOF IS PART 2'S READS, JUDGED FOR THE **FUTURE**.
 *
 * ⚠️ `recencyVerdict` IS NOT REUSED, AND THAT IS DELIBERATE. It judges a read
 * that looks BACKWARD eight weeks; this figure looks FORWARD. `useEvents` orders
 * `startDate` DESC, so a truncated read drops the SOONEST events, not the
 * oldest — a church with more than a hundred future services would get next
 * April and not next Sunday. `servicesCompleteForHorizon` asks the question that
 * direction needs: did the event read reach back past NOW? If it did, every
 * event from here forward is in hand however many older ones fell off.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useEvents } from '../../hooks/queries/useEventQueries';
import { EVENTS_READ_LIMIT, useRotaPlans } from '../../hooks/queries/useVolunteerRotaQueries';
import {
  rotaInviteKeys,
  sendRotaInvitations,
  useRotaInvitations,
} from '../../hooks/queries/useRotaInviteQueries';
import { rotaEvent, rotaServices } from './volunteer-rota';
import { itemClockTimes } from './service-plan';
import RotaInviteView from './RotaInviteView';
import {
  buildRotaAcceptUrl,
  invitationMessage,
  reminderDue,
  servicesCompleteForHorizon,
  smsSegmentsFor,
  unfilledSlots,
} from './rota-invitations';

export interface RotaInvitePanelProps {
  tenantId: string | null;
  churchName?: string | null;
  /** Injected in tests so every clock is deterministic; the app passes nothing. */
  now?: Date;
}

/**
 * A token-shaped placeholder, ONLY for pricing a message before it is sent.
 *
 * 🔴 IT NEVER REACHES A DOCUMENT, A MESSAGE OR A LINK. A real token is 43
 * characters of base64url and so is this, which makes the composed body — and
 * therefore its SEGMENT COUNT — exactly the length the real one will be. That is
 * what lets the button say what pressing it costs BEFORE it is pressed, without
 * estimating: Harvest resells SMS and a reminder to twenty volunteers is twenty
 * charges on Harvest's own account.
 */
const PRICING_TOKEN = 'A'.repeat(43);

const RotaInvitePanel: React.FC<RotaInvitePanelProps> = ({ tenantId, churchName, now }) => {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ kind: 'sent' | 'failed'; message: string } | null>(null);

  const eventsQuery = useEvents(tenantId);
  const plansQuery = useRotaPlans(tenantId);
  const invitationsQuery = useRotaInvitations(tenantId);

  const at = now ?? new Date();
  const events = useMemo(() => (eventsQuery.data ?? []).map(rotaEvent), [eventsQuery.data]);
  const plans = plansQuery.data?.plans ?? [];

  const services = useMemo(
    () =>
      rotaServices(
        events,
        plans.map((p) => ({ id: p.id, eventId: p.eventId, name: p.name, items: p.items })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, plansQuery.data],
  );

  const invitations = invitationsQuery.data?.invitations ?? [];

  /** 🔴 Every field a fact, none an assumption. See the header. */
  const report = useMemo(() => {
    const dated = events
      .filter((e) => e.startsAt !== null)
      .map((e) => (e.startsAt as Date).getTime());
    const servicesComplete = servicesCompleteForHorizon(
      {
        failed: eventsQuery.isError || plansQuery.isError,
        plansTruncated: plansQuery.data?.truncated ?? false,
        eventsTruncated: (eventsQuery.data?.length ?? 0) >= EVENTS_READ_LIMIT,
        oldestEventStart: dated.length ? new Date(Math.min(...dated)) : null,
      },
      at,
    );
    return unfilledSlots(
      services,
      invitations,
      {
        failed: eventsQuery.isError || plansQuery.isError || invitationsQuery.isError,
        servicesComplete,
        invitationsTruncated: invitationsQuery.data?.truncated ?? false,
      },
      at,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, invitations, events, eventsQuery.isError, eventsQuery.data, plansQuery.isError, plansQuery.data, invitationsQuery.isError, invitationsQuery.data, at.getTime()]);

  /**
   * The NEXT dated service with a plan — what "Invite" acts on.
   *
   * ⚠️ THE NEXT ONE, NOT A CHOSEN ONE. That is the question an admin is actually
   * asking on a Tuesday, and the rota tab above already answers "which week".
   * A picker here would put a choice in front of the one action this panel has.
   */
  const nextService = useMemo(
    () =>
      services.find(
        (s) => s.planId !== null && s.startsAt !== null && s.startsAt.getTime() > at.getTime(),
      ) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, at.getTime()],
  );

  /**
   * What pressing Invite would send, and the MOST it could cost.
   *
   * ⚠️ AN UPPER BOUND, AND LABELLED AS ONE IN THE VIEW. The segment count is
   * EXACT per message — the URL's length is fully determined, so `smsSegmentsFor`
   * over the real composed body is not an estimate — but whether a given person
   * HAS a phone number is only known server-side, where the recipient is read
   * from `users/{personId}`. So this is the ceiling: nobody is billed more than
   * it, and a church without SMS is billed nothing at all.
   */
  const pending = useMemo(() => {
    if (!nextService || nextService.startsAt === null || nextService.planId === null) return null;
    const url = buildRotaAcceptUrl(tenantId ?? '', PRICING_TOKEN);
    let messages = 0;
    let smsSegments = 0;
    for (const clock of itemClockTimes(nextService.items, nextService.startsAt)) {
      if (!clock.item.personId) continue;
      if (clock.startsAt === null || clock.startsAt.getTime() <= at.getTime()) continue;
      messages += 1;
      if (invitationsQuery.data?.smsAvailable) {
        smsSegments += smsSegmentsFor(
          invitationMessage(
            {
              personName: clock.item.personName ?? '',
              eventTitle: nextService.eventTitle,
              itemTitle: clock.item.title,
              startsAt: clock.startsAt,
            },
            url,
            churchName ?? '',
            'invite',
          ).smsText,
        );
      }
    }
    return { messages, smsSegments };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextService, tenantId, churchName, invitationsQuery.data?.smsAvailable, at.getTime()]);

  const remindersDue = useMemo(
    () => invitations.filter((i) => reminderDue(i, at)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invitations, at.getTime()],
  );

  const send = useCallback(
    async (body: { action: 'invite'; planId: string } | { action: 'remind' }) => {
      setBusy(true);
      setOutcome(null);
      try {
        const result = await sendRotaInvitations(body);
        await queryClient.invalidateQueries({ queryKey: rotaInviteKeys.invitations(tenantId) });
        setOutcome({
          kind: 'sent',
          // 🔴 The segment count comes back from the SEND, so it is the
          // provider's own number and the one Harvest was billed for — not the
          // ceiling the button quoted.
          message:
            `${result.delivered} of ${result.attempted} reached someone`
            + (result.smsSegments > 0 ? `, using ${result.smsSegments} SMS segments.` : '.'),
        });
      } catch (e) {
        // 🔴 AN `alert`, NOT A TOAST. An admin who misses a toast believes
        // twenty people were told when nobody was.
        setOutcome({
          kind: 'failed',
          message:
            e instanceof Error && e.message ? e.message : 'The invitations could not be sent.',
        });
      } finally {
        setBusy(false);
      }
    },
    [queryClient, tenantId],
  );

  return (
    <RotaInviteView
      report={report}
      loading={eventsQuery.isLoading || plansQuery.isLoading || invitationsQuery.isLoading}
      pending={pending}
      remindersDue={remindersDue}
      smsUnavailable={invitationsQuery.data ? !invitationsQuery.data.smsAvailable : false}
      busy={busy}
      outcome={outcome}
      onInvite={() => {
        if (nextService?.planId) void send({ action: 'invite', planId: nextService.planId });
      }}
      onRemind={() => void send({ action: 'remind' })}
    />
  );
};

export default RotaInvitePanel;
