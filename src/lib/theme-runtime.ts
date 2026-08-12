'use client';
import { useEffect, useLayoutEffect } from 'react';
import { THEME_STORAGE_KEY, isThemeChoice, resolveTheme, type ThemeChoice } from './theme';
import { isPreAuthPath } from './preauth-theme';

/**
 * THE-85 — the client half of theme application.
 *
 * `applyTheme` and `readStoredChoice` moved here from ThemeToggle unchanged, so
 * the toggle and the pre-auth override stamp <html> through ONE code path
 * instead of two that could disagree. The Appearance control's behaviour is
 * untouched: it still reads and writes the same key, and still stamps directly
 * rather than through React state.
 *
 * ⚠️ Nothing in this file WRITES the stored preference. The pre-auth override
 * only changes what is rendered, never what is remembered — a user who signs
 * out of dark mode gets a light sign-in screen and is back in dark the moment
 * they sign in again. That is the whole point of forcing at this layer rather
 * than resolving the choice to 'light' and persisting it.
 */

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

/** Read the persisted choice. Never writes — see the file header. */
export function readStoredChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(raw) ? raw : 'system';
  } catch {
    // localStorage can throw in private mode / sandboxed iframes.
    return 'system';
  }
}

/**
 * How many mounted screens have declared themselves part of the signup funnel.
 *
 * A counter rather than a boolean so overlapping declarations (OnboardingGate's
 * transitional screens render INSIDE the same tree that also matches a funnel
 * path) cannot have one unmount clear a force another is still asserting.
 */
let forcedLightCount = 0;

/**
 * Apply the theme this location should render.
 *
 * The single decision point: a funnel path or a declared funnel screen renders
 * light no matter what is stored; everything else resolves the stored choice as
 * usual. Defaults to the live URL because a screen declaring itself (below)
 * knows its own state but not its route — and inside the SPA, React Router has
 * already updated `window.location` by the time effects run.
 */
export function applyThemeForLocation(pathname?: string): void {
  if (typeof document === 'undefined') return;
  const path = pathname ?? window.location.pathname;
  const forced = forcedLightCount > 0 || isPreAuthPath(path);
  applyTheme(forced ? 'light' : readStoredChoice());
}

/**
 * Layout effects would warn if this ever rendered on the server. It cannot
 * today (every caller is inside the ssr:false SPA shell), but the guard is free
 * and the timing matters: a passive effect lands AFTER paint, which is exactly
 * the dark flash this PR exists to remove.
 */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Re-apply the theme on every SPA route change.
 *
 * The pre-paint script runs once per document load, so it cannot see a
 * client-side navigation — and the navigation that matters most is signing OUT
 * of dark mode, which App.tsx handles with `navigate('/auth')` and no reload.
 * Without this, the sign-in screen would keep the `.dark` class the signed-in
 * session left on <html>. Runs in a layout effect so the stamp lands before the
 * browser paints the new route.
 */
export function usePreAuthTheme(pathname: string): void {
  useIsomorphicLayoutEffect(() => {
    applyThemeForLocation(pathname);
  }, [pathname]);
}

/**
 * Declare that the screen being rendered belongs to the signup funnel.
 *
 * For the funnel screens that have NO path of their own: the post-checkout
 * return ("Setting up your account…"), "Complete your payment", first-run
 * setup, and the tenant-not-found error page. All of these render at "/" and
 * are only identifiable once an async read resolves, so the URL cannot classify
 * them — the screen that knows says so.
 */
export function useForcedLightTheme(active: boolean): void {
  useIsomorphicLayoutEffect(() => {
    if (!active) return;
    forcedLightCount += 1;
    applyThemeForLocation();
    return () => {
      forcedLightCount -= 1;
      applyThemeForLocation();
    };
  }, [active]);
}
