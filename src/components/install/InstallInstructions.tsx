"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, MoreVertical, PlusSquare, Share, type LucideIcon } from 'lucide-react';
import {
  INSTALL_BLURB,
  type InstallIcon,
  type InstallSegment,
  type InstallState,
  markInstallHandled,
  resolveInstallState,
  stepsFor,
} from '../../lib/pwa-install';

/**
 * THE-255 — the ONE rendering of the add-to-home-screen instructions.
 *
 * Three surfaces show these steps: the member signup step (`Onboarding.tsx`),
 * the end of the paid onboarding flow (`PostOnboardingInstallStep`), and the
 * Install app button in member settings (`InstallAppModal`). They render this
 * component over `INSTALL_STEPS`, so there is one paragraph to keep true rather
 * than three to keep in sync — instructions that drift are worse than none,
 * because a member following stale steps concludes the app is broken.
 *
 * ⚠️ Every colour here is a semantic token (`text-body`, `bg-gold`,
 * `bg-surface-sunken`, …) and not a literal. Those resolve per palette, so the
 * same markup is correct in all four (harvest/classic × light/dark) with
 * nothing to re-declare per surface.
 */

const ICONS: Record<InstallIcon, LucideIcon> = {
  share: Share,
  menu: MoreVertical,
  plus: PlusSquare,
};

const Segment: React.FC<{ segment: InstallSegment }> = ({ segment }) => {
  if (segment.kind === 'text') return <>{segment.value}</>;
  if (segment.kind === 'strong') return <strong className="font-semibold text-strong">{segment.value}</strong>;
  const Icon = ICONS[segment.value];
  return <Icon size={15} className="inline-block align-text-bottom text-gold" />;
};

/** One numbered row — a gold disc and the step's prose. */
const InstructionRow: React.FC<{ num: number; children: React.ReactNode }> = ({ num, children }) => (
  <div className="flex items-center gap-3 rounded-lg bg-surface-sunken px-3.5 py-3">
    <span
      className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-gold text-xs font-bold text-white"
    >
      {num}
    </span>
    <span className="flex-1 pt-0.5 text-sm leading-snug text-body">{children}</span>
  </div>
);

/**
 * The numbered steps for one platform, and nothing else.
 *
 * `data-install-steps` names the platform in the DOM so a test can assert that
 * an Android user is never handed the iOS list, without matching on copy.
 */
export const InstallInstructions: React.FC<{ state: InstallState }> = ({ state }) => {
  const steps = stepsFor(state);
  if (!steps) return null;
  return (
    <div data-install-steps={state} className="space-y-2.5">
      {steps.map((segments, idx) => (
        <InstructionRow key={idx} num={idx + 1}>
          {segments.map((segment, s) => <Segment key={s} segment={segment} />)}
        </InstructionRow>
      ))}
    </div>
  );
};

/**
 * Captures the browser's `beforeinstallprompt` and exposes the one-tap install.
 *
 * ⚠️ Chromium fires this event on ANDROID AND DESKTOP Chrome/Edge, and iOS
 * Safari never fires it at all. That asymmetry is the whole reason the manual
 * steps exist, so this hook reports only whether a real prompt is in hand —
 * `resolveInstallState` decides what that means.
 *
 * `seed` lets a caller that already cached the event (Onboarding.tsx caches it
 * at the top of the funnel, long before its install step mounts) hand it over;
 * the hook still installs its own listener, so it reacts whether the event
 * arrived before or after mount.
 */
export function useInstallPrompt(seed?: React.MutableRefObject<any>) {
  const own = useRef<any>(null);
  const ref = seed ?? own;
  const [hasNativePrompt, setHasNativePrompt] = useState<boolean>(!!ref.current);

  useEffect(() => {
    if (ref.current) setHasNativePrompt(true);
    const handler = (e: Event) => {
      e.preventDefault();
      ref.current = e;
      setHasNativePrompt(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [ref]);

  /** Fire the browser's own install dialog. Resolves once the user answers. */
  const promptInstall = useCallback(async () => {
    const deferred = ref.current;
    if (!deferred) return;
    try {
      deferred.prompt();
      await deferred.userChoice;
    } catch { /* the user closed it; the manual steps still stand */ }
    // A deferred prompt is single-use — drop it whatever the answer was.
    ref.current = null;
    setHasNativePrompt(false);
  }, [ref]);

  return { hasNativePrompt, promptInstall };
}

/** The live install state for this device, kept current as the event lands. */
export function useInstallState(seed?: React.MutableRefObject<any>) {
  const { hasNativePrompt, promptInstall } = useInstallPrompt(seed);
  const state = resolveInstallState({ hasNativePrompt });
  return { state, promptInstall };
}

/**
 * The shared body of every install surface: the promise, then either the
 * one-tap button or the platform's own steps.
 *
 * The caller supplies its own chrome (a full-screen onboarding step, a modal,
 * an overlay card) and its own secondary action, because those genuinely
 * differ. Everything a member READS is here.
 */
export const InstallPanel: React.FC<{
  state: InstallState;
  onInstall: () => void | Promise<void>;
  /** "I've added it" / "Got it" — the caller decides the word and what it does. */
  onAcknowledge: () => void;
  acknowledgeLabel?: string;
  /** Rendered under the primary action (the onboarding step puts Skip here). */
  footer?: React.ReactNode;
}> = ({ state, onInstall, onAcknowledge, acknowledgeLabel = 'I’ve added it', footer }) => {
  const [installing, setInstalling] = useState(false);
  const settled = state === 'native-shell' || state === 'installed';

  const handleInstall = async () => {
    setInstalling(true);
    try { await onInstall(); } finally { setInstalling(false); }
  };

  return (
    <div data-install-state={state}>
      <p className="mb-6 text-center text-sm leading-relaxed text-body">{INSTALL_BLURB[state]}</p>

      {settled ? (
        // Nothing to install: say so instead of printing steps that cannot work.
        <button
          type="button"
          onClick={onAcknowledge}
          className="mb-3 flex h-12 w-full items-center justify-center rounded-lg bg-gold font-semibold text-white transition-all"
        >
          Done
        </button>
      ) : state === 'prompt' ? (
        <button
          type="button"
          onClick={handleInstall}
          disabled={installing}
          className="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gold font-semibold text-white transition-all disabled:opacity-50"
        >
          <Download size={18} /> {installing ? 'Installing…' : 'Install app'}
        </button>
      ) : (
        <>
          <div className="mb-6"><InstallInstructions state={state} /></div>
          <button
            type="button"
            onClick={onAcknowledge}
            className="mb-3 flex h-12 w-full items-center justify-center rounded-lg bg-gold font-semibold text-white transition-all"
          >
            {acknowledgeLabel}
          </button>
        </>
      )}

      {footer}
    </div>
  );
};

/** The gold disc + title every surface puts above the panel. */
export const InstallHeading: React.FC<{ state: InstallState; title?: string }> = ({ state, title = 'Install the app' }) => (
  <>
    <div className="mb-5 mt-4 flex justify-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-brand-lg bg-surface-gold text-gold">
        {state === 'ios' ? <Share size={32} /> : <Download size={32} />}
      </div>
    </div>
    <h1 className="mb-1.5 text-center font-display text-[26px] font-light tracking-[-0.02em] text-strong">
      {state === 'native-shell' || state === 'installed' ? 'Harvest is installed' : title}
    </h1>
  </>
);

export { markInstallHandled };
