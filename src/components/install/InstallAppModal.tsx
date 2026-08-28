"use client";

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import ModalContentContainer from '../ModalContentContainer';
import { InstallHeading, InstallPanel, useInstallState } from './InstallInstructions';
import { markInstallHandled } from '../../lib/pwa-install';

interface InstallAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * THE-255 part 2 — the Install app button in member account settings, opening
 * THE SAME screen the onboarding step shows.
 *
 * "The same screen" is literal: this renders `InstallHeading` + `InstallPanel`
 * over `INSTALL_STEPS`, which is what `Onboarding.tsx`'s `PwaInstallStep` and
 * the end-of-onboarding step render too. Nothing about the instructions is
 * restated here — only the chrome, which is the house full-screen overlay the
 * other member modals (Contact, FAQ, Privacy & Terms) use, with the shared
 * `ModalContentContainer` so it does not run edge to edge on a monitor (THE-142).
 *
 * ── The states this handles ─────────────────────────────────────────────────
 *   native-shell  inside the Capacitor shell — the row is not even rendered in
 *                 Profile, so this never opens there (see `InstallAppRow`)
 *   installed     already added to the home screen → says so, offers no steps
 *   prompt        the browser gave us a real `beforeinstallprompt` → one tap
 *   ios           Share → Add to Home Screen (iOS fires no install event, ever)
 *   android       ⋮ menu → Install app
 *   desktop       the address-bar install icon / Add to Dock
 *
 * ⚠️ Opening this modal does NOT write `pwa_installed`: a member who came here
 * on purpose to read the steps has not skipped anything, and marking them
 * "handled" would silently remove the step from an onboarding they have not
 * reached yet. Only actually installing does — and closing simply closes.
 */
const InstallAppModal: React.FC<InstallAppModalProps> = ({ isOpen, onClose }) => {
  const { state, promptInstall } = useInstallState();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-surface animate-in slide-in-from-bottom-full duration-300 overflow-hidden">
      <div className="flex items-center px-4 py-4 bg-surface-raised border-b border-line sticky top-0 z-10">
        <button onClick={onClose} className="p-2 -ml-2 text-muted" aria-label="Back">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-lg font-bold text-strong flex-1 text-center pr-8 font-display">Install app</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ModalContentContainer>
          <InstallHeading state={state} />
          <InstallPanel
            state={state}
            onInstall={async () => { await promptInstall(); markInstallHandled(); onClose(); }}
            onAcknowledge={onClose}
            acknowledgeLabel="Got it"
          />
        </ModalContentContainer>
      </div>
    </div>
  );
};

export default InstallAppModal;
