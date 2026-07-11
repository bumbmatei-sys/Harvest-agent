'use client';
import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, getIdToken } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { Loader2, CreditCard } from 'lucide-react';
import { auth, db } from '../firebase';
import { isSuperAdminEmail } from '../utils/super-admins';
import { TenantPlan } from '../types/tenant.types';
import FirstRunSetup from './FirstRunSetup';

const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';
const BRAND = 'var(--brand-color, #B8962E)';
const ADMIN_ROLES = ['admin', 'church_admin', 'super_admin'];

type GateStatus = 'loading' | 'ready' | 'paying' | 'needs-payment' | 'first-run';

/** Soft gold halo shared by the transitional screens. */
const Halo = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute left-1/2 -translate-x-1/2"
    style={{ top: '-16%', width: 720, height: 480, maxWidth: '160vw', background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-color, #C9963A) 12%, transparent), transparent 68%)' }}
  />
);

/** Full-screen centred message (loading / setting-up) on the cream ground. */
const CenteredScreen: React.FC<{ title: string; subtitle?: string; spin?: boolean }> = ({ title, subtitle, spin = true }) => (
  <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center" style={{ background: 'var(--cream, #FAF8F5)' }}>
    <Halo />
    <div className="relative z-[1] flex flex-col items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={HARVEST_LOGO} alt="Harvest" className="mb-6 h-12 w-auto object-contain" />
      {spin && <Loader2 size={32} className="mb-5 animate-spin" style={{ color: BRAND }} />}
      <h1 className="font-display" style={{ fontWeight: 300, fontSize: 26, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>{title}</h1>
      {subtitle && <p className="mt-2.5 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>{subtitle}</p>}
    </div>
  </div>
);

/**
 * Access gate for the build-on-payment flow. A user who hasn't paid never
 * reaches the working app; a paid user is walked through first-run setup, then in.
 * Super admins (and everyone not mid-signup) pass straight through to `children`.
 */
const OnboardingGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<GateStatus>('loading');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [signupPlan, setSignupPlan] = useState<TenantPlan | null>(null);
  const [signupMinistryName, setSignupMinistryName] = useState<string>('');
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Is the user returning from Stripe right now?
  const onStripeSuccess = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('stripe') === 'success';

  useEffect(() => {
    let userUnsub: (() => void) | null = null;
    let tenantUnsub: (() => void) | null = null;
    const stopUser = () => { if (userUnsub) { userUnsub(); userUnsub = null; } };
    const stopTenant = () => { if (tenantUnsub) { tenantUnsub(); tenantUnsub = null; } };

    const authUnsub = onAuthStateChanged(auth, (user) => {
      stopUser(); stopTenant();
      if (!user) { setStatus('ready'); setTenantId(null); return; }
      if (isSuperAdminEmail(user.email)) { setStatus('ready'); return; }

      userUnsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const tId = (data?.tenantId as string) || null;
        const role = (data?.role as string) || 'user';
        const inProgress = data?.signupInProgress === true;
        setSignupPlan((data?.signupPlan as TenantPlan) || null);
        setSignupMinistryName((data?.signupMinistryName as string) || '');

        if (tId) {
          setTenantId(tId);
          stopTenant();
          tenantUnsub = onSnapshot(doc(db, 'tenants', tId), (tSnap) => {
            const t = tSnap.exists() ? tSnap.data() : null;
            const email = (user.email || '').toLowerCase();
            const isAdminUser = ADMIN_ROLES.includes(role)
              || (Array.isArray(t?.adminEmails) && t!.adminEmails.some((e: string) => (e || '').toLowerCase() === email));
            // Only a brand-new tenant (explicit false) gates first-run, and only
            // for its admin. Legacy tenants (no field) and members pass through.
            if (t && t.setupCompleted === false && isAdminUser) setStatus('first-run');
            else setStatus('ready');
          }, () => setStatus('ready'));
        } else {
          stopTenant();
          setTenantId(null);
          // A signup is in flight but no tenant exists yet. ALWAYS start in
          // 'paying' (poll) — even without ?stripe=success — so a user who paid
          // but refreshed/returned without the param is never shown a re-checkout
          // button (which would double-charge). The webhook flips us to first-run
          // when the tenant lands; only a genuinely abandoned signup falls through
          // to 'needs-payment' after the poll times out (see the poll effect).
          if (inProgress) setStatus('paying');
          else setStatus('ready');
        }
      }, () => setStatus('ready'));
    });

    return () => { authUnsub(); stopUser(); stopTenant(); };
  }, [onStripeSuccess]);

  // 'paying': the webhook is asynchronous. onSnapshot flips us to first-run the
  // moment tenantId lands; meanwhile force-refresh the token so claims propagate,
  // and after ~30s soften the message.
  useEffect(() => {
    if (status !== 'paying') { setPollTimedOut(false); return; }
    let elapsed = 0;
    const interval = setInterval(async () => {
      elapsed += 2000;
      try { if (auth.currentUser) await getIdToken(auth.currentUser, true); } catch { /* ignore */ }
      if (elapsed >= 30000) {
        clearInterval(interval);
        // Returned via Stripe success → they definitely paid; keep waiting with a
        // softer message. Otherwise the signup looks abandoned → let them pay.
        if (onStripeSuccess) setPollTimedOut(true);
        else setStatus('needs-payment');
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [status, onStripeSuccess]);

  const restartCheckout = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setRestarting(true);
    try {
      let referrerId: string | undefined;
      try {
        const stored = localStorage.getItem('affiliateReferrerId');
        if (stored) referrerId = JSON.parse(stored).id || undefined;
      } catch { /* none */ }
      const token = await user.getIdToken();
      const resp = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: signupPlan || 'plus',
          billing: 'monthly',
          ministryName: signupMinistryName || '',
          ...(referrerId ? { referrerId } : {}),
        }),
      });
      const data = await resp.json();
      if (data.url) window.location.href = data.url;
      else setRestarting(false);
    } catch {
      setRestarting(false);
    }
  };

  if (status === 'ready') return <>{children}</>;

  if (status === 'loading') {
    // Avoid flashing the normal funnel for a paying user mid-resolve.
    return onStripeSuccess
      ? <CenteredScreen title="Setting up your account…" subtitle="This only takes a moment." />
      : <>{children}</>;
  }

  if (status === 'paying') {
    return pollTimedOut
      ? <CenteredScreen spin={false} title="Payment received — finishing setup" subtitle="Almost there. Refresh in a moment if this screen doesn't update on its own." />
      : <CenteredScreen title="Setting up your account…" subtitle="Confirming your payment and creating your ministry. This usually takes a few seconds." />;
  }

  if (status === 'first-run' && tenantId) {
    return (
      <FirstRunSetup
        tenantId={tenantId}
        onFinished={(finalTenantId) => {
          // Hand the new owner off to their own subdomain admin. (Auth is per-origin,
          // so they'll sign in once on the subdomain — expected until we add a
          // seamless cross-subdomain handoff.)
          window.location.href = `https://${finalTenantId}.theharvest.app/admin`;
        }}
      />
    );
  }

  // needs-payment: closed the Stripe tab before paying.
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center" style={{ background: 'var(--cream, #FAF8F5)' }}>
      <Halo />
      <div className="relative z-[1] flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HARVEST_LOGO} alt="Harvest" className="mb-6 h-12 w-auto object-contain" />
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-brand-lg" style={{ background: 'color-mix(in srgb, var(--brand-color, #C9963A) 13%, white)', color: BRAND }}>
          <CreditCard size={28} />
        </div>
        <h1 className="font-display" style={{ fontWeight: 300, fontSize: 28, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>Complete your payment</h1>
        <p className="mt-2.5 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
          Your ministry isn&apos;t active yet. Finish checkout to create your account and get started.
        </p>
        <button
          onClick={restartCheckout}
          disabled={restarting}
          className="mt-7 inline-flex items-center gap-2 rounded-lg font-semibold text-white"
          style={{
            background: BRAND, padding: '12px 28px', border: 'none',
            boxShadow: `0 10px 30px -8px color-mix(in srgb, ${BRAND} 42%, transparent)`,
            cursor: restarting ? 'wait' : 'pointer', opacity: restarting ? 0.7 : 1, fontSize: '15px',
          }}
        >
          {restarting ? <><Loader2 size={18} className="animate-spin" /> Redirecting…</> : <>Continue to payment</>}
        </button>
      </div>
    </div>
  );
};

export default OnboardingGate;
