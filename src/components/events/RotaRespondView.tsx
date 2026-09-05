"use client";
/**
 * THE-324 — 🔵 THE VOLUNTEER-FACING VIEW. Part 2 deferred the decision here, and
 * this is it: the accept page IS the view, and there is no second surface.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔵 DOES A VOLUNTEER-FACING VIEW BELONG, AND WHERE? YES — HERE, AT
 *    `/rota/{token}`, POST-HOP, WITH NO SIGN-IN. THE REASONING, IN FULL:
 *
 *   · NOT ON "MY EVENTS". Part 2 already gave the reason and it holds: My Events
 *     reads `registrations`, and a rota assignment is not a registration. A
 *     member REGISTERED for an event; a rota admin PUT them on one. Filing both
 *     under one heading is how somebody comes to believe declining a slot
 *     cancelled their ticket.
 *
 *   · NOT A NEW SIGNED-IN TAB EITHER, and this is the load-bearing half.
 *     THE-138: the `theharvest.app` → `<tenant>.theharvest.app` hop ENDS the
 *     Firebase session, so reaching a member-app tab from a text message means
 *     signing in twice. THE-289 established that anything before that hop is a
 *     step the member never finishes. A volunteer opens this from an SMS on a
 *     Tuesday evening; a surface they cannot reach is not a surface.
 *
 *   · SO IT IS THE PAGE THE LINK ALREADY LANDS ON. One URL answers both
 *     questions a volunteer has — "am I on?" and "what else am I on for?" —
 *     with no account, no second sign-in and no new tab in the member app.
 *
 * ⚠️ AND IT SHOWS ONLY THIS PERSON'S OWN ROWS. A bearer token must reveal no
 * more than its holder already knows, so `myAssignments` filters to
 * `personId === current.personId`. No other member is named, no roster is
 * listed, and 🔴 NO PLACE APPEARS ANYWHERE — THE-283's "never a member alongside
 * a location" is a property of `RotaInvitation`, which has no place field for
 * this file to render even carelessly.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY ELEMENT THAT HAS A PRIMITIVE USES IT. THE MAP, ELEMENT BY ELEMENT.
 *
 *   the invitation .................. `card`         Card / CardHeader / CardTitle /
 *                                                    CardDescription / CardContent /
 *                                                    CardFooter
 *   accept or decline ............... `button-group` ButtonGroup + two Buttons
 *                                                    🔴 the ticket's own mapping
 *   the answer, once given .......... `badge`        Badge
 *   a failed save ................... `alert`        Alert / AlertTitle /
 *                                                    AlertDescription
 *   one other assignment ............ `item`         ItemGroup / Item / ItemMedia /
 *                                                    ItemContent / ItemTitle /
 *                                                    ItemDescription / ItemActions
 *   nothing else booked ............. `empty`        Empty / EmptyHeader /
 *                                                    EmptyMedia / EmptyTitle /
 *                                                    EmptyDescription
 *   between the answer and the list .. `separator`   Separator
 *
 * 🔴 REJECTED, EACH WITH THE PRIMITIVE NAMED AND A REASON — because "it did not
 * fit" without naming one is not an answer:
 *
 *   · `dialog` / `sheet` TO CONFIRM A DECLINE. Rejected. The action is one tap
 *     and is fully reversible — the other button is right there afterwards — so
 *     a modal would add a dismissal step to the only thing this page exists for,
 *     for a volunteer standing at a bus stop. `dialog` is used by nothing here.
 *   · `tabs` FOR "THIS ONE" vs "EVERYTHING ELSE". Rejected. There are two
 *     sections and the page is short; a tab would hide half of a page that fits
 *     on one screen behind a control, and the second half is the answer to a
 *     question the reader did not have to ask.
 *   · `table` FOR THE OTHER ASSIGNMENTS. Rejected. `table` is right when rows
 *     share columns worth comparing — part 2's rota grid is exactly that. This
 *     is one person's own short list with a date and a title, which is `item`'s
 *     shape, and a two-column table on a 380px phone would scroll sideways to
 *     say less.
 *   · `skeleton` FOR LOADING. Rejected, and there is nothing to reject it for:
 *     this page is SERVER-RENDERED with its data already in hand, so it has no
 *     loading state to draw. The admin panel has one, and uses `skeleton` there.
 *   · `select`, `input`, `textarea`, `field`, `checkbox`, `switch`, `toggle`,
 *     `popover`, `dropdown-menu`, `tooltip`, `progress`, `pagination`, `avatar`,
 *     `collapsible`, `table`, `sonner`. Rejected: this page has no form field, no
 *     boolean, no menu, no series, no hover surface, no second page and raises no
 *     toast — a failed save is an `alert` that stays on screen, because a toast a
 *     volunteer misses means they believe they answered when they did not.
 *   · `accordion`. Not available — THE-321 verified no `accordion.tsx` exists —
 *     and not wanted, for `collapsible`'s reason.
 *
 * ⚠️ IF YOU FIND YOURSELF WRITING `<div className="rounded-lg border bg-card
 * p-4">`, THAT IS `card`. Nothing below does.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY TAPPABLE TARGET IS ≥44px BELOW `sm`, AND RULE 4 TAKES OVER ABOVE IT.
 *
 * ⚠️ The floor is spelled `min-h-[44px]`, released at `sm:min-h-0`, with
 * `CONTROL_DENSITY.action` (40px) taking over above it. `min-height` beats
 * `height` outright, which is why the release is needed and why the pairing
 * works where `button`'s own `h-8` would otherwise win.
 *
 * ⚠️ PREMISE CORRECTED BY THE-323 (#465): the Tailwind form `min-h-11` is NOT
 * inert — it measures 44.0px below `sm`, where the root is 16px. The 7.63px
 * figure this ticket was handed came from a DIFFERENT bug: `transition-all`
 * animating min-height from 0 after layout, a drifting value this ticket's own
 * Chromium suite independently ran into and had to wait out. The explicit form
 * is still what ships, because `min-h-11` is rem-relative and globals.css trims
 * the root ~9% at `lg`+, so the two diverge above 1024px.
 *
 * ⚠️ NO WIDTH IS INVENTED. The page measure is `FORM_MEASURE` — Rule 1b, "a form
 * is not a data-dense page" — because this surface is one question with two
 * answers, not a grid.
 */
