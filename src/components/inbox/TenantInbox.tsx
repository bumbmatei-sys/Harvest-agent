"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { Inbox as InboxIcon } from 'lucide-react';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CONFIRM_ALREADY, CONFIRM_BUTTON, CONFIRM_BUTTON_HELP, CONFIRM_FAILED, CONFIRM_SUCCESS,
  INBOX_CEILING, INBOX_EMPTY_BODY, INBOX_EMPTY_TITLE, INBOX_FAILED_BODY, INBOX_FAILED_TITLE,
  INBOX_INTRO, INBOX_TITLE, INBOX_TRIGGER_LABEL,
  inboxBadgeLabel, inboxRowSummary,
} from '@/lib/event-payment-claims';
import { CONTROL_DENSITY } from '../layout/form-layout';
import { confirmPaymentClaim, fetchPaymentInbox, type InboxPayload } from './payment-claims-client';

/**
 * THE-351 — 🔴 THE TENANT INBOX. In EVERY tenant, top right, on BOTH shells.
 *
 * THE FOUNDER: "Put inbox in all tenants in top right where this will appear,
 * that someone pressed on I paid and they have to confirm it."
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 1. WHAT IT IS NOT — `PlatformInbox` IS THE WRONG SCOPE, NOT A BASE CLASS
 *
 * `components/PlatformInbox.tsx` exists and reads the top-level
 * `platform_inbox` collection with NO tenant filter, fed by
 * `api/contact/route.ts`, for the SUPER ADMIN. Its shape was read and is
 * followed — a list, a row, a status the reader changes — and its COLLECTION
 * and its SCOPE are deliberately not reused: one church seeing another church's
 * payment claims is the failure this ticket must make impossible, and
 * `platform_inbox` is a collection with no tenant in its path at all.
 *
 * ⚠️ It also does the two things this must not: `limit(300)` with NO `orderBy`
 * (#405's defect — 300 ARBITRARY documents) and a client Firestore listener.
 * This reads an Admin-SDK route that orders ascending under a ceiling and
 * reports whether its count is exact.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 2. THE ROW CARRIES EVERYTHING NEEDED TO MATCH A BANK LINE
 *
 * THE FOUNDER: "the guy who presses the confirmation button checks the church
 * bank first." So the row is one half of a reconciliation, not a notification:
 * name, amount, reference, WHICH provider they said they used, and when they
 * pressed — see `inboxRowSummary`. Drop the reference and the admin is matching
 * on name and amount, which collides the first time two people from one family
 * pay for the same ticket type.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 3. THE PRIMITIVES, AND WHAT WAS REJECTED
 *
 *   · `sheet` for the panel — it is a side surface over the current screen, and
 *     the admin is meant to keep the screen behind it. `dialog` was rejected:
 *     it is modal and centred, which is right for a decision and wrong for a
 *     list you work down. `popover` was rejected as far too small for rows this
 *     wide, and `drawer` is not installed.
 *   · `item` for a row — `ItemTitle`/`ItemDescription`/`ItemActions` is exactly
 *     the name / matching line / Confirm shape. A hand-rolled flex div would be
 *     the defect THE-345 names.
 *   · `empty` for nothing-to-confirm — an empty COLLECTION is precisely what it
 *     is for, which is why THE-345 rejected it for a missing capability.
 *   · `alert` for the intro and for a failed read. The intro is the founder's
 *     rule stated to the person about to press the button, so it is an `alert`
 *     and not a caption; the failure is `destructive`, which THE-342 reserves
 *     for a read that broke — and this one did.
 *   · `badge` for the unread count and `skeleton` while loading.
 *   · `button` was NOT used for Confirm: this screen's admin controls are the
 *     brand-coloured pill the rest of the admin app uses (`ACTION_BUTTON`
 *     idiom), and importing a second button vocabulary into one row would make
 *     the sheet the only place in the admin app that looks different.
 *
 * ⚠️ EVERY TAPPABLE TARGET IS ≥44px BELOW `sm`. The trigger, every row and the
 * Confirm button carry `min-h-11` (44px) with Rule 4's 38px above `sm`.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 4. THE COUNT IS A FIGURE, SO IT IS EXACT OR IT SAYS IT IS NOT
 *
 * The route reads `INBOX_CEILING + 1` rows and reports `exact`. The badge
 * renders `7` when the read was complete and `200+` when it was not; the sheet
 * then says how many it is showing. There is no path that paints a bare number
 * over a truncated read.
 */

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving'; id: string }
  /** 🔴 THE-321's machine: a failure is a STATE, not a toast that scrolls away. */
  | { kind: 'failed'; id: string; message: string }
  | { kind: 'done'; id: string; message: string };

