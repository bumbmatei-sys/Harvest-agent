"use client";

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { InstallPanel, useInstallState } from './install/InstallInstructions';
import { isInstallHandled, isInstalled, isNativeShell } from '../lib/pwa-install';

/**
 * ⚠️ THE-255 — THIS POPUP IS CURRENTLY UNREACHABLE, and that is a finding, not
 * a claim about what it should be. `showPrompt` is set only by
 * `checkPromptTrigger`, which needs either `sessionStorage.pwa_prompt_ready` or
 * an `onboardingComplete` window event — and NOTHING in src writes either one.
 * The install UI below therefore never paints today.
 *
 * It is kept (rather than deleted) because the SECOND effect in this file is
 * very much alive: it is what gets a freshly deployed service worker to a
 * returning visitor, and removing the component would take that with it.
 *
 * What DID change: it no longer carries its own copy of the add-to-home-screen
 * instructions. It had drifted from `Onboarding.tsx`'s copy in both directions
 * — this one had the Android wording right, that one had three steps and a
 * desktop branch — which is exactly why the copy now lives once, in
 * `lib/pwa-install.ts`, and every surface renders `InstallPanel` over it. If
 * this popup is ever revived it revives with instructions that are already
 * correct and already in step with the other three surfaces.
 */
export default function PWAInstallManager() {
  const [showPrompt, setShowPrompt] = useState(false);
  const { state, promptInstall } = useInstallState();

  useEffect(() => {
    // 1. Check if we've already shown the prompt this session
    const hasPromptedThisSession = sessionStorage.getItem('pwa_prompt_shown');
    if (hasPromptedThisSession === 'true') {
      return;
    }

    // Install is now handled as an onboarding step; once that step has run
    // (installed OR skipped) we never show this legacy popup again. THE-255:
    // the three questions are the shared ones now — including the native shell,
    // where there is nothing to install at all.
    if (isInstallHandled() || isInstalled() || isNativeShell()) {
      return;
    }

    // Check if they just finished onboarding.
    // ⚠️ Neither trigger is written anywhere in src — see the note on the
    // component. This is what makes the popup unreachable today.
    const checkPromptTrigger = () => {
      if (sessionStorage.getItem('pwa_prompt_ready') === 'true') {
        sessionStorage.removeItem('pwa_prompt_ready');
        setTimeout(() => {
          setShowPrompt(true);
        }, 1500);
      }
    };

    checkPromptTrigger();
    window.addEventListener('onboardingComplete', checkPromptTrigger);

    return () => {
      window.removeEventListener('onboardingComplete', checkPromptTrigger);
    };
  }, []);

  // Ensure a freshly deployed service worker actually reaches the user.
  // next-pwa precaches the app shell, so without this a returning visitor can
  // keep seeing the OLD cached bundle after a deploy. We proactively check for
  // an update and, when a new SW takes control, reload once to pick it up.
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    let refreshing = false;
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      // Skip the very first install (no previous controller) — nothing to refresh.
      if (refreshing || !hadController) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    // Ask the browser to check for a newer service worker now and on focus.
    const checkForUpdate = () => {
      navigator.serviceWorker.getRegistration().then(reg => { reg?.update().catch(() => {}); }).catch(() => {});
    };
    checkForUpdate();
    window.addEventListener('focus', checkForUpdate);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      window.removeEventListener('focus', checkForUpdate);
    };
  }, []);

  const dismissPrompt = () => {
    setShowPrompt(false);
    sessionStorage.setItem('pwa_prompt_shown', 'true');
    console.log('PWA Prompt dismissed by user.');
  };

  const handleInstallClick = async () => {
    await promptInstall();
    dismissPrompt();
  };

  // Only ever a mobile nudge — desktop has the browser's own install
  // affordance in the address bar and never wanted a bottom sheet.
  // `state` also resolves 'native-shell' / 'installed', which the effect above
  // has already refused to show, so those never reach here.
  const isReadyToShow = showPrompt && (state === 'ios' || state === 'android' || state === 'prompt');

  return (
    <AnimatePresence>
      {isReadyToShow && <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-24 left-4 right-4 z-[100] md:bottom-8 md:max-w-sm md:left-1/2 md:-translate-x-1/2 bg-surface-raised rounded-2xl shadow-2xl border border-line-subtle p-4"
      >
        <button
          onClick={dismissPrompt}
          className="absolute top-2 right-2 p-1.5 bg-surface-tint text-faint hover:text-body hover:bg-surface-sunken rounded-full transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div className="pt-1 pr-6">
          <h3 className="mb-2 font-display text-base font-bold tracking-tight text-strong">Install Harvest App</h3>
          {/* THE-255: the SAME panel the onboarding step and the settings modal
              render — one paragraph of instructions in the whole app. */}
          <InstallPanel
            state={state}
            onInstall={handleInstallClick}
            onAcknowledge={dismissPrompt}
            acknowledgeLabel="Got it"
          />
        </div>
      </motion.div>}
    </AnimatePresence>
  );
}
