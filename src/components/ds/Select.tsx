import React, { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Select — a native <select> styled to match Input: raised rest state, gold
 * focus ring, custom chevron. Ported from the Harvest design kit (Forms).
 */
export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Options, or pass <option> children instead. */
  options?: SelectOption[] | null;
  /** Render the error border. @default false */
  invalid?: boolean;
}

export function Select({
  options = null,
  invalid = false,
  disabled = false,
  className,
  children,
  onFocus,
  onBlur,
  ...rest
}: SelectProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div
      className={cn(
        'relative flex h-11 items-center rounded-lg border transition-all duration-150 ease-out',
        disabled ? 'bg-surface-sunken opacity-60' : 'bg-surface-raised',
        invalid ? 'border-danger' : focused ? 'border-gold' : 'border-line-strong',
        focused && 'shadow-[var(--ring-gold)]',
        className,
      )}
    >
      <select
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        className={cn(
          'h-full flex-1 appearance-none border-none bg-transparent py-0 pl-3.5 pr-9',
          'font-sans text-sm text-strong outline-none',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
        {...rest}
      >
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-3.5 text-xs text-muted">
        ▾
      </span>
    </div>
  );
}
