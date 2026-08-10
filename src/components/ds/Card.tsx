import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Card — the surface container: light / sunken / gold / night grounds with an
 * optional hover-lift. Ported from the Harvest design kit (Core).
 *
 * `padding` and `radius` stay inline `style`, and that is deliberate: neither
 * is a colour, so neither can opt the card out of theming, and keeping the
 * kit's numeric API means the 21 surfaces ported later do not each invent
 * their own spacing prop. Every colour is a token class.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Ground the card sits on. @default "light" */
  surface?: 'light' | 'sunken' | 'gold' | 'night';
  /** Enable the hover-lift + gold border interaction. @default false */
  interactive?: boolean;
  /** Inner padding in px. @default 24 */
  padding?: number;
  /** Border radius, any CSS length. @default "16px" (= rounded-brand-lg) */
  radius?: string;
  children?: React.ReactNode;
}

/**
 * `night` is a brand band, dark in BOTH themes — its ink is pinned to
 * stone-200 rather than the inverting ramp. `gold` uses wheat-800, the ink
 * added for THE-61: the kit's own wheat-700 on this tint is 4.33:1.
 */
const SURFACES: Record<NonNullable<CardProps['surface']>, string> = {
  light: 'bg-surface-raised text-body border-line shadow-[var(--ds-sh-sm)]',
  sunken: 'bg-surface-sunken text-body border-transparent',
  gold: 'bg-surface-gold text-wheat-800 border-[var(--border-gold)]',
  night: 'bg-surface-night text-stone-200 border-white/10 shadow-[var(--glow-gold)]',
};

export function Card({
  surface = 'light',
  interactive = false,
  padding = 24,
  radius = '16px',
  className,
  style,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        'border transition-all duration-300 ease-out',
        SURFACES[surface],
        interactive &&
          'cursor-pointer hover:-translate-y-1 hover:border-[var(--border-gold)] hover:shadow-[var(--ds-sh-lg)]',
        className,
      )}
      style={{ padding, borderRadius: radius, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
