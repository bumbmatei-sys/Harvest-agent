"use client";
/**
 * THE-324 — the admin's side, rendered. NO FIRESTORE, NO REACT-QUERY, NO FETCH.
 *
 * ⚠️ SPLIT FROM `RotaInvitePanel.tsx` FOR THE REASON `ServicePlanRow.tsx` WAS
 * SPLIT FROM `ServicePlanPanel.tsx`, and the reason part 2 split its own view out: the
 * Chromium layout suite renders the REAL component with `renderToStaticMarkup`
 * instead of a hand-written replica, so the boxes it measures are the boxes a
 * church sees and there is no copy to pin against the original.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY ELEMENT THAT HAS A PRIMITIVE USES IT. THE MAP, ELEMENT BY ELEMENT —
 *    AND IT IS THE TICKET'S OWN MAPPING, NOT AN INTERPRETATION OF IT.
 *
 *   the panel ....................... `card`         Card / CardHeader / CardTitle /
 *                                                    CardDescription / CardContent /
 *                                                    CardFooter
 *   🔴 the unfilled-slot WARNING .... `alert`        Alert / AlertTitle /
 *                                                    AlertDescription
 *   one slot that needs an admin .... `item`         ItemGroup / Item / ItemMedia /
 *                                                    ItemContent / ItemTitle /
 *                                                    ItemDescription / ItemActions
 *   what is wrong with that slot .... `badge`        variant by severity
 *   invite / remind ................. `button-group` ButtonGroup + two Buttons
 *   🔴 nothing to show .............. `empty`        Empty / EmptyHeader /
 *                                                    EmptyMedia / EmptyTitle /
 *                                                    EmptyDescription
 *   🔴 loading ...................... `skeleton`     Skeleton
 *   between the summary and the list  `separator`    Separator
 *
 * 🔴 REJECTED, EACH WITH THE PRIMITIVE NAMED AND A REASON:
 *
 *   · `table` FOR THE WARNING LIST. Rejected. Part 2's rota grid IS a table because
 *     its rows share columns worth comparing across weeks. These rows do not:
 *     each is one slot with one problem and one action, and a four-column table
 *     would scroll sideways on a phone to say what an `item` says in place.
 *   · `progress` FOR "HOW FULL IS THE ROTA". Rejected, and no bar is drawn.
 *     THE-290 recorded `progress` at 2.30:1 in light and accepted it ONLY where
 *     every figure the bar depicts is written beside it — and here the figure
 *     ("4 slots need you") IS the whole content, so a bar would add contrast
 *     risk and convey nothing by length.
 *   · `dialog` TO CONFIRM SENDING. Rejected, and this one was genuinely close,
 *     because the action spends real money. It is refused because the SUMMARY
 *     ALREADY IS THE CONFIRMATION: the button says how many messages and how
 *     many SMS segments the press will cost, before the press. A modal that
 *     repeated that number would be a second place for it to be wrong, and a
 *     dismissal step on the one action this panel exists for.
 *   · `tooltip` FOR "WHY IS THIS UNANSWERED". Rejected for part 2's reason: a
 *     tooltip is a pointer-and-hover affordance and this product's primary
 *     platform is a phone, so the detail would be unreachable for the reader
 *     most likely to need it. The reason is written out as the item description.
 *   · `select` FOR "WHICH SERVICE TO INVITE". Rejected. The panel invites the
 *     NEXT service, which is the question an admin is actually asking on a
 *     Tuesday; a picker would add a choice before the action for a case the
 *     rota tab above already covers.
 *   · `collapsible`, `tabs`, `pagination`, `input`, `textarea`, `field`,
 *     `checkbox`, `switch`, `toggle`, `popover`, `dropdown-menu`, `avatar`,
 *     `sonner`. Rejected: this panel has no free text, no boolean, no menu, no
 *     second page and raises no toast — a failed send is an `alert` that STAYS
 *     on screen, because an admin who misses a toast believes twenty people were
 *     told when nobody was.
 *   · `accordion`. Not available — THE-321 verified no `accordion.tsx` exists.
 *
 * ⚠️ IF YOU FIND YOURSELF WRITING `<div className="rounded-lg border bg-card
 * p-4">`, THAT IS `card`. Nothing below does.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 "NO UNFILLED SLOTS" IS NEVER SAID UNLESS IT IS PROVED.
 *
 * `report.verdict.complete` is false when a read failed or was truncated, and
 * this file then renders the verdict's own REASON in an `empty` — never a zero,
 * never a green tick. A church looking at "every slot is filled" when in fact
 * the read failed would close the screen; that is the `Form submissions 0` bug
 * and it is worse than showing nothing because it is indistinguishable from an
 * answer. The `empty` and the "all filled" state are DIFFERENT COMPONENTS with
 * different words, so they cannot be confused by a reader or by a refactor.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY TAPPABLE TARGET IS ≥44px BELOW `sm`; RULE 4 TAKES OVER ABOVE IT.
 * ⚠️ THE FLOOR IS SPELLED `min-h-[44px]`, released at `sm:min-h-0`, with
 * `CONTROL_DENSITY.action` taking over above it. `min-height` beats `height`
 * outright, which is why the release is needed and why the pairing works where
 * `button`'s own `h-8` would otherwise win.
 *
 * ⚠️ PREMISE CORRECTED BY THE-323 (#465), AND RECORDED HERE RATHER THAN LEFT AS
 * IT WAS TOLD TO THIS TICKET: the Tailwind form `min-h-11` is NOT inert. It
 * measures 44.0px below `sm`, where the root is 16px, and THE-316's
 * `TOUCH_FLOOR = 'min-h-11 sm:min-h-0'` is a working floor. The 7.63px figure
 * this ticket was handed is a REAL number from a DIFFERENT bug — `transition-all`
 * animating min-height from 0 after layout, which drifts run to run. This
 * suite's own Chromium pass hit exactly that drift and had to wait it out, which
 * is the same artefact seen from the other side.
 *
 * 🔴 THE EXPLICIT FORM IS STILL RIGHT HERE, for the reason THE-323 gives rather
 * than the one this ticket was given: `min-h-11` is REM-RELATIVE and globals.css
 * trims the root ~9% at `lg`+, so the two diverge above 1024px (39.875px against
 * 44px). `min-h-[44px]` says the number it means at every width. That is a
 * reason to prefer it — not evidence the other never worked.
 * ⚠️ NO WIDTH IS INVENTED: the container is the screen's, and the scroller's
 * `min-w-0` is what makes the overflow rather than capping anything.
 */
