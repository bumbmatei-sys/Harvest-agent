import React from 'react';
import { cn } from '@/lib/utils';

/**
 * ScreenHeader — the bar at the top of every admin screen: optional gold back
 * chevron, the screen title in Fraunces, optional right-side action. Ported
 * from the Harvest design kit (Admin).
 */
// See Modal: the DOM `title` is a string tooltip; a screen heading is a node.
export interface ScreenHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  onBack?: (() => void) | null;
  action?: React.ReactNode;
  titleIcon?: React.ReactNode;
}

export function ScreenHeader({
  title,
  onBack = null,
  action = null,
  titleIcon = null,
  className,
  ...rest
}: ScreenHeaderProps) {
  return (
    <header
      className={cn(
        'flex min-h-16 items-center gap-3 border-b border-line bg-surface-raised px-6',
        className,
      )}
      {...rest}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="-ml-2 flex h-8 w-8 cursor-pointer items-center justify-center border-none bg-transparent text-[22px] leading-none text-gold"
        >
          ‹
        </button>
      )}
      {titleIcon && <span className="flex text-muted">{titleIcon}</span>}
      <h1 className="m-0 flex-1 truncate font-display text-2xl font-light tracking-display text-strong">
        {title}
      </h1>
      {action && <div className="flex shrink-0 items-center gap-2.5">{action}</div>}
    </header>
  );
}
