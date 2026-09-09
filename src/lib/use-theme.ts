'use client';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  THEME_STORAGE_KEY,
  THEME_CHOICES,
  type ThemeChoice,
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
 * (THE-338 note: two further objections used to stand here, both about the
 * second PALETTE axis next-themes has no slot for. That axis is gone — one
 * family now — so they were removed rather than left as reasoning nobody can
 * check. The one below still stands on its own, and is sufficient.)
 *
 *  🔴 It ships its own inline pre-paint script, unconditionally, from
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
 * the only stamping path THE-85 consolidated to — `theming-neutral-palette
 * .test.ts` enforces that across all of src/ — and the setter below delegates
 * to it. What is read back is the stamp itself, not a second resolution of
 * the stored choice, so this hook cannot disagree with what is on screen.
 */

/**
 * next-themes' `UseThemeProps`, narrowed to the one axis Harvest has.
 *
 * A component that destructures the next-themes fields compiles and behaves
 * unchanged. THE-338 removed `palette` / `palettes` / `setPalette`: there is
 * one family, so a field reporting which one is active can only ever return
 * the same answer.
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
  themes: readonly ThemeChoice[];
  /** Persist and apply a MODE choice — what ThemeToggle's button does. */
  setTheme: (choice: ThemeChoice) => void;
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
 *  (the pre-paint script and applyTheme) set it. */
function readStamp(): ResolvedTheme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function useTheme(): HarvestTheme {
  // Seeded with the value a brand-new visitor renders in, so SSR and the
  // first client render agree; the layout effect below corrects from the real
  // stamp before the browser paints. Same contract useResolvedTheme has.
  const [stamp, setStamp] = useState<ResolvedTheme>('light');
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [system, setSystem] = useState<ResolvedTheme>('light');

  useIsomorphicLayoutEffect(() => {
    const sync = () => {
      // applyTheme writes both the attribute and the class, so one theme
      // change produces two mutation records; setState bails on an identical
      // primitive, so consumers re-render once rather than twice.
      setStamp(readStamp());
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
      attributeFilter: ['data-theme', 'class'],
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
  const forcedTheme = choice !== 'system' && choice !== stamp ? stamp : undefined;

  return {
    theme: stamp,
    resolvedTheme: stamp,
    systemTheme: system,
    themeChoice: choice,
    forcedTheme,
    themes: THEME_CHOICES,
    setTheme,
  };
}