import React from 'react';
import { CalendarX, CircleCheck, Mail, Send, TriangleAlert } from 'lucide-react';

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
import { Skeleton } from '@/components/ui/skeleton';

import { CONTROL_DENSITY } from '../layout/form-layout';
import {
  countByProblem,
  fmtLongDay,
  fmtTime,
  problemLabel,
  type SlotProblem,
  type SlotWarning,
  type UnfilledReport,
} from './rota-invitations';

export interface RotaInviteViewProps {
  /** 🔴 Never a partial answer — see `unfilledSlots`. */
  report: UnfilledReport;
  loading: boolean;
  /** How many messages "Invite" would send, and what they would cost. */
  pending: { messages: number; smsSegments: number } | null;
  /** How many reminders are due right now. */
  remindersDue: number;
  /** 🔴 True when the tenant's plan has no SMS. Email still carries everything. */
  smsUnavailable: boolean;
  busy: boolean;
  /** The last send's outcome, or a failure. Rendered as an `alert`, never a toast. */
  outcome: { kind: 'sent' | 'failed'; message: string } | null;
  onInvite: () => void;
  onRemind: () => void;
}

/** The one place the phone floor and Rule 4 are spelled for a button here. */
const ACTION_BUTTON = `min-h-[44px] min-w-[44px] sm:min-h-0 flex-1 ${CONTROL_DENSITY.action}`;

const BADGE_VARIANT: Record<SlotProblem, 'destructive' | 'secondary' | 'outline'> = {
  // Nobody at all, and somebody who said no, are the two an admin must act on.
  unfilled: 'destructive',
  declined: 'destructive',
  uninvited: 'secondary',
  unanswered: 'outline',
};

const whenOf = (w: SlotWarning): string =>
  w.startsAt ? `${fmtLongDay(w.startsAt)}, ${fmtTime(w.startsAt)}` : 'No date';

