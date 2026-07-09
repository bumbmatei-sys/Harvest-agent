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

interface FirstRunSetupProps {
  tenantId: string;
  /** Called with the final tenant id once setup is complete. */
  onFinished: (finalTenantId: string) => void;
}

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

  return (
    <div className="min-h-screen bg-stone-100 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HARVEST_LOGO} alt="Harvest" className="h-16 w-auto object-contain mx-auto mb-4" />
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderRadius: '9999px',
            background: 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, white)',
            border: '1px solid color-mix(in srgb, var(--brand-color, #B8962E) 30%, white)',
            fontSize: '13px', fontWeight: 700, color: BRAND, marginBottom: '12px',
          }}>
            <Sparkles size={14} /> Payment received
          </div>
          <h1 className="text-2xl font-bold text-earth font-display">Finish setting up your ministry</h1>
          <p className="text-sm text-warm-brown mt-2">
            {features?.customBranding || features?.customDomain
              ? 'Claim your web address and brand your app. You can change all of this later in Settings.'
              : 'Claim your web address. You can change it later in Settings.'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl flex items-start gap-2">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Subdomain claim */}
        <div className="bg-white rounded-2xl border border-stone-200 p-5 mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-brown mb-3">Your Web Address</h3>
          <div className="flex items-center">
            <input
              type="text"
              value={subdomain}
              onChange={(e) => { setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }}
              className="flex-1 px-4 py-2.5 border rounded-l-lg text-sm font-mono outline-none transition-colors focus:ring-2 focus:ring-gold"
              style={{ borderColor: status === 'taken' ? '#EF4444' : status === 'available' ? '#22C55E' : '#E8E2D9' }}
              placeholder="gracechurch"
            />
            <span className="px-4 py-2.5 border border-l-0 border-stone-200 rounded-r-lg text-sm text-warm-brown bg-stone-100">
              .theharvest.app
            </span>
          </div>
          <div className="mt-2 h-5 text-xs">
            {status === 'checking' && (
              <span className="text-warm-brown inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Checking availability…</span>
            )}
            {status === 'available' && (
              <span className="text-green-600 inline-flex items-center gap-1"><CheckCircle2 size={12} /> {subdomain}.theharvest.app is available!</span>
            )}
            {status === 'taken' && (
              <span className="text-red-600 inline-flex items-center gap-1"><AlertCircle size={12} /> This subdomain is already taken.</span>
            )}
          </div>
        </div>

        {/* Branding — only for plans that include custom branding (Community / max+) */}
        {features?.customBranding && (
          <div className="bg-white rounded-2xl border border-stone-200 p-5 mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-brown mb-3">Branding</h3>
            <BrandingSection currentFeatures={features ?? undefined} />
          </div>
        )}

        {/* Custom domain — only for plans that include it (Ministry / ultra) */}
        {features?.customDomain && (
          <div className="bg-white rounded-2xl border border-stone-200 p-5 mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-brown mb-3">Custom Domain</h3>
            <DomainSection hasCustomDomain={!!features?.customDomain} />
          </div>
        )}

        {/* Finish */}
        <div className="flex justify-end pb-10">
          <button
            onClick={handleFinish}
            disabled={!canFinish}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px', background: BRAND, color: '#fff',
              fontWeight: 600, padding: '12px 28px', borderRadius: '12px', border: 'none',
              cursor: canFinish ? 'pointer' : 'not-allowed', opacity: canFinish ? 1 : 0.5, fontSize: '15px',
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
