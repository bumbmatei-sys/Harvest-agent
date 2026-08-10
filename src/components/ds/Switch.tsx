import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Switch — the on/off toggle used across Roles, Settings and preferences.
 * Ported from the Harvest design kit (Forms).
 *
 * The off-track is --border-strong rather than a literal stone-300: identical
 * in light (both #D6CCBE) but it follows the ramp into dark, where a pinned
 * stone-300 would leave a bright bar on the dark ground.
 *
 * `tone: "purple"` is the kit's name for the non-gold accent; the colour it
 * actually resolves to is field green. The name is kept so the 21 surfaces
 * port cleanly, and the mismatch is recorded here rather than silently fixed.
 */
export interface SwitchProps extends Omit<React.HTMLAttributes<HTMLButtonElement>, 'onChange'> {
  /** On/off state. @default false */
  checked?: boolean;
  /** Called with the next boolean value. */
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** Accent when on. @default "gold" */
  tone?: 'gold' | 'purple';
  /** Track height in px. @default 24 */
  size?: number;
}

export function Switch({
  checked = false,
  onChange,
  disabled = false,
  tone = 'gold',
  size = 24,
  className,
  style,
  ...rest
}: SwitchProps) {
  const trackWidth = size + 18;
  const knob = size - 6;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={cn(
        'relative shrink-0 rounded-full border-none p-0 transition-colors duration-300 ease-out',
        checked ? (tone === 'purple' ? 'bg-field-500' : 'bg-gold') : 'bg-[var(--border-strong)]',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
      style={{ width: trackWidth, height: size, ...style }}
      {...rest}
    >
      <span
        aria-hidden
        className="absolute top-[3px] rounded-full bg-white shadow-[var(--ds-sh-sm)] transition-[left] duration-300 ease-spring"
        style={{ left: checked ? trackWidth - knob - 3 : 3, width: knob, height: knob }}
      />
    </button>
  );
}
