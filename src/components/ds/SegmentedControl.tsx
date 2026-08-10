import React from 'react';
import { cn } from '@/lib/utils';

/**
 * SegmentedControl — the pill tab bar used for sub-navigation, filters and
 * view toggles. The active segment rides a raised pill on a sunken track.
 * Ported from the Harvest design kit (Core).
 */
export interface SegmentOption {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Options as plain strings or {value,label,icon}. */
  options: (string | SegmentOption)[];
  /** Currently selected value. */
  value: string;
  /** Called with the chosen value. */
  onChange?: (value: string) => void;
  /** @default "md" */
  size?: 'sm' | 'md';
}

const normalise = (o: string | SegmentOption): SegmentOption =>
  typeof o === 'string' ? { value: o, label: o } : o;

export function SegmentedControl({
  options,
  value,
  onChange,
  size = 'md',
  className,
  ...rest
}: SegmentedControlProps) {
  return (
    <div
      className={cn('inline-flex gap-1 rounded-lg bg-surface-sunken p-1', className)}
      {...rest}
    >
      {options.map((option) => {
        const { value: val, label, icon } = normalise(option);
        const active = val === value;
        return (
          <button
            key={val}
            type="button"
            aria-pressed={active}
            onClick={() => onChange?.(val)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border-none',
              'font-sans font-semibold transition-colors duration-150 ease-out',
              size === 'sm' ? 'px-3 py-1.5 text-[12.5px]' : 'px-4 py-2 text-[13.5px]',
              active
                ? 'bg-surface-raised text-strong shadow-[var(--ds-sh-sm)]'
                : 'bg-transparent text-muted',
            )}
          >
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );
}
