import React, { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Input — the text field: raised rest state, gold focus ring, optional leading
 * icon and an error state. Ported from the Harvest design kit (Forms).
 *
 * Focus stays in React state rather than becoming `focus-within:` because the
 * ring is a box-shadow token (--ring-gold) and the border colour has three
 * states (invalid > focus > rest) whose precedence is clearer as an
 * expression than as a stack of variant classes.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Leading icon node. */
  icon?: React.ReactNode;
  /** Render the error border. @default false */
  invalid?: boolean;
}

export function Input({
  icon = null,
  invalid = false,
  disabled = false,
  className,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div
      className={cn(
        'flex h-11 items-center gap-2 rounded-lg border px-3.5 transition-all duration-150 ease-out',
        disabled ? 'bg-surface-sunken opacity-60' : 'bg-surface-raised',
        invalid ? 'border-danger' : focused ? 'border-gold' : 'border-line-strong',
        focused && 'shadow-[var(--ring-gold)]',
        className,
      )}
    >
      {icon && <span className="flex shrink-0 text-muted">{icon}</span>}
      <input
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
        className="min-w-0 flex-1 border-none bg-transparent font-sans text-sm text-strong outline-none placeholder:text-faint"
        {...rest}
      />
    </div>
  );
}
