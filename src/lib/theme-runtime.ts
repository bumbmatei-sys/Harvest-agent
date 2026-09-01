'use client';
import { useEffect, useLayoutEffect } from 'react';
import {
  THEME_STORAGE_KEY,
  FAMILY_STORAGE_KEY,
  DEFAULT_PALETTE_FAMILY,
  isThemeChoice,
  isPaletteFamily,
  resolveTheme,
  type ThemeChoice,
  type PaletteFamily,
} from './theme';
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
 *
 * The palette-family PR extends this same file rather than adding a second
 * one: `applyTheme` now stamps `data-palette` alongside `data-theme`/`.dark`,
 * so mode and family always land through the identical call. A family
 * argument defaults to the stored value (re-read fresh on every call, not
 * cached), which is why picking a new MODE from the toggle needs no changes
 * here at all — the family that was already active is simply re-stamped.
 * Only the pre-auth/funnel force below passes an explicit override.
 */

const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * Read the persisted family. Never writes — see the file header.
 *
 * THE-265: both fall-throughs resolve to DEFAULT_PALETTE_FAMILY rather than
 * spelling a literal, so "what a missing value means" has exactly one home in
 * the bundled code. A stored 'harvest' or 'classic' is still returned as-is —
 * a user who has chosen keeps their choice; only the ABSENT and the GARBAGE
 * cases moved.
 */
export function readStoredFamily(): PaletteFamily {
  try {
    const raw = localStorage.getItem(FAMILY_STORAGE_KEY);
    return isPaletteFamily(raw) ? raw : DEFAULT_PALETTE_FAMILY;
  } catch {
    // localStorage can throw in private mode / sandboxed iframes.
    return DEFAULT_PALETTE_FAMILY;
  }
}

/**
 * Stamp <html>. Mirrors exactly what the pre-paint script does.
 *
 * `family` defaults to whatever is currently stored so that callers changing
 * only the mode (the toggle) don't have to know about the family axis at
 * all. Callers that need to FORCE a family — the pre-auth/funnel override
 * below — pass it explicitly, the same way they already pass an explicit
 * `choice` instead of relying on resolveTheme's default.
 */
export function applyTheme(choice: ThemeChoice, family: PaletteFamily = readStoredFamily()): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(choice, prefersDark());
  const el = document.documentElement;
  el.setAttribute('data-theme', resolved);
  el.classList.toggle('dark', resolved === 'dark');
  el.setAttribute('data-palette', family);
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
 *
 * The same `forced` flag also pins the FAMILY, not just the mode to light.
 * Reasoning: these are the screens a prospective customer sees before they
 * have an account at all, so a RETURNING signed-out user's stored family must
 * not leak through and put a combination nobody has design-reviewed in front
 * of the one audience that has not paid yet. THE-85 exists to keep half-
 * configured states off the screens where "reads as a broken product" is the
 * cost of getting it wrong, so the funnel renders exactly ONE presentation.
 *
 * 🔴 THE-265 CHANGED WHICH ONE, and coupled it to the default rather than
 * spelling a second literal. `DEFAULT_PALETTE_FAMILY`, not `'classic'`: the
 * property the funnel actually wants is "render what a brand-new visitor gets
 * once they are inside", and a literal would have to be found and changed
 * again the next time the default moves. This cannot drift out of step with
 * it. It is still a FORCE — a stored 'harvest' is ignored here exactly as a
 * stored 'dark' is — so the funnel is still one deterministic presentation,
 * and it is now the same one the app opens in.
 *
 * ⚠️ VERIFIED, not assumed, because THE-85's original argument was that only
 * Harvest light had been checked. Every text token AuthPage actually paints
 * clears AA on the ground it paints on, under Classic light, and three of the
 * four improve on Harvest: --text-heading 14.25 -> 16.42:1, --text-faint
 * 4.98 -> 5.18:1, --text-body 9.52 -> 9.78:1, --text-muted 6.62 -> 6.61:1.
 * The `AuthShell` ground is `--cream`, which Classic does not override, so it
 * is the identical colour in both families. Asserted in `preauth-light.test.ts`
 * against the REAL Classic-light scope (`:root` with Classic's overrides
 * cascaded on top), not against `:root` alone.
 */
export function applyThemeForLocation(pathname?: string): void {
  if (typeof document === 'undefined') return;
  const path = pathname ?? window.location.pathname;
  const forced = forcedLightCount > 0 || isPreAuthPath(path);
  applyTheme(forced ? 'light' : readStoredChoice(), forced ? DEFAULT_PALETTE_FAMILY : readStoredFamily());
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