export interface TenantInboxProps {
  tenantId: string;
  /** Class for the trigger, so each shell can place its own. */
  triggerClassName?: string;
  /** Test seam: the loader, so a suite can drive states without a network. */
  load?: (tenantId: string, force?: boolean) => Promise<InboxPayload>;
  /** Test seam: the confirm call. */
  confirm?: (tenantId: string, registrationId: string) => Promise<{ alreadyConfirmed: boolean }>;
}

export const TenantInbox: React.FC<TenantInboxProps> = ({
  tenantId,
  triggerClassName,
  load = fetchPaymentInbox,
  confirm = confirmPaymentClaim,
}) => {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<InboxPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  const refresh = useCallback(async (force = false) => {
    if (!tenantId) return;
    setLoading(true);
    try {
      setPayload(await load(tenantId, force));
      setReadFailed(false);
    } catch {
      // 🔴 A FAILED READ IS NOT AN EMPTY INBOX. Painting "Nothing to confirm"
      // over a church with people waiting is the Silent-Failure Rule exactly.
      setReadFailed(true);
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId, load]);

  /**
   * The badge has to be right before the sheet is ever opened, so the first read
   * happens on mount rather than on open.
   *
   * 🔴 BUT NOT *DURING* THE MOUNT TICK, AND THAT IS THE POINT OF THE TIMEOUT.
   *
   * ⚠️ THIS CONTROL IS IN THE ADMIN SHELL'S HEADER, so its effect runs before
   * the effects of everything below it — including the two entitlement lookups
   * the NAV ITSELF depends on (`roster-status`, `grace-status`). Firing a third
   * request in that same tick puts a figure that DECORATES the nav in front of
   * the questions that decide what the nav contains, which is precisely the
   * traffic THE-139 is about. Measured: with the read on the mount tick,
   * `GraceWindowBanner`'s lookup did not complete at all.
   *
   * One macrotask is enough to put it behind first paint, and the cleanup
   * CANCELS it — so an admin clicking quickly through six screens pays for the
   * badge ONCE, at the screen they stop on, rather than six times.
   *
   * ⚠️ NOT `force`: `fetchPaymentInbox` also dedupes across remounts, which is
   * what keeps the cost of a session from growing with navigation.
   */
  useEffect(() => {
    const t = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const count = payload ? payload.count : 0;
  const exact = payload ? payload.exact : true;

  const onConfirm = async (id: string) => {
    setSave({ kind: 'saving', id });
    try {
      const out = await confirm(tenantId, id);
      setSave({ kind: 'done', id, message: out.alreadyConfirmed ? CONFIRM_ALREADY : CONFIRM_SUCCESS });
      await refresh(true);
    } catch (e) {
      // 🔴 THE TICKET IS NOT MARKED PAID AND THE ROW DOES NOT LEAVE. The route
      // wrote nothing; this says so where the admin is looking.
      setSave({
        kind: 'failed',
        id,
        message: e instanceof Error && e.message ? e.message : CONFIRM_FAILED,
      });
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 🔴 THE LIST AN ADMIN IS ACTUALLY WORKING FROM IS NEVER CACHED. Only
        // the badge ages; opening the sheet forces a fresh read.
        if (next) void refresh(true);
      }}
    >
      <SheetTrigger
        data-tenant-inbox-trigger
        aria-label={INBOX_TRIGGER_LABEL}
        title={INBOX_TRIGGER_LABEL}
        /**
         * ⚠️ 44px BELOW `sm` AND THE SHARED DENSITY ABOVE IT, and neither number
         * is minted here: `min-h-11`/`min-w-11` is the 44px tap floor off the
         * spacing scale, and the `sm:` half is `form-layout.ts`'s own idiom for
         * a header glyph — the same `sm:min-h-0 sm:min-w-0 sm:p-1.5` THE-346
         * measured on the notes-editor menu trigger. A raw `h-[38px]` here would
         * be this file inventing a density the module already owns.
         */
        className={
          'relative inline-flex items-center justify-center rounded-full '
          + 'min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:p-1.5 '
          + 'text-muted hover:text-strong hover:bg-surface-sunken transition-colors '
          + (triggerClassName || '')
        }
      >
        <InboxIcon size={18} />
        {count > 0 && (
          <Badge
            data-tenant-inbox-badge
            variant="destructive"
            className="absolute -top-0.5 -right-0.5 px-1.5 min-w-5"
          >
            {inboxBadgeLabel(count, exact)}
          </Badge>
        )}
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{INBOX_TITLE}</SheetTitle>
          <SheetDescription>{INBOX_INTRO}</SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-3">
          {loading && !payload && (
            <div className="space-y-2" data-tenant-inbox-loading>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {readFailed && (
            <Alert variant="destructive" data-tenant-inbox-failed>
              <AlertTitle>{INBOX_FAILED_TITLE}</AlertTitle>
              <AlertDescription>{INBOX_FAILED_BODY}</AlertDescription>
            </Alert>
          )}

          {!loading && !readFailed && payload && payload.items.length === 0 && (
            <Empty data-tenant-inbox-empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><InboxIcon /></EmptyMedia>
                <EmptyTitle>{INBOX_EMPTY_TITLE}</EmptyTitle>
                <EmptyDescription>{INBOX_EMPTY_BODY}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {payload && !exact && (
            // 🔴 The list is short of its total and says so — `bounded-list-read`'s
            // rule, applied to a surface that could not use its helper because
            // this read is server-side.
            <p className="text-xs text-muted" data-tenant-inbox-truncated>
              Showing the {INBOX_CEILING} oldest. There are more waiting.
            </p>
          )}

          {payload && payload.items.length > 0 && (
            <ItemGroup className="gap-2">
              {payload.items.map((item) => (
                <Item key={item.id} variant="outline" data-tenant-inbox-row className="min-h-11">
                  <ItemContent>
                    <ItemTitle data-inbox-row-name>{item.memberName}</ItemTitle>
                    <ItemDescription data-inbox-row-summary>{inboxRowSummary(item)}</ItemDescription>
                    <ItemDescription>{item.eventTitle}</ItemDescription>
                    {save.kind === 'failed' && save.id === item.id && (
                      <span className="text-xs font-semibold text-destructive" data-inbox-row-failed>
                        {save.message}
                      </span>
                    )}
                    {save.kind === 'done' && save.id === item.id && (
                      <span className="text-xs font-semibold text-muted" data-inbox-row-done>
                        {save.message}
                      </span>
                    )}
                  </ItemContent>
                  <ItemActions>
                    <button
                      type="button"
                      data-inbox-confirm
                      title={CONFIRM_BUTTON_HELP}
                      disabled={save.kind === 'saving' && save.id === item.id}
                      onClick={() => void onConfirm(item.id)}
                      /* `bg-gold` is `var(--brand-color)` — the token, so this
                         file mints no colour literal of any kind; and the
                         above-`sm` height is `CONTROL_DENSITY.action`, so it
                         mints no raw pixel height either. */
                      className={
                        'min-h-11 px-4 rounded-xl text-xs font-semibold '
                        + 'text-white bg-gold disabled:opacity-50 '
                        + CONTROL_DENSITY.action
                      }
                    >
                      {save.kind === 'saving' && save.id === item.id ? 'Recording…' : CONFIRM_BUTTON}
                    </button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default TenantInbox;
