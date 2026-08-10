import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Button — the action primitive: gold primary, outline secondary, link-arrow
 * ghost. Ported from the Harvest design kit (Core).
 *
 * The kit drove hover and press off React state (`useState` + onMouseEnter /
 * onMouseDown) and applied the result as inline `style`. Both are gone: hover
 * and press are `hover:` / `active:` variants, so there is no re-render on
 * pointer move and — the part that matters here — no inline colour to opt the
 * button out of theming.
 *
 * `onDark` means "this sits on a navy brand band", NOT "the dark theme". A
 * night band is dark in BOTH themes, so its text is pinned to fixed brand
 * tokens (cream/stone) rather than the inverting ramp — the same rule the
 * typography config applies to prose-invert.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. @default "primary" */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Control height / padding. @default "md" */
  size?: 'sm' | 'md' | 'lg';
  /** Adjust neutral colours for navy / dark grounds. @default false */
  onDark?: boolean;
  children?: React.ReactNode;
}

const SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-[34px] gap-1.5 px-3.5 text-[13px]',
  md: 'h-[42px] gap-2 px-5 text-sm',
  lg: 'h-[52px] gap-2.5 px-7 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  onDark = false,
  disabled = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  // Gold and navy are brand, not neutrals: `text-white` on gold is correct and
  // deliberately does not theme. Hover darkens the tenant's own colour via
  // color-mix rather than jumping to wheat-600, which would snap a white-label
  // tenant back to Harvest gold on hover.
  const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary: cn(
      'bg-gold text-white shadow-[var(--ds-sh-sm)]',
      !disabled && 'hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] hover:shadow-[var(--ds-sh-md)]',
    ),
    secondary: cn(
      'bg-transparent',
      onDark
        ? cn('border-white/10 text-cream', !disabled && 'hover:bg-white/[0.06]')
        : cn('border-line-strong text-strong', !disabled && 'hover:bg-surface-sunken'),
    ),
    ghost: cn('bg-transparent px-1.5 text-gold', !disabled && 'hover:opacity-75'),
  };

  return (
    <button
      disabled={disabled}
      className={cn(
        'group/ds-btn inline-flex shrink-0 items-center justify-center whitespace-nowrap',
        'rounded-lg border border-transparent font-sans font-semibold leading-none',
        'transition-all duration-150 ease-out',
        'active:not-disabled:translate-y-px',
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
      {variant === 'ghost' && (
        <span aria-hidden className="transition-transform duration-300 ease-out group-hover/ds-btn:translate-x-[3px]">
          →
        </span>
      )}
    </button>
  );
}
