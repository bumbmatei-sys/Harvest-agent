"use client";
import React, { useState } from 'react';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { Church, ArrowRight, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { PLAN_DISPLAY_NAMES } from '../utils/plan-features';

const BRAND = 'var(--brand-color, #B8962E)';
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

interface ChurchOnboardingProps {
  onComplete: () => void;
  signupPlan?: TenantPlan;
}

/**
 * Minimal pre-payment signup: the user's login already exists (from AuthPage),
 * so all we collect here is the ministry name + the chosen plan, then send them
 * straight to Stripe Checkout. NO tenant is created client-side — the Stripe
 * webhook builds the tenant once payment lands (build-on-payment onboarding).
 * Subdomain, domain, logo, colour and description are claimed in the first-run
 * "Finish setup" screen after payment.
 */
const ChurchOnboarding: React.FC<ChurchOnboardingProps> = ({ signupPlan }) => {
  const urlPlan = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('plan') as TenantPlan | null
    : null;
  const selectedPlan: TenantPlan =
    signupPlan || (urlPlan && ['plus', 'pro', 'max', 'ultra'].includes(urlPlan) ? urlPlan : 'plus');

  const [ministryName, setMinistryName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = ministryName.trim().length >= 2;

  const handleContinue = async () => {
    const user = auth.currentUser;
    if (!user) { setError('You must be logged in.'); return; }
    if (!canSubmit) { setError('Ministry name is required.'); return; }

    setSubmitting(true);
    setError('');

    try {
      // 1) Lightweight marker so the app knows a signup is in flight (gates the
      //    "Complete your payment" / "Setting up…" screens). No tenant, no role,
      //    no plan, no claims are written here — the webhook owns all of that.
      // `signupPlan` + `signupMinistryName` let the first-run gate re-start
      // checkout if the user closes the Stripe tab before paying.
      const marker = {
        signupInProgress: true,
        signupPlan: selectedPlan,
        signupMinistryName: ministryName.trim(),
      };
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        await updateDoc(userRef, marker);
      } else {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || ministryName.trim(),
          role: 'user',
          createdAt: new Date().toISOString(),
          termsAccepted: true,
          ...marker,
        });
      }

      // 2) Pull any affiliate referrer captured earlier (kept across the flow).
      let referrerId: string | undefined;
      try {
        const stored = localStorage.getItem('affiliateReferrerId');
        if (stored) {
          const parsed = JSON.parse(stored);
          referrerId = parsed.id || undefined;
        }
      } catch { /* no referrer */ }

      // 3) Straight to Stripe Checkout — the webhook creates the tenant on success.
      const token = await user.getIdToken();
      const resp = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: selectedPlan,
          billing: 'monthly',
          ministryName: ministryName.trim(),
          ...(referrerId ? { referrerId } : {}),
        }),
      });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Failed to start checkout. Please try again.');
        setSubmitting(false);
      }
    } catch (err: any) {
      console.error('Church signup failed:', err);
      setError(err?.message || 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 rounded-xl bg-white text-[#111111] placeholder-[#AAAAAA] border border-[#E5E5E5] outline-none transition-colors';
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = BRAND; },
    onBlur: (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = '#E5E5E5'; },
  };

  return (
    <div className="min-h-screen bg-white px-6 py-10 flex flex-col">
      <div className="max-w-md w-full mx-auto flex-1 flex flex-col justify-center">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HARVEST_LOGO} alt="Harvest logo" className="h-20 w-auto object-contain" />
        </div>

        {/* Plan badge */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '6px 16px', borderRadius: '9999px',
            background: 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, white)',
            border: '1px solid color-mix(in srgb, var(--brand-color, #B8962E) 30%, white)',
            fontSize: '14px', fontWeight: 700, color: BRAND,
          }}>
            <Sparkles size={14} />
            {PLAN_DISPLAY_NAMES[selectedPlan]} Plan
          </span>
        </div>

        {/* Card */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-6 sm:p-8">
            {error && (
              <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl flex items-start gap-2">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <div className="animate-fade-in-up">
              <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                <Church style={{ margin: '0 auto 12px', color: BRAND }} size={32} />
                <h1 style={{ fontSize: '22px', fontWeight: 600, color: '#111111', marginBottom: '4px' }}>Name your ministry</h1>
                <p style={{ fontSize: '14px', color: '#888888', marginTop: '8px' }}>
                  You&apos;ll customise your subdomain, logo and colours right after payment.
                </p>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#111111', marginBottom: '6px' }}>
                  Ministry Name
                </label>
                <input
                  type="text"
                  value={ministryName}
                  onChange={(e) => setMinistryName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit && !submitting) handleContinue(); }}
                  className={inputClass}
                  style={{ borderColor: '#E5E5E5' }}
                  {...focusHandlers}
                  placeholder="Grace Community Church"
                  autoFocus
                />
              </div>
            </div>
          </div>

          {/* Action */}
          <div style={{ padding: '20px 24px', borderTop: '1px solid #F0F0F0', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleContinue}
              disabled={submitting || !canSubmit}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', background: BRAND, color: '#ffffff',
                fontWeight: 600, padding: '12px 24px', borderRadius: '12px', border: 'none',
                cursor: (submitting || !canSubmit) ? 'not-allowed' : 'pointer',
                opacity: (submitting || !canSubmit) ? 0.5 : 1,
              }}
            >
              {submitting ? (
                <><Loader2 size={16} className="animate-spin" /> Redirecting to payment…</>
              ) : (
                <>Continue to Payment <ArrowRight size={16} /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChurchOnboarding;
