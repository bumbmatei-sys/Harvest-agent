'use client';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  THEME_STORAGE_KEY,
  FAMILY_STORAGE_KEY,
  DEFAULT_PALETTE_FAMILY,
  THEME_CHOICES,
  PALETTE_FAMILIES,
  isPaletteFamily,
  type ThemeChoice,
  type PaletteFamily,
  type ResolvedTheme,
} from './theme';
import { applyTheme, readStoredChoice } from './theme-runtime';

/**
 * THE-271 — the shadcn-facing read of Harvest's theme, WITHOUT next-themes.
 *
 * ─── why this file exists, and why `next-themes` is not the answer ─────────
 *
 * shadcn components are copy-pasted from upstream and call
 * `useTheme()` from `next-themes`. There is no next-themes `ThemeProvider`
 * anywhere in this app, so that call returns the library's empty fallback
 * context and `theme` is `undefined` — `src/components/ui/sonner.tsx` says
 * so in its own comment. The obvious fix is "mount the provider". It does not work
 * here, and the reasons were MEASURED against the installed 0.4.6, not
 * inferred (see `the-271-one-theme-system.test.tsx`, section 1, which drives
 * the real library and asserts each one):
 *
 *  1. 🔴 next-themes models ONE axis. Harvest has TWO — `data-theme`
 *     (light/dark) × `data-palette` (harvest/classic), four palettes. Its
 *     `attribute` prop accepts an array, but `applyTheme` computes a SINGLE
 *     string and writes THAT SAME STRING to every attribute in the array:
 *     `attribute={['data-theme','data-palette']}` yields
 *     `data-palette="dark"`, which matches no rule in globals.css. The
 *     `value` prop cannot rescue it either — it maps a theme name to one
 *     string, not to one string per attribute — so even the four-way cross
 *     product ('classic-dark', …) collapses to the same value on both
 *     attributes. The second axis is not expressible.
 *
 *  2. 🔴 It has ONE `storageKey` holding ONE value. Harvest stores two
 *     INDEPENDENT preferences under two keys, on purpose: a family can be
 *     absent while a mode is chosen, and vice versa. Folding them into one
 *     key would rewrite every existing user's stored choice.
 *
 *  3. 🔴 It ships its own inline pre-paint script, unconditionally, from
 *     inside the provider. layout.tsx already has one — and that one knows
 *     about PREAUTH_PATHS. next-themes' does not, so on `/auth` it would
 *     read the stored 'dark' and stamp dark straight over the light the
 *     first script just forced. Two scripts writing `data-theme` and `.dark`
 *     on the same element is the flash the mechanism exists to prevent, and
 *     it would take THE-85 with it.
 *
 * So next-themes owns nothing here. This hook is the thin shim instead: it
 * READS what the existing system has already stamped on `<html>` and hands it
 * back in a next-themes-shaped object, so adopting it in a shadcn component
 * is a one-line change of import specifier.
 *
 * ⚠️ ONE DELIBERATE DIVERGENCE FROM next-themes' CONTRACT, and it is the
 * whole reason this is safe to drop in. next-themes' `theme` is the STORED
 * choice, so it can be the string `"system"`. sonner takes `theme` straight
 * through to its own `theme` prop, and `"system"` makes sonner follow the OS
 * — which is exactly how you get dark toasts on a light-forced sign-in page.
 * Here `theme` is the RESOLVED theme, always 'light' or 'dark', because in
 * Harvest the active theme genuinely is what is stamped: the pre-auth force
 * means the stored choice is not always the one rendering. What is REMEMBERED
 * is still available, under `themeChoice`.
 *
 * ⚠️ This file never stamps `<html>`. `applyTheme` in theme-runtime.ts stays
 * the only stamping path THE-85 consolidated to — `theming-classic-palette
 * .test.ts` enforces that across all of src/ — and the setters below delegate
 * to it. What is read back is the stamp itself, not a second resolution of
 * the stored choice, so this hook cannot disagree with what is on screen.
 */

/**
 * next-themes' `UseThemeProps`, plus the axis it has no slot for.
 *
 * A superset on purpose: a component that destructures the next-themes
 * fields compiles and behaves unchanged, and one that needs the family (a
 * chart picking series colours in JS, say — CSS variables cannot reach a
 * canvas) has somewhere to read it from.
 */
export interface HarvestTheme {
  /** 🔴 'light' | 'dark' — what is ACTUALLY stamped on `<html>` right now.
   *  Never 'system'; see the divergence note above. */
  theme: ResolvedTheme;
  /** Identical to `theme`. Present so next-themes-shaped code that prefers
   *  the explicit name reads naturally. */
  resolvedTheme: ResolvedTheme;
  /** The OS preference, whatever is actually active. */
  systemTheme: ResolvedTheme;
  /** 🔴 What is REMEMBERED — may be 'system', and may differ from `theme`
   *  while a pre-auth force is in effect. Reading it never writes it. */
  themeChoice: ThemeChoice;
  /** 'light' while something is overriding the stored choice (the THE-85
   *  pre-auth funnel), else undefined — mirrors next-themes' `forcedTheme`.
   *  Derived from the stamp disagreeing with storage rather than from the
   *  route, so it covers both halves of the force: the paths the URL knows
   *  and the funnel screens that declare themselves after an async read. */
  forcedTheme: ResolvedTheme | undefined;
  /** 🔴 The second axis. 'harvest' | 'classic'. */
  palette: PaletteFamily;
  themes: readonly ThemeChoice[];
  palettes: readonly PaletteFamily[];
  /** Persist and apply a MODE choice — what ThemeToggle's button does. */
  setTheme: (choice: ThemeChoice) => void;
  /** Persist and apply a FAMILY choice — what PaletteFamilyToggle does. */
  setPalette: (family: PaletteFamily) => void;
}

