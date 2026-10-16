'use client';

import { useCallback, useEffect, useState } from 'react';

import { applyTheme, readStoredChoice } from '@/lib/theme-runtime';
import { THEME_STORAGE_KEY, resolveTheme, type ResolvedTheme, type ThemeChoice } from '@/lib/theme';

const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

function readKey(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeKey(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Private mode can throw. The stamp below still applies for this view.
  }
}

/**
 * Light is the default when nothing is stored. An explicit `system`, `light`
 * or `dark` choice is left alone. The toggle itself only ever writes `light`
 * or `dark`, under the same `harvest-theme` key the rest of the app reads.
 */
export function ensureLightDefault(): void {
  if (typeof window === 'undefined') return;
  if (readKey() !== null) return;
  writeKey('light');
  applyTheme('light');
}

export function useShellTheme(): { resolved: ResolvedTheme; toggle: () => void } {
  const [choice, setChoice] = useState<ThemeChoice>('light');

  const sync = useCallback(() => {
    ensureLightDefault();
    const next = readStoredChoice();
    setChoice(next);
    applyTheme(next);
  }, []);

  useEffect(() => {
    sync();
  }, [sync]);

  const resolved = resolveTheme(choice, prefersDark());

  const toggle = useCallback(() => {
    const next: ResolvedTheme = resolved === 'dark' ? 'light' : 'dark';
    writeKey(next);
    applyTheme(next);
    setChoice(next);
  }, [resolved]);

  return { resolved, toggle };
}
