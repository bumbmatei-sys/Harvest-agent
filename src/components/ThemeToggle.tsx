"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { THEME_STORAGE_KEY, type ThemeChoice } from '@/lib/theme';
import { applyTheme, readStoredChoice } from '@/lib/theme-runtime';

/**
 * Theming stage 3 — the light / dark / system control.
 *
 * Reads and writes the same localStorage key the pre-paint script in
 * layout.tsx reads, so a reload re-applies the choice before first paint and
 * there is no flash. Applying the theme is done by stamping <html> directly
 * rather than through React state, for the same reason: <html> is rendered by
 * the server layout, and the pre-paint script has already stamped it by the
 * time this component mounts.
 *
 * `system` deliberately stores the string "system" rather than resolving to
 * light/dark at click time — otherwise a user who picks "system" in daylight
 * stays pinned to light forever. The media query is subscribed to below so the
 * theme tracks the OS while "system" is selected.
 */

const OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/* applyTheme / readStoredChoice moved to @/lib/theme-runtime in THE-85 so that
   this control and the pre-auth light override stamp <html> through one code
   path rather than two that could disagree. Behaviour here is unchanged: the
   same key is read and written, and <html> is still stamped directly rather
   than through React state. */

interface ThemeToggleProps {
  /** Compact row styling for the member Profile list, sized to sit beside
   *  PaletteFamilyToggle now that the row holds two controls instead of one;
   *  default (unchanged) suits admin settings, where it is the only control. */
  variant?: 'default' | 'row';
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ variant = 'default' }) => {
  // Default to 'system' on the server and first client render so the markup is
  // stable; the real stored value is read in the effect below. <html> is
  // already correct either way — the pre-paint script did that.
  const [choice, setChoice] = useState<ThemeChoice>('system');

  useEffect(() => {
    setChoice(readStoredChoice());
  }, []);

  // While "system" is selected, follow the OS if it changes mid-session.
  useEffect(() => {
    if (choice !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [choice]);

  const select = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // A blocked localStorage must not stop the theme from applying for this
      // session — it only means the choice will not survive a reload.
    }
    applyTheme(next);
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={
        variant === 'row'
          ? 'flex items-center gap-0.5 bg-surface-sunken rounded-brand p-0.5'
          : 'inline-flex items-center gap-1 bg-surface-sunken rounded-brand p-1'
      }
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            data-theme-choice={value}
            onClick={() => select(value)}
            className={
              variant === 'row'
                ? `flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-surface-raised text-strong shadow-[var(--ds-sh-sm)]'
                      : 'text-muted hover:text-strong'
                  }`
                : `flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[13px] font-semibold transition-colors ${
                    active
                      ? 'bg-surface-raised text-strong shadow-[var(--ds-sh-sm)]'
                      : 'text-muted hover:text-strong'
                  }`
            }
          >
            <Icon size={variant === 'row' ? 12 : 14} />
            {/* Row-variant labels drop to icon-only below `sm` (640px) AND from
                `xl` (1280px) up — see the Profile Appearance block for the
                measured widths. The `xl` cutoff is not symmetry for its own
                sake: Profile's settings column SHRINKS at exactly `xl`, where
                it splits into two, so the card is narrower there than in the
                single-column layout just below it — full labels measured a
                real 41px overflow at 1280px width. `aria-label` above is
                unconditional, so the accessible name never depends on which
                of these two is visually painted. `default` (admin settings,
                this variant's only other caller) is untouched. */}
            {variant === 'row' ? <span className="hidden sm:inline xl:hidden">{label}</span> : label}
          </button>
        );
      })}
    </div>
  );
};

export default ThemeToggle;