/**
 * Layout effects would warn if this ever rendered on the server, and the
 * timing is the point: a passive effect lands AFTER paint, so a component
 * whose markup depends on the theme would paint light and then correct —
 * the flash, one component deep. Same idiom, same reason, as theme-runtime.
 */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

/** What `<html>` currently carries. The stamp is the truth — both writers
 *  (the pre-paint script and applyTheme) set both attributes together. */
function readStamp(): { theme: ResolvedTheme; palette: PaletteFamily } {
  const el = document.documentElement;
  const raw = el.getAttribute('data-palette');
  return {
    theme: el.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
    palette: isPaletteFamily(raw) ? raw : DEFAULT_PALETTE_FAMILY,
  };
}

export function useTheme(): HarvestTheme {
  // Seeded with the values a brand-new visitor renders in, so SSR and the
  // first client render agree; the layout effect below corrects from the real
  // stamp before the browser paints. Same contract useResolvedTheme has, and
  // the same reason PaletteFamilyToggle seeds from DEFAULT_PALETTE_FAMILY.
  const [stamp, setStamp] = useState<{ theme: ResolvedTheme; palette: PaletteFamily }>({
    theme: 'light',
    palette: DEFAULT_PALETTE_FAMILY,
  });
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [system, setSystem] = useState<ResolvedTheme>('light');

  useIsomorphicLayoutEffect(() => {
    const sync = () => {
      // Bail on an unchanged value: applyTheme writes all three attributes,
      // so one theme change produces three mutation records, and a fresh
      // object each time would re-render every consumer three times over.
      setStamp((prev) => {
        const next = readStamp();
        return prev.theme === next.theme && prev.palette === next.palette ? prev : next;
      });
      setChoice(readStoredChoice());
      setSystem(prefersDark() ? 'dark' : 'light');
    };
    sync();

    // Both writers stamp `<html>` directly rather than through React, so an
    // observer is the only way to hear about a change — exactly the reason
    // useResolvedTheme watches the same attributes. `class` is watched too
    // because `.dark` is the compatibility hook some rules match on.
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-palette', 'class'],
    });

    // While the stored choice is 'system', the OS moving changes what renders
    // without anyone touching storage.
    const mq =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    mq?.addEventListener?.('change', sync);

    // ⚠️ DELIBERATELY NOT listening for `storage`. Harvest's theme system does
    // not cross-sync tabs — the pre-paint script runs once per document load
    // and applyTheme runs per navigation — so another tab's toggle does not
    // restamp this one. Reacting to it here would move `themeChoice` while
    // `theme` stayed put, i.e. report a preference this tab is not rendering.
    // A same-tab change needs no listener: applyTheme stamps <html>, and the
    // observer above is what re-reads storage.
    return () => {
      observer.disconnect();
      mq?.removeEventListener?.('change', sync);
    };
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // A blocked localStorage must not stop the theme from applying for this
      // session — it only means the choice will not survive a reload.
    }
    applyTheme(next);
  }, []);

  const setPalette = useCallback((next: PaletteFamily) => {
    try {
      localStorage.setItem(FAMILY_STORAGE_KEY, next);
    } catch {
      // Same as above.
    }
    // Mode is untouched by a family change — re-apply whatever mode is
    // already current rather than assuming light, exactly as
    // PaletteFamilyToggle does.
    applyTheme(readStoredChoice(), next);
  }, []);

  /**
   * A force is in effect when a CONCRETE stored choice disagrees with what is
   * stamped. Nothing here writes, so observing the disagreement is the whole
   * of it: the funnel changes what is rendered, never what is remembered.
   *
   * ⚠️ A stored 'system' is deliberately excluded rather than resolved
   * through `resolveTheme`. The OS can move while no one is re-stamping
   * <html> — ThemeToggle subscribes to that, but it is only mounted on the
   * settings screens — so under 'system' a disagreement means "the stamp is
   * older than the OS", not "something is forcing". Reporting a force there
   * would be a false positive on an ordinary screen, which is worse than
   * staying quiet: with 'system' stored there is no remembered mode being
   * overridden in the first place.
   */
  const forcedTheme = choice !== 'system' && choice !== stamp.theme ? stamp.theme : undefined;

  return {
    theme: stamp.theme,
    resolvedTheme: stamp.theme,
    systemTheme: system,
    themeChoice: choice,
    forcedTheme,
    palette: stamp.palette,
    themes: THEME_CHOICES,
    palettes: PALETTE_FAMILIES,
    setTheme,
    setPalette,
  };
}
