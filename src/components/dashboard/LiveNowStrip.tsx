"use client";
/**
 * THE-276 — the live-now strip.
 *
 * The one widget on this tab with no trust caveat at all: it is a single
 * document read by id (`tenants/{t}/livestream/current`), so there is no
 * sample, no ceiling and no ordering to be wrong about. Either the stream doc
 * says `active` or it does not.
 *
 * Its neighbours in the strip are the same shape — facts read straight off the
 * shell (the unread inbox count) or off an exact aggregation — so the strip
 * stays a row of things that are simply true right now, separated by
 * `separator`, rather than a second summary of the cards below it.
 */
import React from 'react';
import { Radio, Inbox, type LucideIcon } from 'lucide-react';

import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Spinner } from '../ui/spinner';
import type { LiveNow } from './dashboard-data';

export interface LiveNowStripProps {
  /** `null` while the stream doc is still being read. */
  readonly liveNow: LiveNow | null;
  /** Unread platform-inbox items, passed down by the shell. */
  readonly unreadCount: number;
  /** True on the apex domain, where the inbox is the only one that exists. */
  readonly showInbox: boolean;
}

function StripItem({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon aria-hidden className="size-3.5" />
      {children}
    </span>
  );
}

export function LiveNowStrip({ liveNow, unreadCount, showInbox }: LiveNowStripProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3 py-2"
      data-live-strip
    >
      {liveNow === null ? (
        <StripItem icon={Radio}>
          <Spinner className="size-3" />
        </StripItem>
      ) : liveNow.active ? (
        <Badge variant="destructive" data-live-badge="active">
          <Radio aria-hidden />
          {liveNow.title}
        </Badge>
      ) : (
        <StripItem icon={Radio}>
          <span data-live-badge="idle">Not streaming</span>
        </StripItem>
      )}

      {showInbox && (
        <>
          <Separator orientation="vertical" className="h-4" />
          <StripItem icon={Inbox}>
            <span data-strip-inbox>
              {unreadCount === 0 ? 'Inbox clear' : `${unreadCount.toLocaleString()} unread`}
            </span>
          </StripItem>
        </>
      )}
    </div>
  );
}
