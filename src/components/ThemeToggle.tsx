"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { THEME_STORAGE_KEY, isThemeChoice, resolveTheme, type ThemeChoice } from '@/lib/theme';

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

const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Stamp <html>. Mirrors exactly what the pre-paint script does. */
export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(choice, prefersDark());
  const el = document.documentElement;
  el.setAttribute('data-theme', resolved);
  el.classList.toggle('dark', resolved === 'dark');
}

function readStoredChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(raw) ? raw : 'system';
  } catch {
    // localStorage can throw in private mode / sandboxed iframes.
    return 'system';
  }
}

interface ThemeToggleProps {
  /** Compact row styling for the member Profile list; default suits settings. */
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
          ? 'flex items-center gap-1 bg-surface-sunken rounded-brand p-1'
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[13px] font-semibold transition-colors ${
              active
                ? 'bg-surface-raised text-strong shadow-[var(--ds-sh-sm)]'
                : 'text-muted hover:text-strong'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );
};

export default ThemeToggle;
