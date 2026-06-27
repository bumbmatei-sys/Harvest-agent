"use client";

import React, { useState, useEffect } from 'react';
import { Share, PlusSquare, X } from 'lucide-react';
import { auth } from '../firebase';
import { motion, AnimatePresence } from 'framer-motion';

export default function PWAInstallManager() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'other'>('other');
  // Store the deferred prompt
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // 1. Check if we've already shown the prompt this session
    const hasPromptedThisSession = sessionStorage.getItem('pwa_prompt_shown');
    if (hasPromptedThisSession === 'true') {
      return;
    }

    // Install is now handled as a mandatory onboarding step; once that step has
    // run (installed OR skipped) we never show this legacy popup again.
    if (localStorage.getItem('pwa_installed') === 'true') {
      return;
    }

    // 2. Platform Detection
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(userAgent);
    const isAndroid = /android/.test(userAgent);
    
    setPlatform(isIOS ? 'ios' : isAndroid ? 'android' : 'other');

    // 3. Check Installation Status (Standalone mode)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    if (isStandalone) {
      return;
    }

    // 4. Listen for beforeinstallprompt (Android specifically)
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 5. Check if they just finished onboarding.
    const checkPromptTrigger = () => {
      if (sessionStorage.getItem('pwa_prompt_ready') === 'true') {
        setTimeout(() => {
          setShowPrompt(true);
        }, 1500);
        sessionStorage.removeItem('pwa_prompt_ready');
      }
    };

    checkPromptTrigger();
    window.addEventListener('onboardingComplete', checkPromptTrigger);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
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
    if (platform === 'android' && deferredPrompt) {
      // Show the install prompt
      deferredPrompt.prompt();
      
      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        console.log('User accepted the PWA install prompt');
      } else {
        console.log('User dismissed the PWA install prompt');
      }
      
      // We've used the prompt, and can't use it again, throw it away
      setDeferredPrompt(null);
      dismissPrompt();
    }
  };

  // Condition to render:
  // For iOS: just needs to be mobile iOS and showPrompt is true.
  // For Android: needs the deferredPrompt to be ready, plus showPrompt true.
  const isReadyToShow = showPrompt && (platform === 'ios' || platform === 'android');

  return (
    <AnimatePresence>
      {isReadyToShow && <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-24 left-4 right-4 z-[100] md:bottom-8 md:max-w-sm md:left-1/2 md:-translate-x-1/2 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4"
      >
        <button 
          onClick={dismissPrompt}
          className="absolute top-2 right-2 p-1.5 bg-gray-50 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div className="flex items-start gap-4 pt-1 pr-6">
          <div className="flex-shrink-0 w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center p-2 shadow-sm border border-gray-100">
            <img src="https://raw.githubusercontent.com/bumbmatei-sys/harvest-pics/main/fundal-alb.png" alt="App Icon" className="w-full h-full object-contain" />
          </div>
          
          <div className="flex-1">
            <h3 className="font-bold text-gray-900 text-base mb-1 tracking-tight">Install Harvest App</h3>
            
            {platform === 'ios' ? (
              <div className="text-sm text-gray-600">
                <p className="mb-2 leading-snug">Get quick access from your home screen:</p>
                <ol className="space-y-2 mt-2">
                  <li className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg">
                    <span className="font-bold text-gray-400">1.</span> 
                    Tap <Share size={16} className="text-blue-500" /> Share
                  </li>
                  <li className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg">
                    <span className="font-bold text-gray-400">2.</span> 
                    Select <PlusSquare size={16} className="text-gray-700" /> Add to Home Screen
                  </li>
                </ol>
                <div className="mt-3 flex justify-end">
                  <button 
                    onClick={dismissPrompt} 
                    className="text-sm font-semibold text-[#e6b325] hover:text-gold px-2 py-1"
                  >
                    Got it
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                <p className="mb-3 leading-snug">Install for the best experience, faster load times, and offline access.</p>
                {deferredPrompt ? (
                  <button 
                    onClick={handleInstallClick}
                    className="w-full bg-[#e6b325] text-white px-4 py-2.5 rounded-xl font-bold shadow-sm hover:bg-[#d4a219] active:scale-[0.98] transition-all"
                  >
                    Install Now
                  </button>
                ) : (
                  <div className="space-y-2 mt-2">
                    <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg">
                      <span className="font-bold text-gray-400">1.</span> 
                      Tap the browser menu (⋮)
                    </div>
                    <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg">
                      <span className="font-bold text-gray-400">2.</span> 
                      Select &quot;Add to Home screen&quot;
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button 
                        onClick={dismissPrompt} 
                        className="text-sm font-semibold text-[#e6b325] hover:text-gold px-2 py-1"
                      >
                        Got it
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>}
    </AnimatePresence>
  );
}
