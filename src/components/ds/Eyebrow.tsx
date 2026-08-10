import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Eyebrow — the uppercase, tracked gold kicker set above headings.
 * Ported from the Harvest design kit (Core).
 *
 * This is the one primitive that correctly does NOT change between themes: it
 * is gold on both grounds, and gold is brand, not a neutral (it clears AA on
 * the dark ground at 6.77:1 — see the stage-3 notes in globals.css). The
 * theming test lists it as brand-only for exactly that reason.
 *
 * The kit declared an `onDark` prop and then never read it; it is dropped here
 * rather than carried forward as an API that does nothing.
 */
export type EyebrowProps = React.HTMLAttributes<HTMLSpanElement>;

export function Eyebrow({ className, children, ...rest }: EyebrowProps) {
  return (
    <span
      className={cn(
        'inline-block font-sans text-xs font-semibold uppercase tracking-eyebrow text-gold',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
