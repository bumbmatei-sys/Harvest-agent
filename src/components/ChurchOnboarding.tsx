"use client";
import React, { useState } from 'react';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { Church, ArrowRight, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { PLAN_DISPLAY_NAMES } from '../utils/plan-features';

const BRAND = 'var(--brand-color, #B8962E)';
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

/* ── Shared brand chrome (cream editorial ground, Fraunces display) ─────────── */

const MinShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-14 sm:py-20"
    style={{ background: 'var(--cream, #FAF8F5)' }}
  >
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 -translate-x-1/2"
      style={{ top: '-18%', width: 760, height: 540, maxWidth: '160vw', background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-color, #C9963A) 12%, transparent), transparent 68%)' }}
    />
    <div className="absolute left-8 top-8 hidden items-center gap-2 sm:flex" style={{ color: 'var(--text-faint, #A89A87)' }}>
      <span className="h-px w-6" style={{ background: 'var(--stone-300, #D6CCBE)' }} />
      <span className="text-xs font-medium">The digital foundation for ministries</span>
    </div>
    <div className="relative z-[1] w-full" style={{ maxWidth: 452 }}>{children}</div>
  </div>
);

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
 *
 * The plan is chosen upstream (marketing site → ?plan=…&signup=church) and is
 * shown here read-only — there is intentionally NO in-app plan picker.
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
  const [focus, setFocus] = useState(false);

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

  return (
    <MinShell>
      {/* Logo */}
      <div className="mb-5 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HARVEST_LOGO} alt="Harvest logo" className="h-12 w-auto object-contain" />
      </div>

      {/* Chosen plan — read-only (no in-app plan picker; plan is chosen upstream) */}
      <div className="mb-4 flex justify-center">
        <span
          className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-bold"
          style={{
            background: 'color-mix(in srgb, var(--brand-color, #C9963A) 12%, white)',
            border: '1px solid var(--border-gold, rgba(201,150,58,0.40))',
            color: BRAND,
          }}
        >
          <Sparkles size={14} /> {PLAN_DISPLAY_NAMES[selectedPlan]} plan
        </span>
      </div>

      {/* Card */}
      <div className="rounded-brand-xl border border-stone-200 bg-white px-6 py-8 shadow-[var(--ds-sh-md)] sm:px-9">
        {error && (
          <div className="mb-6 flex items-start gap-2 rounded-lg border px-3.5 py-3 text-sm" style={{ background: '#FBEEEA', borderColor: '#EBD0C7', color: '#B0432B' }}>
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="mb-7 flex justify-center">
          <div className="flex h-[62px] w-[62px] items-center justify-center rounded-brand-lg" style={{ background: 'color-mix(in srgb, var(--brand-color, #C9963A) 13%, white)', color: BRAND }}>
            <Church size={30} />
          </div>
        </div>

        <div className="mb-1.5 text-center text-xs font-semibold uppercase" style={{ letterSpacing: '0.19em', color: BRAND }}>Almost there</div>
        <h1 className="text-center font-display" style={{ fontWeight: 300, fontSize: 28, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>Name your ministry</h1>
        <p className="mx-auto mt-2.5 max-w-[38ch] text-center text-[13px] leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
          You&apos;ll customise your subdomain, logo and colours right after payment.
        </p>

        <div className="mt-7">
          <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>
            Ministry name
          </label>
          <div
            className="flex items-center gap-2.5 rounded-lg bg-white transition-all"
            style={{ height: 48, padding: '0 14px', border: `1px solid ${focus ? BRAND : 'var(--stone-200, #E8E2D9)'}`, boxShadow: focus ? `0 0 0 3px color-mix(in srgb, ${BRAND} 16%, transparent)` : 'none' }}
          >
            <span className="flex shrink-0" style={{ color: 'var(--text-muted, #8B7355)' }}><Church size={16} /></span>
            <input
              type="text"
              value={ministryName}
              onChange={(e) => setMinistryName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit && !submitting) handleContinue(); }}
              onFocus={() => setFocus(true)}
              onBlur={() => setFocus(false)}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#A89A87]"
              style={{ fontSize: 15, color: 'var(--text-heading, #2D2519)' }}
              placeholder="Grace Community Church"
              autoFocus
            />
          </div>
        </div>

        {/* Action */}
        <div className="mt-7 flex justify-end">
          <button
            onClick={handleContinue}
            disabled={submitting || !canSubmit}
            className="inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-white transition-all"
            style={{
              background: BRAND,
              boxShadow: `0 10px 30px -8px color-mix(in srgb, ${BRAND} 42%, transparent)`,
              cursor: (submitting || !canSubmit) ? 'not-allowed' : 'pointer',
              opacity: (submitting || !canSubmit) ? 0.5 : 1,
            }}
          >
            {submitting ? (
              <><Loader2 size={16} className="animate-spin" /> Redirecting to payment…</>
            ) : (
              <>Continue to payment <ArrowRight size={16} /></>
            )}
          </button>
        </div>
      </div>
    </MinShell>
  );
};

export default ChurchOnboarding;
