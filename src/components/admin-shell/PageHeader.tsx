'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { SegmentedTabs, SegmentedTabsList, SegmentedTabsTrigger } from './SegmentedTabs';

/**
 * The one page header every admin section uses.
 *
 * The title sits at the top of the content area, on the left. Whatever the
 * section has beside it - a tab pill, a main button, or both - sits on the
 * same line, on the right, pill first and button last. There is no eyebrow
 * above the title and no back button: the top bar's breadcrumb is the way back.
 *
 * Below `sm` the right-hand cluster wraps under the title rather than
 * squeezing it, so a phone gets the same two rows it always had.
 */
export function PageHeader({
  title,
  subtitle,
  tabs,
  action,
  hideTitleOnMobile = false,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** A `PageTabs` pill, rendered before the action. */
  tabs?: ReactNode;
  /** The section's main button. */
  action?: ReactNode;
  /** The phone header already prints the title, so a screen can skip repeating it. */
  hideTitleOnMobile?: boolean;
  className?: string;
}) {
  const controls = tabs || action;
  return (
    <header
      data-page-header
      className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-3', className)}
    >
      <div className={cn('min-w-0', hideTitleOnMobile && 'max-lg:sr-only')}>
        <h1 className="font-display text-[1.75rem] leading-[1.1] font-light tracking-[-0.02em] text-strong lg:text-[2rem]">
          {title}
        </h1>
        {subtitle ? <p className="mt-1.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {controls ? (
        <div data-page-header-controls className="flex min-w-0 flex-wrap items-center gap-3 max-sm:w-full max-sm:justify-between">
          {tabs}
          {action}
        </div>
      ) : null}
    </header>
  );
}

export interface PageTabItem<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * The header's tab pill, on the shadcn Tabs primitives.
 *
 * Two properties are the point, and `PageTabs` is the only place that owns
 * them. The raised highlight is the trigger inside a padded track, so it can
 * never reach past the pill. And the pill never changes size when the selection
 * moves: every trigger is one equal-width grid column sized by the longest
 * label, and the label weight is the same selected or not.
 */
export function PageTabs<T extends string>({
  value,
  onValueChange,
  items,
  label,
  className,
}: {
  value: T;
  onValueChange: (next: T) => void;
  items: readonly PageTabItem<T>[];
  label: string;
  className?: string;
}) {
  return (
    <SegmentedTabs value={value} onValueChange={(next) => onValueChange(next as T)} className="w-fit">
      <SegmentedTabsList
        aria-label={label}
        data-page-tabs
        className={cn('grid grid-flow-col auto-cols-fr', className)}
      >
        {items.map((item) => (
          <SegmentedTabsTrigger key={item.value} value={item.value} className="w-full justify-center max-sm:h-11">
            {item.label}
          </SegmentedTabsTrigger>
        ))}
      </SegmentedTabsList>
    </SegmentedTabs>
  );
}
