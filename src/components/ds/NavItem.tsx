import React from 'react';
import { cn } from '@/lib/utils';

/**
 * NavItem — one row in the admin sidebar. Ported from the Harvest design kit
 * (Admin).
 *
 * ⚠️ The active tint is `color-mix(in srgb, var(--brand-color) 12%, transparent)`
 * rather than the gold background with a 12% opacity modifier. A
 * variable-backed colour cannot take one: it compiles, emits nothing at all,
 * and the active row silently loses its background. A repo-wide test in
 * theming-gaps.test.ts guards this — which is also why the offending form is
 * described here in words instead of being written out, since the guard scans
 * source text and would flag the example itself.
 */
export interface NavItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  label: string;
  /** @default false */
  active?: boolean;
  /** Icon-only mode. @default false */
  collapsed?: boolean;
  /** Show the notification dot. @default false */
  dot?: boolean;
  /** Count pill contents. */
  badge?: React.ReactNode;
}

export function NavItem({
  icon = null,
  label,
  active = false,
  collapsed = false,
  dot = false,
  badge = null,
  className,
  ...rest
}: NavItemProps) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'group/ds-nav relative flex h-[46px] w-full cursor-pointer items-center rounded-lg border-none',
        'text-left font-sans text-sm transition-colors duration-150 ease-out',
        collapsed ? 'justify-center gap-0 px-0' : 'justify-start gap-3.5 px-3.5',
        active
          ? 'bg-[color-mix(in_srgb,var(--brand-color)_12%,transparent)] font-semibold text-gold'
          : 'bg-transparent font-medium text-muted hover:bg-surface-sunken hover:text-strong',
        className,
      )}
      {...rest}
    >
      {icon && <span className="flex shrink-0">{icon}</span>}
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && badge != null && (
        <span className="min-w-[18px] rounded-full bg-danger px-[7px] py-px text-center text-[11px] font-bold text-white">
          {badge}
        </span>
      )}
      {dot && (
        <span
          aria-hidden
          className={cn(
            'absolute top-2.5 h-2 w-2 rounded-full border-2 border-surface-raised bg-danger',
            collapsed ? 'right-2' : 'right-3',
          )}
        />
      )}
    </button>
  );
}
