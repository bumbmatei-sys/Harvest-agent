"use client";
/**
 * THE-276 — the frame every Overview widget sits in, and the only place a
 * widget's three states are spelled.
 *
 * Loading, unavailable and ready are handled HERE rather than in each widget,
 * because the failure this ticket is about is a widget quietly rendering its
 * empty case as a real one. A widget that owns its own empty state is a widget
 * that can forget to have one; a widget that hands this frame a `Figure` or a
 * `Series` cannot render an unavailable read at all — there is no branch in
 * which it is given a number it did not get.
 */
import React from 'react';
import type { LucideIcon } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty';
import { Skeleton } from '../ui/skeleton';
import { Spinner } from '../ui/spinner';

/**
 * What a widget is waiting on, has been refused, can draw — or has not been
 * built yet.
 *
 * ⚠️ `deferred` was added by THE-283 and is NOT a synonym for `unavailable`.
 * They are different claims about different things: `unavailable` says a read
 * this app makes did not produce a trustworthy number, while `deferred` says no
 * read was attempted because the widget is a later ticket. Collapsing the two
 * would tell a founder their data could not be read when the truth is that
 * nobody has built the thing yet — and it would make a shipped read failure
 * indistinguishable from a roadmap item, which is the same category error as a
 * `0` standing in for a failed count.
 */
export type WidgetState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'deferred'; readonly reason: string }
  | { readonly kind: 'ready' };

interface WidgetFrameProps {
  readonly title: string;
  readonly description?: string;
  readonly icon: LucideIcon;
  readonly state: WidgetState;
  /** Rendered only in the `ready` state, so it can never see a missing figure. */
  readonly children: React.ReactNode;
  /** Height of the loading skeleton, matched to the content it stands in for. */
  readonly skeletonClassName?: string;
  readonly className?: string;
}

/**
 * The loading case: a `spinner` beside the title and a `skeleton` where the
 * content will be. Both, deliberately — the spinner says the screen is working
 * and the skeleton holds the space so nothing below it jumps when the read
 * lands.
 */
export function WidgetFrame({
  title,
  description,
  icon: Icon,
  state,
  children,
  skeletonClassName = 'h-40 w-full',
  className,
}: WidgetFrameProps) {
  return (
    <Card className={className} data-widget={title} data-state={state.kind}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          <span>{title}</span>
          {state.kind === 'loading' && <Spinner className="ml-auto text-muted-foreground" />}
        </CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent>
        {state.kind === 'loading' && <Skeleton className={skeletonClassName} />}
        {state.kind === 'unavailable' && <WidgetEmpty icon={Icon} title={title} reason={state.reason} />}
        {state.kind === 'deferred' && (
          <WidgetEmpty icon={Icon} title={title} reason={state.reason} verdict="is not built yet" />
        )}
        {state.kind === 'ready' && children}
      </CardContent>
    </Card>
  );
}

/**
 * The refused case.
 *
 * 🔴 It says what is missing, not "No data". "No data" and "we could not read
 * this" are different claims and only one of them is true here — a ministry
 * with 2,000 contacts and a ministry whose contacts could not be counted would
 * otherwise render identically, which is the defect in miniature.
 */
export function WidgetEmpty({ icon: Icon, title, reason, verdict = 'unavailable' }: {
  icon: LucideIcon;
  title: string;
  reason: string;
  /** What is wrong with this widget. `unavailable` for a read, per THE-283. */
  verdict?: string;
}) {
  return (
    <Empty className="p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle className="text-sm">{`${title} ${verdict}`}</EmptyTitle>
        <EmptyDescription data-empty-reason>{reason}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