import React, { useCallback, useState } from 'react';
import { CalendarCheck, CalendarX, Check, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';

import { CONTROL_DENSITY, FORM_MEASURE } from '../layout/form-layout';
import {
  fmtLongDay,
  fmtTime,
  statusLabel,
  type InvitationStatus,
} from './rota-invitations';

/**
 * One row this page renders. 🔴 A `Date` becomes an epoch number at the server
 * boundary and back to a `Date` here — never a formatted string in between, and
 * never an ISO string anywhere, because this feature has ONE date
 * representation and a second one crossing the wire is how it would gain a
 * second one in a document.
 */
export interface RespondRow {
  id: string;
  eventTitle: string;
  itemTitle: string;
  startsAtMs: number;
  status: InvitationStatus;
}

export interface RotaRespondViewProps {
  churchName: string;
  personName: string;
  current: RespondRow;
  /** This person's OTHER upcoming assignments. Never anybody else's. */
  upcoming: readonly RespondRow[];
  /** Answers the invitation. Resolves to the new status, or throws. */
  onAnswer: (answer: 'accepted' | 'declined') => Promise<InvitationStatus>;
}

/** The one place the phone floor and Rule 4 are spelled for a button here. */
const ANSWER_BUTTON = `min-h-[44px] min-w-[44px] sm:min-h-0 flex-1 ${CONTROL_DENSITY.action}`;

const when = (ms: number): string => {
  const d = new Date(ms);
  return `${fmtLongDay(d)}, ${fmtTime(d)}`;
};

const StatusBadge: React.FC<{ status: InvitationStatus }> = ({ status }) => (
  <Badge
    data-rota-status
    variant={status === 'accepted' ? 'default' : status === 'declined' ? 'outline' : 'secondary'}
  >
    {statusLabel(status)}
  </Badge>
);

const RotaRespondView: React.FC<RotaRespondViewProps> = ({
  churchName,
  personName,
  current,
  upcoming,
  onAnswer,
}) => {
  const [status, setStatus] = useState<InvitationStatus>(current.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = useCallback(
    async (choice: 'accepted' | 'declined') => {
      setBusy(true);
      setError(null);
      try {
        setStatus(await onAnswer(choice));
      } catch (e) {
        // 🔴 AN `alert`, NOT A TOAST. A toast a volunteer misses leaves them
        // believing they answered when they did not, and the admin chasing a
        // slot that is already covered.
        setError(
          e instanceof Error && e.message
            ? e.message
            : 'That could not be saved. Please try again.',
        );
      } finally {
        setBusy(false);
      }
    },
    [onAnswer],
  );

  return (
    <div data-rota-respond className={`w-full ${FORM_MEASURE} p-4 space-y-4`}>
      <Card data-rota-invitation>
        <CardHeader>
          <CardTitle>You are on for {when(current.startsAtMs)}</CardTitle>
          <CardDescription>
            {current.eventTitle} · {churchName}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            {personName}, you are down for <strong>{current.itemTitle || 'a slot'}</strong> at{' '}
            {fmtTime(new Date(current.startsAtMs))}.
          </p>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
          </div>
          {error !== null && (
            <Alert variant="destructive" data-rota-error>
              <AlertTitle>That could not be saved</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter>
          {/* 🔴 `button-group` — the ticket's own mapping for accept/decline. */}
          <ButtonGroup className="w-full" aria-label="Accept or decline this slot">
            <Button
              type="button"
              className={ANSWER_BUTTON}
              disabled={busy}
              aria-label="Accept this slot"
              onClick={() => void answer('accepted')}
            >
              <Check aria-hidden="true" />
              Yes, I can
            </Button>
            <Button
              type="button"
              variant="outline"
              className={ANSWER_BUTTON}
              disabled={busy}
              aria-label="Decline this slot"
              onClick={() => void answer('declined')}
            >
              <X aria-hidden="true" />
              Sorry, I cannot
            </Button>
          </ButtonGroup>
        </CardFooter>
      </Card>

      <Separator />

      <Card data-rota-upcoming>
        <CardHeader>
          <CardTitle>What else you are on for</CardTitle>
          <CardDescription>Your own upcoming slots. Nobody else&apos;s.</CardDescription>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarX aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Nothing else booked</EmptyTitle>
                <EmptyDescription>
                  This is your only upcoming slot at {churchName}.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup>
              {upcoming.map((row) => (
                <Item key={row.id} data-rota-upcoming-row>
                  <ItemMedia variant="icon">
                    <CalendarCheck aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{row.itemTitle || 'A slot'}</ItemTitle>
                    <ItemDescription>
                      {when(row.startsAtMs)} · {row.eventTitle}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <StatusBadge status={row.status} />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default RotaRespondView;
