import React from 'react';
import { cn } from '@/lib/utils';

/**
 * StatCard — a dashboard metric tile: big Fraunces value, quiet label, corner
 * icon, optional trend delta. Ported from the Harvest design kit (Admin).
 *
 * The resting icon is --border-strong, which is exactly the kit's stone-300 in
 * light and keeps the same low visual weight in dark (~1.6:1 either way)
 * instead of staying a bright literal on the dark ground.
 *
 * The deltas are field-600 / danger-strong rather than the kit's field-500 /
 * danger: at 12px those need to clear AA, and the kit's pair is 3.90:1 and
 * 4.46:1 on white.
 */
export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  delta?: React.ReactNode;
  /** @default "up" */
  deltaTone?: 'up' | 'down';
}

export function StatCard({
  label,
  value,
  icon = null,
  delta = null,
  deltaTone = 'up',
  onClick,
  className,
  ...rest
}: StatCardProps) {
  const clickable = typeof onClick === 'function';

  return (
    <div
      onClick={onClick}
      className={cn(
        'group/ds-stat flex flex-col gap-2.5 rounded-brand border border-line bg-surface-raised p-5',
        'text-left shadow-[var(--ds-sh-sm)] transition-all duration-300 ease-out',
        clickable
          ? 'cursor-pointer hover:-translate-y-[3px] hover:border-[var(--border-gold)] hover:shadow-[var(--ds-sh-md)]'
          : 'cursor-default',
        className,
      )}
      {...rest}
    >
      <div className="flex items-center justify-between">
        <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
        {icon && (
          <span
            className={cn(
              'flex text-[var(--border-strong)] transition-colors duration-300 ease-out',
              clickable && 'group-hover/ds-stat:text-gold',
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2.5">
        <span className="font-display text-[40px] font-light leading-none tracking-display text-strong">
          {value}
        </span>
        {delta != null && (
          <span
            className={cn(
              'font-sans text-xs font-semibold',
              deltaTone === 'down' ? 'text-danger-strong' : 'text-field-600',
            )}
          >
            {deltaTone === 'down' ? '▾' : '▴'} {delta}
          </span>
        )}
      </div>
    </div>
  );
}
