import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Badge — the small pill label for status, categories and "Most Popular".
 * Ported from the Harvest design kit (Core).
 */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Colour role. @default "neutral" */
  tone?: 'gold' | 'outline' | 'sky' | 'green' | 'neutral' | 'danger';
  children?: React.ReactNode;
}

/**
 * Every fill/ink pair here clears AA 4.5:1 in BOTH themes, asserted in
 * ds-primitives.test.tsx rather than assumed.
 *
 * Two mappings are easy to get wrong and are spelled out:
 *  • the kit's `green` tone is Harvest's FIELD scale. `bg-green-100` would
 *    compile and silently render Tailwind's mint #DCFCE7 instead of #EAF0E2.
 *  • the kit's `danger` fill is a raw rgba(196,85,59,.10) wash; Harvest names
 *    that role `danger-tint`, and its ink is `danger-strong` — plain
 *    `text-danger` on that tint is 3.71:1.
 */
const TONES: Record<NonNullable<BadgeProps['tone']>, string> = {
  gold: 'bg-surface-gold text-wheat-800 border-[var(--border-gold)]',
  outline: 'bg-transparent text-body border-line-strong',
  sky: 'bg-sky-100 text-sky-700 border-transparent',
  green: 'bg-field-100 text-field-700 border-transparent',
  neutral: 'bg-surface-sunken text-body border-transparent',
  danger: 'bg-danger-tint text-danger-strong border-transparent',
};

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-full border px-2.5',
        'font-sans text-[11.5px] font-semibold leading-none tracking-[0.01em]',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
