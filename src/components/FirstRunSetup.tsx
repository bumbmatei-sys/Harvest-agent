"use client";
import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { CheckCircle2, AlertCircle, Loader2, Sparkles, Rocket } from 'lucide-react';
import { auth, db } from '../firebase';
import { isSubdomainAvailable } from '../utils/tenant.utils';
import { getPlanFeatures } from '../utils/plan-features';
import { TenantPlan } from '../types/tenant.types';
import { authFetch } from '../utils/auth-fetch';
import BrandingSection from './settings/BrandingSection';
import DomainSection from './settings/DomainSection';

const BRAND = 'var(--brand-color, #B8962E)';
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';
const SUCCESS = 'var(--brand-success, #6E8E52)';
const DANGER = 'var(--brand-danger, #C4553B)';

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
  const [subdomain, setSubdomain] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');
  const [subFocus, setSubFocus] = useState(false);

  // Load the tenant's plan + current (auto-generated) subdomain.
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'tenants', tenantId));
        if (snap.exists()) {
          const data = snap.data();
          setPlan((data.plan as TenantPlan) || 'plus');
          setSubdomain((data.subdomain as string) || tenantId);
        } else {
          setSubdomain(tenantId);
          setPlan('plus');
        }
      } catch {
        setSubdomain(tenantId);
        setPlan('plus');
      }
    })();
  }, [tenantId]);

  // Live availability check. The tenant's current id is "yours" — never taken.
  useEffect(() => {
    if (!subdomain || subdomain.length < 3) { setStatus('idle'); return; }
    if (subdomain === tenantId) { setStatus('available'); return; }
    setStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const available = await isSubdomainAvailable(subdomain);
        setStatus(available ? 'available' : 'taken');
      } catch {
        setStatus('available');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [subdomain, tenantId]);

  const features = plan ? getPlanFeatures(plan) : null;
  const canFinish = subdomain.length >= 3 && (subdomain === tenantId || status === 'available') && !finishing;

  const handleFinish = async () => {
    if (status === 'taken') { setError('That subdomain is taken. Try another.'); return; }
    setFinishing(true);
    setError('');
    try {
      const resp = await authFetch('/api/tenants/finish-setup', {
        method: 'POST',
        body: JSON.stringify({ subdomain }),
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

  const subBorder = status === 'taken' ? DANGER : status === 'available' ? SUCCESS : (subFocus ? BRAND : 'var(--stone-300, #D6CCBE)');

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
            <Sparkles size={13} /> Payment received
          </div>
          <h1 className="font-display" style={{ fontWeight: 300, fontSize: 32, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>
            Finish setting up your ministry
          </h1>
          <p className="mx-auto mt-2.5 max-w-[46ch] text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
            {features?.customBranding || features?.customDomain
              ? 'Claim your web address and brand your app. You can change all of this later in Settings.'
              : 'Claim your web address. You can change it later in Settings.'}
          </p>
        </div>

        {error && (
          <div className="mb-6 mt-6 flex items-start gap-2 rounded-lg border px-3.5 py-3 text-sm" style={{ background: '#FBEEEA', borderColor: '#EBD0C7', color: '#B0432B' }}>
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Subdomain claim */}
        <div className="mt-8 rounded-brand-lg border border-stone-200 bg-white p-5 shadow-[var(--ds-sh-sm)]">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted, #8B7355)' }}>Your web address</h3>
          <div className="flex items-stretch">
            <input
              type="text"
              value={subdomain}
              onChange={(e) => { setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }}
              onFocus={() => setSubFocus(true)}
              onBlur={() => setSubFocus(false)}
              className="min-w-0 flex-1 rounded-l-lg px-4 font-mono text-sm outline-none transition-colors"
              style={{ height: 46, border: `1px solid ${subBorder}`, borderRight: 'none', color: 'var(--text-heading, #2D2519)', background: 'white' }}
              placeholder="gracechurch"
            />
            <span
              className="flex items-center whitespace-nowrap rounded-r-lg px-4 text-sm"
              style={{ border: '1px solid var(--stone-300, #D6CCBE)', background: 'var(--surface-sunken, #F3EEE7)', color: 'var(--text-body, #4A4038)' }}
            >
              .theharvest.app
            </span>
          </div>
          <div className="mt-2 h-5 text-xs">
            {status === 'checking' && (
              <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-muted, #8B7355)' }}><Loader2 size={12} className="animate-spin" /> Checking availability…</span>
            )}
            {status === 'available' && (
              <span className="inline-flex items-center gap-1.5" style={{ color: SUCCESS }}><CheckCircle2 size={13} /> {subdomain}.theharvest.app is available</span>
            )}
            {status === 'taken' && (
              <span className="inline-flex items-center gap-1.5" style={{ color: DANGER }}><AlertCircle size={13} /> That subdomain is taken — try another.</span>
            )}
          </div>
        </div>

        {/* Branding — only for plans that include custom branding (Community / max+).
            Renders the shared BrandingSection (its own titled cards); gated exactly
            as before on features.customBranding. */}
        {features?.customBranding && (
          <>
            <SectionLabel>Branding</SectionLabel>
            <BrandingSection currentFeatures={features ?? undefined} />
          </>
        )}

        {/* Custom domain — only for plans that include it (Ministry / ultra).
            Renders the shared DomainSection (its own titled card — it self-labels
            "Web Address" / "Custom domain"); gated on features.customDomain
            exactly as before. */}
        {features?.customDomain && (
          <div className="mt-8">
            <DomainSection hasCustomDomain={!!features?.customDomain} />
          </div>
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
            {finishing ? (
              <><Loader2 size={18} className="animate-spin" /> Finishing…</>
            ) : (
              <><Rocket size={18} /> Finish &amp; enter app</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FirstRunSetup;
