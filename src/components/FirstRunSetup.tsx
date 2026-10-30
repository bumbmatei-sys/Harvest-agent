"use client";
import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { AlertCircle, Loader2, Sparkles, Rocket } from 'lucide-react';
import { auth, db } from '../firebase';
import { getPlanFeatures, toTenantPlan } from '../utils/plan-features';
import { TenantPlan } from '../types/tenant.types';
import { authFetch } from '../utils/auth-fetch';
import BrandingSection from './settings/BrandingSection';

const BRAND = 'var(--brand-color, #B8962E)';
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

interface FirstRunSetupProps {
  tenantId: string;
  /** Called with the final tenant id once setup is complete. */
  onFinished: (finalTenantId: string) => void;
}

/** Small uppercase gold section label used to group the setup cards. */
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-2.5 mt-8 text-xs font-semibold uppercase" style={{ letterSpacing: '0.16em', color: BRAND }}>{children}</div>
);

/**
 * One-time "Finish setup" screen shown to a brand-new church admin right after
 * payment (tenant exists with `setupCompleted: false`). Lets them claim a real
 * subdomain and configure branding / custom domain by reusing the existing
 * settings sections, then marks the tenant setup-complete and enters the app.
 */
const FirstRunSetup: React.FC<FirstRunSetupProps> = ({ tenantId, onFinished }) => {
  const [plan, setPlan] = useState<TenantPlan | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');

  // Load the tenant's plan + current (auto-generated) subdomain.
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'tenants', tenantId));
        if (snap.exists()) {
          const data = snap.data();
          setPlan(toTenantPlan(data.plan));
        } else {
          setError('Workspace not found. Please contact support.');
        }
      } catch {
        setError('Could not load setup. Please reload to try again.');
      }
    })();
  }, [tenantId]);

  const features = plan ? getPlanFeatures(plan) : null;
  const canFinish = plan !== null;

  const handleFinish = async () => {
    setFinishing(true);
    setError('');
    try {
      const resp = await authFetch('/api/tenants/finish-setup', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Failed to finish setup. Please try again.');
        setFinishing(false);
        return;
      }
      // Pick up the (possibly new) tenant claim before entering the app.
      try { await auth.currentUser?.getIdToken(true); } catch { /* non-fatal */ }
      onFinished(data.tenantId || tenantId);
    } catch (err: any) {
      console.error('Finish setup failed:', err);
      setError(err?.message || 'Connection error. Please try again.');
      setFinishing(false);
    }
  };

  // Once the user commits, replace the editable form with a dedicated transition
  // instead of leaving it on screen behind a spinning button — the finish-setup
  // write + token refresh below still take a beat, and without this the form's
  // sudden swap for a different origin's sign-in screen reads as a flash.
  if (finishing) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center" style={{ background: 'var(--cream, #FAF8F5)' }}>
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 -translate-x-1/2"
          style={{ top: '-16%', width: 720, height: 480, maxWidth: '160vw', background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-color, #C9963A) 12%, transparent), transparent 68%)' }}
        />
        <div className="relative z-[1] flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HARVEST_LOGO} alt="Harvest" className="mb-6 h-12 w-auto object-contain" />
          <Loader2 size={32} className="mb-5 animate-spin" style={{ color: BRAND }} />
          <h1 className="font-display" style={{ fontWeight: 300, fontSize: 26, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>
            Taking you to your ministry…
          </h1>
          <p className="mt-2.5 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
            Your workspace will open here on Harvest.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: 'var(--cream, #FAF8F5)' }}>
      {/* soft gold halo behind the header */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{ top: '-14%', width: 760, height: 480, maxWidth: '160vw', background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-color, #C9963A) 12%, transparent), transparent 68%)' }}
      />
      <div className="relative z-[1] mx-auto w-full px-5 py-12 sm:py-16" style={{ maxWidth: 560 }}>
        {/* Header */}
        <div className="mb-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HARVEST_LOGO} alt="Harvest" className="mx-auto mb-4 h-12 w-auto object-contain" />
          <div
            className="mb-3.5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12.5px] font-bold"
            style={{
              background: 'color-mix(in srgb, var(--brand-color, #C9963A) 12%, white)',
              border: '1px solid var(--border-gold, rgba(201,150,58,0.40))',
              color: BRAND,
            }}
          >
            {/* 🔴 THE-214. This screen is reached by ANY tenant still carrying
                `setupCompleted: false`, and a Forever Free tenant has paid
                nothing to get here. Read off the tenant's OWN plan, loaded just
                above, and failing closed to the payment badge: `plan` is null
                until that read resolves and falls back to 'church' when it
                fails, so a church that paid is never left unacknowledged.

                Free tenants created from THE-214 onward choose their address at
                signup and arrive with `setupCompleted: true`, so they never
                reach this screen at all — this is for the ones provisioned
                before that, who otherwise meet the same false claim here. */}
            <Sparkles size={13} /> Account created
          </div>
          <h1 className="font-display" style={{ fontWeight: 300, fontSize: 32, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>
            Finish setting up your ministry
          </h1>
          <p className="mx-auto mt-2.5 max-w-[46ch] text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
            Your workspace lives on theharvest.app. You can update your branding in Settings.
          </p>
        </div>

        {error && (
          <div className="mb-6 mt-6 flex items-start gap-2 rounded-lg border px-3.5 py-3 text-sm" style={{ background: '#FBEEEA', borderColor: '#EBD0C7', color: '#B0432B' }}>
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Branding — only for plans that include custom branding (Community / max+).
            Renders the shared BrandingSection (its own titled cards); gated exactly
            as before on features.customBranding. */}
        {features?.customBranding && (
          <>
            <SectionLabel>Branding</SectionLabel>
            <BrandingSection currentFeatures={features ?? undefined} />
          </>
        )}

        {/* Finish */}
        <div className="flex justify-end pb-12 pt-8">
          <button
            onClick={handleFinish}
            disabled={!canFinish}
            className="inline-flex items-center gap-2 rounded-lg px-7 py-3 font-semibold text-white transition-all"
            style={{
              background: BRAND,
              boxShadow: `0 10px 30px -8px color-mix(in srgb, ${BRAND} 42%, transparent)`,
              cursor: canFinish ? 'pointer' : 'not-allowed',
              opacity: canFinish ? 1 : 0.5,
              fontSize: 15,
            }}
          >
            <Rocket size={18} /> Finish &amp; enter app
          </button>
        </div>
      </div>
    </div>
  );
};

export default FirstRunSetup;
