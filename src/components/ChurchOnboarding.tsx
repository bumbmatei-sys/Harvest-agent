"use client";
import React, { useState } from 'react';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { Church, ArrowRight, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { TenantPlan } from '../types/tenant.types';
import { canonicalPlanId } from '../utils/plan-id';
import { PLAN_DISPLAY_NAMES, PRICED_PLAN_ORDER } from '../utils/plan-features';
import { SIGNUP_CHECKOUT_ENDPOINT, WALLET_FALLBACK_LINE, resolveSignupBillingPeriod } from '../utils/signup-checkout';
import { TERM_BILLED_PHRASE } from '../utils/plan-features';

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

/** Signup records recoverable intent; only the server provisions a workspace.
 * Paid accounts collect an organization name. Free accounts need no extra input.
 * Website addresses are never claimed by onboarding on any plan.
 */
const ChurchOnboarding: React.FC<ChurchOnboardingProps> = ({ signupPlan }) => {
  const urlPlan = typeof window !== 'undefined'
    ? canonicalPlanId(new URLSearchParams(window.location.search).get('plan'))
    : null;
  // `?plan=` is URL-controlled — validate so a deleted tier can never be
  // selected, and fail closed to 'church'.
  //
  // 🔴 AGAINST `PRICED_PLAN_ORDER`, NOT `PLAN_ORDER`. This screen is the church
  // signup funnel and every plan it can select ends in a Dodo checkout. The
  // Forever Free tier is in `PLAN_ORDER` and has no product, so validating
  // against that list would let `?plan=free` through to a checkout that cannot
  // be built — the same hole the two Dodo routes had (see the note on
  // `readPlan` in /api/dodo/checkout). A free tenant is provisioned by the free
  // signup path (THE-203), never through here.
  const selectedPlan: TenantPlan =
    signupPlan || (urlPlan && (PRICED_PLAN_ORDER as readonly string[]).includes(urlPlan) ? urlPlan : 'church');

  // The period is chosen upstream on the pricing page (where the prices are
  // shown), validated here, displayed read-only. THE-135: by the time this
  // screen renders, the /auth redirect has usually dropped the query string —
  // so the period is read the way the plan is read: URL first, then the
  // sessionStorage lane App.tsx captured it into. Both sources are untrusted
  // and fail closed to 'monthly' — a link with no period (or a mangled one)
  // buys exactly what signup sold before annual.
  const selectedBilling = resolveSignupBillingPeriod(
    typeof window !== 'undefined' ? window.location.search : '',
  );

  const isFree = selectedPlan === 'free';

  const [ministryName, setMinistryName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [focus, setFocus] = useState(false);

  const canSubmit = isFree || ministryName.trim().length >= 2;

  const handleContinue = async () => {
    const user = auth.currentUser;
    if (!user) { setError('You must be logged in.'); return; }
    if (!canSubmit) {
      setError('Ministry name is required.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      // Write recoverable intent before checkout. Only provisioning clears the
      // marker; the name, paid term and plan survive an interrupted request.
      // Free has no billing term and no plan ever records a website address.
      const marker = isFree
        ? {
            signupInProgress: true,
            signupPlan: selectedPlan,
            signupMinistryName: 'My workspace',
          }
        : {
            signupInProgress: true,
            signupPlan: selectedPlan,
            signupBilling: selectedBilling,
            signupMinistryName: ministryName.trim(),
          };
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        await updateDoc(userRef, marker);
      } else {
        // 🔴 THE-73: NO `termsAccepted` here. This screen displays no terms,
        // no link and no checkbox, so it has no evidence of consent to record
        // — it can only assume. AuthPage is the consent point: it shows the
        // sentence and links the canonical Terms/Privacy documents beside the
        // submit button, and it records `termsAccepted` on all four of its
        // paths (Google new/existing, email signup/login). Asserting consent
        // from here would be a second writer of a consent record whose screen
        // never presented anything — under audit that is a claim that did not
        // happen, which is worse than no record at all. Nothing existing is
        // deleted or overwritten: this doc is only created when none exists,
        // and a doc that already carries the field keeps it untouched (the
        // updateDoc branch above writes the marker fields only).
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || (isFree ? 'My workspace' : ministryName.trim()),
          role: 'user',
          createdAt: new Date().toISOString(),
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

      // 3) Straight to the processor's Checkout — the webhook creates the tenant
      //    on success. Which processor is `SIGNUP_CHECKOUT_ENDPOINT`'s decision,
      //    driven by DODO_BILLING_ENABLED; the request body is identical either
      //    way, including the `referrerId` that carries affiliate attribution
      //    into subscription metadata.
      const token = await user.getIdToken();

      // Free provisioning completes in this request; it has no processor or webhook.
      if (isFree) {
        const freeResp = await fetch('/api/tenants/provision-free', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ministryName: 'My workspace' }),
        });
        const freeData = await freeResp.json();
        if (!freeResp.ok || !freeData.tenantId) {
          setError(freeData.error || 'Could not create your ministry. Please try again.');
          setSubmitting(false);
        }
        // The gate observes membership arriving and paints the account-ready
        // screen in place, without a reload through the member app.
        return;
      }

      const resp = await fetch(SIGNUP_CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: selectedPlan,
          billing: selectedBilling,
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

      {/* Chosen plan + billing term — read-only (no in-app picker for either;
          both are chosen upstream, and the term must be visible before the
          church commits to being charged for it) */}
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
          {/* THE-214: the term is shown because the church is about to be
              charged for it. Free is never charged, so there is no term to
              state — and `resolveSignupBillingPeriod` would have printed
              "billed monthly" beside a plan that bills nothing. */}
          {!isFree && (
            <>
              <span aria-hidden style={{ opacity: 0.55 }}>·</span>
              {TERM_BILLED_PHRASE[selectedBilling]}
            </>
          )}
        </span>
      </div>

      {/* Card */}
      <div className="rounded-brand-xl border border-line bg-surface-raised px-6 py-8 shadow-[var(--ds-sh-md)] sm:px-9">
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
        <h1 className="text-center font-display" style={{ fontWeight: 300, fontSize: 28, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>
          {isFree ? 'Create your workspace' : 'Name your ministry'}
        </h1>
        <p className="mx-auto mt-2.5 max-w-[38ch] text-center text-[13px] leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
          {isFree
            ? 'Your personal workspace is ready to create.'
            : 'Your team will use Harvest at theharvest.app.'}
        </p>

        {!isFree && (
        <div className="mt-7">
          <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-heading, #2D2519)' }}>
            Ministry name
          </label>
          <div
            className="flex items-center gap-2.5 rounded-lg bg-surface-raised transition-all"
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
              className="min-w-0 flex-1 bg-transparent outline-hidden placeholder:text-faint"
              style={{ fontSize: 15, color: 'var(--text-heading, #2D2519)' }}
              placeholder="Grace Community Church"
              autoFocus
            />
          </div>
        </div>
        )}

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
              <><Loader2 size={16} className="animate-spin" /> {isFree ? 'Creating your account…' : 'Redirecting to payment…'}</>
            ) : (
              <>{isFree ? 'Create my account' : 'Continue to payment'} <ArrowRight size={16} /></>
            )}
          </button>
        </div>

        {/* The wallet fallback is card advice, and the free lane takes no card.
            Printing it would put the word "payment" on the one screen this
            ticket exists to keep it off — the same reasoning OnboardingGate
            already applies to its own free branch. */}
        {!isFree && (
          <p className="mt-4 text-center text-xs leading-relaxed" style={{ color: 'var(--text-muted, #8B7355)' }}>
            {WALLET_FALLBACK_LINE}
          </p>
        )}
      </div>
    </MinShell>
  );
};

export default ChurchOnboarding;
