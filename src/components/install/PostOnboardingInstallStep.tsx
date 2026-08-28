"use client";

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { InstallHeading, InstallPanel, useInstallState } from './InstallInstructions';
import { isInstallHandled, isInstalled, isNativeShell, markInstallHandled } from '../../lib/pwa-install';
import { getTenantIdFromHost } from '../../utils/tenant-scope';

/**
 * THE-255 part 1 — the add-to-home-screen step at the END of the paid-plan
 * onboarding flow.
 *
 * ── 🔴 WHERE "THE END" IS, AND WHY IT IS HERE ────────────────────────────────
 * The paid funnel does not end where it looks like it ends. It runs:
 *
 *   apex `theharvest.app`  signup → checkout → back on `/?dodo=success`
 *     ↓                    OnboardingGate: 'paying' → 'first-run'
 *   WorkspaceHandoff       the payment confirmation, deliberately BEFORE the hop
 *     ↓                    (paid-arrival.ts holds the redirect for exactly this)
 *   ═══ ORIGIN HOP ═══     → `<tenant>.theharvest.app/admin`
 *     ↓                    a DIFFERENT origin: Firebase auth is origin-scoped
 *   /auth                  ⚠️ A SECOND SIGN-IN, which cannot be removed
 *     ↓
 *   FirstRunSetup          claim the address, brand it → `finish-setup`
 *     ↓                    (renaming the tenant can hop a SECOND time)
 *   /admin                 ← the church is finally in its finished workspace
 *
 * A step shown anywhere above the hop is a step the church never finishes: it
 * is interrupted by a sign-in wall on another origin, and — worse — a PWA
 * install is ORIGIN-SCOPED, so installing on the apex would put a
 * `theharvest.app` icon on the phone while the church's actual workspace lives
 * at `<tenant>.theharvest.app`. The one moment both facts are true — onboarding
 * is genuinely finished, and this is the origin worth installing — is `/admin`
 * on the tenant's own subdomain.
 *
 * ── HOW THAT IS ESTABLISHED, WITHOUT TOUCHING THE FUNNEL ─────────────────────
 * This component is mounted beside `<AdminDashboard/>` inside `adminElement`,
 * which sits inside `<Routes>`, which sits inside `<OnboardingGate>`. The gate
 * renders its children ONLY on `status === 'ready'` — its own definition of
 * "onboarding is done" — and `RequireAdmin` wraps the element. So "onboarding
 * complete" and "is an admin" are not re-derived here; they are structural, and
 * they cost no read. This adds NO route, changes no route order, and touches no
 * funnel marker: `FUNNEL_PATHS`, `resolvePostAuthFunnelRoute`, `signupInProgress`,
 * `termsAccepted`, the paid-arrival hold and Turnstile's mount are all untouched.
 *
 * ⚠️ Deliberately NOT gated on `hasSeenPaymentConfirmation()`, which was the
 * obvious "they just came through the paid handoff" signal. It is carried by
 * `?payment_confirmed=1`, and only the PRE-first-run handoff sets
 * `suppressRepeatAtDestination`. A church that renames its subdomain in
 * FirstRunSetup hops a second time on a href built WITHOUT that parameter, so
 * the marker is absent on the origin it finally lands on — i.e. the signal is
 * missing in exactly the common case. Tenant-owned origin + a gate that has
 * resolved to ready is true on both paths.
 *
 * ── SKIPPING ────────────────────────────────────────────────────────────────
 * Skip writes `pwa_installed` — the SAME one-time marker the member signup step
 * has always used — and nothing else. It writes no tenant state, no funnel
 * state and no route: the funnel was already complete before this rendered, and
 * dismissing an overlay cannot make it incomplete.
 *
 * ── FREE TENANTS ────────────────────────────────────────────────────────────
 * A free tenant reaches the same destination (THE-239/THE-214: it picks its
 * address at signup, arrives `setupCompleted: true`, never sees FirstRunSetup,
 * and never passes a checkout), so it lands on `/admin` on its own subdomain
 * with the gate ready and sees this step there. Nothing about it is
 * plan-specific, which is why no plan is read.
 */
const PostOnboardingInstallStep: React.FC = () => {
  const { state, promptInstall } = useInstallState();

  /**
   * Decided once, on mount, rather than on every render.
   *
   * A church that installs from the button below flips `isInstalled()` in some
   * browsers mid-session; re-deriving would then yank the card away underneath
   * the finger that is still on it. `dismiss()` is the only way out.
   */
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (isNativeShell()) return;          // already the app — nothing to install
    if (isInstalled()) return;            // already added to the home screen
    if (isInstallHandled()) return;       // installed or skipped before
    if (getTenantIdFromHost() === null) return; // the apex is not the church's origin
    setOpen(true);
  }, []);

  const dismiss = () => {
    markInstallHandled();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      data-testid="post-onboarding-install"
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/40 px-5 py-10"
    >
      <div className="relative w-full max-w-[452px] rounded-brand-xl border border-line bg-surface-raised p-6 shadow-[var(--ds-sh-md)]">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-sunken hover:text-body"
        >
          <X size={18} />
        </button>

        <div className="text-xs font-semibold uppercase tracking-[0.19em] text-gold">One last thing</div>
        <InstallHeading state={state} />
        <InstallPanel
          state={state}
          onInstall={async () => { await promptInstall(); dismiss(); }}
          onAcknowledge={dismiss}
          footer={
            <button
              onClick={dismiss}
              className="w-full py-1 text-center text-sm font-semibold text-body transition-colors hover:opacity-70"
            >
              Skip for now
            </button>
          }
        />
      </div>
    </div>
  );
};

export default PostOnboardingInstallStep;
