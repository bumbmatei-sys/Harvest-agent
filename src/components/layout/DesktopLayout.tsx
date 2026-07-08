"use client";
import React from 'react';

/**
 * Shared desktop (lg:+) layout primitives — Phase 0b scaffolding for the
 * per-screen desktop passes (Phases 1-4). Every class here is `lg:`-prefixed
 * so these are safe to drop into existing markup without touching mobile.
 *
 * Structural tokens (--ds-radius-card, --ds-border, --ds-sh-*) live in
 * globals.css. The app's existing light background and tenant
 * --brand-color are untouched — these primitives carry no color opinions.
 */

interface DesktopContainerProps {
  children: React.ReactNode;
  className?: string;
}

/** Centered max-width content column with responsive horizontal padding. */
export const DesktopContainer: React.FC<DesktopContainerProps> = ({ children, className = '' }) => (
  <div className={`lg:w-full lg:px-6 xl:px-8 ${className}`}>
    {children}
  </div>
);

interface TwoColumnLayoutProps {
  /** Primary column content. */
  main: React.ReactNode;
  /** Right rail content — stacks below `main` on mobile/tablet (`< lg`). */
  rail: React.ReactNode;
  className?: string;
}

/** Main + right-rail grid used across Home/Watch/Give/AI desktop layouts. */
export const TwoColumnLayout: React.FC<TwoColumnLayoutProps> = ({ main, rail, className = '' }) => (
  <div className={`lg:grid lg:grid-cols-[1fr_340px] lg:gap-6 lg:items-start ${className}`}>
    <div className="lg:min-w-0">{main}</div>
    <div className="lg:min-w-0">{rail}</div>
  </div>
);

type DesktopCardElevation = 'sm' | 'md' | 'lg';

/** Tailwind can only see complete, literal class strings — keep these enumerated
 * rather than interpolating the token name into an arbitrary-value string. */
const ELEVATION_CLASS: Record<DesktopCardElevation, string> = {
  sm: 'lg:shadow-[var(--ds-sh-sm)]',
  md: 'lg:shadow-[var(--ds-sh-md)]',
  lg: 'lg:shadow-[var(--ds-sh-lg)]',
};

interface DesktopCardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevation?: DesktopCardElevation;
}

/** White surface + rounded corners + soft shadow + hairline border, `lg:` only. */
export const DesktopCard: React.FC<DesktopCardProps> = ({
  children,
  className = '',
  style,
  elevation = 'sm',
  ...props
}) => (
  <div
    className={`lg:bg-white lg:rounded-[var(--ds-radius-card)] lg:border ${ELEVATION_CLASS[elevation]} ${className}`}
    style={{ borderColor: 'var(--ds-border)', ...style }}
    {...props}
  >
    {children}
  </div>
);