const RotaInviteView: React.FC<RotaInviteViewProps> = ({
  report,
  loading,
  pending,
  remindersDue,
  smsUnavailable,
  busy,
  outcome,
  onInvite,
  onRemind,
}) => {
  const counts = countByProblem(report.warnings);
  const needsSomebody = counts.unfilled + counts.declined;

  return (
    <Card data-rota-invite-card>
      <CardHeader>
        <CardTitle>Invitations and unfilled slots</CardTitle>
        <CardDescription>
          The next {report.horizonDays} days. Everyone assigned can accept or decline.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 🔴 `skeleton` — the loading state, and it is not an empty list. */}
        {loading ? (
          <div data-rota-invite-loading className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : !report.verdict.complete ? (
          /* 🔴 THE READ WAS NOT PROVABLY COMPLETE, SO NO FIGURE SHIPS. The
             verdict's own sentence, verbatim — never "no unfilled slots". */
          <Empty data-rota-invite-unknown>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarX aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Unfilled slots cannot be shown</EmptyTitle>
              <EmptyDescription>{report.verdict.reason}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : report.warnings.length === 0 ? (
          <Empty data-rota-invite-all-filled>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheck aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Every slot is filled and answered</EmptyTitle>
              <EmptyDescription>
                Nothing in the next {report.horizonDays} days needs you.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {/* 🔴 `alert` — the ticket's own mapping for a warning. */}
            <Alert
              data-rota-slot-warning
              variant={needsSomebody > 0 ? 'destructive' : 'default'}
            >
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>
                {report.warnings.length} slot{report.warnings.length === 1 ? '' : 's'} need
                {report.warnings.length === 1 ? 's' : ''} you
              </AlertTitle>
              <AlertDescription>
                {counts.unfilled} with nobody assigned · {counts.uninvited} not invited yet ·{' '}
                {counts.unanswered} awaiting a reply · {counts.declined} declined
              </AlertDescription>
            </Alert>

            <Separator />

            <ItemGroup data-rota-slot-list>
              {report.warnings.map((w) => (
                <Item key={w.key} data-rota-slot-row>
                  <ItemMedia variant="icon">
                    <CalendarX aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{w.itemTitle || 'Untitled item'}</ItemTitle>
                    <ItemDescription>
                      {whenOf(w)} · {w.eventTitle}
                      {w.personName ? ` · ${w.personName}` : ''}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant={BADGE_VARIANT[w.problem]}>{problemLabel(w.problem)}</Badge>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </>
        )}

        {/* 🔴 THE SMS-LESS FALLBACK, SAID OUT LOUD RATHER THAN LEFT TO BE
            DISCOVERED. A church on Individual or Small Team has no SMS at all;
            everything here still works because the invitation and its accept
            link are created whether or not anything is texted, and the email
            carries the link. This is a statement of fact, not an upsell and not
            an error the admin has to clear. */}
        {smsUnavailable && (
          <Alert data-rota-no-sms>
            <Mail aria-hidden="true" />
            <AlertTitle>Invitations go out by email</AlertTitle>
            <AlertDescription>
              Text messages are part of the Ministry plan. Everything here works without
              them — each person gets an emailed link to accept or decline.
            </AlertDescription>
          </Alert>
        )}

        {outcome !== null && (
          <Alert
            data-rota-send-outcome
            variant={outcome.kind === 'failed' ? 'destructive' : 'default'}
          >
            <AlertTitle>{outcome.kind === 'failed' ? 'Nothing was sent' : 'Sent'}</AlertTitle>
            <AlertDescription>{outcome.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>

      <CardFooter>
        {/* 🔴 `button-group`, and each label CARRIES THE COST BEFORE THE PRESS:
            Harvest resells SMS, so a reminder to twenty volunteers is twenty
            charges on Harvest's own account, billed to the church. An admin
            should never have to guess what a button spends. */}
        <ButtonGroup className="w-full" aria-label="Send invitations or reminders">
          <Button
            type="button"
            className={ACTION_BUTTON}
            disabled={busy || !pending || pending.messages === 0}
            aria-label="Invite everyone on the next service"
            onClick={onInvite}
          >
            <Send aria-hidden="true" />
            {pending && pending.messages > 0
              ? `Invite ${pending.messages}${pending.smsSegments > 0 ? ` · ${pending.smsSegments} SMS` : ''}`
              : 'Nobody to invite'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={ACTION_BUTTON}
            disabled={busy || remindersDue === 0}
            aria-label="Send reminders that are due"
            onClick={onRemind}
          >
            <Mail aria-hidden="true" />
            {remindersDue > 0 ? `Remind ${remindersDue}` : 'No reminders due'}
          </Button>
        </ButtonGroup>
      </CardFooter>
    </Card>
  );
};

export default RotaInviteView;
